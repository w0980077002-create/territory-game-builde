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
const elixirExpiry = load(source('../src/game/elixirExpiry.ts'));
const pve = load(source('../src/game/pve.ts'), {
  './arenaApi': { ZONES: zones },
  './engine': { getComputedStats: () => { throw Error('not needed'); } },
  './pveBalance': balance,
  './followers': { followerCombat: () => ({}), selectedFollower: () => null },
  './forge': { forgeSetBonus: () => ({ hp: 0, attack: 0, defense: 0 }) },
  './elixirExpiry': elixirExpiry,
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

// The classic PvE guard tell must be real: an advertised defense changes the hit outcome.
const starterHero = { name: 'Hero', hp: 1000, maxHp: 1000, attack: 100, defense: 10, critChance: 0, critDamage: 50 };
const guardEnemy = { name: 'Guard', hp: 500, maxHp: 500, attack: 5, defense: 5, critChance: 0, critDamage: 50, enemyId: 'ch1_enemy_0', isBoss: false };
const visibleGuard = { attack: 'belly', blocks: ['head', 'chest'] };
const blockedRound = pve.playRound(starterHero, guardEnemy, 'head', [], 0, '', 0, null, visibleGuard);
const smartRound = pve.playRound(starterHero, guardEnemy, 'legs', [], 0, '', 0, null, visibleGuard);
assert.equal(blockedRound.hits[0].tone, 'block', 'Telegraphed head guard must block a head attack');
assert.equal(blockedRound.hits[0].amount, 0);
assert.equal(smartRound.hits[0].tone, 'hit', 'Attacking outside the telegraphed guard should hit');
assert(smartRound.hits[0].amount > 0, 'Choosing a gap should cause genuine combat damage');
// The same strikes that changed HP must drive the visible tactical feedback.
const blockedSummary = pve.summarizePveRound(blockedRound.hits);
assert.equal(blockedSummary.heroStrike, 'block');
assert.equal(blockedSummary.enemyStrike, 'hit');
assert.equal(blockedSummary.enemyZone, 'belly');
const protectedRound = pve.playRound(starterHero, guardEnemy, 'legs', ['belly', 'head'], 0, '', 0, null, visibleGuard);
const protectedSummary = pve.summarizePveRound(protectedRound.hits);
assert.equal(protectedSummary.heroStrike, 'hit');
assert.equal(protectedSummary.enemyStrike, 'block');
assert.equal(protectedSummary.enemyZone, 'belly');
assert.equal(pve.summarizePveRound([]).enemyZone, null);
const fightSource = source('../src/components/pve/PveFight.tsx');
assert.match(fightSource, /data-testid="pve-round-reaction"/, 'Show actual round feedback to manual PvE players');
assert.match(fightSource, /setTacticalReport\(summarizePveRound\(res\.hits\)\)/, 'Tactical feedback must come from resolved hits');
assert.match(fightSource, /setTacticalReport\(null\)/, 'Clear previous feedback during the next move');
assert.match(fightSource, /data-testid="pve-enemy-guard"/, 'Show the actual guard during classic manual combat');
assert.match(fightSource, /followerBonus\.defense, followerBonus, enemyIntent\)/, 'Pass the visible guard to the PvE round calculation');
assert.match(fightSource, /setEnemyIntent\(randomZones\(\)\)/, 'Refresh guard after resolving each round');

const engine = source('../src/game/engine.ts');
const actions = source('../src/game/actions.ts');
assert(engine.includes('export const PVE_STONE_COST = 1;'), 'combat stone cost unchanged');
assert(engine.includes('winsNeeded: enemies.length'), 'chapter gates unchanged');
assert(actions.includes('currentChapter: nextChapter'), 'chapter progression remains victory-based');
assert(!engine.includes('Math.pow(1.15, num)'), 'no accidental exponential boss loot inflation');

const classicFight = source('../src/components/pve/PveFight.tsx');
assert.match(classicFight, /const roundFlight = useRef\(false\)/,
  'Classic campaign and trials need a synchronous one-round-at-a-time guard');
assert.match(classicFight, /if \(roundFlight\.current \|\| busy \|\| outcome \|\| done\.current \|\| !alive\.current\) return;/,
  'Repeated attack taps and unmounted fights must not run another round');
assert.match(classicFight, /roundFlight\.current = true;[\s\S]*?try \{/,
  'Lock the round before animation or referral bookkeeping');
assert.match(classicFight, /finally \{\s*roundFlight\.current = false;/,
  'Always release the in-flight round guard');
assert.match(classicFight, /const latest = useGame\.get\(\);\s*const item = latest\.belt\[i\];/,
  'Consume the most recent inventory belt, not a stale React snapshot');
assert.match(classicFight, /now - lastPotionUse\.current\.at < 650/,
  'A rapid double tap must not consume the same potion twice');
assert.match(classicFight, /heroRef\.current = r\.hero;\s*useGame\.set\(consumeBelt\(latest, i\)\)/,
  'Update battle state and consume one current belt charge exactly once');
assert.match(classicFight, /Object\.values\(state\.player\.equipped\)\.filter\(Boolean\)\.length/,
  'Only actual equipped items count toward the seven gear slots');

console.log('PvE balance PASS: floors 1-3000, boss milestones, real rounds, follower limits, tutorial, costs and progression.');
