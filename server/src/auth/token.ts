import crypto from 'crypto';
import type { TokenPayload } from '../types/index.js';

const AUTH_SECRET = process.env.AUTH_SECRET || 'super-secret-auction-key-web-be2';

export function signUserToken(payload: TokenPayload): string {
  const serialized = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(serialized)
    .digest('base64url');
  return `${serialized}.${signature}`;
}

export function verifyUserToken(token: string): TokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payload)
    .digest('base64url');

  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (data && (data.userId || data.bidderId)) {
      return {
        userId: data.userId || data.bidderId,
        username: data.username || data.bidderId,
        email: data.email || `${data.bidderId}@auction.local`,
        role: data.role || 'bidder',
        paddleNumber: data.paddleNumber || '01',
        seatIndex: typeof data.seatIndex === 'number' ? data.seatIndex : 0,
        avatarColor: data.avatarColor || '#d4af37',
        bidderId: data.bidderId || data.userId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function signBidderToken(bidderId: string): string {
  const payload: TokenPayload = {
    userId: bidderId,
    username: bidderId,
    email: `${bidderId}@auction.local`,
    role: bidderId === 'admin' ? 'admin' : 'bidder',
    paddleNumber: bidderId.replace('bidder-', '0'),
    seatIndex: 0,
    avatarColor: '#d4af37',
    bidderId,
  };
  return signUserToken(payload);
}

export function verifyBidderToken(token: string): string | null {
  const verified = verifyUserToken(token);
  return verified ? verified.bidderId : null;
}
