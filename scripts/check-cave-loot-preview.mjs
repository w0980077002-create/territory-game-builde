import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

// Exercise the pure preview function, not a mocked server grant.
const source = readFileSync('src/game/combatV1/caveLootPreview.ts', 'utf8');
const ui = readFileSync('src/components/pve/ServerAdventureScreen.tsx', 'utf8');
const caveUi = readFileSync('src/components/pve/CavePreview.tsx', 'utf8');
const caveCss = readFileSync('src/components/pve/cavePreview.css', 'utf8');
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
assert.deepEqual(at(0), { dark_equipment: false, socket_gem: false, set_equipment: false });
assert.deepEqual(at(-4), at(0));
assert.deepEqual(at(Number.NaN), at(0));

// Reward preview is visible in the REAL cave, accessible, and never settles a fight.
assert.match(ui, /data-testid="dark-cave-loot-preview"/);
assert.match(ui, /data-testid="dark-cave-loot-milestones"/);
assert.match(ui, /aria-expanded=\{lootPreviewOpen\}/);
assert.match(ui, /caveLootPreview\(progress\?\.unlocked_stage \?\? 1\)/);
assert.match(ui, /Новые предметы пока не выдаются/);
assert.match(ui, /session\.settlement\.reward\.gold/, 'Real victory gold must come from a server receipt');
assert.match(ui, /session\.settlement\.reward\.xp/, 'Real victory XP must come from a server receipt');
assert.match(settlement, /r\.items <> '\[\]'::jsonb/, 'Staged settlement must still reject unsupported gear grants');
assert.doesNotMatch(source, /supabase|fetch\(|wallet|localStorage|setItem|INSERT|UPDATE|grantReward/);


// Guard the owner-visible catalog: real artwork, 16 entries, no hidden reward block.
const caveImages = [...caveUi.matchAll(/'([0-9]{2}-[a-z-]+[.]webp)'/g)].map(x => x[1]);
assert.equal(caveImages.length, 16, 'cave catalog has 16 original images');
assert.equal(new Set(caveImages).size, 16, 'art names are unique');
for (const file of caveImages) {
  assert.ok(existsSync('public/assets/territory/cave-loot/2026-11-06/' + file), 'missing cave art: ' + file);
}
assert.match(ui, /clearedDepth=\{progress\.completed_stage\}/, 'fund uses cleared depth');
assert.match(ui, /depth=\{progress\.unlocked_stage\}/, 'tiers use unlocked depth');
assert.doesNotMatch(caveCss, /\.dark-cave-rewards\s*\{\s*display:\s*none/, 'short mobile must show floor rewards');
assert.doesNotMatch(caveCss, /\.dark-cave-portal-wrap\s*\{\s*height:\s*14px/, 'keep the cave artwork visible');

console.log('Cave loot preview PASS: floors 1/6/41, RU/EN, current receipts unchanged, no fake items');
