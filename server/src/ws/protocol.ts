import { z } from 'zod';

export const SubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  auction_id: z.string().uuid(),
});

export const UnsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  auction_id: z.string().uuid(),
});

export const SyncMessageSchema = z.object({
  type: z.literal('sync'),
  auction_id: z.string().uuid(),
  last_seq: z.number().int().nonnegative(),
});

export const BidMessageSchema = z.object({
  type: z.literal('bid'),
  auction_id: z.string().uuid(),
  amount_cents: z.number().int().positive(),
  idempotency_key: z.string().min(1),
});

export const PingMessageSchema = z.object({
  type: z.literal('ping'),
});

export const InboundMessageSchema = z.discriminatedUnion('type', [
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
  SyncMessageSchema,
  BidMessageSchema,
  PingMessageSchema,
]);

export type InboundMessage = z.infer<typeof InboundMessageSchema>;

export type OutboundMessage =
  | {
      type: 'event';
      auction_id: string;
      seq: number;
      event_type: string;
      payload: any;
      created_at: string;
    }
  | {
      type: 'sync_replay';
      auction_id: string;
      from_seq: number;
      current_seq: number;
      events: any[];
    }
  | {
      type: 'snapshot';
      auction_id: string;
      current_seq: number;
      auction: any;
      recent_events: any[];
    }
  | {
      type: 'bid_result';
      idempotency_key: string;
      accepted: boolean;
      reject_reason: string | null;
      current_price_cents: number;
      amount_cents: number;
      seq: number;
      ends_at?: string;
    }
  | {
      type: 'pong';
      timestamp: number;
    }
  | {
      type: 'error';
      message: string;
    };
