// Isolated browser fixture: no real credentials, players, tickets or network.
import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const fixture=`
const seed={player:{name:'Review',gold:100,gems:7,level:10},inventory:[],forgeMaterials:1};
let state=seed;let token='2026-10-20T13:00:00.000Z';let receipt=null;let tickets=6,common=2,rare=1,golden_key=1;
const seen=new Map();window.__fortuneCalls=[];
export const useGame={get:()=>state,set:(s)=>{state=s;}};
export const useAccount={set:()=>{}};
export const saveTokens=new Map([['review',token]]);
export async function saveCloudSave(){return true;}
export function protectFortuneSave(){}
export function acceptMonopolyClaimReceipt(id,data){saveTokens.set(id,data.updated_at);return data.game_state;}
export const supabase={rpc:async(name,args={})=>{
 if(name==='territory_fortune_entitlement_v1')return {data:{vip:0,permanent_vip:0,server_now:token,vip_until:null},error:null};
 window.__fortuneCalls.push(args);
 const action=args.p_action;
 if(action==='ack')receipt=null;
 if(action&&action!=='status'&&action!=='ack'){
  if(!receipt){
   if(seen.has(args.p_key))receipt=seen.get(args.p_key);
   else {
    if(action==='spin')tickets--;else if(action==='golden')golden_key--;else if(action==='common')common--;else rare--;
    receipt={id:args.p_key,action,prize:action==='spin'?'gems':'gold',quantity:action==='spin'?3:100,refunded:false};
    seen.set(args.p_key,receipt);token=new Date(Date.parse(token)+1000).toISOString();
   }
  }
 }
 return {error:null,data:{success:true,updated_at:token,game_state:state,wallet_gold:state.player.gold,wallet_gems:state.player.gems,tickets,common,rare,golden_key,vip:0,vip_until:null,server_now:token,receipt}};
}};
`;
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{WheelOfFortune}from'./src/components/WheelOfFortune';import{TreasuryInventory}from'./src/components/TreasuryInventory';function App(){const[t,set]=React.useState(false);return <><p className="review-label">OFFLINE BROWSER TEST · FIXTURE BALANCES</p><button id="fixture-treasury" onClick={()=>set(!t)}>Treasury / Wheel</button>{t?<TreasuryInventory userId="review"/>:<WheelOfFortune userId="review" onBack={()=>{window.__back=true;}}/>}</>};createRoot(document.getElementById('root')).render(<App/>);`;
const out=await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/fortune-browser',format:'iife',jsx:'automatic',minify:true,alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':JSON.stringify('file://'+resolve('public')+'/'),'import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-fixtures',setup(b){b.onResolve({filter:/\/game\/(cloud|actions|supabase)$|^\.\/(cloud|actions|supabase)$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js'}));}}]});
const js=out.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=out.outputFiles.find(f=>f.path.endsWith('.css')).text;
writeFileSync('/tmp/fortune-preview.html',`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:8px;background:#080d22;font-family:Arial,sans-serif}button{font:inherit;color:inherit}button:disabled{cursor:default}.review-label{font-size:10px;text-align:center;color:#aaa}#fixture-treasury{color:white;min-height:44px}#root{max-width:460px;margin:auto}${css}</style><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></html>`);
console.log('Offline fixture: /tmp/fortune-preview.html');
