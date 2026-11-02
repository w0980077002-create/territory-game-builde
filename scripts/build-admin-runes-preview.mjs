// Standalone real admin component, backed only by Playwright's intercepted API.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {PlayerRunes} from './src/admin/tabs/PlayerRunes';
const confirm=(_question, action)=>{void action().catch(()=>{});};
createRoot(document.getElementById('root')).render(<PlayerRunes playerId="10000000-0000-4000-8000-000000000001" playerName="Test" confirm={confirm}/>);`;
const result = await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',alias:{'@':resolve('src')},define:{'import.meta.env.VITE_SUPABASE_URL':'"http://127.0.0.1:1"','import.meta.env.VITE_SUPABASE_ANON_KEY':'"fixture"','process.env.NODE_ENV':'"production"'}});
writeFileSync('/tmp/territory-admin-runes.html',`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script>`);
