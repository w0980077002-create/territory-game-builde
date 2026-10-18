import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const sql = read('supabase/staged/territory_stage5_auction.sql');

// Intentionally staged and disabled. Do not mistake an isolated auction backend
// for hardened legacy currency, where players can still update game_state.
assert(!readdirSync(new URL('../supabase/migrations/', import.meta.url)).some(n => n.includes('stage5')),
  'Stage5 must NOT auto-run against live Supabase');
const gate = JSON.parse(read('economy-release.json'));
assert.equal(typeof gate.ready, 'boolean', 'Economy release setting must be explicit; publishing is an owner decision');
for (const required of [
  /ADD COLUMN IF NOT EXISTS auction_enabled boolean NOT NULL DEFAULT false/i,
  /IF NOT EXISTS\(SELECT 1 FROM public\.territory_release_flags_v1 WHERE id=1 AND auction_enabled\)/,
  /territory_wallet_v1[\s\S]*verified=true/,
  /auction_escrow IS NULL/,
  /item_id=p_item FOR UPDATE/,
  /status='open'/,
  /FOR UPDATE NOWAIT/,
  /pg_try_advisory_xact_lock/,
  /UPDATE public\.territory_auction_treasury_v1/,
  /v_fee := \(v_listing\.price_gold \+ 9\) \/ 10/,
  /PRIMARY KEY \(player_id,operation_id\)/,
  /IF v_old\.action IS DISTINCT FROM p_action OR v_old\.arguments IS DISTINCT FROM v_arguments/,
  /self_trade_forbidden/,
  /seller_wallet_overflow/,
  /REVOKE ALL ON public\.territory_auction_listings_v1 FROM PUBLIC, anon, authenticated/,
]) assert(required.test(sql), `Missing server auction invariant: ${required}`);
assert(!/GRANT (?:INSERT|UPDATE|DELETE|ALL) ON (?:TABLE )?public\.territory_auction_\w+ TO (?:anon|authenticated)/i.test(sql));
console.log('Stage5: disabled-by-default, escrow, transaction locks, wallet ownership, 10% fee, receipts: PASS');

const deps = { rpc: async () => { throw Error('Mock not set'); } };
const transpiled = ts.transpileModule(read('src/game/auctionApi.ts'), {
  fileName: 'src/game/auctionApi.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
});
assert.equal((transpiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const mod = { exports: {} };
vm.runInNewContext(transpiled.outputText, { module: mod, exports: mod.exports, require: () => ({ supabase: deps }) });
const api = mod.exports;
const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const W = '33333333-3333-4333-8333-333333333333';
const calls = [];
deps.rpc = async (fn, params) => { calls.push({ fn, params }); return { data: null, error: { code: 'PGRST202', message: 'not installed' } }; };
assert.equal(await api.fetchAuctionOverview(), null, 'graceful staging fallback');
deps.rpc = async () => ({ data: { enabled: false }, error: null });
assert.equal((await api.fetchAuctionOverview()).enabled, false);
deps.rpc = async () => ({ data: { enabled: true,
  lots: [
    { id: U, seller_id: V, item_id: W, price_gold: 25, seller: 'Knight', item: { name: 'Sword' }, created_at: '' },
    { id: V, seller_id: U, item_id: W, price_gold: -10 }, // invalid injection
  ], mine: [], items: [{ item_id: W, item: { name: 'Sword' } }], my_gold: 100,
}, error: null });
const overview = await api.fetchAuctionOverview();
assert.equal(overview.lots.length, 1);
assert.equal(overview.items.length, 1);
assert.equal(overview.myGold, 100);
let tradeAttempts = 0;
deps.rpc = async (fn, params) => {
  tradeAttempts++;
  calls.push({fn,params});
  return { data: { success: true, action: 'buy' }, error: null };
};
await api.submitAuctionAction({ action: 'buy', listingId: V }, U);
await api.submitAuctionAction({ action: 'buy', listingId: V }, U);
assert.equal(tradeAttempts, 2);
assert.equal(calls.at(-1).params.p_operation, calls.at(-2).params.p_operation);
assert.equal(calls.at(-1).params.p_listing, V);
await assert.rejects(api.submitAuctionAction({action:'list', itemId:W, priceGold:Infinity},U),/invalid_listing/);
await assert.rejects(api.submitAuctionAction({action:'list', itemId:W, priceGold:-1},U),/invalid_listing/);
assert.equal(tradeAttempts, 2, 'never submit invalid prices');
console.log('Stage5: API rejects malformed replies and prices, unavailable fallback, stable operation ID: PASS');

const sqlOther = read('supabase/staged/territory_stage3_backend.sql');
assert(sqlOther.includes('territory_crafted_items_v1') && sqlOther.includes('territory_wallet_v1') && sqlOther.includes('territory_release_flags_v1'));
for (const file of ['src/game/auctionApi.ts', 'src/components/AuctionScreen.tsx']) {
  const source = read(file);
  const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } });
  const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,`TS syntax: ${file} (${errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('; ')})`);
  for(const m of source.matchAll(/\bfrom ['"](\.[^'"]+)['"]/g)) {
    const base=join(dirname(new URL(file,root).pathname),m[1]);
    assert(['.ts','.tsx','.js',''].some(s=>existsSync(base+s)),`Missing import ${m[1]}`);
  }
}
const auctionUI = read('src/components/AuctionScreen.tsx');
assert(auctionUI.includes('pendingOperation') && auctionUI.includes('crypto.randomUUID()'));
assert(!auctionUI.includes('useGame.set('), 'market must not edit client game state');
console.log('Stage5: UI trade gating, no fake balances, no local game-state mutations: PASS');

const tokenTranspiled = ts.transpileModule(read('src/game/saveToken.ts'), {
  fileName: 'src/game/saveToken.ts', compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}, reportDiagnostics:true,
});
const tok = {exports:{}};
vm.runInNewContext(tokenTranspiled.outputText,{module:tok,exports:tok.exports});
const tokenLib = tok.exports;
const t0='2026-10-15T09:00:00.000Z';
assert.equal(tokenLib.nextSaveTimestamp(t0, Date.parse(t0)), '2026-10-15T09:00:00.001Z');
assert.equal(tokenLib.validSaveToken('garbage'), false);
const server={stamp:t0, state:null, writes:0};
const baseState={player:{name:'Hero',level:20,xp:5,gold:900,gems:2500,energy:3,maxEnergy:10,stats:{},equipped:{}},
 currentChapter:2,chapterWins:3,totalBattlesWon:5,totalBossesDefeated:1,forgeMaterials:1,
 inventory:[],followers:[],quests:[],achievements:[],settings:{},belt:[],dailyStonesDate:'',battleStones:15,dailyStonesBought:0};
server.state=baseState;
const db={
 from:()=>({
   select(_columns){return {eq(){return {maybeSingle: async()=>({data:{game_state:server.state, gold:server.state.player.gold,gems:server.state.player.gems, arena_rating:1000,arena_wins:0,arena_losses:0,display_name:'Hero',vip_level:3,photo_url:null,updated_at:server.stamp},error:null})};}};},
   update(payload){const filters=[];return {eq(col,val){filters.push([col,val]); return this;},select(){return this;}, async maybeSingle(){
     const compare=filters.find(([key])=>key==='updated_at');
     if (compare?.[1]!==server.stamp || filters.find(([key])=>key==='gold')?.[1]!==server.state.player.gold || filters.find(([key])=>key==='gems')?.[1]!==server.state.player.gems) return {data:null,error:null};
     server.state=payload.game_state;server.stamp=payload.updated_at;server.writes++;
     return {data:{updated_at:server.stamp,gold:server.state.player.gold,gems:server.state.player.gems},error:null};
   }};}
 })
};
const saveQ= {createCoalescingWriter: (write)=>write};
const walletParsed=ts.transpileModule(read('src/game/walletVersion.ts'),{
 fileName:'src/game/walletVersion.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},reportDiagnostics:true,
});
const walletModule={exports:{}};
vm.runInNewContext(walletParsed.outputText,{module:walletModule,exports:walletModule.exports,Number,Error});
const cloudMods={
 './walletVersion':walletModule.exports, './economyInvariant':{validEconomySnapshot: () => true},
 './supabase':{supabase:db}, './auth':{ensurePlayerSession:async()=>true}, './engine':{createInitialGame:()=>baseState,getComputedStats:()=>({attack:10,defense:10,maxHp:200,critChance:5})},
 './equipmentBalance':{EQUIPMENT_BALANCE_VERSION:1,migrateGameStateBalance:s=>s},
 './saveQueue':saveQ, './followers':{reconcileFollowers:f=>f}, './saveToken':tokenLib,
  './appearance':{getPlayableAppearance:id=> ['m1','m2','f1','f2'].includes(id) ? id : 'm2'},
};
const cloudParsed=ts.transpileModule(read('src/game/cloud.ts'),{
 fileName:'src/game/cloud.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},reportDiagnostics:true,
});
assert.equal((cloudParsed.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const cloud={exports:{}};
vm.runInNewContext(cloudParsed.outputText,{
 module:cloud,exports:cloud.exports,require:(path)=>{assert(path in cloudMods,`mock missing ${path}`);return cloudMods[path];},
 Date,Map,Set,console,
});
await cloud.exports.loadCloudSave(U,'Hero');
assert.equal(await cloud.exports.saveCloudSave(U,{...baseState,player:{...baseState.player,gold:901}}),true);
assert.equal(server.writes,1);
// Another device changed the row after this client last saved.
server.stamp='2026-10-15T09:05:00.000Z';
assert.equal(await cloud.exports.saveCloudSave(U,{...baseState,player:{...baseState.player,gold:999}}),false);
assert.equal(server.writes,1,'stale client may not overwrite current player data');
assert.equal(await cloud.exports.saveCloudSave(U,baseState),false,'conflict blocks later blind retries');
console.log('Stage5: optimistic legacy autosaves stop cross-device stale overwrites: PASS');
