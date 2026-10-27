import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';

const files = ['nav-map.webp'];
let before = 0;
let after = 0;
for (const name of files) {
  const source = `public/${name}`;
  const published = `dist/${name}`;
  const originalSize = statSync(source).size;
  const optimized = readFileSync(published);
  assert.equal(optimized.toString('ascii', 0, 4), 'RIFF', `Real WebP RIFF header missing: ${name}`);
  assert.equal(optimized.toString('ascii', 8, 12), 'WEBP', `Actual WebP payload missing: ${name}`);
  assert.ok(optimized.length < originalSize, `Optimized ${name} is not smaller than the source`);
  before += originalSize;
  after += optimized.length;
}
assert.ok(after <= before * 0.5, `Expected meaningful mobile asset savings: ${before} -> ${after}`);
const rejected = [
  ...['m1', 'm2', 'm3', 'm4', 'm5', 'f1', 'f2', 'f3', 'f4', 'f5'].map(id => `appearance-${id}.webp`),
  ...['idle', 'attack', 'block', 'hit', 'death'].map(action => `male2-${action}.webp`),
  ...['goblin', 'troll', 'bandit', 'boar', 'wolf', 'viking'].map(enemy => `enemy-${enemy}.webp`),
  'arena-bg.webp',
  'file_0000000068ac8246bd64b2b0659b8243.png',
  'champion-preview.html',
];
for (const file of rejected) {
  assert.ok(!existsSync(`public/${file}`), `Rejected legacy artwork returned: ${file}`);
  assert.ok(!existsSync(`dist/${file}`), `Rejected legacy artwork was published: ${file}`);
}
console.log(`Pages art PASS: ${files.length} navigation asset optimized, ${(before/1048576).toFixed(1)} MB -> ${(after/1048576).toFixed(1)} MB; rejected art absent`);
