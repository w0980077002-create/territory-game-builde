import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['src/game/idleEngine/index.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const engine = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const { createIdleCombat, advanceIdleCombat, validateIdleLoadout } = engine;
const clone = value => structuredClone(value);
const emptyCatalog = () => ({ skills: [], runes: [], passives: [] });
const emptyLoadout = () => ({ active: [], passiveIds: [] });
const stats = (overrides = {}) => ({
  maxHp: 100000, attack: 20, defense: 2, attackIntervalMs: 200, windupMs: 20,
  maxEnergy: 100, energy: 100, energyRegenPerSecond: 10,
  critChance: 0, criticalMultiplier: 2, blockChance: 0, blockReduction: 0.5,
  dodgeChance: 0, precision: 0, ...overrides,
});
const input = (overrides = {}) => ({
  seed: 42, hero: stats(), enemy: stats(), stage: 1,
  catalog: emptyCatalog(), loadout: emptyLoadout(), approachMs: 20,
  maxDurationMs: 20000, ...overrides,
});
function run(config, deltas) {
  let state = createIdleCombat(clone(config));
  const events = [];
  for (const elapsed of deltas) {
    const result = advanceIdleCombat(state, elapsed);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}
function finiteSnapshot(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), 'snapshot contains only finite numbers');
  else if (Array.isArray(value)) value.forEach(finiteSnapshot);
  else if (value && typeof value === 'object') Object.values(value).forEach(finiteSnapshot);
}
function hpLedger(result, startingHeroHp, startingEnemyHp) {
  const hp = { hero: startingHeroHp, enemy: startingEnemyHp };
  const contacts = new Set();
  for (const event of result.events) {
    if (event.type !== 'impact' && event.type !== 'heal') {
      assert.equal(event.hpAfter, undefined, `${event.type} must not change HP`);
      continue;
    }
    assert.ok(event.target === 'hero' || event.target === 'enemy');
    assert.ok(event.value >= 0 && Number.isFinite(event.value));
    assert.equal(event.hpAfter, hp[event.target] + (event.type === 'heal' ? event.value : -event.value),
      'damage and healing have one authoritative HP update each');
    hp[event.target] = event.hpAfter;
    if (event.source === 'attack' || event.source === 'companion') {
      assert.ok(event.contactId, 'contacts have a renderer correlation ID');
      assert.ok(!contacts.has(event.contactId), 'a contact must not apply damage twice');
      contacts.add(event.contactId);
    }
  }
  for (const annotation of result.events.filter(event => ['critical', 'block', 'dodge'].includes(event.type))) {
    assert.equal(result.events.filter(event => event.type === 'impact'
      && (event.source === 'attack' || event.source === 'companion') && event.contactId === annotation.contactId).length, 1,
      `${annotation.type} annotates exactly one physical contact`);
  }
  assert.equal(result.state.hero.hp, hp.hero);
  assert.equal(result.state.enemy.hp, hp.enemy);
}

// The catalog is external data: three candidates per category, only one equipped.
const categories = ['base', 'core', 'control', 'awakening', 'final'];
const catalog = {
  skills: categories.flatMap((category, row) => Array.from({ length: 3 }, (_, candidate) => ({
    id: `${category}-${candidate}`, category, cooldownMs: 1200, energyCost: 1,
    priority: 10 - row, multiplier: 1 + row / 10, vfxKey: `skill-${category}`,
  }))),
  runes: [
    { id: 'fire', effects: [{ type: 'burn', strength: 3, durationMs: 300, tickMs: 100 }] },
    { id: 'ice', effects: [{ type: 'slow', strength: 0.3, durationMs: 300 }] },
    { id: 'guard', effects: [{ type: 'mitigation', strength: 0.4, durationMs: 300 }] },
    { id: 'fang', effects: [{ type: 'crit', strength: 0.5, durationMs: 300 }] },
    { id: 'storm', effects: [{ type: 'magic', strength: 5 }, { type: 'energy', strength: 3 }] },
    { id: 'seer', effects: [{ type: 'precision', strength: 0.5, durationMs: 300 }] },
  ].map(rune => ({ ...rune, categories, chance: 1, cooldownMs: 600, vfxKey: `rune-${rune.id}` })),
  passives: ['attack', 'defense', 'maxHp'].map((key, n) => ({ id: `passive-${n}`, modifiers: { [key]: 2 } })),
};
const loadout = {
  active: categories.map(category => ({ skillId: `${category}-0`, runeIds: ['fire', 'ice'] })),
  passiveIds: catalog.passives.map(passive => passive.id),
};
assert.deepEqual(validateIdleLoadout(loadout, catalog), []);
assert.deepEqual(validateIdleLoadout(emptyLoadout(), emptyCatalog()), [], 'basic combat permits an empty build');
const fullConfig = input({ catalog, loadout, hero: stats({ critChance: 0.3 }), enemy: stats({ dodgeChance: 0.2, blockChance: 0.3 }) });
const full = run(fullConfig, [10000]);
assert.deepEqual(full, run(fullConfig, [10000]), 'same seed repeats state and complete event stream');
assert.notDeepEqual(full.events, run({ ...fullConfig, seed: 43 }, [10000]).events, 'different seeds drive different outcomes');
assert.deepEqual(run(fullConfig, Array(10).fill(100)), run(fullConfig, [1000]), '10 × 100 ms equals 1 × 1000 ms');
assert.deepEqual(run(fullConfig, [17, 83, 1, 199, 7, 293, 400]), run(fullConfig, [1000]), 'irregular frames preserve every millisecond');
assert.deepEqual(run(fullConfig, Array(1000).fill(0.1)), run(fullConfig, [100]), 'fractional frames preserve accumulated time');
assert.deepEqual(run(fullConfig, [Number.MAX_VALUE]), run(fullConfig, [20000]), 'huge finite elapsed is bounded by the simulation horizon');
assert.equal(run(fullConfig, [Number.MAX_VALUE]).state.phase, 'timeout');
assert.equal(full.state.hero.stats.attack, 22, 'equipped passive applies once');
assert.equal(full.state.hero.stats.defense, 4);
assert.equal(full.state.hero.stats.maxHp, 100002);
const usedSkills = new Set(full.events.filter(event => event.type === 'attack_start' && event.skillId).map(event => event.skillId));
assert.equal(usedSkills.size, 5, 'all five selected categories can cast');
assert.equal(full.events.find(event => event.type === 'attack_start' && event.actor === 'hero').skillId, 'base-0', 'highest eligible priority casts first');
assert.ok(['spawn', 'approach', 'attack_start', 'impact'].every(type => full.events.some(event => event.type === type)), 'renderer receives movement, launch and contact events');
assert.ok([...usedSkills].every(id => loadout.active.some(slot => slot.skillId === id)), 'unselected candidates cannot activate');
assert.ok(full.events.filter(event => event.runeId).every(event => ['fire', 'ice'].includes(event.runeId)), 'unequipped runes cannot activate');
hpLedger(full, 100002, 100000);

for (const bad of [
  null, {}, { active: null, passiveIds: [] }, { active: [null], passiveIds: [] },
  { ...loadout, active: [...loadout.active, { skillId: 'base-1' }] },
  { ...loadout, active: [{ skillId: 'base-0' }, { skillId: 'base-1' }] },
  { ...loadout, active: [{ skillId: 'base-0' }, { skillId: 'base-0' }] },
  { ...loadout, active: [{ skillId: 'missing' }] },
  { ...loadout, active: [{ skillId: 'base-0', runeIds: ['fire', 'ice', 'storm'] }] },
  { ...loadout, active: [{ skillId: 'base-0', runeIds: ['fire', 'fire'] }] },
  { ...loadout, active: [{ skillId: 'base-0', runeIds: ['missing'] }] },
  { ...loadout, passiveIds: ['passive-0', 'passive-0'] },
  { ...loadout, passiveIds: ['missing'] },
  { ...loadout, passiveIds: ['passive-0', 'passive-1', 'passive-2', 'passive-0'] },
]) {
  assert.ok(validateIdleLoadout(bad, catalog).length, `invalid loadout rejected: ${JSON.stringify(bad)}`);
  assert.equal(createIdleCombat(input({ catalog, loadout: bad })).phase, 'invalid');
}
for (const brokenCatalog of [null, {}, { ...catalog, skills: null }, { ...catalog, runes: [null] }, { ...catalog, skills: [...catalog.skills, catalog.skills[0]] }]) {
  assert.ok(validateIdleLoadout(loadout, brokenCatalog).length, 'malformed catalog rejected without throwing');
  assert.equal(createIdleCombat(input({ catalog: brokenCatalog, loadout })).phase, 'invalid');
}
const restricted = clone(catalog);
restricted.runes[0].categories = ['final'];
assert.ok(validateIdleLoadout(loadout, restricted).length, 'rune category compatibility enforced');
restricted.runes[0].categories = categories;
restricted.runes[0].skillIds = ['final-0'];
assert.ok(validateIdleLoadout(loadout, restricted).length, 'rune skill compatibility also enforced');

function singleSkillConfig(skillOverrides = {}, runeOverrides = undefined, extra = {}) {
  const skill = { id: 'test', category: 'core', cooldownMs: 1000, energyCost: 0, multiplier: 1, ...skillOverrides };
  const rune = { id: 'rune', categories: ['core'], chance: 1, cooldownMs: 800,
    effects: [{ type: 'magic', strength: 3 }], ...runeOverrides };
  return input({ catalog: { skills: [skill], runes: runeOverrides ? [rune] : [], passives: [] },
    loadout: { active: [{ skillId: skill.id, runeIds: runeOverrides ? [rune.id] : [] }], passiveIds: [] }, ...extra });
}
const cooldownResult = run(singleSkillConfig(), [4000]);
const casts = cooldownResult.events.filter(event => event.type === 'attack_start' && event.skillId === 'test');
assert.ok(casts.length >= 3);
for (let i = 1; i < casts.length; i++) assert.ok(casts[i].atMs - casts[i - 1].atMs >= 1000, 'skill cooldown respected');
const unusualIds = run(singleSkillConfig({ id: '__proto__', cooldownMs: 500 }, { id: 'constructor', cooldownMs: 500 }), [1600]);
assert.ok(unusualIds.events.filter(event => event.type === 'attack_start' && event.skillId === '__proto__').length >= 2, 'valid IDs cannot collide with object prototypes');
assert.ok(unusualIds.events.some(event => event.type === 'rune_proc' && event.runeId === 'constructor'));
const noEnergy = run(singleSkillConfig({ energyCost: 10 }, undefined, { hero: stats({ maxEnergy: 0, energy: 0, energyRegenPerSecond: 0 }) }), [1000]);
assert.ok(!noEnergy.events.some(event => event.skillId), 'insufficient energy falls back to basic attacks');
const conditionResult = run(singleSkillConfig({ condition: { selfHpBelow: 0.1 } }), [1000]);
assert.ok(!conditionResult.events.some(event => event.skillId), 'failed HP condition skips skill');

const burn = run(singleSkillConfig({ multiplier: 0, cooldownMs: 5000, effects: [
  { type: 'burn', strength: 7, durationMs: 300, tickMs: 100, vfxKey: 'burn-test' },
] }, undefined, { enemy: stats({ attack: 0, defense: 0 }) }), [1000]);
const application = burn.events.find(event => event.type === 'status_apply' && event.source === 'burn');
assert.ok(application, 'burn status applied');
const burnTicks = burn.events.filter(event => event.type === 'impact' && event.source === 'burn');
assert.equal(burnTicks.length, 3, 'burn ticks once each interval, including the final duration boundary');
assert.ok(burnTicks.every(event => event.value === 7 && event.skillId === 'test' && event.statusId === application.statusId));
const expiry = burn.events.find(event => event.type === 'status_expire' && event.statusId === application.statusId);
assert.equal(expiry.atMs - application.atMs, 300, 'status expires at its catalog duration');
assert.ok(!burn.state.statuses.some(status => status.id === application.statusId));
hpLedger(burn, 100000, 100000);

for (const [effect, probe] of [
  [{ type: 'slow', strength: 0.5, durationMs: 1000 }, 'slow'],
  [{ type: 'mitigation', strength: 0.5, durationMs: 1000 }, 'mitigation'],
  [{ type: 'crit', strength: 1, durationMs: 1000 }, 'crit'],
  [{ type: 'precision', strength: 1, durationMs: 1000 }, 'precision'],
]) {
  const effectResult = run(singleSkillConfig({ multiplier: 0, cooldownMs: 5000, effects: [effect] }), [1600]);
  assert.ok(effectResult.events.some(event => event.type === 'status_apply' && event.source === probe), `${probe} status applies`);
  assert.ok(effectResult.events.some(event => event.type === 'status_expire' && event.source === probe), `${probe} status expires`);
}
const baseline = run(input(), [1000]);
const slowed = run(singleSkillConfig({ multiplier: 0, cooldownMs: 5000, effects: [{ type: 'slow', strength: 0.5, durationMs: 1000 }] }), [1000]);
assert.ok(slowed.events.filter(event => event.type === 'attack_start' && event.actor === 'enemy').length < baseline.events.filter(event => event.type === 'attack_start' && event.actor === 'enemy').length, 'slow reduces enemy attack frequency');
const defended = run(singleSkillConfig({ multiplier: 0, cooldownMs: 5000, effects: [{ type: 'mitigation', strength: 0.5, durationMs: 1000 }] }), [1000]);
assert.ok(defended.state.hero.hp > baseline.state.hero.hp, 'mitigation actually reduces incoming damage');
const sharpened = run(singleSkillConfig({ multiplier: 0, cooldownMs: 5000, effects: [{ type: 'crit', strength: 1, durationMs: 1000 }] }), [1000]);
assert.ok(sharpened.events.some(event => event.type === 'critical' && event.actor === 'hero'), 'crit buff affects subsequent contacts');
const precise = run(singleSkillConfig({ multiplier: 0, cooldownMs: 5000, effects: [{ type: 'precision', strength: 1, durationMs: 1000 }] }, undefined, { enemy: stats({ dodgeChance: 1 }) }), [1000]);
// Self buffs must be able to apply even when their non-damaging cast faces a dodging enemy.
assert.ok(precise.events.some(event => event.type === 'status_apply' && event.source === 'precision'), 'self precision buff applies');
assert.ok(precise.events.some(event => event.type === 'impact' && event.actor === 'hero' && event.value > 0), 'precision counters opponent avoidance');
const storm = run(singleSkillConfig({ multiplier: 0, cooldownMs: 5000, effects: [
  { type: 'magic', strength: 13 }, { type: 'energy', strength: 9 },
] }, undefined, { hero: stats({ energy: 0, maxEnergy: 100, energyRegenPerSecond: 0 }), enemy: stats({ defense: 1000, attack: 0 }) }), [100]);
assert.ok(storm.events.some(event => event.type === 'impact' && event.source === 'magic' && event.value === 13), 'magic bypasses physical defense');
assert.equal(storm.state.hero.energy, 9, 'energy effect changes actual resource');
hpLedger(storm, 100000, 100000);

for (const [defense, annotation] of [
  [{}, 'critical'], [{ blockChance: 1 }, 'block'], [{ dodgeChance: 1 }, 'dodge'],
]) {
  const result = run(input({ hero: stats({ critChance: 1 }), enemy: stats({ attack: 0, ...defense }) }), [1000]);
  assert.ok(result.events.some(event => event.type === annotation), `${annotation} emitted`);
  hpLedger(result, 100000, 100000);
  if (annotation === 'dodge') assert.equal(result.state.enemy.hp, 100000, 'dodge never applies damage');
  if (annotation === 'block') {
    const impacts = result.events.filter(event => event.type === 'impact' && event.actor === 'hero');
    assert.ok(impacts.length > 0 && impacts.every(event => event.value < 40), 'block reduces a critical contact once');
  }
}
const noProc = run(singleSkillConfig({}, { chance: 0 }), [3000]);
assert.ok(!noProc.events.some(event => event.type === 'rune_proc' || event.runeId), 'zero chance rune never emits effects');
const procs = run(singleSkillConfig({ cooldownMs: 0 }, { cooldownMs: 800 }), [3000]);
const procEvents = procs.events.filter(event => event.type === 'rune_proc');
assert.ok(procEvents.length >= 2);
for (let i = 1; i < procEvents.length; i++) assert.ok(procEvents[i].atMs - procEvents[i - 1].atMs >= 800, 'rune internal cooldown respected');
assert.equal(procs.events.filter(event => event.type === 'impact' && event.runeId === 'rune').length, procEvents.length, 'one magic effect per proc; effects cannot recursively proc');
const dodgedRune = run(singleSkillConfig({}, {} , { enemy: stats({ dodgeChance: 1 }) }), [1000]);
assert.ok(!dodgedRune.events.some(event => event.type === 'rune_proc'), 'dodged damaging attack cannot proc a rune');

for (const [hero, enemy, outcome, deadActor] of [
  [stats({ attack: 100, maxHp: 100 }), stats({ maxHp: 1, attack: 0 }), 'victory', 'enemy'],
  [stats({ attack: 0, maxHp: 1 }), stats({ attack: 100 }), 'defeat', 'hero'],
]) {
  const result = run(input({ hero, enemy }), [5000]);
  assert.equal(result.state.phase, outcome);
  const death = result.events.find(event => event.type === 'death');
  assert.equal(death.actor, deadActor);
  assert.equal(result.events.filter(event => event.type === 'death').length, 1);
  assert.ok(!result.events.some(event => event.atMs > death.atMs), 'no later combat events after terminal death');
  assert.deepEqual(advanceIdleCombat(result.state, 100000), { state: result.state, events: [] }, 'finished combat stays unchanged');
  hpLedger(result, hero.maxHp, enemy.maxHp);
}
const stages = run(input({ hero: stats({ attack: 100 }), enemy: stats({ maxHp: 1, attack: 0 }), nextEnemies: [stats({ maxHp: 1, attack: 0 })], stageTransitionMs: 100 }), [3000]);
assert.equal(stages.state.phase, 'victory');
assert.equal(stages.state.stage, 2);
assert.equal(stages.events.filter(event => event.type === 'stage_clear').length, 2);
assert.equal(stages.events.filter(event => event.type === 'loot_visual').length, 2, 'loot events are visual only');
assert.ok(!('rewards' in stages.state) && !('inventory' in stages.state), 'simulation creates no economy state');

// Pure state transitions, safe invalid deltas and plain renderer handoff.
const originalInput = input({ catalog, loadout });
const inputBefore = clone(originalInput);
const snapshot = createIdleCombat(originalInput);
assert.deepEqual(originalInput, inputBefore, 'creation does not mutate caller data');
const before = clone(snapshot);
const advanced = advanceIdleCombat(snapshot, 1000);
assert.deepEqual(snapshot, before, 'advance does not mutate old snapshots');
originalInput.hero.attack = 9999;
originalInput.catalog.skills[0].multiplier = 9999;
assert.notEqual(snapshot.hero.stats.attack, 9999, 'state owns its stats snapshot');
assert.notEqual(snapshot.catalog.skills[0].multiplier, 9999, 'state owns its catalog snapshot');
for (const elapsed of [0, -1, NaN, Infinity, -Infinity]) {
  const result = advanceIdleCombat(snapshot, elapsed);
  assert.deepEqual(result.state, snapshot, `invalid delta ${elapsed} is a no-op`);
  assert.deepEqual(result.events, []);
}
const damaged = run(input({ hero: stats({ attack: -10, defense: -5, maxHp: -1, attackIntervalMs: -1, energy: -9 }), enemy: stats({ maxHp: -1, attack: -1 }) }), [Number.MAX_VALUE]);
finiteSnapshot(damaged);
const zeroTimers = run(singleSkillConfig({ cooldownMs: 0, windupMs: 0 }, { cooldownMs: 0,
  effects: [{ type: 'burn', strength: 1, durationMs: 100, tickMs: 0 }] }), [1000]);
finiteSnapshot(zeroTimers);
assert.ok(zeroTimers.events.length < 10000, 'zero timers cannot cause an unbounded loop');
assert.deepEqual(advanceIdleCombat(JSON.parse(JSON.stringify(advanced.state)), 1000), advanceIdleCombat(advanced.state, 1000), 'JSON snapshots resume with identical behavior');
const seen = new Set();
const renderer = { heroHp: snapshot.hero.hp, enemyHp: snapshot.enemy.hp, animations: [] };
function render(events) {
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.type === 'impact') renderer[`${event.target}Hp`] = event.hpAfter;
    renderer.animations.push({ type: event.type, actor: event.actor, atMs: event.atMs, vfxKey: event.vfxKey });
  }
}
render(advanced.events);
render(advanced.events);
assert.equal(renderer.heroHp, advanced.state.hero.hp);
assert.equal(renderer.enemyHp, advanced.state.enemy.hp);
assert.equal(renderer.animations.length, advanced.events.length, 'renderer can deduplicate event IDs without React');
assert.equal(new Set(full.events.map(event => event.id)).size, full.events.length, 'events have unique stable IDs');
assert.ok(full.events.every((event, index) => index === 0 || event.atMs >= full.events[index - 1].atMs), 'event timestamps are ordered');
finiteSnapshot(full);
// A successful proc is announced before its first effect, including a lethal effect.
const lethalRune = run(singleSkillConfig({ multiplier: 0 }, { effects: [{ type: 'magic', strength: 10 }] }, {
  hero: stats({ attack: 0 }), enemy: stats({ maxHp: 5, attack: 0, defense: 0 }),
}), [1000]);
const procIndex = lethalRune.events.findIndex(event => event.type === 'rune_proc');
const lethalIndex = lethalRune.events.findIndex(event => event.type === 'impact' && event.runeId === 'rune');
const deathIndex = lethalRune.events.findIndex(event => event.type === 'death');
assert.ok(procIndex >= 0 && procIndex < lethalIndex && lethalIndex < deathIndex, 'rune proc precedes lethal impact and death');
assert.equal(lethalRune.events.filter(event => event.type === 'rune_proc').length, 1);
assert.equal(lethalRune.events[lethalIndex].value, 5, 'lethal rune damage is capped to remaining HP');

for (const config of [
  singleSkillConfig({ multiplier: 0 }, { effects: [{ type: 'energy', strength: 10 }] }),
  singleSkillConfig({ multiplier: 0, effects: [{ type: 'mitigation', strength: 1, durationMs: 1000, target: 'opponent' }] },
    { effects: [{ type: 'magic', strength: 10 }] }),
  singleSkillConfig({ multiplier: 0 }, { effects: [{ type: 'magic', strength: 0 }] }),
]) {
  const result = run(config, [100]);
  assert.ok(!result.events.some(event => event.type === 'rune_proc'), 'rune with no applicable effect must not announce a proc');
  assert.ok(!result.events.some(event => event.runeId), 'ineffective rune must not emit damage or status events');
}

const refresh = run(singleSkillConfig({ multiplier: 0, cooldownMs: 0,
  effects: [{ type: 'slow', strength: 0.5, durationMs: 1000 }] }), [500]);
const refreshedApplications = refresh.events.filter(event => event.type === 'status_apply' && event.source === 'slow');
assert.ok(refreshedApplications.length >= 2, 'status source is applied more than once');
assert.equal(refresh.state.statuses.length, 1, 'same source refreshes one status instead of stacking');
assert.equal(refresh.state.statuses[0].id, refreshedApplications.at(-1).statusId);
for (let index = 0; index < refreshedApplications.length - 1; index++) {
  const prior = refreshedApplications[index];
  const next = refreshedApplications[index + 1];
  const cancelledIndex = refresh.events.findIndex(event => event.type === 'status_expire' && event.statusId === prior.statusId);
  assert.ok(cancelledIndex >= 0 && cancelledIndex < refresh.events.indexOf(next), 'refresh cancels previous status before replacing it');
  assert.equal(refresh.events[cancelledIndex].atMs, next.atMs);
}

const combinedDefense = run(input({ hero: stats({ attack: 20, critChance: 1, criticalMultiplier: 2 }),
  enemy: stats({ attack: 0, defense: 2, blockChance: 1, blockReduction: 0.5 }) }), [100]);
const firstContact = combinedDefense.events.find(event => event.type === 'impact' && event.actor === 'hero');
assert.equal(firstContact.value, 19, 'critical then flat defense then block: (20 × 2 − 2) × 0.5');
assert.equal(firstContact.hpAfter, 99981);
assert.equal(combinedDefense.events.filter(event => ['critical', 'block'].includes(event.type) && event.contactId === firstContact.contactId).length, 2);
hpLedger(combinedDefense, 100000, 100000);

// An expired buff cannot affect another status tick just because it appears later in the status array.
const expiryBoundary = run(singleSkillConfig({ multiplier: 0, cooldownMs: 5000, effects: [
  { type: 'burn', strength: 7, durationMs: 100, tickMs: 100 },
  { type: 'mitigation', strength: 1, durationMs: 100, target: 'opponent' },
] }), [200]);
assert.equal(expiryBoundary.events.find(event => event.type === 'impact' && event.source === 'burn').value, 7,
  'mitigation is inactive exactly at its expiration timestamp regardless of processing order');

for (const brokenEffect of [
  { type: 'magic', strength: Infinity }, { type: 'energy', strength: -1 },
  { type: 'slow', strength: 0.5, durationMs: -1 },
  { type: 'mitigation', strength: 0.5, durationMs: Infinity },
  { type: 'crit', strength: 1, durationMs: 0 },
  { type: 'burn', strength: 1, durationMs: 100, tickMs: 0 },
  { type: 'burn', strength: 1, durationMs: 100, tickMs: -1 },
  { type: 'burn', strength: 1, durationMs: 100, tickMs: Infinity },
]) {
  const badConfig = singleSkillConfig({ effects: [brokenEffect] });
  assert.ok(validateIdleLoadout(badConfig.loadout, badConfig.catalog).length, 'malformed effect rejected');
  assert.equal(createIdleCombat(badConfig).phase, 'invalid');
}
for (const key of ['runes', 'passives']) {
  const duplicateCatalog = clone(catalog);
  duplicateCatalog[key].push(clone(duplicateCatalog[key][0]));
  assert.ok(validateIdleLoadout(loadout, duplicateCatalog).length, `duplicate ${key} catalog IDs rejected`);
  assert.equal(createIdleCombat(input({ catalog: duplicateCatalog, loadout })).phase, 'invalid');
}

// Multi-hit skills have real independent contacts, not repeated cosmetic damage labels.
const comboConfig = singleSkillConfig({ hitCount: 3, hitGapMs: 80, cooldownMs: 5000,
  windupMs: 20, multiplier: 2.1,
  effects: [{ type: 'slow', strength: 0.25, durationMs: 500 }] },
{ cooldownMs: 500, effects: [{ type: 'magic', strength: 5 }] },
{ hero: stats({ attackIntervalMs: 1000 }), enemy: stats({ attack: 0, defense: 0 }) });
const combo = run(comboConfig, [400]);
const comboStarts = combo.events.filter(event => event.type === 'attack_start' && event.actor === 'hero');
const comboImpacts = combo.events.filter(event => event.type === 'impact' && event.actor === 'hero' && event.source === 'attack');
assert.equal(comboStarts.length, 1, 'triple combo spends a single skill cast');
assert.deepEqual(comboImpacts.map(event => event.hitIndex), [1, 2, 3], 'all three physical strikes resolve independently');
assert.ok(comboImpacts.every(event => event.hitCount === 3));
assert.deepEqual(comboImpacts.map(event => event.atMs - comboImpacts[0].atMs), [0, 80, 160]);
assert.equal(new Set(comboImpacts.map(event => event.contactId)).size, 3, 'each hit has unique correlation ID');
assert.equal(combo.events.filter(event => event.source === 'slow' && event.type === 'status_apply').length, 1,
  'skill status is applied only after the final contact');
assert.equal(combo.events.filter(event => event.type === 'rune_proc').length, 1, 'rune cooldown prevents free extra procs');
assert.deepEqual(run(comboConfig, [400]), run(comboConfig, [100, 80, 20, 200]), 'combos are frame-rate independent');
hpLedger(combo, 100000, 100000);
const lethalCombo = run(singleSkillConfig({ hitCount: 3, hitGapMs: 80, windupMs: 20, multiplier: 3 },
  undefined, { enemy: stats({ maxHp: 1, defense: 0, attack: 0 }) }), [500]);
assert.equal(lethalCombo.events.filter(event => event.type === 'impact' && event.actor === 'hero').length, 1,
  'lethal first strike cancels the rest of a combo');
assert.equal(lethalCombo.state.phase, 'victory');
for (const badHits of [0, 1.5, 4, Infinity, -1]) {
  const malformed = singleSkillConfig({ hitCount: badHits });
  assert.ok(validateIdleLoadout(malformed.loadout, malformed.catalog).length, `invalid hitCount ${badHits} rejected`);
}

const supportInput = input({ hero: stats({ attack: 0 }), enemy: stats({ attack: 0, defense: 2 }),
  companions: [
    { id: 'shield', attack: 28, intervalMs: 500, windupMs: 100,
      effects: [{ type: 'mitigation', strength: 0.2, durationMs: 400 }] },
    { id: 'mage', attack: 0, intervalMs: 800, windupMs: 160,
      effects: [{ type: 'magic', strength: 12 }] },
  ],
});
const support = run(supportInput, [2100]);
assert.ok(support.events.some(event => event.type === 'companion_start' && event.companionId === 'shield'));
assert.ok(support.events.some(event => event.type === 'companion_start' && event.companionId === 'mage'));
assert.ok(support.events.some(event => event.type === 'impact' && event.source === 'companion'
  && event.companionId === 'shield' && event.value > 0), 'companion has real calculated physical damage');
assert.ok(support.events.some(event => event.type === 'impact' && event.source === 'magic' && event.skillId === 'companion:mage'),
  'mage companion casts real magic, not a fake physical attack');
assert.ok(support.events.some(event => event.type === 'status_apply' && event.skillId === 'companion:shield'));
assert.deepEqual(run(supportInput, [2100]), run(supportInput, Array(21).fill(100)), 'companion timing is deterministic');
hpLedger(support, 100000, 100000);
const healing = run(input({ hero: stats({ attack: 0 }), enemy: stats({ attack: 90, attackIntervalMs: 500 }),
  companions: [{ id: 'healer', attack: 0, intervalMs: 800, windupMs: 100,
    effects: [{ type: 'heal', strength: 42 }] }] }), [2100]);
assert.ok(healing.events.some(event => event.type === 'heal' && event.target === 'hero' && event.value > 0),
  'healer companion restores genuinely lost HP');
assert.ok(healing.events.filter(event => event.type === 'heal').every(event => event.hpAfter <= 100000));
hpLedger(healing, 100000, 100000);
const corpseSupport = run(input({ hero: stats({ attack: 100, windupMs: 20 }),
  enemy: stats({ maxHp: 1, attack: 0 }), companions: [{ id: 'friend', attack: 99, intervalMs: 300, windupMs: 300 }] }), [1000]);
assert.equal(corpseSupport.events.filter(event => event.source === 'companion').length, 0,
  'companion attack is cancelled after the enemy dies');

const bossAbility = { id: 'boss-fire', category: 'core', cooldownMs: 500, energyCost: 0,
  multiplier: 1.5, effects: [{ type: 'burn', strength: 3, durationMs: 300, tickMs: 100 }] };
const boss = run(input({ hero: stats({ attack: 0 }), enemy: stats({ attack: 30 }), enemyAbility: bossAbility }), [1500]);
assert.ok(boss.events.some(event => event.type === 'attack_start' && event.actor === 'enemy'
  && event.skillId === 'boss-fire'), 'boss uses its own skill');
assert.ok(boss.events.some(event => event.type === 'status_apply' && event.actor === 'enemy' && event.source === 'burn'),
  'boss skills apply real debuffs');
assert.deepEqual(run(input({ hero: stats({ attack: 0 }), enemy: stats({ attack: 30 }), enemyAbility: bossAbility }), [1500]),
  run(input({ hero: stats({ attack: 0 }), enemy: stats({ attack: 30 }), enemyAbility: bossAbility }), [500, 1000]));
for (const companions of [Array(6).fill({ id: 'same', attack: 1, intervalMs: 500, windupMs: 100 }),
  [{ id: 'bad', attack: -1, intervalMs: 500, windupMs: 100 }]]) {
  assert.equal(createIdleCombat(input({ companions })).phase, 'invalid', 'bad companions must be rejected');
}
assert.equal(createIdleCombat(input({ enemyAbility: { ...bossAbility, cooldownMs: -1 } })).phase, 'invalid');
assert.equal(createIdleCombat(input({ nextEnemies: [stats()], nextEnemyAbilities: [] })).phase, 'invalid');
console.log('Idle engine tests passed: timing, combos, boss abilities, five-companion contract, HP ledger and rune effects.');
