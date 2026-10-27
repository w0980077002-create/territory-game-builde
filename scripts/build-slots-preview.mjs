// Actual live slot component/API, isolated offline transport. No real player data.
import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const fixture=`
let state={phase:'ready',revision:0,pending:0,riskSteps:0,opened:[],picksLeft:5,shields:0};
let coins=500,rev=0;const receipts=new Map();window.__slotCalls=[];
const status=()=>({enabled:true,coins,collected:0,state});
const gameSnapshot={player:{gold:500,gems:0}};
export const useGame={get:()=>gameSnapshot};
export const saveTokens=new Map([['review',new Date().toISOString()]]);
export async function saveCloudSave(){return true;}
export function acceptMonopolyClaimReceipt(userId,r){saveTokens.set(userId,r.updated_at);gameSnapshot.player.gold=r.wallet_gold;}
export const supabase={rpc:async(name,args)=>{
 if(args.p_action==='status')return {data:status(),error:null};
 window.__slotCalls.push(args);
 if(receipts.has(args.p_operation))return {data:receipts.get(args.p_operation),error:null};
 if(args.p_expected!==state.revision)return {data:null,error:{code:'P0001',message:'slots_stale_round'}};
 const next={...state,revision:state.revision+1};let collected=0;
 if(args.p_action==='spin'){
  coins-=args.p_lines*args.p_bet;
  Object.assign(next,{phase:'decision',pending:32,lines:args.p_lines,bet:args.p_bet,stake:args.p_lines*args.p_bet,outcome:{grid:Array.from({length:5},()=>['gold','gem','sword']),stops:[0,0,0,0,0],lines:[{number:1,count:5,symbol:'gold',payout:32,positions:[[0,1],[1,1],[2,1],[3,1],[4,1]]}],payout:32,bonusSymbols:0}});
 }else if(args.p_action==='collect'){collected=next.pending;coins+=collected;next.pending=0;next.phase='ready';}
 else if(args.p_action==='risk_start')next.phase='risk';
 else if(args.p_action==='risk'){next.pending*=2;next.phase='decision';next.riskWon=true;next.riskSteps++;}
 else if(args.p_action==='bonus'){next.opened=[...next.opened,args.p_choice];next.revealed={...next.revealed,[args.p_choice]:{kind:'treasure',payout:3}};next.pending+=3;next.picksLeft--;}
 else if(args.p_action==='super'){next.pending+=9;next.phase='decision';next.superAward=9;}
 if(window.__slotNextState){Object.assign(next,window.__slotNextState);window.__slotNextState=null;}
 state=next;rev++;const result={...status(),collected,success:true,updated_at:new Date(Date.now()+rev*1000).toISOString(),wallet_gold:coins,wallet_gems:0,game_state:{player:{gold:coins,gems:0}}};receipts.set(args.p_operation,result);
 if(window.__slotTimeout){window.__slotTimeout=false;return {data:null,error:{code:'504',message:'timeout'}};}
 return {data:result,error:null};
}};`;
const entry=`import React from'react';import{createRoot}from'react-dom/client';import{SlotsGate}from'./src/components/ServerVikingSlots';import{LanguageProvider}from'./src/game/i18n';
function App(){const [n,setN]=React.useState(0);return <><button id="fixture-remount" style={{position:'fixed',left:-999}} onClick={()=>setN(i=>i+1)}>Remount</button><div className="territory-shell flex flex-col max-w-md mx-auto overflow-hidden relative" style={{height:'100dvh'}}><main className="territory-screen flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-2 py-2"><SlotsGate key={n} userId="review" onBack={()=>{window.__slotBack=true;}} demo={<div>DEMO</div>}/></main></div></>};createRoot(document.getElementById('root')).render(<LanguageProvider><App/></LanguageProvider>);`;
const output=await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/slots-browser',format:'iife',jsx:'automatic',minify:true,alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':JSON.stringify('/'),'import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-slot-transport',setup(b){b.onResolve({filter:/\/game\/(supabase|gameHall|cloud|actions)$|^\.\/supabase$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js'}));}}]});
const js=output.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=(await postcss([tailwindcss(),autoprefixer()]).process(readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css+'\n'+output.outputFiles.find(f=>f.path.endsWith('.css')).text;
writeFileSync('/tmp/slots-preview.html',`<!doctype html><html lang="ru" class="territory-telegram-webapp"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#080d22}${css}</style><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></html>`);
console.log('Offline slot fixture: /tmp/slots-preview.html');
