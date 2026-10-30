// Real events, Game Hall and daily sheet rendered together with inert local adapters.
// This fixture NEVER writes to a real wallet, Telegram account or Supabase.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const fixture = `
import {create} from './src/game/store';
import {createInitialGame} from './src/game/engine';
const state=createInitialGame();
const query=new URLSearchParams(location.search);
if(query.has('claimed'))state.dailyReward={streak:1,lastDay:new Date().toISOString().slice(0,10)};
if(query.has('quests')){
  state.quests=[{id:'q_daily_1',type:'daily',current:3,target:3,claimed:false,title:'Battle victory',description:'Win three fights',reward:{gold:20}}];
}
export const useGame=create(state);
export const useLive=create({mail:[]});
export function grantRewards(state){return state;}
export function updateProgress(state){return state;}
export async function claimMailGrant(){return false;}
export async function getClaimedMailHistory(){return {letters:[],hasMore:false};}
export function captureGameEvent(){}
const active=query.has('active')?{token:'11111111-1111-4111-8111-111111111111',game:'treasury',question:{chests:[1,2,3]}}:null;
let hall={tickets:3,points:0,played:0,wins:0,pending_gold:0,claimed_gold:0,position:0,daily_remaining:10,free_ready:true,active};
export async function hallStatus(){if(query.has('offline'))throw Error('offline');return hall;}
export async function hallDaily(){hall={...hall,free_ready:false,tickets:hall.tickets+2};return hall.tickets;}
export async function autoClaimHallGold(){throw Error('fixture does not pay');}
export function hallError(){return 'Offline game server';}
export async function fetchSlotsStatus(){return null;}
export async function fetchSeasonStatus(){return {enabled:false};}
export async function getArenaWeeklyStatus(){return null;}
`;

const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider} from './src/game/i18n';
import {EventsScreen} from './src/components/EventsScreen';
import {GamesScreen} from './src/components/GamesScreen';
import {DailySheet} from './src/components/home/HomeSheets';
const mode=new URLSearchParams(location.search).get('view')||'events';
function Preview(){
 const [screen,setScreen]=React.useState(mode);
 const navigate=(name)=>{window.__route=name;if(name==='games')setScreen('hall');};
 return <div className="territory-shell" style={{height:'100dvh',overflow:'auto',padding:12}}>
  {screen==='events'&&<EventsScreen onNavigate={navigate} onDaily={()=>setScreen('daily')} onSeason={()=>{}} gatherReady={true}/>}
  {screen==='hall'&&<GamesScreen userId="offline-review" onPlay={id=>{window.__hallGame=id;}}/>}
  {screen==='daily'&&<DailySheet onClose={()=>setScreen('events')} notify={()=>{window.__notice=true;}}/>}
 </div>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider><Preview/></LanguageProvider>);
`;
const output=await build({
 stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},
 bundle:true,write:false,outdir:'/tmp/daily-hero-build',format:'iife',jsx:'automatic',
 alias:{'@':resolve('src')},
 define:{'import.meta.env.BASE_URL':JSON.stringify('/'),'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'},
 plugins:[{
  name:'inert-daily-loop',
  setup(build){
   build.onResolve({filter:new RegExp('(?:game/|[.]/)(actions|live|analytics|gameHall|slotsApi|seasonApi|arenaWeekly)$')},()=>({path:'fixture',namespace:'fixture'}));
   build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js',resolveDir:resolve('.')}));
  },
 }],
});
const compiledCss=(await postcss([tailwindcss(),autoprefixer()]).process(readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css;
const css=compiledCss+'\n'+readFileSync('src/components/ui/vikingScreenSkin.css','utf8')+'\n'+(output.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'');
const js=output.outputFiles.find(f=>f.path.endsWith('.js')).text;
const safeJs=js.split('</script').join('<'+'\\'+'/script');
writeFileSync('/tmp/territory-daily-hero-preview.html',`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#121924"><style>${css}</style><div id="root"></div><script>${safeJs}</script></body></html>`);
console.log('Offline daily loop preview built: /tmp/territory-daily-hero-preview.html');
