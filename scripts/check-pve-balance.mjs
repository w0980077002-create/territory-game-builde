import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
function load(sourceCode, dependencies = {}, rng = () => 0.5) {
  const compiled = ts.transpileModule(sourceCode, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal((compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  const fakeMath = Object.create(Math);
  fakeMath.random = rng; // Repeatable dodge, block, critical and zone choices.
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
const pveDependencies = {
  './arenaApi': { ZONES: zones },
  './engine': { getComputedStats: () => { throw Error('not needed'); } },
  './pveBalance': balance,
  './followers': { followerCombat: () => ({}), selectedFollower: () => null },
  './forge': { forgeSetBonus: () => ({ hp: 0, attack: 0, defense: 0 }) },
  './elixirExpiry': elixirExpiry,
};
const pve = load(source('../src/game/pve.ts'), pveDependencies);
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
const witchRound = pve.playRound(witchHero, witchEnemy, 'head', [], 150, 'Same name', 0,
  { role: 'pumpkin', attack: 150, defense: 0, heal: 16, crit: 0, pierce: 0 });
assert.equal(witchRound.hits.filter(h => h.source === 'companion').length, 1);
assert.equal(witchRound.hits.find(h => h.source === 'companion').amount, 150);
assert.equal(witchRound.healAmount, 16);
const lethal = zones.map(z => pve.playRound({ ...witchHero, attack: 100000 }, witchEnemy, z.id, [], 65, 'Same name')).find(r => r.hits[0].amount > 0);
assert(lethal, 'fixture must contain an unblocked strike');
assert.equal(lethal.hits.filter(h => h.source === 'companion').length, 0, 'no visual strike if the hero already defeated the enemy');
// The classic PvE guard tell must be real: an advertised defense changes the hit outcome.
const starterHero = { name: 'Hero', hp: 1000, maxHp: 1000, attack: 100, defense: 10, critChance: 0, critDamage: 50 };
const guardEnemy = { name: 'Guard', hp: 500, maxHp: 500, attack: 5, defense: 5, critChance: 0, critDamage: 50, enemyId: 'ch1_enemy_0', isBoss: false };
const visibleGuard = { attack: 'belly', blocks: ['head', 'chest'] };
const blockedRound = pve.playRound(starterHero, guardEnemy, 'head', [], 0, '', 0, null, visibleGuard);
// Regression: the UI advertises TWO real enemy guards. The resolver must
// block either slot, not only the first (critical strikes can still pierce).
const secondGuardRound = pve.playRound(starterHero, guardEnemy, 'chest', [], 0, '', 0, null, visibleGuard);
assert.equal(secondGuardRound.hits[0].tone, 'block', 'Second advertised enemy guard must block a non-critical strike');
assert.equal(secondGuardRound.hits[0].amount, 0, 'Second guard cannot silently leak damage');
assert.equal(secondGuardRound.enemy.hp, guardEnemy.hp, 'Blocked second zone must preserve enemy HP');
for (const first of zones) for (const second of zones) {
  if (first.id === second.id) continue;
  const intent = { attack: 'belly', blocks: [first.id, second.id] };
  for (const defended of intent.blocks) {
    const round = pve.playRound(starterHero, guardEnemy, defended, [], 0, '', 0, null, intent);
    assert.equal(round.hits[0].tone, 'block', 'Both committed guards must resolve as blocks: ' + intent.blocks.join('/'));
    assert.equal(round.enemy.hp, guardEnemy.hp, 'Guarded zone must not damage enemy HP');
  }
  for (const open of zones.filter(z => !intent.blocks.includes(z.id))) {
    const round = pve.playRound(starterHero, guardEnemy, open.id, [], 0, '', 0, null, intent);
    assert.equal(round.hits[0].tone, 'hit', 'Real opening must remain hittable: ' + open.id);
    assert(round.enemy.hp < guardEnemy.hp, 'Real opening must lower enemy HP');
  }
}
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
assert.equal(companionSummary.companionDamage, 150, 'Only actual companion hits contribute');
assert.equal(companionSummary.dealtDamage, witchRound.hits.filter(hit => hit.targetSide === 'enemy').reduce((total, hit) => total + hit.amount, 0));
assert.equal(pve.summarizePveRound([]).enemyZone, null);
// Manual counterplay actions must use the same committed intent as the real
// PvE resolver. They only select zones; they cannot settle hits or mint loot.
for (const first of zones) for (const second of zones) {
  if (first.id === second.id) continue;
  const guarded = [first.id, second.id];
  let selected = null;
  const openings = new Set();
  for (let i = 0; i < zones.length - guarded.length; i++) {
    selected = pve.nextOpenStrike(selected, guarded);
    assert(!guarded.includes(selected), 'Opening action must bypass BOTH committed guards');
    openings.add(selected);
  }
  assert.equal(openings.size, 2, 'Both real unguarded attack zones must be selectable');
  assert.equal(pve.nextOpenStrike(selected, guarded), [...openings][0], 'Only the two real openings cycle');
}
assert.equal(pve.nextOpenStrike('head', ['head', 'chest', 'belly', 'legs']), 'head',
  'Malformed fully guarded intent must not create a phantom zone');
// The real manual boss combo needs a DIFFERENT open target after 1/2.
// One tap should prepare that attack without resolving a free hit or changing
// the committed guard. Subsequent taps must still let the player choose.
for (const first of zones) for (const second of zones) {
  if (first.id === second.id) continue;
  const guards = [first.id, second.id];
  const openings = zones.map(z => z.id).filter(id => !guards.includes(id));
  for (const previous of zones.map(z => z.id)) {
    const chosen = pve.nextComboOpening(null, guards, previous);
    assert(openings.includes(chosen), 'Combo button must choose an actually open zone');
    if (openings.some(id => id !== previous))
      assert.notEqual(chosen, previous, 'First tap must not repeat the landed combo direction');
    const other = pve.nextComboOpening(chosen, guards, previous);
    assert(openings.includes(other) && other !== chosen, 'Second tap cycles real openings');
  }
}
const comboIntent = { attack: 'belly', blocks: ['head', 'chest'] };
const comboFirst = pve.nextTacticalMomentum({ lastZone: null, streak: 0 }, 'head', 'hit', true);
const comboTarget = pve.nextComboOpening(null, comboIntent.blocks, comboFirst.lastZone);
assert.equal(comboTarget, 'belly', 'First combo tap must pick a different open target');
const comboHit = pve.playRound(starterHero, guardEnemy, comboTarget, [], 0, '', 0, null, comboIntent);
assert.equal(comboHit.hits[0].tone, 'hit', 'Suggested combo target must damage the REAL enemy');
assert.equal(pve.nextTacticalMomentum(comboFirst, comboTarget, comboHit.hits[0].tone, true).streak, 2,
  'One-tap different opening must charge the existing real +15% combo');
assert.equal(pve.nextComboOpening('head', ['head', 'chest', 'belly', 'legs'], 'head'), 'head',
  'Malformed all-guarded input must not invent an opening');
const comboUi = source('../src/components/pve/PveFight.tsx');
assert.match(comboUi, /setAttack\(current => nextComboOpening\(/,
  'Visible opening button must use the combo-aware pure target selector');
assert.match(comboUi, /momentum\.streak === 1 \? momentum\.lastZone : null/,
  'Only an earned 1\/2 combo can influence the opening suggestion');

assert.equal(pve.coverThreatZone(['head'], 'head').join(','), 'head', 'Covering twice is idempotent');
assert.equal(pve.coverThreatZone(['head'], 'belly').join(','), 'head,belly', 'Keep the first selected defense');
assert.equal(pve.coverThreatZone(['head', 'legs'], 'chest').join(','), 'legs,chest', 'Replace only the oldest defense');
// A perfect manual guard followed by a landed open leg riposte can stagger
// an elite for ONE round. The displayed guard and resolver must agree; no
// rerolled enemy attack, fake loot, permanent debuff or auto-battle bonus.
const staggeredIntent = pve.staggerEnemyGuard(visibleGuard, true);
assert.equal(staggeredIntent.attack, visibleGuard.attack, 'Stagger cannot secretly change the announced enemy attack');
assert.equal(staggeredIntent.blocks.join(','), 'head', 'Stagger removes exactly the second guard');
assert.equal(pve.staggerEnemyGuard(visibleGuard, false), visibleGuard, 'No earned stagger leaves the guard untouched');
assert.equal(pve.staggerEnemyGuard(staggeredIntent, true), staggeredIntent, 'Stagger cannot remove the last guard');
const guardBeforeStagger = pve.playRound(starterHero, guardEnemy, 'chest', [], 0, '', 0, null, visibleGuard);
const guardAfterStagger = pve.playRound(starterHero, guardEnemy, 'chest', [], 0, '', 0, null, staggeredIntent);
assert.equal(guardBeforeStagger.hits[0].tone, 'block', 'Second guard normally protects the chest');
assert.equal(guardAfterStagger.hits[0].tone, 'hit', 'Staggered second guard must be a REAL opening in playRound');
assert(guardAfterStagger.enemy.hp < guardEnemy.hp, 'The opening must deal actual HP damage');
assert.equal(pve.staggerEnemyGuard(visibleGuard, false).blocks.length, 2, 'Next round restores the regular guard');

const counterAttack = pve.nextOpenStrike('head', visibleGuard.blocks);
assert(!visibleGuard.blocks.includes(counterAttack), 'Opening must not pick the hidden second guard');
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
// The existing elite encounter gets a genuinely adaptive second phase.
const phaseRoll = { attack: 'chest', blocks: ['head', 'belly'] };
const phaseOne = pve.nextAdaptiveEnemyIntent({ hp: 251, maxHp: 500 }, 'legs', true, phaseRoll);
assert.equal(phaseOne.adapted, false);
assert.equal(phaseOne.intent.blocks[0], 'head');
const ordinary = pve.nextAdaptiveEnemyIntent({ hp: 200, maxHp: 500 }, 'legs', false, phaseRoll);
assert.equal(ordinary.adapted, false, 'Normal enemies must keep their current AI');
const phaseTwo = pve.nextAdaptiveEnemyIntent({ hp: 250, maxHp: 500 }, 'legs', true, phaseRoll);
assert.equal(phaseTwo.adapted, true);
assert.equal(phaseTwo.intent.blocks[0], 'legs', 'Elite must guard the last strike');
assert.equal(phaseTwo.intent.attack, 'chest', 'The actual announced attack is unchanged');
assert.equal(phaseTwo.phase, 2, 'Half-HP elite remains in phase II');
assert.equal(new Set(phaseTwo.intent.blocks).size, 2, 'Guard zones stay distinct');
const phaseBlocked = pve.playRound(starterHero, { ...guardEnemy, hp: 250 }, 'legs', [], 0, '', 0, null, phaseTwo.intent);
const phaseOpeningTarget = pve.nextOpenStrike('legs', phaseTwo.intent.blocks);
assert(!phaseTwo.intent.blocks.includes(phaseOpeningTarget), 'Phase II must expose a real opening');
const phaseOpening = pve.playRound(starterHero, { ...guardEnemy, hp: 250 }, phaseOpeningTarget, [], 0, '', 0, null, phaseTwo.intent);
assert.equal(phaseBlocked.hits[0].tone, 'block', 'Repeating a remembered strike must really be blocked');
assert.equal(phaseOpening.hits[0].tone, 'hit', 'Changing attack zones must really beat the guard');
assert.equal(pve.nextAdaptiveEnemyIntent({ hp: 0, maxHp: 500 }, 'legs', true, phaseRoll).adapted, false);
// Phase III remembers two distinct *resolved* hero attacks below 25% HP.
// Both advertised guards must actually block; the other two zones stay open.
const phaseThree = pve.nextAdaptiveEnemyIntent({ hp: 125, maxHp: 500 }, 'legs', true, phaseRoll, 'head');
assert.equal(phaseThree.phase, 3, 'Quarter-HP elite with two distinct attacks enters phase III');
assert.equal(phaseThree.intent.blocks.join(','), 'legs,head', 'Phase III covers exactly the last two distinct attacks');
assert.equal(phaseThree.intent.attack, phaseRoll.attack, 'Phase III must not invent a new telegraphed attack');
assert.equal(new Set(phaseThree.intent.blocks).size, 2, 'Phase III never creates a duplicate or third guard');
for (const defended of phaseThree.intent.blocks) {
  const round = pve.playRound(starterHero, { ...guardEnemy, hp: 125 }, defended, [], 0, '', 0, null, phaseThree.intent);
  assert.equal(round.hits[0].tone, 'block', 'Phase III remembered zone must really block: ' + defended);
  assert.equal(round.enemy.hp, 125, 'Blocked phase III strike cannot leak damage');
}
for (const opening of zones.filter(z => !phaseThree.intent.blocks.includes(z.id))) {
  const round = pve.playRound(starterHero, { ...guardEnemy, hp: 125 }, opening.id, [], 0, '', 0, null, phaseThree.intent);
  assert.equal(round.hits[0].tone, 'hit', 'Phase III opening must remain hittable: ' + opening.id);
  assert(round.enemy.hp < 125, 'Phase III opening must lower actual HP');
}
assert.equal(pve.nextAdaptiveEnemyIntent({ hp: 126, maxHp: 500 }, 'legs', true, phaseRoll, 'head').phase, 2,
  'Phase III cannot begin above quarter HP');
assert.equal(pve.nextAdaptiveEnemyIntent({ hp: 125, maxHp: 500 }, 'legs', true, phaseRoll).phase, 2,
  'Missing attack history must not invent a second remembered zone');
assert.equal(pve.nextAdaptiveEnemyIntent({ hp: 125, maxHp: 500 }, 'legs', true, phaseRoll, 'legs').phase, 2,
  'Repeating the same attack must not create duplicate guards');
assert.equal(pve.nextAdaptiveEnemyIntent({ hp: 125, maxHp: 500 }, 'legs', false, phaseRoll, 'head').phase, 1,
  'Ordinary enemies must never gain elite phase III');
// Regression: a player repeating the same strike cannot reset a phase-III
// boss to phase II. Keep the last two DISTINCT resolved directions across
// multiple rounds, and update the older direction only when tactics change.
let remembered = [];
for (const resolved of ['head', 'legs', 'legs', 'legs']) {
  remembered = pve.rememberDistinctHeroAttacks(remembered, resolved);
}
assert.equal(remembered.join(','), 'legs,head', 'Repeated strikes must retain the previous distinct attack');
const repeatPhase = pve.nextAdaptiveEnemyIntent(
  { hp: 100, maxHp: 500 }, remembered[0], true, phaseRoll, remembered[1]);
assert.equal(repeatPhase.phase, 3, 'Repeating a strike must not downgrade a phase-III boss');
assert.equal(repeatPhase.intent.blocks.join(','), 'legs,head', 'Both learned guards must remain real');
remembered = pve.rememberDistinctHeroAttacks(remembered, 'belly');
assert.equal(remembered.join(','), 'belly,legs', 'A changed tactic must replace only the oldest distinct zone');
const changedPhase = pve.nextAdaptiveEnemyIntent(
  { hp: 100, maxHp: 500 }, remembered[0], true, phaseRoll, remembered[1]);
assert.equal(changedPhase.intent.blocks.join(','), 'belly,legs', 'Boss must react to the newest two distinct zones');
assert.equal(pve.rememberDistinctHeroAttacks([], 'head').join(','), 'head',
  'A first attack must not fabricate a second guard');

// A lethal hit reports only the remaining HP, not an imaginary overkill amount.
const overkillRound = pve.playRound({ ...starterHero, hp: 7, attack: 1, defense: 0 },
  { ...guardEnemy, attack: 200 }, 'legs', [], 0, '', 0, null,
  { attack: 'chest', blocks: ['head', 'belly'] });
assert.equal(overkillRound.hero.hp, 0);
assert.equal(pve.summarizePveRound(overkillRound.hits).takenDamage, 7);
// Earned riposte is resolved by the SAME battle engine: it is not a fake
// visual buff, and a boss damage cap still applies to hero + follower.
const baselineRiposte = pve.playRound(starterHero, guardEnemy, 'legs', ['chest', 'head'], 0, '', 0, null, threatIntent);
const boostedRiposte = pve.playRound(starterHero, guardEnemy, 'legs', ['chest', 'head'], 0, '', 0, null, threatIntent, true);
assert.equal(pve.summarizePveRound(baselineRiposte.hits).enemyStrike, 'block', 'Only an actual block can earn the next riposte');
assert(boostedRiposte.hits[0].amount > baselineRiposte.hits[0].amount, 'Riposte must increase actual enemy HP damage');
assert.equal(guardEnemy.hp - boostedRiposte.enemy.hp, boostedRiposte.hits[0].amount);
const blockedRiposte = pve.playRound(starterHero, guardEnemy, 'head', ['chest', 'head'], 0, '', 0, null, threatIntent, true);
assert.equal(blockedRiposte.hits[0].amount, 0, 'Riposte cannot bypass the enemy guard');
const cappedRiposte = pve.playRound(hero, { ...guardEnemy, hp: 1000, maxHp: 1000, enemyId: 'ch10_boss', isBoss: true },
  'legs', [], 100000, 'Follower', 0, null, threatIntent, true);
assert.equal(cappedRiposte.hits.filter(hit => hit.targetSide === 'enemy').reduce((sum, hit) => sum + hit.amount, 0), 400,
  'Riposte cannot exceed the existing elite per-round cap');

// Two DIFFERENT landed manual strikes earn a one-use combo. A repeated zone,
// dodge, block or auto round never grants it. The real resolver consumes it.
const emptyMomentum = { lastZone: null, streak: 0 };
const firstMomentum = pve.nextTacticalMomentum(emptyMomentum, 'head', 'hit', true);
assert.equal(firstMomentum.streak, 1);
const chargedMomentum = pve.nextTacticalMomentum(firstMomentum, 'legs', 'crit', true);
assert.equal(chargedMomentum.streak, 2, 'Distinct confirmed strikes must charge the combo');
assert.equal(pve.nextTacticalMomentum(firstMomentum, 'head', 'hit', true).streak, 1,
  'Repeated direction cannot charge the combo');
for (const outcome of ['block', 'dodge', null]) {
  assert.equal(pve.nextTacticalMomentum(firstMomentum, 'legs', outcome, true).streak, 0,
    'Only real landed hits may charge the combo');
}
assert.equal(pve.nextTacticalMomentum(firstMomentum, 'legs', 'hit', false).streak, 0,
  'Auto and ordinary enemies must not earn combo power');
assert.equal(pve.nextTacticalMomentum(chargedMomentum, 'belly', 'hit', true).streak, 1,
  'Charged strike must consume the one-use boost and start a new chain');
// The visible message says NEXT LANDED hit, not next attempted attack.
// A defended or dodged strike cannot waste the earned combo. It remains
// charged until one successful manual elite hit, and never carries into auto.
for (const missed of ['block', 'dodge', null]) {
  const retained = pve.nextTacticalMomentum(chargedMomentum, 'head', missed, true);
  assert.equal(retained.streak, 2, 'A missed charged strike must preserve the one-use bonus');
  assert.equal(retained.lastZone, chargedMomentum.lastZone, 'A miss cannot rewrite the charged combo history');
  const consumed = pve.nextTacticalMomentum(retained, 'belly', 'hit', true);
  assert.equal(consumed.streak, 1, 'First landed hit after a miss must consume the charge');
  assert.equal(consumed.lastZone, 'belly', 'Successful charged hit starts a fresh chain');
}
assert.equal(pve.nextTacticalMomentum(chargedMomentum, 'belly', 'block', false).streak, 0,
  'Switching to auto or ordinary combat must clear any manual combo charge');
const normalComboStrike = pve.playRound(starterHero, guardEnemy, 'legs', [], 0, '', 0, null, visibleGuard, false, false);
const poweredComboStrike = pve.playRound(starterHero, guardEnemy, 'legs', [], 0, '', 0, null, visibleGuard, false, true);
assert(poweredComboStrike.hits[0].amount > normalComboStrike.hits[0].amount,
  'Earned combo must change REAL enemy HP damage');
assert.equal(guardEnemy.hp - poweredComboStrike.enemy.hp, poweredComboStrike.hits[0].amount);
const blockedComboStrike = pve.playRound(starterHero, guardEnemy, 'head', [], 0, '', 0, null, visibleGuard, false, true);
assert.equal(blockedComboStrike.hits[0].amount, 0, 'Combo cannot bypass a guarded zone');
const cappedComboStrike = pve.playRound(hero,
  { ...guardEnemy, hp: 1000, maxHp: 1000, enemyId: 'ch10_boss', isBoss: true },
  'legs', [], 100000, 'Follower', 0, null, threatIntent, true, true);
assert.equal(cappedComboStrike.hits.filter(hit => hit.targetSide === 'enemy').reduce((sum, hit) => sum + hit.amount, 0), 400,
  'Stacked riposte + combo cannot bypass the existing boss damage cap');

// Staged rune combat must preserve old damage when no verified snapshot exists.
// These are actual resolved HP effects, not decorative UI text.
const noRuneAttack = pve.playRound(starterHero, guardEnemy, 'legs', [], 0, '', 0, null, visibleGuard);
const runeAttack = pve.playRound(starterHero, guardEnemy, 'legs', [], 0, '', 0, null, visibleGuard,
  false, false, { damage_bonus_bp: 1200 });
assert(runeAttack.hits[0].amount > noRuneAttack.hits[0].amount, 'Rune damage must change real enemy HP');
assert.equal(guardEnemy.hp - runeAttack.enemy.hp, runeAttack.hits[0].amount);
const noRuneGuard = pve.playRound(starterHero, { ...guardEnemy, attack: 120 }, 'legs', [], 0, '', 0,
  null, visibleGuard);
const withRuneGuard = pve.playRound(starterHero, { ...guardEnemy, attack: 120 }, 'legs', [], 0, '', 0,
  null, visibleGuard, false, false, { guard_absorb_bp: 1500 });
assert(withRuneGuard.hits.find(h => h.targetSide === 'hero').amount <
  noRuneGuard.hits.find(h => h.targetSide === 'hero').amount, 'Rune guard must reduce actual HP loss');
const noRuneCrit = pve.playRound({ ...starterHero, critChance: 30 }, guardEnemy, 'legs', [], 0, '', 0, null, visibleGuard);
const withRuneCrit = pve.playRound({ ...starterHero, critChance: 30 }, guardEnemy, 'legs', [], 0, '', 0,
  null, visibleGuard, false, false, { crit_chance_bp: 2500 });
assert.equal(noRuneCrit.hits[0].tone, 'hit');
assert.equal(withRuneCrit.hits[0].tone, 'crit', 'Rune critical chance must alter a resolved strike');
const blockedRune = pve.playRound(starterHero, guardEnemy, 'head', [], 0, '', 0, null, visibleGuard,
  false, false, { damage_bonus_bp: 2500, damage_vs_guard_bp: 2500 });
assert.equal(blockedRune.hits[0].amount, 0, 'Rune damage cannot pierce a real noncritical block');
// More server-defined runes now alter battle resolution, not just tooltips.
const armoredEnemy = { ...guardEnemy, defense: 120 };
const armorBaseline = pve.playRound(starterHero, armoredEnemy, 'legs', [], 0, '', 0, null, visibleGuard);
const armorPierced = pve.playRound(starterHero, armoredEnemy, 'legs', [], 0, '', 0, null, visibleGuard,
  false, false, { armor_pen_bp: 2500 });
assert(armorPierced.hits[0].amount > armorBaseline.hits[0].amount,
  'Armor penetration must increase real damage without changing the enemy equipment');
assert.equal(armoredEnemy.defense, 120, 'Rune armor piercing must not mutate the original opponent');
const finishingEnemy = { ...guardEnemy, hp: 140, maxHp: 500 };
const finisherBaseline = pve.playRound(starterHero, finishingEnemy, 'legs', [], 0, '', 0, null, visibleGuard);
const finisherRune = pve.playRound(starterHero, finishingEnemy, 'legs', [], 0, '', 0, null, visibleGuard,
  false, false, { finisher_damage_bp: 2000 });
assert(finisherRune.hits[0].amount > finisherBaseline.hits[0].amount,
  'Finisher rune must change HP damage below 30 percent enemy health');
const healthyEnemy = { ...guardEnemy, hp: 300, maxHp: 500 };
const healthyBase = pve.playRound(starterHero, healthyEnemy, 'legs', [], 0, '', 0, null, visibleGuard);
const healthyFinisher = pve.playRound(starterHero, healthyEnemy, 'legs', [], 0, '', 0, null, visibleGuard,
  false, false, { finisher_damage_bp: 2000 });
assert.equal(healthyFinisher.hits[0].amount, healthyBase.hits[0].amount,
  'Finisher cannot boost damage outside its defined threshold');
const woundedHero = { ...starterHero, hp: 500, maxHp: 1000 };
const noRegen = pve.playRound(woundedHero, guardEnemy, 'legs', [], 0, '', 0, null, visibleGuard);
const runeRegen = pve.playRound(woundedHero, guardEnemy, 'legs', [], 0, '', 0, null, visibleGuard,
  false, false, { regen_bp: 1200 });
assert(runeRegen.hero.hp > noRegen.hero.hp && runeRegen.runeHealAmount > 0,
  'Rune regeneration must restore actual HP after the opponent attack');
assert.equal(runeRegen.healAmount, runeRegen.runeHealAmount,
  'A regeneration-only rune must not be falsely reported as follower healing');
const defeatedHero = { ...woundedHero, hp: 1 };
const noRevive = pve.playRound(defeatedHero, { ...guardEnemy, attack: 1000 }, 'legs', [], 0, '', 0,
  null, visibleGuard, false, false, { regen_bp: 2500 });
assert.equal(noRevive.hero.hp, 0, 'Regeneration must not resurrect a defeated hero');
assert.equal(noRevive.runeHealAmount, 0, 'No healing after a lethal enemy strike');
// An already-earned rune status persists between rounds (and only in this
// fight). Damage over time respects live enemy HP, blocks and elite caps.
const afflictedEnemy = { ...guardEnemy, hp: 1800, maxHp: 1800, attack: 120 };
const ailmentsBefore = { bleed: 2, burn: 1, slow: 2, root: 1 };
const withoutAilment = pve.playRound(woundedHero, afflictedEnemy, 'legs', [], 0, '', 0,
  null, visibleGuard, false, false, { dot_damage_bp: 2000 });
const withAilment = pve.playRound(woundedHero, afflictedEnemy, 'legs', [], 0, '', 0,
  null, visibleGuard, false, false, { dot_damage_bp: 2000, damage_vs_slow_bp: 800 }, ailmentsBefore);
const runeTick = withAilment.hits.find(hit => hit.source === 'rune');
assert(runeTick && runeTick.amount > 0, 'A bleeding/burning foe must take actual rune damage');
assert(withAilment.enemy.hp < withoutAilment.enemy.hp, 'Slow-bonus and DOT must lower enemy HP');
assert.equal(withAilment.hits.filter(hit => hit.targetSide === 'hero').length, 0,
  'An existing root prevents the next enemy strike');
assert.equal(withAilment.runeAilments.bleed, 1, 'Bleed lasts across rounds and then expires');
assert.equal(withAilment.runeAilments.root, 0, 'Root must expire instead of permanently disabling AI');
assert.deepEqual(ailmentsBefore, { bleed: 2, burn: 1, slow: 2, root: 1 },
  'Resolving a round must not mutate the previous status');
const withoutRunes = pve.playRound(woundedHero, afflictedEnemy, 'legs', [], 0, '', 0,
  null, visibleGuard, false, false, null, ailmentsBefore);
assert.equal(withoutRunes.hits.filter(hit => hit.source === 'rune').length, 0,
  'A fight without a verified rune snapshot cannot import stale rune effects');
assert(withoutRunes.hits.some(hit => hit.targetSide === 'hero'),
  'A rune-free enemy cannot be rooted by an unverified or stale ailment');
const cappedDotEnemy = { ...afflictedEnemy, enemyId: 'ch10_boss', isBoss: true };
const cappedRuneRound = pve.playRound(hero, cappedDotEnemy, 'legs', [], 100000, 'Follower', 0,
  null, visibleGuard, false, false, { dot_damage_bp: 2500 }, ailmentsBefore);
assert(cappedRuneRound.hits.filter(h => h.targetSide === 'enemy').reduce((sum,h) => sum + h.amount, 0) <=
  balance.eliteRoundDamageCap(cappedDotEnemy.enemyId,true,cappedDotEnemy.maxHp),
  'Rune DOT cannot exceed the same existing boss per-round damage cap');
// Deterministic chance-roll regression: a rune triggers only after a real
// landed attack, and the statuses are applied to a LATER round.
let chanceRolls = 0;
const procPve = load(source('../src/game/pve.ts'), pveDependencies, () => chanceRolls++ < 6 ? 0.5 : 0);
const procResult = procPve.playRound(starterHero, afflictedEnemy, 'legs', [], 0, '', 0,
  null, visibleGuard, false, false, {
    bleed_chance_bp: 1200, burn_chance_bp: 1200,
    slow_chance_bp: 1200, root_chance_bp: 1200,
    slow_duration_bp: 2000, root_duration_bp: 1000,
  });
assert(procResult.hits[0].amount > 0, 'Proc setup must include an actual landed strike');
assert.equal(procResult.runeAilments.bleed, 2, 'Bleeding requires a landed rune proc');
assert.equal(procResult.runeAilments.burn, 2, 'Burning requires a landed rune proc');
assert.equal(procResult.runeAilments.slow, 4, 'Slow duration rune must extend a proc');
assert.equal(procResult.runeAilments.root, 2, 'Root duration rune must extend a proc');
assert.equal(procResult.hits.filter(hit => hit.source === 'rune').length, 0,
  'New damage-over-time effects must wait until the following round');
const slowEnemy = { ...guardEnemy, hp: 1200, maxHp: 1200, attack: 210 };
const slowHero = { ...starterHero, hp: 800, maxHp: 800 };
const normalIncoming = pve.playRound(slowHero, slowEnemy, 'legs', [], 0, '', 0, null, visibleGuard);
const slowedIncoming = pve.playRound(slowHero, slowEnemy, 'legs', [], 0, '', 0, null, visibleGuard,
  false, false, { slow_duration_bp: 1000 }, {bleed:0,burn:0,slow:1,root:0});
assert(slowedIncoming.hero.hp > normalIncoming.hero.hp,
  'Slow must weaken enemy damage itself, even without a second synergy rune');
assert.match(source('../src/components/pve/PveFight.tsx'), /const RUNE_PVE_STAGED = import\.meta\.env\.VITE_TERRITORY_RUNES === 'enabled';/,
  'Player rune rollout must remain disabled until server cutover');
assert.match(source('../src/components/pve/PveFight.tsx'), /parseRuneServerStatus\(data, runeDefinitions\)/,
  'Rune effects must be sourced from a server-confirmed 15-slot status');
assert.match(source('../src/components/pve/PveFight.tsx'), /runeEffectsAtStart\.current = pinned/,
  'Rune effects must be frozen at battle entry, not loaded every round');

const fightSource = source('../src/components/pve/PveFight.tsx');
assert.match(fightSource, /rememberDistinctHeroAttacks\(recentDistinctHeroAttacks\.current, atk\)/,
  'Battle must update the two distinct directions only after the resolved round');
assert.match(fightSource, /attackHistory\[1\] \?\? null/,
  'Phase III must receive the older distinct direction, not simply the previous round');
assert.doesNotMatch(fightSource, /lastHeroAttack\.current = atk/,
  'The old one-round memory incorrectly downgrades phase III on repeated attacks');
assert.match(fightSource, /data-testid="pve-round-reaction"/, 'Show actual round feedback to manual PvE players');
assert.match(fightSource, /data-testid="pve-live-damage-totals"/, 'Show cumulative actual damage during the fight');
assert.match(fightSource, /data-testid="pve-riposte-ready"/, 'Show an earned manual riposte');
assert.match(fightSource, /data-testid="pve-tactical-momentum"/, 'Show real combo progress in the existing elite fight');
assert.match(fightSource, /setMomentum\(previous => nextTacticalMomentum\(previous, atk, report\.heroStrike, elite && !auto/, 'Combo must come from resolved hits, never guessed input');
assert.match(fightSource, /elite && !auto && momentum\.streak === 2, runeEffectsAtStart\.current, runeAilments\.current\)/, 'Only charged manual elite rounds receive the combo bonus');
assert.match(fightSource, /report\.enemyStrike === 'block'/, 'Only a real enemy block grants riposte');
assert.match(fightSource, /elite && !auto && riposteReady/, 'Auto cannot consume a fake manual riposte');
assert.match(fightSource, /setBattleTotals\(previous => \(\{[\s\S]*report\.dealtDamage/, 'Cumulative totals must come from resolved hits');
assert.match(fightSource, /data-testid="pve-surrender-confirm"/, 'Surrender must require an explicit second action');
assert.match(fightSource, /data-testid="pve-surrender-cancel"/, 'Players must be able to return to the same fight');
assert.match(fightSource, /data-testid="pve-surrender-accept"/, 'The surrender confirmation must be explicit');
assert.match(fightSource, /if \(roundFlight\.current \|\| done\.current\) return;/, 'Cannot concede during an unresolved round');
assert.match(fightSource, /const report = summarizePveRound\(res\.hits\);\s*setTacticalReport\(report\)/, 'Tactical feedback must come from resolved hits');
assert.match(fightSource, /setTacticalReport\(null\)/, 'Clear previous feedback during the next move');
assert.match(fightSource, /data-testid="pve-enemy-guard"/, 'Show the actual guard during classic manual combat');
assert.match(fightSource, /data-testid="pve-compact-tactics"/, 'Tactical instructions should fit in a single short strip, not block the arena');
assert.match(fightSource, /min-h-9 w-full items-center/, 'Compact combat buttons must remain tappable');
assert.match(fightSource, /kind !== 'trial' && !auto && !busy && tacticalReport/, 'Verbose round explanations remain Campaign-only and must not cover Trial controls');
assert.match(fightSource, /kind !== 'trial' && !auto && \(guardedZone \|\| showThreatTell\)/, 'Only Campaign manual fights may reveal an enemy strike or exact guard');
assert.match(fightSource, /blocks\.includes\(enemyIntent\.attack\)/, 'The warning reflects the selected defense');
assert.match(fightSource, /data-testid="pve-telegraphed-strike"/, 'Keep tactical next-strike direction for Campaign bosses only');
assert.match(fightSource, /data-testid="pve-choose-opening"/, 'The shown enemy guard must offer an actual manual attack choice');
assert.match(fightSource, /setAttack\(current => nextComboOpening\(\s*current, committedEnemyIntent\.blocks, momentum\.streak === 1 \? momentum\.lastZone : null,/,
  'Opening action must use both committed guards and only earned combo history');
assert.match(fightSource, /committedEnemyIntent\.blocks\.includes\(attack\)/,
  'Manual attack warning must recognize the second guarded zone too');
assert.match(fightSource, /const guardedZoneLabels = committedEnemyIntent\.blocks\.map\(/,
  'Show both actual enemy guard directions, not a misleading single guard');
assert.match(fightSource, /data-testid="pve-cover-threat"/, 'Trial and boss strike warning must offer a manual defense action');
assert.match(fightSource, /setBlocks\(current => coverThreatZone\(current, enemyIntent\.attack\)\)/, 'Threat action must select a real defensive zone');

assert.match(fightSource, /followerBonus\.defense, followerBonus, committedEnemyIntent, elite && !auto && riposteReady, elite && !auto && momentum\.streak === 2, runeEffectsAtStart\.current, runeAilments\.current\)/, 'Pass the displayed guard and earned manual riposte to the same PvE resolver');
assert.match(fightSource, /staggerEnemyGuard\(enemyIntent, staggerReady && !auto\)/, 'Only manual combat can consume the one-round stagger');
assert.match(fightSource, /setStaggerReady\(elite && !auto && riposteReady && atk === 'legs'/, 'Only a real manual elite leg riposte can earn stagger');
assert.match(fightSource, /!committedEnemyIntent\.blocks\.includes\(atk\)/, 'A guarded leg strike must not earn stagger');
assert.match(fightSource, /report\.heroStrike === 'hit' \|\| report\.heroStrike === 'crit'/, 'Only actual landed hits can earn stagger');
assert.match(fightSource, /data-testid="pve-staggered-guard"/, 'The real temporary guard change must be visible');
assert.match(fightSource, /nextComboOpening\(\s*current, committedEnemyIntent\.blocks,/, 'Combo target helper must use the actual staggered guard too');
assert.match(fightSource, /nextAdaptiveEnemyIntent\(res\.enemy, atk, kind === 'trial' \|\| !!enemy\.isBoss, undefined, attackHistory\[1\] \?\? null\)/,
  'Phase-II/III guard uses resolved HP and the two distinct resolved strikes');
assert.match(fightSource, /setEnemyIntent\(nextIntent\.intent\)/,
  'The next guard must be the committed intent used by combat');
assert.match(fightSource, /data-testid="pve-adaptive-guard"/,
  'The player must see the adaptive second phase');
assert.match(fightSource, /guardPhase === 3/, 'The player must see a distinct phase III warning');
assert.match(fightSource, /const attackHistory = rememberDistinctHeroAttacks\(recentDistinctHeroAttacks\.current, atk\);\s*recentDistinctHeroAttacks\.current = attackHistory;/,
  'Phase III memory must update two distinct resolved strikes from the actual submitted attack');
assert.match(fightSource, /setGuardPhase\(nextIntent\.phase\)/, 'The displayed phase must come from the same resolved intent');

const engine = source('../src/game/engine.ts');
const actions = source('../src/game/actions.ts');
assert(engine.includes('export const PVE_STONE_COST = 1;'), 'combat stone cost unchanged');
assert(engine.includes('winsNeeded: enemies.length'), 'chapter gates unchanged');
assert(actions.includes('currentChapter: nextChapter'), 'chapter progression remains victory-based');
assert(!engine.includes('Math.pow(1.15, num)'), 'no accidental exponential boss loot inflation');

const classicFight = source('../src/components/pve/PveFight.tsx');
assert.match(classicFight, /const roundFlight = useRef\(false\)/,
  'Classic campaign and trials need a synchronous one-round-at-a-time guard');
assert.match(classicFight, /if \(roundFlight\.current \|\| busy \|\| outcome \|\| confirmSurrender \|\| done\.current \|\| !alive\.current \|\| \(RUNE_PVE_STAGED && !runesReady\)\) return;/,
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
