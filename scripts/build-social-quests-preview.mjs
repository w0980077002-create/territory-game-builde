// Offline fixture for the REAL community quest component; fake transport, no live rewards.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const entry = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider} from './src/game/i18n';
import {SocialQuestsSection} from './src/components/SocialQuestsSection';
import {SocialTrail} from './src/components/social/SocialTrail';
import {ClanNextStep} from './src/components/social/ClanNextStep';
function App(){
  const [clanMode,setClanMode]=React.useState('chat');
  const onSocialStatusChange=React.useCallback((status)=>{window.__lastSocialStatus=status},[]);
  const clanState={pending_boss_rewards:clanMode==='reward'?[{boss_no:3,gold:500,earned_at:'2026-10-30'}]:[],
    quests:clanMode==='quest'?[{id:'help',progress:2,target:2,member:1,member_req:1,claimed:false}]:[],
    boss:clanMode==='boss'?{boss_no:3,hp:100,max_hp:200,expires_at:'2026-11-01'}:null,
    boss_attacks_left:clanMode==='boss'?2:0,boss_claimed:false,my_boss_damage:0};
  return <div className="territory-shell" style={{minHeight:'100dvh',padding:'12px',background:'#26180f'}}>
  <LanguageProvider><div className="viking-screen viking-screen--quests space-y-3" style={{maxWidth:'430px',margin:'0 auto'}}>
    <SocialTrail active="quests" onNavigate={route=>{window.__socialRoute=route}} />
    <div data-testid="fixture-clan-modes" className="grid grid-cols-4 gap-1">
      {['reward','quest','boss','chat'].map(mode=><button key={mode} type="button" className="min-h-11 rounded-lg bg-amber-900/60 text-xs text-amber-100" onClick={()=>setClanMode(mode)}>{mode}</button>)}
    </div>
    <ClanNextStep state={clanState} onJump={target=>{window.__clanJump=target}} />
    <SocialQuestsSection userId="fixture" onStatusChange={onSocialStatusChange}/>
  </div></LanguageProvider></div>
}
createRoot(document.getElementById('root')).render(<App/>);`;
const stub = `
export async function socialStatus(){
  window.__socialStatusCalls=(window.__socialStatusCalls||0)+1;
  if(window.__failSocialStatus){window.__failSocialStatus=false;throw new Error('fixture_offline');}
  return window.__serverSocialStatus || {chat:false,news:false};
}
export async function claimSocial(userId,task){
  window.__socialClaimCalls=(window.__socialClaimCalls||[]);
  window.__socialClaimCalls.push({userId,task});
  window.__serverSocialStatus={...(window.__serverSocialStatus||{chat:false,news:false}),[task]:true};
  return {success:true};
}
export function openSocialLink(task){window.__socialOpen=task;}
`;
const out=await build({
  stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},
  bundle:true,write:false,outdir:'/tmp/social-quests-fixture',
  format:'iife',jsx:'automatic',
  alias:{'@':resolve('src')},
  define:{'import.meta.env.BASE_URL':JSON.stringify('/'),'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'mock-social-transport',setup(b){
    b.onResolve({filter:new RegExp('socialQuests')},()=>({path:'social-quests-stub',namespace:'social-stub'}));
    b.onLoad({filter:/.*/,namespace:'social-stub'},()=>({contents:stub,loader:'js'}));
  }}]
});
const baseCss=readFileSync('src/index.css','utf8');
const css=(await postcss([tailwindcss(),autoprefixer()]).process(baseCss,{from:'src/index.css'})).css
  + '\n' + readFileSync('src/components/ui/vikingScreenSkin.css','utf8')
  + '\n' + out.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
const js=out.outputFiles.find(f=>f.path.endsWith('.js')).text;
writeFileSync('/tmp/territory-social-quests-preview.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);
console.log('Social quest offline preview ready (real component, fake transport).');
