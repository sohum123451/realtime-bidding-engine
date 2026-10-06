import { runMigrations } from '../src/db/migrate.js';
import { pool, query } from '../src/db/pool.js';
import { createAuction } from '../src/services/auction-service.js';
import { signBidderToken } from '../src/auth/token.js';

export const SEED_BIDDERS = [
  { id: 'bidder-1', name: 'Alice (Seat 1)', seatIndex: 0, color: '#f59e0b' },
  { id: 'bidder-2', name: 'Bob (Seat 2)', seatIndex: 1, color: '#10b981' },
  { id: 'bidder-3', name: 'Claire (Seat 3)', seatIndex: 2, color: '#ef4444' },
  { id: 'bidder-4', name: 'David (Seat 4)', seatIndex: 3, color: '#06b6d4' },
  { id: 'bidder-5', name: 'Elena (Seat 5)', seatIndex: 4, color: '#8b5cf6' },
  { id: 'bidder-6', name: 'Felix (Seat 6)', seatIndex: 5, color: '#ec4899' },
];

export async function runSeed() {
  await runMigrations();

  console.log('--- SEEDING AUCTION DATABASE ---');

  // Check if active auctions exist
  const existing = await query('SELECT id, title FROM auctions WHERE status = $1', ['open']);
  let auctionId: string;

  if (existing.rows.length > 0) {
    auctionId = existing.rows[0].id;
    console.log(`Using existing open auction: ${existing.rows[0].title} (${auctionId})`);
  } else {
    const endsAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const auction = await createAuction({
      title: 'Lot #101: 18th-Century Celestial Orrery',
      startingPriceCents: 5000, // $50.00
      minIncrementCents: 500, // $5.00
      endsAt,
    });
    auctionId = auction.id;
    console.log(`Created new live auction: "${auction.title}" [ID: ${auctionId}]`);
  }

  console.log('\n--- SEED BIDDERS & SIGNED TOKENS ---');
  for (const b of SEED_BIDDERS) {
    const token = signBidderToken(b.id);
    console.log(`${b.name}:`);
    console.log(`  Bidder ID : ${b.id}`);
    console.log(`  Color     : ${b.color}`);
    console.log(`  Token     : ${token}`);
    console.log(
      `  cURL Test : curl -X POST http://localhost:3000/auctions/${auctionId}/bids -H "Content-Type: application/json" -H "x-bidder-token: ${token}" -d '{"amount_cents": 5500, "idempotency_key": "test-${b.id}-1"}'\n`
    );
  }

  return { auctionId, bidders: SEED_BIDDERS };
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  runSeed()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}
