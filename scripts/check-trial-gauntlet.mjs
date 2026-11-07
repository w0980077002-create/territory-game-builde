import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';

const source = readFileSync('src/game/trialGauntlet.ts', 'utf8');
const js = await transform(source, { loader: 'ts', format: 'esm' });
const { buildTrialGauntlet, TRIAL_REGULAR_ENEMIES, TRIAL_ENCOUNTERS_PER_FLOOR } =
  await import('data:text/javascript;base64,' + Buffer.from(js.code).toString('base64'));

assert.equal(TRIAL_REGULAR_ENEMIES, 5);
assert.equal(TRIAL_ENCOUNTERS_PER_FLOOR, 6);
const hero = { name: 'Tester', hp: 2179, maxHp: 2179, attack: 790, defense: 447 };
for (const floor of [1, 2, 9, 10, 11, 100, 649, 3000]) {
  const guardian = {
    id: `trial_${floor}`,
    name: 'Страж испытаний',
    art: '/assets/territory/characters/bosses/barrow_guardian/idle.webp',
    hp: floor * 300 + 180,
    maxHp: floor * 300 + 180,
    attack: floor * 20 + 180,
    defense: floor * 12 + 150,
    isBoss: true,
    rewardGold: 12,
    rewardXp: 34,
  };
  const waves = buildTrialGauntlet(guardian, hero);
  assert.equal(waves.length, 6, `floor ${floor}: five normal enemies + boss`);
  assert.deepEqual(waves.map(w => w.isBoss), [false, false, false, false, false, true]);
  assert.equal(waves[5].name, guardian.name, `floor ${floor}: final guardian must be the boss`);
  assert.equal(new Set(waves.map(w => w.id)).size, 6, `floor ${floor}: distinct wave identities`);
  assert.ok(waves.every(w => Number.isFinite(w.maxHp) && w.maxHp > 0 && w.attack > 0));
  assert.ok(waves.every(w => w.rewardGold === 0 && w.rewardXp === 0),
    `floor ${floor}: no extra per-enemy rewards`);
  assert.ok(waves.every(w => w.id.startsWith(`trial_${floor}_wave_`)));
}
const code = readFileSync('src/components/pve/PveFight.tsx', 'utf8');
assert.match(code, /kind === 'trial' && waveIndex \+ 1 < trialWaves\.length/,
  'Normal enemies must advance within one fight, not advance the floor');
assert.match(code, /else finish\(true\);/,
  'Only final wave can award floor victory');
assert.match(code, /kind === 'trial' \? 1 : useGame\.get\(\)\.settings\.speed/,
  'Trials runs normal speed without changing shared settings');
assert.match(code, /\{kind !== 'trial' && <button\s+onClick=\{\(\) => setSettings\(\{ speed:/,
  'x2 speed button must not appear in Trials');
const panel = readFileSync('src/components/BattleScreen.tsx', 'utf8');
assert.match(panel, /1 этаж = 5 врагов \+ босс/,
  'Floor overview must describe its actual gauntlet');
console.log('Trial gauntlet PASS: 5 enemies + final boss per floor, one payout, x2 hidden in Trials');


// Standalone level-61 balance research. This executes the real TS combat,
// enemy generator and gauntlet functions with a seeded RNG; no live account
// or Supabase record is changed. Proposed one-stone-per-strike is modelled in
// memory and is NOT shipped by this test.
import { createRequire } from 'node:module';
import vm from 'node:vm';
const requireTS = createRequire(import.meta.url);
const ts = requireTS('typescript');
const tsSource = (path) => readFileSync(path, 'utf8');
function loadLiveTs(path, dependencies, random) {
  const compiled = ts.transpileModule(tsSource(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const patchedMath = Object.create(Math);
  patchedMath.random = random;
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports, Math: patchedMath,
    require: name => {
      if (!(name in dependencies)) throw new Error('Unexpected combat import ' + name);
      return dependencies[name];
    },
  }, { filename: path });
  return module.exports;
}
function seedRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const balance = loadLiveTs('src/game/pveBalance.ts', {}, Math.random);
const equipmentStats = { getComputedStats: state => state.player.stats };
const engine = loadLiveTs('src/game/engine.ts', {
  './equipmentBalance': { EQUIPMENT_BALANCE_VERSION: 1 },
  './followers': { initialFollowers: () => [] },
  './weeklyQuests': { calendarDayKey: () => '', weeklyQuestKey: () => '' },
  './pveBalance': balance,
  './equipmentCatalog': { SHOP_EQUIPMENT_ITEMS: [] },
}, Math.random);
const currentFight = tsSource('src/components/pve/PveFight.tsx');
const priceAtEntry = /const paid = spendStones\(s, PVE_STONE_COST\)/.test(tsSource('src/components/BattleScreen.tsx'));
assert(priceAtEntry, 'Baseline test expects live game still charges only one entry stone; change this test when design ships');

function simulateLevel61(seed, stock, stats, { defense = 'informed', maxFloor = 500 } = {}) {
  const random = seedRandom(seed);
  const zones = [
    { id: 'head', label: 'Голова', mult: 1.25 },
    { id: 'chest', label: 'Грудь', mult: 1 },
    { id: 'belly', label: 'Живот', mult: 1 },
    { id: 'legs', label: 'Ноги', mult: 0.85 },
  ];
  const pve = loadLiveTs('src/game/pve.ts', {
    './arenaApi': { ZONES: zones },
    './engine': equipmentStats,
    './pveBalance': balance,
    './followers': { followerCombat: () => ({}), selectedFollower: () => null },
    './forge': { forgeSetBonus: () => ({ hp: 0, attack: 0, defense: 0 }) },
    './elixirExpiry': { isElixirExpired: () => false },
  }, random);
  const trial = loadLiveTs('src/game/trialGauntlet.ts', {}, random);
  const companion = { role: 'pumpkin', attack: 150, defense: 0, heal: 16, crit: 0, pierce: 0 };
  const state = { player: { stats: stats, name: 'Level 61 test' } };
  const baseHero = pve.heroSide(state);
  let remaining = stock, complete = 0, strikes = 0, enemyKills = 0, damageTaken = 0;
  const perFloor = [];
  for (let floor = 1; floor <= maxFloor; floor++) {
    let hero = { ...baseHero };
    let floorStrikes = 0;
    const guardian = engine.generateTrial(floor);
    for (const enemy of trial.buildTrialGauntlet(guardian, hero)) {
      let foe = pve.enemySide(enemy);
      let intent = pve.randomZones();
      let momentum = { lastZone: null, streak: 0 };
      let riposteReady = false;
      let staggerReady = false;
      let attackHistory = [];
      while (foe.hp > 0 && hero.hp > 0) {
        if (remaining === 0) return { complete, stoppedOn: floor, wave: enemyKills % 6 + 1, strikes, spent: stock - remaining, reason: 'stones', perFloor };
        remaining -= 1; // hypothetical 1 submitted strike = 1 combat stone
        strikes++; floorStrikes++;
        const committed = pve.staggerEnemyGuard(intent, staggerReady);
        const atk = pve.nextComboOpening(null, committed.blocks, momentum.streak === 1 ? momentum.lastZone : null);
        let blocks;
        if (defense === 'informed') {
          blocks = [intent.attack, zones.find(z => z.id !== intent.attack).id];
        } else if (defense === 'uncertain') {
          const safe = zones.filter(z => z.id !== intent.attack)[Math.floor(random() * 3)].id;
          blocks = zones.filter(z => z.id !== safe).slice(0, 2).map(z => z.id);
        } else {
          const pool = zones.map(z => z.id);
          blocks = [pool.splice(Math.floor(random() * pool.length), 1)[0], pool.splice(Math.floor(random() * pool.length), 1)[0]];
        }
        const outcome = pve.playRound(hero, foe, atk, blocks, 150, 'Тыквенная ведьма', 0, companion, committed, riposteReady, momentum.streak === 2, null);
        const report = pve.summarizePveRound(outcome.hits);
        damageTaken += report.takenDamage;
        const newMomentum = pve.nextTacticalMomentum(momentum, atk, report.heroStrike, outcome.hero.hp > 0 && outcome.enemy.hp > 0);
        const newStagger = riposteReady && atk === 'legs' && !committed.blocks.includes(atk)
          && (report.heroStrike === 'hit' || report.heroStrike === 'crit') && outcome.enemy.hp > 0;
        const newRiposte = report.enemyStrike === 'block' && outcome.hero.hp > 0 && outcome.enemy.hp > 0;
        attackHistory = pve.rememberDistinctHeroAttacks(attackHistory, atk);
        const next = pve.nextAdaptiveEnemyIntent(outcome.enemy, atk, true, undefined, attackHistory[1] ?? null);
        ({ hero, enemy: foe } = outcome);
        intent = next.intent;
        momentum = newMomentum;
        staggerReady = newStagger;
        riposteReady = newRiposte;
      }
      if (hero.hp <= 0) return { complete, stoppedOn: floor, wave: enemyKills % 6 + 1, strikes, spent: stock - remaining, reason: 'death', perFloor, damageTaken };
      enemyKills++;
      if (remaining === 0 && enemyKills % 6 !== 0) return { complete, stoppedOn: floor, wave: enemyKills % 6 + 1, strikes, spent: stock - remaining, reason: 'stones', perFloor, damageTaken };
    }
    complete = floor;
    perFloor.push({ floor, strikes: floorStrikes, hp: hero.hp, spent: stock - remaining });
    if (remaining === 0) return { complete, stoppedOn: floor + 1, wave: 1, strikes, spent: stock - remaining, reason: 'stones', perFloor, damageTaken };
  }
  return { complete, stoppedOn: maxFloor+1, strikes, spent: stock-remaining, reason: 'limit', perFloor, damageTaken };
}
const equipped61 = [
  { maxHp: Math.round(1846 * 1.02), hp: Math.round(1846 * 1.02), attack: Math.round(605 * 1.04), defense: Math.round(318 * 1.03), critChance: 16, critDamage: 50 },
  { maxHp: Math.round(1854 * 1.02), hp: Math.round(1854 * 1.02), attack: Math.round(605 * 1.04), defense: Math.round(325 * 1.03), critChance: 16, critDamage: 50 },
];
for (const stock of [25, 100, 500, 831, 871]) {
  for (const mode of ['informed', 'uncertain']) {
    const samples = Array.from({ length: 60 }, (_, i) => simulateLevel61(1448 + i*997, stock, equipped61[i%2], { defense: mode }));
    const floors = samples.map(x=>x.complete).sort((a,b)=>a-b);
    const spent = samples.map(x=>x.spent).sort((a,b)=>a-b);
    const reasons = [...new Set(samples.map(x=>x.reason))].map(reason=>[reason, samples.filter(x=>x.reason===reason).length]);
    console.log('LEVEL61_SIM', JSON.stringify({ stock,mode,meanFloor: +(floors.reduce((a,b)=>a+b,0)/floors.length).toFixed(1), minFloor: floors[0],medianFloor:floors[Math.floor(floors.length/2)],maxFloor:floors.at(-1),medianSpent:spent[Math.floor(spent.length/2)],reasons }));
  }
}
const sample = simulateLevel61(20261107, 871, equipped61[0], { defense: 'informed' });
console.log('LEVEL61_EXAMPLE', JSON.stringify({ ...sample, perFloor: sample.perFloor.filter(x=>x.floor<=12 || x.floor>=sample.complete-2) }));
