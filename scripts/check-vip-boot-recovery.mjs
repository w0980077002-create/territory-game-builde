import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';

const mocks={
  './actions':'export const useGame=globalThis.fixture.game;',
  './cloud':'export const saveBlocked=globalThis.fixture.blocked;',
  './vipDaily':'export const recoverVipDaily=globalThis.fixture.daily;',
  './vipWeekly':'export const recoverVipWeekly=globalThis.fixture.weekly;',
};
const result=await build({entryPoints:['src/game/vipBootRecovery.ts'],bundle:true,platform:'node',format:'esm',write:false,
  plugins:[{name:'mock-boot',setup(b){
    b.onResolve({filter:/^\.\/(actions|cloud|vipDaily|vipWeekly)$/},a=>({path:a.path,namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}));
  }}]});
const storage=new Map(), calls=[], blocked=new Set();
let current=null, failDaily=false;
globalThis.window={localStorage:{getItem:key=>storage.get(key) ?? null}};
globalThis.fixture={blocked,game:{get:()=>current,set:s=>{current=s;}},
  daily:async()=>{calls.push('daily');if(failDaily)throw new Error('network');current={...current,daily:true};},
  weekly:async()=>{calls.push('weekly');current={...current,weekly:true};}};
const {recoverVipClaimsOnBoot,hasPendingVipClaims}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const original={player:{gold:42}};
assert.equal(await recoverVipClaimsOnBoot('a',original),original);
assert.equal(current,null,'normal startup does not modify state');
storage.set('territory.vip.daily.pending.v1:a','pending');
storage.set('territory.vip.weekly.pending.v1:a','pending');
assert.equal(hasPendingVipClaims('a'),true);
assert.equal(hasPendingVipClaims('b'),false,'another player has no pending VIP operations');
assert.deepEqual(await recoverVipClaimsOnBoot('a',original),{...original,daily:true,weekly:true});
assert.deepEqual(calls,['daily','weekly'],'recover in sequence before gameplay');
calls.length=0;blocked.add('a');current=null;
await assert.rejects(recoverVipClaimsOnBoot('a',original),/other_recovery_pending/);
assert.equal(current,null,'another save fence is never released or replaced');
assert.deepEqual(calls,[]);
blocked.clear();failDaily=true;
await assert.rejects(recoverVipClaimsOnBoot('a',original),/network/);
assert.deepEqual(calls,['daily'],'failed recovery cannot continue to the next claim');
// Check the actual app invokes recovery before applying timed changes and enabling autosave.
const app=readFileSync('src/App.tsx','utf8');
const boot=app.indexOf('await recoverVipClaimsOnBoot(user.id, recovery.state)');
assert(boot>app.indexOf('await recoverPveVictoryOnBoot(user.id, profile)'));
assert(boot<app.indexOf('const timedState = applyTimeEffects(bootState)'));
assert(boot<app.indexOf('setLoaded(true)'));
console.log('VIP boot recovery: markers, ordering, player isolation and existing save fence: PASS');
