// Offline verification fixture for the actual production combat components.
// It never creates a route in the game, uses real accounts, or reaches Supabase.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const offline = `
const fixtureSaves = new Map();
export const saveTokens = new Map([['fixture-pve','2026-11-04T06:00:00.000Z']]);
export const supabase = {
  from(table) {
    if (table !== 'players') throw Error('Combat fixture must not call other Supabase tables');
    let playerId = null;
    return {
      select() { return this; },
      eq(field, value) {
        if (field !== 'id') throw Error('Fixture requires player ownership filter');
        playerId = value;
        return this;
      },
      async maybeSingle() {
        const state = fixtureSaves.get(playerId);
        return {data: state ? {
          game_state: state,
          gold: state.player.gold,
          gems: state.player.gems,
          updated_at: saveTokens.get(playerId),
        } : null, error: null};
      },
    };
  },
  rpc() { throw Error('Combat fixture must not call real Supabase RPC'); },
};
export const useLive = {get:()=>({goldX2:false})};
// Isolated browser fixture: emulate cloud ACK with an exact owner-scoped readback.
export const saveBlocked = new Set();
export async function saveCloudSave(playerId, snapshot) {
  fixtureSaves.set(playerId, JSON.parse(JSON.stringify(snapshot)));
  saveTokens.set(playerId, '2026-11-04T06:01:00.000Z');
  return true;
}
export async function beginReferralFight(){return null;}
export async function finishReferralFight(){throw new Error('No real referral ticket in combat fixture');}
export function getTelegramInitData(){return '';}
export function initTelegramWebApp(){}
export function getTelegramUser(){return null;}
export async function ensurePlayerSession(){return true;}
export function captureGameEvent(name,details){window.__events.push({name,details});}
`;
const entry = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FighterFigure} from './src/components/arena/FighterFigure';
import {BattleScene} from './src/components/arena/BattleScene';
import {PveFight} from './src/components/pve/PveFight';
import {getCombatAppearance} from './src/game/appearance';
import {getEnemyCombatFrames} from './src/game/combatArt';
import {createInitialGame, generateTrial} from './src/game/engine';
import {useGame} from './src/game/actions';
import {LanguageProvider} from './src/game/i18n';
window.__events=[];
const heroArt='/assets/territory/characters/heroes/male_viking/idle.webp';
const goblinArt='/assets/territory/characters/enemies/goblin/idle.webp';
const banditArt='/assets/territory/characters/enemies/bandit/idle.webp';
const foe={id:'fixture-goblin',name:'Гоблин',art:goblinArt,maxHp:600,attack:5,defense:0,isBoss:false,rewardGold:0,rewardXp:0,icon:'',level:1};
const options=new URLSearchParams(location.search);
// The follower browser test must receive a genuine non-blocked enemy hit.
// The ordinary practice foe has only 5 attack and can deal 0 after armor;
// it cannot reliably trigger a real heal. This stronger offline-only opponent
// changes no production encounter, user HP, battle math, or reward.
const pveFoeBase=options.get('enemy')==='bandit'?{...foe,id:'fixture-bandit',name:'Разбойник',art:banditArt}:foe;
const pveFoe=options.has('follower')?{...pveFoeBase,attack:80}:pveFoeBase;
// Consistent normal RNG choices: foe strikes unguarded legs, dodge fails.
// Actual playRound() still calculates every hit, defense, and heal.
if(options.has('follower')) Math.random=()=>0.99;
const initial={strike:null,heroAlive:true,foeAlive:true,heroWon:false,foeWon:false,speed:1,appearance:'m2',enemy:'goblin'};
function seed(){const game=createInitialGame();game.player.name='Рагнар';game.player.level=10;game.player.stats.maxHp=800;game.player.stats.hp=800;game.appearance=['m1','f1','f2'].includes(options.get('appearance'))?options.get('appearance'):'m2';
 // Fixture ONLY: select a real existing follower and leave missing HP so the
 // genuine PvE round can produce an observable companion heal, never mock it.
 const followerId=options.get('follower');
 if(followerId&&game.followers.some(f=>f.id===followerId)){
   game.followers=game.followers.map(f=>f.id===followerId?{...f,unlocked:true}:f);
   game.activeFollowerId=followerId;
   game.player.stats.hp=200;
 }
 useGame.set(game);}
seed();
function App(){
 const [scene,setScene]=useState(new URLSearchParams(location.search).get('scene')||'figure');
 const [visual,setVisual]=useState(initial);
 const [epoch,setEpoch]=useState(0);
 const [mounted,setMounted]=useState(true);
 const [attack,setAttack]=useState(null),[blocks,setBlocks]=useState([]);
 window.__combat={set:patch=>setVisual(v=>({...v,...patch})),show:(name)=>{seed();setVisual(initial);setScene(name);setMounted(true);setEpoch(e=>e+1);},unmount:()=>setMounted(false),game:()=>useGame.get(),setGame:patch=>useGame.set(patch),events:()=>window.__events};
 const fighter={id:'hero',name:'Рагнар',appearance:'m2',level:10,rating:1000,hp:visual.heroAlive?800:0,maxHp:800,team:1,kills:0,damage:0,left:false,moved:false};
 const opponent={...fighter,id:'enemy',name:'Противник',hp:visual.foeAlive?600:0,maxHp:600,team:2};
 return <main id="combat-fixture" className="max-w-md mx-auto px-2 py-3" style={{minHeight:'100dvh'}}>{mounted && (scene==='pve'?<PveFight key={epoch} userId="fixture-pve" enemy={pveFoe} kind="stage" onExit={()=>setMounted(false)}/>:scene==='trial'?<PveFight key={epoch} userId="fixture-pve" enemy={generateTrial(1)} kind="trial" onExit={()=>setMounted(false)}/>:scene==='arena'?<BattleScene key={epoch} me={fighter} enemy={opponent} active={!visual.heroWon&&!visual.foeWon} finished={visual.heroWon||visual.foeWon} won={visual.heroWon} draw={false} moved={false} auto={false} autoLocked={false} autoMinVip={0} attack={attack} blocks={blocks} busy={false} movedCount={0} aliveCount={2} strike={visual.strike} canRepeat={true} onAttack={setAttack} onToggleBlock={zone=>setBlocks(b=>b.includes(zone)?b.filter(x=>x!==zone):[...b.slice(-1),zone])} onStrike={()=>{}} onRepeat={()=>{}} onToggleAuto={()=>{}}/>:<div className="relative rounded-2xl overflow-hidden" style={{height:340,background:'#294b55'}}><div id="fixture-hero" className="absolute" style={{left:'2%',bottom:0,width:'49%',height:'96%'}}><FighterFigure src={heroArt} combatFrames={getCombatAppearance(visual.appearance)} name="Рагнар" dir={1} alive={visual.heroAlive} won={visual.heroWon} strike={visual.strike} idleSeconds={3.1} combatSpeed={visual.speed} scale={1.22} className="absolute bottom-0 h-full w-full object-contain object-right-bottom"/></div><div id="fixture-enemy" className="absolute" style={{right:'2%',bottom:0,width:'45%',height:'85%'}}><FighterFigure src={visual.enemy==='viking'?heroArt:visual.enemy==='bandit'?banditArt:goblinArt} combatFrames={visual.enemy==='viking'?getCombatAppearance('m2'):getEnemyCombatFrames(visual.enemy==='bandit'?banditArt:goblinArt)} name="Противник" dir={-1} mirror={visual.enemy==='viking'} alive={visual.foeAlive} won={visual.foeWon} strike={visual.strike} idleSeconds={2.8} combatSpeed={visual.speed} className="absolute bottom-0 h-full w-full object-contain object-left-bottom"/></div></div>)}</main>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider><App/></LanguageProvider>);
`;
const out = await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/combat-browser',format:'iife',jsx:'automatic',minify:true,alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':JSON.stringify('/'),'import.meta.env.DEV':'false','import.meta.env.VITE_TERRITORY_RUNES':'"disabled"','process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-combat',setup(b){b.onResolve({filter:/(?:\/game\/|^\.\/)(?:supabase|live|referrals|analytics|cloud)$/},()=>({path:'offline',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:offline,loader:'js'}));}}]});
const shellCss=(await postcss([tailwindcss(),autoprefixer()]).process(readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css;
const css=shellCss+'\n'+(out.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'');
const js=out.outputFiles.find(f=>f.path.endsWith('.js')).text;
writeFileSync('/tmp/territory-combat-preview.html',`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#080d22}${css}</style><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></html>`);
console.log('Offline production combat fixture: /tmp/territory-combat-preview.html');
