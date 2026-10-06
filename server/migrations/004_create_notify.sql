CREATE OR REPLACE FUNCTION notify_auction_event()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('auction_events', json_build_object('auction_id', NEW.auction_id::text, 'seq', NEW.seq)::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_auction_event ON events;
CREATE TRIGGER trg_notify_auction_event
AFTER INSERT ON events
FOR EACH ROW
EXECUTE FUNCTION notify_auction_event();
