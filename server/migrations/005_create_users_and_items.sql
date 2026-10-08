CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'bidder',
    paddle_number TEXT NOT NULL,
    avatar_color TEXT NOT NULL DEFAULT '#d4af37',
    seat_index INT NOT NULL DEFAULT 0,
    balance_cents BIGINT NOT NULL DEFAULT 10000000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Fine Art',
    estimated_price_cents BIGINT NOT NULL DEFAULT 100000,
    starting_price_cents BIGINT NOT NULL DEFAULT 5000,
    reserve_price_cents BIGINT NOT NULL DEFAULT 0,
    min_increment_cents BIGINT NOT NULL DEFAULT 500,
    duration_seconds INT NOT NULL DEFAULT 900,
    image_url TEXT NULL,
    is_next BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'catalog',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE auctions ADD COLUMN IF NOT EXISTS item_id UUID NULL REFERENCES items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_is_next ON items(is_next);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
