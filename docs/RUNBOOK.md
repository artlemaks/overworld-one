# Overworld One — Live-Ops Runbook (P6-X-2)

> Operating guide for running recurring events, tuning pacing from data, and responding to alerts after
> soft launch (scope §6/§10/§11). Pairs with the live-ops admin console (`P3-X-3a`), the audited
> event-control API (`P3-X-3b` / `server/liveops/eventControl.ts`), the alert evaluator
> (`server/metrics/alerts.ts`), and the tuning loop (`server/liveops/tuning.ts`).

## 1. Daily operating loop

1. **Check launch health.** Open the console dashboard (`DASHBOARD_METRICS`). The top-line number is
   `launchHealth()` — the fraction of `KPI_TARGETS` met. Anything < 1.0 has a KPI to investigate.
2. **Confirm the scheduler is live.** The off-peak slow event (`P3-X-2`) must always be up; marquee
   events (`P3-X-1`) run on cadence. If the arena is empty below `EmptyArenaPolicy.slowEventBelowCcu`,
   the slow event should already be running — if not, start one from the console.
3. **Clear the moderation queue.** Work `reportQueue.open()`; action/dismiss with bulk actions. Every
   action is recorded.
4. **Review firing alerts** (below) and apply tuning proposals (below).

## 2. Alerts → response

`createAlertEvaluator().evaluate(values)` returns the firing `ALERT_RULES`. Standard responses:

| Alert | Meaning | First response |
|-------|---------|----------------|
| `tick-degraded` (tick < 3Hz) | Server under load | Confirm autoscale (`autoscaleDecision`) is adding nodes; graceful degradation (`tickRateForLoad`) holds the floor. Page infra if it persists. |
| `bot-surge` (bot signal > 50) | Bot/spam influx | Raise challenge difficulty (`P5-X-1`), tighten anti-cheat thresholds; check the report queue. |
| `contribute-gate` (< 80% in 30s) | Onboarding/pacing friction | Apply the tuning proposal (§3); verify join-to-first-contribution flow. |
| `event-timeout` (completion < 20%) | Events too hard / too few players | Ease difficulty + shorten cadence via the tuning proposal. |

## 3. Tuning from data (never edit state by hand)

The loop is **propose → operator applies via audited control**, keeping a human in the loop:

1. Feed the live KPI snapshot to `proposeTuning(currentState, values)`.
2. Read `adjustment.reasons` — the rationale for each change.
3. Apply the change through the **event-control API** (`EventControlCommand`) with the reason from step 2
   as the mandatory `reason` field. This writes an `AuditLogEntry` — never mutate an event's internal
   state directly.

Bounds are enforced in code: multipliers clamp to `[0.5, 2.0]`, cadence never drops below 60s, and each
pass moves at most one step. Safe to run frequently.

## 4. Marquee-event scheduling

Schedule marquee events for peak hours via `ScheduledEventConfig` (cadence, duration, pacing, archetype).
Rotate archetypes (boss / structure / threat) and chain them into campaigns (`CampaignArc`) for narrative
arcs with escalation. Keep at least one always-on slow event underneath so the world is never empty.

## 5. Clip beats (growth loop)

The client fires `detectClipBeat()` on the tick stream. When a `finishing-blow`, `milestone-90`,
`milestone-50`, or `record-crowd` beat fires, capture the highlight and distribute with the matching
`CLIP_CAPTIONS` copy (TikTok/Shorts hooks, `P6-P-1`).

## 6. Launch-gate KPIs (scope §11)

Track continuously; these are the soft-launch bar (`KPI_TARGETS`):

- **≥ 80%** of realistic clients contribute within 30s of connect (headline gate).
- Tick **≥ 3Hz** with constant per-client bandwidth at target CCU.
- Completion rate healthy; time-to-complete within the target window.
- D1 ≥ 30%, D7 ≥ 12%, K-factor ≥ 1, payer conversion ≥ 2%.
- Server-authoritative scoring resists trivial cheats; bot signal low.

## 7. Escalation

- **Payments/entitlement discrepancy** → reconcile from the sparks ledger (append-only) + payment
  webhooks (deduped by `providerEventId`); entitlement is idempotent.
- **Reward/state corruption after restart** → auto-recovery resumes from the latest checkpoint within the
  60s window, or force-resolves the prior event and starts fresh (`P2-X-1`). No manual state editing.
- **Fairness question** → the monetization guardrail hard-caps heat at 1.0× and validates the catalog is
  power-neutral; the guardrail e2e proves no purchase moves heat/XP/tally.
