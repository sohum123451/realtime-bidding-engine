export interface BidResult {
  idempotency_key: string;
  accepted: boolean;
  reject_reason: string | null;
  current_price_cents: number;
  amount_cents: number;
  seq: number;
  ends_at?: string;
}

export interface NetworkCallbacks {
  onConnectionChange: (connected: boolean, lastSeq: number) => void;
  onSnapshot: (snapshot: any) => void;
  onEvent: (event: any) => void;
  onEventsReplay: (events: any[]) => void;
  onBidResult: (result: BidResult) => void;
  onError: (errorMsg: string) => void;
}

export class AuctionNetworkClient {
  private socket: WebSocket | null = null;
  private wsUrl: string;
  private token: string | null = null;
  public auctionId: string | null = null;
  public lastSeq = 0;
  private isConnected = false;
  private callbacks: NetworkCallbacks;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private inFlightBids = new Map<
    string,
    {
      amountCents: number;
      resolve: (res: BidResult) => void;
      reject: (err: any) => void;
    }
  >();

  constructor(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    this.wsUrl = `${protocol}//${host}/ws`;
  }

  public setToken(token: string): void {
    const tokenChanged = this.token !== token;
    this.token = token;
    if (tokenChanged && this.socket && this.isConnected) {
      // Reconnect with new bidder token
      this.reconnect();
    }
  }

  public connect(auctionId: string, initialToken?: string): void {
    this.auctionId = auctionId;
    if (initialToken) this.token = initialToken;
    this.initSocket();
  }

  private initSocket(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }

    const query = this.token ? `?token=${encodeURIComponent(this.token)}` : '';
    const fullUrl = `${this.wsUrl}${query}`;

    try {
      this.socket = new WebSocket(fullUrl);
    } catch (err: any) {
      console.warn('WebSocket init failed:', err.message);
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.isConnected = true;
      this.callbacks.onConnectionChange(true, this.lastSeq);

      // On connect or reconnect: send sync with last known seq
      if (this.auctionId) {
        this.send({
          type: 'sync',
          auction_id: this.auctionId,
          last_seq: this.lastSeq,
        });
      }

      // Retry any bids that were in flight when disconnected using the SAME idempotency key
      for (const [key, pending] of this.inFlightBids.entries()) {
        if (this.auctionId) {
          this.send({
            type: 'bid',
            auction_id: this.auctionId,
            amount_cents: pending.amountCents,
            idempotency_key: key,
          });
        }
      }

      this.startHeartbeat();
    };

    this.socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (err: any) {
        console.warn('Failed to parse WS message:', err.message);
      }
    };

    this.socket.onclose = () => {
      this.handleDisconnect();
    };

    this.socket.onerror = (err) => {
      console.warn('WebSocket socket error:', err);
      this.handleDisconnect();
    };
  }

  private handleDisconnect(): void {
    if (this.isConnected) {
      this.isConnected = false;
      this.callbacks.onConnectionChange(false, this.lastSeq);
    }
    this.stopHeartbeat();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('Attempting WebSocket reconnect...');
      this.initSocket();
    }, 1500);
  }

  public reconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.initSocket();
  }

  public simulateDrop(): void {
    if (this.socket) {
      console.log('Simulating abrupt socket drop...');
      this.socket.close();
    }
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'snapshot': {
        this.lastSeq = Number(msg.current_seq);
        this.callbacks.onSnapshot(msg);
        break;
      }

      case 'sync_replay': {
        this.lastSeq = Number(msg.current_seq);
        this.callbacks.onEventsReplay(msg.events || []);
        break;
      }

      case 'event': {
        const incomingSeq = Number(msg.seq);

        // Gap detection: If we missed an event, immediately re-sync
        if (incomingSeq > this.lastSeq + 1) {
          console.warn(
            `Sequence gap detected! Expected ${this.lastSeq + 1}, received ${incomingSeq}. Requesting resync...`
          );
          if (this.auctionId) {
            this.send({
              type: 'sync',
              auction_id: this.auctionId,
              last_seq: this.lastSeq,
            });
          }
          return;
        }

        this.lastSeq = incomingSeq;
        this.callbacks.onEvent(msg);
        break;
      }

      case 'bid_result': {
        const result = msg as BidResult;
        const pending = this.inFlightBids.get(result.idempotency_key);
        if (pending) {
          pending.resolve(result);
          this.inFlightBids.delete(result.idempotency_key);
        }
        this.callbacks.onBidResult(result);
        break;
      }

      case 'error': {
        this.callbacks.onError(msg.message);
        break;
      }
    }
  }

  public async placeBid(amountCents: number): Promise<BidResult> {
    if (!this.auctionId) throw new Error('No active auction');
    if (!this.isConnected || !this.socket) throw new Error('Not connected to auction room');

    const idempotencyKey = `bid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    return new Promise((resolve, reject) => {
      this.inFlightBids.set(idempotencyKey, { amountCents, resolve, reject });

      this.send({
        type: 'bid',
        auction_id: this.auctionId!,
        amount_cents: amountCents,
        idempotency_key: idempotencyKey,
      });

      // Timeout safety: if no response in 10s, reject
      setTimeout(() => {
        if (this.inFlightBids.has(idempotencyKey)) {
          this.inFlightBids.delete(idempotencyKey);
          reject(new Error('Bid request timed out'));
        }
      }, 10000);
    });
  }

  private send(payload: any): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, 10000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
