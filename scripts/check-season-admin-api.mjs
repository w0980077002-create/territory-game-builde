// Exercise existing HMAC admin gateway, not an alternate owner-auth path.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript');
let handler;let calls=[];let next={data:{enabled:true,revision:1,prizes:[]},error:null};
const secret='offline-test-only-secret';
const db={rpc:async(name,args)=>{
 calls.push({name,args});
 if(name==='territory_admin_credential_v2') return {data:{version:1},error:null};
 return next;
}};
const code=ts.transpileModule(readFileSync('supabase/functions/admin-api/index.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports:{},require:()=>({createClient:()=>db}),
 Deno:{env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?secret:'https://offline.invalid'},serve:fn=>{handler=fn;}},
 crypto:webcrypto,TextEncoder,Response,Request,console,Date});
const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(secret+':admin'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const expiry=String(Date.now()+60000);
const sig=Buffer.from(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(expiry))).toString('hex');
const token=expiry+'.'+sig;
const request=async(action,params={},auth=token)=>{
 const result=await handler(new Request('https://offline.invalid',{method:'POST',body:JSON.stringify({action,...params,token:auth})}));
 return {status:result.status,body:await result.json()};
};
for(const action of ['season_status','season_prizes']){
 calls=[];const res=await request(action,{},null);assert.equal(res.status,401);assert.equal(calls.length,0);
 const forged=await request(action,{},expiry+'.'+'0'.repeat(64));assert.equal(forged.status,401);
 assert(!calls.some(c=>c.name.startsWith('territory_season_')));
}
calls=[];
assert.equal((await request('season_status')).status,200);
assert.equal(calls.at(-1).name,'territory_season_admin_status_v1');
const params={requestId:'aaaaaaaa-aaaa-4aaa-8aaa-111111111111',revision:1,prizes:[{gold:3000,gems:90}]};
calls=[];assert.equal((await request('season_prizes',params)).status,200);
assert.equal(calls.at(-1).name,'territory_season_admin_prizes_v1');
assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).args)),{p_operation:params.requestId,p_revision:1,p_prizes:params.prizes});
for(const bad of [{prizes:[{gold:-1}]},{prizes:[{redGems:5}]},{prizes:[]},{prizes:[{gems:'90'}]},{revision:1.5},{requestId:'bad'}]){
 calls=[];assert.equal((await request('season_prizes',{...params,...bad})).status,400);
 assert(!calls.some(c=>c.name==='territory_season_admin_prizes_v1'));
}
next={data:null,error:{message:'season_config_changed'}};
assert.equal((await request('season_prizes',params)).body.error,'season_config_changed');
next={data:null,error:{message:'missing function'}};
assert.equal((await request('season_status')).status,503);
console.log('Season admin gateway PASS: actual HMAC session validation, anonymous/forged denial, service RPC mapping, invalid payload, CAS conflict, unavailable backend');
