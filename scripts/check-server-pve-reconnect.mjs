import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync('src/game/combatV1/api.ts', 'utf8');
const ui = readFileSync('src/components/pve/ServerPveFight.tsx', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const entries = new Map();
const storage = {
  getItem: key => entries.get(key) ?? null,
  setItem: (key, value) => entries.set(key, value),
  removeItem: key => entries.delete(key),
};
const sent = [];
const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: 'test-user' } }, error: null }) },
  functions: { invoke: async (_name, { body }) => {
    sent.push(JSON.parse(JSON.stringify(body)));
    if (sent.length === 1) return { data: null, error: new Error('connection lost after server received command') };
    return { data: { success: true }, error: null };
  } },
};
const mod = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: mod, exports: mod.exports, localStorage: storage, Response,
  require: name => {
    if (name === '../supabase') return { supabase };
    if (name === './service') return { parseCombatCommand: command => command };
    throw Error('Unexpected dependency: ' + name);
  },
});
const { requestCombat, pendingCombatCommand } = mod.exports;
const command = { action: 'start', encounterId: 'ch1_enemy_0', operationId: 'fixed-start-uuid', control: 'manual' };
await assert.rejects(() => requestCombat(command), /combat_request_unavailable/);
assert.equal(JSON.stringify(await pendingCombatCommand()), JSON.stringify(command),
  'Ambiguous network failure must keep the exact original operation');
await assert.rejects(
  () => requestCombat({ ...command, operationId: 'different-uuid' }),
  /combat_retry_pending_operation/,
  'A retry must not open a second paid fight');
await requestCombat(command);
assert.equal(sent.length, 2, 'Only the original operation may reach the server twice');
assert.equal(sent[0].operationId, sent[1].operationId, 'The server sees one idempotency key');
assert.equal(await pendingCombatCommand(), null, 'Only confirmed success clears pending operation');
assert.match(ui, /initialOperationId\.current\?\?\(initialOperationId\.current=crypto\.randomUUID\(\)\)/,
  'Initial connection retries must retain the original start UUID');
assert.match(ui, /if\(receipt\)tick\(\);else void connect\(\)/,
  'Connection error must expose a working retry even before the first receipt');
assert.match(ui, /if\(running\.current\)return;/, 'Concurrent reconnect taps must be locked');
console.log('Server PvE reconnect PASS: same start UUID, durable replay, retry before first receipt, no double start.');
