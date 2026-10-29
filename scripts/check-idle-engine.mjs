import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/game/idleEngine/index.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const engine = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const { createIdleCombat, advanceIdleCombat, queueIdleSkill, validateIdleLoadout, validateIdleCatalog } = engine;
const copy = value => JSON.parse(JSON.stringify(value));
const empty = () => ({ skills: [], passives: [] });
// Synthetic fixtures: these deliberately do not define production balance or prices.
const categories = ['base', 'core', 'control', 'awakening', 'final'];
const skills = categories.flatMap((category, c) => Array.from({ length: 3 }, (_, i) => ({
  id: `skill_${c}_${i}`, category, unlockLevel: 1, priority: c,
  levels: [{ multiplier: 1, energyCost: 5, cooldownMs: 300, windupMs: 20, effects: [] },
    { multiplier: 2, energyCost: 5, cooldownMs: 300, windupMs: 20, effects: [] }],
})));
const fire = { type: 'burn', target: 'opponent', value: 7, durationMs: 200, tickMs: 50, vfxKey: 'fire' };
const slow = { type: 'slow', target: 'opponent', value: .5, durationMs: 100 };
const catalog = { skills, runes: [
  { id: 'fire', unlockLevel: 1, compatibleSkillIds: skills.map(s => s.id), levels: [{ chance: 1, cooldownMs: 500, effects: [fire] }] },
  { id: 'ice', unlockLevel: 1, compatibleSkillIds: ['skill_0_0'], levels: [{ chance: 1, cooldownMs: 100, effects: [slow] }] },
  { id: 'magic', unlockLevel: 1, compatibleSkillIds: ['skill_0_0'], levels: [{ chance: 1, cooldownMs: 100, effects: [
    { type: 'magic', target: 'opponent', value: 30, durationMs: 0 },
    { type: 'energy', target: 'self', value: 8, durationMs: 0 },
  ] }] },
], passives: ['crit', 'mitigation', 'precision'].map(type => ({ id: `passive_${type}`, unlockLevel: 1,
  levels: [{ effects: [{ type, target: 'self', value: .1, durationMs: 0 }] }] })) };
const stats = { hp: 10000, maxHp: 10000, attack: 20, defense: 0, critChance: .3, dodgeChance: .1, blockChance: .2 };
const rules = { stepMs: 10, maxDurationMs: 10000, approachMs: 0, attackIntervalMs: 100,
  basicWindupMs: 20, basicMultiplier: 1, defenseFactor: 1, magicDefenseFactor: .5,
  minimumDamage: 0, critMultiplier: 2, blockMultiplier: .5,
  maxEnergy: 100, initialEnergy: 100, energyPerSecond: 10,
  modeDamageMultiplier: { pve: 1, boss: 1, pvp: .8 } };
const loadout = { skills: [{ skillId: 'skill_0_0', level: 1, runes: [{ runeId: 'fire', level: 1 }, { runeId: 'ice', level: 1 }] }], passives: [] };
function input(overrides = {}) {
  return { seed: 42, stage: 1, mode: 'pve', control: 'auto', hero: { stats: copy(stats), loadout: copy(loadout) },
    enemy: { stats: copy(stats), loadout: empty() }, catalog: copy(catalog), rules: copy(rules), ...overrides };
}
function run(i, deltas) {
  let state = createIdleCombat(i);
  const events = [];
  for (const delta of deltas) { const result = advanceIdleCombat(state, delta); state = result.state; events.push(...result.events); }
  return { state, events };
}
assert.deepEqual(validateIdleCatalog(catalog), []);
assert.deepEqual(validateIdleLoadout(loadout, catalog), []);
const allSlots = { skills: categories.map((_, c) => ({ skillId: `skill_${c}_0`, level: 1,
  runes: c === 0 ? [{ runeId: 'fire', level: 1 }, { runeId: 'ice', level: 1 }] : [] })),
  passives: catalog.passives.map(p => ({ passiveId: p.id, level: 1 })) };
assert.deepEqual(validateIdleLoadout(allSlots, catalog), []);
const full = run(input(), [1000]);
assert.deepEqual(run(input(), [1000]), full, 'seed replay must be identical');
assert.deepEqual(run(input(), Array(10).fill(100)), full, 'render frame chunks must not affect events/state');
assert.deepEqual(run(input(), [1, 99, 311, 89, 500]), full, 'non-tick frame chunks preserve remainder');
for (const deltas of [[7, 8], [10, 5], [33, 36, 88], [100, 7]]) {
  const stepped = run(input(), deltas);
  assert.deepEqual(stepped, run(input(), [deltas.reduce((a,b) => a + b, 0)]));
  assert.deepEqual(JSON.parse(JSON.stringify(stepped)), stepped, 'events, pending basic attacks and statuses serialize exactly');
}
assert.notDeepEqual(run(input({ seed: 43 }), [1000]).events, full.events, 'seed changes chance outcomes');
assert.deepEqual(JSON.parse(JSON.stringify(full.state)), full.state, 'state must persist as JSON');
assert.equal(new Set(full.events.map(e => e.id)).size, full.events.length);
assert.ok(full.events.every(e => Number.isInteger(e.atMs) && e.id && e.actor));
assert.ok(full.events.some(e => e.type === 'rune_proc' && e.runeId === 'fire'));
assert.ok(full.events.some(e => e.type === 'status_expire' && e.effectId.includes('burn')));
const fireProcs = full.events.filter(e => e.type === 'rune_proc' && e.runeId === 'fire');
for (let i = 1; i < fireProcs.length; i++) assert.ok(fireProcs[i].atMs - fireProcs[i - 1].atMs >= 500);
const skillCasts = full.events.filter(e => e.type === 'attack_start' && e.skillId === 'skill_0_0');
for (let i = 1; i < skillCasts.length; i++) assert.ok(skillCasts[i].atMs - skillCasts[i - 1].atMs >= 300);
for (const actor of ['hero', 'enemy']) {
  const damage = full.events.filter(e => e.type === 'impact' && e.target === actor).reduce((sum,e) => sum + e.value,0);
  assert.equal(damage, stats.hp - full.state.actors[actor].stats.hp, 'one impact per HP delta, including DOT');
}
assert.ok(full.events.filter(e => e.type === 'critical' || e.type === 'block').every(e => e.value === undefined));
assert.ok(full.events.filter(e => e.type === 'impact' && e.effectId?.includes('burn')).length >= 4);

for (const bad of [
  null, { skills: null, passives: [] }, { ...loadout, skills: [...loadout.skills, ...loadout.skills] },
  { ...loadout, skills: [...allSlots.skills, { skillId: 'skill_0_1', level: 1, runes: [] }] },
  { ...loadout, passives: [...allSlots.passives, allSlots.passives[0]] },
  { skills: [{ skillId: 'skill_0_0', level: 3, runes: [] }], passives: [] },
  { skills: [{ skillId: 'skill_1_0', level: 1, runes: [{ runeId: 'ice', level: 1 }] }], passives: [] },
  { skills: [{ skillId: 'skill_0_0', level: 1, runes: [...loadout.skills[0].runes, { runeId: 'magic', level: 1 }] }], passives: [] },
  { skills: [{ skillId: 'missing', level: 1, runes: [] }], passives: [] },
  { skills: [{ skillId: 'skill_0_0', level: 1, runes: [{ runeId: 'fire', level: 1 }, { runeId: 'fire', level: 1 }] }], passives: [] },
]) assert.ok(validateIdleLoadout(bad, catalog).length, `invalid loadout ${JSON.stringify(bad)}`);
const ownership = { heroLevel: 1, skills: { skill_0_0: 1 }, runes: { fire: 1, ice: 1 }, passives: {} };
assert.deepEqual(validateIdleLoadout(loadout, catalog, ownership), []);
assert.ok(validateIdleLoadout(loadout, catalog, { ...ownership, runes: {} }).includes('not_owned:fire'));
assert.ok(validateIdleLoadout({ ...loadout, skills: [{ ...loadout.skills[0], level: 2 }] }, catalog, ownership).includes('not_owned:skill_0_0'));
const locked = copy(catalog); locked.skills[0].unlockLevel = 2;
assert.ok(validateIdleLoadout(loadout, locked, ownership).includes('not_owned:skill_0_0'));
for (const mutate of [i => i.hero.stats.attack = Infinity, i => i.hero.stats.hp = -1,
  i => i.rules.stepMs = 0, i => i.catalog.skills[0].levels[0].cooldownMs = -1,
  i => i.catalog.runes[0].levels[0].effects[0].tickMs = 0, i => i.seed = NaN,
  i => i.hero.loadout.skills[0].level = 99]) {
  const bad = input(); mutate(bad); assert.throws(() => createIdleCombat(bad), /IdleCombat:/);
}
assert.throws(() => advanceIdleCombat(createIdleCombat(input()), Infinity));
assert.throws(() => advanceIdleCombat(createIdleCombat(input()), -1));
assert.throws(() => advanceIdleCombat(createIdleCombat(input()), .5));
for (const mutate of [s => s.input.rules.stepMs = 0, s => s.remainderMs = -1,
  s => s.actors.hero.statuses.push({ id: 'bad', source: 'hero', effect: { ...fire, tickMs: 0 }, expiresAtMs: 100, nextTickAtMs: 0 })]) {
  const bad = createIdleCombat(input()); mutate(bad);
  assert.throws(() => advanceIdleCombat(bad, 100), /IdleCombat:/, 'corrupt persisted state must fail rather than loop');
}
assert.equal(run(input({ hero: { stats, loadout: empty() } }), [Number.MAX_SAFE_INTEGER]).state.atMs, rules.maxDurationMs);

// Certain crit + certain block produce one exact damage entry; certain dodge produces none.
const exact = input();
exact.hero = { stats: { ...stats, attack: 100, critChance: 1, dodgeChance: 0, blockChance: 0 }, loadout: empty() };
exact.enemy = { stats: { ...stats, attack: 0, critChance: 0, dodgeChance: 0, blockChance: 1 }, loadout: empty() };
const exactRun = run(exact, [30]);
assert.equal(exactRun.events.filter(e => e.type === 'impact' && e.actor === 'hero').length, 1);
assert.equal(exactRun.state.actors.enemy.stats.hp, stats.hp - 100);
const asymmetric = copy(exact);
asymmetric.hero.stats.critMultiplier = 3;
asymmetric.enemy.stats = { ...asymmetric.enemy.stats, attack: 100, critChance: 1, critMultiplier: 1.5, blockChance: 0 };
const asymmetricRun = run(asymmetric, [30]);
assert.equal(asymmetricRun.events.find(e => e.type === 'impact' && e.actor === 'hero').value, 300);
assert.equal(asymmetricRun.events.find(e => e.type === 'impact' && e.actor === 'enemy').value, 150);
const dodged = copy(exact); dodged.enemy.stats.dodgeChance = 1;
const dodgedRun = run(dodged, [30]);
assert.equal(dodgedRun.state.actors.enemy.stats.hp, stats.hp);
assert.equal(dodgedRun.events.filter(e => e.type === 'impact' && e.actor === 'hero').length, 0);

// Passive mitigation, crit and precision are applied before combat and remain serializable.
const passiveInput = copy(exact); passiveInput.hero.loadout = { skills: [], passives: allSlots.passives };
const passiveState = createIdleCombat(passiveInput);
assert.equal(passiveState.actors.hero.statuses.length, 3);
assert.ok(passiveState.actors.hero.statuses.every(s => Number.isFinite(s.expiresAtMs)));

// Manual mode uses basic attacks until a scheduled command is eligible.
const manualInput = input({ control: 'manual' });
const manualBasic = run(manualInput, [1000]);
assert.ok(manualBasic.events.filter(e => e.type === 'attack_start' && e.actor === 'hero').every(e => e.skillId === undefined));
let manual = queueIdleSkill(createIdleCombat(manualInput), 'skill_0_0', 110);
const manualRun = advanceIdleCombat(manual, 500);
assert.equal(manualRun.events.find(e => e.type === 'attack_start' && e.skillId === 'skill_0_0').atMs, 110);
assert.equal(manualRun.events.filter(e => e.type === 'attack_start' && e.skillId === 'skill_0_0').length, 1);
manual = queueIdleSkill(createIdleCombat(manualInput), 'skill_0_0', 110);
const m1 = advanceIdleCombat(manual, 105), m2 = advanceIdleCombat(m1.state, 395);
assert.deepEqual([...m1.events, ...m2.events], manualRun.events);
assert.deepEqual(m2.state, manualRun.state);
const noEnergy = copy(manualInput); noEnergy.rules.initialEnergy = 0; noEnergy.rules.energyPerSecond = 0;
const noEnergyRun = advanceIdleCombat(queueIdleSkill(createIdleCombat(noEnergy), 'skill_0_0'), 100);
assert.ok(noEnergyRun.events.every(e => !e.skillId));
assert.throws(() => queueIdleSkill(createIdleCombat(manualInput), 'missing'));

// Magic/energy effects run through the same impact accounting, never recursive rune triggers.
const magical = copy(exact);
magical.hero.loadout = { skills: [{ skillId: 'skill_0_0', level: 1, runes: [{ runeId: 'magic', level: 1 }] }], passives: [] };
magical.rules.initialEnergy = 10;
const magicRun = run(magical, [30]);
assert.equal(magicRun.events.filter(e => e.type === 'rune_proc').length, 1);
assert.equal(magicRun.events.filter(e => e.type === 'impact' && e.actor === 'hero').length, 2);
assert.equal(magicRun.events.find(e => e.type === 'impact' && e.runeId === 'magic').value, 30);
assert.ok(magicRun.state.actors.hero.energy > 10);

// Frequent refreshes extend burn duration without postponing its scheduled tick forever.
const refreshing = input();
refreshing.rules.attackIntervalMs = 10;
refreshing.catalog.skills[0].levels[0] = { multiplier: 0, energyCost: 0, cooldownMs: 0, windupMs: 0, effects: [] };
refreshing.catalog.runes[0].levels[0].cooldownMs = 0;
refreshing.catalog.runes[0].levels[0].effects[0].tickMs = 100;
refreshing.hero.loadout.skills[0].runes = [{ runeId: 'fire', level: 1 }];
refreshing.hero.stats = { ...stats, attack: 0, critChance: 0, blockChance: 0, dodgeChance: 0 };
refreshing.enemy.stats = { ...stats, attack: 0, critChance: 0, blockChance: 0, dodgeChance: 0 };
const refreshed = run(refreshing, [500]);
assert.equal(refreshed.events.filter(e => e.type === 'impact' && e.effectId?.includes('burn')).length, 4);

// Healing caps at the original max HP and cannot resurrect a fighter after lethal damage.
const healing = copy(exact);
healing.hero.stats.hp = 50;
healing.hero.loadout = { skills: [{ skillId: 'skill_0_0', level: 1, runes: [] }], passives: [] };
healing.catalog.skills[0].levels[0].effects = [{ type: 'heal', target: 'self', value: 99999, durationMs: 0 }];
const healed = run(healing, [30]);
assert.equal(healed.state.actors.hero.stats.hp, stats.maxHp);
assert.equal(healed.events.find(e => e.type === 'heal').value, stats.maxHp - 50);
healing.catalog.skills[0].levels[0].effects.unshift({ type: 'magic', target: 'self', value: 99999, durationMs: 0 });
const noResurrection = run(healing, [30]);
assert.equal(noResurrection.state.status, 'enemy_won');
assert.equal(noResurrection.state.actors.hero.stats.hp, 0);
assert.ok(!noResurrection.events.some(e => e.type === 'heal'));

// Explicit attack/defense ratios affect actual hits and expire on the fixed clock.
const buffs = input();
buffs.hero.stats = { ...stats, attack: 20, defense: 10, critChance: 0, dodgeChance: 0, blockChance: 0 };
buffs.enemy.stats = { ...stats, attack: 20, defense: 0, critChance: 0, dodgeChance: 0, blockChance: 0 };
buffs.hero.loadout = { skills: [{ skillId: 'skill_0_0', level: 1, runes: [] }], passives: [] };
buffs.catalog.skills[0].levels[0].cooldownMs = 1000;
buffs.catalog.skills[0].levels[0].effects = [
  { type: 'attack', target: 'self', value: 1, durationMs: 150 },
  { type: 'defense', target: 'self', value: 1, durationMs: 150 },
];
const buffed = run(buffs, [250]);
const heroImpacts = buffed.events.filter(e => e.type === 'impact' && e.actor === 'hero');
const enemyImpacts = buffed.events.filter(e => e.type === 'impact' && e.actor === 'enemy');
assert.deepEqual(heroImpacts.map(e => e.value), [20, 40, 20]);
assert.deepEqual(enemyImpacts.map(e => e.value), [0, 0, 10]);
assert.ok(!buffed.state.actors.hero.statuses.some(s => ['attack','defense'].includes(s.effect.type)));

// Interrupt cancels one pending contact. The supplied duration protects subsequent casts.
const interrupting = input();
interrupting.rules.attackIntervalMs = 20;
interrupting.rules.basicWindupMs = 80;
interrupting.hero.stats = { ...stats, critChance: 0, dodgeChance: 0, blockChance: 0 };
interrupting.enemy.stats = { ...stats, critChance: 0, dodgeChance: 0, blockChance: 0 };
interrupting.hero.loadout = { skills: [{ skillId: 'skill_0_0', level: 1, runes: [] }], passives: [] };
interrupting.catalog.skills[0].levels[0] = { multiplier: 1, energyCost: 0, cooldownMs: 0, windupMs: 0,
  effects: [{ type: 'interrupt', target: 'opponent', value: 0, durationMs: 200 }] };
const interrupted = run(interrupting, [250]);
assert.deepEqual(interrupted.events.filter(e => e.type === 'status_apply' && e.effectId?.includes('interrupt')).map(e => e.atMs), [30,230]);
assert.deepEqual(interrupted.events.filter(e => e.type === 'impact' && e.actor === 'enemy').map(e => e.atMs), [110,190]);
interrupting.enemy.resistances = { interrupt: 1 };
assert.ok(!run(interrupting, [250]).events.some(e => e.type === 'status_apply' && e.effectId?.includes('interrupt')));

// Boss phase transitions and full status resistance are authoritative supplied data.
const boss = copy(exact); boss.mode = 'boss'; boss.hero.loadout = copy(loadout);
boss.enemy.resistances = { slow: 1 };
boss.enemy.phases = [{ id: 'enrage', hpBelow: .999, attackMultiplier: 2, defenseMultiplier: 2, resistances: { slow: 1 } }];
const bossRun = run(boss, [30]);
assert.ok(bossRun.events.some(e => e.type === 'phase_change' && e.phaseId === 'enrage'));
assert.ok(!bossRun.state.actors.enemy.statuses.some(s => s.effect.type === 'slow'));
const pve = run(exact, [30]); const pvp = run({ ...exact, mode: 'pvp' }, [30]);
assert.ok(pvp.state.actors.enemy.stats.hp > pve.state.actors.enemy.stats.hp, 'independent PvP supplied multiplier applies');

// Death cancels pending attacks and future input; renderer cues never grant currency.
const lethal = copy(exact); lethal.enemy.stats.hp = 1; lethal.rules.basicWindupMs = 0;
const killed = run(lethal, [5000]);
assert.equal(killed.state.status, 'hero_won');
assert.equal(killed.state.actors.hero.stats.hp, stats.hp);
const deathIndex = killed.events.findIndex(e => e.type === 'death');
assert.ok(killed.events.slice(deathIndex + 1).every(e => e.type === 'stage_clear' || e.type === 'loot_visual'));
assert.deepEqual(advanceIdleCombat(killed.state, 100000), { state: killed.state, events: [] });
assert.ok(killed.events.find(e => e.type === 'loot_visual').value === undefined);
const lose = copy(exact); lose.hero.stats.hp = 1; lose.hero.stats.attack = 0; lose.enemy.stats.attack = 100;
assert.equal(run(lose, [1000]).state.status, 'enemy_won');

console.log('Idle combat: deterministic replay/frames, 5/3/2 slots, ownership, manual/auto, PvE/boss/PvP, runes/DOT/refresh, healing, buff expiry, interruption immunity, cooldowns, phases, asymmetric crit, exact damage, persistence and death passed.');
