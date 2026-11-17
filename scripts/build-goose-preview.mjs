/** Offline QA harness of the actual roster AND ordinary PveFight.
 * No live Supabase transport, no production credentials, no product demo route. */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';import tailwindcss from 'tailwindcss';import autoprefixer from 'autoprefixer';
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{LanguageProvider}from'./src/game/i18n';import{useGame}from'./src/game/actions';import{GOOSE_FOLLOWER,GOOSE_ID}from'./src/game/followers';import{FollowersPanel}from'./src/components/FollowersPanel';import{PveFight}from'./src/components/pve/PveFight';
const s=useGame.get();const q=new URLSearchParams(location.search);useGame.set({...s,player:{...s.player,name:'Рагнар',level:61,stats:{...s.player.stats,hp:q.has('defeat')?20:1500,maxHp:q.has('defeat')?20:1500,attack:q.has('victory')?180:45,defense:2}},battleStones:100,gooseCompanionVerified:!q.has('locked'),followers:[...s.followers.map((f,i)=>i===0?{...f,unlocked:true}:f),{...GOOSE_FOLLOWER,unlocked:!q.has('locked')}],activeFollowerId:GOOSE_ID});
const enemy={id:'goose_qa_enemy',name:q.has('boss')?'Тёмный жрец':'Лесной разбойник',art:q.has('boss')?'/assets/territory/characters/bosses/dark_priest/idle.webp':'/assets/territory/characters/enemies/bandit/idle.webp',hp:520,maxHp:520,attack:q.has('defeat')?50000:80,defense:8,isBoss:q.has('boss'),rewardGold:0,rewardXp:0};
window.__gooseState=()=>useGame.get();createRoot(document.getElementById('root')).render(<LanguageProvider><div style={{maxWidth:430,margin:'auto',padding:8}}><p style={{color:'#fcd34d'}}>ТЕСТ / PROTOTYPE · OFFLINE</p>{q.has('fight')?<PveFight userId="offline" enemy={enemy} kind={q.has('trial')?'trial':'stage'} onExit={()=>{}} onNext={()=>{}}/>:<FollowersPanel/>}</div></LanguageProvider>);`;
const transport=`export const supabase={auth:{getUser:async()=>({data:{user:{id:'offline'}}})},rpc:async(name)=>({data:name==='territory_goose_status_v1'?{companion_id:'follower_goose_obnimus',price:30,owned:!new URLSearchParams(location.search).has('locked'),receipt:'offline-test-only'}:null,error:null})};`;
const out=await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/goose-fixture',format:'iife',jsx:'automatic',alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':'"/"','import.meta.env.VITE_TERRITORY_RUNES':'"disabled"','process.env.NODE_ENV':'"production"','import.meta.env.VITE_SUPABASE_URL':'"https://offline.invalid"','import.meta.env.VITE_SUPABASE_ANON_KEY':'"offline"','import.meta.env.PROD':'false'},plugins:[{name:'offline',setup(b){
 b.onResolve({filter:/\/supabase$/},()=>({path:'transport',namespace:'offline'}));
 b.onResolve({filter:/\/referrals$/},()=>({path:'referrals',namespace:'offline'}));
 b.onResolve({filter:/\/pveVictorySaveFence$/},()=>({path:'victory',namespace:'offline'}));
 b.onLoad({filter:/.*/,namespace:'offline'},a=>({contents:a.path==='transport'?transport:a.path==='referrals'?'export async function beginReferralFight(){return null} export async function finishReferralFight(){return null}':'export const pveVictorySaveBlocked=()=>false;export async function confirmPveVictorySave(){return true}'}));
}}]});
const css=(await postcss([tailwindcss(),autoprefixer()]).process(readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css+(out.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'');
const js=out.outputFiles.find(f=>f.path.endsWith('.js')).text;
writeFileSync('/tmp/territory-goose-preview.html',`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></html>`);
