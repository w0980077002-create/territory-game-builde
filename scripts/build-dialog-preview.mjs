// Offline fixture using the production dialogs; never connects to player data.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {LanguageProvider} from './src/game/i18n'; import {RulesModal} from './src/components/arena/ArenaRulesModal'; import {Modal} from './src/components/ui/Modal'; import {ArenaPrizesDialog} from './src/components/arena/ArenaWeeklyBoard';
function App(){const [open,setOpen]=React.useState('');return <div className="territory-shell relative" style={{height:'80dvh',background:'#1d2933'}}><button id="rules" onClick={()=>setOpen('rules')}>Rules</button><button id="prizes" onClick={()=>setOpen('prizes')}>Prizes</button><button id="common" onClick={()=>setOpen('common')}>Item</button>{open==='rules'&&<RulesModal onClose={()=>setOpen('')}/ >}{open==='prizes'&&<ArenaPrizesDialog en={localStorage.getItem('territory-language')==='en'} rank={1} countdown="1d 2h" onClose={()=>setOpen('')}/ >}{open==='common'&&<Modal title="Предмет с длинным названием / Item with a long name" onClose={()=>setOpen('')}><p>Описание предмета / Item description</p><button>Action</button><p style={{height:600}}>Long content</p></Modal>}</div>};createRoot(document.getElementById('root')).render(<LanguageProvider><App/></LanguageProvider>);`;
const out = await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/dialog-fixture',format:'iife',jsx:'automatic',alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':JSON.stringify('/'),'process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-arena',setup(b){b.onResolve({filter:/\/game\/arenaWeekly$/},()=>({path:'arenaWeekly',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export async function getArenaWeeklyStatus(){return null}',loader:'js'}));}}]});
const css=(await postcss([tailwindcss(),autoprefixer()]).process(readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css + out.outputFiles.find(f=>f.path.endsWith('.css')).text;
const js=out.outputFiles.find(f=>f.path.endsWith('.js')).text;
writeFileSync('/tmp/territory-dialog-preview.html',`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></html>`);
