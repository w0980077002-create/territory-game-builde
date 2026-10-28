import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { BRANCHES, DEFAULT_SKILLS, IDLE_PASSIVES, IDLE_RUNES, IDLE_SKILLS, availableRunesForSkill } from '../src/game/idleContent/catalog.ts';

const uniqueIds = (items, label) => assert.equal(new Set(items.map((item) => item.id)).size, items.length, `${label}: duplicate ids`);
uniqueIds(IDLE_SKILLS, 'Skills');
uniqueIds(IDLE_RUNES, 'Runes');
uniqueIds(IDLE_PASSIVES, 'Passives');

assert.equal(BRANCHES.length, 5);
assert.equal(IDLE_SKILLS.length, 15);
assert.equal(IDLE_PASSIVES.length, 3);
assert.equal(IDLE_RUNES.length, 6);
for (const branch of BRANCHES) {
  const skills = IDLE_SKILLS.filter((skill) => skill.branch === branch.id);
  assert.equal(skills.length, 3, `${branch.title}: expected 3 selectable skills`);
  assert.ok(skills.some((skill) => skill.id === DEFAULT_SKILLS[branch.id]), `${branch.title}: missing default skill`);
}
for (const skill of IDLE_SKILLS) {
  assert.ok(skill.name && skill.description && skill.symbol && skill.vfx, `Incomplete skill ${skill.id}`);
  assert.ok(skill.cooldownSeconds > 0 && skill.energyCost >= 0, `Invalid cooldown/energy ${skill.id}`);
  assert.ok(availableRunesForSkill(skill).length >= 1, `No compatible runes for ${skill.id}`);
}
assert.deepEqual(new Set(IDLE_RUNES.map((rune) => rune.id)), new Set([
  'glacial_edge', 'fire_ember', 'oak_bark', 'wolf_fang', 'storm_core', 'seers_mark',
]));
for (const rune of IDLE_RUNES) {
  assert.ok(rune.compatible.length > 0);
  assert.ok(rune.compatible.every((branch) => BRANCHES.some((row) => row.id === branch)));
}

// Test the real bridge to Codex's deterministic engine, not simulated UI counters.
const compiled = await build({
  entryPoints: ['src/game/idleContent/toEngine.ts', 'src/game/idleEngine/index.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false, outdir: 'bundle', logLevel: 'silent',
});
const modules = await Promise.all(compiled.outputFiles.map(async (file) => ({
  path: file.path,
  module: await import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`),
})));
const bridge = modules.find((item) => item.path.endsWith('toEngine.js')).module;
const engine = modules.find((item) => item.path.endsWith('index.js')).module;
const catalog = bridge.createPreviewCatalog();
const selected = { ...DEFAULT_SKILLS };
const equippedRunes = { double_cleave: ['wolf_fang', 'seers_mark'], forge_heat: ['fire_ember'],
  ice_shackles: ['glacial_edge'], berserker_fury: ['wolf_fang'], thunder_wrath: ['storm_core'] };
const loadout = bridge.createPreviewLoadout(selected, equippedRunes);
assert.deepEqual(engine.validateIdleLoadout(loadout, catalog), [], 'default preview build must pass engine validation');
assert.equal(catalog.skills.length, 15);
assert.equal(catalog.runes.length, 6);
assert.equal(catalog.passives.length, 3);
const createInput = () => bridge.createPreviewInput(catalog, loadout);
let current = engine.createIdleCombat(createInput());
assert.equal(current.phase, 'approach');
const results = [];
for (let tick = 0; tick < 250; tick++) {
  const frame = engine.advanceIdleCombat(current, 80);
  current = frame.state;
  results.push(...frame.events);
  if (current.phase === 'victory' || current.phase === 'defeat') break;
}
assert.ok(results.some((event) => event.type === 'attack_start' && event.actor === 'hero'));
assert.ok(results.some((event) => event.type === 'attack_start' && event.actor === 'enemy'));
assert.ok(results.some((event) => event.type === 'impact' && event.source === 'attack'));
assert.ok(results.some((event) => event.type === 'rune_proc'), 'equipped runes must produce real events');
assert.ok(results.some((event) => event.type === 'impact' && event.skillId === 'double_cleave' && event.hitIndex === 2),
  'default double-cleave must have a second real, separately calculated strike');
assert.ok(results.filter((event) => event.type === 'impact').every((event) => Number.isFinite(event.hpAfter)));
const runeTest = bridge.createPreviewLoadout({ ...DEFAULT_SKILLS, base: 'hunter_lunge' }, { hunter_lunge: ['storm_core'] });
assert.ok(engine.validateIdleLoadout(runeTest, catalog).length > 0, 'wrong rune category must be rejected');
console.log('OK: 15 skills, 6 runes, 3 passives; valid bridge and real deterministic combat events');
