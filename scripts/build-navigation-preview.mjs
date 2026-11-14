// Actual application/navigation, isolated boot profile. Never ship this fixture.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { resolve, dirname, basename } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const output = resolve(process.argv[2] || '/tmp/territory-navigation-preview');
if (dirname(output) !== '/tmp' || !basename(output).startsWith('territory-navigation-'))
  throw new Error('Navigation fixture output must be /tmp/territory-navigation-*; never a deploy directory');
const entry = resolve('/tmp/territory-navigation-entry');
mkdirSync(entry, { recursive: true });
writeFileSync(entry + '/index.html', '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script>');
const src = resolve('src');
writeFileSync(entry + '/entry.tsx', `
import React from '${src}/../node_modules/react/index.js';
import {createRoot} from '${src}/../node_modules/react-dom/client.js';
import App from '${src}/App.tsx';
import {LanguageProvider} from '${src}/game/i18n';
import '${src}/index.css';
import '${src}/components/ui/vikingScreenSkin.css';
import '${src}/components/ui/territoryOakUnified.css';
import '${src}/components/ui/oakScreens.css';
createRoot(document.getElementById('root')).render(<LanguageProvider><App/></LanguageProvider>);
`);
const mock = {
  '@/game/auth': `export function useAuth(){return {authState:{status:'authenticated',user:{id:'offline-navigation',displayName:'Offline',telegramId:null,photoUrl:null}}}}`,
  '@/game/cloud': `import {createInitialGame} from '${src}/game/engine';
    export async function loadCloudSave(){return {state:createInitialGame(),arenaRating:0,arenaWins:0,arenaLosses:0,vip:0}}
    export async function saveCloudSave(){return true}`,
  '@/game/pveVictoryRecovery': `export function pendingPveVictoryJournal(){return null}
    export async function recoverPveVictoryOnBoot(id,p){return {state:p.state}}
    export function archiveUnresolvedPveVictoryForCloudEntry(){return false}`,
  '@/game/live': `export {useLive} from '${src}/game/live';
    export function useLiveSync(){};export async function fetchMaintenance(){return false}`,
  '@/admin/api': `export async function isVerifiedAdmin(){return false}`,
  '@/game/fortuneVip': `export async function refreshFortuneVip(){}`,
  '@/game/halloweenCompanionRefresh': `export function watchPumpkinEntitlement(){return ()=>{}}`,
  '@/game/combatV1/receiptAdapter': `export function restoreAdventureSaveFence(){};export function restoreAdventureStartFence(){}`,
  '@/game/socialQuests': `export async function socialStatus(){return null}`,
};
await build({
  configFile: false, root: entry, base: '/', publicDir: false, envDir: entry,
  css: { postcss: { plugins: [tailwindcss({ config: resolve('tailwind.config.js') }), autoprefixer()] } },
  resolve: { alias: { '@': src, 'react': resolve('node_modules/react'), 'react-dom': resolve('node_modules/react-dom') } },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:1'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('offline-navigation-only'),
  },
  plugins: [{ name: 'offline-boot', enforce: 'pre',
    resolveId(source, importer) {
      const key = source.startsWith(src + '/') ? '@' + source.slice(src.length) : source;
      if (importer === src + '/App.tsx' && key in mock) return '\0offline:' + key;
    },
    load(id) {
      if (id === src + '/App.tsx' && process.env.NAV_APP_SOURCE)
        return readFileSync(process.env.NAV_APP_SOURCE, 'utf8');
      if (id.startsWith('\0offline:')) return mock[id.slice('\0offline:'.length)];
    },
  }, react()],
  build: { outDir: output, emptyOutDir: true, manifest: true },
});
console.log('Offline navigation preview:', output);
