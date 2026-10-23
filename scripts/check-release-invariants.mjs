import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const pages = read('.github/workflows/pages.yml');
const release = JSON.parse(read('economy-release.json'));
const app = read('src/App.tsx');
const cloud = read('src/game/cloud.ts');
const admin = read('supabase/functions/admin-api/index.ts');
assert(!existsSync(new URL('../.github/workflows/territory-pages-repair.yml', import.meta.url)),
  'A second deploy workflow could bypass the release gate');
for (const oldInstaller of [
  '.github/workflows/unpack-project.yml',
  '.github/workflows/import-bolt-zip.yml',
  '.github/workflows/territory-economy-install.yml',
  '.github/workflows/territory-economy-install-v2.yml',
]) {
  assert(!existsSync(new URL('../' + oldInstaller, import.meta.url)),
    'Legacy ZIP/Bolt installer must not be able to overwrite main: ' + oldInstaller);
}
assert.match(pages, /economy-release\.json/);
assert.match(pages, /if: needs\.build\.outputs\.economy_ready == 'true'/);
assert.equal(release.economy_hardened, false, 'A test release is not full protection');
assert.match(app, /\['battle', 'inventory', 'games', 'arena', 'hero'\]/,
  'Do not warm up 12 sections together on Android/iOS');
assert.match(admin, /territory_admin_credential_v2/);
assert.match(admin, /PASSWORD_ITERATIONS = 150_000/);
assert.match(admin, /MAX_FAILED_LOGINS = 8/);
assert.match(cloud, /\.update\(\{ \.\.\.columns, updated_at:/,
  'Direct client save is still present: DO NOT revoke player UPDATE yet');
console.log('Single gated Pages release; staged tests; mobile preloads and admin auth checks: PASS');
