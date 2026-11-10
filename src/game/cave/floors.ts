/**
 * Dark Cave floor catalog — original TERRITORY cave content.
 *
 * The server encounter contract is `adventure_v1_stage_<floor>` (100 floors,
 * elite on 5/15 and boss on 10/20 of every 20-floor depth). Combat stats,
 * rewards and progression remain server-authoritative; this catalog only
 * describes what the player sees for the SAME encounter: cave depth, enemy
 * identity and its combat art. Kinds must stay in parity with the encounter
 * contract (see scripts/check-cave-systems.mjs).
 */
export const CAVE_FLOOR_COUNT = 100;
export const CAVE_FLOORS_PER_DEPTH = 20;

export type CaveFloorKind = 'normal' | 'elite' | 'boss';
export type CaveDepth = Readonly<{ id: number; ru: string; en: string; hue: string }>;
export type CaveFloor = Readonly<{
  index: number;
  depth: CaveDepth;
  floorInDepth: number;
  kind: CaveFloorKind;
  enemyId: string;
  enemyRu: string;
  enemyEn: string;
  /** Path under assets/territory/characters/. */
  enemyArt: string;
}>;

export const CAVE_DEPTHS: readonly CaveDepth[] = [
  { id: 1, ru: 'Корни тьмы', en: 'Roots of Dark', hue: '#8f5bd6' },
  { id: 2, ru: 'Шепчущие штольни', en: 'Whispering Galleries', hue: '#5b7fe0' },
  { id: 3, ru: 'Озеро безмолвия', en: 'Lake of Silence', hue: '#3fb3c9' },
  { id: 4, ru: 'Кузня бездны', en: 'Abyss Forge', hue: '#e0704a' },
  { id: 5, ru: 'Престол пустоты', en: 'Throne of the Void', hue: '#d65bc4' },
];

type Name = readonly [ru: string, en: string];
// Order of sprites matches the encounter roster: floor (n-1) % 5.
const SPRITES = ['goblin', 'wolf', 'bandit', 'boar', 'troll'] as const;
const DWELLERS: readonly (readonly Name[])[] = [
  [['Теневой грабитель', 'Shadow Looter'], ['Сумрачный волк', 'Dusk Wolf'], ['Одержимый рудокоп', 'Possessed Miner'], ['Вепрь тёмных корней', 'Darkroot Boar'], ['Пещерный тролль', 'Cave Troll']],
  [['Шепчущий лазутчик', 'Whispering Scout'], ['Волк штолен', 'Gallery Wolf'], ['Клятвопреступник', 'Oathbreaker'], ['Вепрь-рудокрушитель', 'Orecrusher Boar'], ['Тролль-камнеед', 'Stone-eater Troll']],
  [['Тонущий мародёр', 'Drowned Marauder'], ['Призрачный волк озера', 'Lake Wraith Wolf'], ['Безмолвный дозорный', 'Silent Watchman'], ['Вепрь чёрной воды', 'Blackwater Boar'], ['Тролль безмолвия', 'Troll of Silence']],
  [['Раб тёмного горна', 'Forge Thrall'], ['Пепельный волк', 'Ash Wolf'], ['Кузнец-отступник', 'Renegade Smith'], ['Раскалённый вепрь', 'Ember Boar'], ['Тролль-молотобоец', 'Hammer Troll']],
  [['Слуга пустоты', 'Void Servant'], ['Волк престола', 'Throne Wolf'], ['Гвардеец пустоты', 'Void Guard'], ['Вепрь бездны', 'Abyss Boar'], ['Тролль-разрушитель', 'Ravager Troll']],
];
// Two bosses per depth (floors 10 and 20), each appears once.
const BOSSES: readonly (readonly [sprite: string, ru: string, en: string])[] = [
  ['bandit_chief', 'Атаман тёмной жилы', 'Chief of the Dark Vein'],
  ['barrow_guardian', 'Страж запечатанных врат', 'Warden of the Sealed Gate'],
  ['dark_priest', 'Жрец тёмной энергии', 'Priest of Dark Energy'],
  ['northern_jarl', 'Ярл-отступник', 'The Forsworn Jarl'],
  ['storm_lord', 'Повелитель подземной грозы', 'Lord of the Deep Storm'],
  ['fire_lord', 'Хранитель утонувшего пламени', 'Keeper of the Drowned Flame'],
  ['undead_king', 'Мёртвый король-кузнец', 'The Dead Smith-King'],
  ['giant_king', 'Исполин глубин', 'Colossus of the Depths'],
  ['chaos_shadow', 'Тень престола', 'Shadow of the Throne'],
  ['abyss_demon', 'Демон пустоты', 'Demon of the Void'],
];

/** Reject invalid indices instead of wrapping or inventing floor 101+. */
export function getCaveFloor(index: number): CaveFloor {
  if (!Number.isInteger(index) || index < 1 || index > CAVE_FLOOR_COUNT) throw new RangeError('invalid_cave_floor');
  const floorInDepth = ((index - 1) % CAVE_FLOORS_PER_DEPTH) + 1;
  const depthIndex = Math.floor((index - 1) / CAVE_FLOORS_PER_DEPTH);
  const depth = CAVE_DEPTHS[depthIndex];
  const boss = floorInDepth === 10 || floorInDepth === 20;
  const elite = floorInDepth === 5 || floorInDepth === 15;
  if (boss) {
    const [sprite, ru, en] = BOSSES[depthIndex * 2 + (floorInDepth === 20 ? 1 : 0)];
    return { index, depth, floorInDepth, kind: 'boss', enemyId: 'cave_' + sprite, enemyRu: ru, enemyEn: en, enemyArt: 'bosses/' + sprite };
  }
  const roster = (index - 1) % SPRITES.length;
  const [ru, en] = DWELLERS[depthIndex][roster];
  return {
    index, depth, floorInDepth, kind: elite ? 'elite' : 'normal',
    enemyId: `cave_d${depth.id}_${SPRITES[roster]}`,
    enemyRu: elite ? 'Вожак: ' + ru : ru, enemyEn: elite ? 'Alpha: ' + en : en,
    enemyArt: 'enemies/' + SPRITES[roster],
  };
}

export function buildCaveFloors(): CaveFloor[] {
  return Array.from({ length: CAVE_FLOOR_COUNT }, (_, i) => getCaveFloor(i + 1));
}

/**
 * Loot category milestones shown before a fight. Reference thresholds only
 * (gems from 6, sets from 41): NOT an activated server drop table.
 */
export const CAVE_LOOT_TIERS = [
  { id: 'gear', fromFloor: 1, ru: 'Тёмные вещи', en: 'Dark gear' },
  { id: 'essence', fromFloor: 1, ru: 'Тёмная эссенция', en: 'Dark essence' },
  { id: 'gems', fromFloor: 6, ru: 'Самоцветы 1–3 ур.', en: 'Gems Lv.1–3' },
  { id: 'sets', fromFloor: 41, ru: 'Комплектные вещи', en: 'Set pieces' },
] as const;
export type CaveLootCategory = (typeof CAVE_LOOT_TIERS)[number]['id'];

/**
 * Repeat-farm rule proposal (isolated, not a live API): only an already
 * cleared floor may be repeated, and a repeat can never lower or raise the
 * maximum cleared depth.
 */
export function planCaveRepeat(completedFloor: number, floor: number): { ok: true } | { ok: false; reason: 'invalid_floor' | 'not_cleared' } {
  if (!Number.isInteger(floor) || floor < 1 || floor > CAVE_FLOOR_COUNT) return { ok: false, reason: 'invalid_floor' };
  if (!Number.isInteger(completedFloor) || floor > completedFloor) return { ok: false, reason: 'not_cleared' };
  return { ok: true };
}
export function settleCaveRepeat(completedFloor: number, floor: number): number {
  const plan = planCaveRepeat(completedFloor, floor);
  if (!plan.ok) throw new Error('cave_repeat_' + plan.reason);
  return completedFloor;
}
