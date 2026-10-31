// Actual SettingsSheet with inert player/server fixtures. No Supabase connection.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const entry = `import React from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from './src/game/i18n';
import { SettingsSheet } from './src/components/home/HomeSheets';
function App() {
  const [open,setOpen]=React.useState(true);
  const [motion,setMotion]=React.useState(true);
  const [background,setBackground]=React.useState('classic');
  return <div className="territory-shell relative" style={{height:'100dvh',background:'#25170e'}}>
    <button id="settings" onClick={()=>setOpen(true)}>Settings</button>
    {open&&<SettingsSheet onClose={()=>setOpen(false)} saveStatus="saved"
      cityMotion={motion} onToggleCityMotion={()=>setMotion(!motion)}
      cityBackground={background} onCityBackgroundChange={setBackground}/>}
  </div>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider><App/></LanguageProvider>);`;
const mockActions = `import {create} from '@/game/store';
export const useGame=create({settings:{speed:1,auto:false},battleStones:25});`;
const mockLive = `import {create} from '@/game/store';
export const useLive=create({mail:[]});
export async function claimMailGrant(){return false}
export async function getClaimedMailHistory(){return {letters:[],hasMore:false}}`;
const mockProgression = `export const DAILY_REWARDS=[];
export const MAIL=[];
export const claimDaily=()=>null;
export const claimMail=()=>null;
export const dailyStatus=()=>({claimedToday:false,dayIndex:0});`;
const mocks = {'actions':mockActions,'live':mockLive,'progression':mockProgression};
const output = await build({
  stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},
  bundle:true,write:false,outdir:'/tmp/territory-comfort',format:'iife',jsx:'automatic',
  alias:{'@':resolve('src')},
  define:{'import.meta.env.BASE_URL':JSON.stringify('/'),'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'no-live-transport',setup(b){
    b.onResolve({filter:/(?:^@\/game\/|\/game\/)(actions|live|progression)(?:\.ts)?$/},args=>({path:args.path.match(/(actions|live|progression)(?:\.ts)?$/)[1],namespace:'comfort-fixture'}));
    b.onLoad({filter:/.*/,namespace:'comfort-fixture'},args=>({contents:mocks[args.path],loader:'js',resolveDir:resolve('.')}));
  }}],
});
const css=(await postcss([tailwindcss(),autoprefixer()]).process(readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css
  + (output.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'');
const js=output.outputFiles.find(f=>f.path.endsWith('.js')).text;
writeFileSync('/tmp/territory-comfort-preview.js', js);
writeFileSync('/tmp/territory-comfort-preview.html',`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/territory-comfort-preview.js"></script></html>`);
