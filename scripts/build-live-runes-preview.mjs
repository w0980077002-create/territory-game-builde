// Local-only mobile fixture: imports the REAL live rune component; never contacts Supabase.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const catalog = JSON.parse(readFileSync('src/game/config/territory-independent-rune-slots-v1.json', 'utf8'));
const slots = catalog.slots.map((slot, i) => ({
  slotId: slot.slotId,
  runeId: i % 2 === 0 ? slot.options[0].runeId : null,
}));
const owned = catalog.slots.flatMap((slot, i) => [
  { runeId: slot.options[0].runeId, level: (i % 3) + 1 },
  { runeId: slot.options[1].runeId, level: 1 },
]);
const fixtureModule = [
  'let revision = 2;',
  'let slots = ' + JSON.stringify(slots) + ';',
  'const owned = ' + JSON.stringify(owned) + ';',
  'let claimed = false;',
  'export const supabase = { async rpc(name, args) {',
  ' if(name === "territory_runes_status_v1") return { data: { schema: "territory-rune-slots/1", revision, slots, owned }, error: null };',
  ' if(name === "territory_runes_save_v1") {',
  '   if(args.p_revision !== revision) return {data:null,error:{message:"rune_revision_conflict"}};',
  '   revision += 1; slots = args.p_slots;',
  '   return {data:{schema:"territory-rune-slots/1",operationId:args.p_operation,revision,slots},error:null};',
  ' }',
  ' if(name === "territory_runes_claim_daily_v1") {',
  '   if(claimed) return {data:null,error:{message:"already_claimed"}};',
  '   claimed = true; return {data:{schema:"territory-rune-daily/1",dayUtc:new Date().toISOString().slice(0,10),runeId:"fire_net_r2",level:1},error:null};',
  ' }',
  ' throw new Error("Unexpected RPC: "+name);',
  ' }};',
].join('\n');
const entry = [
  "import React from 'react';",
  "import { createRoot } from 'react-dom/client';",
  "import { ServerRuneBook } from './src/components/builds/ServerRuneBook';",
  "const language = localStorage.getItem('territory-language') === 'en' ? 'en' : 'ru';",
  "createRoot(document.getElementById('root')).render(",
  "<div className='territory-shell' style={{height:'100dvh',overflow:'auto',padding:4,background:'#1e1411'}}>",
  "<ServerRuneBook language={language}/></div>);",
].join('\n');
const result = await build({
  stdin: { contents: entry, resolveDir: resolve('.'), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', outdir: '/tmp/territory-live-runes',
  jsx: 'automatic', alias: { '@': resolve('src') },
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.VITE_TERRITORY_RUNES': '"enabled"', 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'fake-rune-ledger', setup(b) {
    b.onResolve({ filter: /(^@\/game\/supabase$|\/game\/supabase$)/ }, () => ({ path: 'rune-fixture', namespace: 'rune-fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'rune-fixture' }, () => ({ contents: fixtureModule, loader: 'js' }));
  }}],
});
const appCss = (await postcss([tailwindcss(), autoprefixer()]).process(readFileSync('src/index.css','utf8'), { from:'src/index.css' })).css;
const css = appCss + (result.outputFiles.find(x => x.path.endsWith('.css'))?.text || '');
const js = result.outputFiles.find(x => x.path.endsWith('.js')).text;
writeFileSync('/tmp/territory-live-runes-preview.html',
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body><div id="root"></div><script>' +
  js.replace(/<\/script/gi, '<\\/script') + '</script></body></html>');
console.log('Built isolated real server-rune UI (fake ledger; no network and no player writes)');
