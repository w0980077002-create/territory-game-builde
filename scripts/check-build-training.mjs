import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['src/game/builds/buildTraining.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const source = Buffer.from(compiled.outputFiles[0].text).toString('base64');
const lab = await import(`data:text/javascript;base64,${source}`);
const {
  TRAINING_BUILDS, TRAINING_ENEMIES, TRAINING_ROLES, TRAINING_RUNES, TRAINING_SETS,
  defaultTrainingLoadout, simulateTrainingBattle, trainingBuildPreview, validateTrainingLoadout,
} = lab;

const base = Object.freeze({ hp: 800, maxHp: 800, attack: 58, defense: 19, critChance: 8, critDamage: 65 });
assert.equal(TRAINING_BUILDS.length, 4);
assert.equal(TRAINING_RUNES.length, 6);
assert.equal(TRAINING_SETS.length, 3);
assert.equal(TRAINING_ROLES.length, 5);
assert.equal(TRAINING_ENEMIES.length, 3);

const signatures = new Set();
for (const build of TRAINING_BUILDS) {
  const loadout = defaultTrainingLoadout(build.id);
  assert.equal(validateTrainingLoadout(loadout), true, `build ${build.id}`);
  const preview = trainingBuildPreview(base, loadout);
  assert.ok(preview?.maxHp >= base.maxHp);
  assert.ok(preview?.attack >= base.attack);
  signatures.add(`${preview.maxHp}/${preview.attack}/${preview.defense}/${preview.critChance}`);

  const boss = { ...TRAINING_ENEMIES[2], maxHp: 400, attack: 26, defense: 8 };
  const first = simulateTrainingBattle(base, loadout, boss, 42);
  const repeat = simulateTrainingBattle(base, loadout, boss, 42);
  assert.deepEqual(first, repeat, 'seeded battles must be repeatable');
  assert.equal(first.earnedRewards, false, 'training never grants resources');
  assert.ok(first.rounds.length > 0 && first.rounds.length <= 16);
  assert.equal(first.damageDealt, boss.maxHp - first.remainingEnemyHp);
  assert.ok(first.remainingHeroHp >= 0 && first.remainingHeroHp <= preview.maxHp);
  assert.ok(first.reachedPhase >= 1 && first.reachedPhase <= 3);
  assert.ok(first.rounds.every(round => round.damage >= 0 && round.incoming >= 0));
  assert.equal(first.rounds.at(-1).enemyHp, first.remainingEnemyHp);
}
assert.equal(signatures.size, 4, 'each class needs its own gameplay signature');

const basic = defaultTrainingLoadout();
const equipped = { ...basic, runeIds: [TRAINING_RUNES[0].id, TRAINING_RUNES[2].id],
  setId: TRAINING_SETS[0].id, mainRole: TRAINING_ROLES[0].id,
  supportRoles: [TRAINING_ROLES[1].id, TRAINING_ROLES[2].id] };
assert.equal(validateTrainingLoadout(equipped), true);
const enhanced = trainingBuildPreview(base, equipped);
const unmodified = trainingBuildPreview(base, basic);
assert.ok(enhanced.maxHp > unmodified.maxHp || enhanced.defense > unmodified.defense);
assert.deepEqual(base, { hp: 800, maxHp: 800, attack: 58, defense: 19, critChance: 8, critDamage: 65 });
assert.deepEqual(basic, defaultTrainingLoadout());

for (const bad of [
  { ...basic, buildId: '__unknown__' },
  { ...basic, runeIds: ['__unknown__'] },
  { ...basic, runeIds: [TRAINING_RUNES[0].id, TRAINING_RUNES[0].id] },
  { ...basic, runeIds: TRAINING_RUNES.slice(0, 3).map(r => r.id) },
  { ...basic, mainRole: 'guardian', supportRoles: ['guardian'] },
  { ...basic, supportRoles: TRAINING_ROLES.slice(0, 3).map(role => role.id) },
  { ...basic, setId: '__unknown__' },
]) {
  assert.equal(validateTrainingLoadout(bad), false);
  assert.equal(trainingBuildPreview(base, bad), null);
}

assert.equal(simulateTrainingBattle(base, basic, TRAINING_ENEMIES[0], 42, 0), null);
assert.equal(simulateTrainingBattle(base, basic, TRAINING_ENEMIES[0], 42, 41), null);
assert.equal(simulateTrainingBattle(base, basic, { ...TRAINING_ENEMIES[0], maxHp: -1 }, 42), null);
assert.equal(trainingBuildPreview({ ...base, attack: Infinity }, basic), null);

const ui = readFileSync('src/components/builds/BuildTrainingPanel.tsx', 'utf8');
const profile = readFileSync('src/components/ProfileScreen.tsx', 'utf8');
assert.match(ui, /simulateTrainingBattle\(/);
assert.match(ui, /enemyForHero\(baseStats, enemyId\)/, 'fixed enemy for build comparison');
assert.doesNotMatch(ui, /useGame|useStore|supabase|fetch\(/, 'laboratory must not write real player state');
assert.match(profile, /lazy\(\(\) => import\('\.\/builds\/BuildTrainingPanel'\)/);
assert.match(profile, /data-testid="profile-build-training"/);

console.log('Combat-build training tests passed: 4 classes, 6 runes, 3 sets, 5 roles, 3 enemies, 0 rewards.');
