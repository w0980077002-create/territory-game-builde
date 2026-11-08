import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const compiled = await build({
  entryPoints: [resolve('src/game/forge.ts')],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
});
const forge = await import('data:text/javascript;base64,' +
  Buffer.from(compiled.outputFiles[0].text).toString('base64'));

assert.equal(forge.isStage8Gear('stage8_22222222-2222-4222-8222-222222222222'), true);
assert.equal(forge.isStage8Gear('equipped_stage8_22222222-2222-4222-8222-222222222222'), true);
assert.equal(forge.isStage8Gear('ordinary-sword'), false);
assert.equal(forge.isStage8Gear('equipped_ordinary-sword'), false);

const serverItem = {
  id: 'stage8_22222222-2222-4222-8222-222222222222', name: 'Crafted sword',
  type: 'equipment', qty: 1, rarity: 'rare',
  equipment: { id: 'stage8_22222222-2222-4222-8222-222222222222',
    name: 'Crafted sword', slot: 'weapon', rarity: 'rare', level: 50,
    baseLevel: 1, upgradeCount: 49, attack: 118, baseStats: { attack: 20 } },
};
const original = {
  player: { level: 61, gold: 555555, equipped: { weapon: serverItem.equipment } },
  forgeMaterials: 333, inventory: [serverItem],
};
const snapshot = JSON.stringify(original);

for (const id of [serverItem.id, 'equipped_' + serverItem.equipment.id]) {
  const out = forge.forgeAttempt(original, id, 50, 0);
  assert.equal(out.status, 'invalid', 'Server-owned crafted item must not enter legacy local forge');
  assert.strictEqual(out.next, original, 'No local game state update or resource debit');
  assert.equal(JSON.stringify(original), snapshot, 'No silent stat, gold or material mutation');
}
const screen = readFileSync('src/components/ForgeScreen.tsx', 'utf8');
assert.match(screen, /isStage8Gear\(item\.id\)/, 'Real UI handler must guard crafted items');
assert.match(screen, /disabled=\{upgrading \|\| saveUnverified \|\| isStage8Gear\(selectedCurrent\.id\)/, 'Crafted item action must be disabled');
assert.match(screen, /stage8-forge-server-pending/, 'Explicit explanation, not a fake successful forge');
console.log('Stage8 forge fail-closed: no item downgrade, currency loss or local-only upgrade');
