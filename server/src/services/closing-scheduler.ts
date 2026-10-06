import { query } from '../db/pool.js';
import { closeAuctionIfExpired } from './auction-service.js';

class AuctionClosingScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private checkIntervalMs = 500;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNext();
    console.log('Auction closing scheduler started.');
  }

  private scheduleNext(): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      try {
        await this.checkAndCloseExpiredAuctions();
      } catch (err) {
        console.error('Error in closing scheduler loop:', err);
      } finally {
        this.scheduleNext();
      }
    }, this.checkIntervalMs);
  }

  async checkAndCloseExpiredAuctions(): Promise<void> {
    // Find auctions whose ends_at is reached according to DB clock
    const res = await query<{ id: string }>(
      `SELECT id FROM auctions
       WHERE status = 'open' AND ends_at <= now()
       LIMIT 50`
    );

    for (const row of res.rows) {
      try {
        // closeAuctionIfExpired acquires row lock FOR UPDATE
        await closeAuctionIfExpired(row.id);
      } catch (err) {
        console.error(`Failed to close auction ${row.id}:`, err);
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('Auction closing scheduler stopped.');
  }
}

export const closingScheduler = new AuctionClosingScheduler();
