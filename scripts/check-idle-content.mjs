import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { BRANCHES, DEFAULT_SKILLS, IDLE_PASSIVES, IDLE_RUNES, IDLE_SKILLS, availableRunesForSkill } from '../src/game/idleContent/catalog.ts';
import { buildPreviewCampaign, BOSS_ROSTER, ENEMY_ROSTER, getPreviewStage } from '../src/game/idleContent/campaign.ts';
import { COMPANION_ROSTER, HERO_APPEARANCES } from '../src/game/idleContent/companions.ts';
import { PREVIEW_EQUIPMENT_SLOTS, rollPreviewLoot, autoEquipPreviewLoot } from '../src/game/idleContent/loot.ts';

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
assert.equal(current.companions.length, 5, 'all five companions are present in the preview');
assert.equal(current.nextEnemies.length, 99, 'five chapters with 20 stages each');
assert.equal(current.nextEnemyAbilities.length, 99);
const lastChapterInput = bridge.createPreviewInput(catalog, loadout, undefined, 81);
assert.equal(lastChapterInput.stage, 81);
assert.equal(lastChapterInput.nextEnemies.length, 19);
const finalBossInput = bridge.createPreviewInput(catalog, loadout, undefined, 100);
assert.equal(finalBossInput.stage, 100);
assert.equal(finalBossInput.nextEnemies.length, 0);
assert.ok(finalBossInput.enemyAbility, 'final stage needs a unique boss ability');
assert.equal(engine.createIdleCombat(finalBossInput).phase, 'approach');
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
assert.ok(results.some((event) => event.type === 'companion_start'), 'allied actions are real engine events');
assert.ok(results.some((event) => event.source === 'companion' || event.skillId?.startsWith('companion:')),
  'allied abilities cause real damage or statuses');
assert.ok(results.some((event) => event.type === 'impact' && event.skillId === 'double_cleave' && event.hitIndex === 2),
  'default double-cleave must have a second real, separately calculated strike');
assert.ok(results.filter((event) => event.type === 'impact').every((event) => Number.isFinite(event.hpAfter)));
const runeTest = bridge.createPreviewLoadout({ ...DEFAULT_SKILLS, base: 'hunter_lunge' }, { hunter_lunge: ['storm_core'] });
assert.ok(engine.validateIdleLoadout(runeTest, catalog).length > 0, 'wrong rune category must be rejected');
const stages = buildPreviewCampaign();
assert.equal(stages.length, 100);
assert.equal(stages.filter(stage => stage.boss).length, 20);
assert.equal(stages.filter(stage => stage.elite).length, 10);
assert.equal(new Set(stages.filter(stage => stage.boss).map(stage => stage.enemyId)).size, 10);
for (const row of stages) {
  assert.equal(row.chapter, Math.floor((row.index - 1) / 20) + 1);
  assert.ok(row.stats.maxHp > 0 && row.stats.attack > 0);
  for (const pose of ['idle', 'attack', 'block', 'dodge', 'hit', 'death']) {
    assert.ok(existsSync(`public/assets/territory/characters/${row.enemyArt}/${pose}.webp`),
      `missing enemy artwork: ${row.enemyArt}/${pose}`);
  }
}
for (const entry of [...HERO_APPEARANCES.map(hero => ({...hero, kind: 'heroes'})),
  ...COMPANION_ROSTER.map(companion => ({ ...companion, kind: 'followers' }))]) {
  for (const pose of ['idle', 'attack', 'block', 'dodge', 'hit', 'death']) {
    assert.ok(existsSync(`public/assets/territory/characters/${entry.kind}/${entry.id}/${pose}.webp`),
      `missing original art: ${entry.kind}/${entry.id}/${pose}`);
  }
}
assert.equal(BOSS_ROSTER.length, 10);
assert.equal(ENEMY_ROSTER.length, 5);
assert.equal(PREVIEW_EQUIPMENT_SLOTS.length, 8);
let equipped = Array(8).fill(null);
let bag = [];
const allDropIds = new Set();
for (let stage = 1; stage <= 30; stage++) {
  const drops = rollPreviewLoot(stage);
  assert.equal(drops.length, stage % 5 === 0 ? 3 : 2);
  for (const drop of drops) {
    assert.ok(!allDropIds.has(drop.id), 'preview drop IDs are unique');
    allDropIds.add(drop.id);
    assert.ok(existsSync(`public/assets/territory/ui/equipment-cartoon/${drop.icon}.webp`));
  }
  const next = autoEquipPreviewLoot(equipped, bag, drops);
  equipped = next.equipped; bag = next.inventory;
}
assert.ok(equipped.every(Boolean), 'drop linking fills all eight equipment slots');
assert.equal(bag.length + equipped.length, allDropIds.size, 'preview inventory conserves every generated item');
const afterReplay = autoEquipPreviewLoot(equipped, bag, rollPreviewLoot(5));
assert.equal(afterReplay.inventory.length, bag.length, 'replaying an unlocked stage must not clone existing loot');
assert.deepEqual(afterReplay.equipped, equipped, 'stage replay must preserve the currently equipped items');
assert.ok(rollPreviewLoot(20).some(drop => drop.rarity === 'legendary'));
const bossStage = getPreviewStage(5);
const bossConfig = { ...createInput(), stage: 5, enemy: bossStage.stats, enemyAbility: bossStage.ability,
  nextEnemies: [], nextEnemyAbilities: [] };
const bossState = engine.createIdleCombat(bossConfig);
assert.equal(bossState.phase, 'approach');
const bossEvents = engine.advanceIdleCombat(bossState, 8000).events;
assert.ok(bossEvents.some(event => event.type === 'attack_start' && event.actor === 'enemy' && event.skillId === bossStage.ability.id),
  'elite boss must cast a real timed ability');
console.log('OK: real combat, 100 stages, 10 original bosses, 5 enemy types, 5 allied fighters and 4 hero skins');
