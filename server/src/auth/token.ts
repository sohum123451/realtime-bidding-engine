import crypto from 'crypto';

const AUTH_SECRET = process.env.AUTH_SECRET || 'super-secret-auction-key-web-be2';

export function signBidderToken(bidderId: string): string {
  const payload = Buffer.from(JSON.stringify({ bidderId })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyBidderToken(token: string): string | null {
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
    if (typeof data.bidderId === 'string' && data.bidderId.length > 0) {
      return data.bidderId;
    }
    return null;
  } catch {
    return null;
  }
}
