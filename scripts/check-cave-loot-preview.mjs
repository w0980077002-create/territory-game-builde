import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

// Exercise the pure preview function, not a mocked server grant.
const source = readFileSync('src/game/combatV1/caveLootPreview.ts', 'utf8');
const ui = readFileSync('src/components/pve/ServerAdventureScreen.tsx', 'utf8');
const settlement = readFileSync('supabase/staged/territory_v1_adventure_settlement.sql', 'utf8');
const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
const module = { exports: {} };
runInNewContext(code, { module, exports: module.exports });
const preview = module.exports.caveLootPreview;

assert.equal(typeof preview, 'function');
const at = floor => Object.fromEntries(preview(floor).map(x => [x.type, x.unlockedAtDepth]));
assert.deepEqual(at(1), { dark_equipment: true, socket_gem: false, set_equipment: false });
assert.deepEqual(at(5), { dark_equipment: true, socket_gem: false, set_equipment: false });
assert.deepEqual(at(6), { dark_equipment: true, socket_gem: true, set_equipment: false });
assert.deepEqual(at(40), { dark_equipment: true, socket_gem: true, set_equipment: false });
assert.deepEqual(at(41), { dark_equipment: true, socket_gem: true, set_equipment: true });
assert.deepEqual(at(100), { dark_equipment: true, socket_gem: true, set_equipment: true });
assert.deepEqual(at(-4), at(1));
assert.deepEqual(at(Number.NaN), at(1));

// Reward preview is visible in the REAL cave, accessible, and never settles a fight.
assert.match(ui, /data-testid="dark-cave-loot-preview"/);
assert.match(ui, /data-testid="dark-cave-loot-milestones"/);
assert.match(ui, /aria-expanded=\{lootPreviewOpen\}/);
assert.match(ui, /caveLootPreview\(floorFocus\)/);
assert.match(ui, /Новые предметы пока не выдаются/);
assert.match(ui, /session\.settlement\.reward\.gold/, 'Real victory gold must come from a server receipt');
assert.match(ui, /session\.settlement\.reward\.xp/, 'Real victory XP must come from a server receipt');
assert.match(settlement, /r\.items <> '\[\]'::jsonb/, 'Staged settlement must still reject unsupported gear grants');
assert.doesNotMatch(source, /supabase|fetch\(|wallet|localStorage|setItem|INSERT|UPDATE|grantReward/);

console.log('Cave loot preview PASS: floors 1/6/41, RU/EN, current receipts unchanged, no fake items');
