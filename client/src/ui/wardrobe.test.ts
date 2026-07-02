import { describe, it, expect } from 'vitest';
import { equip, unequip, catalogForSlot, previewEquipped } from './wardrobe.js';
import type { CosmeticItem, Wardrobe } from '@overworld/shared';

const catalog: CosmeticItem[] = [
  { cosmeticId: 'av1', name: 'Nova', slot: 'avatar', effectKind: 'avatar', roleFlavor: null, rarity: 'common' },
  { cosmeticId: 'av2', name: 'Ember', slot: 'avatar', effectKind: 'avatar', roleFlavor: 'striker', rarity: 'rare' },
  { cosmeticId: 'bd1', name: 'Star', slot: 'badge', effectKind: 'badge', roleFlavor: null, rarity: 'common' },
];

const wardrobe: Wardrobe = {
  playerId: 'p1',
  ownedCosmeticIds: ['av1', 'av2', 'bd1'],
  equipped: { avatar: 'av1' },
};

describe('wardrobe', () => {
  it('equips an owned cosmetic into its slot, replacing the current occupant, immutably', () => {
    const next = equip(wardrobe, 'av2', catalog);
    expect(next.equipped.avatar).toBe('av2');
    expect(wardrobe.equipped.avatar).toBe('av1'); // input untouched
    expect(next).not.toBe(wardrobe);
  });

  it('rejects equipping an unowned cosmetic', () => {
    const stripped: Wardrobe = { ...wardrobe, ownedCosmeticIds: ['av1'] };
    expect(() => equip(stripped, 'av2', catalog)).toThrow(/unowned/);
  });

  it('rejects an unknown cosmetic id', () => {
    const w: Wardrobe = { ...wardrobe, ownedCosmeticIds: [...wardrobe.ownedCosmeticIds, 'ghost'] };
    expect(() => equip(w, 'ghost', catalog)).toThrow(/unknown/);
  });

  it('unequips a slot immutably', () => {
    const next = unequip(wardrobe, 'avatar');
    expect(next.equipped.avatar).toBeUndefined();
    expect(wardrobe.equipped.avatar).toBe('av1');
  });

  it('filters the catalog by slot', () => {
    expect(catalogForSlot(catalog, 'avatar').map((c) => c.cosmeticId)).toEqual(['av1', 'av2']);
    expect(catalogForSlot(catalog, 'badge').map((c) => c.cosmeticId)).toEqual(['bd1']);
  });

  it('resolves equipped ids to items for preview', () => {
    const preview = previewEquipped({ ...wardrobe, equipped: { avatar: 'av2', badge: 'bd1' } }, catalog);
    expect(preview.avatar?.name).toBe('Ember');
    expect(preview.badge?.name).toBe('Star');
  });
});
