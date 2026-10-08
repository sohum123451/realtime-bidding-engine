import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, query } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { registerUser, loginUser, seedDefaultUsers } from '../src/services/user-service.js';
import {
  listItems,
  getNextItem,
  setNextItem,
  createItem,
  launchNextItem,
  seedDefaultCatalog,
} from '../src/services/catalog-service.js';
import { manuallyCloseAuction, extendAuction } from '../src/services/auction-service.js';

describe('User Authentication & Admin Catalog Management', () => {
  beforeAll(async () => {
    await runMigrations();
    await seedDefaultUsers();
    await seedDefaultCatalog();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('Test 1: User Registration, Password Verification & Login', async () => {
    const testUsername = `collector_${Date.now()}`;
    const testEmail = `${testUsername}@gallery.co.uk`;

    const registered = await registerUser({
      username: testUsername,
      email: testEmail,
      password: 'RoyalPassword789!',
      role: 'bidder',
      paddleNumber: '42',
    });

    expect(registered.user.id).toBeDefined();
    expect(registered.user.username).toBe(testUsername);
    expect(registered.token).toBeDefined();

    // Verify successful login
    const loginSuccess = await loginUser(testEmail, 'RoyalPassword789!');
    expect(loginSuccess).not.toBeNull();
    expect(loginSuccess?.user.username).toBe(testUsername);
    expect(loginSuccess?.token).toBeDefined();

    // Verify failed login with bad password
    const loginFail = await loginUser(testEmail, 'WrongPassword!');
    expect(loginFail).toBeNull();
  });

  it('Test 2: Admin Item Catalog & "Which Item is Next" Workflow', async () => {
    const items = await listItems();
    expect(items.length).toBeGreaterThanOrEqual(2);

    // Initial check: find next item
    const initialNext = await getNextItem();
    expect(initialNext).not.toBeNull();

    // Create a new master lot
    const newLot = await createItem({
      lotNumber: '199',
      title: 'Fabergé Imperial Coronation Egg (1897)',
      description: 'Gold, translucent lime yellow enamel, rose-cut diamonds and velvet interior by Henrik Wigström.',
      category: 'Imperial Antiquities',
      startingPriceCents: 25000000,
      minIncrementCents: 1000000,
      durationSeconds: 900,
    });

    expect(newLot.lot_number).toBe('199');
    expect(newLot.is_next).toBe(false);

    // Designate this lot as NEXT
    const updated = await setNextItem(newLot.id);
    expect(updated?.is_next).toBe(true);

    const currentNext = await getNextItem();
    expect(currentNext?.id).toBe(newLot.id);
    expect(currentNext?.lot_number).toBe('199');
  });

  it('Test 3: Launching Designated Next Item on the Auction Block', async () => {
    const nextBefore = await getNextItem();
    expect(nextBefore).not.toBeNull();

    const { auction, item } = await launchNextItem();
    expect(auction.id).toBeDefined();
    expect(auction.status).toBe('open');
    expect(item.id).toBe(nextBefore!.id);

    // Item should now be live
    const itemInDb = await query('SELECT * FROM items WHERE id = $1', [item.id]);
    expect(itemInDb.rows[0].status).toBe('live');
    expect(itemInDb.rows[0].is_next).toBe(false);

    // Admin time extension (+120s)
    const extendRes = await extendAuction(auction.id, 120);
    expect(extendRes.extended).toBe(true);
    expect(extendRes.endsAt).toBeDefined();

    // Admin gavel hammer down (manual auction close)
    const closeRes = await manuallyCloseAuction(auction.id);
    expect(closeRes.closed).toBe(true);

    const closedAuction = await query('SELECT status FROM auctions WHERE id = $1', [auction.id]);
    expect(closedAuction.rows[0].status).toBe('closed');
  });
});
