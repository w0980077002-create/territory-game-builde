// Create a single-file offline review of REAL React screens with full Tailwind CSS.
// Generates a local-only preview file inside public/; never publishes or calls a server.
import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const destination=resolve('public/qa-responsive-visual.html');
const bundled=await build({
 entryPoints:['scripts/fixtures/responsive-visual-preview.tsx'],
 bundle:true,write:false,outdir:'/tmp/territory-responsive-review',
 format:'iife',jsx:'automatic',target:'es2020',minify:true,
 alias:{'@':resolve('src')},
 define:{
  'import.meta.env.BASE_URL':'"/"',
  'import.meta.env.VITE_SUPABASE_URL':'"https://offline-responsive-visual.invalid"',
  'import.meta.env.VITE_SUPABASE_ANON_KEY':'"offline-fixture-only"',
  'import.meta.env.DEV':'false',
  'process.env.NODE_ENV':'"production"',
 }
});
const js=bundled.outputFiles.find(file=>file.path.endsWith('.js'))?.text;
const componentCSS=bundled.outputFiles.find(file=>file.path.endsWith('.css'))?.text??'';
if(!js)throw new Error('Could not produce visual preview bundle');
const baseCSS=readFileSync('src/index.css','utf8');
const css=(await postcss([tailwindcss({config:resolve('tailwind.config.js')}),autoprefixer()])
 .process(baseCSS,{from:resolve('src/index.css')})).css;
const html=`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>TERRITORY offline visual device checks</title><style>html,body,#root{width:100%;min-height:100%;margin:0}html,body{overflow:hidden;background:#0c1117}${css}\n${componentCSS}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
writeFileSync(destination,html);
console.log('Offline UI preview:',destination,html.length,'chars');
