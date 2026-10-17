import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
function load(sourceCode, dependencies = {}) {
  const compiled = ts.transpileModule(sourceCode, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal((compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  const fakeMath = Object.create(Math);
  fakeMath.random = () => 0.5; // Repeatable dodge, block, critical and zone choices.
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports, Math: fakeMath,
    require: (name) => {
      if (!(name in dependencies)) throw new Error('Unexpected PvE dependency ' + name);
      return dependencies[name];
    },
  });
  return module.exports;
}

const balance = load(source('../src/game/pveBalance.ts'));
const { chapterEnemyMultipliers, trialEnemyMultipliers, bossEnemyMultipliers, eliteRoundDamageCap, followerGuardDamage } = balance;
for (const chapter of [1, 2, 3]) {
  const m = chapterEnemyMultipliers(chapter);
  assert.equal(m.hp, 1, 'onboarding HP multiplier must remain 1x');
  assert.equal(m.attack, 1, 'onboarding attack multiplier must remain 1x');
  assert.equal(m.defense, 1, 'onboarding defense multiplier must remain 1x');
}
for (const stat of ['hp', 'attack', 'defense']) {
  let previous = 0;
  for (const floor of [1, 3, 4, 5, 10, 15, 20, 50, 60, 100, 101, 150, 300, 1000, 3000, 10000]) {
    const campaign = chapterEnemyMultipliers(floor)[stat];
    const trial = trialEnemyMultipliers(floor)[stat];
    assert(Number.isFinite(campaign) && campaign >= previous, `Campaign ${stat} must scale at floor ${floor}`);
    assert(Number.isFinite(trial) && trial >= campaign, `Trials ${stat} must be at least as strong at ${floor}`);
    previous = campaign;
  }
}
assert(chapterEnemyMultipliers(3000).hp > chapterEnemyMultipliers(100).hp * 3, 'post-100 scaling must not flatten');
assert.equal(bossEnemyMultipliers(1).hp, 1, 'tutorial boss must not get milestone buff');
assert(bossEnemyMultipliers(5).hp > 1 && bossEnemyMultipliers(10).hp > bossEnemyMultipliers(5).hp, '5th and 10th chapter bosses should be more dangerous');
assert.equal(eliteRoundDamageCap('ch14_enemy_0', false, 1000), null, 'tutorial enemies have no cap');
assert.equal(eliteRoundDamageCap('ch15_enemy_0', false, 1000), 720, 'midgame enemies resist instant kills');
assert.equal(eliteRoundDamageCap('ch100_enemy_4', false, 1000), 550);
assert.equal(eliteRoundDamageCap('ch3000_enemy_0', false, 1000), 500);
assert.equal(eliteRoundDamageCap('ch10_boss', true, 1000), 400);
assert.equal(eliteRoundDamageCap('trial_100', false, 1000), 340);
assert.equal(eliteRoundDamageCap('arena_enemy_0', false, 1000), null, 'PvP must not inherit PvE cap');
assert.equal(eliteRoundDamageCap('trial_100', false, Number.POSITIVE_INFINITY), null, 'invalid HP rejected');
assert.equal(followerGuardDamage(100, 1000), 88, 'guardian mitigation remains capped at 12%');

const zones = ['head', 'chest', 'belly', 'legs'].map((id) => ({ id, label: id, mult: 1 }));
const pve = load(source('../src/game/pve.ts'), {
  './arenaApi': { ZONES: zones },
  './engine': { getComputedStats: () => { throw Error('not needed'); } },
  './pveBalance': balance,
  './followers': { followerCombat: () => ({}), selectedFollower: () => null },
  './forge': { forgeSetBonus: () => ({ hp: 0, attack: 0, defense: 0 }) },
});
const hero = { name: 'Hero', hp: 1000, maxHp: 1000, attack: 100000, defense: 100, critChance: 100, critDamage: 50 };
function checkRound(id, isBoss, expectedCap) {
  const enemy = { name: 'Enemy', hp: 1000, maxHp: 1000, attack: 1, defense: 1, critChance: 0, critDamage: 50, enemyId: id, isBoss };
  const outcome = pve.playRound(hero, enemy, 'head', [], 100000, 'Follower', 0);
  const dealt = outcome.hits.filter((h) => h.targetSide === 'enemy').reduce((sum, h) => sum + h.amount, 0);
  assert.equal(dealt, expectedCap, `Hero + follower must share a single PvE round cap for ${id}`);
  assert.equal(outcome.enemy.hp, 1000 - expectedCap);
  assert(outcome.hero.hp > 0, 'battle continues between capped hits');
}
checkRound('ch15_enemy_0', false, 720);
checkRound('ch100_enemy_0', false, 550);
checkRound('ch3000_enemy_0', false, 500);
checkRound('ch10_boss', true, 400);
checkRound('trial_100', false, 340);
checkRound('ch1_enemy_0', false, 1000);

const engine = source('../src/game/engine.ts');
const actions = source('../src/game/actions.ts');
assert(engine.includes('export const PVE_STONE_COST = 1;'), 'combat stone cost unchanged');
assert(engine.includes('winsNeeded: enemies.length'), 'chapter gates unchanged');
assert(actions.includes('currentChapter: nextChapter'), 'chapter progression remains victory-based');
assert(!engine.includes('Math.pow(1.15, num)'), 'no accidental exponential boss loot inflation');
console.log('PvE balance PASS: floors 1-3000, boss milestones, real rounds, follower limits, tutorial, costs and progression.');
