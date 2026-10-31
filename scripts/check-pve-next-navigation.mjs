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
assert.match(fight, /try \{ captureGameEvent\('territory_pve_fight_end',[\s\S]*?\);\s*\}\s*catch \{/,
  'Optional analytics must never abort the actual victory or saved rewards');
console.log('PvE post-battle navigation PASS: cancelled next, optional Telegram haptics and telemetry cannot block battle progression.');


// First-session and veteran victory motivation must use the actual saved
// hero state and the next enemy from the existing campaign/trial catalog.
const journeyBundle = await build({
  entryPoints: ['src/game/victoryJourney.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const { getVictoryJourney } = await import(
  'data:text/javascript;base64,' + Buffer.from(journeyBundle.outputFiles[0].text).toString('base64')
);
const saved = {
  player: { level: 2, xp: 34, xpToNext: 150 },
  currentChapter: 1, chapterWins: 0, trialLevel: 1,
};
const intact = JSON.stringify(saved);
const first = getVictoryJourney(saved, 'stage', 1);
assert.equal(first.level, 2);
assert.equal(first.leveledUp, true);
assert.equal(first.xpPercent, 23);
assert.match(first.enemy.id, /ch1_enemy_0/, 'next fight must be determined by saved campaign progress');
assert.equal(JSON.stringify(saved), intact, 'read-only victory UI may not change saved hero data');
const atBoss = getVictoryJourney({ ...saved, chapterWins: 5 }, 'stage', 2);
assert.equal(atBoss.enemy.isBoss, true, 'show actual next boss, never an invented enemy');
const nextChapter = getVictoryJourney({ ...saved, currentChapter: 2, chapterWins: 0 }, 'stage', 2);
assert.match(nextChapter.enemy.id, /ch2_enemy_0/, 'show the next chapter after the defeated boss');
const nextTrial = getVictoryJourney({ ...saved, trialLevel: 4 }, 'trial', 2);
assert.equal(nextTrial.enemy.id, 'trial_4', 'trial victory must advance according to stored trial level');
const capped = getVictoryJourney({
  ...saved, player: { level: 100, xp: 0, xpToNext: 0 },
}, 'stage', 99);
assert.equal(capped.maxLevel, true);
assert.equal(capped.xpPercent, 100);
assert.match(fight, /src=\{getCombatAppearance\(state\.appearance\)\.idle\}/, 'battle still forces male Viking portrait over the selected hero');
assert.match(fight, /data-testid="victory-next-goal"/, 'visible next opponent is missing from PvE victory');
assert.match(fight, /data-testid="victory-xp-label"/, 'victory does not show saved XP progress');
assert.match(fight, /outcome\.won \? getVictoryJourney\(state,kind,levelAtFightStart\.current\)/,
  'victory path must be derived from committed game save, not invented rewards');
console.log('PvE victory motivation PASS: selected hero, saved XP, level up, next enemy/boss/trial and no state mutation.');
