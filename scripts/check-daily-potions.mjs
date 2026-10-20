import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const req = createRequire(import.meta.url);
const ts = req('typescript');
const source = fs.readFileSync('src/game/progression.ts', 'utf8');
const ui = fs.readFileSync('src/components/home/HomeSheets.tsx', 'utf8');
const shop = fs.readFileSync('src/game/engine.ts', 'utf8');
const result = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  reportDiagnostics: true,
});
assert.equal((result.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0,
  'daily reward logic compiles without errors');
const exports = {};
const potion = {
  id: 'shop_potion_hp_large', name: 'Большое зелье здоровья', icon: '⚗️',
  type: 'potion', rarity: 'rare', description: 'Восстанавливает 150 HP мгновенно',
  effect: { stat: 'hp', value: 150, duration: 'instant' },
};
const dependencies = {
  './engine': { generateShopItems: () => [potion] },
  './actions': { grantRewards: () => { throw new Error('unrelated'); }, updateProgress: () => { throw new Error('unrelated'); } },
  './live': { useLive: { get: () => ({ goldX2: false }) } },
  './weeklyQuests': {
    calendarDayKey: (at) => new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at)),
    previousCalendarDayKey: (at) => {
      const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
      const [year, month, day] = date.split('-').map(Number);
      return new Date(Date.UTC(year,month-1,day-1)).toISOString().slice(0,10);
    }
  },
};
vm.runInNewContext(result.outputText, {
  module: { exports }, exports,
  require: (name) => {
    if (!(name in dependencies)) throw new Error('Unexpected import ' + name);
    return dependencies[name];
  },
  Date, Math, Error,
}, { filename: 'progression.transpiled.js' });
const { DAILY_REWARDS, claimDaily, dayKey } = exports;
const amount = (r) => r.largeHealthPotions ?? 0;
assert.equal(DAILY_REWARDS.length, 7, 'seven-day reward sequence preserved');
assert.equal(amount(DAILY_REWARDS[6]), 5, 'day seven grants five greater potions');
assert.equal(DAILY_REWARDS[6].redGems ?? 0, 0, 'no red diamond on day seven');
assert.equal(DAILY_REWARDS[6].gems, 15, 'original blue gem reward unchanged');
assert.equal(DAILY_REWARDS[6].stones, 5, 'original stone reward unchanged');
assert(DAILY_REWARDS.slice(0, 6).every(r => amount(r) === 0), 'other days unchanged');
assert.match(shop, /id: 'shop_potion_hp_large'/, 'existing shop potion item');
assert.match(shop, /name: 'Большое зелье здоровья'/, 'same potion name as game shop');
assert.match(shop, /effect: \{ stat: 'hp', value: 150, duration: 'instant' \}/,
  'five large potions restore 150 hp each');
const now = Date.parse('2026-10-18T12:00:00.000Z');
const yesterday = dayKey(now - 86_400_000);
const player = { gold: 100, gems: 20, redGems: 12 };
const state = { player, inventory: [], battleStones: 3, dailyReward: { streak: 6, lastDay: yesterday } };
const awarded = claimDaily(state, now);
assert(awarded, 'day seven must be claimable');
assert.equal(awarded.player.redGems, 12, 'existing red diamonds are preserved');
assert.equal(awarded.player.gems, 35);
assert.equal(awarded.battleStones, 8);
assert.equal(awarded.inventory.length, 1, 'new potion stack added');
assert.equal(awarded.inventory[0].qty, 5);
assert.equal(awarded.inventory[0].effect.value, 150);
assert.equal(awarded.inventory[0].type, 'potion');
assert.equal(claimDaily(awarded, now), null, 'no duplicate claim on same day');
const stacked = claimDaily({ ...state, inventory: [
  { id: 'existing', name: potion.name, type: 'potion', icon: potion.icon, qty: 3,
    rarity: potion.rarity, description: potion.description, effect: potion.effect },
]}, now);
assert.equal(stacked.inventory.length, 1, 'existing potions should stack');
assert.equal(stacked.inventory[0].id, 'existing', 'preserve existing stack ID');
assert.equal(stacked.inventory[0].qty, 8, 'three existing plus five earned');
assert.match(ui, /reward\.largeHealthPotions/, 'daily UI renders the new reward');
assert.match(ui, /<ItemArt item=\{LARGE_HEALTH_POTION\}/, 'daily UI shows potion art');
console.log('Daily reward regression PASS: five 150-HP potions on day 7, no red gems, one claim/day, stacked in inventory.');
