import { describe, it, expect } from 'vitest';
import {
  HEAT_MULTIPLIER_CAP,
  capHeatMultiplier,
  isCosmeticPowerNeutral,
} from './monetization.js';

describe('monetization guardrail (never pay-to-win)', () => {
  it('caps the heat multiplier at 1.0 no matter how high the input', () => {
    expect(HEAT_MULTIPLIER_CAP).toBe(1.0);
    expect(capHeatMultiplier(5)).toBe(1.0);
    expect(capHeatMultiplier(1.0001)).toBe(1.0);
    expect(capHeatMultiplier(1.0)).toBe(1.0);
  });

  it('passes through legitimate sub-cap multipliers and floors negatives at 0', () => {
    expect(capHeatMultiplier(0.5)).toBe(0.5);
    expect(capHeatMultiplier(-3)).toBe(0);
  });

  it('accepts a pure cosmetic with no power fields', () => {
    expect(isCosmeticPowerNeutral({ effectKind: 'avatar' })).toBe(true);
    expect(isCosmeticPowerNeutral({ effectKind: 'strike-vfx', power: {} })).toBe(true);
  });

  it('rejects any item asserting a heat/xp/contribution bonus (pay-to-win)', () => {
    expect(isCosmeticPowerNeutral({ effectKind: 'avatar', power: { heatMultiplierBonus: 0.1 } })).toBe(
      false,
    );
    expect(isCosmeticPowerNeutral({ effectKind: 'badge', power: { xpRateBonus: 0.2 } })).toBe(false);
    expect(
      isCosmeticPowerNeutral({ effectKind: 'emote', power: { contributionValueBonus: 1 } }),
    ).toBe(false);
  });

  it('rejects an unknown (non-allowlisted) effect kind — default deny', () => {
    // @ts-expect-error deliberately passing an off-allowlist kind
    expect(isCosmeticPowerNeutral({ effectKind: 'xp-boost' })).toBe(false);
  });
});
