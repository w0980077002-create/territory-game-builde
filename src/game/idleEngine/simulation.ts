import type {
  IdleActor, IdleCatalog, IdleCombatEvent, IdleCombatInput, IdleCombatState, IdleEffect,
  IdleFighter, IdleSkill, IdleStats, IdleStatus,
} from './types';
import { validateIdleLoadout } from './validation';

// Timing bounds, not balance coefficients. Every loop has a finite simulation horizon.
const STEP_MS = 20;
const MAX_DURATION_MS = 600_000;
const LIMIT = 1e9;
const other = (actor: IdleActor): IdleActor => actor === 'hero' ? 'enemy' : 'hero';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, fallback = 0, max = LIMIT): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback;
const chance = (v: unknown): number => finite(v, 0, 1);
const time = (v: unknown, fallback: number): number => Math.max(STEP_MS, Math.ceil(finite(v, fallback) / STEP_MS) * STEP_MS);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const terminal = (s: IdleCombatState): boolean => ['victory', 'defeat', 'timeout', 'invalid'].includes(s.phase);

function stats(raw: IdleStats): Required<IdleStats> {
  return {
    maxHp: Math.max(1, finite(raw.maxHp, 1)), attack: finite(raw.attack), defense: finite(raw.defense),
    attackIntervalMs: time(raw.attackIntervalMs, 1000), windupMs: time(raw.windupMs, 200),
    critChance: chance(raw.critChance), criticalMultiplier: Math.max(1, finite(raw.criticalMultiplier, 1)),
    blockChance: chance(raw.blockChance), blockReduction: chance(raw.blockReduction),
    dodgeChance: chance(raw.dodgeChance), precision: chance(raw.precision),
    maxEnergy: finite(raw.maxEnergy), energy: Math.min(finite(raw.maxEnergy), finite(raw.energy, finite(raw.maxEnergy))),
    energyRegenPerSecond: finite(raw.energyRegenPerSecond),
  };
}
function fighter(raw: IdleStats): IdleFighter {
  const normalized = stats(raw);
  return { stats: normalized, hp: normalized.maxHp, energy: normalized.energy, readyAtMs: 0, cooldowns: {}, runeCooldowns: {} };
}
// Copy only contract fields: extra properties in caller data cannot introduce cycles or functions into snapshots.
function catalogSnapshot(catalog: IdleCatalog): IdleCatalog {
  const effect = (e: IdleEffect): IdleEffect => {
    const result = { type: e.type, strength: e.strength, target: e.target, vfxKey: e.vfxKey };
    if (e.type === 'magic' || e.type === 'energy') return result as IdleEffect;
    return { ...result, durationMs: e.durationMs, ...(e.type === 'burn' ? { tickMs: e.tickMs } : {}) } as IdleEffect;
  };
  return copy({
    skills: catalog.skills.map(s => ({ id: s.id, category: s.category, cooldownMs: s.cooldownMs,
      energyCost: s.energyCost, priority: s.priority, condition: s.condition && { ...s.condition },
      multiplier: s.multiplier, windupMs: s.windupMs, hitCount: s.hitCount,
      hitGapMs: s.hitGapMs, effects: s.effects?.map(effect), vfxKey: s.vfxKey })),
    runes: catalog.runes.map(r => ({ id: r.id, skillIds: r.skillIds && [...r.skillIds], categories: r.categories && [...r.categories],
      chance: r.chance, cooldownMs: r.cooldownMs, effects: r.effects.map(effect), vfxKey: r.vfxKey })),
    passives: catalog.passives.map(p => ({ id: p.id, modifiers: { ...p.modifiers } })),
  });
}
function emit(s: IdleCombatState, events: IdleCombatEvent[], actor: IdleActor,
  type: IdleCombatEvent['type'], detail: Partial<IdleCombatEvent> = {}): IdleCombatEvent {
  const event: IdleCombatEvent = { ...detail, id: `idle:${++s.sequence}`, atMs: s.timeMs, stage: s.stage, actor, type };
  events.push(event);
  return event;
}
function spawn(s: IdleCombatState, events: IdleCombatEvent[], hero: boolean): void {
  if (hero) emit(s, events, 'hero', 'spawn');
  emit(s, events, 'enemy', 'spawn');
  emit(s, events, 'hero', 'approach', { target: 'enemy', value: s.approachMs });
}

export function createIdleCombat(input: IdleCombatInput): IdleCombatState {
  const raw = (object(input) ? input : {}) as unknown as IdleCombatInput;
  const errors = validateIdleLoadout(raw.loadout, raw.catalog);
  if (!object(raw.hero) || !object(raw.enemy)) errors.push('input: hero and enemy stats required');
  if (raw.nextEnemies !== undefined && (!Array.isArray(raw.nextEnemies) || raw.nextEnemies.length > 100 || raw.nextEnemies.some(e => !object(e)))) {
    errors.push('input: invalid nextEnemies');
  }
  const catalog = errors.length ? { skills: [], runes: [], passives: [] } : catalogSnapshot(raw.catalog);
  const loadout = errors.length ? { active: [], passiveIds: [] } : {
    active: raw.loadout.active.map(a => ({ skillId: a.skillId, runeIds: [...(a.runeIds ?? [])] })), passiveIds: [...raw.loadout.passiveIds],
  };
  const heroStats = stats(object(raw.hero) ? raw.hero as unknown as IdleStats : { maxHp: 1, attack: 0 });
  for (const id of loadout.passiveIds) {
    const passive = catalog.passives.find(p => p.id === id)!;
    for (const [key, value] of Object.entries(passive.modifiers)) {
      const k = key as keyof IdleStats;
      heroStats[k] = finite(heroStats[k] + value);
    }
  }
  const s: IdleCombatState = {
    version: 1, phase: errors.length ? 'invalid' : 'approach', timeMs: 0, remainderMs: 0,
    maxDurationMs: Math.min(MAX_DURATION_MS, time(raw.maxDurationMs, 120_000)),
    stage: Math.max(1, Math.floor(finite(raw.stage, 1))), rng: (finite(raw.seed, 1, 0xffffffff) >>> 0) || 0x9e3779b9,
    sequence: 0, hero: fighter(heroStats), enemy: fighter(object(raw.enemy) ? raw.enemy as unknown as IdleStats : { maxHp: 1, attack: 0 }),
    catalog, loadout, statuses: [], nextEnemies: errors.length ? [] : (raw.nextEnemies ?? []).map(e => stats(e)),
    approachMs: time(raw.approachMs, 300), stageTransitionMs: time(raw.stageTransitionMs, 500),
    phaseEndsAtMs: time(raw.approachMs, 300), pendingEvents: [], validationErrors: errors,
  };
  if (!errors.length) spawn(s, s.pendingEvents, true);
  return copy(s);
}
function roll(s: IdleCombatState, probability: number): boolean {
  if (probability <= 0) return false;
  if (probability >= 1) return true;
  let value = s.rng;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  s.rng = value >>> 0;
  return s.rng / 0x100000000 < probability;
}
function bonus(s: IdleCombatState, actor: IdleActor, type: IdleStatus['type']): number {
  return chance(s.statuses.filter(status => status.target === actor && status.type === type && status.expiresAtMs > s.timeMs)
    .reduce((sum, status) => sum + status.strength, 0));
}
function expire(s: IdleCombatState, events: IdleCombatEvent[], status: IdleStatus): void {
  emit(s, events, status.actor, 'status_expire', { target: status.target, skillId: status.skillId,
    runeId: status.runeId, source: status.type, statusId: status.id, vfxKey: status.vfxKey });
}
function finish(s: IdleCombatState, events: IdleCombatEvent[], victim: IdleActor): void {
  emit(s, events, victim, 'death', { target: victim });
  delete s.hero.pendingAttack; delete s.enemy.pendingAttack;
  for (const status of s.statuses) expire(s, events, status);
  s.statuses = [];
  if (victim === 'hero') { s.phase = 'defeat'; return; }
  emit(s, events, 'hero', 'stage_clear', { target: 'enemy' });
  emit(s, events, 'hero', 'loot_visual', { target: 'enemy' });
  s.phase = s.nextEnemies.length ? 'transition' : 'victory';
  s.phaseEndsAtMs = s.timeMs + s.stageTransitionMs;
}
/** This is the only HP writer after creation/spawn. Annotations never contain a second damage record. */
function damage(s: IdleCombatState, events: IdleCombatEvent[], actor: IdleActor, target: IdleActor,
  amount: number, detail: Partial<IdleCombatEvent>): void {
  const victim = s[target];
  if (victim.hp <= 0) return;
  const value = Math.min(victim.hp, finite(amount));
  victim.hp -= value;
  emit(s, events, actor, 'impact', { ...detail, target, value, hpAfter: victim.hp });
  if (victim.hp === 0) finish(s, events, target);
}
function applyEffects(s: IdleCombatState, events: IdleCombatEvent[], actor: IdleActor,
  effects: IdleEffect[], skillId: string, runeId?: string, contactId?: string, onApply?: () => void): boolean {
  let applied = false;
  const announce = (): void => { if (!applied) onApply?.(); applied = true; };
  for (const e of effects) {
    if (s.phase !== 'combat') break;
    const selfByDefault = ['energy', 'mitigation', 'crit', 'precision'].includes(e.type);
    const target = e.target === 'self' || (e.target === undefined && selfByDefault) ? actor : other(actor);
    if (s[target].hp <= 0 || e.strength <= 0) continue;
    const detail = { skillId, runeId, contactId, source: e.type, vfxKey: e.vfxKey };
    if (e.type === 'magic') {
      const value = finite(e.strength * (1 - bonus(s, target, 'mitigation')));
      if (value <= 0) continue;
      announce();
      damage(s, events, actor, target, value, detail);
    } else if (e.type === 'energy') {
      const before = s[target].energy;
      const after = Math.min(s[target].stats.maxEnergy, before + e.strength);
      if (after === before) continue;
      announce();
      s[target].energy = after;
      emit(s, events, actor, 'status_apply', { ...detail, target, value: s[target].energy - before });
    } else {
      announce();
      // Refresh identical sources without stacking or postponing an already scheduled burn tick.
      const previous = s.statuses.find(status => status.target === target && status.actor === actor
        && status.skillId === skillId && status.runeId === runeId && status.type === e.type);
      if (previous) {
        expire(s, events, previous);
        s.statuses = s.statuses.filter(status => status !== previous);
      }
      const event = emit(s, events, actor, 'status_apply', { ...detail, target, value: e.strength });
      event.statusId = event.id;
      s.statuses.push({ id: event.id, actor, target, skillId, runeId, type: e.type, strength: e.strength,
        expiresAtMs: s.timeMs + time(e.durationMs, STEP_MS), vfxKey: e.vfxKey,
        ...(e.type === 'burn' ? { tickMs: time(e.tickMs, STEP_MS), nextTickMs: previous?.nextTickMs ?? s.timeMs + time(e.tickMs, STEP_MS) } : {}) });
    }
  }
  return applied;
}
function skillFor(s: IdleCombatState, actor: IdleActor): IdleSkill | undefined {
  if (actor === 'enemy') return undefined;
  const f = s[actor];
  return s.loadout.active.map(slot => s.catalog.skills.find(skill => skill.id === slot.skillId)!)
    .filter(skill => (f.cooldowns[`skill:${skill.id}`] ?? 0) <= s.timeMs && f.energy >= skill.energyCost
      && (skill.condition?.selfHpBelow === undefined || f.hp / f.stats.maxHp <= skill.condition.selfHpBelow)
      && (skill.condition?.enemyHpBelow === undefined || s.enemy.hp / s.enemy.stats.maxHp <= skill.condition.enemyHpBelow)
      && (skill.condition?.energyAtLeast === undefined || f.energy >= skill.condition.energyAtLeast))
    // Stable lexical tie-break, independent of selection order and host locale.
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}
function beginAttack(s: IdleCombatState, events: IdleCombatEvent[], actor: IdleActor): void {
  const f = s[actor];
  if (f.pendingAttack || f.readyAtMs > s.timeMs) return;
  const slow = bonus(s, actor, 'slow');
  if (slow >= 1) return;
  const skill = skillFor(s, actor);
  if (skill) {
    f.energy -= skill.energyCost;
    f.cooldowns[`skill:${skill.id}`] = s.timeMs + time(skill.cooldownMs, STEP_MS);
  }
  const windup = time(skill?.windupMs ?? f.stats.windupMs, STEP_MS);
  const hitCount = skill?.hitCount ?? 1;
  const hitGapMs = time(skill?.hitGapMs, 160);
  const interval = time(f.stats.attackIntervalMs / (1 - slow), STEP_MS);
  const event = emit(s, events, actor, 'attack_start', { target: other(actor), skillId: skill?.id,
    value: windup, vfxKey: skill?.vfxKey, hitCount });
  event.contactId = event.id;
  f.pendingAttack = { atMs: s.timeMs + windup, skillId: skill?.id, contactId: event.id,
    hitIndex: 1, hitCount, hitGapMs };
  f.readyAtMs = s.timeMs + Math.max(interval, windup + (hitCount - 1) * hitGapMs + STEP_MS);
}
function contact(s: IdleCombatState, events: IdleCombatEvent[], actor: IdleActor): void {
  const attacker = s[actor];
  const pending = attacker.pendingAttack;
  if (!pending || pending.atMs > s.timeMs) return;
  const hitIndex = pending.hitIndex ?? 1;
  const hitCount = pending.hitCount ?? 1;
  const contactId = hitIndex === 1 ? pending.contactId : `${pending.contactId}:hit${hitIndex}`;
  if (hitIndex < hitCount) {
    attacker.pendingAttack = { ...pending, atMs: s.timeMs + (pending.hitGapMs ?? 160), hitIndex: hitIndex + 1 };
  } else delete attacker.pendingAttack;
  const target = other(actor);
  const defender = s[target];
  const skill = pending.skillId ? s.catalog.skills.find(sk => sk.id === pending.skillId) : undefined;
  const detail = { skillId: skill?.id, contactId, hitIndex, hitCount,
    vfxKey: skill?.vfxKey, source: 'attack' as const };
  const precision = chance(attacker.stats.precision + bonus(s, actor, 'precision'));
  const multiplier = skill ? skill.multiplier ?? 0 : 1;
  if (multiplier > 0 && roll(s, defender.stats.dodgeChance * (1 - precision))) {
    emit(s, events, target, 'dodge', { target: actor, skillId: skill?.id, contactId, hitIndex, hitCount });
    damage(s, events, actor, target, 0, detail);
    return;
  }
  // Effects-only skills still make one zero-value contact, with no fictitious critical/block.
  let amount = finite(attacker.stats.attack * multiplier / hitCount);
  if (amount > 0 && roll(s, chance(attacker.stats.critChance + bonus(s, actor, 'crit')))) {
    amount = finite(amount * attacker.stats.criticalMultiplier);
    emit(s, events, actor, 'critical', { target, skillId: skill?.id, contactId, hitIndex, hitCount });
  }
  amount = Math.max(0, amount - defender.stats.defense);
  if (multiplier > 0 && roll(s, defender.stats.blockChance * (1 - precision))) {
    amount *= 1 - defender.stats.blockReduction;
    emit(s, events, target, 'block', { target: actor, skillId: skill?.id, contactId, hitIndex, hitCount });
  }
  amount *= 1 - bonus(s, target, 'mitigation');
  damage(s, events, actor, target, amount, detail);
  if (s.phase !== 'combat' || !skill) return;
  if (hitIndex === hitCount) applyEffects(s, events, actor, skill.effects ?? [], skill.id, undefined, contactId);
  if (s.phase !== 'combat') return;
  const slot = s.loadout.active.find(a => a.skillId === skill.id)!;
  // Only primary skill contacts can proc attached runes. Rune damage and status ticks never recurse.
  for (const runeId of slot.runeIds ?? []) {
    if (s.phase !== 'combat') break;
    const rune = s.catalog.runes.find(r => r.id === runeId)!;
    const key = JSON.stringify([skill.id, rune.id]);
    if ((attacker.runeCooldowns[key] ?? 0) > s.timeMs || !roll(s, rune.chance)) continue;
    applyEffects(s, events, actor, rune.effects, skill.id, rune.id, contactId, () => {
      attacker.runeCooldowns[key] = s.timeMs + time(rune.cooldownMs, STEP_MS);
      emit(s, events, actor, 'rune_proc', { target, skillId: skill.id, runeId: rune.id,
        contactId, hitIndex, hitCount, vfxKey: rune.vfxKey });
    });
  }
}
function statuses(s: IdleCombatState, events: IdleCombatEvent[]): void {
  // Oldest first. Lethal ticks cancel all remaining contacts and ticks at the same timestamp.
  for (const status of [...s.statuses]) {
    if (s.phase !== 'combat') break;
    if (status.type === 'burn' && status.nextTickMs! <= s.timeMs && status.nextTickMs! <= status.expiresAtMs) {
      status.nextTickMs! += status.tickMs!;
      damage(s, events, status.actor, status.target, status.strength * (1 - bonus(s, status.target, 'mitigation')),
        { skillId: status.skillId, runeId: status.runeId, source: 'burn', statusId: status.id, vfxKey: status.vfxKey });
    }
    if (s.phase !== 'combat') break;
    if (status.expiresAtMs <= s.timeMs) {
      expire(s, events, status);
      s.statuses = s.statuses.filter(item => item.id !== status.id);
    }
  }
}
function step(s: IdleCombatState, events: IdleCombatEvent[]): void {
  s.timeMs += STEP_MS;
  if (s.phase === 'transition' && s.timeMs >= s.phaseEndsAtMs) {
    s.stage = Math.min(LIMIT, s.stage + 1);
    s.enemy = fighter(s.nextEnemies.shift()!);
    s.phase = 'approach';
    s.phaseEndsAtMs = s.timeMs + s.approachMs;
    spawn(s, events, false);
  }
  if (s.phase === 'approach' && s.timeMs >= s.phaseEndsAtMs) {
    s.phase = 'combat';
    s.hero.readyAtMs = s.timeMs; s.enemy.readyAtMs = s.timeMs;
  }
  for (const actor of ['hero', 'enemy'] as const) {
    const f = s[actor];
    f.energy = Math.min(f.stats.maxEnergy, f.energy + f.stats.energyRegenPerSecond * STEP_MS / 1000);
  }
  if (s.phase === 'combat') {
    statuses(s, events);
    for (const actor of ['hero', 'enemy'] as const) {
      if (s.phase !== 'combat') break;
      contact(s, events, actor);
    }
    for (const actor of ['hero', 'enemy'] as const) {
      if (s.phase !== 'combat') break;
      beginAttack(s, events, actor);
    }
  }
  if (!terminal(s) && s.timeMs >= s.maxDurationMs) {
    s.phase = 'timeout';
    delete s.hero.pendingAttack; delete s.enemy.pendingAttack;
  }
}

export function advanceIdleCombat(state: IdleCombatState, elapsedMs: number): { state: IdleCombatState; events: IdleCombatEvent[] } {
  if (terminal(state) || typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return { state, events: [] };
  const s = copy(state);
  const events = s.pendingEvents;
  s.pendingEvents = [];
  const available = Math.max(0, s.maxDurationMs - s.timeMs - s.remainderMs);
  // Never drop a large delta: process it through the bounded lifetime, then finish with timeout.
  // Rounding removes insignificant floating-point accumulation noise at fixed-step boundaries.
  let budget = Math.min(s.maxDurationMs - s.timeMs, s.remainderMs + Math.min(elapsedMs, available));
  while (budget + 1e-8 >= STEP_MS && !terminal(s)) {
    budget -= STEP_MS;
    step(s, events);
  }
  s.remainderMs = terminal(s) ? 0 : Math.round(Math.max(0, budget) * 1e8) / 1e8;
  return { state: copy(s), events: copy(events) };
}
