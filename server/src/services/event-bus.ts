import pg from 'pg';
import { databaseUrl, query } from '../db/pool.js';
import type { AuctionEvent } from '../types/index.js';

export type EventListener = (event: AuctionEvent) => void;

class PostgresEventBus {
  private client: pg.Client | null = null;
  private listeners: Map<string, Set<EventListener>> = new Map();
  private isConnecting = false;
  private isClosing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.client || this.isConnecting) return;
    this.isConnecting = true;

    try {
      this.client = new pg.Client({ connectionString: databaseUrl });
      await this.client.connect();

      await this.client.query('LISTEN auction_events');

      this.client.on('notification', async (msg) => {
        if (msg.channel === 'auction_events' && msg.payload) {
          try {
            const data = JSON.parse(msg.payload);
            const { auction_id, seq } = data;

            // In accordance with spec: notify the seq, then each instance reads the event row
            const res = await query<AuctionEvent>(
              'SELECT auction_id, seq, type, payload, created_at FROM events WHERE auction_id = $1 AND seq = $2',
              [auction_id, seq]
            );

            if (res.rows.length > 0) {
              const eventRow = res.rows[0];
              this.dispatch(auction_id, eventRow);
            }
          } catch (err) {
            console.error('Error handling pg notification:', err);
          }
        }
      });

      this.client.on('error', (err) => {
        console.error('Postgres event bus client error:', err);
        this.scheduleReconnect();
      });

      this.client.on('end', () => {
        if (!this.isClosing) {
          this.scheduleReconnect();
        }
      });

      this.isConnecting = false;
      console.log('Postgres LISTEN/NOTIFY event bus connected.');
    } catch (err) {
      this.isConnecting = false;
      console.error('Failed to start Postgres event bus:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isClosing || this.reconnectTimer) return;
    this.client = null;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch((err) => console.error('Reconnect failed:', err));
    }, 2000);
  }

  subscribe(auctionId: string, listener: EventListener): () => void {
    if (!this.listeners.has(auctionId)) {
      this.listeners.set(auctionId, new Set());
    }
    this.listeners.get(auctionId)!.add(listener);

    return () => {
      const set = this.listeners.get(auctionId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(auctionId);
        }
      }
    };
  }

  private dispatch(auctionId: string, event: AuctionEvent): void {
    const set = this.listeners.get(auctionId);
    if (set) {
      for (const listener of set) {
        try {
          listener(event);
        } catch (err) {
          console.error('Error in event bus subscriber:', err);
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.isClosing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        await this.client.end();
      } catch {
        // ignore
      }
      this.client = null;
    }
  }
}

export const eventBus = new PostgresEventBus();
