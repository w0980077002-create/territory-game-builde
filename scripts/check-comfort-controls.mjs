import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/game/telegram.ts'], bundle: true, write: false,
  platform: 'node', format: 'esm',
});
const { hapticImpact, hapticNotify, hapticSelection } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
);
const oldWindow = globalThis.window;
const store = new Map();
let impacts = 0, notices = 0, selections = 0;
const webApp = { HapticFeedback: {
  impactOccurred: () => { impacts++; },
  notificationOccurred: () => { notices++; },
  selectionChanged: () => { selections++; },
} };
try {
  globalThis.window = {
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    },
    Telegram: { WebApp: webApp },
  };
  hapticImpact(); hapticNotify('success'); hapticSelection();
  assert.deepEqual([impacts, notices, selections], [1, 1, 1], 'Default feedback remains available');
  window.localStorage.setItem('territory_haptic_feedback', 'off');
  hapticImpact(); hapticNotify('success'); hapticSelection();
  assert.deepEqual([impacts, notices, selections], [1, 1, 1], 'Opt-out blocks all three Telegram feedback types');
  window.localStorage.setItem('territory_haptic_feedback', 'on');
  hapticImpact(); hapticNotify('success'); hapticSelection();
  assert.deepEqual([impacts, notices, selections], [2, 2, 2], 'Opt-in works without a page reload');
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw Error('WebView storage blocked'); } });
  assert.doesNotThrow(() => hapticImpact(), 'Blocked storage must not abort game actions');
  assert.equal(impacts, 3, 'Storage failure falls back to best-effort native feedback');
  webApp.HapticFeedback.impactOccurred = () => { throw Error('unsupported'); };
  assert.doesNotThrow(() => hapticImpact(), 'Broken Telegram SDK never aborts combat');
  delete globalThis.window;
  assert.doesNotThrow(() => hapticNotify('success'), 'No Telegram SDK is safe');
} finally {
  if (oldWindow === undefined) delete globalThis.window;
  else globalThis.window = oldWindow;
}

const sheets = readFileSync('src/components/home/HomeSheets.tsx', 'utf8');
const wheel = readFileSync('src/components/WheelOfFortune.tsx', 'utf8');
const css = readFileSync('src/components/home/settingsJourney.css', 'utf8');
const helper = readFileSync('src/game/hapticPreference.ts', 'utf8');
assert.match(helper, /HAPTIC_PREFERENCE_KEY = 'territory_haptic_feedback'/);
assert.match(helper, /setItem\(HAPTIC_PREFERENCE_KEY, enabled \? 'on' : 'off'\)/);
assert.match(sheets, /role="switch" aria-checked=\{on\}/, 'All settings switches must expose native accessible state');
assert.match(sheets, /on=\{vibrationEnabled\} onChange=\{toggleVibration\}/, 'Live Settings toggle must update the real preference');
assert.match(sheets, /onClick=\{secretTap\}/, 'Existing hidden admin entry must remain unchanged');
assert.match(sheets, /saveStatus === 'error'/, 'Save failure warning must remain visible');
assert.match(wheel, /hapticSelection\(\)/, 'Wheel tick uses the same preference as combat');
assert.match(wheel, /hapticNotify\('success'\)/, 'Wheel win uses the same preference as combat');
assert.doesNotMatch(wheel, /HapticFeedback/, 'Wheel must not bypass the device preference');
assert.match(css, /@media \(max-width: 360px\)/, 'Compact settings must fit narrow Telegram viewports');
assert.match(css, /focus-visible/, 'Switches must retain keyboard focus');
console.log('Comfort controls PASS: device preference, battle/forge/wheel feedback, RU/EN settings, storage and SDK failures.');
