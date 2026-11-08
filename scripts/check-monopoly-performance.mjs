import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const visual = read('src/components/monopoly/visuals.tsx');
const adventure = read('src/components/monopoly/MonopolyAdventure.tsx');
const converter = read('scripts/optimize-monopoly-images.mjs');
const packageJson = JSON.parse(read('package.json'));

assert.match(visual, /art-atlas\.webp/, 'All Monopoly sprites must share one optimized atlas in production');
assert.match(visual, /import\.meta\.env\.DEV/, 'Local dev keeps the original unmodified atlas');
assert.match(adventure, /monopoly\/lagoon\.\$\{import\.meta\.env\.DEV\?'png':'webp'\}/, 'Lagoon must use optimized WebP in production');
assert.match(adventure, /monopoly\/hero-frames\.\$\{import\.meta\.env\.DEV\?'png':'webp'\}/, 'Hero animation must use optimized WebP in production');
assert.match(adventure, /statusDay=useRef\(today\)/, 'No duplicate status requests on first mount');
assert.match(adventure, /if\(today===statusDay\.current\)return/, 'Status still updates at the daily reset');
// Regression: ×10 must advance the server board ten times, not multiply one prize.
assert.match(adventure, /const total=active\?1:choice===10\?10:1/, '×10 launches ten separate turns; resumed rounds stay single');
assert.match(adventure, /const rollValue=choice>100\?choice:1/, 'Batch mode requests ordinary one-ticket rolls');
assert.match(adventure, /for\(let i=0;i<total;i\+\+\)/, 'Execute each turn in order');
assert.match(adventure, /await monopoly\('roll',rollValue\)/, 'Server must charge one ticket per turn');
assert.match(adventure, /await monopoly\('finish',1,session.token\)/, 'Each turn must be finished before a new charge');
assert.match(adventure, /earned\+=finished\.result\?\.earned_gold\?\?0/, 'Batch reward uses actual receipts');
assert.match(adventure, /setBatch\(\{done:i,total\}\)/, 'Show true roll progress in the game');
assert.match(adventure, /prize=cellPrize\(i\)/, 'Board prizes cannot falsely preview ×10 multiplication');
assert.doesNotMatch(adventure, /monopoly\('roll',10\)|cellPrize\(i,ten\?10:1\)/, 'Legacy tenfold reward is not the ×10 UI action');
assert.match(adventure, /Количество бросков/, '×10 is labelled as roll count, not reward multiplier');
assert.equal(packageJson.scripts.build, 'vite build', 'Regular CI build must work before optional image conversion');
assert.match(converter, /execFileSync\('ffmpeg'/, 'Require explicit image conversion instead of renaming PNGs');
// Monopoly's isolated CI checks test:hall BEFORE npm run build.
// Source checks always run; byte-level verification runs after a build exists.
if (!process.argv.includes('--verify-assets')) {
  console.log('Monopoly source contract PASS (optimized assets verified during Pages deployment).');
  process.exit(0);
}
for (const name of ['art-atlas', 'lagoon', 'hero-frames']) {
  const png = 'public/monopoly/' + name + '.png';
  const webp = 'dist/monopoly/' + name + '.webp';
  assert.ok(existsSync(png), 'Original approved art missing: ' + png);
  assert.ok(existsSync(webp), 'Generated image missing from publish artifact: ' + webp);
  const buf = readFileSync(webp);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', 'WebP RIFF header required: ' + webp);
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP', 'WebP format signature required: ' + webp);
  assert.ok(statSync(webp).size < statSync(png).size, 'Optimized art must actually be smaller: ' + webp);
  console.log(name + ': ' + Math.round(statSync(png).size / 1024) + ' KB -> ' + Math.round(statSync(webp).size / 1024) + ' KB');
}
console.log('Monopoly images and request load PASS: approved artwork optimized and duplicate startup call eliminated.');
