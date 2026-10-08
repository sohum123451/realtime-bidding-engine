# SOHUM — Real-Time 3D Luxury Auction Saleroom & High-Throughput Engine

> **Live Production Saleroom:** [https://client-six-zeta-99.vercel.app/](https://client-six-zeta-99.vercel.app/)  
> **Source Repository:** [https://github.com/sohum123451/realtime-bidding-engine](https://github.com/sohum123451/realtime-bidding-engine)

A high-concurrency, real-time luxury auction saleroom engineered with **Node 20**, **TypeScript (Strict)**, **Fastify**, **ws**, **PostgreSQL 16** (raw SQL via `pg`, zero ORM), and an immersive diegetic **3D WebGL Saleroom** powered by **Three.js** and **WebAudio API**.

---

## 🏛️ Executive Summary & Notes to Judges

Dear Judges,

Welcome to **SOHUM Saleroom**. This platform bridges two engineering disciplines rarely combined at this level of fidelity:
1. **Hardened Low-Latency Distributed Systems:** A high-throughput auction core capable of processing hundreds of competing bids per second without race conditions, deadlocks, price regressions, or sequence gaps.
2. **Diegetic 3D Frontend Engineering:** An authentic, physical luxury saleroom rendered in Three.js where bids raise actual wooden paddles, gavels strike rostrum soundboards, brass banker lamps illuminate active bidder desks, and prices roll on extruded mechanical 3D numerals.

### Key Highlights for Evaluation:

1. **Deterministic Concurrency via `SELECT ... FOR UPDATE`:**
   - Rather than suffering from optimistic concurrency control (OCC) abort storms where $N$ competing bids result in $O(N^2)$ transaction retries, SOHUM utilizes PostgreSQL row locks.
   - 200 concurrent bids serialize cleanly in kernel-level queues, guaranteeing strictly monotonic price progression and zero aborts under extreme high-frequency contention.
2. **Gapless Event Sourcing & Automatic Reconnection Protocol:**
   - Every single state change is committed with an immutable, strictly monotonic sequence number (`seq`).
   - Sockets dropping due to network partition automatically synchronize via a 2-stage replay protocol (`sync_replay` for small gaps $\le 50$, `snapshot` for cold/deep re-syncs), achieving total convergence across distributed clients.
3. **Idempotency with Zero Double-Charges:**
   - Bids carry client-generated UUID `idempotency_key`s backed by database unique constraints. Retrying dropped connections produces the exact original verdict without re-charging or incrementing sequence.
4. **Dynamic 3D Table & Character Spawning:**
   - When a new VIP bidder registers in the saleroom, the 3D engine dynamically calculates tiered spatial coordinates and constructs a full physical station: mahogany desk, leather blotter, crystal water glass, brass banker's lamp, articulated human character, wooden paddle with authentic typography, and glowing nameplate.
   - The camera smoothly sweeps across the saleroom to spotlight the new seat.
5. **Self-Overbidding Prevention Engine:**
   - Real luxury salerooms strictly reject patrons bidding against themselves. The engine monitors `current_winner_id`; active leaders are locked with a golden `👑 YOU HOLD HIGH BID` badge and prevented from overbidding themselves until counter-bids emerge from floor or phone banks.
6. **Zero External Assets (100% Procedural & Self-Contained):**
   - No external 50MB GLTF/GLB models or audio mp3s that fail on poor networks. All 3D meshes (gimbals, desks, humans, chandeliers, cornices) and sound effects (paddle wooden clacks, gavel strikes, spatial chimes) are synthesized procedurally in WebGL and WebAudio API.
7. **Dual-Mode Architectural Resilience:**
   - Operates flawlessly against a live Docker/AWS EC2 Fastify + Postgres backend OR automatically fails over to an in-memory client-side simulation engine on static hosts (like Vercel), ensuring 100% testability with zero setup barriers.

---

## 1. System Architecture

```
                       +---------------------------------------+
                       |    Client (Three.js + Vanilla TS)     |
                       | - Diegetic 3D Luxury Saleroom         |
                       | - Dynamic Bidder Desk & Seat Spawner  |
                       | - Mechanical Odometer Numerals        |
                       | - Procedural WebAudio Sound Engine    |
                       | - Gapless Seq Tracking & Auto-Resync  |
                       +-------------------+-------------------+
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
         |            | - DB Clock Authoritative Timing      |           |
         |            | - Self-Overbidding Protection Check  |           |
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

For a real-time live auction engine, **`FOR UPDATE` is strictly superior for the following reasons:**

### 1. Extreme Contention Concentration
- In typical web architectures (e.g. shopping carts, user profile edits), collisions on the exact same row are rare. Optimistic locking thrives because transactions almost never conflict.
- In a live auction, **100% of concurrent writes target the exact same auction row**. With 200 concurrent bids arriving in the final seconds, an optimistic model causes massive abort storms. The first transaction commits, and the remaining 199 transactions fail their version check.

### 2. Elimination of Retry Cascades & Wasted CPU
- Under OCC, failed transactions must either retry or reject. If 199 transactions retry concurrently, they hit the new version, 1 succeeds, and 198 abort again ($O(N^2)$ transaction volume). This saturates database CPU, exhausts connection pools, and spikes round-trip latency.
- With `SELECT ... FOR UPDATE`, PostgreSQL serializes transactions into an orderly, kernel-level FIFO queue at the row lock. Each incoming transaction acquires the lock, reads the **exact, authoritative state**, evaluates business rules in a single pass, updates the price, increments `seq`, commits, and releases the lock to the next waiter. Zero aborts, zero retry loops.

### 3. Mutual Exclusion Between Bids and Auction Close
- The auction closing scheduler also acquires `SELECT ... FOR UPDATE` on the auction row.
- If a bid arrives just before expiration, it holds the lock and updates state under atomic isolation.
- When the closing scheduler acquires the lock next, it reads the authoritative DB clock and updates status cleanly.
- A bid and an auction close can **never both win**, and neither can read stale time or state.

---

## 3. The Reconnect & Synchronization Protocol

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

## 4. Test Suite & Invariant Proofs

All test cases run via Vitest against PostgreSQL 16:

```bash
npm --prefix server test
```

### Test Suite Output:
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

### Proving Race Conditions: Test 2 Without `FOR UPDATE`

When `FOR UPDATE` is deliberately bypassed via `{ disableLocking: true }`, concurrent transactions read stale snapshots and overwrite each other's prices and sequences:

```text
Test 2 (NO LOCKING) Invariant Violations caught without FOR UPDATE:
Price inversion detected: event seq 4 amount 16005 is not greater than seq 3 amount 16033
Price inversion detected: event seq 5 amount 12918 is not greater than seq 4 amount 16005
Price inversion detected: event seq 6 amount 11084 is not greater than seq 5 amount 12918
Final price mismatch: DB final price 12268 != max accepted amount 16063
Duplicate amounts accepted: 8952, 12044
```
**Conclusion:** Without `FOR UPDATE`, lower bids overwrite higher bids, prices regress backwards, sequence monotonicity is broken, and final prices fail to reflect the highest accepted bid.

---

## 5. Chaos Simulation Engine

Running `npm run chaos` executes 8 concurrent automated bots continuously bidding while randomly injecting socket disconnects:

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

## 6. How to Run Locally

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

### Step 3: Seed Database & Run Migrations
```bash
npm run seed
```

### Step 4: Run the Test Suite
```bash
npm run server:test
```

### Step 5: Start Fastify Backend Server
```bash
npm run server:dev
```

### Step 6: Start 3D Web Client
```bash
npm run client:dev
```
Open **`http://localhost:5173`** in your browser.

---

## 7. Cloud Deployment (AWS & Vercel)

- **Frontend:** Automatically deployed and production-aliased on Vercel at [https://client-six-zeta-99.vercel.app/](https://client-six-zeta-99.vercel.app/).
- **Backend on AWS EC2:**
  ```bash
  # Execute automated EC2 deployment script
  ./aws/deploy-ec2.sh
  ```
- **Engine Switcher:** The client includes an interactive **🌐 Engine** dialog in the top navigation bar allowing judges and users to instantly switch between the **Cloud AWS Backend** and the high-fidelity **Standalone Simulation Engine**.
