import crypto from 'crypto';
import { query } from '../db/pool.js';
import type { User, TokenPayload } from '../types/index.js';
import { signUserToken } from '../auth/token.js';

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export interface RegisterUserInput {
  username: string;
  email: string;
  password: string;
  role?: 'bidder' | 'admin';
  paddleNumber?: string;
  avatarColor?: string;
  seatIndex?: number;
}

export async function registerUser(input: RegisterUserInput): Promise<{ user: User; token: string }> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(input.password, salt);
  const passwordHash = `${salt}:${hash}`;

  const role = input.role || 'bidder';
  const paddleNumber = input.paddleNumber || `${Math.floor(10 + Math.random() * 89)}`;
  const avatarColor = input.avatarColor || '#d4af37';
  const seatIndex = input.seatIndex ?? 0;

  const res = await query<User>(
    `INSERT INTO users (username, email, password_hash, role, paddle_number, avatar_color, seat_index, balance_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 10000000)
     RETURNING id, username, email, role, paddle_number, avatar_color, seat_index, balance_cents, created_at`,
    [input.username, input.email.toLowerCase(), passwordHash, role, paddleNumber, avatarColor, seatIndex]
  );

  const user = res.rows[0];
  const payload: TokenPayload = {
    userId: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    paddleNumber: user.paddle_number,
    seatIndex: user.seat_index,
    avatarColor: user.avatar_color,
    bidderId: user.username,
  };

  const token = signUserToken(payload);
  return { user, token };
}

export async function loginUser(
  identifier: string,
  password: string
): Promise<{ user: User; token: string } | null> {
  const res = await query<User & { password_hash: string }>(
    `SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)`,
    [identifier]
  );

  if (res.rows.length === 0) return null;
  const userRow = res.rows[0];

  const [salt, expectedHash] = userRow.password_hash.split(':');
  if (!salt || !expectedHash) return null;

  const actualHash = hashPassword(password, salt);
  if (!crypto.timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash))) {
    return null;
  }

  const user: User = {
    id: userRow.id,
    username: userRow.username,
    email: userRow.email,
    role: userRow.role,
    paddle_number: userRow.paddle_number,
    avatar_color: userRow.avatar_color,
    seat_index: userRow.seat_index,
    balance_cents: Number(userRow.balance_cents),
    created_at: userRow.created_at,
  };

  const payload: TokenPayload = {
    userId: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    paddleNumber: user.paddle_number,
    seatIndex: user.seat_index,
    avatarColor: user.avatar_color,
    bidderId: user.username,
  };

  const token = signUserToken(payload);
  return { user, token };
}

export async function getUserById(id: string): Promise<User | null> {
  const res = await query<User>(
    `SELECT id, username, email, role, paddle_number, avatar_color, seat_index, balance_cents, created_at
     FROM users WHERE id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const res = await query<User>(
    `SELECT id, username, email, role, paddle_number, avatar_color, seat_index, balance_cents, created_at
     FROM users WHERE LOWER(username) = LOWER($1)`,
    [username]
  );
  return res.rows[0] || null;
}

export async function listUsers(): Promise<User[]> {
  const res = await query<User>(
    `SELECT id, username, email, role, paddle_number, avatar_color, seat_index, balance_cents, created_at
     FROM users ORDER BY created_at ASC`
  );
  return res.rows;
}

export async function seedDefaultUsers(): Promise<void> {
  const check = await query('SELECT COUNT(*) as count FROM users');
  if (Number(check.rows[0].count) > 0) {
    return;
  }

  console.log('Seeding default VIP bidders and Admin accounts...');

  // Seed Admin
  await registerUser({
    username: 'SaleroomMaster',
    email: 'admin@auction.local',
    password: 'admin123',
    role: 'admin',
    paddleNumber: 'ADMIN',
    avatarColor: '#ffd700',
    seatIndex: -1,
  });

  // Seed standard 3D room bidders
  const defaultBidders = [
    { username: 'Alice', email: 'alice@saleroom.vip', password: 'password123', paddleNumber: '01', avatarColor: '#f59e0b', seatIndex: 0 },
    { username: 'Bob', email: 'bob@saleroom.vip', password: 'password123', paddleNumber: '02', avatarColor: '#10b981', seatIndex: 1 },
    { username: 'Claire', email: 'claire@saleroom.vip', password: 'password123', paddleNumber: '03', avatarColor: '#ef4444', seatIndex: 2 },
    { username: 'David', email: 'david@saleroom.vip', password: 'password123', paddleNumber: '04', avatarColor: '#06b6d4', seatIndex: 3 },
    { username: 'Elena', email: 'elena@saleroom.vip', password: 'password123', paddleNumber: '05', avatarColor: '#8b5cf6', seatIndex: 4 },
    { username: 'Felix', email: 'felix@saleroom.vip', password: 'password123', paddleNumber: '06', avatarColor: '#ec4899', seatIndex: 5 },
  ];

  for (const b of defaultBidders) {
    await registerUser({
      username: b.username,
      email: b.email,
      password: b.password,
      role: 'bidder',
      paddleNumber: b.paddleNumber,
      avatarColor: b.avatarColor,
      seatIndex: b.seatIndex,
    });
  }
}
