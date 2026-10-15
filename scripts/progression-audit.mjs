import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Deliberately no guesses about quest/event/VIP income. This is a baseline model
// anchored to the literal formulas in the currently shipped engine.ts.
const engine = readFileSync(new URL('../src/game/engine.ts', import.meta.url), 'utf8');
for (const literal of [
  'Math.floor(100 * Math.pow(1.15, level - 1))',
  'const baseHp = 75 + num * 25;',
  'const baseAtk = 12 + num * 4;',
  'const baseDef = 3 + num * 2;',
  'winsNeeded: enemies.length',
  'export const PVE_STONE_COST = 1;',
]) assert.ok(engine.includes(literal), `Update simulation: engine formula changed (${literal})`);
const enemyCount = (engine.match(/const ENEMY_NAMES = \[([\s\S]*?)\];/)?.[1] ?? '').split('\n').filter((line) => line.includes("name:")).length;
assert.equal(enemyCount, 5, 'simulation assumes five regular enemies and one chapter boss');
const xp = (level) => Math.floor(100 * Math.pow(1.15, level - 1));
const totalXpForLevel = (level) => Array.from({ length: level - 1 }, (_, i) => xp(i + 1)).reduce((s, v) => s + v, 0);
const stage = (chapter) => ({
  chapter,
  regularEnemyHpMin: Math.floor((75 + chapter * 25) * 0.8),
  bossHp: Math.floor((75 + chapter * 25) * 2.2),
  regularAttackMin: Math.floor((12 + chapter * 4) * 0.8),
  bossAttack: Math.floor((12 + chapter * 4) * 1.15),
  xpFromFiveEnemies: 5 * (20 + chapter * 8),
  xpBoss: 80 + chapter * 20,
  chapterClearXp: 50 + chapter * 15,
});
for (const level of [5, 20, 50, 81]) console.log(`Level ${level}: cumulative XP ${totalXpForLevel(level).toLocaleString('en-US')}`);
console.log(`Base stone-only capacity with 25 purchased/day: ${Math.floor(25 / 6)} full chapters/day, assuming every battle wins (quests/daily extras excluded).`);
for (const c of [5, 20, 58, 81, 3000]) console.log(JSON.stringify(stage(c)));
console.log('Progression audit PASS: model matches current formulas; NO balance changes applied.');
