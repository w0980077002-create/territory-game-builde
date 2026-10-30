import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/game/pveNextAction.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { runDeferredNextBattle } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
);

let starts = 0;
assert.equal(await runDeferredNextBattle(Promise.resolve(), () => true, () => { starts++; return true; }, 30), 'started');
assert.equal(starts, 1, 'a completed referral allows exactly one next fight');

assert.equal(await runDeferredNextBattle(Promise.resolve(), () => false, () => { starts++; return true; }, 30), 'cancelled');
assert.equal(starts, 1, 'unmounted battle must not start a fight');

let settle;
const pending = new Promise(resolve => { settle = resolve; });
let stillHere = true;
const waiting = runDeferredNextBattle(pending, () => stillHere, () => { starts++; return true; }, 100);
stillHere = false; // Player tapped Back or Quests before the referral settled.
settle();
assert.equal(await waiting, 'cancelled');
assert.equal(starts, 1, 'leaving during referral wait must never debit a new stone');

assert.equal(await runDeferredNextBattle(new Promise(() => {}), () => true, () => { starts++; return true; }, 5), 'started');
assert.equal(starts, 2, 'timeout must allow continuing without hanging on referrals');
assert.equal(await runDeferredNextBattle(Promise.reject(Error('offline')), () => true, () => false, 20), 'blocked',
  'a failed start must be reported as blocked rather than silently looking successful');
assert.equal(await runDeferredNextBattle(Promise.resolve(), () => true, () => { throw Error('Telegram SDK unavailable'); }, 20), 'blocked',
  'a thrown next-fight callback must not leave the button permanently disabled');

const fight = readFileSync('src/components/pve/PveFight.tsx', 'utf8');
const battle = readFileSync('src/components/BattleScreen.tsx', 'utf8');
assert.match(fight, /nextCancelled\.current = true; onExit\(\)/, 'Back must cancel a pending next fight');
assert.match(fight, /nextCancelled\.current = true; onQuests\(\)/, 'Opening quests must cancel a pending next fight');
assert.match(fight, /alive\.current && !nextCancelled\.current/, 'Deferred start must check the mounted battle');
assert.match(fight, /questReady=\{state\.quests\.some\(/, 'Claim-ready quests must be offered at every hero level');
assert.doesNotMatch(fight, /questReady=\{state\.player\.level < 5/, 'Do not hide quest rewards from veteran players');
assert.match(battle, /return start\(fight\.kind\)/, 'Next fight must report whether stones were actually spent');
assert.match(battle, /try \{ hapticImpact\('medium'\); \} catch/, 'Telegram haptic errors must not interrupt battle start');
assert.match(fight, /nextPending\? \(language === 'en' \? 'Starting…' : 'Начинаем…'\)/, 'Pending next action must be visible');

// The native Telegram bridge can exist but throw on older WebViews. Neither
// a round's damage nor a finished battle may depend on vibration/telemetry.
const telegramBuild = await build({
  entryPoints: ['src/game/telegram.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { hapticImpact, hapticNotify } = await import(
  'data:text/javascript;base64,' + Buffer.from(telegramBuild.outputFiles[0].text).toString('base64')
);
const oldWindow = globalThis.window;
try {
  delete globalThis.window;
  assert.doesNotThrow(() => hapticImpact('light'), 'No Telegram SDK must be safe');
  assert.doesNotThrow(() => hapticNotify('success'), 'No Telegram SDK must be safe');
  globalThis.window = { Telegram: { WebApp: { HapticFeedback: {
    impactOccurred: () => { throw new Error('WebView vibration unsupported'); },
    notificationOccurred: () => { throw new Error('WebView notification unsupported'); },
  } } } };
  assert.doesNotThrow(() => hapticImpact('light'), 'Broken native vibration must not abort a PvE round');
  assert.doesNotThrow(() => hapticNotify('success'), 'Broken native notification must not abort a victory');
  let impactCount = 0;
  let notifyCount = 0;
  globalThis.window = { Telegram: { WebApp: { HapticFeedback: {
    impactOccurred: () => { impactCount++; },
    notificationOccurred: () => { notifyCount++; },
  } } } };
  hapticImpact('light');
  hapticNotify('success');
  assert.equal(impactCount, 1, 'Working Telegram vibration must still fire');
  assert.equal(notifyCount, 1, 'Working Telegram notification must still fire');
} finally {
  if (oldWindow === undefined) delete globalThis.window;
  else globalThis.window = oldWindow;
}
assert.match(fight, /try \\{ captureGameEvent\\('territory_pve_fight_end',[\\s\\S]*?\\);\\s*\\}\\s*catch \\{/,
  'Optional analytics must never abort the actual victory or saved rewards');
console.log('PvE post-battle navigation PASS: cancelled next, optional Telegram haptics and telemetry cannot block battle progression.');
