import { z } from 'zod';
import { CosmeticEffectKind } from './monetization.js';
import { Role } from './roles.js';

/**
 * Cosmetics system contracts (P4-P-2 / OOM) + wardrobe (P4-C-2).
 *
 * The SINGLE SOURCE OF TRUTH for cosmetic items, the equip slots they fill, and the wardrobe's
 * equip/preview state. Every cosmetic is power-neutral BY CONSTRUCTION — its `effectKind` comes from the
 * {@link CosmeticEffectKind} allowlist in `monetization.ts`, and it carries no power fields, so the
 * P4-X-1 guardrail (`isCosmeticPowerNeutral`) passes for the whole catalog. Some cosmetics have
 * role-flavored variants (a striker-tinted strike VFX, etc.) — pure flavor, no mechanical effect.
 *
 * Pure schemas + a pure equip reducer; the render/store live elsewhere. No clock/I/O.
 */

/** The equip slots a player has. One cosmetic per slot may be equipped at a time. */
export const CosmeticSlot = z.enum(['avatar', 'strikeVfx', 'emote', 'badge', 'nameFlair', 'frame']);
export type CosmeticSlot = z.infer<typeof CosmeticSlot>;

/** A cosmetic item. Power-neutral by construction (no power fields exist on this shape). */
export const CosmeticItem = z.object({
  cosmeticId: z.string().min(1),
  name: z.string().min(1),
  slot: CosmeticSlot,
  effectKind: CosmeticEffectKind,
  /** Optional role flavoring — purely visual (a variant tinted for a role). null = universal. */
  roleFlavor: Role.nullable().default(null),
  /** Rarity for display ordering only; has no gameplay effect. */
  rarity: z.enum(['common', 'rare', 'epic', 'legendary']).default('common'),
});
export type CosmeticItem = z.infer<typeof CosmeticItem>;

/** A player's wardrobe: what they own and what is equipped per slot. */
export const Wardrobe = z.object({
  playerId: z.string().min(1),
  ownedCosmeticIds: z.array(z.string()),
  /** slot -> equipped cosmeticId (absent slot = nothing equipped / default). */
  equipped: z.record(CosmeticSlot, z.string()).default({}),
});
export type Wardrobe = z.infer<typeof Wardrobe>;
