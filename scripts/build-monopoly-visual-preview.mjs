// Produces a local, self-contained HTML review. No server, secrets or publishing.
import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const destination=resolve(process.argv[2]??'/tmp/monopoly-visual-review.html');
const out=await build({entryPoints:['src/components/monopoly/preview.tsx'],bundle:true,write:false,outdir:'/tmp/monopoly-visual-bundle',format:'iife',jsx:'automatic',minify:true,alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':'"./"','import.meta.env.VITE_SUPABASE_URL':'"https://offline-visual.invalid"','import.meta.env.VITE_SUPABASE_ANON_KEY':'"offline-visual-only"','import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'}});
let js=out.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=out.outputFiles.find(f=>f.path.endsWith('.css')).text;
const images={};for(const file of ['art-atlas.png','hero-frames.png','lagoon.png','ship.webp']){const mime=file.endsWith('.png')?'image/png':'image/webp';images[`./monopoly/${file}`]=`data:${mime};base64,${readFileSync('public/monopoly/'+file).toString('base64')}`;}
// All game illustrations are embedded; opening the HTML needs no local server.
for(const [path,dataUrl]of Object.entries(images))js=js.split(path).join(dataUrl);
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>TERRITORY — Монополия: визуальный просмотр</title><style>html,body{margin:0;background:#071e29}body{padding:8px;font-family:Georgia,serif}button{font:inherit}.visual-review-label{max-width:520px;margin:0 auto 8px;text-align:center;color:#bfdad7;font:10px/1.5 Arial,sans-serif}${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
mkdirSync(resolve(destination,'..'),{recursive:true});writeFileSync(destination,html);console.log('Created offline visual preview: '+destination+' ('+Buffer.byteLength(html)+' bytes). Fixtures only; not a browser verification.');
