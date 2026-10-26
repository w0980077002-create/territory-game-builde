/** Offline owner grant limits contract; does not call production Supabase. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const edge = readFileSync('supabase/functions/admin-api/index.ts', 'utf8');
const mail = readFileSync('src/admin/tabs/MailTab.tsx', 'utf8');
const api = readFileSync('src/admin/api.ts', 'utf8');
const input = edge.slice(edge.indexOf('const RESOURCE_KEYS'), edge.indexOf('const db ='))
  + edge.slice(edge.indexOf('function intIn'), edge.indexOf('function playerId'));
const compiled = ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const sandbox = {
  HttpError: class HttpError extends Error {
    constructor(status, code) { super(code); this.status = status; }
  },
};
vm.runInNewContext(`${compiled}\nglobalThis.grants={cleanPayload,intIn};`, sandbox);
const { cleanPayload, intIn } = sandbox.grants;

assert.equal(cleanPayload({gold:500_000}).gold,500_000,'owner may grant 500k gold');
assert.equal(cleanPayload({gems:20_000_000}).gems,20_000_000,'remove former 10m cap');
assert.equal(cleanPayload({redGems:1_000_000_000}).redGems,1_000_000_000);
assert.equal(cleanPayload({forgeMaterials:2_147_483_647}).forgeMaterials,2_147_483_647);
assert.equal(cleanPayload({stones:-2_147_483_647}).stones,-2_147_483_647);
assert.equal(cleanPayload({items:{shop_elixir_atk:200_000_000}}).items.shop_elixir_atk,200_000_000);
assert.equal(cleanPayload({items:{shop_stone_5:429_496_729}}).items.shop_stone_5,429_496_729);

for(const bad of [2_147_483_648, -2_147_483_648, NaN, Infinity, 1.1]){
  assert.throws(()=>cleanPayload({gold:bad}),/invalid_number/);
  assert.throws(()=>intIn(bad,-2_147_483_647,2_147_483_647),/invalid_number/);
}
assert.throws(()=>cleanPayload({items:{shop_stone_5:429_496_730}}),/invalid_number/);

assert.match(edge,/case "hall_grant":/);
assert.match(edge,/intIn\(body\.amount,-MAX_STORED_NUMBER,MAX_STORED_NUMBER\)/);
assert.match(edge,/await db\.rpc\('territory_hall_admin_adjust_v2'/,'ticket grant remains server-side');
assert.match(edge,/verifyToken\(/,'owner session validation remains');
assert.match(mail,/maxAdminRewardQuantity\(slot\.key\)/,'mail UI applies storage bound per reward');
assert.doesNotMatch(mail,/qty > 100_000|max=\{100000\}/,'no arbitrary 100k limit');
assert.match(api,/MAX_ADMIN_REWARD_QUANTITY = 2_147_483_647/);
assert.match(api,/Math\.floor\(MAX_ADMIN_REWARD_QUANTITY \/ 5\)/);

console.log('ADMIN QUANTITY PASS: 500k gold, >10m resources, maximum int4 rewards, 5-stone bundles, auth unchanged, invalid overflow rejected.');
