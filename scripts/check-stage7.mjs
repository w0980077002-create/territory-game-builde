import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../',import.meta.url);
const read = p => fs.readFileSync(new URL(p,root),'utf8');
const body = read('src/game/economyInvariant.ts');
const js = ts.transpileModule(body, {fileName:'economyInvariant.ts',compilerOptions:{module:ts.ModuleKind.CommonJS}});
const mod = {exports:{}};
vm.runInNewContext(js.outputText,{module:mod,exports:mod.exports});
const valid = mod.exports.validEconomySnapshot;
const state = {player:{gold:100,gems:10,level:5},battleStones:15,dailyStonesBought:24};
assert.equal(valid(state),true);
for(const [field, value] of [['gold',-1],['gems',1.5],['level',0],['gold',2**32],['gems',Number.NaN]]) {
  assert.equal(valid({...state,player:{...state.player,[field]:value}}),false,`invalid ${field}`);
}
for(const [field,value] of [['battleStones',-1],['dailyStonesBought',26],['battleStones',Infinity]]) {
  assert.equal(valid({...state,[field]:value}),false,`invalid ${field}`);
}
assert.equal(valid({...state,dailyStonesBought:undefined}),true,'historical saves remain migratable');
const sql=read('supabase/production/territory_economy_guard_20261015.sql');
for(const invariant of ['territory_invalid_game_state','territory_wallet_snapshot_mismatch',
 'territory_invalid_stone_counter','territory_economy_audit_v1','territory_economy_guard_before_v1',
 'territory_economy_audit_after_v1', 'REVOKE ALL ON TABLE public.territory_economy_audit_v1',
 'GREATEST(pg_catalog.clock_timestamp()', 'auth.uid()'])
 assert(sql.includes(invariant),`SQL missing ${invariant}`);
assert(!/UPDATE public\.players SET|DELETE FROM public\.players/i.test(sql),'must not rewrite existing player state');
assert(read('src/game/cloud.ts').includes('if (!validEconomySnapshot(state))'));
assert.equal(typeof JSON.parse(read('economy-release.json')).ready,'boolean','Economy release setting must be explicit; publishing is an owner decision');
console.log('Stage7: client/server invariant parity, wallet shape, timestamp, append-only audit, no reset: PASS');
