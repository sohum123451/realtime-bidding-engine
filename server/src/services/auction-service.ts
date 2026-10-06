import { getClient, query } from '../db/pool.js';
import type { Auction, AuctionEvent } from '../types/index.js';

export interface CreateAuctionInput {
  title: string;
  startsAt?: string;
  endsAt: string;
  startingPriceCents?: number;
  minIncrementCents?: number;
}

export async function createAuction(input: CreateAuctionInput): Promise<Auction> {
  const startsAt = input.startsAt || new Date().toISOString();
  const startingPrice = input.startingPriceCents ?? 0;
  const minIncrement = input.minIncrementCents ?? 100;

  const res = await query<Auction>(
    `INSERT INTO auctions (title, starts_at, ends_at, status, current_price_cents, min_increment_cents, version, seq)
     VALUES ($1, $2, $3, 'open', $4, $5, 0, 0)
     RETURNING *`,
    [input.title, startsAt, input.endsAt, startingPrice, minIncrement]
  );

  return res.rows[0];
}

export async function getAuction(id: string): Promise<Auction | null> {
  const res = await query<Auction>('SELECT * FROM auctions WHERE id = $1', [id]);
  return res.rows[0] || null;
}

export async function listAuctions(): Promise<Auction[]> {
  const res = await query<Auction>('SELECT * FROM auctions ORDER BY starts_at DESC');
  return res.rows;
}

export async function getAuctionSnapshot(id: string): Promise<{
  auction: Auction;
  recentEvents: AuctionEvent[];
} | null> {
  const auction = await getAuction(id);
  if (!auction) return null;

  const eventsRes = await query<AuctionEvent>(
    'SELECT * FROM events WHERE auction_id = $1 ORDER BY seq ASC LIMIT 100',
    [id]
  );

  return {
    auction,
    recentEvents: eventsRes.rows,
  };
}

export async function getEventsSince(
  auctionId: string,
  lastSeq: number
): Promise<AuctionEvent[]> {
  const res = await query<AuctionEvent>(
    'SELECT * FROM events WHERE auction_id = $1 AND seq > $2 ORDER BY seq ASC',
    [auctionId, lastSeq]
  );
  return res.rows;
}

export async function closeAuctionIfExpired(auctionId: string): Promise<{
  closed: boolean;
  seq?: number;
  finalPriceCents?: number;
  winnerId?: string | null;
}> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Row lock on the auction
    const res = await client.query(
      `SELECT id, status, ends_at, current_price_cents, current_winner_id, seq, version, now() as db_now
       FROM auctions
       WHERE id = $1 FOR UPDATE`,
      [auctionId]
    );

    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      return { closed: false };
    }

    const auction = res.rows[0];
    const dbNow = new Date(auction.db_now);
    const endsAt = new Date(auction.ends_at);

    if (auction.status === 'open' && dbNow >= endsAt) {
      const nextSeq = Number(auction.seq) + 1;
      const finalPrice = Number(auction.current_price_cents);
      const winnerId = auction.current_winner_id;

      await client.query(
        `UPDATE auctions
         SET status = 'closed', seq = seq + 1, version = version + 1
         WHERE id = $1`,
        [auctionId]
      );

      await client.query(
        `INSERT INTO events (auction_id, seq, type, payload, created_at)
         VALUES ($1, $2, 'auction_closed', $3, clock_timestamp())`,
        [
          auctionId,
          nextSeq,
          JSON.stringify({
            final_price_cents: finalPrice,
            winner_id: winnerId,
            closed_at: dbNow.toISOString(),
          }),
        ]
      );

      await client.query('COMMIT');

      return {
        closed: true,
        seq: nextSeq,
        finalPriceCents: finalPrice,
        winnerId,
      };
    }

    await client.query('COMMIT');
    return { closed: false };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}
