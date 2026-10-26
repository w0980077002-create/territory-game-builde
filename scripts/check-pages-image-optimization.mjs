import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const files = [
  ...['m1','m2','m3','m4','m5','f1','f2','f3','f4','f5'].map(id => `appearance-${id}.webp`),
  'nav-map.webp',
];
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
console.log(`Pages art PASS: 11 real WebP files, ${(before/1048576).toFixed(1)} MB -> ${(after/1048576).toFixed(1)} MB`);
