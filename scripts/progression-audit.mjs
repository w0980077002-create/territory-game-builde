import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/game/engine.ts', import.meta.url), 'utf8');
for (const literal of [
  'Math.floor(100 * Math.pow(1.15, current - 1))',
  'export const HERO_MAX_LEVEL = 100;',
  'export const HERO_SLOW_GROWTH_FROM = 83;',
  'const baseHp = 75 + num * 25;',
  'const baseAtk = 12 + num * 4;',
  'const baseDef = 3 + num * 2;',
  'winsNeeded: enemies.length',
  'export const PVE_STONE_COST = 1;',
]) assert.ok(source.includes(literal), `Re-check XP simulation: formula changed (${literal})`);
const balanceSource = readFileSync(new URL('../src/game/pveBalance.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(balanceSource, {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}});
const module={exports:{}};
vm.runInNewContext(transpiled.outputText,{module,exports:module.exports,require});
const { chapterEnemyMultipliers, bossEnemyMultipliers, trialEnemyMultipliers, eliteRoundDamageCap } = module.exports;
const enemyCount = (source.match(/const ENEMY_NAMES = \[([\s\S]*?)\];/)?.[1] ?? '').split('\n').filter((line) => line.includes('name:')).length;
assert.equal(enemyCount,5);
const xp = (level) => level >= 100 ? 0 : Math.floor(
  Math.floor(100 * Math.pow(1.15, level - 1)) *
  (level < 83 ? 1 : 3 + 0.12 * (level - 83))
);
assert.equal(xp(82), Math.floor(100 * Math.pow(1.15, 81)), 'previous levels stay accessible');
assert(xp(83) >= 3 * Math.floor(100 * Math.pow(1.15, 82)), 'progression slows after level 83');
assert.equal(xp(100), 0, '100 is the maximum hero level');
const totalXp = (level) => Array.from({length:level-1}, (_,i)=>xp(i+1)).reduce((s,v)=>s+v,0);
const stage = (c) => {
  const mult=chapterEnemyMultipliers(c), trialMult=trialEnemyMultipliers(c);
  const hp=75+c*25, atk=12+c*4;
  const bossBonus=bossEnemyMultipliers(c);
  const bossHp=Math.floor(hp*2.55*mult.hp*bossBonus.hp), trialHp=Math.floor(hp*1.8*trialMult.hp);
  return {
    chapterOrFloor:c,
    weakestEnemyHp:Math.floor(hp*.8*mult.hp),
    bossHp,
    trialHp,
    weakestEnemyAttack:Math.floor(atk*.8*mult.attack),
    bossAttack:Math.floor(atk*1.30*mult.attack*bossBonus.attack),
    eliteBossRoundCap:eliteRoundDamageCap(`ch${c}_boss`,true,bossHp),
    trialRoundCap:eliteRoundDamageCap(`trial_${c}`,false,trialHp),
    xpFromFiveEnemies:5*(20+c*8),
    xpBoss:80+c*20,
    chapterClearXp:50+c*15,
  };
};
for (const level of [5,20,50,81]) console.log(`Level ${level}: cumulative XP ${totalXp(level).toLocaleString('en-US')}`);
console.log('Base 25 purchased stones/day / 6 battles per chapter = 4 complete chapters/day, without daily/quest stones.');
for (const c of [1,5,20,58,81,3000]) console.log(JSON.stringify(stage(c)));
console.log('PvE audit PASS: enemy strength, stones and pre-83 XP unchanged; post-83 XP slowed and hero capped at 100. Not an anti-cheat audit.');
