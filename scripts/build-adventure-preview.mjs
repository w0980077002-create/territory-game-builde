import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// Browser-only fixture: actual React adventure UI, fake transport, never real players.
const fixture = String.raw`
let progress = { completed_stage: 0, unlocked_stage: 1, dark_stones: 5 };
let current = null;
const oldState = { player: { gold: 100, equipped: {} }, inventory: [], belt: Array(7).fill(null), activeDays: 1 };
window.__adventureCalls = [];
export const useGame = { get: () => oldState, set: () => {}, subscribe: () => () => {} };
const arenaState = { wins: 0, losses: 0, rating: 1000 };
export const useArena = { get: () => arenaState, subscribe: () => () => {} };
export const useLanguage = () => ({ language: new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'ru' });
export const localizeText = (item, language) => typeof item === 'string' ? item : item?.[language] || item?.ru || '';
export async function ensurePlayerSession() { return true; }
export function restoreAdventureSaveFence() { return null; }
export function restoreAdventureStartFence() { return null; }
export async function requestAdventureStart(userId,command,hooks) {
 window.__adventureCalls.push(command);
 window.__adventureControl=new URLSearchParams(location.search).get('manual') === '1' ? 'manual' : command.control;
 progress = {...progress, dark_stones: progress.dark_stones - 1};
 current=outcome('fighting');
 hooks.applyState(oldState);
 return current;
}
const outcome = status => ({
 success: true, session_id: '11111111-1111-4111-8111-111111111111',
 revision: status === 'fighting' ? 0 : 1,
 state: { status, input: { stage: 1, control: window.__adventureControl || 'manual', rules: { maxEnergy: 100 } },
   actors: { hero: { energy: 35, stats: { hp: 100, maxHp: 100 }, loadout: { skills: [] } },
             enemy: { stats: { hp: status === 'fighting' ? 50 : 0, maxHp: 50 } } } },
 settlement: status === 'fighting' ? null : { outcome: status, reward: status === 'hero_won' ? { gold: 10, xp: 20 } : { gold: 0, xp: 0 } },
});
export const supabase = {
 rpc: async name => ({ data: name === 'territory_adventure_progress_v1' ? { ...progress, active_session_id: current?.state.status === 'fighting' ? current.session_id : null } : null, error: null }),
 functions: { invoke: async (name, args) => {
   window.__adventureCalls.push(args.body);
   if (args.body.action === 'prepare') return { data: window.__profileChanged ? { status: 'reconciliation_required', reason: 'active_session' } : { status: 'ready' }, error: null };
   if (args.body.action === 'start') {
     window.__adventureControl = args.body.control;
     current = outcome('fighting');
     return { data: current, error: null };
   }
   return { data: current || outcome('fighting'), error: null };
 } }
};
export async function requestAdventureSettlement(userId, command, hooks) {
 window.__adventureCalls.push(command);
 if (command.action === 'advance') {
   const result = window.__nextOutcome || 'hero_won';
   current = { ...outcome(result), events: [
     { id: 'confirmed-1', atMs: 1000, actor: 'hero', target: 'enemy', type: 'impact', value: 10 },
     { id: 'confirmed-2', atMs: 1700, actor: 'enemy', target: 'hero', type: 'block', value: 5 },
   ] };
   progress = { completed_stage: result === 'hero_won' ? 1 : 0, unlocked_stage: result === 'hero_won' ? 2 : 1, dark_stones: 4 };
   hooks.applyState(oldState);
 }
 return current || outcome('fighting');
}
`;
const entry = String.raw`import React from 'react';
import { createRoot } from 'react-dom/client';
import { ServerAdventureScreen } from './src/components/pve/ServerAdventureScreen';
function App() {
 const [counter, setCounter] = React.useState(0);
 return <div style={{maxWidth:440,margin:'auto',padding:8,height:'calc(100dvh - 132px)',minHeight:0,boxSizing:'border-box',display:'flex',flexDirection:'column',overflow:'hidden'}}> 
   <button id="remount" style={{position:'absolute',left:-999}} onClick={()=>setCounter(v=>v+1)}>Remount</button>
   <ServerAdventureScreen key={counter} userId="review" onTrial={()=>{window.__onTrial=true}} />
 </div>;
}
createRoot(document.getElementById('root')).render(<App />);
`;
const output = await build({
 stdin: { contents:entry, resolveDir:resolve('.'), loader:'tsx' },
 bundle:true, write:false, outdir:'/tmp/adventure-browser', format:'iife', jsx:'automatic',
 alias: { '@':resolve('src') },
 define: { 'import.meta.env.BASE_URL':JSON.stringify('/'), 'import.meta.env.DEV':'false', 'process.env.NODE_ENV':'"production"' },
 plugins: [{ name:'adventure-fixture', setup(b) {
   b.onResolve({ filter:/\/game\/(?:i18n|actions|auth|supabase|combatV1\/receiptAdapter)$/ }, () => ({ path:'fixture', namespace:'adventure-fixture' }));
   b.onLoad({ filter:/.*/, namespace:'adventure-fixture' }, () => ({ contents:fixture, loader:'js' }));
 } }],
});
const js = output.outputFiles.find(f=>f.path.endsWith('.js')).text;
const baseCss = (await postcss([tailwindcss(),autoprefixer()]).process(readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css;
const css = output.outputFiles.find(f=>f.path.endsWith('.css'))?.text || '';
writeFileSync('/tmp/adventure-preview.html',
 '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<style>html,body{margin:0;background:#0b1220;color:#fff}'+baseCss+'\n'+css+'</style><div id="root"></div><script>'+
 js.replace(/<\/script/gi,'<\\/script')+'</script></html>');
console.log('Adventure browser fixture ready (offline simulated server).');
