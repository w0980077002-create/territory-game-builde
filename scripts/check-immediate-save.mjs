import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/game/immediateSave.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, module: { exports }, console, setTimeout, clearTimeout });
const { createImmediateSaveController } = exports;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Saving starts without the old 1500ms timer. Concurrent updates never cause
// concurrent writes; the latest dirty revision is sent after acknowledgement.
{
  const pending = [];
  const statuses = [];
  let inFlight = 0;
  let peak = 0;
  const ctrl = createImmediateSaveController(
    () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise(resolve => pending.push((ok) => { inFlight--; resolve(ok); }));
    },
    (status) => statuses.push(status),
  );
  ctrl.changed();
  assert.equal(pending.length, 1, 'first write starts synchronously');
  ctrl.changed();
  ctrl.changed();
  assert.equal(pending.length, 1, 'queued changes are not parallel saves');
  pending.shift()(true);
  await tick();
  assert.equal(pending.length, 1, 'fresh write starts after older acknowledgement');
  assert.notEqual(statuses.at(-1), 'saved', 'old acknowledgement must not claim newest change saved');
  pending.shift()(true);
  await tick();
  assert.equal(statuses.at(-1), 'saved');
  assert.equal(peak, 1, 'only one write at a time');
  ctrl.stop();
}

// Failed writes keep the unsaved revision dirty. Recover on online/page
// reactivation and only show saved after a positive server acknowledgement.
{
  const statuses = [];
  let attempts = 0;
  let nextTimer = 0;
  const timers = new Map();
  const schedule = (cb, ms) => { const id = ++nextTimer; timers.set(id, { cb, ms }); return id; };
  const cancel = (id) => timers.delete(id);
  const ctrl = createImmediateSaveController(
    async () => ++attempts >= 2,
    (status) => statuses.push(status), schedule, cancel,
  );
  ctrl.changed();
  await tick();
  assert.equal(statuses.at(-1), 'error', 'failed save stays visible');
  assert.equal(timers.size, 1, 'failed save is scheduled for retry');
  const timer = [...timers.values()][0];
  assert.equal(timer.ms, 2000, 'retry backs off rather than flooding network');
  timer.cb();
  await tick();
  assert.equal(statuses.at(-1), 'saved', 'retry is server-confirmed');
  ctrl.stop();
}

// Background flush does not wait for the retry delay, but cannot bypass
// backend optimistic locking (the writer itself must still return true).
{
  const statuses = [];
  let attempts = 0;
  const timers = new Map();
  const ctrl = createImmediateSaveController(
    async () => ++attempts >= 3,
    (value) => statuses.push(value),
    (callback, delay) => { timers.set(1, { callback, delay }); return 1; },
    () => timers.clear(),
  );
  ctrl.changed();
  await tick();
  ctrl.flush();
  await tick();
  assert.equal(attempts, 2);
  assert.equal(statuses.at(-1), 'error');
  ctrl.flush();
  await tick();
  assert.equal(statuses.at(-1), 'saved');
  ctrl.stop();
}

console.log('Immediate cloud autosave regression tests passed.');
