# WEB-BE2: Real-Time Auction Engine & 3D Live Client

A high-concurrency, real-time auction platform engineered with **Node 20**, **TypeScript (Strict)**, **Fastify**, **ws**, **PostgreSQL 16** (raw SQL via `pg`, zero ORM), and a live **3D client** powered by **Vite** and **Three.js**.

---

## 1. System Architecture

```
                       +-----------------------------------+
                       |    Client (Three.js + Vanilla TS) |
                       | - Diegetic 3D Auction Room        |
                       | - Mechanical Odometer Numerals    |
                       | - Gapless Seq Tracking & Resync   |
                       +-----------------+-----------------+
                                         |
                                         | WebSocket (/ws) & HTTP
                                         v
         +---------------------------------------------------------------+
         |                     Fastify Application Node                  |
         |                                                               |
         |  +---------------------+             +---------------------+  |
         |  |   WebSocket Layer   |             |   REST API Routes   |  |
         |  | - Zod Input Guard   |             | - GET  /auctions    |  |
         |  | - Heartbeat (15s)   |             | - GET  /auctions/:id|  |
         |  | - Gap Detection     |             | - POST /auctions    |  |
         |  +----------+----------+             | - POST /bids (cURL) |  |
         |             |                        +----------+----------+  |
         |             +-------------------+---------------+             |
         |                                 |                             |
         |                                 v                             |
         |            +--------------------------------------+           |
         |            |         Bid Placement Core           |           |
         |            | - Single ACID Transaction            |           |
         |            | - SELECT ... FOR UPDATE (Row Lock)   |           |
         |            | - DB Clock Timing & Anti-sniping     |           |
         |            | - Append-Only Events Log (seq)       |           |
         |            +--------------------+-----------------+           |
         |                                 |                             |
         +---------------------------------|-----------------------------+
                                           |
                                           v
         +---------------------------------------------------------------+
         |                   PostgreSQL 16 (auction_db)                  |
         |                                                               |
         |  [auctions]  id, status, current_price_cents, version, seq    |
         |  [bids]      id, bidder_id, idempotency_key UNIQUE, accepted  |
         |  [events]    PRIMARY KEY (auction_id, seq) [Append-Only]      |
         |                                                               |
         |  Trigger: AFTER INSERT ON events -> NOTIFY auction_events     |
         +---------------------------------+-----------------------------+
                                           |
                    LISTEN auction_events  |  (Broadcast seq only)
                                           v
                       +-----------------------------------+
                       | Multi-Instance Fan-Out Bus        |
                       | 1. Receives (auction_id, seq)     |
                       | 2. Reads event row from database  |
                       | 3. Broadcasts gapless event to WS |
                       +-----------------------------------+
```

---

## 2. Why `FOR UPDATE` was Chosen Over Optimistic Versioning

In high-concurrency systems, concurrency control patterns are typically split between **Optimistic Concurrency Control (OCC)** (e.g. `WHERE version = expected_version`) and **Pessimistic Concurrency Control** (e.g. `SELECT ... FOR UPDATE`). 

For a real-time auction engine, **`FOR UPDATE` is strictly superior for the following reasons:**

### 1. Extreme Contention Concentration
- In typical web architectures (e.g. shopping carts, user profile edits), collisions on the exact same row are rare. Optimistic locking thrives because transactions almost never conflict.
- In a live auction, **100% of concurrent writes target the exact same auction row**. With 200 concurrent bids arriving in the final 5 seconds, an optimistic model causes massive abort storms. The first transaction commits, and the remaining 199 transactions fail their version check.

### 2. Elimination of Retry Cascades & Wasted CPU
- Under OCC, failed transactions must either retry or reject. If 199 transactions retry concurrently, they hit the new version, 1 succeeds, and 198 abort again ($O(N^2)$ transaction volume). This saturates database CPU, exhausts connection pools, and spikes round-trip latency.
- With `SELECT ... FOR UPDATE`, PostgreSQL serializes transactions into an orderly, kernel-level FIFO queue at the row lock. Each incoming transaction acquires the lock, reads the **exact, authoritative state**, evaluates business rules in a single pass, updates the price, increments `seq`, commits, and releases the lock to the next waiter. Zero aborts, zero retry loops.

### 3. Mutual Exclusion Between Bids and Auction Close
- The auction closing scheduler also acquires `SELECT ... FOR UPDATE` on the auction row.
- If a bid arrives in the final 30 seconds, it holds the lock and extends `ends_at` by 30 seconds (anti-sniping).
- When the closing scheduler acquires the lock next, it reads the freshly updated `ends_at` from the DB clock and discovers the auction is no longer expired.
- Conversely, if the close scheduler acquires the lock first, it marks `status = 'closed'`. When the waiting bid acquires the lock, it immediately sees `status = 'closed'` and rejects with `auction_closed`.
- A bid and an auction close can **never both win**, and neither can read stale time or state.

---

## 3. The Reconnect Protocol

The real-time layer is designed for complete resilience across dropped sockets, sequence gaps, and multi-server deployments:

1. **Gapless Sequence Numbers (`seq`)**:
   - Every state change (bid accepted, auction closed) increments `seq` by exactly 1 within the same transaction and writes an immutable record to the `events` table with `PRIMARY KEY (auction_id, seq)`.
   - Every broadcast message carries `auction_id` and `seq`.

2. **Client Synchronization Handshake**:
   - On connect or reconnect, the client sends:
     ```json
     { "type": "sync", "auction_id": "<uuid>", "last_seq": 4 }
     ```
   - **Small Gap (`current_seq - last_seq <= 50`)**: The server queries `events WHERE auction_id = $1 AND seq > $2 ORDER BY seq ASC` and responds with:
     ```json
     { "type": "sync_replay", "auction_id": "<uuid>", "from_seq": 4, "current_seq": 7, "events": [...] }
     ```
   - **Large Gap or Cold Connect (`last_seq == 0` or gap > 50)**: The server queries the auction snapshot and recent events:
     ```json
     { "type": "snapshot", "auction_id": "<uuid>", "current_seq": 7, "auction": {...}, "recent_events": [...] }
     ```

3. **Client-Side Gap Detection**:
   - If an incoming live event has `seq > last_seq + 1`, the client immediately recognizes a missed frame (network drop or buffer overflow) and automatically dispatches `{ type: "sync", auction_id, last_seq }` to fill the gap.

4. **In-Flight Bid Idempotency Preservation**:
   - If a client's socket drops while a bid is in flight, the client retries the bid upon reconnect using the **exact same `idempotency_key`**.
   - Because `bids.idempotency_key` is `UNIQUE`, the database immediately detects the existing row and returns the original verdict (`accepted`, `current_price_cents`, `seq`), preventing any duplicate bid or double charge.

5. **Multi-Instance Fan-Out via Postgres LISTEN/NOTIFY**:
   - A PostgreSQL trigger on `events` executes `pg_notify('auction_events', json_build_object('auction_id', NEW.auction_id, 'seq', NEW.seq))` upon transaction `COMMIT`.
   - Each Fastify instance maintains a dedicated `LISTEN auction_events` connection. Upon notification, it queries `events WHERE auction_id = $1 AND seq = $2` and broadcasts the verified event to its local WebSockets. No authoritative state is kept in server process memory.

---

## 4. Test Suite Results

All 6 test cases run via Vitest against PostgreSQL 16:

### Command:
```bash
npm --prefix server test
```

### Passing Test Output:
```text
 ✓ test/ws-reconnect.test.ts (2 tests) 237ms
   ✓ Real-Time WebSocket & Reconnect Protocol > Test 5: Kill a client mid-stream, reconnect with stale last_seq, assert it converges to identical state as client that never disconnected
   ✓ Real-Time WebSocket & Reconnect Protocol > Test 6: Kill and restart the server mid-auction. State must be fully intact afterward

 ✓ test/bid-transaction.test.ts (4 tests) 1643ms
   ✓ Auction Core Transactions and Concurrency > Test 1: 200 concurrent bids at random amounts serialize correctly with FOR UPDATE  730ms
   ✓ Auction Core Transactions and Concurrency > Test 2: Without FOR UPDATE, race conditions violate invariants  619ms
   ✓ Auction Core Transactions and Concurrency > Test 3: Duplicate idempotency_key submitted 50x in parallel yields exactly one bid row
   ✓ Auction Core Transactions and Concurrency > Test 4: Bid racing the auction close: exactly one of them wins, state stays consistent

 Test Files  2 passed (2)
      Tests  6 passed (6)
   Duration  2.64s
```

---

### Demonstrating Race Conditions: Test 2 Output Without `FOR UPDATE`

When `FOR UPDATE` is deliberately bypassed via `{ disableLocking: true }`, concurrent transactions read stale snapshots and overwrite each other's prices and sequences:

```text
Test 2 (NO LOCKING) Stats:
      Total bids attempted: 200
      Crashed/Collided transactions: 0
      Accepted bids in DB: 124
      Final price in DB: 12268
      Final seq in DB: 124
      Event count in DB: 124
    
Test 2 Invariant Violations caught without FOR UPDATE:
Price inversion detected: event seq 4 amount 16005 is not greater than seq 3 amount 16033
Price inversion detected: event seq 5 amount 12918 is not greater than seq 4 amount 16005
Price inversion detected: event seq 6 amount 11084 is not greater than seq 5 amount 12918
Price inversion detected: event seq 7 amount 6002 is not greater than seq 6 amount 11084
Price inversion detected: event seq 10 amount 11659 is not greater than seq 9 amount 14064
Price inversion detected: event seq 12 amount 8666 is not greater than seq 11 amount 15760
Price inversion detected: event seq 14 amount 5677 is not greater than seq 13 amount 13751
Price inversion detected: event seq 18 amount 6378 is not greater than seq 17 amount 15792
Price inversion detected: event seq 20 amount 4520 is not greater than seq 19 amount 4787
Price inversion detected: event seq 30 amount 2537 is not greater than seq 29 amount 16009
Price inversion detected: event seq 35 amount 2320 is not greater than seq 34 amount 8327
...
Final price mismatch: DB final price 12268 != max accepted amount 16063
Duplicate amounts accepted: 8952, 12044
```
**Conclusion:** Without `FOR UPDATE`, lower bids overwrite higher bids, prices regress backwards, sequence monotonicity is broken, and final prices fail to reflect the highest accepted bid.

---

### Chaos Simulation Script Output

Running `npm run chaos` executes 8 concurrent bots continuously bidding while randomly dropping sockets:

```text
====================================================
   STARTING CHAOS INJECTION & CONCURRENCY TEST      
====================================================
Target WS: ws://127.0.0.1:3000/ws
Active Bots: 8 bots
Duration: 12s

Auction lot created: 87642a86-585e-417f-83cb-23debe31c888 (Starting: $10.00)
All 8 bots connected and synchronized.
Chaos period ended. Gracefully draining and synchronizing final state...

====================================================
             DATABASE INVARIANTS CHECK              
====================================================
Execution Telemetry:
  - Total Chaos Disconnects Simulated : 102
  - Total Bids Sent by Bots           : 666
  - Unique Bids Persisted in DB       : 665
  - Bids Accepted                     : 408
  - Bids Rejected                     : 257
  - Final Database Seq                : 408
  - Final Database Price              : $2238.00 (223800 cents)
  
RESULTS:
  [PASS] Final price == max accepted amount -> DB Price: 223800 | Max Accepted: 223800
  [PASS] Accepted bids strictly increasing in seq order -> None
  [PASS] No two accepted bids share an amount -> Accepted count: 408 | Unique: 408
  [PASS] Every rejected bid has a reason -> Rejected count: 257 | All reasoned: true
  [PASS] Event log sequence is strictly gapless (1..N) -> Event rows: 408 | Auction Seq: 408
  [PASS] All disconnected/reconnected bots converged to identical final state -> Bots synced to seq 408: 8/8

====================================================
  SUCCESS: ALL CONCURRENCY & CHAOS INVARIANTS HELD!  
====================================================
```

---

## 5. 3D Live Client Concept & Experience

The client is built using **Three.js** and **Vanilla TypeScript** (zero React):
- **Auction Room Concept**: Dark, warm mahogany floor with architectural boundary, spotlight illumination, and antique gold accents.
- **Procedural Lot**: Concentric brass gimbal rings rotating on distinct axes with a central faceted core under a directional overhead spotlight (zero external model downloads).
- **Mechanical Odometer Numerals**: Real extruded 3D numerals floating above the pedestal that roll in a mechanical rotation whenever the price updates.
- **Seat Pulses**: 6 fixed amphitheater bidder seats (Alice, Bob, Claire, David, Elena, Felix). Accepted bids trigger an expanding light ring in the winner's signature color.
- **Visible Race Condition Resolution**: Rejected bids display a subtle spotlight dimming and flash the rejection reason (`too_low`, `auction_closed`).
- **Diegetic Connection State**: On socket disconnect, the spotlight drops to a dim amber glow and numerals freeze with a `"RECONNECTING — LAST SEEN SEQ N"` placard until re-synced.
- **Countdown Ring & Anti-Sniping**: A shrinking ring around the pedestal base expands visibly when a bid in the last 30s extends the auction.
- **Performance**: 60fps capped pixel ratio, pre-allocated vectors/quaternions (zero per-frame GC allocations), and `prefers-reduced-motion` camera orbit fallback.

---

## 6. How to Run

### Prerequisites
- Node 20+
- Docker and Docker Compose

### Step 1: Start PostgreSQL 16
```bash
docker compose up -d
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Run Database Migrations & Seed Sample Auction
```bash
npm run seed
```

### Step 4: Run the Test Suite
```bash
npm run server:test
```

### Step 5: Run the Chaos Script
```bash
# In terminal 1: start server
npm run server:dev

# In terminal 2: run chaos bot test
npm run chaos
```

### Step 6: Start 3D Web Client
```bash
npm run client:dev
```
Open **`http://localhost:5173`** in your browser.
Switch between bidder seats, place bids, test quick increments, and click **"Simulate Drop"** to watch the diegetic reconnection in real-time.
