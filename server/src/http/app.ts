import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createAuction,
  getAuctionSnapshot,
  listAuctions,
  manuallyCloseAuction,
  extendAuction,
} from '../services/auction-service.js';
import { placeBid } from '../services/bid-service.js';
import {
  signBidderToken,
  verifyBidderToken,
  verifyUserToken,
} from '../auth/token.js';
import {
  registerUser,
  loginUser,
  getUserById,
  listUsers,
} from '../services/user-service.js';
import {
  listItems,
  getNextItem,
  setNextItem,
  createItem,
  launchNextItem,
} from '../services/catalog-service.js';
import { query } from '../db/pool.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  // CORS headers so Vite client can call API directly
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-bidder-token');
    if (req.method === 'OPTIONS') {
      reply.status(204).send();
    }
  });

  // Health check
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Helper to extract verified token from request
  function getRequestUser(req: any) {
    const authHeader = req.headers['authorization'];
    const customHeader = req.headers['x-bidder-token'];
    const queryToken = (req.query as { token?: string })?.token;
    const token = (authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null) || customHeader || queryToken;
    if (!token) return null;
    return verifyUserToken(token);
  }

  // --- AUTH ROUTES ---

  // Legacy/Compatibility auth token helper
  app.get('/auth/token', async (req, reply) => {
    const { bidder_id } = req.query as { bidder_id?: string };
    if (!bidder_id) {
      return reply.status(400).send({ error: 'bidder_id query parameter required' });
    }
    const token = signBidderToken(bidder_id);
    return { bidder_id, token };
  });

  // POST /auth/register
  const RegisterSchema = z.object({
    username: z.string().min(2).max(30),
    email: z.string().email(),
    password: z.string().min(4),
    role: z.enum(['bidder', 'admin']).optional(),
    paddleNumber: z.string().optional(),
    avatarColor: z.string().optional(),
    seatIndex: z.number().int().min(-1).max(10).optional(),
  });

  app.post('/auth/register', async (req, reply) => {
    const parse = RegisterSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.message });
    }
    try {
      const result = await registerUser(parse.data);
      return reply.status(201).send(result);
    } catch (err: any) {
      if (err.message?.includes('duplicate key') || err.code === '23505') {
        return reply.status(409).send({ error: 'Username or email already exists' });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /auth/login
  const LoginSchema = z.object({
    identifier: z.string().min(1),
    password: z.string().min(1),
  });

  app.post('/auth/login', async (req, reply) => {
    const parse = LoginSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.message });
    }
    const result = await loginUser(parse.data.identifier, parse.data.password);
    if (!result) {
      return reply.status(401).send({ error: 'Invalid username/email or password' });
    }
    return reply.status(200).send(result);
  });

  // GET /auth/me
  app.get('/auth/me', async (req, reply) => {
    const userPayload = getRequestUser(req);
    if (!userPayload) {
      return reply.status(401).send({ error: 'Unauthorized or token invalid' });
    }
    const user = await getUserById(userPayload.userId);
    if (!user) {
      // Fallback to token payload if user row not in table
      return reply.send({
        user: {
          id: userPayload.userId,
          username: userPayload.username,
          email: userPayload.email,
          role: userPayload.role,
          paddle_number: userPayload.paddleNumber,
          avatar_color: userPayload.avatarColor,
          seat_index: userPayload.seatIndex,
          balance_cents: 10000000,
        },
      });
    }
    return reply.send({ user });
  });

  // GET /auth/users (VIP catalog for fast seat / account switcher)
  app.get('/auth/users', async () => {
    const users = await listUsers();
    return { users };
  });

  // --- CATALOG & ADMIN ROUTES ---

  // GET /admin/items
  app.get('/admin/items', async () => {
    const items = await listItems();
    const nextItem = await getNextItem();
    return { items, nextItem };
  });

  // POST /admin/items
  const CreateItemSchema = z.object({
    lotNumber: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    category: z.string().optional(),
    estimatedPriceCents: z.number().int().nonnegative().optional(),
    startingPriceCents: z.number().int().positive().optional(),
    reservePriceCents: z.number().int().nonnegative().optional(),
    minIncrementCents: z.number().int().positive().optional(),
    durationSeconds: z.number().int().positive().optional(),
    imageUrl: z.string().optional(),
  });

  app.post('/admin/items', async (req, reply) => {
    const parse = CreateItemSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.message });
    }
    const item = await createItem(parse.data);
    return reply.status(201).send({ item });
  });

  // POST /admin/items/:id/next (Set which item is next on the auction block!)
  app.post('/admin/items/:id/next', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await setNextItem(id);
    if (!item) {
      return reply.status(404).send({ error: 'Item not found' });
    }
    return reply.status(200).send({
      message: `Lot #${item.lot_number} "${item.title}" is now designated as NEXT on the auction block.`,
      item,
    });
  });

  // POST /admin/auctions/launch-next (Start the designated next item live)
  app.post('/admin/auctions/launch-next', async (req, reply) => {
    const { item_id } = (req.body as { item_id?: string }) || {};
    try {
      const result = await launchNextItem(item_id);
      return reply.status(200).send({
        message: `Auction launched for Lot #${result.item.lot_number}: ${result.item.title}`,
        auction: result.auction,
        item: result.item,
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // POST /admin/auctions/:id/close (Admin gavel hammer down)
  app.post('/admin/auctions/:id/close', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const res = await manuallyCloseAuction(id);
      return reply.status(200).send(res);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /admin/auctions/:id/extend (Admin time extension)
  app.post('/admin/auctions/:id/extend', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { seconds } = (req.body as { seconds?: number }) || { seconds: 60 };
    try {
      const res = await extendAuction(id, seconds ?? 60);
      return reply.status(200).send(res);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /admin/stats
  app.get('/admin/stats', async () => {
    const [auctionsCount, bidsCount, openAuctionRes, nextItem, usersCount] = await Promise.all([
      query('SELECT COUNT(*) as count FROM auctions'),
      query('SELECT COUNT(*) as count FROM bids WHERE accepted = true'),
      query('SELECT * FROM auctions WHERE status = $1 ORDER BY starts_at DESC LIMIT 1', ['open']),
      getNextItem(),
      query('SELECT COUNT(*) as count FROM users'),
    ]);

    return {
      totalAuctions: Number(auctionsCount.rows[0]?.count || 0),
      totalAcceptedBids: Number(bidsCount.rows[0]?.count || 0),
      registeredUsers: Number(usersCount.rows[0]?.count || 0),
      activeAuction: openAuctionRes.rows[0] || null,
      nextItemUp: nextItem || null,
    };
  });

  // --- AUCTION & BID ROUTES ---

  // GET /auctions
  app.get('/auctions', async () => {
    const auctions = await listAuctions();
    return { auctions };
  });

  // GET /auctions/:id
  app.get('/auctions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const snapshot = await getAuctionSnapshot(id);
    if (!snapshot) {
      return reply.status(404).send({ error: 'Auction not found' });
    }
    return {
      auction: snapshot.auction,
      current_seq: Number(snapshot.auction.seq),
      recent_events: snapshot.recentEvents,
    };
  });

  // POST /auctions (seed/create)
  const CreateAuctionSchema = z.object({
    title: z.string().min(1),
    starts_at: z.string().datetime().optional(),
    ends_at: z.string().datetime(),
    starting_price_cents: z.number().int().nonnegative().optional(),
    min_increment_cents: z.number().int().positive().optional(),
  });

  app.post('/auctions', async (req, reply) => {
    const parse = CreateAuctionSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.message });
    }
    const { title, starts_at, ends_at, starting_price_cents, min_increment_cents } =
      parse.data;

    const auction = await createAuction({
      title,
      startsAt: starts_at,
      endsAt: ends_at,
      startingPriceCents: starting_price_cents ?? 0,
      minIncrementCents: min_increment_cents ?? 100,
    });

    return reply.status(201).send({ auction });
  });

  // POST /auctions/:id/bids (same code path as WS bid)
  const PostBidSchema = z.object({
    amount_cents: z.number().int().positive(),
    idempotency_key: z.string().min(1),
    bidder_id: z.string().optional(),
    token: z.string().optional(),
  });

  app.post('/auctions/:id/bids', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parse = PostBidSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: parse.error.message });
    }

    const { amount_cents, idempotency_key } = parse.data;

    // Resolve bidder_id from token or query or header
    let bidderId: string | null = null;

    const queryToken = (req.query as { token?: string }).token;
    const headerToken = (req.headers['x-bidder-token'] as string) || (req.headers['authorization']?.replace('Bearer ', ''));
    const token = parse.data.token || queryToken || headerToken;

    if (token) {
      bidderId = verifyBidderToken(token);
    } else if (parse.data.bidder_id) {
      bidderId = parse.data.bidder_id;
    }

    if (!bidderId) {
      return reply.status(401).send({ error: 'Valid bidder token or bidder_id required' });
    }

    try {
      const result = await placeBid({
        auctionId: id,
        bidderId,
        amountCents: amount_cents,
        idempotencyKey: idempotency_key,
      });

      return reply.status(result.accepted ? 200 : 409).send(result);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  return app;
}
