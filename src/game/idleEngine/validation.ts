import type { IdleCatalog, IdleEffect, IdleLoadout, IdleRune, IdleSkill, IdleSkillCategory } from './types';

export const CATEGORIES: IdleSkillCategory[] = ['base', 'core', 'control', 'awakening', 'final'];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, min = 0, max = 1e9): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every(id) && new Set(v).size === v.length;
export function compatible(rune: IdleRune, skill: IdleSkill): boolean {
  return (!!rune.skillIds?.length || !!rune.categories?.length)
    && (!rune.skillIds || rune.skillIds.includes(skill.id))
    && (!rune.categories || rune.categories.includes(skill.category));
}
function effect(v: unknown): v is IdleEffect {
  if (!record(v) || !number(v.strength) || (v.target !== undefined && v.target !== 'self' && v.target !== 'opponent')
    || (v.vfxKey !== undefined && !id(v.vfxKey))) return false;
  if (v.type === 'magic' || v.type === 'energy') return true;
  if (!number(v.durationMs, 1)) return false;
  if (v.type === 'burn') return number(v.tickMs, 1);
  return ['slow', 'mitigation', 'crit', 'precision'].includes(String(v.type)) && number(v.strength, 0, 1);
}
const effects = (v: unknown): boolean => v === undefined || (Array.isArray(v) && v.length <= 16 && v.every(effect));
const statKeys = ['maxHp', 'attack', 'defense', 'attackIntervalMs', 'windupMs', 'critChance', 'criticalMultiplier',
  'blockChance', 'blockReduction', 'dodgeChance', 'precision', 'maxEnergy', 'energy', 'energyRegenPerSecond'];

/** Empty builds are legal and use basic attacks. Malformed data returns errors, never throws. */
export function validateIdleLoadout(loadout: IdleLoadout, catalog: IdleCatalog): string[] {
  const errors: string[] = [];
  if (!record(catalog) || !Array.isArray(catalog.skills) || !Array.isArray(catalog.runes) || !Array.isArray(catalog.passives)) {
    return ['catalog: expected skills, runes and passives arrays'];
  }
  if ([catalog.skills, catalog.runes, catalog.passives].some(items => items.length > 100)) return ['catalog: too many entries'];
  const seen = new Set<string>();
  for (const item of [...catalog.skills, ...catalog.runes, ...catalog.passives]) {
    if (!record(item) || !id(item.id) || seen.has(item.id)) errors.push('catalog: invalid or duplicate id');
    else seen.add(item.id);
  }
  for (const s of catalog.skills) {
    if (!record(s) || !CATEGORIES.includes(s.category) || !number(s.cooldownMs) || !number(s.energyCost)
      || (s.priority !== undefined && !number(s.priority, -1e9))
      || (s.multiplier !== undefined && !number(s.multiplier))
      || (s.windupMs !== undefined && !number(s.windupMs)) || !effects(s.effects)
      || (s.hitCount !== undefined && (!number(s.hitCount, 1, 3) || !Number.isInteger(s.hitCount)))
      || (s.hitGapMs !== undefined && !number(s.hitGapMs, 20, 3000))
      || (s.vfxKey !== undefined && !id(s.vfxKey))
      || (s.condition !== undefined && (!record(s.condition) || Object.entries(s.condition).some(([k, v]) =>
        !['selfHpBelow', 'enemyHpBelow', 'energyAtLeast'].includes(k) || !number(v, 0, k === 'energyAtLeast' ? 1e9 : 1))))) {
      errors.push('catalog: invalid skill');
    }
  }
  for (const category of CATEGORIES) {
    if (catalog.skills.filter(s => record(s) && s.category === category).length > 3) errors.push(`catalog: more than 3 ${category} candidates`);
  }
  for (const r of catalog.runes) {
    if (!record(r) || !number(r.chance, 0, 1) || !number(r.cooldownMs)
      || !Array.isArray(r.effects) || r.effects.length === 0 || !effects(r.effects)
      || (r.skillIds !== undefined && (!strings(r.skillIds) || r.skillIds.some(s => !catalog.skills.some(k => record(k) && k.id === s))))
      || (r.categories !== undefined && (!strings(r.categories) || r.categories.some(c => !CATEGORIES.includes(c))))
      || (!r.skillIds?.length && !r.categories?.length) || (r.vfxKey !== undefined && !id(r.vfxKey))) errors.push('catalog: invalid rune');
  }
  for (const p of catalog.passives) {
    if (!record(p) || !record(p.modifiers) || Object.entries(p.modifiers).some(([k, v]) => !statKeys.includes(k) || !number(v))) {
      errors.push('catalog: invalid passive');
    }
  }
  if (errors.length) return errors;
  if (!record(loadout) || !Array.isArray(loadout.active) || !Array.isArray(loadout.passiveIds)) return ['loadout: expected active and passiveIds arrays'];
  if (loadout.active.length > 5) errors.push('loadout: at most 5 active skills');
  if (loadout.passiveIds.length > 3) errors.push('loadout: at most 3 passives');
  const categories = new Set<string>();
  for (const slot of loadout.active.slice(0, 100)) {
    if (!record(slot) || !id(slot.skillId)) { errors.push('loadout: invalid active slot'); continue; }
    const skill = catalog.skills.find(s => s.id === slot.skillId);
    if (!skill) { errors.push(`loadout: unknown skill ${slot.skillId}`); continue; }
    if (categories.has(skill.category)) errors.push(`loadout: duplicate category ${skill.category}`);
    categories.add(skill.category);
    const runes = slot.runeIds ?? [];
    if (!strings(runes) || runes.length > 2) { errors.push(`loadout: invalid rune slots for ${skill.id}`); continue; }
    for (const runeId of runes) {
      const rune = catalog.runes.find(r => r.id === runeId);
      if (!rune || !compatible(rune, skill)) errors.push(`loadout: incompatible rune ${runeId} for ${skill.id}`);
    }
  }
  if (!strings(loadout.passiveIds) || loadout.passiveIds.some(p => !catalog.passives.some(entry => entry.id === p))) errors.push('loadout: invalid passive selection');
  return errors;
}
