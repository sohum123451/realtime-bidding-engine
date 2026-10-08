import { query, getClient } from '../db/pool.js';
import type { Item, Auction } from '../types/index.js';

export interface CreateItemInput {
  lotNumber: string;
  title: string;
  description: string;
  category?: string;
  estimatedPriceCents?: number;
  startingPriceCents?: number;
  reservePriceCents?: number;
  minIncrementCents?: number;
  durationSeconds?: number;
  imageUrl?: string;
}

export async function listItems(): Promise<Item[]> {
  const res = await query<Item>(
    `SELECT id, lot_number, title, description, category,
            estimated_price_cents, starting_price_cents, reserve_price_cents,
            min_increment_cents, duration_seconds, image_url, is_next, status, created_at
     FROM items
     ORDER BY lot_number ASC`
  );
  return res.rows;
}

export async function getItem(id: string): Promise<Item | null> {
  const res = await query<Item>(
    `SELECT * FROM items WHERE id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

export async function getNextItem(): Promise<Item | null> {
  const res = await query<Item>(
    `SELECT * FROM items WHERE is_next = true LIMIT 1`
  );
  if (res.rows.length > 0) {
    return res.rows[0];
  }
  // Fallback: next catalog or queued item
  const fallback = await query<Item>(
    `SELECT * FROM items WHERE status IN ('catalog', 'queued') ORDER BY lot_number ASC LIMIT 1`
  );
  return fallback.rows[0] || null;
}

export async function setNextItem(id: string): Promise<Item | null> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE items SET is_next = false WHERE is_next = true`);
    const updateRes = await client.query<Item>(
      `UPDATE items SET is_next = true, status = CASE WHEN status = 'catalog' THEN 'queued' ELSE status END
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    await client.query('COMMIT');
    return updateRes.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function createItem(input: CreateItemInput): Promise<Item> {
  const res = await query<Item>(
    `INSERT INTO items (
       lot_number, title, description, category,
       estimated_price_cents, starting_price_cents, reserve_price_cents,
       min_increment_cents, duration_seconds, image_url, is_next, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, 'catalog')
     RETURNING *`,
    [
      input.lotNumber,
      input.title,
      input.description,
      input.category || 'Fine Art',
      input.estimatedPriceCents ?? 100000,
      input.startingPriceCents ?? 5000,
      input.reservePriceCents ?? 0,
      input.minIncrementCents ?? 500,
      input.durationSeconds ?? 900,
      input.imageUrl || null,
    ]
  );
  return res.rows[0];
}

export async function launchNextItem(overrideItemId?: string): Promise<{ auction: Auction; item: Item }> {
  let targetItem: Item | null = null;

  if (overrideItemId) {
    targetItem = await getItem(overrideItemId);
  } else {
    targetItem = await getNextItem();
  }

  if (!targetItem) {
    throw new Error('No item available to launch on the auction block');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Close any currently open auction
    const openAuctions = await client.query(
      `SELECT id, seq, current_price_cents, current_winner_id FROM auctions WHERE status = 'open' FOR UPDATE`
    );

    for (const a of openAuctions.rows) {
      const nextSeq = Number(a.seq) + 1;
      await client.query(
        `UPDATE auctions SET status = 'closed', seq = seq + 1, version = version + 1 WHERE id = $1`,
        [a.id]
      );
      await client.query(
        `INSERT INTO events (auction_id, seq, type, payload, created_at)
         VALUES ($1, $2, 'auction_closed', $3, clock_timestamp())`,
        [
          a.id,
          nextSeq,
          JSON.stringify({
            final_price_cents: Number(a.current_price_cents),
            winner_id: a.current_winner_id,
            reason: 'next_lot_introduced',
          }),
        ]
      );
    }

    // 2. Mark previous live items as completed/sold
    await client.query(
      `UPDATE items SET status = 'completed' WHERE status = 'live'`
    );

    // 3. Set current item to live and unset is_next
    await client.query(
      `UPDATE items SET status = 'live', is_next = false WHERE id = $1`,
      [targetItem.id]
    );

    // 4. Calculate duration and end time
    const duration = targetItem.duration_seconds || 900;
    const startsAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + duration * 1000).toISOString();

    // 5. Create new live auction in DB
    const auctionRes = await client.query<Auction>(
      `INSERT INTO auctions (
         title, starts_at, ends_at, status, current_price_cents,
         min_increment_cents, version, seq, item_id
       )
       VALUES ($1, $2, $3, 'open', $4, $5, 0, 0, $6)
       RETURNING *`,
      [
        `Lot #${targetItem.lot_number}: ${targetItem.title}`,
        startsAt,
        endsAt,
        targetItem.starting_price_cents,
        targetItem.min_increment_cents,
        targetItem.id,
      ]
    );

    const newAuction = auctionRes.rows[0];

    // 6. Record lot started event
    await client.query(
      `INSERT INTO events (auction_id, seq, type, payload, created_at)
       VALUES ($1, 0, 'lot_started', $2, clock_timestamp())`,
      [
        newAuction.id,
        JSON.stringify({
          lot_number: targetItem.lot_number,
          title: targetItem.title,
          starting_price_cents: targetItem.starting_price_cents,
          estimated_price_cents: targetItem.estimated_price_cents,
          ends_at: endsAt,
        }),
      ]
    );

    // 7. Auto-designate the next catalog item as next up
    const nextInLine = await client.query<Item>(
      `SELECT id FROM items WHERE status = 'catalog' ORDER BY lot_number ASC LIMIT 1`
    );
    if (nextInLine.rows.length > 0) {
      await client.query(
        `UPDATE items SET is_next = true, status = 'queued' WHERE id = $1`,
        [nextInLine.rows[0].id]
      );
    }

    await client.query('COMMIT');

    return { auction: newAuction, item: targetItem };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function seedDefaultCatalog(): Promise<void> {
  const check = await query('SELECT COUNT(*) as count FROM items');
  if (Number(check.rows[0].count) > 0) {
    return;
  }

  console.log("Seeding Sohum's Master Catalog Items...");

  const catalog = [
    {
      lotNumber: '101',
      title: '18th-Century Celestial Orrery',
      description: 'Astronomical brass mechanical model of the solar system handcrafted by George Adams, Fleet Street, London, circa 1774.',
      category: 'Scientific Antiquities',
      estimatedPriceCents: 2500000, // $25,000
      startingPriceCents: 5000,    // $50.00
      reservePriceCents: 1500000,
      minIncrementCents: 500,     // $5.00
      durationSeconds: 1500,      // 25 mins
      imageUrl: '/assets/orrery.jpg',
      status: 'live' as const,
      isNext: false,
    },
    {
      lotNumber: '102',
      title: '1962 Ferrari 250 GTO Scaglietti',
      description: 'Chassis #3413GT in Rosso Corsa. 3.0-liter Tipo 168/62 Colombo V12 engine. Triple Targa Florio victor.',
      category: 'Collector Automobiles',
      estimatedPriceCents: 4500000000, // $45,000,000
      startingPriceCents: 1000000000, // $10,000,000
      reservePriceCents: 3500000000,
      minIncrementCents: 50000000,    // $500,000
      durationSeconds: 1800,
      imageUrl: '/assets/ferrari.jpg',
      status: 'queued' as const,
      isNext: true, // NEXT ITEM
    },
    {
      lotNumber: '103',
      title: 'Patek Philippe Grandmaster Chime Ref. 6300G',
      description: 'White gold double-faced wristwatch featuring 20 complications, reversible case, and grand sonnerie strike work.',
      category: 'Haute Horlogerie',
      estimatedPriceCents: 550000000, // $5,500,000
      startingPriceCents: 200000000,  // $2,000,000
      reservePriceCents: 400000000,
      minIncrementCents: 10000000,    // $100,000
      durationSeconds: 1200,
      imageUrl: '/assets/patek.jpg',
      status: 'catalog' as const,
      isNext: false,
    },
    {
      lotNumber: '104',
      title: 'Imperial Ming Dynasty Blue & White Dragon Vase',
      description: 'Yongle period (1403-1424), underglaze cobalt blue painting of five-clawed imperial dragons among clouds.',
      category: 'Chinese Imperial Art',
      estimatedPriceCents: 1200000000, // $12,000,000
      startingPriceCents: 400000000,   // $4,000,000
      reservePriceCents: 900000000,
      minIncrementCents: 25000000,     // $250,000
      durationSeconds: 1500,
      imageUrl: '/assets/vase.jpg',
      status: 'catalog' as const,
      isNext: false,
    },
    {
      lotNumber: '105',
      title: 'Composition with Red, Blue and Yellow (1930)',
      description: 'Piet Mondrian oil on canvas, geometric neoplasticism composition from Parisian studio pinnacle.',
      category: 'Modern Masters',
      estimatedPriceCents: 5000000000, // $50,000,000
      startingPriceCents: 1500000000,  // $15,000,000
      reservePriceCents: 4200000000,
      minIncrementCents: 50000000,     // $500,000
      durationSeconds: 1800,
      imageUrl: '/assets/mondrian.jpg',
      status: 'catalog' as const,
      isNext: false,
    },
  ];

  for (const item of catalog) {
    await query(
      `INSERT INTO items (
         lot_number, title, description, category,
         estimated_price_cents, starting_price_cents, reserve_price_cents,
         min_increment_cents, duration_seconds, image_url, is_next, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        item.lotNumber,
        item.title,
        item.description,
        item.category,
        item.estimatedPriceCents,
        item.startingPriceCents,
        item.reservePriceCents,
        item.minIncrementCents,
        item.durationSeconds,
        item.imageUrl,
        item.isNext,
        item.status,
      ]
    );
  }
}
