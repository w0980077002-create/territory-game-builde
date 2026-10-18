import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadTs(file, mocks = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal((result.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  vm.runInNewContext(result.outputText, {
    module, exports: module.exports, Math, Date,
    require: (name) => {
      if (!(name in mocks)) throw new Error('unexpected dependency: ' + name);
      return mocks[name];
    },
  }, { filename: file });
  return module.exports;
}
const engine = loadTs('src/game/engine.ts', {
  './equipmentBalance': {}, './followers': {}, './weeklyQuests': {},
  './pveBalance': {}, './equipmentCatalog': {},
});
const actions = loadTs('src/game/actions.ts', {
  './store': { create: (s) => ({ get: () => s }) },
  './equipmentBalance': {}, './weeklyQuests': {},
  './followers': { reconcileFollowers: (followers) => followers },
  './purchaseGuard': {}, './engine': { ...engine, createInitialGame: () => ({}) },
});
assert.equal(engine.HERO_MAX_LEVEL, 100);
assert.equal(engine.HERO_SLOW_GROWTH_FROM, 83);
for (const lvl of [1, 25, 49, 50, 59, 82]) {
  assert.equal(engine.xpForLevel(lvl), Math.floor(100 * 1.15 ** (lvl - 1)),
    'unchanged catch-up progress at level ' + lvl);
}
assert.equal(engine.xpForLevel(82), 8251351, 'existing level 82 threshold remains valid');
assert(engine.xpForLevel(83) >= Math.floor(100 * 1.15 ** 82) * 3,
  '83-to-84 takes at least three times the previous requirement');
assert(engine.xpForLevel(90) > engine.xpForLevel(83), 'level 90 must be slower');
assert.equal(engine.xpForLevel(100), 0, 'max level has no XP requirement');
const state = (level, xp = 0) => ({
  player: {
    level, xp, xpToNext: engine.xpForLevel(level), maxEnergy: 100,
    stats: { hp: 500, maxHp: 500, attack: 100, defense: 40, critChance: 5, critDamage: 50 },
  }, followers: [],
});
const on82 = actions.addXp(state(82, engine.xpForLevel(82) - 1), 1);
assert.equal(on82.player.level, 83);
assert.equal(on82.player.xpToNext, engine.xpForLevel(83));
const slow = actions.addXp({ ...state(83), player: { ...state(83).player, xp: engine.xpForLevel(83) - 1 } }, 1);
assert.equal(slow.player.level, 84);
const max = actions.addXp(state(99), engine.xpForLevel(99) + 3_000_000_000);
assert.equal(max.player.level, 100, 'arbitrarily large XP cannot exceed 100');
assert.equal(max.player.xpToNext, 0);
assert.equal(max.player.xp, 0);
const maxAgain = actions.addXp({ ...state(100), player: { ...max.player } }, 100_000_000);
assert.equal(maxAgain.player.level, 100);
assert.equal(maxAgain.player.stats.attack, max.player.stats.attack, 'no post-cap stat farming');
assert.equal(maxAgain.player.stats.maxHp, max.player.stats.maxHp, 'no post-cap HP farming');
const home = fs.readFileSync('src/components/HomeScreen.tsx', 'utf8');
assert.match(home, /atMaxLevel \? 'MAX'/, 'max badge displayed in the XP meter');
assert.match(home, /atMaxLevel \? 100/, 'max bar stays full instead of NaN');
const sql = fs.readFileSync('supabase/migrations/20261018_hero_level_cap_100.sql', 'utf8');
assert.match(sql, /CHECK \(level BETWEEN 1 AND 100\)/, 'server limits stored levels');
assert.match(sql, /VALIDATE CONSTRAINT territory_hero_max_level_100/);

// Offline sample duel. Uses the current arena_resolve_round strike and block
// rules, random move choices, and the existing +10/+10/+15% potion effects.
// The aggregate fixtures are anonymized October 2026 snapshots, NOT live claims
// and NOT evidence that ordinary matchmaking permits 50-vs-82 matches.
function prng(seed) {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const zoneMultiplier = { head: 1.25, chest: 1, belly: 1, legs: 0.85 };
function duel(seed, potions) {
  const r = prng(seed);
  const a = { maxHp: 1605, hp: 1605, attack: 550, defense: 260, crit: 20 };
  const b = { maxHp: 2396, hp: 2396, attack: 800, defense: 428, crit: 15 };
  const zones = Object.keys(zoneMultiplier);
  const pick = () => zones[Math.floor(r() * zones.length)];
  const blocks = () => { const x = Math.floor(r() * 4); let y = Math.floor(r() * 3); if (y >= x) y++; return [zones[x], zones[y]]; };
  let heals = 0;
  for (let round = 0; round < 60; round++) {
    if (potions) {
      if (round === 0) a.crit += 15;
      else if (round === 1) a.attack += 10;
      else if (round === 2) a.defense += 10;
      else if (heals < 5 && a.hp < a.maxHp - 150) { a.hp = Math.min(a.maxHp, a.hp + 150); heals++; }
    }
    const strikes = [[a, b, pick(), blocks()], [b, a, pick(), blocks()]];
    if (r() < 0.5) strikes.reverse();
    for (const [from, to, zone, blockedZones] of strikes) {
      if (from.hp <= 0 || r() < 0.06) continue;
      const crit = r() * 100 < from.crit, blocked = blockedZones.includes(zone);
      let damage = Math.max(1, Math.round((from.attack * (0.85 + r() * 0.3) - to.defense * 0.5) * zoneMultiplier[zone]));
      if (blocked && !crit) continue;
      if (blocked) damage = Math.max(1, Math.round(damage * 0.8));
      else if (crit) damage = Math.round(damage * 1.6);
      to.hp = Math.max(0, to.hp - damage);
    }
    if (a.hp === 0 || b.hp === 0) break;
  }
  return a.hp > 0 && b.hp === 0;
}
let plainWins = 0, boostedWins = 0;
for (let seed = 1; seed <= 5000; seed++) {
  if (duel(seed, false)) plainWins++;
  if (duel(seed, true)) boostedWins++;
}
assert(boostedWins > plainWins * 2, 'potions should improve low-level upset chance');
assert(boostedWins > 300, 'potions permit meaningful (but not guaranteed) sample upsets');
const matchmaking = fs.readFileSync('supabase/migrations/20261017_fair_arena_matchmaking.sql', 'utf8');
assert.match(matchmaking, /abs\(greatest\(1, coalesce\(a_level, 1\)\)/,
  'keep the strict level window protecting new players');
console.log('Hero cap + XP slowdown passed. Simulated underdog wins /5000: no items=' + plainWins +
  ', potions=' + boostedWins + ' (hypothetical fights, matchmaking unchanged).');
