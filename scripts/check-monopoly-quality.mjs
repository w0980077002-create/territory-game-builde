import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const define={'import.meta.env.BASE_URL':'"/"','import.meta.env.VITE_SUPABASE_URL':'"https://offline-visual.invalid"','import.meta.env.VITE_SUPABASE_ANON_KEY':'"offline-only"','import.meta.env.DEV':'false'};
async function bundle(contents,transform=()=>null){
 const output=await build({stdin:{contents,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',outdir:'/tmp/monopoly-quality',alias:{'@':resolve('src')},define,plugins:[{name:'offline-test-fixtures',setup(b){b.onLoad({filter:/\.tsx?$/},({path})=>{const text=readFileSync(path,'utf8'),fixture=transform(path,text);return fixture===null?null:{contents:fixture,loader:path.endsWith('.tsx')?'tsx':'ts'};});}}]});
 const mod={exports:{}};new Function('require','module','exports',output.outputFiles.find(f=>f.path.endsWith('.js')).text)(require,mod,mod.exports);return mod.exports;
}
const render=(entry,props='')=>`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {LanguageProvider} from './src/game/i18n';import {${entry}} from './src/components/${entry==='GamesScreen'?'GamesScreen':'monopoly/MonopolyAdventure'}';module.exports=renderToStaticMarkup(<LanguageProvider><${entry} ${props}/></LanguageProvider>);`;
// Exercise actual card markup: empty wallets must retain the free-bonus route.
for(const tickets of [0,1]){
 const hall={tickets,points:0,played:0,wins:0,pending_gold:0,claimed_gold:0,position:0,daily_remaining:1000,free_ready:false,active:null};
 const html=await bundle(render('GamesScreen','userId="fixture" onPlay={()=>{}}'),(path,text)=>path.endsWith('/GamesScreen.tsx')?text.replace('useState<HallState|null>(null)',`useState<HallState|null>(${JSON.stringify(hall)})`).replace('useState(true)','useState(false)'):null);
 for(const game of ['monopoly','dice','tower','targets','treasury']){
  const tag=html.match(new RegExp('<button[^>]*data-testid="hall-game-'+game+'"[^>]*>'))?.[0];
  assert(tag,'missing game '+game);assert.equal(/\bdisabled=/.test(tag),tickets===0&&game!=='monopoly',game+' access for '+tickets+' tickets');
 }
}
// Exercise the actual RPC response validator with administrative wallet balances.
globalThis.__qualitySupabase={rpc:async()=>({data:null,error:null})};
const api=await bundle("export {hallFinish} from './src/game/gameHall';",(path,text)=>path.endsWith('/gameHall.ts')?text.replace("import { supabase } from './supabase';","const supabase=globalThis.__qualitySupabase;").replace("import { useGame } from './actions';","const useGame:any={};").replace("import { saveCloudSave, claimHallGoldCloud } from './cloud';","const saveCloudSave:any=()=>{};const claimHallGoldCloud:any=()=>{};"):null);
const session={token:'11111111-1111-4111-8111-111111111111',game:'dice',question:{}};
for(const tickets of [0,20,21,250,1000,1001,-1,1.5]){
 globalThis.__qualitySupabase.rpc=async()=>({data:{won:true,earned_gold:110,points:10,tickets,game:'dice',new_position:null},error:null});
 if(tickets>=0&&tickets<=1000&&Number.isInteger(tickets))assert.equal((await api.hallFinish(session,0)).tickets,tickets);
 else await assert.rejects(api.hallFinish(session,0),/hall_invalid_result/);
}
delete globalThis.__qualitySupabase;
// A receipt already credited to inventory must not ask the player to claim twice.
for(const credited of [false,true]){
 const html=await bundle(render('MonopolyAdventure','userId="fixture" onBack={()=>{}}'),(path,text)=>{
  if(!path.endsWith('/MonopolyAdventure.tsx'))return null;
  return text.replace('awards?:Prize;credited?:boolean}|null>(null)','awards?:Prize;credited?:boolean}|null>('+JSON.stringify({awards:{gems:2},credited})+')');
 });
 assert.equal(html.includes('Ресурсы готовы к получению под полем.'),!credited);
 assert.equal(html.includes('Сокровища зачислены в инвентарь'),credited);
 assert.ok(!html.includes('Джекпот'),'no unavailable jackpot action');
 assert.ok(html.includes('Сокровища'),'real lap rewards shortcut');
}
const share=await bundle(`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {LanguageProvider} from './src/game/i18n';import {DailyShareCard} from './src/game/DailyShareCard';module.exports=renderToStaticMarkup(<LanguageProvider><DailyShareCard task="monopoly" userId="fixture"/></LanguageProvider>);`);
assert.ok(share.includes('Бонус за открытие окна отправки'));
assert.ok(share.includes('2 билета раз в 24 часа'));
console.log('Monopoly quality PASS: empty-wallet entry, 0–1000 ticket receipts, invalid balances rejected, earned/credited messages separated, real rewards shortcut and explicit daily-share terms. Offline rendering; not a Telegram device test.');
