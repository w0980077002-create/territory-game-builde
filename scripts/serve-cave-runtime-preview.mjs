// Local end-to-end harness: actual UI, receipt adapter, CAS save queue, combat
// service, engine and staged SQL. Only identity and the HTTP transport are fake.
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { createCaveRuntimeFixture, PLAYER } from './fixtures/cave-runtime.mjs';
const f = await createCaveRuntimeFixture();
const baselineSource = process.argv.includes('--before')
  ? execFileSync('git', ['show', 'ad487ce:src/components/pve/ServerAdventureScreen.tsx'], { encoding: 'utf8' }) : null;
const transport = String.raw`
import {create} from './src/game/store';
import {createInitialGame} from './src/game/engine';
export const useGame=create(createInitialGame());
export const useArena=create({wins:0,losses:0,rating:1000});
export async function ensurePlayerSession(){return true;}
export async function call(kind,body={}) {
 const r=await fetch('/api/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 return r.json();
}
export const supabase={
 auth:{getUser:async()=>({data:{user:{id:'${PLAYER}'}},error:null})},
 rpc:async name=>name==='territory_adventure_progress_v1'?call('progress',{name}):{data:null,error:{message:'unrelated fixture RPC disabled'}},
 functions:{invoke:async(name,args)=>{
   const response=await call('combat',args.body);
   if(response.error)response.error.context=new Response(JSON.stringify({error:response.error.message}),{status:409});
   // Simulate loss AFTER commit. The real adapter must retain its original UUID.
   if(window.__dropNextAdvance && args.body.action==='advance'){
     window.__dropNextAdvance=false;return {data:null,error:{message:'synthetic lost response'}};
   }
   return response;
 }},
 from:()=>{
   let columns=null;const filters={};
   const builder={update:value=>{columns=value;return builder},select:()=>builder,
     eq:(key,value)=>{filters[key]=value;return builder},
     maybeSingle:()=>call(columns?'save':'row',{columns,filters})};
   return builder;
 }
};
`;
const entry = String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';
import {LanguageProvider,useLanguage} from './src/game/i18n';
import {BattleScreen} from './src/components/BattleScreen';
import {MapScreen} from './src/components/MapScreen';
import {useGame,call} from '@/game/actions';
`;
// Import the real cloud fence and adapter, including their validators. The
// aliases below replace only auth, supabase transport, and the two UI stores.
const app = entry + String.raw`
import {saveTokens,walletVersions} from './src/game/cloud';
import {restoreAdventureSaveFence,restoreAdventureStartFence} from './src/game/combatV1/receiptAdapter';
const nav=[['city','Город','City','nav-city.webp'],['inventory','Инвентарь','Inventory','nav-inventory.webp'],['hero','Герой','Hero','nav-hero-crown.webp'],['battle','Бой','Battle','nav-battle.webp'],['map','Карта','Map','nav-map-parchment.webp'],['games','Игры','Games','nav-games.webp'],['clan','Клан','Clan','nav-clan.webp']];
function App(){const {language}=useLanguage();const en=language==='en';const [view,setView]=React.useState('battle');const [mode,setMode]=React.useState('cave');const [busy,setBusy]=React.useState(false);
return <div className="territory-shell" style={{height:'100dvh',maxWidth:440,margin:'auto',display:'flex',flexDirection:'column',overflow:'hidden'}}>
 <header style={{padding:'8px 12px',color:'#e8c484',fontWeight:800,fontSize:12,flexShrink:0}}>TERRITORY · {en?'DARK CAVE':'ТЁМНАЯ ПЕЩЕРА'} <span style={{float:'right',fontSize:10}}>LOCAL QA</span></header>
 <main style={{flex:1,minHeight:0,padding:'0 6px 6px'}}>{view==='battle'?<BattleScreen userId="${PLAYER}" view={mode} onView={setMode} onActiveChange={setBusy} autoStart={false} onAutoStartHandled={()=>{}} onShop={()=>{}} onQuests={()=>{}} onEquipment={()=>{}}/>:view==='map'?<MapScreen onNavigate={()=>{setMode('campaign');setView('battle')}} onTrial={()=>{setMode('trial');setView('battle')}} onCave={()=>{setMode('cave');setView('battle')}} onCompanions={()=>{}} onRunes={()=>{}}/>:<div style={{padding:20}}><h2>{en?'Inventory visit':'Переход в инвентарь'}</h2><p>{en?'The server attempt is retained.':'Серверная попытка сохранена.'}</p></div>}</main>
 <nav className="territory-nav" aria-label={en?'Main navigation':'Основная навигация'} style={{height:70,flexShrink:0,display:'flex',gap:2,padding:'4px 2px',background:'#18110e',borderTop:'1px solid #805c32'}}>
 {nav.map(([id,ru,label,art])=><button className="nav-btn" type="button" key={id} aria-label={en?label:ru} disabled={busy} onClick={()=>setView(id==='battle'?'battle':id==='map'?'map':'inventory')} style={{flex:1,minWidth:0,border:'1px solid #8a684044',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',background:'#302116'}}><img src={'/'+art} alt="" style={{width:30,height:30,objectFit:'contain'}}/><span style={{fontSize:8}}>{en?label:ru}</span></button>)}
 </nav></div>}
async function boot(){const {data:row}=await call('row');useGame.set(row.game_state);saveTokens.set('${PLAYER}',row.updated_at);walletVersions.set('${PLAYER}',{gold:row.gold,gems:row.gems});restoreAdventureSaveFence('${PLAYER}');restoreAdventureStartFence('${PLAYER}');createRoot(document.getElementById('root')).render(<LanguageProvider><App/></LanguageProvider>);}
boot().catch(error=>{document.body.textContent=String(error);});
`;
const output = await build({ stdin: { contents: app, loader: 'tsx', resolveDir: resolve('.') }, bundle: true, write: false,
  outdir: '/tmp/territory-cave-runtime', format: 'iife', jsx: 'automatic', alias: { '@': resolve('src') },
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'false',
    'import.meta.env.VITE_CAVE_UNIFIED_UI': '"true"', 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'local-transport-only', setup(b) {
    if (baselineSource) b.onLoad({ filter: /\/pve\/ServerAdventureScreen\.tsx$/ }, () => ({ contents: baselineSource, loader: 'tsx', resolveDir: resolve('src/components/pve') }));
    b.onResolve({ filter: /\/pve\/PveFight$|\/DailyShareCard$/ }, () => ({ path: 'unrelated', namespace: 'other-modes' }));
    b.onLoad({ filter: /.*/, namespace: 'other-modes' }, () => ({ contents: 'export function PveFight(){return null} export function DailyShareCard(){return null}', loader: 'js' }));
    b.onResolve({ filter: /(?:^|\/)(?:supabase|auth)$|\/game\/actions$/ }, () => ({ path: 'transport', namespace: 'local' }));
    b.onLoad({ filter: /.*/, namespace: 'local' }, () => ({ contents: transport, loader: 'js', resolveDir: resolve('.') }));
  } }],
});
const css = (await postcss([tailwindcss(), autoprefixer()]).process(readFileSync('src/index.css', 'utf8'), { from: 'src/index.css' })).css;
const html = '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'
  + css + (output.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '') + '</style><div id="root"></div><script>'
  + output.outputFiles.find(file => file.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script') + '</script></html>';
mkdirSync('artifacts/cave-runtime', { recursive: true }); writeFileSync('artifacts/cave-runtime/index.html', html);
let chain = Promise.resolve();
const server = http.createServer((req, res) => {
  if (!req.url.startsWith('/api/')) {
    const path = resolve('public', '.' + req.url.split('?')[0]);
    if (req.url === '/' || req.url.startsWith('/?')) { res.setHeader('Content-Type', 'text/html'); return res.end(html); }
    if (path.startsWith(resolve('public') + '/') && existsSync(path)) {
      res.setHeader('Content-Type', ({ '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png' })[extname(path)] ?? 'application/octet-stream');
      return res.end(readFileSync(path));
    }
    res.statusCode = 404; return res.end('Not found');
  }
  let body = ''; req.on('data', chunk => { body += chunk; });
  req.on('end', () => { chain = chain.then(async () => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const args = JSON.parse(body || '{}'); let data;
      await f.db.exec('RESET ROLE');
      switch (req.url) {
        case '/api/combat':
          await f.db.exec('SET ROLE service_role');
          data = args.action === 'prepare' ? await f.rpc('territory_combat_prepare_profile_v1', [PLAYER]) : await f.exec(args); break;
        case '/api/progress':
          await f.db.exec(`SET ROLE authenticated; SET test.uid='${PLAYER}'`);
          data = await f.rpc('territory_adventure_progress_v1', []); break;
        case '/api/row':
          data = (await f.q('SELECT * FROM public.players WHERE id=$1', [PLAYER]))[0]; break;
        case '/api/save': {
          const { columns: c, filters: v } = args;
          if (v.id !== PLAYER) throw Error('fixture_owner_mismatch');
          data = (await f.q(`UPDATE public.players SET game_state=$1,gold=$2,gems=$3,updated_at=$4,xp=$5,level=$6,max_energy=$7
            WHERE id=$8 AND updated_at=$9 AND gold=$10 AND gems=$11 RETURNING updated_at,gold,gems`,
            [c.game_state, c.gold, c.gems, c.updated_at, c.xp, c.level, c.max_energy, PLAYER, v.updated_at, v.gold, v.gems]))[0] ?? null; break;
        }
        case '/api/inspect':
          data = { sessions: await f.q('SELECT session_id,revision,state FROM territory_private.combat_sessions_v1 WHERE player_id=$1', [PLAYER]),
            settlements: await f.q('SELECT * FROM territory_private.adventure_settlements_v1 WHERE player_id=$1', [PLAYER]),
            stones: await f.q('SELECT balance FROM territory_private.dark_stones_v1 WHERE player_id=$1', [PLAYER]),
            player: (await f.q('SELECT game_state,gold,gems FROM public.players WHERE id=$1', [PLAYER]))[0] }; break;
        case '/api/fixture-health':
          // Synthetic low-HP setup for the independent auto-potion scenario.
          // This endpoint exists only in this localhost test process.
          data = await f.q(`UPDATE territory_private.combat_sessions_v1 SET state=jsonb_set(state,'{actors,hero,stats,hp}','349')
            WHERE player_id=$1 AND state->>'status'='fighting' RETURNING session_id`, [PLAYER]); break;
        default: throw Error('fixture_unknown_endpoint');
      }
      res.end(JSON.stringify({ data, error: null }));
    } catch (error) { res.end(JSON.stringify({ data: null, error: { message: error.message } })); }
  }); });
});
const port = Number(process.env.CAVE_RUNTIME_PORT || 4178);
server.listen(port, '127.0.0.1', () => console.log(`Cave local integration preview ready: http://127.0.0.1:${port} (ephemeral PGlite; no production access)`));
const stop = () => server.close(() => { void f.db.close().then(() => process.exit(0)); });
process.on('SIGTERM', stop); process.on('SIGINT', stop);
