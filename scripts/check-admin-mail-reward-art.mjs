import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(path, 'utf8');
const visualsSource = read('src/game/mailRewardVisuals.ts');
const generated = ts.transpileModule(visualsSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
});
const sandbox = { exports: {} };
runInNewContext(generated.outputText, sandbox, { filename: 'mailRewardVisuals.js' });
const { mailRewardVisuals, MAIL_ITEM_VISUALS } = sandbox.exports;
assert.equal(typeof mailRewardVisuals, 'function');

const admin = read('src/admin/api.ts');
const resources = admin.match(/export const RESOURCES:[\s\S]*?\n];/)?.[0];
assert.ok(resources, 'Admin resource list is present');
const adminKeys = [...resources.matchAll(/key: '([^']+)', label:/g)].map((m) => m[1]);
const expected = [
  'gold', 'gems', 'redGems', 'stones', 'shop_stone_5', 'forgeMaterials',
  'shop_potion_hp', 'shop_potion_hp_large', 'shop_elixir_atk',
  'shop_elixir_def', 'shop_elixir_crit', 'shop_arena_time', 'shop_arena_adrenaline',
];
assert.equal(adminKeys.length, expected.length, 'Every admin grant type must be covered');
assert.deepEqual([...adminKeys].sort(), [...expected].sort(), 'Unexpected grant type in admin');
const visualItemKeys = Object.keys(MAIL_ITEM_VISUALS);
assert.equal(visualItemKeys.length, 7);
for (const key of expected) {
  const payload = key.startsWith('shop_') ? { items: { [key]: 2 } } : { [key]: 2 };
  const rewards = mailRewardVisuals(payload);
  assert.equal(rewards.length, 1, `Grant ${key} has exactly one visible badge`);
  assert.ok(rewards[0].amount > 0, `Grant ${key} has positive quantity`);
  assert.ok(existsSync('public/' + rewards[0].image), `Artwork missing: ${rewards[0].image}`);
}
const selected = mailRewardVisuals({ gems: 200, stones: 30, items: { shop_potion_hp_large: 20 } });
assert.equal(selected.length, 3, 'Existing letter should display three award icons');
const large = selected.find((r) => r.key === 'shop_potion_hp_large');
assert.equal(large?.amount, 20);
assert.equal(large?.image, 'potion-hp-large.webp');
const bundle = mailRewardVisuals({ stones: 2, items: { shop_stone_5: 4 } });
assert.equal(bundle.length, 1);
assert.equal(bundle[0].key, 'stones');
assert.equal(bundle[0].amount, 22, 'Bundles award five stones each');
const material = mailRewardVisuals({ forgeMaterials: 13 });
assert.equal(material[0].image, 'forge-material.webp', 'Forge materials must no longer disappear');
assert.equal(material[0].amount, 13);
assert.equal(mailRewardVisuals({ gems: 0, items: { shop_elixir_atk: -2 } }).length, 0);

const mail = read('src/components/home/HomeSheets.tsx');
assert.match(mail, /mailRewardVisuals\(m\.payload\)/);
assert.match(mail, /reward\.image/);
assert.match(mail, /reward\.amount/);
assert.doesNotMatch(mail, /grantItemsText\(/);
const art = read('src/game/art.ts');
assert.match(art, /e\.value >= 150/);
assert.match(art, /potion-hp-large\.webp/);
assert.match(read('src/components/home/HomeSheets.tsx'), /taps\.current\.count >= 5/, 'Five-tap admin entrance must remain untouched');
console.log('Mail rewards PASS: all 13 admin rewards, 3-icon existing letter, bundle x5, forge material, health potion art.');
