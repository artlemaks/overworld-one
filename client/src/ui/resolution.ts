import type { PlayerResolution, Tier, CommemorativeRarity } from '@overworld/shared';

/**
 * Resolution screen (P2-C-1 / OOM-46).
 *
 * Renders the authoritative {@link PlayerResolution} the server sends when an event ends: outcome,
 * tier, XP earned, any commemorative, and the countdown to the next event.
 *
 * Following indication `client-screens-pure-and-testable`, the presentation logic is a **pure**
 * `buildResolutionView` (string/label mapping, fully unit-testable in Node) and `mountResolution` is a
 * thin DOM adapter over it — no formatting decisions live in the render layer.
 */

const TIER_LABEL: Record<Tier, string> = {
  none: 'Participant',
  bronze: 'Bronze Tier',
  silver: 'Silver Tier',
  gold: 'Gold Tier',
  legendary: 'Legendary Tier',
};

const RARITY_LABEL: Record<CommemorativeRarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The fully-formatted view model — every string the screen shows, decided here. */
export interface ResolutionView {
  outcomeLabel: string;
  outcomeTone: 'win' | 'loss';
  tierLabel: string;
  contributionText: string;
  xpText: string;
  /** null when the player's tier earned no commemorative. */
  commemorativeText: string | null;
  nextEventText: string;
}

/** `90000` -> `"1:30"`. Clamps negatives to `0:00`. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Human commemorative line, or null. Expiry is derived from the badge's own earned/expiry stamps. */
function commemorativeText(resolution: PlayerResolution): string | null {
  const c = resolution.commemorative;
  if (!c) return null;
  const rarity = RARITY_LABEL[c.rarity];
  if (c.expiresAtTs === null) return `${rarity} commemorative — yours to keep`;
  const days = Math.max(1, Math.round((c.expiresAtTs - c.earnedAtTs) / DAY_MS));
  return `${rarity} commemorative — expires in ${days} day${days === 1 ? '' : 's'}`;
}

/** Pure mapping from the wire payload to display strings. */
export function buildResolutionView(resolution: PlayerResolution): ResolutionView {
  const win = resolution.outcome === 'completed';
  return {
    outcomeLabel: win ? 'Victory!' : 'Defeat',
    outcomeTone: win ? 'win' : 'loss',
    tierLabel: TIER_LABEL[resolution.tier],
    contributionText: `You contributed ${Math.round(resolution.contributionTotal).toLocaleString()}`,
    xpText: `+${resolution.xpEarned.toLocaleString()} XP`,
    commemorativeText: commemorativeText(resolution),
    nextEventText: `Next event in ${formatCountdown(resolution.nextEventInMs)}`,
  };
}

/**
 * Render the resolution screen into `root`. Thin — it only turns the {@link ResolutionView} into DOM
 * and wires the "Back to the fight" button to `onNext` (the screen controller's `next()`).
 */
export function mountResolution(
  root: HTMLElement,
  resolution: PlayerResolution,
  onNext: () => void = () => {},
): HTMLElement {
  const view = buildResolutionView(resolution);
  root.replaceChildren();

  const screen = document.createElement('section');
  screen.className = `screen screen--resolution screen--resolution-${view.outcomeTone}`;

  const outcome = document.createElement('h1');
  outcome.className = 'resolution__outcome';
  outcome.setAttribute('data-testid', 'resolution-outcome');
  outcome.textContent = view.outcomeLabel;

  const tier = document.createElement('p');
  tier.className = 'resolution__tier';
  tier.setAttribute('data-testid', 'resolution-tier');
  tier.textContent = view.tierLabel;

  const contribution = document.createElement('p');
  contribution.className = 'resolution__contribution';
  contribution.textContent = view.contributionText;

  const xp = document.createElement('p');
  xp.className = 'resolution__xp';
  xp.setAttribute('data-testid', 'resolution-xp');
  xp.textContent = view.xpText;

  screen.append(outcome, tier, contribution, xp);

  if (view.commemorativeText) {
    const commemorative = document.createElement('p');
    commemorative.className = 'resolution__commemorative';
    commemorative.setAttribute('data-testid', 'resolution-commemorative');
    commemorative.textContent = view.commemorativeText;
    screen.append(commemorative);
  }

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'resolution__next';
  next.setAttribute('data-testid', 'resolution-next');
  next.textContent = view.nextEventText;
  next.addEventListener('click', onNext);
  screen.append(next);

  root.append(screen);
  return screen;
}
