const fs = require('fs');
const ts = require('typescript');
const vm = require('vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/../src/game/auth.ts', 'utf8');
const js = ts.transpileModule(source, {
  fileName: 'auth.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/import\.meta\.env/g, '({ VITE_SUPABASE_URL: \"https://example.supabase.co\", VITE_SUPABASE_ANON_KEY: \"anon\" })');

async function check(name, { profile, session, telegram, endpoints, expected, expectedId, expectedLinkCalls = 0 }) {
  let current = { status: 'loading' };
  let effect;
  let currentSession = session ? { user: { id: session }, access_token: 'current_token' } : null;
  let linkCalls = 0;
  const records = new Map(Object.entries(profile));
  const api = {
    from() {
      return {
        select() { return this; },
        eq(_key, id) { this.id = id; return this; },
        async maybeSingle() { return { data: records.get(this.id) || null, error: null }; },
      };
    },
    auth: {
      async getSession() { return { data: { session: currentSession } }; },
      async setSession(tokens) {
        assert.ok(tokens.access_token);
        currentSession = { user: { id: endpoints.signedInUser }, access_token: 'new_token' };
        return { data: { user: currentSession.user }, error: null };
      },
      async signOut() { currentSession = null; },
    },
  };
  const imports = {
    react: {
      useState: (value) => { current = value; return [value, (next) => { current = next; }]; },
      useEffect: (fn) => { effect = fn; },
      useCallback: (fn) => fn,
    },
    './supabase': { supabase: api },
    './telegram': {
      getTelegramInitData: () => telegram ? 'signed-data' : '',
      getTelegramUser: () => telegram ? { first_name: 'Тестер', id: 111 } : null,
      initTelegramWebApp: () => {},
    },
  };
  const module = { exports: {} };
  const ctx = {
    module, exports: module.exports,
    require: (name) => { if (!(name in imports)) throw Error(name); return imports[name]; },
    fetch: async (url) => {
      if (url.includes('link-telegram')) {
        linkCalls++;
        if (endpoints.linkOk) {
          const record = records.get(session);
          records.set(session, { ...record, telegram_id: 111 });
        }
        return { ok: !!endpoints.linkOk, json: async () => endpoints.linkOk ? { success: true } : { error: endpoints.linkError || 'telegram_already_linked' } };
      }
      if (url.includes('telegram-auth')) {
        return { ok: !!endpoints.authOk, json: async () => ({ access_token: 't', refresh_token: 'r' }) };
      }
      throw Error(url);
    },
  };
  vm.runInNewContext(js, ctx);
  module.exports.useAuth();
  await effect();
  // promise rejection handled internally in the useEffect closure.
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(current.status, expected, `${name}: ${JSON.stringify(current)}`);
  if (expectedId) assert.equal(current.user.id, expectedId, name);
  assert.equal(linkCalls, expectedLinkCalls, name);
  console.log('PASS', name);
}

(async () => {
  await check('linked user signs in with Telegram', {
    profile: { hero: { telegram_id: 111, display_name: 'Старый герой' } },
    session: null, telegram: true,
    endpoints: { authOk: true, signedInUser: 'hero' }, expected: 'authenticated', expectedId: 'hero',
  });
  await check('old authenticated guest is linked without changing UUID', {
    profile: { old: { telegram_id: null, display_name: 'Старый герой' } },
    session: 'old', telegram: true,
    endpoints: { linkOk: true }, expected: 'authenticated', expectedId: 'old', expectedLinkCalls: 1,
  });
  await check('cached unrelated account does not override Telegram', {
    profile: {
      wrong: { telegram_id: 222, display_name: 'Чужой' },
      correct: { telegram_id: 111, display_name: 'Мой' },
    },
    session: 'wrong', telegram: true,
    endpoints: { authOk: true, signedInUser: 'correct' },
    expected: 'authenticated', expectedId: 'correct',
  });
  await check('Telegram login failure blocks cached profile', {
    profile: { wrong: { telegram_id: 222, display_name: 'Чужой' } },
    session: 'wrong', telegram: true,
    endpoints: { authOk: false }, expected: 'guest',
  });
  await check('old guest link conflict switches to verified Telegram account', {
    profile: {
      guest: { telegram_id: null, display_name: 'Гость' },
      linked: { telegram_id: 111, display_name: 'Настоящий герой' },
    },
    session: 'guest', telegram: true,
    endpoints: { linkOk: false, authOk: true, signedInUser: 'linked' },
    expected: 'authenticated', expectedId: 'linked', expectedLinkCalls: 1,
  });
  await check('failed guest migration must not create a duplicate Telegram hero', {
    profile: { old: { telegram_id: null, display_name: 'Old hero' }, duplicate: { telegram_id: 111 } },
    session: 'old', telegram: true,
    endpoints: { linkOk: false, linkError: 'server_error', authOk: true, signedInUser: 'duplicate' },
    expected: 'guest', expectedLinkCalls: 1,
  });
  await check('outside Telegram existing session remains accessible' , {
    profile: { guest: { telegram_id: null, display_name: 'Гость' } },
    session: 'guest', telegram: false,
    endpoints: {}, expected: 'authenticated', expectedId: 'guest',
  });
  await check('outside Telegram no guest is silently registered', {
    profile: {}, session: null, telegram: false,
    endpoints: {}, expected: 'guest',
  });
})().catch((e) => { console.error(e); process.exitCode = 1; });
