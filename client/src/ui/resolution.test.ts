// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { PlayerResolution } from '@overworld/shared';
import { buildResolutionView, formatCountdown, mountResolution } from './resolution.js';

const resolution = (over: Partial<PlayerResolution> = {}): PlayerResolution => ({
  eventId: 'evt-1',
  playerId: 'p1',
  outcome: 'completed',
  tier: 'gold',
  contributionTotal: 6000,
  xpEarned: 400,
  commemorative: {
    commemorativeId: 'evt-1:p1',
    eventId: 'evt-1',
    rarity: 'epic',
    earnedAtTs: 0,
    expiresAtTs: 90 * 24 * 60 * 60 * 1000,
  },
  nextEventInMs: 90_000,
  ...over,
});

describe('formatCountdown', () => {
  it('formats ms as m:ss', () => {
    expect(formatCountdown(90_000)).toBe('1:30');
    expect(formatCountdown(5_000)).toBe('0:05');
  });
  it('clamps negatives to 0:00', () => {
    expect(formatCountdown(-1000)).toBe('0:00');
  });
});

describe('buildResolutionView', () => {
  it('labels a win with the earned tier and XP', () => {
    const v = buildResolutionView(resolution());
    expect(v.outcomeLabel).toBe('Victory!');
    expect(v.outcomeTone).toBe('win');
    expect(v.tierLabel).toBe('Gold Tier');
    expect(v.contributionText).toBe('You contributed 6,000');
    expect(v.xpText).toBe('+400 XP');
    expect(v.nextEventText).toBe('Next event in 1:30');
  });

  it('labels a loss', () => {
    const v = buildResolutionView(resolution({ outcome: 'failed' }));
    expect(v.outcomeLabel).toBe('Defeat');
    expect(v.outcomeTone).toBe('loss');
  });

  it('describes a time-limited commemorative with its expiry window', () => {
    expect(buildResolutionView(resolution()).commemorativeText).toBe(
      'Epic commemorative — expires in 90 days',
    );
  });

  it('describes a permanent commemorative', () => {
    const perm = resolution({
      tier: 'legendary',
      commemorative: {
        commemorativeId: 'evt-1:p1',
        eventId: 'evt-1',
        rarity: 'legendary',
        earnedAtTs: 0,
        expiresAtTs: null,
      },
    });
    expect(buildResolutionView(perm).commemorativeText).toBe('Legendary commemorative — yours to keep');
  });

  it('shows the Participant label and no commemorative for the none tier', () => {
    const v = buildResolutionView(resolution({ tier: 'none', commemorative: null }));
    expect(v.tierLabel).toBe('Participant');
    expect(v.commemorativeText).toBeNull();
  });
});

describe('mountResolution', () => {
  it('renders outcome, tier, xp and a working next button', () => {
    const root = document.createElement('div');
    const onNext = vi.fn();
    mountResolution(root, resolution(), onNext);

    expect(root.querySelector('[data-testid="resolution-outcome"]')?.textContent).toBe('Victory!');
    expect(root.querySelector('[data-testid="resolution-tier"]')?.textContent).toBe('Gold Tier');
    expect(root.querySelector('[data-testid="resolution-xp"]')?.textContent).toBe('+400 XP');

    const next = root.querySelector<HTMLButtonElement>('[data-testid="resolution-next"]')!;
    next.click();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('omits the commemorative line when none was earned', () => {
    const root = document.createElement('div');
    mountResolution(root, resolution({ tier: 'none', commemorative: null }));
    expect(root.querySelector('[data-testid="resolution-commemorative"]')).toBeNull();
  });
});
