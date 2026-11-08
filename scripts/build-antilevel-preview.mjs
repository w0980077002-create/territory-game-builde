// Real ForgeScreen + real previewAntiLevel, offline Supabase/cloud stubs. No real player data.
// Every RPC is recorded in window.__rpcCalls so the browser check can prove nothing is spent.
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const outDir = resolve('antilevel-browser');
mkdirSync(outDir, {recursive: true});

const stubs = {
  // Any chained call (from().select().eq()...) resolves to empty data, so mount effects cannot crash.
  '@/game/supabase': `window.__rpcCalls=window.__rpcCalls||[];
const chain=new Proxy(function(){},{get:(t,k)=>k==='then'?(res)=>res({data:null,error:null}):chain,apply:()=>chain});
export const supabase=new Proxy({},{get:(t,k)=>k==='rpc'?(name,args)=>{window.__rpcCalls.push({name,args});return Promise.resolve({data:null,error:{code:'stub',message:'antilevel_preview_stub'}});}:chain});`,
  '@/game/cloud': `export async function saveCloudSave(){return true;}`,
};

const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ForgeScreen} from './src/components/ForgeScreen';
import {useGame} from './src/game/actions';
import {previewAntiLevel} from './src/game/antiLevelPreview';
import {LanguageProvider} from './src/game/i18n';

const base = useGame.get();
const item = {
  id: 'antilevel-proof-50', type: 'equipment', name: 'Proof blade', icon: '⚔️', quantity: 1,
  equipment: {id: 'antilevel-proof-50', name: 'Proof blade', icon: '⚔️', slot: 'weapon', rarity: 'rare',
    level: 50, baseLevel: 1, upgradeCount: 49, attack: 110, baseStats: {attack: 12}},
};
useGame.set({...base, inventory: [item], forgeMaterials: 999,
  player: {...base.player, level: 10, gold: 999999, gems: 0, equipped: {}}});
window.__expectedPreview = previewAntiLevel(item.equipment, 10);
window.__rpcCalls = [];

function App() {
  return <LanguageProvider><div className="min-h-screen bg-[#120d09] p-2">
    <ForgeScreen focusEquipmentId={item.id} userId="antilevel-review" />
  </div></LanguageProvider>;
}
createRoot(document.getElementById('root')).render(<App />);
`;

const result = await build({
  stdin: {contents: entry, resolveDir: resolve('.'), loader: 'tsx'},
  bundle: true, write: false, format: 'iife', jsx: 'automatic', minify: true,
  // Vite-only env used by art/asset helpers; the harness runs at the site root.
  define: {'import.meta.env': JSON.stringify({BASE_URL: '/', MODE: 'production', DEV: false, PROD: true})},
  alias: {'@': resolve('src')},
  plugins: [{
    name: 'antilevel-stubs',
    setup(b) {
      b.onResolve({filter: /^@\/game\/(supabase|cloud)$/}, (args) => ({path: args.path, namespace: 'stub'}));
      b.onLoad({filter: /.*/, namespace: 'stub'}, (args) => ({contents: stubs[args.path], loader: 'js'}));
    },
  }],
  outdir: outDir,
});

const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = (await postcss([tailwindcss(), autoprefixer()]).process(readFileSync('src/index.css', 'utf8'), {from: 'src/index.css'})).css;
writeFileSync(resolve(outDir, 'index.html'),
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#120d09;color:#fff;font-family:system-ui,sans-serif}${css}</style></head>
<body><div id="root"></div><script>${js}</script></body></html>`);
console.log('antilevel preview built:', resolve(outDir, 'index.html'));
