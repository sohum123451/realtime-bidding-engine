import type { BidResult, NetworkCallbacks } from './network.js';
import { BIDDER_SEATS } from './scene/auction-room.js';

export interface CatalogItem {
  id: string;
  lot_number: number;
  title: string;
  category: string;
  description: string;
  starting_price_cents: number;
  estimated_price_cents: number;
  min_increment_cents: number;
  duration_seconds: number;
  status: 'pending' | 'live' | 'completed';
  is_next: boolean;
}

export interface SimUser {
  id: string;
  username: string;
  email: string;
  role: 'bidder' | 'admin';
  paddle_number: string;
  avatar_color: string;
  seat_index: number;
}

class SimulationEngine {
  private items: CatalogItem[] = [
    {
      id: 'lot-101',
      lot_number: 101,
      title: '18th-Century Celestial Orrery',
      category: 'Scientific Instruments & Antiques',
      description: 'Exquisite brass mechanical solar system by George Adams of Fleet Street, London, circa 1785. Hand-engraved zodiac dial, rotating concentric gear train, solid mahogany tripod plinth. Museum provenance.',
      starting_price_cents: 5000,
      estimated_price_cents: 18000000,
      min_increment_cents: 500,
      duration_seconds: 1500,
      status: 'live',
      is_next: false,
    },
    {
      id: 'lot-102',
      lot_number: 102,
      title: 'The Imperial Qianlong White Jade Dragon Seal',
      category: 'Imperial Chinese Works of Art',
      description: 'Qianlong period (1736-1795) imperial white nephrite seal carved with intertwining five-clawed dragons surging through cloud scrolls. Incised four-character mark. Flawless imperial translucency.',
      starting_price_cents: 12000000,
      estimated_price_cents: 45000000,
      min_increment_cents: 500000,
      duration_seconds: 900,
      status: 'pending',
      is_next: true,
    },
    {
      id: 'lot-103',
      lot_number: 103,
      title: 'Patek Philippe Grandmaster Chime Ref. 6300G',
      category: 'Haute Horlogerie',
      description: 'Double-faced reversible 18k white gold case with guilloched hobnail pattern. 20 complications including 5 chiming modes, grand & petite sonnerie, minute repeater, and perpetual calendar.',
      starting_price_cents: 320000000,
      estimated_price_cents: 850000000,
      min_increment_cents: 10000000,
      duration_seconds: 1200,
      status: 'pending',
      is_next: false,
    },
    {
      id: 'lot-104',
      lot_number: 104,
      title: 'Claude Monet — Nymphéas au crépuscule (1914)',
      category: 'Impressionist & Modern Art',
      description: 'Oil on canvas, 100 x 200 cm. Stamped with atelier signature. Depicting the water lily pond at Giverny under the warm violet reflections of dusk. Sohum’s private European provenance.',
      starting_price_cents: 1500000000,
      estimated_price_cents: 4200000000,
      min_increment_cents: 50000000,
      duration_seconds: 1800,
      status: 'pending',
      is_next: false,
    },
  ];

  private users: SimUser[] = [
    {
      id: 'bidder-1',
      username: 'Alice (Seat 1)',
      email: 'alice@auction.art',
      role: 'bidder',
      paddle_number: '01',
      avatar_color: '#f59e0b',
      seat_index: 0,
    },
    {
      id: 'bidder-2',
      username: 'Bob (Seat 2)',
      email: 'bob@auction.art',
      role: 'bidder',
      paddle_number: '02',
      avatar_color: '#10b981',
      seat_index: 1,
    },
    {
      id: 'bidder-3',
      username: 'Claire (Seat 3)',
      email: 'claire@auction.art',
      role: 'bidder',
      paddle_number: '03',
      avatar_color: '#ef4444',
      seat_index: 2,
    },
    {
      id: 'bidder-4',
      username: 'David (Seat 4)',
      email: 'david@auction.art',
      role: 'bidder',
      paddle_number: '04',
      avatar_color: '#06b6d4',
      seat_index: 3,
    },
    {
      id: 'bidder-5',
      username: 'Elena (Seat 5)',
      email: 'elena@auction.art',
      role: 'bidder',
      paddle_number: '05',
      avatar_color: '#8b5cf6',
      seat_index: 4,
    },
    {
      id: 'bidder-6',
      username: 'Felix (Seat 6)',
      email: 'felix@auction.art',
      role: 'bidder',
      paddle_number: '06',
      avatar_color: '#ec4899',
      seat_index: 5,
    },
    {
      id: 'admin-master',
      username: 'Saleroom Master',
      email: 'admin@auction.art',
      role: 'admin',
      paddle_number: '00',
      avatar_color: '#d4af37',
      seat_index: 0,
    },
  ];

  public activeAuction: any = {
    id: 'sim-auction-101',
    item_id: 'lot-101',
    title: 'Lot #101: 18th-Century Celestial Orrery',
    starting_price_cents: 5000,
    current_price_cents: 5000,
    min_increment_cents: 500,
    status: 'open',
    ends_at: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  };

  public currentSeq = 1;
  public totalAcceptedBids = 0;
  public totalAuctionsCount = 1;
  public recentEvents: any[] = [];
  public activeCallbacks: NetworkCallbacks | null = null;
  public aiBiddingEnabled = true;
  private aiBidTimer: ReturnType<typeof setTimeout> | null = null;
  public currentSimUser: SimUser = this.users[0];

  constructor() {
    this.scheduleNextAiBid();
  }

  public getSnapshot() {
    return {
      type: 'snapshot',
      auction: { ...this.activeAuction },
      current_seq: this.currentSeq,
      recent_events: [...this.recentEvents],
      timestamp: new Date().toISOString(),
    };
  }

  public connectSocket(callbacks: NetworkCallbacks, auctionId?: string) {
    this.activeCallbacks = callbacks;
    if (auctionId && auctionId !== this.activeAuction.id) {
      this.activeAuction.id = auctionId;
    }

    // Emit connection success and initial snapshot
    setTimeout(() => {
      callbacks.onConnectionChange(true, this.currentSeq);
      callbacks.onSnapshot(this.getSnapshot());
    }, 50);

    return {
      placeBid: (amountCents: number, bidderId?: string, paddle?: string, color?: string, seatIdx?: number): Promise<BidResult> => {
        return this.submitBid(amountCents, bidderId, paddle, color, seatIdx);
      },
      close: () => {
        this.activeCallbacks = null;
      },
    };
  }

  public submitBid(
    amountCents: number,
    bidderId?: string,
    _paddle?: string,
    _color?: string,
    seatIdx?: number
  ): Promise<BidResult> {
    const idempotencyKey = `sim-bid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (this.activeAuction.status !== 'open') {
      const res: BidResult = {
        idempotency_key: idempotencyKey,
        accepted: false,
        reject_reason: 'AUCTION_CLOSED',
        current_price_cents: this.activeAuction.current_price_cents,
        amount_cents: amountCents,
        seq: this.currentSeq,
      };
      this.activeCallbacks?.onBidResult(res);
      return Promise.resolve(res);
    }

    const minRequired = this.activeAuction.current_price_cents + this.activeAuction.min_increment_cents;
    if (amountCents < minRequired) {
      const res: BidResult = {
        idempotency_key: idempotencyKey,
        accepted: false,
        reject_reason: 'BID_BELOW_MIN_INCREMENT',
        current_price_cents: this.activeAuction.current_price_cents,
        amount_cents: amountCents,
        seq: this.currentSeq,
      };
      this.activeCallbacks?.onBidResult(res);
      return Promise.resolve(res);
    }

    const bidderSeat = BIDDER_SEATS[seatIdx ?? 0] || BIDDER_SEATS[0];
    const winningBidderName = bidderId || bidderSeat.name;
    const winningBidderId = bidderSeat.id;

    // Disallow overbidding oneself when already holding the high bid
    const curWinId = (this.activeAuction.current_winner_id || '').toLowerCase().trim();
    const curWinName = (this.activeAuction.current_winner_name || '').toLowerCase().trim();
    const checkIdentifiers = [
      winningBidderId,
      bidderSeat.id,
      winningBidderName,
      bidderSeat.name,
      bidderSeat.name.split(' ')[0],
      bidderSeat.paddleNumber,
      `#${bidderSeat.paddleNumber}`,
    ].map((s) => s.toLowerCase().trim());

    const isAlreadyWinning = checkIdentifiers.some(
      (c) => c && (curWinId === c || curWinId.includes(c) || curWinName === c || curWinName.includes(c))
    );

    if (isAlreadyWinning) {
      const res: BidResult = {
        idempotency_key: idempotencyKey,
        accepted: false,
        reject_reason: 'ALREADY_HIGHEST_BIDDER',
        current_price_cents: this.activeAuction.current_price_cents,
        amount_cents: amountCents,
        seq: this.currentSeq,
      };
      this.activeCallbacks?.onBidResult(res);
      return Promise.resolve(res);
    }

    // Bid accepted!
    this.currentSeq++;
    this.totalAcceptedBids++;
    this.activeAuction.current_price_cents = amountCents;
    this.activeAuction.current_winner_id = winningBidderId;
    this.activeAuction.current_winner_name = winningBidderName;

    // No automatic anti-sniping extension
    const extended = false;

    const eventPayload = {
      auction_id: this.activeAuction.id,
      bidder_id: bidderSeat.id,
      bidder_name: winningBidderName,
      amount_cents: amountCents,
      current_price_cents: amountCents,
      seat_index: bidderSeat.seatIndex,
      color: bidderSeat.color,
      ends_at: this.activeAuction.ends_at,
      extended,
      seq: this.currentSeq,
      timestamp: new Date().toISOString(),
    };

    const eventMsg = {
      type: 'event',
      event_type: 'bid_accepted',
      seq: this.currentSeq,
      payload: eventPayload,
    };

    this.recentEvents.unshift(eventMsg);
    if (this.recentEvents.length > 50) this.recentEvents.pop();

    const bidResult: BidResult = {
      idempotency_key: idempotencyKey,
      accepted: true,
      reject_reason: null,
      current_price_cents: amountCents,
      amount_cents: amountCents,
      seq: this.currentSeq,
      ends_at: this.activeAuction.ends_at,
    };

    if (this.activeCallbacks) {
      this.activeCallbacks.onBidResult(bidResult);
      this.activeCallbacks.onEvent(eventMsg);
    }

    return Promise.resolve(bidResult);
  }

  // Autonomous Opponent Saleroom Bidders
  private scheduleNextAiBid() {
    if (this.aiBidTimer) clearTimeout(this.aiBidTimer);
    const delay = 18000 + Math.random() * 20000; // 18 - 38 seconds
    this.aiBidTimer = setTimeout(() => {
      this.triggerAutonomousOpponentBid();
      this.scheduleNextAiBid();
    }, delay);
  }

  public triggerAutonomousOpponentBid() {
    if (!this.aiBiddingEnabled || !this.activeCallbacks || this.activeAuction.status !== 'open') {
      return;
    }

    const curWinId = (this.activeAuction.current_winner_id || '').toLowerCase().trim();
    const curWinName = (this.activeAuction.current_winner_name || '').toLowerCase().trim();

    // Pick a random seat that is NOT currently holding the winning bid
    const eligibleSeats = BIDDER_SEATS.filter((seat) => {
      const sId = seat.id.toLowerCase().trim();
      const sName = seat.name.toLowerCase().trim();
      const sFirst = seat.name.split(' ')[0].toLowerCase().trim();
      if (curWinId && (curWinId === sId || curWinId.includes(sFirst))) return false;
      if (curWinName && (curWinName === sName || curWinName.includes(sFirst))) return false;
      return true;
    });

    if (eligibleSeats.length === 0) return;
    const opponentSeat = eligibleSeats[Math.floor(Math.random() * eligibleSeats.length)];

    const nextAmount = this.activeAuction.current_price_cents + this.activeAuction.min_increment_cents;
    this.currentSeq++;
    this.totalAcceptedBids++;
    this.activeAuction.current_price_cents = nextAmount;
    this.activeAuction.current_winner_id = opponentSeat.id;
    this.activeAuction.current_winner_name = opponentSeat.name;

    const extended = false;

    const eventPayload = {
      auction_id: this.activeAuction.id,
      bidder_id: opponentSeat.id,
      bidder_name: opponentSeat.name,
      amount_cents: nextAmount,
      current_price_cents: nextAmount,
      seat_index: opponentSeat.seatIndex,
      color: opponentSeat.color,
      ends_at: this.activeAuction.ends_at,
      extended,
      seq: this.currentSeq,
      timestamp: new Date().toISOString(),
    };

    const eventMsg = {
      type: 'event',
      event_type: 'bid_accepted',
      seq: this.currentSeq,
      payload: eventPayload,
    };

    this.recentEvents.unshift(eventMsg);
    if (this.recentEvents.length > 50) this.recentEvents.pop();

    this.activeCallbacks.onEvent(eventMsg);
  }

  // Handle all simulated REST endpoints
  public async handleApiRequest<T = any>(
    path: string,
    options: RequestInit = {},
    _token?: string | null
  ): Promise<T> {
    const url = new URL(path, 'http://localhost');
    const pathname = url.pathname;
    const method = (options.method || 'GET').toUpperCase();
    let body: any = {};
    if (options.body && typeof options.body === 'string') {
      try {
        body = JSON.parse(options.body);
      } catch {
        body = {};
      }
    }

    // 1. /health
    if (pathname === '/health') {
      return { status: 'ok', simulation: true, timestamp: new Date().toISOString() } as T;
    }

    // 2. /auth/token
    if (pathname === '/auth/token') {
      const bidderId = url.searchParams.get('bidder_id') || 'bidder-1';
      return { token: `sim-token-${bidderId}` } as T;
    }

    // 3. /auth/me
    if (pathname === '/auth/me') {
      return { user: this.currentSimUser } as T;
    }

    // 4. /auth/login
    if (pathname === '/auth/login' && method === 'POST') {
      const email = body.email || '';
      const matched = this.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || this.users[0];
      this.currentSimUser = matched;
      return { user: matched, token: `sim-token-${matched.id}` } as T;
    }

    // 5. /auth/register
    if (pathname === '/auth/register' && method === 'POST') {
      const newUser: SimUser = {
        id: `user-${Date.now()}`,
        username: body.username || body.name || 'Collector',
        email: body.email || `user${Date.now()}@auction.art`,
        role: 'bidder',
        paddle_number: body.paddleNumber || body.paddle_number || `${Math.floor(Math.random() * 90) + 10}`,
        avatar_color: body.avatarColor || body.avatar_color || '#d4af37',
        seat_index: body.seatIndex ?? body.seat_index ?? 0,
      };
      this.users.push(newUser);
      this.currentSimUser = newUser;
      return { user: newUser, token: `sim-token-${newUser.id}` } as T;
    }

    // 6. /auctions
    if (pathname === '/auctions') {
      if (method === 'GET') {
        return { auctions: [{ ...this.activeAuction }] } as T;
      }
      if (method === 'POST') {
        this.totalAuctionsCount++;
        this.activeAuction = {
          id: `sim-auction-${Date.now()}`,
          title: body.title || 'Live Block Lot',
          starting_price_cents: body.starting_price_cents || 5000,
          current_price_cents: body.starting_price_cents || 5000,
          min_increment_cents: body.min_increment_cents || 500,
          status: 'open',
          ends_at: body.ends_at || new Date(Date.now() + 25 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        };
        this.currentSeq = 1;
        this.recentEvents = [];
        if (this.activeCallbacks) {
          this.activeCallbacks.onSnapshot(this.getSnapshot());
        }
        return { auction: { ...this.activeAuction } } as T;
      }
    }

    // 7. /admin/auctions/:id/extend
    if (pathname.includes('/extend') && method === 'POST') {
      const secs = body.seconds || 60;
      const currentEnds = new Date(this.activeAuction.ends_at).getTime();
      const newEnds = new Date(Math.max(Date.now(), currentEnds) + secs * 1000).toISOString();
      this.activeAuction.ends_at = newEnds;
      this.currentSeq++;

      const eventMsg = {
        type: 'event',
        event_type: 'timer_extended',
        seq: this.currentSeq,
        payload: {
          auction_id: this.activeAuction.id,
          ends_at: newEnds,
          extension_seconds: secs,
        },
      };
      this.recentEvents.unshift(eventMsg);
      this.activeCallbacks?.onEvent(eventMsg);
      return { success: true, ends_at: newEnds } as T;
    }

    // 8. /admin/auctions/:id/close
    if (pathname.includes('/close') && method === 'POST') {
      this.activeAuction.status = 'closed';
      this.currentSeq++;

      const eventMsg = {
        type: 'event',
        event_type: 'auction_closed',
        seq: this.currentSeq,
        payload: {
          auction_id: this.activeAuction.id,
          final_price_cents: this.activeAuction.current_price_cents,
        },
      };
      this.recentEvents.unshift(eventMsg);
      this.activeCallbacks?.onEvent(eventMsg);
      return { success: true, auction: this.activeAuction } as T;
    }

    // 9. /admin/auctions/launch-next
    if (pathname === '/admin/auctions/launch-next' && method === 'POST') {
      let targetItem: CatalogItem | undefined;
      if (body.item_id) {
        targetItem = this.items.find((i) => i.id === body.item_id);
      } else {
        targetItem = this.items.find((i) => i.is_next);
      }
      if (!targetItem) {
        targetItem = this.items.find((i) => i.status !== 'live') || this.items[0];
      }

      // Mark current live as completed
      this.items.forEach((i) => {
        if (i.status === 'live') i.status = 'completed';
      });

      targetItem.status = 'live';
      targetItem.is_next = false;

      // Select next pending item if available
      const nextPending = this.items.find((i) => i.status === 'pending');
      if (nextPending) nextPending.is_next = true;

      this.totalAuctionsCount++;
      this.activeAuction = {
        id: `sim-auction-${targetItem.id}-${Date.now()}`,
        item_id: targetItem.id,
        title: `Lot #${targetItem.lot_number}: ${targetItem.title}`,
        starting_price_cents: targetItem.starting_price_cents,
        current_price_cents: targetItem.starting_price_cents,
        min_increment_cents: targetItem.min_increment_cents,
        status: 'open',
        ends_at: new Date(Date.now() + (targetItem.duration_seconds || 900) * 1000).toISOString(),
        created_at: new Date().toISOString(),
      };

      this.currentSeq = 1;
      this.recentEvents = [];

      if (this.activeCallbacks) {
        this.activeCallbacks.onSnapshot(this.getSnapshot());
      }

      return { auction: this.activeAuction, item: targetItem } as T;
    }

    // 10. /admin/items
    if (pathname === '/admin/items') {
      if (method === 'GET') {
        const nextItem = this.items.find((i) => i.is_next) || null;
        return { items: [...this.items], nextItem } as T;
      }
      if (method === 'POST') {
        const newItem: CatalogItem = {
          id: `item-${Date.now()}`,
          lot_number: parseInt(body.lotNumber, 10) || (this.items.length + 101),
          title: body.title || 'Untitled Lot',
          category: body.category || 'Fine Art',
          description: body.description || '',
          starting_price_cents: body.startingPriceCents || 10000,
          estimated_price_cents: (body.startingPriceCents || 10000) * 3,
          min_increment_cents: body.minIncrementCents || 1000,
          duration_seconds: body.durationSeconds || 900,
          status: 'pending',
          is_next: false,
        };
        this.items.push(newItem);
        return { item: newItem } as T;
      }
    }

    // 11. /admin/items/:id/next
    if (pathname.startsWith('/admin/items/') && pathname.endsWith('/next') && method === 'POST') {
      const parts = pathname.split('/');
      const itemId = parts[3];
      this.items.forEach((i) => {
        i.is_next = i.id === itemId;
      });
      return { success: true } as T;
    }

    // 12. /admin/stats
    if (pathname === '/admin/stats') {
      return {
        totalAuctions: this.totalAuctionsCount,
        totalAcceptedBids: this.totalAcceptedBids,
        registeredUsers: this.users.length,
        activeAuction: this.activeAuction,
      } as T;
    }

    return {} as T;
  }
}

export const simulationEngine = new SimulationEngine();
