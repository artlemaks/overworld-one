# Overworld One — MVP Phase Task Breakdown

> **Source:** `Overworld_One_MVP_Scope.docx` (v1.0, July 2026)
> **Build approach:** agentic coding with Claude Code
> **Deliverable of this doc:** a detailed, per-phase task list to take Overworld One from empty repo to soft launch.
> **Produced by:** `/v-team` (Technical Architect · Delivery Planner · Completeness critic panel).

---

## How to read this document

Phases run **P-1 → P6**. Each phase has:

- **Objective** — what "done" unlocks.
- **Depends on** — the phase(s) that must land first.
- **Tasks** — itemized, dependency-ordered; each with a rough size (`S` ≈ ≤1d, `M` ≈ 2–4d, `L` ≈ 1wk+).
- **Deliverables / DoD** — measurable exit criteria (tied to the scope's success gates).
- **Primary risk** — the thing most likely to hurt, and how this phase de-risks it.
- **Tests to write** — the regression guard(s) that outlive the phase.

### Timeline note (decision)

The scope budgets **~3–4 months**. This plan adds a **P-1 Foundation** phase (not in the scope
roadmap) because every later phase assumes repo/infra/contracts exist. **Decision: keep P-1 as its own
timeboxed ~1-week phase and accept a realistic total of ~4–4.5 months.** Indicative rollup:

| Phase | Duration | Cumulative |
|-------|----------|-----------|
| P-1 Foundation | ~1 wk | wk 1 |
| P0 Prototype | 1–2 wk | wk 2–3 |
| P1 Real-time core + scale | 2–3 wk | wk 4–6 |
| P2 Full event loop | 2–3 wk | wk 6–9 |
| P3 Scheduler / campaigns / roles / reskins | 2 wk | wk 9–11 |
| P4 Accounts / pass / monetization | 2–3 wk | wk 11–14 |
| P5 Scale hardening + polish | 3–4 wk | wk 14–18 |
| P6 Soft launch | ongoing | — |

**≈ 16–18 weeks (~4–4.5 months) to soft launch.** The real-time scale test (started in P1, matured in
P5) is the primary technical-risk item and is validated **early** per the scope's own mitigation.

### Cross-cutting decisions still open

- **WS library:** uWebSockets.js (max perf/connections) vs Socket.IO (ergonomics, transport
  fallbacks) — decide in P1.
- **Payment provider:** Stripe vs Paddle (merchant-of-record / global tax handling) — decide before P4.

---

## P-1 · Foundation, infra & contracts  *(~1 wk)*

**Objective:** a working monorepo, CI, local + cloud environments, and the shared client↔server
contracts — so P0/P1 can be built and load-tested against real infrastructure.

**Depends on:** nothing (first phase).

### Tasks
1. **Monorepo scaffold** `S` — pnpm workspaces with `/client`, `/server`, `/shared`; TypeScript project
   references; shared base `tsconfig`.
2. **Toolchain** `S` — Vite (client), tsx/esbuild (server), ESLint + Prettier, editorconfig.
3. **CI pipeline** `M` — GitHub Actions: typecheck, lint, unit tests, build on every PR.
4. **Local dev environment** `M` — `docker-compose` with Redis + Postgres; `.env` schema + `.env.example`;
   one-command bootstrap (`pnpm dev`).
5. **Cloud infra provisioning** `M` *(added by panel — scope §7.1)* — Fly.io/Railway project; **managed**
   Redis + **managed** Postgres; secrets + region config; a minimal deploy pipeline so P1 can load-test
   against real infra (not just localhost).
6. **Shared real-time contracts** `M` *(added by panel — scope §7.2)* — exact TypeScript interfaces in
   `/shared`, co-designed before P0/P1 diverge:
   - Contribution message: `{ playerId, actionType, inputParams, clientTs }`
   - Tick snapshot: `{ eventState, aggregateStats, serverTs }`
   - Event state: `{ bossHp, phase, phaseProgressPct, contribWaveCount, playersContributingNow }`
7. **Baseline observability** `S` — structured logging, top-level error boundary, PostHog client stub.

**Deliverables / DoD:** `pnpm dev` boots client + server + Redis + Postgres locally; CI green on a
trivial PR; a deploy to Fly.io/Railway succeeds; `/shared` contracts compile and are imported by both
client and server stubs.

**Primary risk:** contract drift between client and server in an agentic build → mitigated by fixing
`/shared` interfaces up front (task 6).

**Tests to write:** contract type-compile check (client + server both import `/shared`); CI smoke build.

---

## P0 · Single-player boss prototype  *(1–2 wk)*

**Objective:** prove the core "ten-second contribution, visible impact" feel — entirely client-side,
no server yet.

**Depends on:** P-1 (repo, Pixi/Vite toolchain, contracts).

### Tasks
1. **Pixi app bootstrap** `M` — Vite + PixiJS canvas, responsive resize, fixed-timestep render loop.
2. **Arena scene** `M` — boss sprite, boss HP bar UI, phase label, background layers.
3. **Contribution action** `M` — skill-lite input (aim-and-strike / timing tap); mouse **and** touch
   handling; input buffering.
4. **Local scoring** `S` — client-side contribution-point calc + local HP decrement (explicit
   placeholder to be replaced by server authority in P1; wired through the `/shared` contract shape).
5. **Feedback juice** `M` — hit numbers pop, screen shake, particle VFX, SFX hooks, HP-bar tween.
6. **Personal heat/combo meter** `M` *(scope §5.2)* — local combo chain that scales *your own*
   effectiveness only; **never purchasable** (fairness guardrail).
7. **Boss phase transitions (local)** `S` — HP thresholds trigger phase-change animation/state.
8. **Mobile layout pass** `M` — portrait + landscape, touch-target sizing, reduced-motion toggle.

**Deliverables / DoD:** a satisfying single-player boss-strike loop running at **60 fps on desktop and
mobile browser**; combo meter affects local effectiveness; phases change at HP thresholds.

**Primary risk:** the action feels shallow/repetitive (scope §13) → mitigated by depth in the
input + combo system and juicy feedback; validate feel with playtests before P1.

**Tests to write:** unit — contribution-point calc; unit — combo/heat scaling; manual — 60 fps + feel
on desktop + mobile.

---

## P1 · Real-time core + early scale validation  *(2–3 wk)* — ⚠ PRIMARY TECHNICAL RISK

**Objective:** many clients on **one shared, server-authoritative bar** with **constant per-client
bandwidth** — and prove it scales *before* building features on top.

**Depends on:** P0 (client arena) + P-1 (Redis/Postgres, contracts, cloud infra).

### Tasks
1. **WS server** `M` — Node + uWebSockets.js (fallback Socket.IO); connection lifecycle, heartbeat/ping,
   graceful disconnect.
2. **Redis authoritative counters** `M` — boss HP + phase as atomic integers (`DECRBY`/`INCRBY`); no
   locks, no races (scope §7.2).
3. **Contribution ingest** `M` — client→server message; server-side rate limit + validation; **the
   server** computes point value (server-authoritative — a client can't assert its own number).
4. **Rate-limit architecture seam** `S` *(added by panel)* — implement **per-IP** limits now (accounts
   don't exist until P4) using IP-keyed Redis counters **designed to coexist** with account-keyed
   counters added in P4. Documented as a clean transition, not a future rewrite.
5. **Tick broadcast** `L` — fixed **3–5 Hz** snapshot of global state + aggregate "contribution wave"
   stats to *all* clients; **bandwidth per client is constant regardless of player count** (the key
   scaling property, scope §7.2).
6. **Redis pub/sub fan-out** `M` — stateless WS nodes subscribe to a shared channel; a contribution on
   any node updates Redis and the delta reaches every node's clients.
7. **Aggregate presence** `S` — "players contributing now" + crowd waves computed from sampled rates,
   never per-player positions (keeps payloads tiny).
8. **Client netcode** `M` — connect, reconnect w/ backoff, apply ticks, interpolate between ticks,
   reconcile local prediction against server truth (replaces P0 local scoring).
9. **Real-time observability** `M` *(added by panel)* — server metrics: tick rate, **per-client
   broadcast bandwidth**, latency percentiles, Redis atomic-op latency, queue depth; baseline dashboard
   so the DoD below is actually *measurable*.
10. **Early anti-cheat foundation** `M` *(added by panel — moved earlier from P5)* — anomaly detection
    on contribution rate + server-side value validation. (P5 later only *tunes* thresholds from live
    data.)
11. **Early load-test spike ("P1b")** `L` *(added by panel — scope §12/§13: "load test early (P1)")* —
    harness simulating 100s–1000s of concurrent WS clients; run against cloud infra **before** P2.

**Deliverables / DoD (measured, not asserted):**
- Shared bar holds under **1000+ simulated concurrent clients**.
- **Per-client bandwidth constant (±5%)** as client count grows.
- Tick **≥ 3 Hz stable** under load.
- **≥ 80% of simulated clients contribute within 30 s of connect** (scope §11 launch gate — validated
  here, not just measured in P6).
- Server **rejects inflated client values** (< 1% point inflation under synthetic cheat).

**Primary risk:** real-time scale/cost under concurrency spikes (scope §13, **High**). De-risked by:
tick-based constant-bandwidth broadcast, stateless WS nodes + Redis pub/sub, and **load-testing in this
phase** rather than discovering problems in P5.

**Tests to write:** integration — ingest→Redis atomic→tick includes delta (no lost/doubled
contributions across nodes); load — constant bandwidth @ 1000+ CCU + ≥80%-in-30s; property —
server-auth + rate-limit/anomaly rejects synthetic cheat.

---

## P2 · Full event loop  *(2–3 wk)*

**Objective:** a complete event — phases, resolution, per-player tracking, XP, and commemoratives —
that survives a Redis restart.

**Depends on:** P1 (authoritative counters, tick broadcast, per-player ingest).

### Tasks
1. **Event lifecycle state machine** `M` — `pending → active → phase-N → resolving → resolved | failed`.
2. **Phase pacing** `M` — escalating phases with a target completion window (e.g. 20–60 min for a boss);
   server drives transitions (scope §5.1).
3. **Per-player contribution tracking** `M` — Redis hash `contribution:{eventId}:{playerId}`.
4. **Event XP engine** `M` *(added by panel — scope §5.2)* — server-side XP accrual per contribution,
   scaled by combo/heat, with cap/diminishing returns; feeds the pass track (reconciled in P4).
5. **Resolution flow** `M` — on complete/fail: checkpoint to Postgres (event record, final tallies,
   per-player totals); compute contribution **tiers**.
6. **Postgres schema (detailed)** `M` *(added by panel)*:
   - `events` — id, archetype, status, started_at, resolved_at, outcome, targets.
   - `event_participants` — event_id, player_id, contribution_total, tier, xp_earned,
     participation_duration, last_update_ts.
   - `players` — id, device_token (P4 links email), created_at.
   - `player_commemoratives` — player_id, commemorative_id, event_id, rarity, earned_at, **expires_at**.
7. **Checkpoint / replay** `M` *(added by panel)* — checkpoint interval **30 s** (plus on every phase
   change); **replay window 60 s**; on Redis restart, recover from last Postgres checkpoint + replay
   (bounds loss to seconds — scope §7.3).
8. **Time-limited commemoratives** `M` *(added by panel — scope §10 "commemorative FOMO")* — ledger
   supports rarity tiers + event-scoped expiry ("First Colossus — launch week only"); rarity scales with
   contribution tier + event significance (scope §5.3).
9. **Resolution screen (client)** `M` *(scope §9)* — outcome, your contribution tier, commemorative
   earned, XP/pass progress, "next event in T−…".

**Deliverables / DoD:** an event runs phases start→resolution; XP + per-player rewards + commemoratives
are granted correctly and **reconciled after a Redis restart within the 60 s window**.

**Primary risk:** reward/state corruption on Redis restart → mitigated by checkpoint+replay (task 7)
and the recovery test below. Events are designed to tolerate minor counter imprecision (it's a shared
bar, not a bank ledger — scope §7.3).

**Tests to write:** integration — lifecycle transitions; e2e — checkpoint→Postgres + Redis-restart
replay within 60 s; unit — XP accrual + tier calc.

---

## P3 · Scheduler, campaigns, roles & reskins  *(2 wk)*

**Objective:** the world is never empty, events recur unattended, chain into a campaign, offer roles,
and ship in 3 archetypes.

**Depends on:** P2 (event loop) + P1 (real-time core).

### Tasks
1. **Event scheduler** `M` *(scope §5.1, §6)* — cadence-based start/stop; config for event type,
   duration, pacing.
2. **Off-peak slow event** `M` *(scope §5.1, risk §13 "empty arena")* — always-on low-intensity event so
   there's always something to join.
3. **Campaign arc / event-chaining engine** `L` *(added by panel — scope §5.4, §10)* — sequence events
   into a narrative arc ("The Colossus Wakes"): escalation curve, transition triggers, narrative beats;
   underpins the season-pass structure.
4. **Roles system** `M` *(added by panel — scope §5.2)* — striker / supporter / rallier: role selection
   at event start, lightly mechanically distinct, **all free**; role-flavored contribution feedback
   (role cosmetics wired in P4).
5. **Next-event countdown widget** `S` *(added by panel — scope §9, §10)* — scheduler-driven timer on
   landing + arena HUD.
6. **Reskin: Rising Structure** `M` *(scope §5.1)* — global state = height/completion %; action = deliver/
   place blocks; world change = monument grows for everyone.
7. **Reskin: Advancing Threat** `M` *(scope §5.1)* — global state = threat distance to town; action =
   push back/reinforce; world change = threat recedes/overruns, town state changes.
8. **Event archetype abstraction** `M` — shared engine + per-archetype config + assets (so reskins are
   config, not forks).
9. **Live-ops admin console (basic)** `M` *(scope §6)* — schedule/start/stop events, tune pacing.

**Deliverables / DoD:** scheduler runs recurring events + the slow event **unattended**; a campaign
chains events in order with escalation; **3 archetypes** playable; roles selectable and cosmetic-only in
effect.

**Primary risk:** empty-arena at low CCU (scope §13, **High**) → mitigated by the always-on slow event +
scheduled marquee events concentrating players.

**Tests to write:** integration — scheduler start/stop unattended; feature — campaign chaining order +
escalation triggers; e2e — role selection has **no power effect** (cosmetic/light-mechanical only).

---

## P4 · Accounts, identity screens, pass & monetization  *(2–3 wk)*

**Objective:** zero-friction accounts, the full identity/cosmetic surface, and light, non-P2W
monetization — live and reconciled.

**Depends on:** P2 (XP/rewards/commemoratives) + P3 (roles, campaigns).

### Tasks
1. **Anonymous device account** `M` *(scope §7.1 — zero-friction join is essential for virality)* —
   device-token issue/persist; session auth on WS + HTTP.
2. **Optional email upgrade** `M` — magic-link email linked to the device account.
3. **Privacy & consent** `M` *(added by panel)* — device-tracking disclosure, email GDPR consent flow,
   data-retention policy, opt-out; **privacy review gate in DoD**.
4. **Player profile** `M` *(scope §9)* — events attended, milestones triggered, equipped cosmetics.
5. **Streak tracking** `S` *(added by panel — scope §10, §11)* — event-attendance streak persisted at
   resolution; shown on profile.
6. **Cosmetics system** `L` *(scope §5.3, §8)* — avatar looks, strike/contribution VFX, cheer emotes,
   badges, name flair; **role-flavored cosmetic variants** (ties to P3 roles).
7. **Wardrobe screen** `M` *(added by panel — scope §9)* — cosmetic catalog UI, equipped-slot management,
   preview.
8. **Settings screen** `M` *(added by panel — scope §9)* — audio, reduced-motion/accessibility, account
   upgrade, privacy controls.
9. **Premium currency ("sparks") ledger** `M` *(scope §8)*.
10. **Event/season pass** `L` *(scope §8 — primary recurring revenue)* — free lane + premium lane; XP →
    tier progression; reconciled at event resolution; **campaign-track UI** (events in sequence, phase
    indicators, lore/flavor).
11. **Store** `M` *(scope §8)* — cosmetic catalog + purchase flow (price bands $1.99–$6.99).
12. **Payments** `L` *(scope §8)* — Stripe (or Paddle) for pass + premium bundle; webhooks; receipts;
    entitlement grant.
13. **Premium "Vanguard Kit" bundle** `S` *(added by panel — scope §8)* — one-time $9.99: profile flair,
    extra cosmetic slots, commemorative album — **status/expression only, no contribution power**.
14. **Rewarded ads** `M` *(scope §8)* — ad SDK, opt-in flow, spark top-up / cosmetic "boost skin"
    (visual only).
15. **Rate-limit account extension** `S` *(added by panel — completes the P1 seam)* — add account-keyed
    limits alongside P1's IP-keyed counters.
16. **Monetization guardrails** `S` *(scope §8)* — nothing bought affects the global outcome;
    heat/combo never purchasable; commemoratives earned, never bought.

**Deliverables / DoD:** pass + store live and **reconciled**; commemoratives granted correctly at
resolution; payments work end-to-end in **test mode**; privacy review passed; guardrails verified (no
purchasable power).

**Primary risk:** monetization pressure vs fairness (scope §13, **Low**, but brand-critical) →
mitigated by the strict cosmetic/commemorative-only model + guardrail checks (task 16).

**Tests to write:** integration — device→email upgrade; integration — payment webhook → entitlement;
unit — pass reconciliation from XP tally; unit — streak persistence; feature — privacy consent gating.

---

## P5 · Scale hardening + polish  *(3–4 wk)* — SOAK, NOT DISCOVERY

**Objective:** take the *proven* real-time model (P1) to **target CCU under soak**, harden anti-cheat &
moderation, and polish to a launchable, clip-worthy bar.

**Depends on:** P1–P4 (whole loop) — this hardens what exists.

### Tasks
1. **Soak at target CCU** `L` *(scope §13)* — sustained load to target CCU (P1 already proved the
   model); **autoscale** stateless nodes; **graceful tick-rate degradation** under pressure.
2. **Anti-cheat hardening** `M` — tune rate limits + anomaly thresholds from real data; light challenge
   (**hCaptcha/PoW**) on first contribution; bot/spam-resistance validation (scope §7.4).
3. **Name moderation** `M` *(scope §7.4)* — display-name filter + report queue. No free text; expression
   via curated cheers/emotes (keeps moderation minimal).
4. **Art & audio pass** `L` *(scope §10)* — final VFX, SFX, music; milestone/completion beats engineered
   to be **clip-worthy** (the organic-growth engine).
5. **Accessibility** `M` *(scope §9)* — reduced-motion, audio controls, contrast, keyboard/touch.
6. **Live-ops observability** `M` *(added by panel)* — real-time dashboards (concurrency, event health,
   contribution distribution, payer cohorts, abuse signals) + alerts (tick degradation, bot patterns,
   event timeouts).
7. **Closed beta** `L` *(scope §12)* — invite cohort; gather metrics + feedback; **re-verify
   ≥80%-contribute-in-30s gate on real clients**.

**Deliverables / DoD (launch gate — scope §11):**
- Holds up at **target CCU** with **constant per-client bandwidth + stable server tick**.
- **Server-authoritative scoring resists trivial cheats** under test.
- **Scheduler runs recurring events + off-peak slow event without manual babysitting.**
- **Pass + store live and reconciled; commemoratives granted correctly at resolution.**

**Primary risk:** cost/scale at real concurrency + bot influx → autoscale, graceful degradation,
challenge-on-first-contribution, and live abuse alerting.

**Tests to write:** load/soak — target CCU sustained ≥ N min; anti-cheat — rate-limit + anomaly
detection e2e; beta — ≥80%-in-30s gate on real clients.

---

## P6 · Soft launch  *(ongoing)*

**Objective:** measure, tune, and feed the organic-growth loop.

**Depends on:** P5 (launch gate passed).

### Tasks
1. **Analytics dashboards** `M` *(scope §11)* — concurrency (peak/avg CCU), %contribute-within-30s
   (> 80% target), event completion rate, time-to-complete vs target window, virality/K-factor,
   D1/D7 + return rate, **attendance streaks**, payer conversion, ARPDAU, pass attach, ad opt-in.
2. **Live-ops runbook** `M` — schedule marquee events; tune pacing/difficulty/cadence from real data.
3. **Marketing / clip beats** `M` *(scope §10)* — capture + distribute shareable milestone/completion
   moments; TikTok/Shorts hooks.
4. **Post-launch tuning loop** `ongoing` — iterate pacing, difficulty, event cadence from metrics.

**Deliverables / DoD:** recurring events run unattended; the full metric suite is tracked; a tuning loop
is established and feeding decisions.

**Primary risk:** retention/virality underperform → the analytics suite + tuning loop exist precisely to
detect and correct this quickly.

---

## Consolidated test backlog (guards to build alongside the phases)

| id | phase | kind | target | intent | priority |
|----|-------|------|--------|--------|----------|
| arch-t1 | P1 | load | Constant per-client bandwidth @ 1000+ CCU | Tick broadcast scales without per-conn overhead | must |
| arch-t2 | P1 | integration | ingest → Redis atomic → tick includes delta | No lost/doubled contributions across nodes | must |
| plan-t1 | P1 | integration | 100s of clients on shared bar | Constant bandwidth, tick ≥3 Hz, no consensus drift | must |
| plan-t2 | P1 | load | Ramp to target CCU (early spike) | De-risk the primary risk before feature build | must |
| plan-t3 | P1 | property | Server-auth cheat resistance | < 1% inflation under coordinated cheat | should |
| arch-t3 | P2 | e2e | checkpoint→Postgres + Redis-restart replay (60 s) | Durability within loss window | should |
| comp-t1 | P2/P4 | integration | Event XP + pass progression | XP → tier; free/premium lanes progress | must |
| comp-t2 | P3/P4 | feature | Campaign arc + streak | Events chain in order; streak persists + displays | must |
| comp-t3 | P3/P4 | e2e | Roles + cosmetics | Role selectable, cosmetic-only, no power effect | should |

---

## Scope traceability (every in-scope system → its phase)

| Scope item (§) | Phase(s) |
|----------------|----------|
| Global objective / authoritative counters (§5.1, §7.2) | P1 |
| Skill-lite action + heat/combo (§5.2) | P0 |
| Event XP + contribution points (§5.2) | P2, P4 |
| Roles: striker/supporter/rallier (§5.2) | P3, P4 |
| Commemoratives + rarity + FOMO expiry (§5.3, §10) | P2 |
| Player profile + status surface (§5.3, §9) | P4 |
| Live map / aggregate crowd presence (§5.4) | P1 |
| Seasonal campaigns / narrative arc (§5.4) | P3, P4 |
| Phases + scheduler + off-peak slow event (§5.1) | P2, P3 |
| Reskins: Structure, Threat (§5.1) | P3 |
| Anonymous account + email upgrade (§6, §7.1) | P4 |
| Event/season pass (§8) | P4 |
| Cosmetic store, rewarded ads, Vanguard Kit (§8) | P4 |
| UX screens: landing, arena, resolution, profile, store/pass, wardrobe, settings (§9) | P0/P2/P4 |
| Retention: streaks, countdowns, campaign arc, FOMO (§10) | P2, P3, P4, P6 |
| Real-time model + scaling (§7.2) | P1, P5 |
| Data & consistency: checkpoint/replay (§7.3) | P2 |
| Anti-cheat, safety, moderation (§7.4) | P1 (foundation), P5 (hardening) |
| Analytics & success criteria (§11) | P1 (gates), P5, P6 |
| Cloud hosting / stateless WS + managed Redis/Postgres (§7.1) | P-1 |

**Explicitly out of scope (per §6 — do NOT build in MVP):** live position-synced avatars across a world
map; multiple simultaneous global objectives; free-text chat + full guilds; native/console/Steam apps;
deep PvP / competitive leaderboards.
