CREATE TABLE IF NOT EXISTS events (
    auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
    seq INT NOT NULL,
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (auction_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_events_auction_seq ON events(auction_id, seq);
