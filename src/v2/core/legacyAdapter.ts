import type { Equipment, Follower, GameState, InventoryItem, PlayerStats } from '../../game/types';

/**
 * TERRITORY 2.0 — a read-only projection of OLD save data.
 * No writes, migration/reset operations or default wallet replacement.
 * Preserve legacy identities, item IDs, rarity, VIP, followers, and inventory.
 */
export const V2_GEAR_SLOTS = [
  'helmet', 'amulet', 'armor', 'weapon', 'shield', 'ring', 'boots',
] as const satisfies readonly Equipment['slot'][];

export interface V2GearSlotView {
  readonly slot: Equipment['slot'];
  readonly empty: boolean;
  readonly item: Equipment | null;
}

export interface V2HeroSaveView {
  readonly name: string;
  readonly level: number;
  readonly xp: number;
  readonly xpToNext: number;
  readonly vipLevel: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly attack: number;
  readonly defense: number;
  readonly critChance: number;
  readonly critDamage: number;
  readonly energy: number;
  readonly maxEnergy: number;
  readonly gold: number;
  readonly gems: number;
  readonly redGems: number;
  readonly battleStones: number;
  readonly currentChapter: number;
  readonly totalBattlesWon: number;
  readonly slots: readonly V2GearSlotView[];
  readonly inventory: readonly InventoryItem[];
  readonly followers: readonly Follower[];
  readonly activeFollowerId: string | null;
  readonly professionMasteryLevel: number;
}

const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function projectLegacySaveForV2(
  state: GameState,
  computed: Readonly<PlayerStats>,
  vipLevel: number,
): V2HeroSaveView {
  // Clones are for display only. Do not drop custom item fields during
  // future persistence: the legacy snapshot remains the source of truth.
  const equip = state.player.equipped;
  const slots = V2_GEAR_SLOTS.map((slot) => ({
    slot,
    empty: !equip[slot],
    item: equip[slot] ? { ...equip[slot]! } : null,
  }));

  const unlockedIds = new Set(state.followers.filter((x) => x.unlocked).map((x) => x.id));
  const activeId = state.activeFollowerId && unlockedIds.has(state.activeFollowerId)
    ? state.activeFollowerId
    : state.followers.find((x) => x.unlocked)?.id ?? null;

  return {
    name: state.player.name,
    level: finite(state.player.level, 1),
    xp: finite(state.player.xp),
    xpToNext: finite(state.player.xpToNext, 1),
    vipLevel: finite(vipLevel),
    hp: finite(computed.hp),
    maxHp: finite(computed.maxHp, 1),
    attack: finite(computed.attack),
    defense: finite(computed.defense),
    critChance: finite(computed.critChance),
    critDamage: finite(computed.critDamage),
    energy: finite(state.player.energy),
    maxEnergy: finite(state.player.maxEnergy, 1),
    gold: finite(state.player.gold),
    gems: finite(state.player.gems),
    redGems: finite(state.player.redGems),
    battleStones: finite(state.battleStones),
    currentChapter: finite(state.currentChapter, 1),
    totalBattlesWon: finite(state.totalBattlesWon),
    slots,
    inventory: state.inventory.map((item) => ({
      ...item,
      equipment: item.equipment ? { ...item.equipment } : undefined,
      effect: item.effect ? { ...item.effect } : undefined,
    })),
    followers: state.followers.map((follower) => ({ ...follower })),
    activeFollowerId: activeId,
    professionMasteryLevel: finite(state.professions?.masteryLevel),
  };
}

/** A pure checksum for preview-change detection, never an anti-cheat token. */
export function v2PresentationFingerprint(view: V2HeroSaveView): string {
  return [
    view.level, view.vipLevel, view.gold, view.gems, view.redGems,
    view.battleStones, view.currentChapter, view.totalBattlesWon,
    view.slots.map((item) => item.item?.id ?? '-').join(','),
    view.followers.map((x) => `${x.id}:${x.level}:${Number(x.unlocked)}`).join(','),
  ].join('|');
}
