# Overworld One — MVP Phase Task Breakdown (v2)

> **Source:** `Overworld_One_MVP_Scope.docx` (v1.0, July 2026)
> **Build approach:** agentic coding with Claude Code
> **Produced by:** `/v-team` — two independent persona-critique passes
> (run 1: Architect · Delivery · Completeness; run 2: Architect · Delivery · Product & Live-ops).
> **v2 supersedes v1** — same 8-phase spine, now with workstream tags, stable task IDs, and the
> live-ops / monetization-enforcement findings from the second panel.

---

## How to read this document

Phases run **P-1 → P6**. Each task carries a **workstream tag** and a **stable ID** (`<phase>-<stream>-<seq>`):

`[C]` client · `[S]` server · `[I]` infra/devops · `[D]` data · `[P]` product/content · `[X]` live-ops/anti-cheat.

Each phase lists: **Objective · Depends on · Tasks · Deliverables/DoD · Primary risk · Tests to write**.
Task sizes: `S` ≈ ≤1d · `M` ≈ 2–4d · `L` ≈ 1wk+.

### Timeline (decision — ADR-001)

The scope budgets ~3–4 months but assumes repo/infra/contracts exist. We add a **P-1 Foundation** phase
and **accept a realistic ~4–4.5 months** rather than compress the foundation.

| Phase | Duration | Cumulative |
|-------|----------|-----------|
| P-1 Foundation | ~1 wk | wk 1 |
| P0 Prototype | 1–2 wk | wk 2–3 |
| **P1 Real-time core + scale** | **3 wk (fixed)** | wk 4–6 |
| P2 Full event loop | 2–3 wk | wk 6–9 |
| P3 Scheduler / campaigns / roles / reskins | 2 wk | wk 9–11 |
| P4 Accounts / pass / monetization | 2–3 wk | wk 11–14 |
| P5 Scale hardening + polish | 3–4 wk | wk 14–18 |
| P6 Soft launch | ongoing | — |

**≈ 16–18 weeks (~4–4.5 months) to soft launch.** Real-time scale is the primary technical risk and is
validated **early in P1**, not deferred to P5.

### Cross-cutting decision gates

- **WS library** (uWebSockets.js vs Socket.IO) — decide at **P1 start**.
- **Payment provider** (Stripe vs Paddle — merchant-of-record / global tax) — decide + validate the API
  surface at a **pre-P4 gate (end of P3)**; it's P4's critical path.

---

## P-1 · Foundation, infra & contracts  *(~1 wk)*

**Objective:** a working monorepo, CI, local + cloud environments, and the shared contracts (including
the checkpoint schema) so P0/P1 build against real infrastructure without drift.

**Depends on:** nothing.

### Tasks
- **P1F-I-1** `[I]` `S` — Monorepo: pnpm workspaces (`/client` `/server` `/shared`) + TS project refs.
- **P1F-I-2** `[I]` `M` — Toolchain (Vite, tsx/esbuild, ESLint/Prettier) + GitHub Actions CI
  (typecheck/lint/test/build on PR).
- **P1F-I-3** `[I]` `M` — Local `docker-compose` (Redis + Postgres); `.env` schema + example;
  `pnpm dev` one-command boot.
- **P1F-I-4** `[I]` `M` — Cloud provisioning: Fly.io/Railway project, managed Redis + managed Postgres,
  secrets/region config, minimal deploy pipeline (so P1 load-tests against real infra).
- **P1F-S-1** `[S/C]` `M` — Shared real-time contracts in `/shared`: contribution message
  `{playerId, actionType, inputParams, clientTs}`, tick snapshot `{eventState, aggregateStats, serverTs}`,
  event state `{bossHp, phase, phaseProgressPct, contribWaveCount, playersContributingNow}`.
- **P1F-D-1** `[D]` `S` — *(panel)* Checkpoint/replay **schema design** (event snapshot shape,
  checkpoint cadence, replay-log format) so P1 testing and P2 implementation aren't blocked.
- **P1F-X-1** `[X]` `S` — Baseline observability: structured logging, error boundary, PostHog stub.

**Deliverables / DoD:** `pnpm dev` boots the full stack locally; CI green; a cloud deploy succeeds;
`/shared` contracts + checkpoint schema compile and are imported by both client and server.

**Primary risk:** contract drift in an agentic build → fixed by co-designing `/shared` (P1F-S-1) + the
checkpoint schema (P1F-D-1) up front.

**Tests to write:** contract type-compile check (both sides import `/shared`); CI smoke build.

---

## P0 · Single-player boss prototype  *(1–2 wk)*

**Objective:** prove the "ten-second contribution, visible impact" feel — client-only — and gate on it
before adding netcode.

**Depends on:** P-1.

### Tasks
- **P0-C-0** `[C]` `S` — *(panel)* Landing & "Join the fight" flow: one button → issue anonymous token
  → connect → enter arena. Target **<1s to first contribution**.
- **P0-C-1** `[C]` `M` — Pixi/Vite bootstrap: canvas, responsive resize, fixed-timestep loop.
- **P0-C-2** `[C]` `M` — Arena scene: boss sprite, HP bar, phase label, background.
- **P0-C-3** `[C]` `M` — Contribution action (aim-and-strike / timing), mouse + touch, input buffering.
- **P0-C-4** `[C]` `S` — Local scoring placeholder shaped to the `/shared` contract (replaced in P1).
- **P0-C-5** `[C]` `M` — Feedback juice: number pops, screen shake, particles, SFX hooks, HP tween.
- **P0-C-6** `[C]` `M` — Personal heat/combo meter (self-only effectiveness; **never buyable**).
- **P0-C-7** `[C]` `S` — Local phase transitions at HP thresholds.
- **P0-C-8** `[C]` `M` — Mobile layout (portrait+landscape, touch targets, reduced-motion toggle).

**Deliverables / DoD:** 60fps boss-strike loop on desktop + mobile; combo affects local effectiveness;
phases fire; **internal playtest gate — a 2-min session confirms the combo loop feels rewarding** (de-
risks the "shallow/repetitive action" MED risk 4–5 weeks before beta; pivot here if it doesn't land).

**Primary risk:** action feels shallow (scope §13, MED) → mitigated by depth in input+combo, juicy
feedback, and the early playtest gate.

**Tests to write:** unit — contribution-point calc; unit — combo/heat scaling; manual — 60fps + the
playtest feel gate.

---

## P1 · Real-time core + early scale validation  *(3 wk, fixed)* — ⚠ PRIMARY TECHNICAL RISK

**Objective:** many clients on **one server-authoritative bar** with **constant per-client bandwidth**,
proven under realistic load **before** features are built on top.

**Depends on:** P0 (arena) + P-1 (Redis/Postgres, contracts, cloud, checkpoint schema).

**Sub-phasing (panel):** wk 1–1.5 netcode impl → wk 2 harness build → wk 2.5–3 load-test + iterate.

### Tasks
- **P1-S-1** `[S]` `M` — WS server (uWebSockets.js / Socket.IO fallback): connection lifecycle, heartbeat.
- **P1-S-2** `[S/D]` `M` — Redis authoritative counters via atomic ops; **schema forward-designed** so
  Boss `{hp, phase}` extends to Structure `{height}` and Threat `{distance}` with no P3 migration.
- **P1-S-3** `[S]` `M` — Contribution ingest: server-side validation + rate limit; **server computes the
  point value** (a client can't assert its own number).
- **P1-S-4** `[S]` `S` — Rate-limit seam: per-IP now, IP-keyed counters designed to coexist with the
  per-account limits added in P4 (documented transition, not a rewrite).
- **P1-S-5** `[S]` `L` — Tick broadcast (3–5 Hz) **+ contribution-wave aggregation**: server samples
  recent contribution deltas over a short rolling window into the aggregate payload; **per-client
  bandwidth constant regardless of player count**.
- **P1-S-6** `[S]` `M` — Redis pub/sub fan-out across stateless WS nodes.
- **P1-S-7** `[S]` `S` — Aggregate presence ("players now") from sampled rates; no per-player positions.
- **P1-C-1** `[C]` `M` — Client netcode: connect, reconnect/backoff, apply ticks, interpolate, reconcile
  local prediction (replaces P0 local scoring).
- **P1-X-1** `[X]` `M` — Real-time observability: tick rate, **per-client bandwidth**, latency
  percentiles, Redis op latency, queue depth + baseline dashboard (makes the DoD measurable).
- **P1-X-2** `[X]` `M` — Early anti-cheat: contribution-rate anomaly detection + value validation.
  **Threat model = simple rapid-fire + value inflation**; PoW/hCaptcha (P5) is later defense-in-depth,
  not required for the P1 gate.
- **P1-X-3** `[X]` `S` — *(panel)* Off-peak / slow-event scheduler **design** (async job queue, slow-event
  config schema) so the empty-arena HIGH risk is validated architecturally now (impl lands P3).
- **P1-I-1** `[I]` `L` — *(panel)* **Mixed-population** load harness: ~70% realistic clients (1–3
  contributions/session) + ~30% stress bots, run against cloud infra **before P2**. Scope = **scale**,
  not durability (durability validated in P2 once checkpoint/replay exists).

**Deliverables / DoD (measured):** 1000+ concurrent clients on one bar; per-client bandwidth constant
(±5%); tick ≥3 Hz stable; **≥80% of realistic-population clients contribute within 30s of connect**;
server rejects inflated values (<1% inflation under synthetic rapid-fire/value cheat).

**Primary risk:** real-time scale/cost (scope §13, HIGH) → tick-based constant bandwidth, stateless
nodes + pub/sub, and **load-testing here**, not in P5.

**Tests to write:** integration — ingest→Redis atomic→tick includes delta (no lost/doubled across
nodes); load — mixed-population constant bandwidth @1000+ + ≥80%-in-30s; property — server-auth +
rate/anomaly rejects synthetic cheat.

---

## P2 · Full event loop  *(2–3 wk)*

**Objective:** a complete, campaign-ready event — phases, XP, resolution, commemoratives — that survives
a Redis restart and can be orchestrated later.

**Depends on:** P1 + P-1 checkpoint schema.

### Tasks
- **P2-S-1** `[S]` `M` — Event lifecycle FSM (pending→active→phase-N→resolving→resolved/failed).
  **DoD clause (panel): the FSM is orchestratable by P3 campaign chaining without structural rework**
  (campaign-aware pacing documented).
- **P2-S-2** `[S]` `M` — Phase pacing with target completion window; server-driven transitions.
- **P2-D-1** `[D]` `M` — Per-player tracking: Redis hash `contribution:{eventId}:{playerId}`.
- **P2-S-3** `[S]` `M` — Event XP engine: per-contribution XP scaled by combo, cap/diminishing returns.
- **P2-D-2** `[D]` `M` — Postgres schema: `events`; `event_participants`
  (event_id, player_id, contribution_total, tier, xp_earned, participation_duration, last_update_ts);
  `players`; `player_commemoratives` (rarity, earned_at, **expires_at**).
- **P2-D-3** `[D]` `M` — Checkpoint (every 30s + on phase change) / replay (60s window) Redis→Postgres
  (implements the P-1 schema).
- **P2-S-4** `[S]` `M` — Resolution flow: checkpoint final tallies, compute tiers, grant rewards.
- **P2-X-1** `[X]` `M` — *(panel)* Event **auto-recovery**: on load, resume from latest checkpoint if
  within ~5 min of last heartbeat; otherwise force-resolve the prior event and start fresh (no manual
  state editing).
- **P2-P-1** `[P]` `M` — Time-limited / rarity commemoratives (FOMO badges, event-scoped expiry).
- **P2-C-1** `[C]` `M` — Resolution screen: outcome, tier, commemorative, XP/pass progress, next-event timer.

**Deliverables / DoD:** an event runs phases→resolution; XP + rewards + commemoratives granted and
**reconciled after a Redis restart within the 60s window**; auto-recovery resumes or cleanly resets.

**Primary risk:** state/reward corruption on restart → checkpoint/replay (P2-D-3) + auto-recovery
(P2-X-1); events tolerate minor counter imprecision (shared bar, not a ledger).

**Tests to write:** integration — lifecycle transitions; e2e — checkpoint→Postgres + restart replay
within 60s + auto-recovery; unit — XP accrual + tier calc.

---

## P3 · Scheduler, campaigns, roles, reskins & live-ops console  *(2 wk)*

**Objective:** the world is never empty; events recur unattended, chain into campaigns, offer roles,
ship in 3 archetypes — and an operator can actually run them.

**Depends on:** P2 + P1.

### Tasks
- **P3-X-1** `[X]` `M` — Event scheduler: cadence start/stop; per-event config (type, duration, pacing).
- **P3-X-2** `[X]` `M` — Off-peak always-on slow event (implements P1-X-3 design; empty-arena mitigation).
- **P3-P-1** `[P]` `L` — Campaign arc / event-chaining engine: narrative sequence, escalation curve,
  beats; orchestrates the P2-S-1 FSM.
- **P3-S-1** `[S/C]` `M` — Roles system (striker/supporter/rallier): selection at event start, light
  mechanical distinction, **all free** (cosmetics wired in P4).
- **P3-C-1** `[C]` `S` — Next-event countdown widget (landing + arena HUD).
- **P3-S-2** `[S]` `M` — Event archetype abstraction (shared engine + per-archetype config/assets).
- **P3-P-2** `[P]` `M` — Reskin: Rising Structure (height/completion %, place blocks).
- **P3-P-3** `[P]` `M` — Reskin: Advancing Threat (distance to town, push back/reinforce).
- **P3-X-3a** `[C]` `L` — *(panel)* Live-ops admin console **UI** (web): event schedule/start/stop, live
  CCU/tick graph, pacing sliders, name/report queue with bulk actions.
- **P3-X-3b** `[S/C]` `M` — *(panel)* Event-control API + console controls: editable phase thresholds,
  extend/cut window, pause/resume, force-resolve — all **audit-logged**.

**Deliverables / DoD:** scheduler + slow event run **unattended**; a campaign chains events with
escalation; **3 archetypes** playable; roles selectable (no power effect); an operator can start/stop,
tune pacing, and control a live event from the console UI.

**Primary risk:** empty-arena at low CCU (scope §13, HIGH) → always-on slow event + scheduled marquee
events; design was validated in P1-X-3.

**Tests to write:** integration — scheduler start/stop unattended; feature — campaign chaining order +
escalation; e2e — role selection has no power effect; e2e — operator event-control flow (adjust/pause/
force-resolve) leaves outcome integrity intact.

---

## P4 · Accounts, identity screens, pass & monetization  *(2–3 wk)*

**Objective:** zero-friction accounts, the full identity/cosmetic surface, and light, **provably
non-pay-to-win** monetization — live and reconciled.

**Depends on:** P2 (XP/rewards) + P3 (roles, campaigns). **Pre-gate:** payment provider chosen +
API-surface validated by end of P3.

### Tasks
- **P4-S-1** `[S]` `M` — Anonymous device account: token issue/persist; session auth on WS + HTTP.
- **P4-S-2** `[S]` `M` — Optional email upgrade (magic link).
- **P4-P-1** `[P]` `M` — Privacy & consent: tracking disclosure, GDPR email consent, retention policy,
  opt-out; **privacy review gate in DoD**.
- **P4-C-1** `[C]` `M` — Player profile: events attended, milestones, equipped cosmetics.
- **P4-D-1** `[D]` `S` — Streak tracking: attendance streak persisted at resolution; shown on profile.
- **P4-P-2** `[P]` `L` — Cosmetics system: avatar, strike/contribution VFX, cheer emotes, badges, name
  flair, **role-flavored variants**.
- **P4-C-2** `[C]` `M` — Wardrobe screen (catalog, equip slots, preview).
- **P4-C-3** `[C]` `M` — Settings screen (audio, reduced-motion/accessibility, account upgrade, privacy).
- **P4-D-2** `[D]` `M` — Premium currency ("sparks") ledger.
- **P4-P-3** `[P]` `L` — Event/season pass: free + premium lanes; XP→tier; reconciled at resolution;
  campaign-track UI. **Free and premium XP curves are provably identical — premium unlocks cosmetics/
  commemoratives only, never faster progression.**
- **P4-P-4** `[P]` `M` — Store: cosmetic catalog + purchase flow ($1.99–$6.99 bands).
- **P4-S-3a** `[S]` `M` — *(panel split)* Payment SDK integration (chosen provider).
- **P4-S-3b** `[S]` `M` — *(panel split)* Payment business logic: webhooks, receipts, entitlement grant.
- **P4-P-5** `[P]` `S` — "Vanguard Kit" one-time bundle ($9.99): profile flair, +cosmetic slots,
  commemorative album — status/expression only.
- **P4-P-6** `[P]` `M` — Rewarded ads: SDK, opt-in, spark top-up / cosmetic boost skin (visual only).
- **P4-S-4** `[S]` `S` — Rate-limit account extension (account-keyed limits alongside P1 IP-keyed).
- **P4-X-1** `[X]` `M` — *(panel — rewritten)* **Enforced** monetization guardrail: backend
  contribution/heat multiplier **hard-capped at 1.0× regardless of pass tier or purchases**; cosmetics
  catalog validated to contain no power-affecting items; automated unit + **e2e guardrail test in DoD**.
- **P4-X-2** `[X]` `S` — *(panel)* Rate-limit transition test: IP↔account coexistence, shared-IP
  multi-user scenario, no regressive throttling.

**Deliverables / DoD:** pass + store live and reconciled; payments end-to-end in test mode; privacy
review passed; **guardrail e2e verified — buying the premium pass/bundle changes nothing about personal
heat, XP rate, or the global tally.**

**Primary risk:** monetization vs fairness (scope §13, Low but brand-critical) → enforced 1.0× cap +
identical XP curves + the guardrail test (P4-X-1). Secondary: payment provider is the critical path →
pre-gate decision + split tasks (P4-S-3a/b).

**Tests to write:** integration — device→email upgrade; integration — payment webhook → entitlement;
unit — pass reconciliation from XP; unit — streak persistence; feature — privacy consent gating;
**e2e — monetization guardrail (no purchase affects heat/XP/outcome)**; property — rate-limit transition.

---

## P5 · Scale hardening, moderation & polish  *(3–4 wk)* — SOAK, NOT DISCOVERY

**Objective:** take the *proven* P1 model to **target CCU under soak**, make moderation real, and polish
to a clip-worthy launch bar.

**Depends on:** P1–P4.

### Tasks
- **P5-I-1** `[I]` `L` — Soak at target CCU; autoscale stateless nodes; graceful tick-rate degradation.
- **P5-X-1** `[X]` `M` — Anti-cheat hardening: tune rate/anomaly thresholds from data; **hCaptcha/PoW
  light challenge on first contribution** (defense-in-depth); bot/spam validation.
- **P5-X-2** `[X]` `M` — Display-name moderation: filter + report queue (no free text; curated
  cheers/emotes only).
- **P5-X-2a** `[C]` `S` — *(panel)* Player **report UI**: report button in contribution/milestone
  context; reason + short free-text; submit to backend.
- **P5-X-2b** `[S]` `M` — *(panel)* Report ingestion & queue: store reports + player context; surface in
  the admin console (P3-X-3a).
- **P5-X-3a** `[S/C]` `M` — *(panel)* Extend event-control API + console for mid-event pacing ops
  (thresholds, window, pause/resume, force-resolve) with audit log — hardened for production use.
- **P5-P-1** `[P]` `L` — Art & audio pass: final VFX/SFX/music; clip-worthy milestone/completion beats.
- **P5-C-1** `[C]` `M` — Accessibility: reduced-motion, audio controls, contrast, keyboard/touch.
- **P5-X-4** `[X]` `M` — Live-ops observability: dashboards (concurrency, event health, contribution
  distribution, payer cohorts, abuse signals) + alerts (tick degradation, bot patterns, event timeouts).
- **P5-P-2** `[P]` `L` — Closed beta: invite cohort; metrics + feedback; **re-verify ≥80%-in-30s on real
  clients**.

**Deliverables / DoD (launch gate — scope §11):**
- Holds at **target CCU** with **constant per-client bandwidth + stable tick**.
- **Server-authoritative scoring resists trivial cheats** under test.
- **Scheduler runs recurring + off-peak events without manual babysitting**; operators can moderate and
  control events from the console.
- **Pass + store live and reconciled; commemoratives granted correctly at resolution.**

**Primary risk:** cost/scale at real concurrency + bot influx → autoscale, graceful degradation,
challenge-on-first-contribution, live abuse alerting.

**Tests to write:** load/soak — target CCU sustained; anti-cheat — rate/anomaly + challenge e2e;
feature — report flow (UI→queue→admin action); beta — ≥80%-in-30s on real clients.

---

## P6 · Soft launch  *(ongoing)*

**Objective:** measure, tune, and feed the organic-growth loop.

**Depends on:** P5 (launch gate passed).

### Tasks
- **P6-X-1** `[X]` `M` — Analytics dashboards: CCU (peak/avg), %contribute-in-30s (>80%), completion
  rate, time-to-complete vs window, virality/K-factor, D1/D7 + return, attendance streaks, payer
  conversion, ARPDAU, pass attach, ad opt-in.
- **P6-X-2** `[X]` `M` — Live-ops runbook: schedule marquee events; tune pacing/difficulty/cadence from
  data via the P3/P5 event-control tooling.
- **P6-P-1** `[P]` `M` — Marketing / clip beats: capture + distribute shareable milestone/completion
  moments (TikTok/Shorts hooks).
- **P6-X-3** `[X]` ongoing — Post-launch tuning loop (pacing, difficulty, event cadence).

**Deliverables / DoD:** recurring events run unattended; the full metric suite is tracked; a tuning loop
is established and feeding decisions.

**Primary risk:** retention/virality underperform → the analytics suite + tuning loop exist to detect
and correct quickly.

---

## Consolidated test backlog

| id | phase | kind | target | intent | priority |
|----|-------|------|--------|--------|----------|
| a-t1 | P1 | load | mixed-population bandwidth @1000+ CCU + ≥80%-in-30s | tick scales; metric valid under realistic mix | must |
| a-t2 | P1 | integration | ingest→Redis atomic→tick delta across nodes | no lost/doubled contributions | must |
| a-t3 | P2 | e2e | checkpoint→Postgres + Redis-restart replay (60s) + auto-recovery | durability within loss window | must |
| d-t1 | P1 | load | ramp to target CCU (early spike) | de-risk primary risk before features | must |
| d-t2 | P1 | property | server-auth cheat resistance (rapid-fire + value) | <1% inflation (PoW-independent) | should |
| d-t3 | P4 | e2e | payment provider SDK+webhooks+entitlement | validate integration before P4 midpoint | must |
| p-t1 | P2/P4 | integration | XP → pass progression | free/premium lanes progress; curves identical | must |
| p-t2 | P3/P4 | feature | campaign chain + streak | events chain in order; streak persists | must |
| p-t3 | P4 | e2e | monetization guardrail | no purchase affects heat/XP/global outcome | must |
| p-t4 | P3/P5 | e2e | live-ops event control | operator start/pause/adjust/force-resolve; outcome integrity | must |
| p-t5 | P5 | feature | player report → queue → admin action | report lands with context; no false-positive block | should |
| x-t1 | P4 | property | rate-limit IP↔account coexistence | no shared-IP throttling regression | should |

---

## Scope traceability (every in-scope system → its phase)

| Scope item (§) | Phase(s) |
|----------------|----------|
| Global objective / authoritative counters (§5.1, §7.2) | P1 |
| Skill-lite action + heat/combo (§5.2) | P0 |
| Event XP + contribution points (§5.2) | P2, P4 |
| Roles: striker/supporter/rallier (§5.2) | P3, P4 |
| Commemoratives + rarity + FOMO expiry (§5.3, §10) | P2 |
| Player profile / status surface (§5.3, §9) | P4 |
| Live map / aggregate crowd presence + contribution waves (§5.4, §7.2) | P1 |
| Seasonal campaigns / narrative arc (§5.4) | P3, P4 |
| Phases + scheduler + off-peak slow event (§5.1) | P1 (design), P2, P3 |
| Reskins: Structure, Threat (§5.1) | P3 |
| Anonymous account + email upgrade (§6, §7.1) | P4 |
| Event/season pass (§8) | P4 |
| Cosmetic store, rewarded ads, Vanguard Kit (§8) | P4 |
| Monetization fairness / non-P2W guardrail (§8) | P4 (enforced + tested) |
| UX screens: landing, arena, resolution, profile, store/pass, wardrobe, settings (§9) | P0/P2/P4 |
| Retention: streaks, countdowns, campaign arc, FOMO (§10) | P2, P3, P4, P6 |
| Real-time model + scaling (§7.2) | P1, P5 |
| Data & consistency: checkpoint/replay + recovery (§7.3) | P-1, P2 |
| Anti-cheat, safety, moderation, reports (§7.4) | P1, P5 |
| Live-ops admin: schedule/start/stop, tune, moderate, control (§6) | P3, P5 |
| Analytics & success criteria (§11) | P1 (gates), P5, P6 |
| Cloud hosting / stateless WS + managed Redis/Postgres (§7.1) | P-1 |

**Explicitly out of scope (§6 — do NOT build in MVP):** live position-synced avatars across a world
map; multiple simultaneous global objectives; free-text chat + full guilds; native/console/Steam apps;
deep PvP / competitive leaderboards.

---

*Change log: v2 (2026-07-01) — added workstream tags + task IDs; second `/v-team` panel added live-ops
console UI, event-control API, player reporting, event auto-recovery, enforced monetization guardrail,
mixed-population load harness, early empty-arena design, checkpoint schema in P-1, campaign-aware FSM,
landing/join flow, P0 action-feel gate, and payment critical-path handling. Supersedes v1.*
