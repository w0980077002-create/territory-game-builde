import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
// The Vite-specific expression is replaced only in this isolated unit test.
const source = readFileSync(new URL('../src/game/auth.ts', import.meta.url), 'utf8')
  .replaceAll('import.meta.env.', 'testEnv.');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}}).outputText;
const hero = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const state = { session: null, refreshed: null, verifiedId: hero, canReachTelegram: true,
  fetchCalls: 0, refreshCalls: 0 };
const supabase = {
  auth: {
    getSession: async () => ({ data: { session: state.session } }),
    refreshSession: async () => { state.refreshCalls++; return {
      data: { session: state.refreshed }, error: state.refreshed ? null : new Error('refresh failed'),
    }; },
    setSession: async () => ({ data: { user: { id: state.verifiedId } }, error: null }),
  },
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { telegram_id: 12345, photo_url: null, display_name: 'Test hero' },
          error: null,
        }),
      }),
    }),
  }),
};
const exports = {};
vm.runInNewContext(compiled, {
  exports, module: { exports }, console, Date, Map, Promise,
  testEnv: { VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: 'public-test' },
  fetch: async () => {
    state.fetchCalls++;
    if (!state.canReachTelegram) throw new Error('offline');
    return { ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r' }) };
  },
  require: (id) => {
    if (id === './supabase') return { supabase };
    if (id === './telegram') return {
      getTelegramInitData: () => 'signed-init-data',
      initTelegramWebApp: () => {},
      getTelegramUser: () => null,
    };
    if (id === 'react') return {};
    throw new Error('Unexpected import: ' + id);
  },
});
const { ensurePlayerSession } = exports;
const validSession = (id = hero, expires_at = Math.floor(Date.now() / 1000) + 3600) =>
  ({ user: { id }, expires_at });

// Healthy session: keep the current hero, without an unnecessary network login.
state.session = validSession();
assert.equal(await ensurePlayerSession(hero), true);
assert.equal(state.fetchCalls, 0);

// iPhone lost local Supabase session: use server-verified Telegram initData to
// restore the SAME hero, never send a save anonymously.
state.session = null;
assert.equal(await ensurePlayerSession(hero), true);
assert.equal(state.fetchCalls, 1);

// Never permit a different account to replace the hero whose state was loaded.
state.verifiedId = other;
assert.equal(await ensurePlayerSession(hero), false);
state.verifiedId = hero;

// Prefer Supabase refresh for an expired but otherwise correct session.
state.session = validSession(hero, Math.floor(Date.now() / 1000) - 1);
state.refreshed = validSession();
const priorFetches = state.fetchCalls;
assert.equal(await ensurePlayerSession(hero), true);
assert.equal(state.refreshCalls, 1);
assert.equal(state.fetchCalls, priorFetches);

// Offline + no session: fail closed; the autosave scheduler retries later.
state.session = null;
state.canReachTelegram = false;
assert.equal(await ensurePlayerSession(hero), false);
console.log('Verified Telegram session recovery regression tests passed.');
