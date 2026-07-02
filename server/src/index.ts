import { createServer } from 'node:http';
import Redis from 'ioredis';
import pg from 'pg';
import { parseEnv, createLogger, withErrorBoundary, type Env } from '@overworld/shared';
import { createRedisCounterStore } from './state/counters.js';
import { createRedisParticipantStore } from './state/participants.js';
import { createPostgresPersistence } from './state/persistence.js';
import { createRedisPubSub } from './state/pubsub.js';
import { createWsTransport } from './net/transport.js';
import { buildServer } from './buildServer.js';

/**
 * Server entry (P1 real-time core).
 *
 * Boots the full P1 graph against real infrastructure: an HTTP server (health + Prometheus metrics),
 * a `ws` transport sharing that port, and Redis-backed authoritative counters + pub/sub fan-out. The
 * actual wiring lives in `buildServer.ts` so this file only owns process concerns — env, connections,
 * routes, and graceful shutdown.
 */
async function main(env: Env): Promise<void> {
  const logger = createLogger('server', env.LOG_LEVEL);

  // One connection for commands + publish; a dedicated one for subscribe (ioredis requirement).
  const redis = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 });
  const redisSub = redis.duplicate();
  redis.on('error', (err) => logger.error('redis error', { error: err.message }));

  const counterStore = createRedisCounterStore(redis);
  const participantStore = createRedisParticipantStore(redis);
  const pubsub = createRedisPubSub(redis, redisSub);

  // Durable store — events, checkpoints, replay log, participants, commemoratives (P2).
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  pool.on('error', (err) => logger.error('postgres error', { error: err.message }));
  const persistence = createPostgresPersistence(pool);

  // Holder so the /metrics route can reach the graph once it is built (the transport needs the HTTP
  // server, which needs this handler — a reference cycle resolved by mutating a const holder).
  const graph: { built?: Awaited<ReturnType<typeof buildServer>> } = {};

  const httpServer = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', tickHz: env.TICK_HZ }));
      return;
    }
    if (req.url === '/metrics' && graph.built) {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      res.end(graph.built.metrics.renderPrometheus());
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const transport = createWsTransport(httpServer);
  const built = await buildServer({ env, counterStore, pubsub, transport, participantStore, persistence });
  graph.built = built;
  await built.start();
  logger.info('event recovery', { action: built.recovery?.action ?? 'none' });

  httpServer.listen(env.PORT, () => {
    logger.info('server listening', { port: env.PORT, tickHz: env.TICK_HZ });
  });

  const shutdown = async (): Promise<void> => {
    logger.info('shutting down');
    built.stop();
    await transport.close();
    await pubsub.close();
    await counterStore.close();
    await persistence.close();
    httpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

const env = parseEnv(process.env);
const logger = createLogger('server', env.LOG_LEVEL);
void withErrorBoundary(logger, 'server-bootstrap', () => main(env));
