import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const run=extra=>spawnSync(process.execPath,['scripts/build-monopoly-test.mjs'],{encoding:'utf8',env:{...process.env,VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',...extra}});
assert.notEqual(run({}).status,0);
for(const ref of ['wmyrdpbwlkzsktnhookx','ksikzkrvuuhermhnbycn']){
 assert.match(run({VITE_SUPABASE_URL:`https://${ref}.supabase.co`,VITE_SUPABASE_ANON_KEY:'sb_publishable_mock'}).stderr,/separate Supabase test project/);
}
assert.match(run({VITE_SUPABASE_URL:'https://new-test.supabase.co',VITE_SUPABASE_ANON_KEY:'sb_secret_mock'}).stderr,/Secret keys/);
const fakeService='x.'+Buffer.from(JSON.stringify({role:'service_role',ref:'new-test'})).toString('base64url')+'.x';
assert.match(run({VITE_SUPABASE_URL:'https://new-test.supabase.co',VITE_SUPABASE_ANON_KEY:fakeService}).stderr,/must be anon/);
console.log('Monopoly build guard PASS: absent settings, existing projects, secret and service_role keys refused.');

for(const file of ['gold-coin.webp','guardian.webp','hero.webp','ship.webp'])assert.ok(existsSync('public/monopoly/'+file),'Missing scoped Monopoly asset: '+file);
const screen=readFileSync('src/components/monopoly/MonopolyAdventure.tsx','utf8');
assert.doesNotMatch(screen,/\/assets\/territory\/|src="\/(?:gold-coin|hero)\.webp/,'Monopoly must not depend on shared assets removed from main');
