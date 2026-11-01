import type { Follower, GameState, InventoryItem } from './types';
import { reconcileElixirExpiry } from './elixirExpiry';
import { HALLOWEEN_COMPANION_ID, PUMPKIN_WITCH_TEMPLATE, PUMPKIN_WITCH_COMBAT } from './halloweenCompanion2026';

/** PvE-only companions. An account can have several unlocked companions but
 * exactly one active companion. PvP Arena snapshots never use these bonuses.
 * Training is a client-side gameplay feature, NOT an anti-cheat boundary.
 */
export type FollowerRole = 'guardian' | 'warrior' | 'healer' | 'hunter' | 'mage' | 'crystal' | 'pumpkin';

export interface FollowerTemplate {
  id: string;
  role: FollowerRole;
  unlockLevel: number;
  name: string;
  nameEn: string;
  icon: string;
  attack: number;
  defense: number;
  description: string;
  descriptionEn: string;
}

export const FOLLOWER_TEMPLATES: FollowerTemplate[] = [
  { id: 'follower_1', role: 'guardian', unlockLevel: 3, name: 'Верный щит', nameEn: 'Loyal Shield', icon: '🛡️', attack: 5, defense: 10, description: 'Прикрывает героя и уменьшает входящий урон.', descriptionEn: 'Protects the hero against incoming hits.' },
  { id: 'follower_2', role: 'warrior', unlockLevel: 8, name: 'Северный воин', nameEn: 'Northern Warrior', icon: '⚔️', attack: 11, defense: 1, description: 'Наносит дополнительный урон врагам.', descriptionEn: 'Deals extra damage to enemies.' },
  { id: 'follower_3', role: 'healer', unlockLevel: 15, name: 'Лесная целительница', nameEn: 'Forest Healer', icon: '🌿', attack: 3, defense: 1, description: 'Восстанавливает немного HP между раундами.', descriptionEn: 'Restores some HP between rounds.' },
  { id: 'follower_4', role: 'hunter', unlockLevel: 25, name: 'Лунный охотник', nameEn: 'Moon Hunter', icon: '🏹', attack: 7, defense: 1, description: 'Немного повышает шанс критического удара героя.', descriptionEn: 'Slightly improves the hero’s critical-hit chance.' },
  { id: 'follower_5', role: 'mage', unlockLevel: 40, name: 'Рунный маг', nameEn: 'Rune Mage', icon: '🔮', attack: 5, defense: 1, description: 'Ослабляет защиту врага в Походе и Испытаниях.', descriptionEn: 'Weakens enemy defense in PvE battles.' },
  { id: 'follower_6', role: 'crystal', unlockLevel: 50, name: 'Боевая корова', nameEn: 'Battle Cow', icon: '🐮', attack: 7, defense: 2, description: 'Кристальное безумие: атакует врага и немного лечит героя между раундами. Только PvE.', descriptionEn: 'Crystal Frenzy: attacks enemies and heals the hero a little between rounds. PvE only.' },
];

/** Raid reward is NEVER in the normal level-unlock catalog. Its entitlement
 * comes only from the Halloween 2026 server receipt after event closure. */
export const HALLOWEEN_COMPANION_TEMPLATE: FollowerTemplate = {
  id: HALLOWEEN_COMPANION_ID, role: 'pumpkin', unlockLevel: 101,
  name: 'Тыквенная ведьма', nameEn: 'Pumpkin Witch', icon: '🎃',
  attack: PUMPKIN_WITCH_TEMPLATE.attack, defense: PUMPKIN_WITCH_TEMPLATE.defense,
  description: 'Эксклюзив за подтверждённое участие в Хэллоуинском рейде 2026. Уровень 100, сила +5% к сопоставимому обычному целителю.',
  descriptionEn: 'Exclusive for confirmed Halloween 2026 raid fighters. Level 100, 5% stronger than the comparable standard healer.',
};
export const DISPLAY_FOLLOWER_TEMPLATES: FollowerTemplate[] = [
  ...FOLLOWER_TEMPLATES, HALLOWEEN_COMPANION_TEMPLATE,
];

export function initialFollowers(): Follower[] {
  return FOLLOWER_TEMPLATES.map((f) => ({
    id: f.id, name: f.name, icon: f.icon, level: 1,
    attack: f.attack, defense: f.defense, unlocked: false, description: f.description, role: f.role,
  }));
}

/** Preserve legacy training and all custom follower fields. Existing Loyal Shield
 * level, attack and defense values must never be reset by this migration. */
export function reconcileFollowers(saved: Follower[] | undefined, heroLevel: number, halloweenVerified = false): Follower[] {
  const current = Array.isArray(saved) ? saved : [];
  const templates = initialFollowers();
  return templates.map((fresh, index) => {
    const old = current.find((entry) => entry && entry.id === fresh.id);
    const template = FOLLOWER_TEMPLATES[index];
    if (!old) return { ...fresh, unlocked: heroLevel >= template.unlockLevel };
    return {
      ...fresh, ...old, role: template.role,
      // Never relock a legacy follower; newly unlocked companions follow hero level.
      unlocked: old.unlocked === true || heroLevel >= template.unlockLevel,
    };
  }).concat(current.filter((old) => old && old.id !== HALLOWEEN_COMPANION_ID && !templates.some((f) => f.id === old.id)))
    .concat(halloweenVerified ? [{ ...PUMPKIN_WITCH_TEMPLATE }] : []);
}

export function selectedFollower(state: Pick<GameState, 'followers' | 'activeFollowerId'>): Follower | null {
  const active = state.followers.find((f) => f.unlocked && f.id === state.activeFollowerId);
  return active ?? state.followers.find((f) => f.unlocked) ?? null;
}

export function selectFollower(state: GameState, followerId: string): GameState | null {
  const target = state.followers.find((f) => f.id === followerId && f.unlocked && DISPLAY_FOLLOWER_TEMPLATES.some((x) => x.id === f.id));
  return target ? { ...state, activeFollowerId: target.id } : null;
}

export function followerTrainingCost(level: number): { gold: number; materials: number } {
  return { gold: 120 + level * 85, materials: 1 + Math.floor(level / 7) };
}

export const MAX_FOLLOWER_LEVEL = 60;
/** Battle Cow uses a rare, non-expiring item, never coins, gems or forge materials.
 * No automatic source or rewards are enabled until the owner approves distribution. */
export const MAX_BATTLE_COW_LEVEL = 100;
export const AWAKENING_STONE_ID = 'cow_awakening_stone';
export const AWAKENING_STONE_ITEM: InventoryItem = {
  id: AWAKENING_STONE_ID, name: 'Камень пробуждения', icon: '💜',
  type: 'material', rarity: 'legendary', qty: 0,
  description: 'Редкий камень пробуждения Боевой коровы. Источники получения и улучшение пока не открыты. Уже имеющиеся камни сохраняются.',
};
export function cowStonesOwned(state: Pick<GameState, 'inventory'>): number {
  return state.inventory.reduce((sum, item) =>
    item.id === AWAKENING_STONE_ID && item.type === 'material' && Number.isSafeInteger(item.qty) && item.qty > 0
      ? Math.min(2147483647, sum + item.qty) : sum, 0);
}
export function cowAwakeningCost(_level: number): number { return 1; }

/** Owner-approved freeze: awakening stones have no automatic source until a separate
 * decision and server-authoritative reward receipt. Never mint client inventory. */
export function cowStoneChapterBossReward(_chapter: number, _enemyId: string, _isBoss: boolean): number { return 0; }
export function cowStoneTrialReward(_level: number): number { return 0; }
export function awardCowAwakeningStone(state: GameState, _count: number): GameState { return state; }

/** Atomic pure update: call against the latest store state, never a stale render.
 * No cap bypass by negative/NaN amounts, and train only one companion at a time. */
export function trainFollower(state: GameState, followerId: string): GameState | null {
  state = reconcileElixirExpiry(state);
  const found = state.followers.find((f) => f.id === followerId && f.unlocked);
  if (!found || !FOLLOWER_TEMPLATES.some((f) => f.id === followerId)) return null;
  if (!Number.isSafeInteger(found.level) || found.level < 1) return null;
  // Do not spend saved stones or modify a cow's existing level before the
  // approved, server-authoritative awakening operation is available.
  if (followerId === 'follower_6' || followerId === HALLOWEEN_COMPANION_ID) return null;
  if (found.level >= MAX_FOLLOWER_LEVEL || found.level >= state.player.level) return null;
  const price = followerTrainingCost(found.level);
  if (!Number.isSafeInteger(state.player.gold) || state.player.gold < price.gold || !Number.isSafeInteger(state.forgeMaterials) || state.forgeMaterials < price.materials) return null;
  const template = FOLLOWER_TEMPLATES.find((f) => f.id === followerId)!;
  const gain = template.role === 'guardian' ? { attack: 1, defense: 2 }
    : template.role === 'warrior' ? { attack: 2, defense: 0 }
      : { attack: 1, defense: 0 };
  return {
    ...state,
    player: { ...state.player, gold: state.player.gold - price.gold },
    forgeMaterials: state.forgeMaterials - price.materials,
    followers: state.followers.map((f) => f.id !== followerId ? f : {
      ...f, level: f.level + 1, attack: f.attack + gain.attack, defense: f.defense + gain.defense,
    }),
  };
}

/** Bounded combat effects (client-side PvE only). Untrusted saved stats do not
 * yield unbounded buffs; full server economy enforcement is a separate release. */
export function followerCombat(follower: Follower | null) {
  if (follower?.id === HALLOWEEN_COMPANION_ID) {
    // No skill effects on PvP. This 100/100 raid companion mirrors a fully
    // trained level-60 healer at 1.05× power (rounded combat integers).
    return { role: 'pumpkin' as const, ...PUMPKIN_WITCH_COMBAT };
  }
  const template = follower && FOLLOWER_TEMPLATES.find((f) => f.id === follower.id);
  const role = template?.role ?? null;
  const level = follower && Number.isSafeInteger(follower.level) ? Math.max(1, Math.min(role === 'crystal' ? MAX_BATTLE_COW_LEVEL : MAX_FOLLOWER_LEVEL, follower.level)) : 1;
  const clamp = (value: number | undefined, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0;
  return {
    role,
    attack: template ? clamp(follower?.attack, template.attack + (role === 'crystal' ? MAX_BATTLE_COW_LEVEL : MAX_FOLLOWER_LEVEL) * 2) : 0,
    defense: role === 'guardian' ? clamp(follower?.defense, 10 + MAX_FOLLOWER_LEVEL * 2) : 0,
    heal: role === 'healer' ? Math.min(15, 3 + Math.floor(level / 4)) : role === 'crystal' ? Math.min(10, 4 + Math.floor(level / 10)) : 0,
    crit: role === 'hunter' ? Math.min(5, 2 + Math.floor(level / 10)) : 0,
    pierce: role === 'mage' ? Math.min(0.08, 0.04 + level * 0.0008) : role === 'crystal' ? 0.02 : 0,
  };
}
