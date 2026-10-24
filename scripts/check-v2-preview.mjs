// TERRITORY 2.0 offline preview checks. No production API calls.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const get = (path) => readFileSync(resolve(root, path), 'utf8');
const html = get('public/v2-preview.html');
const css = get('public/v2-preview.css');
const js = get('public/v2-preview.js');
const policy = get('src/v2/battleStonePolicy.ts');
const layout = get('src/v2/interfaceContract.ts');
const pipeline = get('.github/workflows/pages.yml');

execFileSync(process.execPath, ['--check', 'public/v2-preview.js'], { stdio: 'pipe' });
assert.match(html, /ТЕСТОВЫЙ МАКЕТ/);
assert.match(html, /data-view="Арена"/);
assert.match(html, /v2-orb-blue/);
assert.match(html, /v2-orb-red/);
assert.match(html, /v2-equipment/);
for (const text of ['Порт', 'Навыки', 'Приключение', 'Магазин']) {
  assert(html.includes(text), 'missing navigation: ' + text);
}
for (const text of ['Склад', 'Руны', 'Последователи']) {
  assert(js.includes(text), 'missing functional preview screen: ' + text);
}
for (const asset of [
  ...Array.from(html.matchAll(/(?:src|href)="\.\/([^"]+)"/g), match => match[1]),
  ...Array.from(css.matchAll(/url\(['"]?\.\/([^'")]+)['"]?\)/g), match => match[1]),
]) {
  assert(existsSync(resolve(root, 'public', asset)), 'preview asset is missing: ' + asset);
}
assert(!/fetch\s*\(|XMLHttpRequest|sendBeacon|supabase\./.test(js),
  'offline preview must not connect to real player account or database');
assert.match(policy, /campaignEnemyCost:\s*0/);
assert.match(policy, /campaignBossCost:\s*0/);
assert.match(policy, /specialRaidAutomaticDeduction:\s*false/);
assert.match(layout, /arenaButton:\s*'directlyAboveEnergyOrb'/);
assert.match(layout, /topRightEnergyBar:\s*false/);
assert.match(pipeline, /branches:\s*\[main\]/);
assert.match(pipeline, /if:\s*github\.ref == 'refs\/heads\/main'/);
console.log('TERRITORY 2.0 isolated preview assets, navigation, economy rules and production deployment guard OK');
