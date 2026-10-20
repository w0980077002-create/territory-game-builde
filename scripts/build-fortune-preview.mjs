// Isolated browser fixture: no real credentials, players, tickets or network.
import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const fixture=`
const seed={player:{name:'Review',gold:100,gems:7,level:10},inventory:[],forgeMaterials:1};
let state=seed;let token='2026-10-20T13:00:00.000Z';let receipt=null;let tickets=128,common=2,rare=1,golden_key=1;
const seen=new Map();window.__fortuneCalls=[];
export const useGame={get:()=>state,set:(s)=>{state=s;}};
export const useAccount={set:()=>{}};
export const saveTokens=new Map([['review',token]]);
export async function saveCloudSave(){return true;}
export async function claimHallGoldCloud(){return {state,gold:0};}
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
    receipt={id:args.p_key,action,prize:action==='spin'?(window.__fortuneOutcome?.prize??'gems'):'gold',quantity:action==='spin'?(window.__fortuneOutcome?.quantity??3):100,refunded:false};
    seen.set(args.p_key,receipt);token=new Date(Date.parse(token)+1000).toISOString();
   }
  }
 }
 return {error:null,data:{success:true,updated_at:token,game_state:state,wallet_gold:state.player.gold,wallet_gems:state.player.gems,tickets,common,rare,golden_key,vip:0,vip_until:null,server_now:token,receipt}};
}};
`;
// Render the actual production nav markup and production shell CSS. This catches
// the persistent Battle spotlight and real scroll-pane/nav collisions.
const appSource=readFileSync('src/App.tsx','utf8');
const navStart=appSource.indexOf('<nav className="territory-nav');
const navMarkup=appSource.slice(navStart,appSource.indexOf('</nav>',navStart)+6);
const navDataStart=appSource.indexOf('= [',appSource.indexOf('const NAV:'))+2;
const navData=appSource.slice(navDataStart,appSource.indexOf('];',navDataStart)+1);
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{WheelOfFortune}from'./src/components/WheelOfFortune';import{TreasuryInventory}from'./src/components/TreasuryInventory';import './src/components/gameHall.css';import{LanguageProvider}from'./src/game/i18n';
const NAV=${navData};const battleLocked=false,gatherReady=false;const language='ru',navActive='games';const tNav=(_,label)=>label,translate=x=>x,goNav=()=>{};
function App(){const[t,set]=React.useState(false);return <><button id="fixture-treasury" style={{position:'fixed',left:-1000}} onClick={()=>set(!t)}>Treasury / Wheel</button><div className={'territory-shell flex flex-col max-w-md mx-auto overflow-hidden relative '+(!t?'territory-wheel-open':'')} style={{height:'100dvh'}}><main className="territory-screen flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide px-3 py-3">{t?<TreasuryInventory userId="review"/>:<WheelOfFortune userId="review" onBack={()=>{window.__back=true;}}/>}</main>${navMarkup}</div></>};createRoot(document.getElementById('root')).render(<LanguageProvider><App/></LanguageProvider>);`;
const out=await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/fortune-browser',format:'iife',jsx:'automatic',minify:true,alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':JSON.stringify('/'),'import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-fixtures',setup(b){b.onResolve({filter:/\/game\/(cloud|actions|supabase)$|^\.\/(cloud|actions|supabase)$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js'}));}}]});
let js=out.outputFiles.find(f=>f.path.endsWith('.js')).text;

const shellCss=(await postcss([tailwindcss(),autoprefixer()]).process(readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css;
const css=shellCss+'\n'+out.outputFiles.find(f=>f.path.endsWith('.css')).text;
writeFileSync('/tmp/fortune-preview.html',`<!doctype html><html lang="ru" class="territory-telegram-webapp"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#080d22}${css}</style><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></html>`);
console.log('Offline fixture: /tmp/fortune-preview.html');
