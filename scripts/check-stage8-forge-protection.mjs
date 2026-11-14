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
    name: 'Crafted sword', slot: 'weapon', rarity: 'rare', level: 23,
    baseLevel: 1, upgradeCount: 22, attack: 64, baseStats: { attack: 20 } },
};
const original = {
  player: { level: 61, gold: 555555, equipped: { weapon: serverItem.equipment } },
  forgeMaterials: 333, inventory: [serverItem],
};
const snapshot = JSON.stringify(original);

for (const id of [serverItem.id, 'equipped_' + serverItem.equipment.id]) {
  const out = forge.forgeAttempt(original, id, serverItem.equipment.level, 0);
  assert.equal(out.status, 'invalid', 'Server-owned crafted item must not enter legacy local forge');
  assert.strictEqual(out.next, original, 'No local game state update or resource debit');
  assert.equal(JSON.stringify(original), snapshot, 'No silent stat, gold or material mutation');
}
const screen = readFileSync('src/components/ForgeScreen.tsx', 'utf8');
assert.match(screen, /isStage8Gear\(item\.id\)/, 'Real UI handler must guard crafted items');
assert.match(screen, /isStage8Gear\(selectedCurrent\.id\) && !stage8ForgeReady/, 'Crafted upgrade must remain disabled until authenticated server RPC is confirmed');
assert.match(screen, /attemptStage8Forge\(userId,eq\.id,eq\.level\)/, 'Live crafted upgrade must use authoritative RPC');
assert.match(screen, /useGame\.set\(receipt\.state\)/, 'Verified server save replaces client preview');
assert.match(screen, /stage8-forge-server-pending/, 'Explicit explanation, not a fake successful forge');
const bridge=readFileSync('src/game/stage8ForgeApi.ts','utf8');
const sql=readFileSync('supabase/staged/territory_stage8_forge_v1.sql','utf8');
assert.match(bridge,/territory_stage8_forge_v1/);
assert.match(bridge,/territory_stage8_forge_ready_v1/);
assert.match(bridge,/acceptMonopolyClaimReceipt/);
assert.match(bridge,/operationId/);
assert.match(sql,/stage8_forge_receipts_v1/);
assert.match(sql,/auth\.uid\(\)/);
assert.match(sql,/FOR UPDATE/);
assert.match(sql,/operation_conflict/);
assert.match(sql,/UPDATE public\.territory_profession_stage8_items/);
assert.match(sql,/UPDATE public\.players/);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.territory_stage8_forge_v1/);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.territory_stage8_forge_v1/);
console.log('Stage8 forged items: legacy path stays closed; server path has receipt, owner lock, registry mirror and retry gate');
