import { runMigrations } from './db/migrate.js';
import { pool } from './db/pool.js';
import { eventBus } from './services/event-bus.js';
import { closingScheduler } from './services/closing-scheduler.js';
import { buildApp } from './http/app.js';
import { AuctionWebSocketServer } from './ws/server.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  closePoolOnShutdown?: boolean;
}

export async function startServer(options: ServerOptions = {}) {
  const PORT = options.port ?? Number(process.env.PORT) ?? 3000;
  const HOST = options.host ?? process.env.HOST ?? '127.0.0.1';
  const closePool = options.closePoolOnShutdown ?? true;

  // 1. Run database migrations
  await runMigrations();

  // 2. Start Postgres LISTEN/NOTIFY event bus
  await eventBus.start();

  // 3. Build Fastify app
  const app = buildApp();

  // 4. Attach WebSocket server to Fastify's raw http server
  const wsServer = new AuctionWebSocketServer(app.server);

  // 5. Start auction closing scheduler
  closingScheduler.start();

  // 6. Listen on PORT
  await app.listen({ port: PORT, host: HOST });
  console.log(`Auction Server running on http://${HOST}:${PORT}`);
  console.log(`WebSocket endpoint available at ws://${HOST}:${PORT}/ws`);

  const shutdown = async () => {
    closingScheduler.stop();
    wsServer.close();
    await eventBus.stop();
    await app.close();
    if (closePool) {
      await pool.end();
    }
  };

  return { app, wsServer, shutdown, port: PORT };
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  startServer()
    .then(({ shutdown }) => {
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('Fatal startup error:', err);
      process.exit(1);
    });
}
