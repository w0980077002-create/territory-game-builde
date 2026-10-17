import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const rendered=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {LanguageProvider} from './src/game/i18n';import {MonopolyAdventure} from './src/components/monopoly/MonopolyAdventure';module.exports=renderToStaticMarkup(<LanguageProvider><MonopolyAdventure onBack={()=>{}}/></LanguageProvider>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',outdir:'/tmp/monopoly-ssr',alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':'"/territory-game-builde/"','import.meta.env.VITE_SUPABASE_URL':'"https://offline-visual.invalid"','import.meta.env.VITE_SUPABASE_ANON_KEY':'"offline-visual-only"','import.meta.env.DEV':'false'}});
const js=rendered.outputFiles.find(f=>f.path.endsWith('.js')).text;
const mod={exports:{}};new Function('require','module','exports',js)(require,mod,mod.exports);const html=mod.exports;
const indices=[...html.matchAll(/data-cell-index="(\d+)"/g)].map(m=>+m[1]);
assert.deepEqual(indices,Array.from({length:28},(_,i)=>i),'exactly 28 rendered cells use real indices');
const labels=[...html.matchAll(/class="mono-cell-number">(\d+)</g)].map(m=>+m[1]);assert.deepEqual(labels,Array.from({length:28},(_,i)=>i+1),'all cells numbered 1–28');
for(const label of ['Подарки','Задания','Награды за круги','Спецпредложения','Джекпот','Правила'])assert.ok(html.includes(label),'missing menu '+label);
assert.ok(!/lucide|🎟|💎|🪨|⚒|🧪|💪|🎒|🏰|👑|⚀|⚁|⚂/.test(html),'no emoji or stock game icons in rendered screen');
for(const path of ['art-atlas.png','hero-frames.png']){const b=readFileSync('public/monopoly/'+path);assert.equal(b[25],6,'generated atlas must have RGBA alpha');}
const component=readFileSync('src/components/monopoly/MonopolyAdventure.tsx','utf8');assert.match(component,/Серверной механики джекпота нет/);
const css=readFileSync('src/components/monopoly/monopoly.css','utf8');assert.match(css,/prefers-reduced-motion/);assert.match(css,/100dvh/);
console.log('Monopoly visual structure PASS: actual component SSR, 28 numbered cells, 6 menu entries, illustrated assets, transparent atlases, honest jackpot, safe-area/reduced-motion rules. NOT a browser screenshot or device validation.');
