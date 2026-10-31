// Actual MapScreen, isolated fake gathering transport. Never connects to production.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const entry = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider} from './src/game/i18n';
import {MapScreen} from './src/components/MapScreen';
function App(){
  return <div className="territory-shell" style={{height:'100dvh',width:'100%',overflow:'hidden',background:'#23160c'}}>
    <LanguageProvider><MapScreen
      onNavigate={route=>{window.__mapRoute=route}}
      onTrial={()=>{window.__mapRoute='trial'}}
      onCave={()=>{window.__mapRoute='cave'}}
      onCompanions={()=>{window.__mapRoute='companions'}}
      onRunes={()=>{window.__mapRoute='runes'}}
    /></LanguageProvider>
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);`;
const actions = `import {create} from './src/game/store';
import {createInitialGame} from './src/game/engine';
export const useGame=create(createInitialGame());`;
const transport = `
const mode=new URLSearchParams(location.search).get('mode');
let failOnce=mode==='error';
let wallet={'gather-ore':0};
let active=mode==='ready'?{resource_id:'gather-ore',finishes_at:new Date(Date.now()-2000).toISOString()}:
  mode==='active'?{resource_id:'gather-ore',finishes_at:new Date(Date.now()+14400000).toISOString()}:null;
export const supabase={rpc:async(name,args)=>{
  window.__mapCalls=(window.__mapCalls||[]).concat(name);
  if(name==='territory_gather_status'){
    if(failOnce){failOnce=false;return {data:null,error:{message:'offline fixture'}};}
    return {data:{active,wallet,server_now:new Date().toISOString()},error:null};
  }
  if(name==='territory_gather_start'){
    if(active)return {data:{error:'busy'},error:null};
    active={resource_id:args.p_resource_id,finishes_at:new Date(Date.now()+14400000).toISOString()};
    return {data:{ok:true},error:null};
  }
  if(name==='territory_gather_claim'){
    if(!active||Date.parse(active.finishes_at)>Date.now())return {data:{error:'not_ready'},error:null};
    const id=active.resource_id;wallet[id]=(wallet[id]||0)+1;active=null;
    return {data:{resource_id:id,quantity:wallet[id]},error:null};
  }
  return {data:null,error:{message:'unhandled fixture rpc'}};
}};`;
const out=await build({
  stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},
  bundle:true,write:false,outdir:'/tmp/map-expedition-fixture',
  format:'iife',jsx:'automatic',
  alias:{'@':resolve('src')},
  define:{'import.meta.env.BASE_URL':JSON.stringify('/'),'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'offline-map',setup(b){
    b.onResolve({filter:/\/game\/(actions|supabase)$/},args=>({
      path:args.path.endsWith('actions')?'actions':'supabase',namespace:'map-fixture'
    }));
    b.onLoad({filter:/.*/,namespace:'map-fixture'},args=>({
      contents:args.path==='actions'?actions:transport,
      loader:'js',resolveDir:resolve('.')
    }));
  }}]
});
const css=(await postcss([tailwindcss(),autoprefixer()]).process(
  readFileSync('src/index.css','utf8'),{from:'src/index.css'}
)).css+'\n'+out.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
const js=out.outputFiles.find(f=>f.path.endsWith('.js')).text;
writeFileSync('/tmp/territory-map-expedition-preview.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0"><div id="root"></div><script>${js.replace(/<\\/script/gi,'<\\\\/script')}</script></body></html>`);
console.log('Map expedition offline preview built: real MapScreen, simulated server.');
