import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createAuction,
  getAuctionSnapshot,
  listAuctions,
} from '../services/auction-service.js';
import { placeBid } from '../services/bid-service.js';
import { signBidderToken, verifyBidderToken } from '../auth/token.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  // CORS headers so Vite client can call API directly
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-bidder-token');
    if (req.method === 'OPTIONS') {
      reply.status(204).send();
    }
  });

  // Health check
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Auth token helper
  app.get('/auth/token', async (req, reply) => {
    const { bidder_id } = req.query as { bidder_id?: string };
    if (!bidder_id) {
      return reply.status(400).send({ error: 'bidder_id query parameter required' });
    }
    const token = signBidderToken(bidder_id);
    return { bidder_id, token };
  });

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

  // POST /auctions (admin seed)
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
      // If bidder_id passed directly in curl test body
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
