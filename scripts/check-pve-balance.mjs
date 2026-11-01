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

// The visual cue is driven by the actual companion hit, including when names collide.
const witchHero = { ...hero, name: 'Same name', hp: 800, attack: 10, critChance: 0 };
const witchEnemy = { name: 'Enemy', hp: 1000, maxHp: 1000, attack: 30, defense: 0, critChance: 0, critDamage: 50 };
const witchRound = pve.playRound(witchHero, witchEnemy, 'head', [], 65, 'Same name', 0,
  { role: 'pumpkin', attack: 65, defense: 0, heal: 16, crit: 0, pierce: 0 });
assert.equal(witchRound.hits.filter(h => h.source === 'companion').length, 1);
assert.equal(witchRound.hits.find(h => h.source === 'companion').amount, 65);
assert.equal(witchRound.healAmount, 16);
const lethal = zones.map(z => pve.playRound({ ...witchHero, attack: 100000 }, witchEnemy, z.id, [], 65, 'Same name')).find(r => r.hits[0].amount > 0);
assert(lethal, 'fixture must contain an unblocked strike');
assert.equal(lethal.hits.filter(h => h.source === 'companion').length, 0, 'no visual strike if the hero already defeated the enemy');
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
assert.equal(blockedSummary.dealtDamage, 0, 'Blocked strike cannot inflate damage counters');
assert.equal(blockedSummary.takenDamage, starterHero.hp - blockedRound.hero.hp);
assert.equal(blockedSummary.companionDamage, 0);
const protectedRound = pve.playRound(starterHero, guardEnemy, 'legs', ['belly', 'head'], 0, '', 0, null, visibleGuard);
const protectedSummary = pve.summarizePveRound(protectedRound.hits);
assert.equal(protectedSummary.heroStrike, 'hit');
assert.equal(protectedSummary.enemyStrike, 'block');
assert.equal(protectedSummary.enemyZone, 'belly');
assert.equal(protectedSummary.takenDamage, 0, 'A covered enemy strike deals zero real damage');
assert.equal(protectedSummary.dealtDamage, starterHero.hp > 0 ? protectedRound.hits[0].amount : 0);
const companionSummary = pve.summarizePveRound(witchRound.hits);
assert.equal(companionSummary.companionDamage, 65, 'Only actual companion hits contribute');
assert.equal(companionSummary.dealtDamage, witchRound.hits.filter(hit => hit.targetSide === 'enemy').reduce((total, hit) => total + hit.amount, 0));
assert.equal(pve.summarizePveRound([]).enemyZone, null);
// Manual counterplay actions must use the same committed intent as the real
// PvE resolver. They only select zones; they cannot settle hits or mint loot.
for (const { id: guarded } of zones) {
  let selected = null;
  const openings = new Set();
  for (let i = 0; i < zones.length - 1; i++) {
    selected = pve.nextOpenStrike(selected, guarded);
    assert.notEqual(selected, guarded, 'Opening button must never target the shown guard');
    openings.add(selected);
  }
  assert.equal(openings.size, zones.length - 1, 'All three openings must be selectable');
  assert.equal(pve.nextOpenStrike(selected, guarded), [...openings][0], 'Openings cycle without a hidden fourth attack');
}
assert.equal(pve.coverThreatZone(['head'], 'head').join(','), 'head', 'Covering twice is idempotent');
assert.equal(pve.coverThreatZone(['head'], 'belly').join(','), 'head,belly', 'Keep the first selected defense');
assert.equal(pve.coverThreatZone(['head', 'legs'], 'chest').join(','), 'legs,chest', 'Replace only the oldest defense');
const counterAttack = pve.nextOpenStrike('head', visibleGuard.blocks[0]);
const counterRound = pve.playRound(starterHero, guardEnemy, counterAttack, [], 0, '', 0, null, visibleGuard);
assert.equal(counterRound.hits[0].tone, 'hit', 'Opening action must really bypass the next committed guard');

// Trials and chapter bosses show the actual committed next attack, not a
// cosmetic warning. Choosing that defense must change the resolved HP.
const threatIntent = { attack: 'chest', blocks: ['head', 'belly'] };
const coveredThreat = pve.playRound(starterHero, guardEnemy, 'legs', ['chest', 'legs'], 0, '', 0, null, threatIntent);
const ignoredThreat = pve.playRound(starterHero, guardEnemy, 'legs', ['head', 'legs'], 0, '', 0, null, threatIntent);
assert.equal(pve.summarizePveRound(coveredThreat.hits).enemyStrike, 'block');
assert.equal(coveredThreat.hero.hp, starterHero.hp, 'Correct defense prevents the announced strike');
assert.equal(pve.summarizePveRound(ignoredThreat.hits).enemyStrike, 'hit');
assert(ignoredThreat.hero.hp < starterHero.hp, 'Ignoring the announced strike causes actual HP loss');
const coveredByAction = pve.coverThreatZone(['head', 'legs'], threatIntent.attack);
const actionRound = pve.playRound(starterHero, guardEnemy, 'legs', coveredByAction, 0, '', 0, null, threatIntent);
assert.equal(actionRound.hero.hp, starterHero.hp, 'One-tap cover must prevent the actual announced strike');
const fightSource = source('../src/components/pve/PveFight.tsx');
assert.match(fightSource, /data-testid="pve-round-reaction"/, 'Show actual round feedback to manual PvE players');
assert.match(fightSource, /data-testid="pve-live-damage-totals"/, 'Show cumulative actual damage during the fight');
assert.match(fightSource, /setBattleTotals\(previous => \(\{[\s\S]*report\.dealtDamage/, 'Cumulative totals must come from resolved hits');
assert.match(fightSource, /data-testid="pve-surrender-confirm"/, 'Surrender must require an explicit second action');
assert.match(fightSource, /data-testid="pve-surrender-cancel"/, 'Players must be able to return to the same fight');
assert.match(fightSource, /data-testid="pve-surrender-accept"/, 'The surrender confirmation must be explicit');
assert.match(fightSource, /if \(roundFlight\.current \|\| done\.current\) return;/, 'Cannot concede during an unresolved round');
assert.match(fightSource, /setTacticalReport\(summarizePveRound\(res\.hits\)\)/, 'Tactical feedback must come from resolved hits');
assert.match(fightSource, /setTacticalReport\(null\)/, 'Clear previous feedback during the next move');
assert.match(fightSource, /data-testid="pve-enemy-guard"/, 'Show the actual guard during classic manual combat');
assert.match(fightSource, /\(kind === 'trial' \|\| enemy\.isBoss\) && !auto && !busy/, 'Only trial and boss manual rounds reveal their committed strike');
assert.match(fightSource, /blocks\.includes\(enemyIntent\.attack\)/, 'The warning reflects the selected defense');
assert.match(fightSource, /data-testid="pve-telegraphed-strike"/, 'Show the actual next strike direction for tactical trials and bosses');
assert.match(fightSource, /data-testid="pve-choose-opening"/, 'The shown enemy guard must offer an actual manual attack choice');
assert.match(fightSource, /setAttack\(current => nextOpenStrike\(current, guardedZone\.id\)\)/, 'Opening action must select the attack used by the real round');
assert.match(fightSource, /data-testid="pve-cover-threat"/, 'Trial and boss strike warning must offer a manual defense action');
assert.match(fightSource, /setBlocks\(current => coverThreatZone\(current, enemyIntent\.attack\)\)/, 'Threat action must select a real defensive zone');

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
assert.match(classicFight, /if \(roundFlight\.current \|\| busy \|\| outcome \|\| confirmSurrender \|\| done\.current \|\| !alive\.current\) return;/,
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
