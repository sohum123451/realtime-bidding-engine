import { simulationEngine } from './simulation.js';

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
  onConnectionChange: (connected: boolean, lastSeq: number, mode?: 'live' | 'simulation') => void;
  onSnapshot: (snapshot: any) => void;
  onEvent: (event: any) => void;
  onEventsReplay: (events: any[]) => void;
  onBidResult: (result: BidResult) => void;
  onError: (errorMsg: string) => void;
}

export function getCustomServerUrl(): string {
  return localStorage.getItem('custom_api_url') || '';
}

export function setCustomServerUrl(url: string | null): void {
  if (url && url.trim()) {
    const cleanUrl = url.trim().replace(/\/+$/, '');
    localStorage.setItem('custom_api_url', cleanUrl);
    localStorage.removeItem('force_demo_mode');
  } else {
    localStorage.removeItem('custom_api_url');
  }
}

export function isForcedDemoMode(): boolean {
  return localStorage.getItem('force_demo_mode') === 'true';
}

export function setForcedDemoMode(enabled: boolean): void {
  if (enabled) {
    localStorage.setItem('force_demo_mode', 'true');
  } else {
    localStorage.removeItem('force_demo_mode');
  }
}

export function isSimulationMode(): boolean {
  if (isForcedDemoMode()) return true;
  const custom = getCustomServerUrl();
  if (custom) return false;
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) return false;

  // On static Vercel (where no Fastify/Postgres backend exists), default to client simulation
  const isVercel = window.location.hostname.endsWith('vercel.app');
  return isVercel;
}

export function getApiBaseUrl(): string {
  const custom = getCustomServerUrl();
  if (custom) return custom;
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string') {
    return envUrl.replace(/\/+$/, '');
  }
  return '';
}

export function getWsBaseUrl(): string {
  const custom = getCustomServerUrl();
  if (custom) {
    const clean = custom.replace(/^http/, 'ws');
    return `${clean}/ws`;
  }
  const envWs = (import.meta as any).env?.VITE_WS_URL;
  if (envWs && typeof envWs === 'string') {
    return envWs;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const isSim = isSimulationMode();

  // If running statically on Vercel without an external API configured, route to simulation engine
  if (isSim) {
    return simulationEngine.handleApiRequest<T>(path, options, token);
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const fullUrl = `${baseUrl}${normalizedPath}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  const storedToken = token || localStorage.getItem('auction_token');
  if (storedToken) {
    headers['Authorization'] = `Bearer ${storedToken}`;
    headers['x-bidder-token'] = storedToken;
  }

  try {
    const res = await fetch(fullUrl, {
      ...options,
      headers,
    });

    const contentType = res.headers.get('content-type') || '';
    let data: any = null;

    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    // If static host returns 405 Method Not Allowed or 404 HTML, gracefully fallback to simulation engine
    if (!res.ok || (contentType.includes('text/html') && res.status === 200)) {
      console.warn(`[Network] ${fullUrl} returned ${res.status}. Seamlessly falling back to Saleroom Simulation Engine.`);
      return simulationEngine.handleApiRequest<T>(path, options, token);
    }

    return data as T;
  } catch (err: any) {
    console.warn(`[Network] Fetch failed for ${fullUrl} (${err.message}). Seamlessly activating Saleroom Simulation Engine.`);
    return simulationEngine.handleApiRequest<T>(path, options, token);
  }
}

export class AuctionNetworkClient {
  private socket: WebSocket | null = null;
  private wsUrl: string;
  private token: string | null = null;
  public auctionId: string | null = null;
  public lastSeq = 0;
  public isConnected = false;
  public isSimulating = false;
  private simSocket: any = null;
  private callbacks: NetworkCallbacks;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private fallbackTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.wsUrl = getWsBaseUrl();
  }

  public setToken(token: string): void {
    const tokenChanged = this.token !== token;
    this.token = token;
    if (tokenChanged && this.socket && this.isConnected && !this.isSimulating) {
      this.reconnect();
    }
  }

  public connect(auctionId: string, initialToken?: string): void {
    this.auctionId = auctionId;
    if (initialToken) this.token = initialToken;

    if (isSimulationMode()) {
      this.activateSimulation();
      return;
    }

    this.initSocket();

    // Fallback safety: If on static Vercel (no backend attached), switch to simulation after 3s
    const isVercel = window.location.hostname.endsWith('vercel.app');
    if (this.fallbackTimeoutTimer) clearTimeout(this.fallbackTimeoutTimer);
    if (isVercel) {
      this.fallbackTimeoutTimer = setTimeout(() => {
        if (!this.isConnected && !this.isSimulating) {
          console.info('[Network] Remote backend unreachable. Activating Saleroom Simulation Engine.');
          this.activateSimulation();
        }
      }, 3000);
    }
  }

  private activateSimulation(): void {
    this.isSimulating = true;
    this.isConnected = true;
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.simSocket = simulationEngine.connectSocket(this.callbacks, this.auctionId || undefined);
    this.callbacks.onConnectionChange(true, simulationEngine.currentSeq, 'simulation');
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
      console.warn('[Network] WebSocket init failed:', err.message);
      this.activateSimulation();
      return;
    }

    this.socket.onopen = () => {
      if (this.fallbackTimeoutTimer) {
        clearTimeout(this.fallbackTimeoutTimer);
        this.fallbackTimeoutTimer = null;
      }
      this.isConnected = true;
      this.isSimulating = false;
      this.callbacks.onConnectionChange(true, this.lastSeq, 'live');

      if (this.auctionId) {
        this.send({
          type: 'sync',
          auction_id: this.auctionId,
          last_seq: this.lastSeq,
        });
      }

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
      this.callbacks.onConnectionChange(false, this.lastSeq, this.isSimulating ? 'simulation' : 'live');
    }
    this.stopHeartbeat();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.isSimulating) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('Attempting WebSocket reconnect...');
      this.initSocket();
    }, 2000);
  }

  public reconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.isSimulating) {
      this.activateSimulation();
    } else {
      this.initSocket();
    }
  }

  public simulateDrop(): void {
    if (this.isSimulating) {
      this.isConnected = false;
      this.callbacks.onConnectionChange(false, this.lastSeq, 'simulation');
      setTimeout(() => {
        this.isConnected = true;
        this.callbacks.onConnectionChange(true, this.lastSeq, 'simulation');
        this.callbacks.onSnapshot(simulationEngine.getSnapshot());
      }, 1500);
      return;
    }
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

  public async placeBid(amountCents: number, bidderId?: string, paddle?: string, color?: string, seatIdx?: number): Promise<BidResult> {
    if (this.isSimulating && this.simSocket) {
      return this.simSocket.placeBid(amountCents, bidderId, paddle, color, seatIdx);
    }

    if (!this.auctionId) throw new Error('No active auction');
    if (!this.isConnected || !this.socket) {
      // If disconnected, activate simulation fallback immediately
      this.activateSimulation();
      return this.simSocket.placeBid(amountCents, bidderId, paddle, color, seatIdx);
    }

    const idempotencyKey = `bid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    return new Promise((resolve, reject) => {
      this.inFlightBids.set(idempotencyKey, { amountCents, resolve, reject });

      this.send({
        type: 'bid',
        auction_id: this.auctionId!,
        amount_cents: amountCents,
        idempotency_key: idempotencyKey,
      });

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
