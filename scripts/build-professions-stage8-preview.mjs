/** Actual Stage8 component, production CSS/API parser, intercepted offline transport. */
import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const actions=`let state={player:{equipped:{},gems:1500,hp:100,maxHp:100},inventory:[],belt:[null,null,null],professions:{active:'smith',masteryLevel:300,masteryXp:0,lastGatherAt:0}};const listeners=new Set();export const useGame={get:()=>state,set:s=>{state={...state,...s};listeners.forEach(f=>f());},subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);}};export const useAccount={get:()=>({user:{id:'11111111-1111-4111-8111-111111111111'}}),set:()=>{}};`;
const transport=`import catalog from '${resolve('supabase/staged/territory_profession_stage8_catalog.json')}';
const owner='11111111-1111-4111-8111-111111111111';const resources=Object.fromEntries(['gather-ore','gather-herb','gather-wood','gather-hide','gather-crystal'].map(id=>[id,999]));let items=[];let seen=new Map();window.__craftCalls=[];
export const supabase={auth:{getUser:async()=>({data:{user:{id:owner}},error:null})},rpc:async(name,args={})=>{
if(name==='territory_profession_stage8_status')return {error:null,data:{enabled:true,version:catalog.version,profession:window.__profession??'smith',mastery_level:300,mastery_xp:0,daily_xp_used:0,daily_xp_cap:300,master_license:true,resources}};
if(name==='territory_profession_stage8_inventory')return {error:null,data:{success:true,items}};
if(name==='territory_profession_stage8_execute'){
window.__craftCalls.push(args);if(seen.has(args.p_operation))return {error:null,data:seen.get(args.p_operation)};
const recipe=catalog.recipes.find(r=>r.id===args.p_recipe);for(const ingredient of recipe.ingredients)resources[ingredient.id]-=ingredient.qty;
const item=recipe.output?{item_id:crypto.randomUUID(),recipe_id:recipe.id,item_output:recipe.output,expires_at:['potion','elixir'].includes(recipe.output.type)?new Date(Date.now()+604800000).toISOString():null,equipped_slot:null}:null;if(item)items.push(item);
const receipt={success:true,recipe_id:recipe.id,kind:recipe.kind,item_id:item?.item_id??null,item_output:recipe.output,expires_at:item?.expires_at??null,mastery_level:300,mastery_xp:0,daily_xp_used:0};seen.set(args.p_operation,receipt);return {error:null,data:receipt};}
throw Error('Offline fixture does not implement RPC '+name);
}};`;
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{ProfessionsStage8Screen}from'./src/components/ProfessionsStage8Screen';import{LanguageProvider}from'./src/game/i18n';
createRoot(document.getElementById('root')).render(<LanguageProvider><div className="territory-shell relative max-w-md mx-auto" style={{height:'100dvh',overflow:'hidden'}}><main className="territory-screen overflow-y-auto overflow-x-hidden px-3 py-3" style={{height:'calc(100dvh - 64px)'}}><ProfessionsStage8Screen onNavigate={(screen,tab)=>{window.__navigate={screen,tab};}}/></main><footer style={{height:64}}>TERRITORY 1.0 · Проверка мастерской</footer></div></LanguageProvider>);`;
const out=await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/professions-browser',format:'iife',jsx:'automatic',minify:true,alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':'"/"','import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-transport',setup(b){b.onResolve({filter:/\/game\/actions$|^\.\/actions$/},()=>({path:'actions',namespace:'fixture'}));b.onResolve({filter:/\/game\/supabase$|^\.\/supabase$/},()=>({path:'supabase',namespace:'fixture'}));b.onResolve({filter:/\/game\/analytics$/},()=>({path:'analytics',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='actions'?actions:path==='supabase'?transport:'export function captureGameEvent(){}',loader:'js',resolveDir:resolve('.')}));}}]});
const css=(await postcss([tailwindcss(),autoprefixer()]).process(readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css;
const js=out.outputFiles.find(f=>f.path.endsWith('.js')).text;
writeFileSync('/tmp/professions-stage8-preview.html',`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#080d22}${css}</style><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></html>`);
console.log('Offline actual Stage8 fixture: /tmp/professions-stage8-preview.html');
