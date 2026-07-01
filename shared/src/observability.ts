/**
 * Baseline observability (P1F-X-1 / OOM-15).
 *
 * Minimal, dependency-free primitives usable on both client and server:
 *  - structured JSON logger
 *  - error boundary wrapper
 *  - PostHog capture stub (real SDK wired later in P4/P6)
 *
 * Real-time metrics (tick rate, per-client bandwidth, latency percentiles) are added in P1-X-1
 * on top of this baseline.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Create a structured logger that emits one JSON object per line at or above `minLevel`. */
export function createLogger(component: string, minLevel: LogLevel = 'info'): Logger {
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const line = JSON.stringify({ level, component, msg, ...fields });
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

/**
 * Run `fn`, logging and re-throwing any error with context. Keeps error handling consistent
 * across entry points instead of ad-hoc try/catch.
 */
export async function withErrorBoundary<T>(
  logger: Logger,
  context: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.error('unhandled error', {
      context,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}

/** PostHog capture stub — swapped for the real SDK later. No-ops unless a sink is registered. */
export interface AnalyticsSink {
  capture(event: string, properties?: Record<string, unknown>): void;
}

let sink: AnalyticsSink | null = null;

export function registerAnalyticsSink(next: AnalyticsSink | null): void {
  sink = next;
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  sink?.capture(event, properties);
}
