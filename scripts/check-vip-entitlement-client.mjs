import assert from 'node:assert/strict';
import {build} from 'esbuild';

// The real source is bundled with only Supabase and the account store stubbed.
// Both feature flag states are checked; the live fallback must keep working.
const account={vip:0,permanentVip:0,paidVip:0,giftVip:0,paidSpendCents:0,
  entitlementVerified:false,vipUntil:null,vipRemaining:0,vipCheckedAt:0};
let writes=0, ledger=null, legacy=null, ledgerError=null, fortuneError=null;
const set=value=>{Object.assign(account,value);writes++;};
globalThis.__vipFixture={
  useAccount:{set},
  supabase:{rpc:async name=>{
    if(name==='territory_vip_entitlement_v1')return {data:ledger,error:ledgerError};
    if(name==='territory_fortune_entitlement_v1')return {data:legacy,error:fortuneError};
    throw new Error('Unexpected VIP RPC: '+name);
  }},
};
const stubs={
  './supabase':'export const supabase=globalThis.__vipFixture.supabase;',
  './actions':'export const useAccount=globalThis.__vipFixture.useAccount;',
};
async function bundle(enabled) {
  const built=await build({entryPoints:['src/game/fortuneVip.ts'],bundle:true,platform:'node',
    format:'esm',write:false,
    define:{'import.meta.env':JSON.stringify({VITE_VIP_ENTITLEMENTS_ENABLED:enabled?'true':'false'})},
    plugins:[{name:'fixtures',setup(b){
      b.onResolve({filter:/^\.\/(supabase|actions)$/},args=>({path:args.path,namespace:'vip-fixture'}));
      b.onLoad({filter:/.*/,namespace:'vip-fixture'},args=>({contents:stubs[args.path],loader:'js'}));
    }}]});
  return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
}
const api=await bundle(true);
const status=(x={})=>({
  vip:8,permanent_vip:5,legacy_vip:0,paid_vip:2,gift_vip:5,
  temporary_vip:8,temporary_until:'2026-11-05T12:00:00Z',
  server_now:'2026-11-05T10:00:00Z',paid_spend_cents:1000,...x,
});
legacy={vip:0,permanent_vip:0,vip_until:null,server_now:'2026-11-05T10:00:00Z'};
ledger=status();
assert.equal(api.parseServerVipStatus(ledger)?.giftVip,5);
assert.equal(api.parseServerVipStatus(status({paid_spend_cents:-1})),null);
assert.equal(api.parseServerVipStatus(status({paid_spend_cents:2**54})),null);
assert.equal(api.parseServerVipStatus(status({vip:11})),null);
assert.equal(api.parseServerVipStatus(status({vip:1,permanent_vip:5})),null);
assert.equal(api.parseServerVipStatus(status({temporary_until:'bad'})),null);

await api.refreshFortuneVip();
assert.deepEqual([account.vip,account.permanentVip,account.paidVip,account.giftVip,account.paidSpendCents],
  [8,5,2,5,1000],'paid, gift and temporary tiers are separate');
assert.equal(account.entitlementVerified,true);
assert.equal(account.vipRemaining,2*60*60*1000,'server-derived temporary expiry');
assert.equal(account.vipUntil,'2026-11-05T12:00:00.000Z');

// Rejected transport and malformed data never demote a server-confirmed gift.
const before=writes;
ledgerError={message:'RPC unavailable'};
await api.refreshFortuneVip();
assert.equal(writes,before);
ledgerError=null;
ledger=status({paid_spend_cents:'made-up'});
await api.refreshFortuneVip();
assert.equal(writes,before);

// A verified refund reduces only the paid tier; permanent gift remains.
ledger=status({vip:5,permanent_vip:5,paid_vip:0,gift_vip:5,
  paid_spend_cents:0,temporary_vip:0,temporary_until:null});
await api.refreshFortuneVip();
assert.equal(account.vip,5);
assert.equal(account.permanentVip,5);
assert.equal(account.paidVip,0);
assert.equal(account.giftVip,5);
assert.equal(account.vipRemaining,0);

// Legacy Fortune one-day VIP remains available after the new ledger rollout.
ledger=status({vip:1,permanent_vip:0,paid_vip:0,gift_vip:0,
  paid_spend_cents:0,temporary_vip:0,temporary_until:null});
legacy={vip:1,permanent_vip:0,vip_until:'2026-11-05T11:00:00Z',
  server_now:'2026-11-05T10:00:00Z'};
await api.refreshFortuneVip();
assert.equal(account.vip,1);
assert.equal(account.vipRemaining,60*60*1000);

// A temporary status without a trustworthy expiry must not be minted.
ledger=status({vip:7,permanent_vip:0,paid_vip:0,gift_vip:0,
  paid_spend_cents:0,temporary_vip:7,temporary_until:null});
legacy={vip:0,permanent_vip:0,vip_until:null,server_now:'2026-11-05T10:00:00Z'};
const beforeBad=writes;
await api.refreshFortuneVip();
assert.equal(writes,beforeBad);

// When the feature flag is off, the original live Fortune route is untouched.
const live=await bundle(false);
legacy={vip:5,permanent_vip:5,vip_until:null,server_now:'2026-11-05T10:00:00Z'};
ledgerError={message:'new API unavailable'};
await live.refreshFortuneVip();
assert.equal(account.vip,5);
assert.equal(account.permanentVip,5);
assert.equal(account.entitlementVerified,false);
assert.equal(account.paidSpendCents,0);
console.log('VIP unified entitlement client: paid/gift/temp, refund, expiry, invalid RPC, legacy fallback PASS');
