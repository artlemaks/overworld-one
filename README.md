# Overworld One

Shared real-time MMO — a server-authoritative "everyone hits one boss" event loop.
See `PHASE_TASKS.md` for the full P-1→P6 plan and the OOM Jira board for task tracking.

## Stack

TypeScript monorepo (pnpm workspaces):

| Package   | Role                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| `shared/` | **Single source of truth** for wire contracts, checkpoint schema, env, observability. Imported by both sides. |
| `server/` | WebSocket + Redis authoritative core (P1). Currently a health-check stub.                                     |
| `client/` | Vite/Pixi client (P0). Currently a contract-wiring stub.                                                      |

## Prerequisites

- Node >= 20.19 (`.nvmrc`), pnpm 10.x (`corepack enable`), Docker (local Redis + Postgres).

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm dev          # docker compose up -d + run server & client in parallel
```

## Quality gates (mirrored in CI — .github/workflows/ci.yml)

```bash
pnpm -r typecheck   # both client & server compile against /shared (anti-drift check)
pnpm lint
pnpm format:check
pnpm test           # vitest — shared contract + checkpoint unit tests
pnpm -r build
```

## Foundation status (P-1)

Done: monorepo (OOM-9), toolchain + CI (OOM-10), docker-compose + env (OOM-11), shared
contracts (OOM-13), checkpoint schema (OOM-14), baseline observability (OOM-15).
Deferred: cloud provisioning (OOM-12) — see `infra/README.md`.
