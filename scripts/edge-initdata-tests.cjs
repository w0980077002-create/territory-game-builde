const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createHmac, webcrypto } = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');

function encodeInitData(user, timestamp, secret) {
  const input = new URLSearchParams();
  input.set('auth_date', String(timestamp));
  input.set('user', JSON.stringify(user));
  const checkString = [...input.keys()].sort().map(k => `${k}=${input.get(k)}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(secret).digest();
  input.set('hash', createHmac('sha256', key).update(checkString).digest('hex'));
  return input.toString();
}

async function suite(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const start = raw.indexOf('async function verifyInitData(');
  const end = raw.indexOf('\nDeno.serve(', start);
  assert.ok(start !== -1 && end > start);
  const code = ts.transpileModule(raw.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const ctx = { crypto: webcrypto, URLSearchParams, TextEncoder, Date, Array, Number, JSON, MAX_INIT_DATA_AGE_S: 7 * 24 * 60 * 60 };
  vm.runInNewContext(code + '\nthis.verify = verifyInitData;', ctx);
  const token = 'fake-bot-token-for-offline-testing-only';
  const now = Math.floor(Date.now() / 1000);
  const good = encodeInitData({ id: 1234, first_name: 'Tester' }, now, token);
  assert.equal((await ctx.verify(good, token))?.id, 1234);
  assert.equal(await ctx.verify(good, 'wrong-bot-token'), null);
  assert.equal(await ctx.verify(good.replace('Tester', 'Hacker'), token), null);
  assert.equal(await ctx.verify(encodeInitData({ id: 1234 }, now - 8 * 24 * 3600, token), token), null);
  assert.equal(await ctx.verify(encodeInitData({ id: 1234 }, now + 3600, token), token), null);
  assert.equal(await ctx.verify(encodeInitData({ id: -1 }, now, token), token), null);
  console.log('PASS Telegram hash, age, and ID checks:', path);
}

(async()=>{
  await suite(__dirname+'/../supabase/functions/link-telegram/index.ts');
  await suite(__dirname+'/../supabase/functions/telegram-auth/index.ts');
})().catch(e => { console.error(e); process.exitCode = 1; });
