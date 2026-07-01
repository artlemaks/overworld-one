import { z } from 'zod';

/**
 * Environment schema (P1F-I-3 / OOM-11).
 *
 * Single source of truth for runtime configuration. Both /server and /client (server-side build
 * step) validate their env against this at boot — a missing/malformed var fails fast instead of
 * surfacing as a confusing runtime error. Mirror any change here in `.env.example`.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** WebSocket / HTTP server port. */
  PORT: z.coerce.number().int().positive().default(8080),
  /** Redis connection URL (authoritative counters, pub/sub). */
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  /** Postgres connection URL (durable events, participants, commemoratives). */
  DATABASE_URL: z.string().url().default('postgres://overworld:overworld@localhost:5432/overworld'),
  /** Server tick rate in Hz (P1 DoD requires >= 3). */
  TICK_HZ: z.coerce.number().min(3).max(10).default(4),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
export type Env = z.infer<typeof EnvSchema>;

/** Parse and validate an env-like record, throwing a readable error on failure. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
