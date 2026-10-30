// Offline rendering of the production companion panel; no player or server data.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {LanguageProvider} from './src/game/i18n'; import {FollowersPanel} from './src/components/FollowersPanel'; createRoot(document.getElementById('root')).render(<LanguageProvider><div className="territory-shell" style={{padding:12}}><FollowersPanel/></div></LanguageProvider>);`;
const fixture = `import {create} from './src/game/store'; import {createInitialGame} from './src/game/engine'; const seed=createInitialGame(); if(location.search==='?active'){seed.player.level=8;seed.followers[0].unlocked=true;seed.followers[1].unlocked=true;seed.activeFollowerId=seed.followers[0].id;} export const useGame=create(seed);`;
const out=await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/companion-fixture',format:'iife',jsx:'automatic',alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':JSON.stringify('/'),'process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-actions',setup(b){b.onResolve({filter:/\/game\/actions$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js',resolveDir:resolve('.')}));}}]});
const css=(await postcss([tailwindcss(),autoprefixer()]).process(readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css+(out.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'');
const js=out.outputFiles.find(f=>f.path.endsWith('.js')).text;
writeFileSync(process.argv[2] || '/tmp/territory-companion-after.html',`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></html>`);
