/** Offline contract tests: no Supabase account, network or player data. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const live=readFileSync('src/game/live.ts','utf8');
assert.doesNotMatch(live,/\.rpc\('claim_admin_grant'/,'legacy client-authoritative claim removed');
assert.doesNotMatch(live,/useGame\.set\(applyGrantPayload\(/,'never add a real grant in the client');
assert.match(live,/territory_admin_claim_grant_v2/);

const start=live.indexOf('type UncertainClaim =');
const end=live.indexOf('export function claimMailGrant(');
assert.ok(start>0&&end>start);
const js=ts.transpileModule(live.slice(start,end),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
}).outputText;

function harness(rpc){
  let state={player:{gold:10,gems:5},inventory:[]};
  let mail=[{id:'gift'}];
  const events=[];
  let fence=false;
  const ctx={
    supabase:{auth:{getUser:async()=>({data:{user:{id:'hero'}}})},rpc:async(name,args)=>{
      events.push(['rpc',name,args.p_id]);
      return rpc(args.p_id,events);
    }},
    useGame:{get:()=>state,set:next=>{events.push(['set',next.player.gold]);state=next;}},
    useLive:{set:fn=>{const next=fn({mail});mail=next.mail;}},
    saveCloudSave:async()=>{events.push(['save']);return !fence;},
    protectFortuneSave:()=>{fence=true;events.push(['fence']);},
    releaseArenaRejectedAction:()=>{fence=false;events.push(['release']);},
    acceptMonopolyClaimReceipt:(_id,r)=>{
      if(r?.success!==true)throw new Error('invalid');
      fence=false;events.push(['adopt']);return r.game_state;
    },
    console:{warn:()=>{},error:()=>{}},
  };
  vm.createContext(ctx);
  vm.runInContext(js+'\nglobalThis.__claim = claim;',ctx);
  return {
    claim:(id)=>ctx.__claim(id),events,getState:()=>state,getMail:()=>mail,
    isFenced:()=>fence,mutate:()=>{state={...state,player:{...state.player,gold:77}};},
  };
}

const receipt=(gold)=>({data:{success:true,replayed:false,updated_at:'2026-10-26T00:00:01Z',
  game_state:{player:{gold,gems:5},inventory:[]},wallet_gold:gold,wallet_gems:5},error:null});

{
  const h=harness(async()=>receipt(500_010));
  const [a,b]=await Promise.all([h.claim('gift'),h.claim('gift')]);
  assert.equal(a,true);assert.equal(b,true);
  assert.equal(h.getState().player.gold,500_010);
  assert.deepEqual(h.getMail(),[]);
  assert.equal(h.events.filter(x=>x[0]==='rpc').length,1,'duplicate taps use one transaction');
  assert.deepEqual(h.events.map(x=>x[0]).slice(0,5),['save','fence','rpc','adopt','set']);
  assert.equal(h.isFenced(),false);
}
{
  const h=harness(async(id)=>receipt(id==='a'?20:30));
  assert.deepEqual(await Promise.all([h.claim('a'),h.claim('b')]),[true,true]);
  assert.deepEqual(h.events.filter(x=>x[0]==='rpc').map(x=>x[2]),['a','b']);
}
{
  const h=harness(async()=>({data:null,error:{code:'23514'}}));
  assert.equal(await h.claim('reject'),false);
  assert.equal(h.isFenced(),false,'known SQL rollback allows autosaves');
  assert.equal(h.events.filter(x=>x[0]==='release').length,1);
}
{
  let attempt=0;
  const h=harness(async()=>++attempt===1?{data:null,error:{code:'NETWORK'}}:receipt(100));
  assert.equal(await h.claim('uncertain'),false);
  assert.equal(h.isFenced(),true,'ambiguous network result must keep save fence');
  assert.equal(await h.claim('other'),false,'cannot run a second grant until first reconciles');
  assert.equal(await h.claim('uncertain'),true,'same idempotent claim can retry');
  assert.equal(h.events.filter(x=>x[0]==='save').length,1,'do not write stale snapshot on retry');
  assert.equal(h.getState().player.gold,100);
}
{
  const h=harness(async()=>receipt(1_000));
  const pending=h.claim('race');
  // Mutating immediately may happen before preflight; schedule after fence.
  while(!h.isFenced())await Promise.resolve();
  h.mutate();
  assert.equal(await pending,false,'never overwrite gameplay changed during RPC');
  assert.equal(h.getState().player.gold,77);
  assert.equal(h.isFenced(),true,'reload needed after committed ambiguous change');
}

console.log('ADMIN CLAIM CLIENT PASS: server receipt only, save fence, no double claim, serial grants, rollback/retry and dirty-state protection.');
