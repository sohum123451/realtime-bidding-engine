import WebSocket from 'ws';
import crypto from 'crypto';
import { runMigrations } from '../src/db/migrate.js';
import { pool, query } from '../src/db/pool.js';
import { createAuction, getAuction } from '../src/services/auction-service.js';
import { signBidderToken } from '../src/auth/token.js';

interface ChaosBot {
  id: string;
  token: string;
  socket: WebSocket | null;
  localSeq: number;
  lastKnownPrice: number;
  inFlightBidKey: string | null;
  inFlightAmount: number | null;
  bidsAttempted: number;
  disconnectCount: number;
}

const SERVER_HOST = process.env.HOST || '127.0.0.1';
const SERVER_PORT = Number(process.env.PORT) || 3000;
const WS_URL = `ws://${SERVER_HOST}:${SERVER_PORT}/ws`;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runChaos(numBots = 8, runDurationMs = 12000) {
  await runMigrations();

  console.log('====================================================');
  console.log('   STARTING CHAOS INJECTION & CONCURRENCY TEST      ');
  console.log('====================================================');
  console.log(`Target WS: ${WS_URL}`);
  console.log(`Active Bots: ${numBots} bots`);
  console.log(`Duration: ${runDurationMs / 1000}s\n`);

  // Create dedicated chaos auction lot
  const endsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const auction = await createAuction({
    title: 'Chaos Stress Lot: Kinetic Sculpture',
    startingPriceCents: 1000,
    minIncrementCents: 100,
    endsAt,
  });

  console.log(`Auction lot created: ${auction.id} (Starting: $10.00)\n`);

  // Initialize Bots
  const bots: ChaosBot[] = Array.from({ length: numBots }, (_, idx) => {
    const id = `chaos-bot-${idx + 1}`;
    return {
      id,
      token: signBidderToken(id),
      socket: null,
      localSeq: 0,
      lastKnownPrice: 1000,
      inFlightBidKey: null,
      inFlightAmount: null,
      bidsAttempted: 0,
      disconnectCount: 0,
    };
  });

  let running = true;

  function connectBot(bot: ChaosBot): Promise<void> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`${WS_URL}?token=${bot.token}`);
      bot.socket = ws;

      ws.on('open', () => {
        // Upon connect or reconnect, send sync with last known seq
        ws.send(
          JSON.stringify({
            type: 'sync',
            auction_id: auction.id,
            last_seq: bot.localSeq,
          })
        );
        resolve();
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'snapshot') {
            bot.localSeq = msg.current_seq;
            bot.lastKnownPrice = Number(msg.auction.current_price_cents);
          } else if (msg.type === 'sync_replay') {
            bot.localSeq = msg.current_seq;
            if (msg.events && msg.events.length > 0) {
              const lastEvt = msg.events[msg.events.length - 1];
              bot.lastKnownPrice = Number(lastEvt.payload.current_price_cents);
            }
          } else if (msg.type === 'event') {
            if (msg.seq > bot.localSeq) {
              bot.localSeq = msg.seq;
              bot.lastKnownPrice = Number(msg.payload.current_price_cents);
            }
          } else if (msg.type === 'bid_result') {
            if (msg.idempotency_key === bot.inFlightBidKey) {
              bot.inFlightBidKey = null;
              bot.inFlightAmount = null;
            }
          }
        } catch {
          // ignore
        }
      });

      ws.on('close', () => {
        bot.socket = null;
      });

      ws.on('error', () => {
        bot.socket = null;
        resolve();
      });
    });
  }

  // Connect all bots initially
  await Promise.all(bots.map((b) => connectBot(b)));
  console.log(`All ${numBots} bots connected and synchronized.\n`);

  // Start chaos worker per bot
  const botWorkers = bots.map(async (bot) => {
    while (running) {
      const delay = Math.floor(Math.random() * 120) + 40;
      await sleep(delay);
      if (!running) break;

      // 15% chance to abruptly drop connection (chaos drop)
      if (Math.random() < 0.15 && bot.socket && bot.socket.readyState === WebSocket.OPEN) {
        bot.disconnectCount++;
        bot.socket.terminate();
        bot.socket = null;
        // Wait random backoff before reconnecting
        await sleep(Math.floor(Math.random() * 200) + 50);
        if (running) {
          await connectBot(bot);
        }
        continue;
      }

      // If disconnected, reconnect
      if (!bot.socket || bot.socket.readyState !== WebSocket.OPEN) {
        await connectBot(bot);
        continue;
      }

      // Place a bid (or retry in-flight bid if dropped during transit)
      let idempotencyKey: string;
      let amountCents: number;

      if (bot.inFlightBidKey && bot.inFlightAmount) {
        // Retry existing in-flight bid with SAME idempotency key
        idempotencyKey = bot.inFlightBidKey;
        amountCents = bot.inFlightAmount;
      } else {
        // New bid
        idempotencyKey = `chaos-${bot.id}-${crypto.randomUUID()}`;
        // Bid higher than last known price + min increment, with random variation
        const increment = (Math.floor(Math.random() * 10) + 1) * 100;
        amountCents = bot.lastKnownPrice + increment;
        bot.inFlightBidKey = idempotencyKey;
        bot.inFlightAmount = amountCents;
      }

      bot.bidsAttempted++;
      try {
        bot.socket.send(
          JSON.stringify({
            type: 'bid',
            auction_id: auction.id,
            amount_cents: amountCents,
            idempotency_key: idempotencyKey,
          })
        );
      } catch {
        // Socket error during send will be handled on next loop
      }
    }
  });

  // Run chaos for runDurationMs
  await sleep(runDurationMs);
  running = false;
  console.log('Chaos period ended. Gracefully draining and synchronizing final state...');

  await Promise.all(botWorkers);

  // Re-sync all bots one last time to test convergence
  for (const bot of bots) {
    if (!bot.socket || bot.socket.readyState !== WebSocket.OPEN) {
      await connectBot(bot);
    } else {
      bot.socket.send(
        JSON.stringify({
          type: 'sync',
          auction_id: auction.id,
          last_seq: bot.localSeq,
        })
      );
    }
  }

  await sleep(2000);

  // Close all bot sockets
  for (const bot of bots) {
    if (bot.socket) {
      bot.socket.close();
    }
  }

  // ================= INVARIANTS CHECK =================
  console.log('\n====================================================');
  console.log('             DATABASE INVARIANTS CHECK              ');
  console.log('====================================================');

  const finalAuction = await getAuction(auction.id);
  const bidsInDb = (
    await query('SELECT * FROM bids WHERE auction_id = $1 ORDER BY created_at ASC', [
      auction.id,
    ])
  ).rows;
  const eventsInDb = (
    await query('SELECT * FROM events WHERE auction_id = $1 ORDER BY seq ASC', [
      auction.id,
    ])
  ).rows;

  const acceptedBids = bidsInDb.filter((b) => b.accepted);
  const rejectedBids = bidsInDb.filter((b) => !b.accepted);

  const totalAttempted = bots.reduce((sum, b) => sum + b.bidsAttempted, 0);
  const totalDisconnects = bots.reduce((sum, b) => sum + b.disconnectCount, 0);

  console.log(`Execution Telemetry:
  - Total Chaos Disconnects Simulated : ${totalDisconnects}
  - Total Bids Sent by Bots           : ${totalAttempted}
  - Unique Bids Persisted in DB       : ${bidsInDb.length}
  - Bids Accepted                     : ${acceptedBids.length}
  - Bids Rejected                     : ${rejectedBids.length}
  - Final Database Seq                : ${finalAuction?.seq}
  - Final Database Price              : $${(Number(finalAuction?.current_price_cents) / 100).toFixed(2)} (${finalAuction?.current_price_cents} cents)
  `);

  const checks: { name: string; passed: boolean; details: string }[] = [];

  // Invariant 1: Final price == max accepted amount
  const maxAccepted = Math.max(
    ...acceptedBids.map((b) => Number(b.amount_cents)),
    1000
  );
  const priceMatchesMax = Number(finalAuction?.current_price_cents) === maxAccepted;
  checks.push({
    name: 'Final price == max accepted amount',
    passed: priceMatchesMax,
    details: `DB Price: ${finalAuction?.current_price_cents} | Max Accepted: ${maxAccepted}`,
  });

  // Invariant 2: Accepted bids strictly increasing in seq order
  let strictlyIncreasing = true;
  let inversionDetail = 'None';
  const eventAmounts = eventsInDb.map((e) => Number(e.payload.amount_cents));
  for (let i = 1; i < eventAmounts.length; i++) {
    if (eventAmounts[i] <= eventAmounts[i - 1]) {
      strictlyIncreasing = false;
      inversionDetail = `Seq ${eventsInDb[i].seq} ($${eventAmounts[i]}) <= Seq ${eventsInDb[i - 1].seq} ($${eventAmounts[i - 1]})`;
      break;
    }
  }
  checks.push({
    name: 'Accepted bids strictly increasing in seq order',
    passed: strictlyIncreasing,
    details: inversionDetail,
  });

  // Invariant 3: No two accepted bids share an amount
  const acceptedAmounts = acceptedBids.map((b) => Number(b.amount_cents));
  const uniqueAcceptedAmounts = new Set(acceptedAmounts);
  const noDuplicates = uniqueAcceptedAmounts.size === acceptedAmounts.length;
  checks.push({
    name: 'No two accepted bids share an amount',
    passed: noDuplicates,
    details: `Accepted count: ${acceptedAmounts.length} | Unique: ${uniqueAcceptedAmounts.size}`,
  });

  // Invariant 4: Every rejected bid has a reason
  const allRejectedHaveReason = rejectedBids.every(
    (b) => typeof b.reject_reason === 'string' && b.reject_reason.length > 0
  );
  checks.push({
    name: 'Every rejected bid has a reason',
    passed: allRejectedHaveReason,
    details: `Rejected count: ${rejectedBids.length} | All reasoned: ${allRejectedHaveReason}`,
  });

  // Invariant 5: Gapless seq log
  let gapless = true;
  for (let i = 0; i < eventsInDb.length; i++) {
    if (Number(eventsInDb[i].seq) !== i + 1) {
      gapless = false;
      break;
    }
  }
  checks.push({
    name: 'Event log sequence is strictly gapless (1..N)',
    passed: gapless && Number(finalAuction?.seq) === eventsInDb.length,
    details: `Event rows: ${eventsInDb.length} | Auction Seq: ${finalAuction?.seq}`,
  });

  // Invariant 6: All bots converged to the final seq
  const allConverged = bots.every((b) => b.localSeq === Number(finalAuction?.seq));
  checks.push({
    name: 'All disconnected/reconnected bots converged to identical final state',
    passed: allConverged,
    details: `Bots synced to seq ${finalAuction?.seq}: ${bots.filter((b) => b.localSeq === Number(finalAuction?.seq)).length}/${numBots}`,
  });

  console.log('RESULTS:');
  for (const c of checks) {
    const status = c.passed ? '[PASS]' : '[FAIL]';
    console.log(`  ${status} ${c.name} -> ${c.details}`);
  }

  const allPassed = checks.every((c) => c.passed);
  console.log('\n====================================================');
  if (allPassed) {
    console.log('  SUCCESS: ALL CONCURRENCY & CHAOS INVARIANTS HELD!  ');
  } else {
    console.log('  FAILURE: INVARIANTS VIOLATED DURING CHAOS RUN!    ');
  }
  console.log('====================================================\n');

  return { allPassed, checks };
}

if (process.argv[1]?.endsWith('chaos.ts') || process.argv[1]?.endsWith('chaos.js')) {
  runChaos()
    .then((res) => {
      pool.end();
      process.exit(res.allPassed ? 0 : 1);
    })
    .catch((err) => {
      console.error('Chaos error:', err);
      pool.end();
      process.exit(1);
    });
}
