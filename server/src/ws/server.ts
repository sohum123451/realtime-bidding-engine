import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'http';
import { URL } from 'url';
import { InboundMessageSchema, type OutboundMessage } from './protocol.js';
import { verifyBidderToken } from '../auth/token.js';
import { placeBid } from '../services/bid-service.js';
import { getAuction, getEventsSince, getAuctionSnapshot } from '../services/auction-service.js';
import { eventBus } from '../services/event-bus.js';

export interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  bidderId: string | null;
  subscribedAuctions: Set<string>;
}

export class AuctionWebSocketServer {
  private wss: WebSocketServer;
  private auctionSubscribers: Map<string, Set<ExtendedWebSocket>> = new Map();
  private eventBusUnsubscribers: Map<string, () => void> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request: IncomingMessage, socket, head) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      if (url.pathname === '/ws') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      }
    });

    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      this.handleConnection(ws as ExtendedWebSocket, request);
    });

    this.startHeartbeat();
  }

  private handleConnection(ws: ExtendedWebSocket, request: IncomingMessage): void {
    ws.isAlive = true;
    ws.subscribedAuctions = new Set();

    // Authenticate bidder from signed query token if present
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const token = url.searchParams.get('token');
    ws.bidderId = token ? verifyBidderToken(token) : null;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (data) => {
      ws.isAlive = true;
      try {
        const rawJson = JSON.parse(data.toString());
        const parseResult = InboundMessageSchema.safeParse(rawJson);

        if (!parseResult.success) {
          this.sendMessage(ws, {
            type: 'error',
            message: `Validation error: ${parseResult.error.message}`,
          });
          return;
        }

        const msg = parseResult.data;
        await this.handleMessage(ws, msg);
      } catch (err: any) {
        this.sendMessage(ws, {
          type: 'error',
          message: `Malformed message: ${err.message || 'unknown error'}`,
        });
      }
    });

    console.log(`[WS] Client connected: bidderId=${ws.bidderId}`);

    ws.on('close', (code, reason) => {
      console.log(`[WS] Client disconnected: code=${code}, reason=${reason ? reason.toString() : 'none'}`);
      this.cleanupSocket(ws);
    });

    ws.on('error', (err) => {
      console.warn('[WS] Client error:', err.message);
      this.cleanupSocket(ws);
    });
  }

  private async handleMessage(ws: ExtendedWebSocket, msg: any): Promise<void> {
    switch (msg.type) {
      case 'ping': {
        this.sendMessage(ws, { type: 'pong', timestamp: Date.now() });
        break;
      }

      case 'subscribe': {
        this.subscribeSocketToAuction(ws, msg.auction_id);
        break;
      }

      case 'unsubscribe': {
        this.unsubscribeSocketFromAuction(ws, msg.auction_id);
        break;
      }

      case 'sync': {
        const { auction_id, last_seq } = msg;
        this.subscribeSocketToAuction(ws, auction_id);

        const auction = await getAuction(auction_id);
        if (!auction) {
          this.sendMessage(ws, {
            type: 'error',
            message: `Auction ${auction_id} not found`,
          });
          return;
        }

        const currentSeq = Number(auction.seq);

        // If client has no history (last_seq === 0) or gap is too wide (> 50 events) or last_seq > currentSeq:
        // send full snapshot
        if (last_seq === 0 || last_seq > currentSeq || currentSeq - last_seq > 50) {
          const snapshot = await getAuctionSnapshot(auction_id);
          if (snapshot) {
            this.sendMessage(ws, {
              type: 'snapshot',
              auction_id,
              current_seq: currentSeq,
              auction: snapshot.auction,
              recent_events: snapshot.recentEvents,
            });
          }
        } else {
          // Replay missed events
          const missedEvents = await getEventsSince(auction_id, last_seq);
          this.sendMessage(ws, {
            type: 'sync_replay',
            auction_id,
            from_seq: last_seq,
            current_seq: currentSeq,
            events: missedEvents,
          });
        }
        break;
      }

      case 'bid': {
        const { auction_id, amount_cents, idempotency_key } = msg;

        if (!ws.bidderId) {
          this.sendMessage(ws, {
            type: 'bid_result',
            idempotency_key,
            accepted: false,
            reject_reason: 'unauthorized',
            current_price_cents: 0,
            amount_cents,
            seq: 0,
          });
          return;
        }

        try {
          const result = await placeBid({
            auctionId: auction_id,
            bidderId: ws.bidderId,
            amountCents: amount_cents,
            idempotencyKey: idempotency_key,
          });

          // Send definitive result back to this socket
          this.sendMessage(ws, {
            type: 'bid_result',
            idempotency_key,
            accepted: result.accepted,
            reject_reason: result.rejectReason,
            current_price_cents: result.currentPriceCents,
            amount_cents: result.amountCents,
            seq: result.seq,
            ends_at: result.endsAt,
          });
        } catch (err: any) {
          this.sendMessage(ws, {
            type: 'error',
            message: `Bid placement error: ${err.message}`,
          });
        }
        break;
      }
    }
  }

  private subscribeSocketToAuction(ws: ExtendedWebSocket, auctionId: string): void {
    ws.subscribedAuctions.add(auctionId);

    if (!this.auctionSubscribers.has(auctionId)) {
      this.auctionSubscribers.set(auctionId, new Set());

      // Subscribe this server instance to Postgres event-bus for this auction
      const unsubscribeBus = eventBus.subscribe(auctionId, (event) => {
        this.broadcastToAuction(auctionId, {
          type: 'event',
          auction_id: event.auction_id,
          seq: Number(event.seq),
          event_type: event.type,
          payload: event.payload,
          created_at: event.created_at,
        });
      });

      this.eventBusUnsubscribers.set(auctionId, unsubscribeBus);
    }

    this.auctionSubscribers.get(auctionId)!.add(ws);
  }

  private unsubscribeSocketFromAuction(ws: ExtendedWebSocket, auctionId: string): void {
    ws.subscribedAuctions.delete(auctionId);
    const subscribers = this.auctionSubscribers.get(auctionId);
    if (subscribers) {
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        this.auctionSubscribers.delete(auctionId);
        const busUnsub = this.eventBusUnsubscribers.get(auctionId);
        if (busUnsub) {
          busUnsub();
          this.eventBusUnsubscribers.delete(auctionId);
        }
      }
    }
  }

  private cleanupSocket(ws: ExtendedWebSocket): void {
    // A dropped socket must remove its subscriptions and nothing else.
    // It must NEVER touch auction state.
    for (const auctionId of ws.subscribedAuctions) {
      const subscribers = this.auctionSubscribers.get(auctionId);
      if (subscribers) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          this.auctionSubscribers.delete(auctionId);
          const busUnsub = this.eventBusUnsubscribers.get(auctionId);
          if (busUnsub) {
            busUnsub();
            this.eventBusUnsubscribers.delete(auctionId);
          }
        }
      }
    }
    ws.subscribedAuctions.clear();
  }

  private broadcastToAuction(auctionId: string, message: OutboundMessage): void {
    const subscribers = this.auctionSubscribers.get(auctionId);
    if (!subscribers) return;

    const payload = JSON.stringify(message);
    for (const ws of subscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  private sendMessage(ws: ExtendedWebSocket, message: OutboundMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((client) => {
        const extWs = client as ExtendedWebSocket;
        if (!extWs.isAlive) {
          extWs.terminate();
          return;
        }
        extWs.isAlive = false;
        extWs.ping();
      });
    }, 15000);
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const unsub of this.eventBusUnsubscribers.values()) {
      unsub();
    }
    this.eventBusUnsubscribers.clear();
    this.auctionSubscribers.clear();
    this.wss.close();
  }
}
