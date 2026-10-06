CREATE TABLE IF NOT EXISTS auctions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    current_price_cents BIGINT NOT NULL DEFAULT 0,
    current_winner_id TEXT NULL,
    min_increment_cents BIGINT NOT NULL DEFAULT 100,
    version INT NOT NULL DEFAULT 0,
    seq INT NOT NULL DEFAULT 0
);
