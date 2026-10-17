// Offline handler tests: fake credentials and clients, no network or database.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHmac, webcrypto } = require('node:crypto');
const ts = require('typescript');

const token = 'offline-test-bot';
const input = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 111 }) });
const key = createHmac('sha256', 'WebAppData').update(token).digest();
input.set('hash', createHmac('sha256', key).update([...input.keys()].sort().map(k => `${k}=${input.get(k)}`).join('\n')).digest('hex'));

async function run(endpoint, options = {}) {
  const calls = [];
  const results = [...(options.results || [])];
  const admin = {
    async rpc(name, params) { calls.push({ rpc: name, params }); return { data: false, error: null }; },
    from(table) {
      const query = { table, filters: [] };
      calls.push(query);
      const builder = {
        select(columns) { query.select = columns; return this; },
        eq(column, value) { query.filters.push(['eq', column, value]); return this; },
        is(column, value) { query.filters.push(['is', column, value]); return this; },
        update(value) { query.update = value; return this; },
        insert(value) { query.insert = value; return this; },
        maybeSingle() { return Promise.resolve(results.shift() || { data: null, error: null }); },
        then(resolve, reject) { return Promise.resolve(results.shift() || { data: null, error: null }).then(resolve, reject); },
      };
      return builder;
    },
    auth: { admin: {
      async getUserById(id) { calls.push({ getUserById: id }); return options.authLookup || { data: { user: { id, email: 'original-guest@example.test' } }, error: null }; },
      async createUser() { calls.push({ createUser: true }); return options.create || { data: { user: { id: 'new' } }, error: null }; },
      async generateLink(args) { calls.push({ generateLink: args }); return { data: { properties: { hashed_token: 'offline' } }, error: null }; },
      // No deleteUser, listUsers, updateUserById, or upsert: any call fails the test.
    } },
  };
  const client = { auth: {
    async getUser() { return { data: { user: { id: 'old', email: 'original-guest@example.test' } }, error: null }; },
    async verifyOtp() { return { data: { session: { user: { id: options.sessionId || 'old' }, access_token: 'offline', refresh_token: 'offline' } }, error: null }; },
  } };
  let handler;
  const raw = fs.readFileSync(`${__dirname}/../supabase/functions/${endpoint}/index.ts`, 'utf8');
  const js = ts.transpileModule(raw.replace(/^import .*;\n/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  vm.runInNewContext(js, {
    createClient: (_url, apiKey) => apiKey === 'service' ? admin : client,
    Deno: { serve: fn => { handler = fn; }, env: { get: k => ({ TELEGRAM_BOT_TOKEN: token, SUPABASE_URL: 'https://offline.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k] } },
    crypto: webcrypto, URLSearchParams, TextEncoder, Request, Response,
  });
  const response = await handler(new Request('https://offline.test', { method: 'POST', headers: { Authorization: 'Bearer offline' }, body: JSON.stringify({ initData: input.toString() }) }));
  return { status: response.status, body: await response.json(), calls };
}

(async () => {
  let r = await run('telegram-auth', { results: [{ data: { id: 'old' }, error: null }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.id, 'old');
  assert.equal(r.calls.find(c => c.generateLink).generateLink.email, 'original-guest@example.test');
  assert.ok(!r.calls.some(c => c.update || c.insert || c.createUser));
  assert.ok(r.calls.some(c => c.rpc === 'territory_referral_qualify_v1' && c.params.p_telegram_id === 111));
  assert.ok(!r.calls.some(c => c.rpc === 'territory_referral_attach_v1'), 'Absent referral code never attaches');
  console.log('PASS linked login preserves old UUID, email and character');

  r = await run('telegram-auth', { results: [{ data: null, error: { message: 'offline failure' } }] });
  assert.equal(r.status, 500);
  assert.ok(!r.calls.some(c => c.createUser || c.generateLink));
  console.log('PASS lookup failure cannot create a duplicate account');

  r = await run('telegram-auth', { create: { data: null, error: { message: 'already exists' } } });
  assert.equal(r.status, 409);
  assert.ok(!r.calls.some(c => c.insert || c.update || c.generateLink));
  console.log('PASS email conflict cannot adopt or overwrite an existing hero');

  r = await run('telegram-auth', { results: [{ data: { id: 'old' }, error: null }], authLookup: { data: null, error: { message: 'missing' } } });
  assert.equal(r.status, 409);
  assert.ok(!r.calls.some(c => c.generateLink));
  console.log('PASS missing auth identity cannot fall back to another email');

  r = await run('telegram-auth', { results: [{ data: { id: 'old' }, error: null }], sessionId: 'wrong' });
  assert.equal(r.status, 409);
  assert.equal(r.body.access_token, undefined);
  console.log('PASS mismatched session is never returned');

  r = await run('link-telegram', { results: [{ data: null }, { data: { id: 'old', telegram_id: null } }, { data: { id: 'old' } }] });
  assert.equal(r.status, 200);
  const change = r.calls.find(c => c.update);
  assert.ok(change.filters.some(f => f[0] === 'is' && f[1] === 'telegram_id' && f[2] === null));
  assert.ok(change.filters.some(f => f[1] === 'id' && f[2] === 'old'));
  console.log('PASS old guest is linked with conditional update and no auth email change');

  r = await run('link-telegram', { results: [{ data: { id: 'other' } }] });
  assert.equal(r.status, 409);
  assert.ok(!r.calls.some(c => c.update));
  console.log('PASS Telegram already owned by another hero is rejected');

  r = await run('link-telegram', { results: [{ data: null }, { data: { id: 'old', telegram_id: 222 } }] });
  assert.equal(r.status, 409);
  assert.ok(!r.calls.some(c => c.update));
  console.log('PASS another Telegram cannot take over a linked hero');

  r = await run('link-telegram', { results: [{ data: null }, { data: { id: 'old', telegram_id: null } }, { data: null }] });
  assert.equal(r.status, 409);
  console.log('PASS concurrent claim cannot report false success');
})().catch(error => { console.error(error); process.exitCode = 1; });
