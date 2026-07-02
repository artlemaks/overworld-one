import type { CosmeticItem, CosmeticSlot, Wardrobe } from '@overworld/shared';

/**
 * Wardrobe screen model (P4-C-2 / OOM).
 *
 * The PURE, testable core of the wardrobe: equip/unequip/preview over the shared {@link Wardrobe} and
 * cosmetic catalog, with strictly immutable updates (never mutate the input wardrobe). No Pixi/DOM
 * import; the catalog screen renders on top of these functions (indication
 * `client-screens-pure-and-testable`). Cosmetics are power-neutral by construction (see
 * `monetization.ts`), so equipping never changes gameplay — only appearance.
 */

/** Look up a cosmetic by id in the catalog. */
function findCosmetic(catalog: CosmeticItem[], cosmeticId: string): CosmeticItem | undefined {
  return catalog.find((c) => c.cosmeticId === cosmeticId);
}

/**
 * Equip an owned cosmetic into its slot, replacing whatever is there. Immutable — returns a new
 * wardrobe. Throws if the player does not own the cosmetic or it is not in the catalog (can't equip
 * what you don't have).
 */
export function equip(wardrobe: Wardrobe, cosmeticId: string, catalog: CosmeticItem[]): Wardrobe {
  if (!wardrobe.ownedCosmeticIds.includes(cosmeticId)) {
    throw new Error(`cannot equip unowned cosmetic: ${cosmeticId}`);
  }
  const item = findCosmetic(catalog, cosmeticId);
  if (!item) throw new Error(`unknown cosmetic: ${cosmeticId}`);
  return {
    ...wardrobe,
    equipped: { ...wardrobe.equipped, [item.slot]: cosmeticId },
  };
}

/** Clear a slot. Immutable; a no-op (fresh copy) if the slot was already empty. */
export function unequip(wardrobe: Wardrobe, slot: CosmeticSlot): Wardrobe {
  const next: Partial<Record<CosmeticSlot, string>> = { ...wardrobe.equipped };
  delete next[slot];
  return { ...wardrobe, equipped: next };
}

/** All catalog items that fill a given slot. */
export function catalogForSlot(catalog: CosmeticItem[], slot: CosmeticSlot): CosmeticItem[] {
  return catalog.filter((c) => c.slot === slot);
}

/** The resolved {@link CosmeticItem} equipped in each slot, for the preview render. */
export function previewEquipped(
  wardrobe: Wardrobe,
  catalog: CosmeticItem[],
): Partial<Record<CosmeticSlot, CosmeticItem>> {
  const out: Partial<Record<CosmeticSlot, CosmeticItem>> = {};
  for (const [slot, cosmeticId] of Object.entries(wardrobe.equipped)) {
    const item = findCosmetic(catalog, cosmeticId);
    if (item) out[slot as CosmeticSlot] = item;
  }
  return out;
}
