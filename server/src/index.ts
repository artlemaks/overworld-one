import { createServer } from 'node:http';
import {
  parseEnv,
  createLogger,
  withErrorBoundary,
  TickSnapshot,
  type Env,
} from '@overworld/shared';

/**
 * Minimal server entry (P-1 foundation).
 *
 * This is intentionally thin: it proves the /server package boots against the SHARED contracts
 * (`@overworld/shared`) and validated env. The real WebSocket server, Redis counters, and tick
 * broadcast land in P1 (OOM-25..36).
 */
async function main(env: Env): Promise<void> {
  const logger = createLogger('server', env.LOG_LEVEL);

  // Prove the tick contract is usable here (same schema the client will consume).
  const sampleTick = TickSnapshot.parse({
    eventState: {
      bossHp: 1000,
      phase: 'pending',
      phaseProgressPct: 0,
      contribWaveCount: 0,
      playersContributingNow: 0,
    },
    aggregateStats: { contribDelta: 0, contribRate: 0 },
    serverTs: 0,
  });

  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', tickHz: env.TICK_HZ }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(env.PORT, () => {
    logger.info('server listening', { port: env.PORT, tickHz: env.TICK_HZ });
    logger.debug('initial tick contract validated', { phase: sampleTick.eventState.phase });
  });
}

const env = parseEnv(process.env);
const logger = createLogger('server', env.LOG_LEVEL);
void withErrorBoundary(logger, 'server-bootstrap', () => main(env));
