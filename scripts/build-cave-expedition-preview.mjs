// One portable HTML. No production entry, auth, API, saved game or remote assets.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const testing = process.argv.includes('--test');
const resources = {};
const catalog = await build({ entryPoints: ['src/components/pve/cavePreview/renderer.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { assetPaths } = await import('data:text/javascript;base64,' + Buffer.from(catalog.outputFiles[0].text).toString('base64'));
function files(directory) {
  return readdirSync('public/' + directory, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? files(directory + '/' + entry.name) : [directory + '/' + entry.name]);
}
const paths = [...new Set([...assetPaths(), ...files('assets/territory/cave'), ...files('assets/territory/cave-loot'), 'assets/territory/ui/shop/shop-wood-planks.webp'])];
for (const path of paths) resources[path] = `data:${path.endsWith('.svg') ? 'image/svg+xml' : 'image/webp'};base64,${readFileSync('public/' + path).toString('base64')}`;
const fixture = testing ? `onWorld={w=>{window.__caveDemo={world:w,step:seconds=>{for(let t=0;t<seconds;t+=.025)update(w,.025)},unmount:()=>root.unmount()}}}` : '';
const result = await build({ stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CaveExpeditionPreview} from './src/components/pve/CaveExpeditionPreview';
${testing ? "import {update} from './src/game/cavePreviewWorld/engine';" : ''}
const resources=${JSON.stringify(resources)};
const assetUrl=p=>{if(!resources[p])throw Error('Unbundled asset: '+p);return resources[p]};
const root=createRoot(document.getElementById('root'));
root.render(<CaveExpeditionPreview assetUrl={assetUrl} language={new URLSearchParams(location.search).get("lang") || "ru"} ${testing ? "legacyRules={new URLSearchParams(location.search).has('legacy')}" : ''} ${fixture}/>);`, resolveDir: resolve('.'), loader: 'tsx' }, bundle: true, write: false, outdir: '/tmp/cave-expedition', alias:{'@':resolve('src')}, format: 'iife', jsx: 'automatic', minify: true,
  // This portable fixture must NEVER initialize auth or Supabase. The real game
  // supplies a userId; the preview intentionally does not and stays network-free.
  plugins: [{ name: 'cave-offline-no-cloud', setup(b) {
    b.onResolve({filter: /\/game\/(auth|caveCloudPve)$/}, () => ({path: 'cloud-disabled', namespace: 'offline-cave'}));
    b.onLoad({filter: /.*/, namespace: 'offline-cave'}, () => ({
      contents: 'export const ensurePlayerSession=async()=>{throw Error("No auth in offline Cave")};export const getCavePveStatus=async()=>{throw Error("No cloud in offline Cave")};export const startCavePveRun=async()=>{throw Error("No cloud in offline Cave")};export const finishCavePveRun=async()=>{throw Error("No cloud in offline Cave")};',
      loader: 'js'
    }));
  }}],
  define: { 'import.meta.env.BASE_URL': '"./"', 'process.env.NODE_ENV': '"production"' } });
const js = result.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = (await postcss([tailwindcss(),autoprefixer()]).process('@tailwind base; @tailwind components; @tailwind utilities;', {from:'src/index.css'})).css + result.outputFiles.find(f => f.path.endsWith('.css')).text;
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'"><title>TERRITORY — Тёмная пещера</title><style>html,body{margin:0;background:#070b11}button{-webkit-tap-highlight-color:transparent}${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
mkdirSync('artifacts/cave-expedition', {recursive:true});
const file = `artifacts/cave-expedition/${testing ? 'test-fixture' : 'territory-cave-demo'}.html`;
writeFileSync(file, html);
console.log(`${file}: ${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MiB; ${Object.keys(resources).length} embedded images; connect-src NONE`);
