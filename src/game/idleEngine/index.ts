import type {
  IdleActor, IdleCatalog, IdleCombatEvent, IdleCombatInput, IdleCombatState, IdleEffect,
  IdleEffectType, IdleFighterState, IdleLoadout, IdleOwnership,
} from './types.ts';
export type * from './types.ts';

const categories = ['base', 'core', 'control', 'awakening', 'final'];
const effectTypes = ['burn', 'bleed', 'slow', 'mitigation', 'crit', 'magic', 'energy', 'precision', 'evasion', 'blind', 'energy_regen', 'heal', 'interrupt', 'attack', 'defense'];
const actors: IdleActor[] = ['hero', 'enemy'];
const MAX_VALUE = 1e9;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const finite = (v: unknown, min = 0, max = MAX_VALUE): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown, min = 0, max = MAX_VALUE): v is number => finite(v, min, max) && Number.isInteger(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_:-]{0,63}$/.test(v)
  && !['constructor', 'prototype', '__proto__'].includes(v);
const own = (v: object, key: string) => Object.prototype.hasOwnProperty.call(v, key);
const fail = (message: string): never => { throw new Error(`IdleCombat: ${message}`); };
const opposite = (actor: IdleActor): IdleActor => actor === 'hero' ? 'enemy' : 'hero';
const probability = (n: number) => Math.max(0, Math.min(1, n));

function validEffect(e: IdleEffect, passive = false): boolean {
  if (!e || !effectTypes.includes(e.type) || !['self', 'opponent'].includes(e.target)
    || !finite(e.value) || !integer(e.durationMs, 0, 600_000)) return false;
  if (['slow', 'mitigation', 'crit', 'precision', 'evasion', 'blind', 'energy_regen'].includes(e.type) && !finite(e.value, 0, 1)) return false;
  if (['attack', 'defense'].includes(e.type) && (e.target !== 'self' || !finite(e.value, 0, 1000))) return false;
  if (e.type === 'interrupt' && (e.target !== 'opponent' || e.value !== 0)) return false;
  if (e.type === 'heal' && e.durationMs !== 0) return false;
  if (e.type === 'slow' && e.value >= 1) return false;
  if (['burn', 'bleed'].includes(e.type) && (!integer(e.tickMs, 10, 600_000) || e.durationMs < e.tickMs)) return false;
  if (passive) return ['mitigation', 'crit', 'precision', 'evasion', 'energy_regen', 'attack', 'defense'].includes(e.type) && e.target === 'self' && e.durationMs === 0;
  return ['magic', 'energy', 'heal'].includes(e.type) || e.durationMs > 0;
}

/** Returns errors instead of trusting saved/client-controlled catalogs or loadouts. */
export function validateIdleCatalog(catalog: IdleCatalog): string[] {
  const errors: string[] = [];
  if (!catalog || !Array.isArray(catalog.skills) || !Array.isArray(catalog.runes) || !Array.isArray(catalog.passives)) return ['invalid_catalog'];
  if (catalog.skills.length > 15 || catalog.runes.length > 100 || catalog.passives.length > 100) return ['catalog_too_large'];
  const ids = new Set<string>();
  const categoryCounts: Record<string, number> = {};
  for (const s of catalog.skills) {
    if (!s || !identifier(s.id) || ids.has(s.id) || !categories.includes(s.category)
      || !integer(s.unlockLevel, 1) || !finite(s.priority, -MAX_VALUE)
      || (s.hpBelow !== undefined && !finite(s.hpBelow, 0, 1))
      || !Array.isArray(s.levels) || !s.levels.length || s.levels.length > 1000) { errors.push('invalid_skill'); continue; }
    ids.add(s.id);
    categoryCounts[s.category] = (categoryCounts[s.category] ?? 0) + 1;
    if (categoryCounts[s.category] > 3) errors.push(`category_candidates:${s.category}`);
    for (const l of s.levels) if (!l || !finite(l.multiplier, 0, 1000) || !finite(l.energyCost)
      || !integer(l.cooldownMs, 0, 600_000) || !integer(l.windupMs, 0, 600_000)
      || !Array.isArray(l.effects) || l.effects.length > 16 || !l.effects.every(e => validEffect(e))) errors.push(`invalid_skill_level:${s.id}`);
  }
  for (const r of catalog.runes) {
    if (!r || !identifier(r.id) || ids.has(r.id) || !integer(r.unlockLevel, 1)
      || !Array.isArray(r.compatibleSkillIds) || !r.compatibleSkillIds.length
      || new Set(r.compatibleSkillIds).size !== r.compatibleSkillIds.length
      || !r.compatibleSkillIds.every(id => catalog.skills.some(s => s?.id === id))
      || !Array.isArray(r.levels) || !r.levels.length || r.levels.length > 1000) { errors.push('invalid_rune'); continue; }
    ids.add(r.id);
    for (const l of r.levels) if (!l || !finite(l.chance, 0, 1) || !integer(l.cooldownMs, 0, 600_000)
      || !Array.isArray(l.effects) || !l.effects.length || l.effects.length > 16 || !l.effects.every(e => validEffect(e))) errors.push(`invalid_rune_level:${r.id}`);
  }
  for (const p of catalog.passives) {
    if (!p || !identifier(p.id) || ids.has(p.id) || !integer(p.unlockLevel, 1)
      || !Array.isArray(p.levels) || !p.levels.length || p.levels.length > 1000) { errors.push('invalid_passive'); continue; }
    ids.add(p.id);
    for (const l of p.levels) if (!l || !Array.isArray(l.effects) || !l.effects.length || l.effects.length > 16
      || !l.effects.every(e => validEffect(e, true))) errors.push(`invalid_passive_level:${p.id}`);
  }
  return errors;
}

export function validateIdleLoadout(loadout: IdleLoadout, catalog: IdleCatalog, ownership?: IdleOwnership): string[] {
  const errors = validateIdleCatalog(catalog);
  if (errors.length) return errors;
  if (!loadout || !Array.isArray(loadout.skills) || !Array.isArray(loadout.passives)) return ['invalid_loadout'];
  if (loadout.skills.length > 5 || loadout.passives.length > 3) errors.push('slot_limit');
  if (ownership && (!integer(ownership.heroLevel, 1) || !ownership.skills || !ownership.runes || !ownership.passives)) return ['invalid_ownership'];
  const seen = new Set<string>();
  const usedCategories = new Set<string>();
  function owned(kind: 'skills' | 'runes' | 'passives', id: string, level: number, unlock: number) {
    if (ownership && (ownership.heroLevel < unlock || !own(ownership[kind], id)
      || !integer(ownership[kind][id], level))) errors.push(`not_owned:${id}`);
  }
  for (const s of loadout.skills) {
    const def = catalog.skills.find(d => d.id === s?.skillId);
    if (!def || !integer(s.level, 1, def.levels.length) || seen.has(s.skillId)) { errors.push('invalid_equipped_skill'); continue; }
    seen.add(s.skillId);
    if (usedCategories.has(def.category)) errors.push(`duplicate_category:${def.category}`);
    usedCategories.add(def.category);
    owned('skills', s.skillId, s.level, def.unlockLevel);
    if (!Array.isArray(s.runes) || s.runes.length > 2) { errors.push(`rune_slot_limit:${s.skillId}`); continue; }
    for (const r of s.runes) {
      const rune = catalog.runes.find(d => d.id === r?.runeId);
      if (!rune || !integer(r.level, 1, rune.levels.length) || !rune.compatibleSkillIds.includes(s.skillId)
        || seen.has(`${s.skillId}/${r.runeId}`)) { errors.push('invalid_equipped_rune'); continue; }
      seen.add(`${s.skillId}/${r.runeId}`);
      owned('runes', r.runeId, r.level, rune.unlockLevel);
    }
  }
  for (const p of loadout.passives) {
    const def = catalog.passives.find(d => d.id === p?.passiveId);
    if (!def || !integer(p.level, 1, def.levels.length) || seen.has(p.passiveId)) { errors.push('invalid_equipped_passive'); continue; }
    seen.add(p.passiveId);
    owned('passives', p.passiveId, p.level, def.unlockLevel);
  }
  return errors;
}

function emit(state: IdleCombatState, events: IdleCombatEvent[], event: Omit<IdleCombatEvent, 'id' | 'atMs'>) {
  events.push(clone({ ...event, id: `${state.input.stage}:${state.nextEventId++}`, atMs: state.atMs }));
}
function validateInput(input: IdleCombatInput) {
  if (!input || !integer(input.seed, 0, 0xffffffff) || !integer(input.stage, 1)
    || !['pve', 'boss', 'pvp'].includes(input.mode) || !['manual', 'auto'].includes(input.control)) fail('invalid input');
  const r = input.rules;
  if (!r || !integer(r.stepMs, 10, 1000) || !integer(r.maxDurationMs, r.stepMs, 600_000)
    || r.maxDurationMs % r.stepMs || !integer(r.approachMs, 0, 600_000)
    || !integer(r.attackIntervalMs, r.stepMs, 600_000) || !integer(r.basicWindupMs, 0, 600_000)
    || !finite(r.basicMultiplier, 0, 1000) || !finite(r.defenseFactor, 0, 1000)
    || !finite(r.magicDefenseFactor, 0, 1000) || !finite(r.minimumDamage)
    || !finite(r.critMultiplier, 1, 1000) || !finite(r.blockMultiplier, 0, 1)
    || !finite(r.maxEnergy) || !finite(r.initialEnergy, 0, r.maxEnergy)
    || !finite(r.energyPerSecond) || !r.modeDamageMultiplier
    || !['pve', 'boss', 'pvp'].every(m => finite(r.modeDamageMultiplier[m as keyof typeof r.modeDamageMultiplier], 0, 1000))) fail('invalid rules');
  for (const actor of actors) {
    const f = input[actor];
    const s = f?.stats;
    if (!s || !finite(s.maxHp, 1) || !finite(s.hp, 1, s.maxHp) || !finite(s.attack)
      || !finite(s.defense) || !finite(s.critChance, 0, 1) || !finite(s.dodgeChance, 0, 1)
      || !finite(s.blockChance, 0, 1)
      || (s.critMultiplier !== undefined && !finite(s.critMultiplier, 1, 1000))) fail(`invalid ${actor} stats`);
    const errors = validateIdleLoadout(f.loadout, input.catalog, f.ownership);
    if (errors.length) fail(errors.join(','));
    if (f.resistances && Object.entries(f.resistances).some(([k, v]) => !effectTypes.includes(k) || !finite(v, 0, 1))) fail('invalid resistance');
    if (f.phases && (!Array.isArray(f.phases) || f.phases.length > 20)) fail('invalid phases');
    let previous = 1;
    const phaseIds = new Set<string>();
    for (const p of f.phases ?? []) {
      if (!p || !identifier(p.id) || phaseIds.has(p.id) || !finite(p.hpBelow, 0, previous)
        || p.hpBelow >= previous || !finite(p.attackMultiplier, 0, 1000) || !finite(p.defenseMultiplier, 0, 1000)
        || !p.resistances || Object.entries(p.resistances).some(([k,v]) => !effectTypes.includes(k) || !finite(v,0,1))) fail('invalid phase');
      phaseIds.add(p.id);
      previous = p.hpBelow;
    }
  }
}

export function createIdleCombat(input: IdleCombatInput): IdleCombatState {
  validateInput(input);
  const copy = clone(input);
  const fighter = (actor: IdleActor): IdleFighterState => ({ ...clone(copy[actor]), energy: copy.rules.initialEnergy,
    nextAttackAtMs: copy.rules.approachMs, cooldowns: {}, runeCooldowns: {}, statuses: [], pending: null, phase: -1 });
  const state: IdleCombatState = { version: 1, input: copy, actors: { hero: fighter('hero'), enemy: fighter('enemy') },
    atMs: 0, remainderMs: 0, rng: input.seed, nextEventId: 0, status: 'fighting', manualQueue: [], bufferedEvents: [] };
  for (const actor of actors) {
    emit(state, state.bufferedEvents, { actor, type: 'spawn' });
    emit(state, state.bufferedEvents, { actor, type: 'approach', target: opposite(actor), value: copy.rules.approachMs });
    for (const p of copy[actor].loadout.passives) {
      const def = copy.catalog.passives.find(d => d.id === p.passiveId)!;
      for (const effect of def.levels[p.level - 1].effects) applyEffect(state, state.bufferedEvents, actor, effect, p.passiveId, undefined, true);
    }
  }
  return state;
}

/** Schedule manual intent; the simulator still enforces ownership, energy and cooldown at execution. */
export function queueIdleSkill(state: IdleCombatState, skillId: string, atMs = state.atMs, actor: IdleActor = 'hero'): IdleCombatState {
  if (!actors.includes(actor) || state.status !== 'fighting' || !identifier(skillId)
    || !integer(atMs, state.atMs, state.input.rules.maxDurationMs)
    || !state.actors[actor].loadout.skills.some(s => s.skillId === skillId)
    || state.manualQueue.length >= 128) fail('invalid manual command');
  const next = clone(state);
  next.manualQueue.push({ actor, skillId, atMs });
  next.manualQueue.sort((a, b) => a.atMs - b.atMs);
  return next;
}

function random(state: IdleCombatState) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 0x100000000;
}
function modifier(f: IdleFighterState, type: IdleEffectType) {
  return f.statuses.filter(s => s.effect.type === type).reduce((sum, s) => sum + s.effect.value, 0);
}
function phase(f: IdleFighterState) { return f.phases?.[f.phase]; }
function resistance(f: IdleFighterState, type: IdleEffectType) {
  return phase(f)?.resistances[type] ?? f.resistances?.[type] ?? 0;
}
function death(state: IdleCombatState, events: IdleCombatEvent[], victim: IdleActor) {
  if (state.status !== 'fighting') return;
  state.status = victim === 'hero' ? 'enemy_won' : 'hero_won';
  state.actors.hero.pending = null;
  state.actors.enemy.pending = null;
  state.manualQueue = [];
  emit(state, events, { actor: victim, type: 'death' });
  if (victim === 'enemy') {
    emit(state, events, { actor: 'hero', type: 'stage_clear', value: state.input.stage });
    // Rendering cue only. No inventory, reward value, currency or save mutation.
    emit(state, events, { actor: 'hero', type: 'loot_visual' });
  }
}
function updatePhase(state: IdleCombatState, events: IdleCombatEvent[], actor: IdleActor) {
  const f = state.actors[actor];
  for (let i = f.phase + 1; i < (f.phases?.length ?? 0); i++) {
    const p = f.phases![i];
    if (f.stats.hp / f.stats.maxHp > p.hpBelow) break;
    f.phase = i;
    emit(state, events, { actor, type: 'phase_change', phaseId: p.id });
  }
}
function damage(state: IdleCombatState, events: IdleCombatEvent[], actor: IdleActor, target: IdleActor,
  amount: number, skillId?: string, runeId?: string, effectId?: string, vfxKey?: string) {
  const f = state.actors[target];
  const value = Math.min(f.stats.hp, Math.max(0, Math.floor(amount)));
  f.stats.hp -= value;
  // Exactly this event changes HP; critical/block/proc events are informational.
  emit(state, events, { actor, target, type: 'impact', value, skillId, runeId, effectId, vfxKey });
  if (f.stats.hp <= 0) death(state, events, target);
  else updatePhase(state, events, target);
}
function applyEffect(state: IdleCombatState, events: IdleCombatEvent[], actor: IdleActor, original: IdleEffect,
  skillId?: string, runeId?: string, permanent = false) {
  if (state.status !== 'fighting') return;
  const target = original.target === 'self' ? actor : opposite(actor);
  const f = state.actors[target];
  const resisted = original.target === 'opponent' ? resistance(f, original.type) : 0;
  if (resisted >= 1) return;
  const effect = { ...original, value: original.value * (1 - resisted) };
  if (effect.type === 'heal') {
    if (f.stats.hp <= 0) return;
    const value = Math.min(f.stats.maxHp - f.stats.hp, Math.max(0, Math.floor(effect.value)));
    f.stats.hp += value;
    emit(state, events, { actor, target, type: 'heal', value, skillId, runeId, vfxKey: effect.vfxKey });
    return;
  }
  if (effect.type === 'interrupt') {
    if (!f.pending || f.statuses.some(s => s.effect.type === 'interrupt' && s.expiresAtMs > state.atMs)) return;
    if (resisted > 0 && random(state) < resisted) return;
    f.pending = null;
  }
  if (effect.type === 'energy') {
    const value = Math.min(effect.value, state.input.rules.maxEnergy - f.energy);
    f.energy += value;
    emit(state, events, { actor, target, type: 'status_apply', value, skillId, runeId, vfxKey: effect.vfxKey });
    return;
  }
  if (effect.type === 'magic') {
    const rules = state.input.rules;
    const amount = Math.max(rules.minimumDamage, effect.value * rules.modeDamageMultiplier[state.input.mode]
      - f.stats.defense * (1 + modifier(f, 'defense')) * (phase(f)?.defenseMultiplier ?? 1) * rules.magicDefenseFactor)
      * (1 - probability(modifier(f, 'mitigation')));
    damage(state, events, actor, target, amount, skillId, runeId, undefined, effect.vfxKey);
    return;
  }
  // Refresh same-source status; no unbounded stacking or recursive effect/proc chains.
  const key = `${actor}/${skillId ?? ''}/${runeId ?? ''}/${effect.type}/${target}`;
  const previous = f.statuses.findIndex(s => s.id === key);
  const nextTickAtMs = previous >= 0 && (effect.type === 'burn' || effect.type === 'bleed')
    ? f.statuses[previous].nextTickAtMs : state.atMs + (effect.tickMs ?? effect.durationMs);
  const status = { id: key, source: actor, effect, ...(skillId ? { skillId } : {}), ...(runeId ? { runeId } : {}),
    expiresAtMs: permanent ? state.input.rules.maxDurationMs + 1 : state.atMs + effect.durationMs, nextTickAtMs };
  if (previous < 0) f.statuses.push(status); else f.statuses[previous] = status;
  emit(state, events, { actor, target, type: 'status_apply', skillId, runeId, effectId: key,
    value: effect.value, vfxKey: effect.vfxKey });
}
function resolveAttack(state: IdleCombatState, events: IdleCombatEvent[], actor: IdleActor, skillId?: string) {
  const attacker = state.actors[actor];
  const target = opposite(actor);
  const defender = state.actors[target];
  const skill = skillId ? state.input.catalog.skills.find(s => s.id === skillId) : undefined;
  const selected = attacker.loadout.skills.find(s => s.skillId === skillId);
  const level = skill && selected ? skill.levels[selected.level - 1] : undefined;
  const precision = probability(modifier(attacker, 'precision'));
  const blind = probability(modifier(attacker, 'blind'));
  if (random(state) < probability(defender.stats.dodgeChance + modifier(defender, 'evasion') + blind - precision)) {
    emit(state, events, { actor: target, target: actor, type: 'dodge', skillId });
    return;
  }
  const rules = state.input.rules;
  let value = Math.max(rules.minimumDamage,
    attacker.stats.attack * (1 + modifier(attacker, 'attack'))
    * (phase(attacker)?.attackMultiplier ?? 1) * (level?.multiplier ?? rules.basicMultiplier)
    * rules.modeDamageMultiplier[state.input.mode]
    - defender.stats.defense * (1 + modifier(defender, 'defense'))
    * (phase(defender)?.defenseMultiplier ?? 1) * rules.defenseFactor);
  if (random(state) < probability(attacker.stats.critChance + modifier(attacker, 'crit'))) {
    value *= attacker.stats.critMultiplier ?? rules.critMultiplier;
    emit(state, events, { actor, target, type: 'critical', skillId });
  }
  if (random(state) < defender.stats.blockChance) {
    value *= rules.blockMultiplier;
    emit(state, events, { actor: target, target: actor, type: 'block', skillId });
  }
  value *= 1 - probability(modifier(defender, 'mitigation'));
  damage(state, events, actor, target, value, skillId, undefined, undefined, skill?.vfxKey);
  for (const effect of level?.effects ?? []) applyEffect(state, events, actor, effect, skillId);
  for (const equipped of selected?.runes ?? []) {
    if (state.status !== 'fighting') break;
    const rune = state.input.catalog.runes.find(r => r.id === equipped.runeId)!;
    const rl = rune.levels[equipped.level - 1];
    const key = `${skillId}/${rune.id}`;
    if (state.atMs < (attacker.runeCooldowns[key] ?? 0) || random(state) >= rl.chance) continue;
    attacker.runeCooldowns[key] = state.atMs + rl.cooldownMs;
    emit(state, events, { actor, target, type: 'rune_proc', skillId, runeId: rune.id, vfxKey: rune.vfxKey });
    for (const effect of rl.effects) applyEffect(state, events, actor, effect, skillId, rune.id);
  }
}
function startAttack(state: IdleCombatState, events: IdleCombatEvent[], actor: IdleActor) {
  const f = state.actors[actor];
  if (f.pending || state.atMs < f.nextAttackAtMs) return;
  const ready = f.loadout.skills.filter(s => {
    const def = state.input.catalog.skills.find(d => d.id === s.skillId)!;
    const l = def.levels[s.level - 1];
    return (f.cooldowns[s.skillId] ?? 0) <= state.atMs && f.energy >= l.energyCost
      && (def.hpBelow === undefined || f.stats.hp / f.stats.maxHp <= def.hpBelow);
  });
  let selected: typeof ready[number] | undefined;
  const commandIndex = state.manualQueue.findIndex(c => c.actor === actor && c.atMs <= state.atMs);
  if (commandIndex >= 0) {
    const [command] = state.manualQueue.splice(commandIndex, 1);
    selected = ready.find(s => s.skillId === command.skillId);
  } else if (actor === 'enemy' || state.input.control === 'auto') {
    selected = ready.slice().sort((a, b) => {
      const sa = state.input.catalog.skills.find(s => s.id === a.skillId)!;
      const sb = state.input.catalog.skills.find(s => s.id === b.skillId)!;
      return sb.priority - sa.priority || (a.skillId < b.skillId ? -1 : a.skillId > b.skillId ? 1 : 0);
    })[0];
  }
  const def = selected && state.input.catalog.skills.find(s => s.id === selected.skillId)!;
  const level = def && selected ? def.levels[selected.level - 1] : undefined;
  if (selected && level) {
    f.energy -= level.energyCost;
    f.cooldowns[selected.skillId] = state.atMs + level.cooldownMs;
  }
  f.pending = { atMs: state.atMs + (level?.windupMs ?? state.input.rules.basicWindupMs),
    ...(selected ? { skillId: selected.skillId } : {}) };
  const slow = probability(modifier(f, 'slow'));
  f.nextAttackAtMs = state.atMs + Math.ceil(state.input.rules.attackIntervalMs / Math.max(0.001, 1 - slow));
  emit(state, events, { actor, target: opposite(actor), type: 'attack_start', skillId: selected?.skillId, vfxKey: def?.vfxKey });
}
function tick(state: IdleCombatState, events: IdleCombatEvent[]) {
  const rules = state.input.rules;
  for (const actor of actors) {
    const f = state.actors[actor];
    f.energy = Math.min(rules.maxEnergy, f.energy + rules.energyPerSecond * (1 + probability(modifier(f, 'energy_regen'))) * rules.stepMs / 1000);
    for (const status of [...f.statuses]) {
      if (state.status !== 'fighting') return;
      // Include final DOT tick at the exact expiry boundary.
      while ((status.effect.type === 'burn' || status.effect.type === 'bleed') && status.nextTickAtMs <= Math.min(state.atMs, status.expiresAtMs)) {
        const amount = status.effect.value * rules.modeDamageMultiplier[state.input.mode]
          * (1 - probability(modifier(f, 'mitigation')));
        damage(state, events, status.source, actor, amount, status.skillId, status.runeId, status.id, status.effect.vfxKey);
        status.nextTickAtMs += status.effect.tickMs!;
        if (state.status !== 'fighting') return;
      }
      if (status.expiresAtMs <= state.atMs) {
        f.statuses = f.statuses.filter(s => s.id !== status.id);
        emit(state, events, { actor, type: 'status_expire', skillId: status.skillId, runeId: status.runeId, effectId: status.id });
      }
    }
  }
  for (const actor of actors) {
    if (state.status !== 'fighting') return;
    const f = state.actors[actor];
    if (f.pending && f.pending.atMs <= state.atMs) {
      const pending = f.pending;
      f.pending = null;
      resolveAttack(state, events, actor, pending.skillId);
    }
    if (state.status !== 'fighting') return;
    startAttack(state, events, actor);
    // Zero-windup effects still resolve once, never recurse into another attack.
    if (f.pending && f.pending.atMs <= state.atMs) {
      const pending = f.pending;
      f.pending = null;
      resolveAttack(state, events, actor, pending.skillId);
    }
  }
  if (state.status === 'fighting' && state.atMs >= rules.maxDurationMs) {
    state.status = 'draw';
    state.actors.hero.pending = null;
    state.actors.enemy.pending = null;
    state.manualQueue = [];
    emit(state, events, { actor: 'hero', type: 'timeout' });
  }
}

function validateState(state: IdleCombatState) {
  if (!state || state.version !== 1) fail('unsupported state version');
  validateInput(state.input);
  const rules = state.input.rules;
  if (!integer(state.atMs, 0, rules.maxDurationMs) || state.atMs % rules.stepMs
    || !integer(state.remainderMs, 0, rules.stepMs - 1) || !integer(state.rng, 0, 0xffffffff)
    || !integer(state.nextEventId) || !['fighting', 'hero_won', 'enemy_won', 'draw'].includes(state.status)
    || !Array.isArray(state.manualQueue) || state.manualQueue.length > 128
    || !Array.isArray(state.bufferedEvents) || state.bufferedEvents.length > 256) fail('invalid state');
  if (state.manualQueue.some(c => !c || !actors.includes(c.actor) || !identifier(c.skillId)
    || !integer(c.atMs, 0, rules.maxDurationMs))) fail('invalid queued command');
  for (const actor of actors) {
    const f = state.actors?.[actor];
    const s = f?.stats;
    if (!f || !s || !finite(s.maxHp, 1) || !finite(s.hp, 0, s.maxHp)
      || (state.status === 'fighting' && s.hp <= 0)
      || !finite(s.attack) || !finite(s.defense) || !finite(s.critChance, 0, 1)
      || !finite(s.dodgeChance, 0, 1) || !finite(s.blockChance, 0, 1)
      || (s.critMultiplier !== undefined && !finite(s.critMultiplier, 1, 1000))
      || !finite(f.energy, 0, rules.maxEnergy) || !integer(f.nextAttackAtMs)
      || !f.cooldowns || !f.runeCooldowns || !Array.isArray(f.statuses) || f.statuses.length > 256
      || !integer(f.phase, -1, (f.phases?.length ?? 0) - 1)) fail('invalid actor state');
    if (validateIdleLoadout(f.loadout, state.input.catalog, f.ownership).length) fail('invalid state loadout');
    if (Object.values(f.cooldowns).some(v => !integer(v)) || Object.values(f.runeCooldowns).some(v => !integer(v))) fail('invalid cooldown state');
    if (f.pending !== null && (!f.pending || !integer(f.pending.atMs)
      || (f.pending.skillId !== undefined && !f.loadout.skills.some(s => s.skillId === f.pending!.skillId)))) fail('invalid pending attack');
    const ids = new Set<string>();
    for (const status of f.statuses) {
      if (!status || typeof status.id !== 'string' || ids.has(status.id) || !actors.includes(status.source)
        || !status.effect || !validEffect(status.effect, status.effect.durationMs === 0)
        || !integer(status.expiresAtMs) || !integer(status.nextTickAtMs)) fail('invalid status state');
      ids.add(status.id);
    }
  }
}

/** Integer elapsed milliseconds, fixed ticks and retained remainder ensure frame-rate independence.
 * A single call is bounded by the catalog's validated battle duration (at most ten minutes).
 * This pure function grants no rewards and performs no I/O. Treat returned state as untrusted
 * when crossing a client/server boundary; the server must replay authoritative input/commands.
 */
export function advanceIdleCombat(state: IdleCombatState, elapsedMs: number): { state: IdleCombatState; events: IdleCombatEvent[] } {
  if (!integer(elapsedMs, 0, Number.MAX_SAFE_INTEGER)) fail('elapsedMs must be a nonnegative safe integer');
  validateState(state);
  const next = clone(state);
  const events = next.bufferedEvents;
  next.bufferedEvents = [];
  if (next.status !== 'fighting') return { state: next, events };
  const rules = next.input.rules;
  const remaining = rules.maxDurationMs - next.atMs;
  const total = Math.min(remaining, next.remainderMs + Math.min(elapsedMs, remaining));
  const ticks = Math.floor(total / rules.stepMs);
  next.remainderMs = total % rules.stepMs;
  for (let i = 0; i < ticks && next.status === 'fighting'; i++) {
    next.atMs += rules.stepMs;
    tick(next, events);
  }
  if (next.status !== 'fighting') next.remainderMs = 0;
  return { state: next, events };
}
