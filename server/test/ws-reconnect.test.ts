import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { runMigrations } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';
import { createAuction, getAuction } from '../src/services/auction-service.js';
import { signBidderToken } from '../src/auth/token.js';
import { startServer } from '../src/index.js';
import crypto from 'crypto';

describe('Real-Time WebSocket & Reconnect Protocol', () => {
  let serverInstance: any;
  const PORT = 3001;

  beforeAll(async () => {
    await runMigrations();
    serverInstance = await startServer({ port: PORT, closePoolOnShutdown: false });
  });

  afterAll(async () => {
    if (serverInstance) {
      await serverInstance.shutdown();
    }
    await pool.end();
  });

  function createClient(token?: string): WebSocket {
    const query = token ? `?token=${token}` : '';
    return new WebSocket(`ws://localhost:${PORT}/ws${query}`);
  }

  function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) return resolve();
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
  }

  function waitForMessage<T = any>(ws: WebSocket, predicate: (msg: any) => boolean): Promise<T> {
    return new Promise((resolve) => {
      const handler = (data: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (predicate(parsed)) {
            ws.off('message', handler);
            resolve(parsed);
          }
        } catch {
          // ignore
        }
      };
      ws.on('message', handler);
    });
  }

  it('Test 5: Kill a client mid-stream, reconnect with stale last_seq, assert it converges to identical state as client that never disconnected', async () => {
    const endsAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const auction = await createAuction({
      title: 'Diamond Pendant - Reconnect Test',
      startingPriceCents: 5000,
      minIncrementCents: 100,
      endsAt,
    });

    const tokenA = signBidderToken('bidder-clientA');
    const tokenB = signBidderToken('bidder-clientB');

    const clientA = createClient(tokenA);
    let clientB: WebSocket | null = createClient(tokenB);

    await Promise.all([waitForOpen(clientA), waitForOpen(clientB!)]);

    // Both subscribe / sync at seq 0
    clientA.send(JSON.stringify({ type: 'sync', auction_id: auction.id, last_seq: 0 }));
    clientB!.send(JSON.stringify({ type: 'sync', auction_id: auction.id, last_seq: 0 }));

    // Wait for initial snapshots
    const snapA = await waitForMessage(clientA, (m) => m.type === 'snapshot');
    const snapB = await waitForMessage(clientB!, (m) => m.type === 'snapshot');

    expect(snapA.current_seq).toBe(0);
    expect(snapB.current_seq).toBe(0);

    // Track state on client A
    const clientAEvents: any[] = [];
    clientA.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'event') {
        clientAEvents.push(msg);
      }
    });

    // Place bid 1 via client A
    clientA.send(
      JSON.stringify({
        type: 'bid',
        auction_id: auction.id,
        amount_cents: 6000,
        idempotency_key: `reconnect-bid-1-${crypto.randomUUID()}`,
      })
    );

    // Both clients receive event 1
    const event1A = await waitForMessage(clientA, (m) => m.type === 'event' && m.seq === 1);
    const event1B = await waitForMessage(clientB!, (m) => m.type === 'event' && m.seq === 1);
    expect(event1A.payload.amount_cents).toBe(6000);
    expect(event1B.payload.amount_cents).toBe(6000);

    // Place bid 2 via client B
    clientB!.send(
      JSON.stringify({
        type: 'bid',
        auction_id: auction.id,
        amount_cents: 7000,
        idempotency_key: `reconnect-bid-2-${crypto.randomUUID()}`,
      })
    );

    const event2A = await waitForMessage(clientA, (m) => m.type === 'event' && m.seq === 2);
    const event2B = await waitForMessage(clientB!, (m) => m.type === 'event' && m.seq === 2);
    expect(event2A.payload.amount_cents).toBe(7000);
    expect(event2B.payload.amount_cents).toBe(7000);

    // KILL CLIENT B MID-STREAM!
    console.log('Simulating network crash: killing client B at seq 2...');
    clientB!.terminate();
    clientB = null;

    // Place bid 3, 4, 5 while Client B is DEAD
    clientA.send(
      JSON.stringify({
        type: 'bid',
        auction_id: auction.id,
        amount_cents: 8000,
        idempotency_key: `reconnect-bid-3-${crypto.randomUUID()}`,
      })
    );
    await waitForMessage(clientA, (m) => m.type === 'event' && m.seq === 3);

    clientA.send(
      JSON.stringify({
        type: 'bid',
        auction_id: auction.id,
        amount_cents: 9000,
        idempotency_key: `reconnect-bid-4-${crypto.randomUUID()}`,
      })
    );
    await waitForMessage(clientA, (m) => m.type === 'event' && m.seq === 4);

    clientA.send(
      JSON.stringify({
        type: 'bid',
        auction_id: auction.id,
        amount_cents: 10000,
        idempotency_key: `reconnect-bid-5-${crypto.randomUUID()}`,
      })
    );
    await waitForMessage(clientA, (m) => m.type === 'event' && m.seq === 5);

    // Now Client B reconnects with stale last_seq = 2!
    console.log('Client B reconnecting with stale last_seq = 2...');
    const reconnectedClientB = createClient(tokenB);
    await waitForOpen(reconnectedClientB);

    reconnectedClientB.send(
      JSON.stringify({
        type: 'sync',
        auction_id: auction.id,
        last_seq: 2,
      })
    );

    // Reconnected client receives sync_replay with missed events (seq 3, 4, 5)
    const replayMsg = await waitForMessage<any>(
      reconnectedClientB,
      (m) => m.type === 'sync_replay'
    );

    expect(replayMsg.from_seq).toBe(2);
    expect(replayMsg.current_seq).toBe(5);
    expect(replayMsg.events.length).toBe(3);
    expect(replayMsg.events.map((e: any) => Number(e.seq))).toEqual([3, 4, 5]);

    // Reconstruct Client B state from its initial seq 2 + replayed events
    const clientBReplayedAmounts = replayMsg.events.map((e: any) => e.payload.amount_cents);
    expect(clientBReplayedAmounts).toEqual([8000, 9000, 10000]);

    // Assert Client B converged to the IDENTICAL final state as Client A (which never disconnected)
    const clientAFinalEvent = clientAEvents[clientAEvents.length - 1];
    const clientBFinalEvent = replayMsg.events[replayMsg.events.length - 1];

    expect(clientBFinalEvent.seq).toBe(clientAFinalEvent.seq);
    expect(clientBFinalEvent.payload.amount_cents).toBe(clientAFinalEvent.payload.amount_cents);
    expect(clientBFinalEvent.payload.current_price_cents).toBe(10000);

    clientA.close();
    reconnectedClientB.close();
  });

  it('Test 6: Kill and restart the server mid-auction. State must be fully intact afterward', async () => {
    const endsAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const auction = await createAuction({
      title: 'Crash Recovery Lot',
      startingPriceCents: 2000,
      minIncrementCents: 100,
      endsAt,
    });

    const token = signBidderToken('bidder-crash');
    const client = createClient(token);
    await waitForOpen(client);

    // Place a bid before crash
    client.send(
      JSON.stringify({
        type: 'sync',
        auction_id: auction.id,
        last_seq: 0,
      })
    );
    await waitForMessage(client, (m) => m.type === 'snapshot');

    const bidKey = `crash-test-bid-${crypto.randomUUID()}`;
    client.send(
      JSON.stringify({
        type: 'bid',
        auction_id: auction.id,
        amount_cents: 3500,
        idempotency_key: bidKey,
      })
    );
    const bidResult = await waitForMessage(client, (m) => m.type === 'bid_result');
    expect(bidResult.accepted).toBe(true);
    expect(bidResult.current_price_cents).toBe(3500);

    client.close();

    console.log('Simulating SERVER CRASH mid-auction...');
    // Kill the running server instance
    await serverInstance.shutdown();

    // Verify DB still holds the state during server outage
    const dbAuction = await getAuction(auction.id);
    expect(dbAuction).not.toBeNull();
    expect(Number(dbAuction?.current_price_cents)).toBe(3500);
    expect(Number(dbAuction?.seq)).toBe(1);

    console.log('RESTARTING SERVER...');
    // Restart the server
    serverInstance = await startServer({ port: PORT, closePoolOnShutdown: false });

    // Reconnect client to restarted server
    const newClient = createClient(token);
    await waitForOpen(newClient);

    newClient.send(
      JSON.stringify({
        type: 'sync',
        auction_id: auction.id,
        last_seq: 0,
      })
    );

    const recoverySnapshot = await waitForMessage(newClient, (m) => m.type === 'snapshot');
    expect(recoverySnapshot.auction_id).toBe(auction.id);
    expect(Number(recoverySnapshot.current_seq)).toBe(1);
    expect(Number(recoverySnapshot.auction.current_price_cents)).toBe(3500);

    // Retrying the in-flight idempotency key against restarted server yields identical response
    newClient.send(
      JSON.stringify({
        type: 'bid',
        auction_id: auction.id,
        amount_cents: 3500,
        idempotency_key: bidKey,
      })
    );

    const replayResult = await waitForMessage(newClient, (m) => m.type === 'bid_result');
    expect(replayResult.idempotency_key).toBe(bidKey);
    expect(replayResult.accepted).toBe(true);
    expect(replayResult.current_price_cents).toBe(3500);
    expect(replayResult.seq).toBe(1);

    newClient.close();
  });
});
