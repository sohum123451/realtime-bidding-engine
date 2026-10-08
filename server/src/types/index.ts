export type AuctionStatus = 'pending' | 'open' | 'closed';

export interface Auction {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: AuctionStatus;
  current_price_cents: number;
  current_winner_id: string | null;
  min_increment_cents: number;
  version: number;
  seq: number;
  item_id?: string | null;
}

export type UserRole = 'bidder' | 'admin';

export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  paddle_number: string;
  avatar_color: string;
  seat_index: number;
  balance_cents: number;
  created_at: string;
}

export type ItemStatus = 'catalog' | 'queued' | 'live' | 'sold' | 'passed';

export interface Item {
  id: string;
  lot_number: string;
  title: string;
  description: string;
  category: string;
  estimated_price_cents: number;
  starting_price_cents: number;
  reserve_price_cents: number;
  min_increment_cents: number;
  duration_seconds: number;
  image_url: string | null;
  is_next: boolean;
  status: ItemStatus;
  created_at: string;
}

export interface TokenPayload {
  userId: string;
  username: string;
  email: string;
  role: UserRole;
  paddleNumber: string;
  seatIndex: number;
  avatarColor: string;
  bidderId: string;
}

export interface Bid {
  id: string;
  auction_id: string;
  bidder_id: string;
  amount_cents: number;
  idempotency_key: string;
  accepted: boolean;
  reject_reason: string | null;
  created_at: string;
}

export interface AuctionEvent<T = any> {
  auction_id: string;
  seq: number;
  type: string;
  payload: T;
  created_at: string;
}

export type RejectReason =
  | 'too_low'
  | 'auction_closed'
  | 'auction_ended'
  | 'auction_not_started'
  | 'invalid_amount';

export interface BidResult {
  bidId: string;
  auctionId: string;
  bidderId: string;
  amountCents: number;
  accepted: boolean;
  rejectReason: string | null;
  currentPriceCents: number;
  seq: number;
  endsAt?: string;
  isIdempotentReplay?: boolean;
}

export interface PlaceBidParams {
  auctionId: string;
  bidderId: string;
  amountCents: number;
  idempotencyKey: string;
}

export interface PlaceBidOptions {
  disableLocking?: boolean;
}
