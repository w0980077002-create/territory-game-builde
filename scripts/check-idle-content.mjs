import assert from 'node:assert/strict';
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
console.log('OK: 5 branches, 15 original skills, 6 compatible runes, 3 passives');
