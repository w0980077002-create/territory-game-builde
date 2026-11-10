/**
 * Additional Dark Energy (Umbra) gear: 12 slots and a warehouse that are
 * strictly parallel to the hero's ordinary 7-slot equipment. Nothing here
 * reads or writes `player.equipped`, the ordinary inventory or the forge.
 *
 * Every number in this file is a TEST-SANDBOX value for the owner's phone
 * review. It is not a live balance table, a drop rate or a price.
 */
import { pick, type Rng } from './rng';

export const UMBRA_SLOTS = [
  { id: 'helmet', ru: 'Шлем', en: 'Helmet' },
  { id: 'amulet', ru: 'Амулет', en: 'Amulet' },
  { id: 'weapon', ru: 'Оружие', en: 'Weapon' },
  { id: 'spear', ru: 'Копьё', en: 'Spear' },
  { id: 'shield', ru: 'Щит', en: 'Shield' },
  { id: 'chest', ru: 'Нагрудник', en: 'Chest' },
  { id: 'gloves', ru: 'Перчатки', en: 'Gloves' },
  { id: 'belt', ru: 'Пояс', en: 'Belt' },
  { id: 'greaves', ru: 'Поножи', en: 'Greaves' },
  { id: 'boots', ru: 'Сапоги', en: 'Boots' },
  { id: 'ring', ru: 'Кольцо', en: 'Ring' },
  { id: 'sigil', ru: 'Знак', en: 'Sigil' },
] as const;
export type UmbraSlotId = (typeof UMBRA_SLOTS)[number]['id'];
export const UMBRA_SLOT_COUNT = 12;
/** Test-sandbox capacity; the live limit is not approved. */
export const UMBRA_STORAGE_CAP = 60;
export const UMBRA_MAX_ENHANCE = 15;

export const UMBRA_STATS = {
  attack: { ru: 'Атака', en: 'Attack', pct: false, weight: 1 },
  defense: { ru: 'Защита', en: 'Defense', pct: false, weight: 0.9 },
  hp: { ru: 'Здоровье', en: 'Health', pct: false, weight: 0.12 },
  crit: { ru: 'Шанс крита', en: 'Crit chance', pct: true, weight: 14 },
  critDamage: { ru: 'Сила крита', en: 'Crit damage', pct: true, weight: 6 },
  dodge: { ru: 'Уклонение', en: 'Dodge', pct: true, weight: 14 },
  block: { ru: 'Блок', en: 'Block', pct: true, weight: 12 },
  accuracy: { ru: 'Точность', en: 'Accuracy', pct: true, weight: 10 },
  bossDamage: { ru: 'Урон по боссам', en: 'Boss damage', pct: true, weight: 9 },
  darkWard: { ru: 'Защита от тьмы', en: 'Dark ward', pct: true, weight: 9 },
} as const;
export type UmbraStat = keyof typeof UMBRA_STATS;
export type StatLine = Readonly<{ stat: UmbraStat; value: number }>;
export type StatTotals = Partial<Record<UmbraStat, number>>;

export const UMBRA_RANKS = [
  { id: 1, ru: 'Тусклый', en: 'Dim', color: '#9aa3ad', mult: 1, affixes: 1 },
  { id: 2, ru: 'Сумеречный', en: 'Dusk', color: '#5fbf7a', mult: 1.25, affixes: 2 },
  { id: 3, ru: 'Теневой', en: 'Shadow', color: '#4f9cf0', mult: 1.55, affixes: 2 },
  { id: 4, ru: 'Бездонный', en: 'Abyssal', color: '#b46cf2', mult: 1.95, affixes: 3 },
  { id: 5, ru: 'Первородный', en: 'Primal', color: '#f2b84a', mult: 2.45, affixes: 4 },
] as const;
export const umbraRank = (rank: number) => UMBRA_RANKS[Math.min(5, Math.max(1, rank)) - 1];

const LOOT = 'assets/territory/cave-loot/2026-11-06/';
type Template = Readonly<{ id: string; slot: UmbraSlotId; ru: string; en: string; art: string; main: UmbraStat; base: number }>;
export const UMBRA_TEMPLATES: readonly Template[] = [
  { id: 'horned_helmet', slot: 'helmet', ru: 'Рогатый шлем', en: 'Horned Helmet', art: LOOT + '16-horned-helmet.webp', main: 'hp', base: 120 },
  { id: 'shadow_amulet', slot: 'amulet', ru: 'Тёмный амулет', en: 'Shadow Amulet', art: LOOT + '01-shadow-amulet.webp', main: 'crit', base: 1.2 },
  { id: 'void_axe', slot: 'weapon', ru: 'Топор Бездны', en: 'Void Axe', art: LOOT + '02-void-axe.webp', main: 'attack', base: 18 },
  { id: 'void_spear', slot: 'spear', ru: 'Копьё Бездны', en: 'Void Spear', art: LOOT + '06-void-spear.webp', main: 'attack', base: 14 },
  { id: 'ward_shield', slot: 'shield', ru: 'Щит защиты', en: 'Ward Shield', art: LOOT + '10-ward-shield.webp', main: 'block', base: 1.5 },
  { id: 'shadow_mail', slot: 'chest', ru: 'Тёмная кольчуга', en: 'Shadow Mail', art: LOOT + '11-shadow-mail.webp', main: 'defense', base: 16 },
  { id: 'royal_shadow_mail', slot: 'chest', ru: 'Королевская тёмная кольчуга', en: 'Royal Shadow Mail', art: LOOT + '12-royal-shadow-mail.webp', main: 'defense', base: 19 },
  { id: 'shadow_gauntlets', slot: 'gloves', ru: 'Теневые перчатки', en: 'Shadow Gauntlets', art: LOOT + '07-shadow-gauntlets.webp', main: 'attack', base: 9 },
  { id: 'gloom_belt', slot: 'belt', ru: 'Пояс сумрака', en: 'Gloom Belt', art: 'assets/territory/cave/items/gloom-belt.svg', main: 'hp', base: 90 },
  { id: 'shadow_greaves', slot: 'greaves', ru: 'Теневые поножи', en: 'Shadow Greaves', art: LOOT + '13-shadow-greaves.webp', main: 'defense', base: 12 },
  { id: 'rune_boots', slot: 'boots', ru: 'Рунные сапоги', en: 'Rune Boots', art: LOOT + '03-rune-boots.webp', main: 'dodge', base: 1.2 },
  { id: 'shadow_ring', slot: 'ring', ru: 'Кольцо Тени', en: 'Shadow Ring', art: LOOT + '09-shadow-ring.webp', main: 'critDamage', base: 3 },
  { id: 'rune_emblem', slot: 'sigil', ru: 'Рунный знак', en: 'Rune Sigil', art: LOOT + '15-rune-emblem.webp', main: 'accuracy', base: 1.5 },
];
export const umbraTemplate = (id: string) => UMBRA_TEMPLATES.find(t => t.id === id);

/**
 * Sets deliberately have different sizes (4 / 5 / 7): the reference shows a
 * 2/7 set, so "every set is 6/6" must never be hard-coded.
 */
export const UMBRA_SETS = [
  { id: 'gloom_warden', ru: 'Страж сумрака', en: 'Gloom Warden', slots: ['helmet', 'chest', 'gloves', 'boots'],
    bonuses: [{ need: 2, stats: [{ stat: 'hp', value: 150 }] }, { need: 4, stats: [{ stat: 'block', value: 4 }, { stat: 'defense', value: 30 }] }] },
  { id: 'forge_oath', ru: 'Клятва тёмного горна', en: 'Oath of the Dark Forge', slots: ['weapon', 'spear', 'shield', 'belt', 'greaves'],
    bonuses: [{ need: 2, stats: [{ stat: 'attack', value: 20 }] }, { need: 3, stats: [{ stat: 'critDamage', value: 8 }] }, { need: 5, stats: [{ stat: 'bossDamage', value: 6 }, { stat: 'attack', value: 35 }] }] },
  { id: 'void_sovereign', ru: 'Властелин пустоты', en: 'Void Sovereign', slots: ['helmet', 'amulet', 'weapon', 'chest', 'belt', 'ring', 'sigil'],
    bonuses: [{ need: 2, stats: [{ stat: 'crit', value: 2 }] }, { need: 4, stats: [{ stat: 'darkWard', value: 6 }, { stat: 'hp', value: 260 }] }, { need: 7, stats: [{ stat: 'bossDamage', value: 10 }, { stat: 'critDamage', value: 15 }, { stat: 'accuracy', value: 5 }] }] },
] as const satisfies readonly { id: string; ru: string; en: string; slots: readonly UmbraSlotId[]; bonuses: readonly { need: number; stats: readonly StatLine[] }[] }[];
export type UmbraSetId = (typeof UMBRA_SETS)[number]['id'];
export const umbraSet = (id: string | null | undefined) => UMBRA_SETS.find(s => s.id === id);

export type UmbraItem = Readonly<{
  id: string;
  templateId: string;
  slot: UmbraSlotId;
  rank: number;
  /** Item level = the cave floor it was found on. */
  level: number;
  main: StatLine;
  affixes: readonly StatLine[];
  setId: UmbraSetId | null;
  enhance: number;
  locked: boolean;
  /** Essence spent on enhancing; partly returned on dismantle. */
  spent: number;
  source: string;
}>;

const round = (stat: UmbraStat, value: number) => UMBRA_STATS[stat].pct ? Math.round(value * 10) / 10 : Math.round(value);
const AFFIX_BASE: Record<UmbraStat, number> = {
  attack: 6, defense: 6, hp: 45, crit: 0.6, critDamage: 1.6, dodge: 0.6, block: 0.7, accuracy: 0.8, bossDamage: 0.9, darkWard: 0.9,
};
const AFFIX_POOL = Object.keys(AFFIX_BASE) as UmbraStat[];
const levelScale = (level: number, pct: boolean) => pct ? 1 + level * 0.012 : 1 + level * 0.06;

function rollAffixes(rng: Rng, count: number, level: number, rank: number, exclude: UmbraStat): StatLine[] {
  const pool = AFFIX_POOL.filter(s => s !== exclude);
  const lines: StatLine[] = [];
  while (lines.length < count && pool.length) {
    const stat = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const pct = UMBRA_STATS[stat].pct;
    lines.push({ stat, value: round(stat, AFFIX_BASE[stat] * levelScale(level, pct) * (0.75 + rank * 0.12) * (0.8 + rng() * 0.4)) });
  }
  return lines;
}

/** Sandbox rank roll: deeper floors lean to higher ranks. NOT a live drop table. */
function rollRank(rng: Rng, floor: number, boss: boolean): number {
  const tier = Math.ceil(floor / 20);
  const roll = rng() + (boss ? 0.2 : 0);
  const shift = roll > 0.93 ? 1 : roll < 0.4 ? -1 : 0;
  return Math.min(5, Math.max(1, tier + shift));
}

export function rollUmbraItem(rng: Rng, opts: { id: string; floor: number; boss?: boolean; slot?: UmbraSlotId; forceSet?: boolean; source: string }): UmbraItem {
  const floor = Math.min(100, Math.max(1, Math.floor(opts.floor)));
  const slot = opts.slot ?? pick(rng, UMBRA_SLOTS).id;
  const template = pick(rng, UMBRA_TEMPLATES.filter(t => t.slot === slot));
  const rank = rollRank(rng, floor, !!opts.boss);
  const info = umbraRank(rank);
  const pct = UMBRA_STATS[template.main].pct;
  const main = { stat: template.main, value: round(template.main, template.base * levelScale(floor, pct) * info.mult * (0.92 + rng() * 0.16)) };
  const sets = UMBRA_SETS.filter(s => (s.slots as readonly string[]).includes(slot));
  const withSet = floor >= 41 && sets.length > 0 && (opts.forceSet || rng() < 0.35);
  return {
    id: opts.id, templateId: template.id, slot, rank, level: floor, main,
    affixes: rollAffixes(rng, info.affixes, floor, rank, template.main),
    setId: withSet ? pick(rng, sets).id : null, enhance: 0, locked: false, spent: 0, source: opts.source,
  };
}

export const enhancedMain = (item: UmbraItem): number => round(item.main.stat, item.main.value * (1 + 0.06 * item.enhance));
export const itemLines = (item: UmbraItem): StatLine[] => [{ stat: item.main.stat, value: enhancedMain(item) }, ...item.affixes];
const addLines = (totals: StatTotals, lines: readonly StatLine[]) => {
  for (const line of lines) totals[line.stat] = round(line.stat, (totals[line.stat] ?? 0) + line.value);
};
export const statPower = (totals: StatTotals): number =>
  Math.round(Object.entries(totals).reduce((sum, [stat, value]) => sum + UMBRA_STATS[stat as UmbraStat].weight * (value ?? 0), 0));
export function itemPower(item: UmbraItem): number {
  const totals: StatTotals = {};
  addLines(totals, itemLines(item));
  return statPower(totals);
}

/** Test-sandbox costs. */
export const enhanceCost = (item: UmbraItem): number => 8 + item.enhance * 4 * item.rank;
export const reforgeCost = (item: UmbraItem): number => 12 * item.rank;
export const dismantleYield = (item: UmbraItem): number => 4 * item.rank + Math.floor(item.level / 5) + Math.floor(item.spent * 0.6);

export type UmbraLoadout = Readonly<Partial<Record<UmbraSlotId, string>>>;
export const equippedItems = (items: readonly UmbraItem[], loadout: UmbraLoadout): UmbraItem[] =>
  UMBRA_SLOTS.map(slot => items.find(item => item.id === loadout[slot.id] && item.slot === slot.id)).filter((x): x is UmbraItem => !!x);

export type SetProgress = { set: (typeof UMBRA_SETS)[number]; have: number; size: number; active: number[] };
/** Set progress counts ONLY equipped Umbra pieces, never ordinary equipment. */
export function setProgress(worn: readonly UmbraItem[]): SetProgress[] {
  return UMBRA_SETS.map(set => {
    const have = worn.filter(item => item.setId === set.id).length;
    return { set, have, size: set.slots.length, active: set.bonuses.filter(b => have >= b.need).map(b => b.need) };
  }).filter(p => p.have > 0);
}

export function loadoutTotals(worn: readonly UmbraItem[]): StatTotals {
  const totals: StatTotals = {};
  for (const item of worn) addLines(totals, itemLines(item));
  for (const progress of setProgress(worn)) for (const bonus of progress.set.bonuses) {
    if (progress.have >= bonus.need) addLines(totals, bonus.stats);
  }
  return totals;
}
export const loadoutPower = (worn: readonly UmbraItem[]): number => statPower(loadoutTotals(worn));

/** Equipped-vs-candidate comparison: real power delta of the whole loadout (sets included). */
export function compareCandidate(items: readonly UmbraItem[], loadout: UmbraLoadout, candidate: UmbraItem) {
  const worn = equippedItems(items, loadout);
  const current = worn.find(item => item.slot === candidate.slot) ?? null;
  const after = [...worn.filter(item => item.slot !== candidate.slot), candidate];
  const stats = new Set<UmbraStat>([...itemLines(candidate), ...(current ? itemLines(current) : [])].map(l => l.stat));
  const value = (item: UmbraItem | null, stat: UmbraStat) => item ? itemLines(item).filter(l => l.stat === stat).reduce((s, l) => s + l.value, 0) : 0;
  return {
    current,
    powerDelta: loadoutPower(after) - loadoutPower(worn),
    lines: [...stats].map(stat => ({ stat, current: value(current, stat), candidate: value(candidate, stat) })),
  };
}

export function rerollAffixes(rng: Rng, item: UmbraItem): UmbraItem {
  return { ...item, affixes: rollAffixes(rng, umbraRank(item.rank).affixes, item.level, item.rank, item.main.stat) };
}
