// Isolated rendering of the production map; route selections are recorded locally.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {WorldMapCanvas} from './src/components/WorldMapCanvas';const lang=localStorage.getItem('territory-language')==='en'?'en':'ru';createRoot(document.getElementById('root')).render(<div className="territory-shell" style={{height:'100dvh'}}><WorldMapCanvas language={lang} onVisit={place=>{window.__route=place}}/></div>);`;
const out=await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/map-fixture',format:'iife',jsx:'automatic',alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':JSON.stringify('/'),'process.env.NODE_ENV':'"production"'}});
const css=(await postcss([tailwindcss(),autoprefixer()]).process(readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css+(out.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'');
const js=out.outputFiles.find(f=>f.path.endsWith('.js')).text;
writeFileSync('/tmp/territory-map-preview.html',`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></html>`);
