import { getClient } from '../db/pool.js';
import type { BidResult, PlaceBidParams, PlaceBidOptions } from '../types/index.js';

export async function placeBid(
  params: PlaceBidParams,
  options?: PlaceBidOptions
): Promise<BidResult> {
  const { auctionId, bidderId, amountCents, idempotencyKey } = params;

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('amountCents must be a positive integer');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Lock the auction row (unless deliberately disabled for race demonstration)
    const lockClause = options?.disableLocking ? '' : 'FOR UPDATE';
    const auctionRes = await client.query(
      `SELECT id, title, starts_at, ends_at, status, current_price_cents,
              current_winner_id, min_increment_cents, version, seq, now() as db_now
       FROM auctions
       WHERE id = $1 ${lockClause}`,
      [auctionId]
    );

    if (auctionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error(`Auction ${auctionId} not found`);
    }

    const auction = auctionRes.rows[0];

    // 2. Check Idempotency: Has this key already been submitted?
    const existingBidRes = await client.query(
      `SELECT id, auction_id, bidder_id, amount_cents, idempotency_key, accepted, reject_reason, created_at
       FROM bids
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (existingBidRes.rows.length > 0) {
      const existing = existingBidRes.rows[0];
      await client.query('COMMIT');
      return {
        bidId: existing.id,
        auctionId: existing.auction_id,
        bidderId: existing.bidder_id,
        amountCents: Number(existing.amount_cents),
        accepted: existing.accepted,
        rejectReason: existing.reject_reason,
        currentPriceCents: Number(auction.current_price_cents),
        seq: Number(auction.seq),
        endsAt: auction.ends_at.toISOString ? auction.ends_at.toISOString() : auction.ends_at,
        isIdempotentReplay: true,
      };
    }

    const dbNow = new Date(auction.db_now);
    const startsAt = new Date(auction.starts_at);
    const endsAt = new Date(auction.ends_at);
    const currentPriceCents = Number(auction.current_price_cents);
    const minIncrementCents = Number(auction.min_increment_cents);

    // 3. Validation using DB Clock
    let rejectReason: string | null = null;

    if (auction.status !== 'open') {
      rejectReason = 'auction_closed';
    } else if (dbNow >= endsAt) {
      rejectReason = 'auction_ended';
    } else if (dbNow < startsAt) {
      rejectReason = 'auction_not_started';
    } else if (auction.current_winner_id && (
      auction.current_winner_id === bidderId ||
      auction.current_winner_id.toLowerCase() === bidderId.toLowerCase()
    )) {
      rejectReason = 'already_highest_bidder';
    } else if (amountCents < currentPriceCents + minIncrementCents) {
      rejectReason = 'too_low';
    }

    if (rejectReason !== null) {
      // Record rejected bid with idempotency key
      const insertBidRes = await client.query(
        `INSERT INTO bids (id, auction_id, bidder_id, amount_cents, idempotency_key, accepted, reject_reason, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, false, $5, clock_timestamp())
         ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING id`,
        [auctionId, bidderId, amountCents, idempotencyKey, rejectReason]
      );

      await client.query('COMMIT');

      return {
        bidId: insertBidRes.rows[0].id,
        auctionId,
        bidderId,
        amountCents,
        accepted: false,
        rejectReason,
        currentPriceCents,
        seq: Number(auction.seq),
        endsAt: auction.ends_at.toISOString ? auction.ends_at.toISOString() : auction.ends_at,
      };
    }

    // 4. Bid Accepted: No automatic anti-sniping extension
    const newEndsAt = endsAt;
    const isExtended = false;

    // Update auction
    const updateRes = await client.query(
      `UPDATE auctions
       SET current_price_cents = $1,
           current_winner_id = $2,
           version = version + 1,
           seq = seq + 1,
           ends_at = $3
       WHERE id = $4
       RETURNING id, current_price_cents, version, seq, ends_at`,
      [amountCents, bidderId, newEndsAt.toISOString(), auctionId]
    );

    const updatedAuction = updateRes.rows[0];

    // Insert accepted bid
    const insertBidRes = await client.query(
      `INSERT INTO bids (id, auction_id, bidder_id, amount_cents, idempotency_key, accepted, reject_reason, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, true, NULL, clock_timestamp())
       RETURNING id`,
      [auctionId, bidderId, amountCents, idempotencyKey]
    );

    const bidId = insertBidRes.rows[0].id;

    // Insert event row into append-only events log
    await client.query(
      `INSERT INTO events (auction_id, seq, type, payload, created_at)
       VALUES ($1, $2, 'bid_accepted', $3, clock_timestamp())`,
      [
        auctionId,
        Number(updatedAuction.seq),
        JSON.stringify({
          bid_id: bidId,
          bidder_id: bidderId,
          amount_cents: amountCents,
          previous_price_cents: currentPriceCents,
          current_price_cents: amountCents,
          ends_at: updatedAuction.ends_at.toISOString
            ? updatedAuction.ends_at.toISOString()
            : updatedAuction.ends_at,
          extended: isExtended,
        }),
      ]
    );

    await client.query('COMMIT');

    return {
      bidId,
      auctionId,
      bidderId,
      amountCents,
      accepted: true,
      rejectReason: null,
      currentPriceCents: amountCents,
      seq: Number(updatedAuction.seq),
      endsAt: updatedAuction.ends_at.toISOString
        ? updatedAuction.ends_at.toISOString()
        : updatedAuction.ends_at,
    };
  } catch (err: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // rollback err ignored
    }

    // In case of parallel unique constraint hit on idempotency_key
    if (err.code === '23505' && err.constraint === 'bids_idempotency_key_key') {
      const replayClient = await getClient();
      try {
        const existing = await replayClient.query(
          `SELECT b.*, a.current_price_cents, a.seq, a.ends_at
           FROM bids b
           JOIN auctions a ON a.id = b.auction_id
           WHERE b.idempotency_key = $1`,
          [idempotencyKey]
        );
        if (existing.rows.length > 0) {
          const row = existing.rows[0];
          return {
            bidId: row.id,
            auctionId: row.auction_id,
            bidderId: row.bidder_id,
            amountCents: Number(row.amount_cents),
            accepted: row.accepted,
            rejectReason: row.reject_reason,
            currentPriceCents: Number(row.current_price_cents),
            seq: Number(row.seq),
            endsAt: row.ends_at.toISOString ? row.ends_at.toISOString() : row.ends_at,
            isIdempotentReplay: true,
          };
        }
      } finally {
        replayClient.release();
      }
    }

    throw err;
  } finally {
    client.release();
  }
}
