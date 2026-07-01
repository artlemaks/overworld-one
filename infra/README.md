# Infra / cloud provisioning (P1F-I-4 · OOM-12) — DEFERRED

This task is **not done** — it needs credentials only the project owner has. Tracked as OOM-12
(To Do). What remains:

1. Create a Fly.io (or Railway) project and authenticate the CLI (`fly auth login`).
2. Provision **managed Redis** and **managed Postgres**; capture their URLs.
3. Set secrets: `REDIS_URL`, `DATABASE_URL` (schema: `shared/src/env.ts`).
4. Choose region(s) close to expected players; set `primary_region` in `fly.server.toml`.
5. Add a server `Dockerfile`, fill `fly.server.toml`, run `fly deploy`.
6. Point the CI a deploy job at the provisioned app once secrets are in GitHub Actions.

Rationale for provisioning _now_ (per ADR-001): P1 load-tests the real-time core against **real**
infra, not local Docker — so the cloud environment must exist before P1 (OOM-36 load harness).

Local development does **not** need any of this — `docker compose up` (Redis + Postgres) covers it.
