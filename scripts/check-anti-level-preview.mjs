import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); } catch {
  const tsc = fs.realpathSync(execFileSync('which', ['tsc'], { encoding: 'utf8' }).trim());
  ts = require(path.resolve(path.dirname(tsc), '..', 'lib', 'typescript.js'));
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'territory-antilevel-'));
try {
  for (const file of ['equipmentCatalog.ts', 'equipmentBalance.ts', 'antiLevelPreview.ts']) {
    const src = fs.readFileSync(path.join('src/game', file), 'utf8');
    const result = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, reportDiagnostics: true });
    assert.equal((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
    fs.writeFileSync(path.join(out, file.replace('.ts', '.js')), result.outputText);
  }
  const { previewAntiLevel } = require(path.join(out, 'antiLevelPreview.js'));
  const owned = { id: 'crafted-uuid-50', name: 'Custom sword', icon: '⚔️', slot: 'weapon', rarity: 'rare',
    level: 50, baseLevel: 1, upgradeCount: 49, attack: 110, baseStats: { attack: 12 } };
  const original = structuredClone(owned);
  const estimate = previewAntiLevel(owned, 10);
  assert.equal(estimate.fromLevel, 50);
  assert.equal(estimate.toLevel, 10);
  assert.equal(estimate.removedLevels, 40);
  assert.equal(estimate.estimated.id, owned.id);
  assert.equal(estimate.estimated.rarity, owned.rarity);
  assert.ok(estimate.estimated.attack <= owned.attack);
  assert.deepEqual(owned, original, 'preview must not mutate or lower auction merchandise');
  assert.equal(previewAntiLevel(owned, 50), null);
  assert.equal(previewAntiLevel(owned, 60), null);
  assert.equal(previewAntiLevel(owned, 0), null);
  assert.equal(previewAntiLevel(owned, Number.NaN), null);
  const admin = previewAntiLevel({ ...owned, adminTestLevel: true }, 10);
  assert.equal(admin.estimated.level, 10, 'admin hint must not bypass the preview');
  console.log('Anti-Level non-spending preview checks passed.');
} finally { fs.rmSync(out, { recursive: true, force: true }); }
