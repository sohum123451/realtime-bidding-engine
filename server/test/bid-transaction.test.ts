import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { pool, query } from '../src/db/pool.js';
import { createAuction, getAuction, closeAuctionIfExpired } from '../src/services/auction-service.js';
import { placeBid } from '../src/services/bid-service.js';
import crypto from 'crypto';

describe('Auction Core Transactions and Concurrency', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('Test 1: 200 concurrent bids at random amounts serialize correctly with FOR UPDATE', async () => {
    // Starting price 1000 ($10.00), min_increment 100 ($1.00), ends in 5 minutes
    const endsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const auction = await createAuction({
      title: 'Rare Antique Watch - Concurrency Test',
      startingPriceCents: 1000,
      minIncrementCents: 100,
      endsAt,
    });

    const NUM_BIDS = 200;
    // Generate 200 random bid amounts between 1,100 and 20,000 cents
    const bidsData = Array.from({ length: NUM_BIDS }, (_, idx) => {
      // Intentionally generate some duplicates and some low bids to test rejection logic
      const amountCents = Math.floor(Math.random() * 15000) + 1100;
      return {
        auctionId: auction.id,
        bidderId: `bidder-${idx % 10}`,
        amountCents,
        idempotencyKey: `test1-idemp-${idx}-${crypto.randomUUID()}`,
      };
    });

    // Launch all 200 bids concurrently
    const results = await Promise.all(
      bidsData.map((b) => placeBid(b, { disableLocking: false }))
    );

    // Fetch the final auction state
    const finalAuction = await getAuction(auction.id);
    expect(finalAuction).not.toBeNull();

    // Fetch all recorded bids from database
    const bidsInDb = (
      await query(
        'SELECT * FROM bids WHERE auction_id = $1 ORDER BY created_at ASC',
        [auction.id]
      )
    ).rows;

    // Fetch all event rows from database in seq order
    const eventsInDb = (
      await query(
        'SELECT * FROM events WHERE auction_id = $1 ORDER BY seq ASC',
        [auction.id]
      )
    ).rows;

    const acceptedBids = bidsInDb.filter((b) => b.accepted);
    const rejectedBids = bidsInDb.filter((b) => !b.accepted);

    console.log(`Test 1 Stats:
      Total bids submitted: ${NUM_BIDS}
      Accepted bids: ${acceptedBids.length}
      Rejected bids: ${rejectedBids.length}
      Final price (cents): ${finalAuction?.current_price_cents}
      Final seq: ${finalAuction?.seq}
      Event count: ${eventsInDb.length}
    `);

    // Invariant 1: final price == max accepted amount
    const maxAcceptedAmount = Math.max(
      ...acceptedBids.map((b) => Number(b.amount_cents)),
      1000
    );
    expect(Number(finalAuction?.current_price_cents)).toBe(maxAcceptedAmount);

    // Invariant 2: accepted bids have strictly increasing amounts in seq order
    const acceptedEventAmounts = eventsInDb.map((e) => Number(e.payload.amount_cents));
    for (let i = 1; i < acceptedEventAmounts.length; i++) {
      expect(acceptedEventAmounts[i]).toBeGreaterThan(acceptedEventAmounts[i - 1]);
    }

    // Invariant 3: no two accepted bids share an amount
    const acceptedAmountsSet = new Set(acceptedBids.map((b) => Number(b.amount_cents)));
    expect(acceptedAmountsSet.size).toBe(acceptedBids.length);

    // Invariant 4: every rejected bid has a reason
    for (const rejected of rejectedBids) {
      expect(rejected.reject_reason).toBeTruthy();
      expect(typeof rejected.reject_reason).toBe('string');
    }

    // Invariant 5: seq is gapless and matches number of events
    expect(Number(finalAuction?.seq)).toBe(eventsInDb.length);
    eventsInDb.forEach((event, index) => {
      expect(Number(event.seq)).toBe(index + 1);
    });
  });

  it('Test 2: Without FOR UPDATE, race conditions violate invariants', async () => {
    // Create an auction
    const endsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const auction = await createAuction({
      title: 'Vulnerable Lot - No Locking Test',
      startingPriceCents: 1000,
      minIncrementCents: 100,
      endsAt,
    });

    const NUM_BIDS = 200;
    const bidsData = Array.from({ length: NUM_BIDS }, (_, idx) => {
      const amountCents = Math.floor(Math.random() * 15000) + 1100;
      return {
        auctionId: auction.id,
        bidderId: `bidder-${idx % 10}`,
        amountCents,
        idempotencyKey: `test2-idemp-${idx}-${crypto.randomUUID()}`,
      };
    });

    // Deliberately disable FOR UPDATE row locking
    const results = await Promise.allSettled(
      bidsData.map((b) => placeBid(b, { disableLocking: true }))
    );

    const finalAuction = await getAuction(auction.id);
    const bidsInDb = (
      await query(
        'SELECT * FROM bids WHERE auction_id = $1 ORDER BY created_at ASC',
        [auction.id]
      )
    ).rows;

    const eventsInDb = (
      await query(
        'SELECT * FROM events WHERE auction_id = $1 ORDER BY seq ASC',
        [auction.id]
      )
    ).rows;

    const acceptedBids = bidsInDb.filter((b) => b.accepted);
    const rejectedPromises = results.filter((r) => r.status === 'rejected');

    console.log(`Test 2 (NO LOCKING) Stats:
      Total bids attempted: ${NUM_BIDS}
      Crashed/Collided transactions: ${rejectedPromises.length}
      Accepted bids in DB: ${acceptedBids.length}
      Final price in DB: ${finalAuction?.current_price_cents}
      Final seq in DB: ${finalAuction?.seq}
      Event count in DB: ${eventsInDb.length}
    `);

    // Check invariants
    const violations: string[] = [];

    // Check if any transactions failed due to concurrent sequence or conflict
    if (rejectedPromises.length > 0) {
      violations.push(
        `${rejectedPromises.length} transactions crashed due to concurrent write collisions (e.g. events PK collision or serialization failures)`
      );
    }

    // Check strictly increasing amounts in seq order
    const eventAmounts = eventsInDb.map((e) => Number(e.payload.amount_cents));
    for (let i = 1; i < eventAmounts.length; i++) {
      if (eventAmounts[i] <= eventAmounts[i - 1]) {
        violations.push(
          `Price inversion detected: event seq ${eventsInDb[i].seq} amount ${eventAmounts[i]} is not greater than seq ${eventsInDb[i - 1].seq} amount ${eventAmounts[i - 1]}`
        );
      }
    }

    // Check if final price matches max accepted
    if (acceptedBids.length > 0) {
      const maxAccepted = Math.max(...acceptedBids.map((b) => Number(b.amount_cents)));
      if (Number(finalAuction?.current_price_cents) !== maxAccepted) {
        violations.push(
          `Final price mismatch: DB final price ${finalAuction?.current_price_cents} != max accepted amount ${maxAccepted}`
        );
      }
    }

    // Check duplicate amounts in accepted bids
    const amounts = acceptedBids.map((b) => Number(b.amount_cents));
    const duplicates = amounts.filter((item, index) => amounts.indexOf(item) !== index);
    if (duplicates.length > 0) {
      violations.push(`Duplicate amounts accepted: ${duplicates.join(', ')}`);
    }

    console.log('Test 2 Invariant Violations caught without FOR UPDATE:\n' + violations.join('\n'));

    // Assert that the test caught the race condition!
    expect(violations.length).toBeGreaterThan(0);
  });

  it('Test 3: Duplicate idempotency_key submitted 50x in parallel yields exactly one bid row', async () => {
    const endsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const auction = await createAuction({
      title: 'Idempotency Test Item',
      startingPriceCents: 1000,
      minIncrementCents: 100,
      endsAt,
    });

    const idempotencyKey = `idemp-single-key-${crypto.randomUUID()}`;
    const PARALLEL_COUNT = 50;

    // Submit the EXACT same bid 50x in parallel
    const promises = Array.from({ length: PARALLEL_COUNT }, () =>
      placeBid({
        auctionId: auction.id,
        bidderId: 'bidder-alice',
        amountCents: 2500,
        idempotencyKey,
      })
    );

    const results = await Promise.all(promises);

    // All results must be identical and accepted
    const firstResult = results[0];
    expect(firstResult.accepted).toBe(true);
    expect(firstResult.amountCents).toBe(2500);

    for (const res of results) {
      expect(res.bidId).toBe(firstResult.bidId);
      expect(res.amountCents).toBe(2500);
      expect(res.accepted).toBe(true);
    }

    // Invariant: Exactly ONE bid row exists with this idempotency key
    const bidsRes = await query(
      'SELECT * FROM bids WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    expect(bidsRes.rows.length).toBe(1);

    // Invariant: Auction seq increased by exactly 1
    const updatedAuction = await getAuction(auction.id);
    expect(Number(updatedAuction?.seq)).toBe(1);
    expect(Number(updatedAuction?.current_price_cents)).toBe(2500);
  });

  it('Test 4: Bid racing the auction close: exactly one of them wins, state stays consistent', async () => {
    // Create an auction that expires very quickly (200ms from now)
    const endsAt = new Date(Date.now() + 200).toISOString();
    const auction = await createAuction({
      title: 'Close Race Item',
      startingPriceCents: 1000,
      minIncrementCents: 100,
      endsAt,
    });

    // Wait until 150ms so we are right at the boundary
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Race placeBid vs closeAuctionIfExpired simultaneously
    const [bidResult, closeResult] = await Promise.all([
      placeBid({
        auctionId: auction.id,
        bidderId: 'bidder-closeracer',
        amountCents: 3000,
        idempotencyKey: `race-close-${crypto.randomUUID()}`,
      }),
      closeAuctionIfExpired(auction.id),
    ]);

    const finalAuction = await getAuction(auction.id);
    expect(finalAuction).not.toBeNull();

    console.log(`Test 4 Race Result:
      Bid accepted: ${bidResult.accepted} (rejectReason: ${bidResult.rejectReason})
      Close executed: ${closeResult.closed}
      Auction status: ${finalAuction?.status}
      Final ends_at: ${finalAuction?.ends_at}
    `);

    if (bidResult.accepted) {
      // The bid won the lock before the close check evaluated expiration!
      // In the same transaction, anti-sniping extended ends_at by 30s.
      // Therefore, the close check saw ends_at in the future and did not close.
      expect(closeResult.closed).toBe(false);
      expect(finalAuction?.status).toBe('open');
      expect(Number(finalAuction?.current_price_cents)).toBe(3000);
    } else {
      // The close scheduler won the lock first, marked the auction closed!
      // The bid was rejected because the auction was already closed or ended.
      expect(closeResult.closed).toBe(true);
      expect(finalAuction?.status).toBe('closed');
      expect(['auction_closed', 'auction_ended']).toContain(bidResult.rejectReason);
    }

    // In either case, the state is 100% consistent:
    // They did not both win, and neither corrupted the auction.
  });
});
