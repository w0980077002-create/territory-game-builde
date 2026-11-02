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
assert.match(fight, /nextPending\s*\?\s*\(language === 'en' \? 'Starting…' : 'Начинаем…'\)/, 'Pending next action must be visible');

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
assert.equal(first.fightsUntilBoss, 5, 'campaign countdown comes from five actual chapter enemies');
assert.equal(first.chapterFightsCompleted, 0);
assert.equal(first.chapterFightsTotal, 5);
assert.equal(first.chapterBoss.id, atBoss.enemy.id, 'preview must reference the real chapter boss');
assert.equal(atBoss.fightsUntilBoss, 0, 'boss is ready after all chapter encounters');
assert.equal(atBoss.chapterFightsCompleted, 5);
assert.equal(getVictoryJourney({ ...saved, chapterWins: 99 }, 'stage', 2).fightsUntilBoss, 0,
  'malformed old counters must never display negative boss distance');
const nextChapter = getVictoryJourney({ ...saved, currentChapter: 2, chapterWins: 0 }, 'stage', 2);
assert.match(nextChapter.enemy.id, /ch2_enemy_0/, 'show the next chapter after the defeated boss');
assert.equal(nextChapter.chapterFightsCompleted, 0, 'new chapter restarts its real boss path');
const nextTrial = getVictoryJourney({ ...saved, trialLevel: 4 }, 'trial', 2);
assert.equal(nextTrial.enemy.id, 'trial_4', 'trial victory must advance according to stored trial level');
assert.equal(nextTrial.chapterBoss, null, 'trials cannot claim a campaign boss');
assert.equal(nextTrial.fightsUntilBoss, null, 'trials have no campaign countdown');
const capped = getVictoryJourney({
  ...saved, player: { level: 100, xp: 0, xpToNext: 0 },
}, 'stage', 99);
assert.equal(capped.maxLevel, true);
assert.equal(capped.xpPercent, 100);
assert.match(fight, /src=\{getCombatAppearance\(state\.appearance\)\.idle\}/, 'battle still forces male Viking portrait over the selected hero');
assert.match(fight, /data-testid="victory-next-goal"/, 'visible next opponent is missing from PvE victory');
assert.match(fight, /data-testid="victory-xp-label"/, 'victory does not show saved XP progress');
assert.match(fight, /data-testid="pve-boss-path"/, 'real chapter boss path must be visible after victory');
assert.match(fight, /victoryJourney\.fightsUntilBoss === 0/, 'boss-unlocked state must use saved wins');
assert.match(fight, /victoryJourney\.chapterBoss\.maxHp/, 'boss preview must show real catalog stats');
assert.ok(fight.includes('outcome?.won ? getVictoryJourney(state,kind,levelAtFightStart.current)'),
  'victory path must be derived from committed game save, not invented rewards');
console.log('PvE victory motivation PASS: selected hero, saved XP, level up, next enemy/boss/trial and no state mutation.');


// #136: the hero's next goal must be the actual upcoming enemy, and only
// genuinely owned, strictly stronger equipment can be advertised as an upgrade.
const gearBundle = await build({
  entryPoints: ['src/game/heroGearOpportunity.ts'],
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { findHeroGearOpportunity, strictlyStrongerGear } = await import(
  'data:text/javascript;base64,' + Buffer.from(gearBundle.outputFiles[0].text).toString('base64')
);
const worn = { id: 'old-sword', slot: 'weapon', name: 'Old sword', attack: 12, defense: 4 };
const stronger = { id: 'new-sword', slot: 'weapon', name: 'New sword', attack: 14, defense: 4 };
const tradeoff = { id: 'risky-sword', slot: 'weapon', name: 'Risky sword', attack: 20, defense: 1 };
const gearItem = (gear, qty = 1) => ({ id: gear.id, type: 'equipment', qty, equipment: gear });
assert.equal(strictlyStrongerGear(stronger, worn), true);
assert.equal(strictlyStrongerGear(tradeoff, worn), false, 'tradeoffs are not guaranteed upgrades');
assert.equal(strictlyStrongerGear(worn, worn), false);
assert.equal(findHeroGearOpportunity([gearItem(stronger)], {weapon:worn})?.kind, 'upgrade');
assert.equal(findHeroGearOpportunity([gearItem(tradeoff)], {weapon:worn}), null);
assert.equal(findHeroGearOpportunity([gearItem(stronger,0)], {weapon:worn}), null, 'no phantom loot');
assert.equal(findHeroGearOpportunity([gearItem(stronger)], {})?.kind, 'empty');
assert.equal(findHeroGearOpportunity([], {weapon:worn}), null);
const heroShowcase = readFileSync('src/components/HeroShowcase.tsx', 'utf8');
assert.match(heroShowcase, /const nextEnemy = bossReady \? chapter\.boss : \(chapter\.enemies\[chapterWins\]/,
  'hero must show actual next encounter, not the boss before it is unlocked');
assert.match(heroShowcase, /findHeroGearOpportunity\(state\.inventory, player\.equipped\)/,
  'upgrade recommendation must be based on saved gear, not fabricated rewards');
console.log('Hero next-encounter and owned gear-upgrade journey PASS.');


// #136: reveal only the forge materials actually committed by the existing
// Campaign/Trials reward functions. The post-victory equipment action must
// leave the completed fight before navigating, never debit another stone.
const progressionSource = readFileSync('src/game/progression.ts', 'utf8');
const actionsSource = readFileSync('src/game/actions.ts', 'utf8');
assert.match(progressionSource, /forgeMaterials: next\.forgeMaterials \+ 1/,
  'Trials must continue to grant exactly one existing forge material');
assert.match(actionsSource, /forgeMaterials: state\.forgeMaterials \+ \(enemy\.isBoss \? 3 : Math\.random\(\) < 0\.35 \? 1 : 0\)/,
  'Campaign material drops must keep their existing boss/normal probabilities');
assert.match(fight, /const nextState = recordTrialWin\(s, enemy\);/,
  'Trial victory must read the committed next state');
assert.match(fight, /const nextState = recordBattleResult\(consumeBlessing\(s\), enemy, \{ gold, xp: enemy\.rewardXp \}\);/,
  'Campaign victory must read the committed next state');
assert.equal((fight.match(/materials: Math\.max\(0, nextState\.forgeMaterials - s\.forgeMaterials\)/g) || []).length, 2,
  'Both victory paths must display the actual saved material delta, never a guessed drop');
assert.match(fight, /outcome\.materials > 0 &&/,
  'Do not advertise forge loot when the player received none');
assert.match(fight, /data-testid="pve-real-forge-loot"/,
  'Real material reward must be visible after victory');
assert.match(fight, /data-testid="pve-prepare-equipment"/,
  'Victory must offer an equipment preparation action');
assert.match(fight, /outcome\?\.won \? findHeroGearOpportunity\(state\.inventory, state\.player\.equipped\) : null/,
  'Post-victory suggestion must read only saved inventory and currently equipped items');
assert.match(fight, /data-testid="pve-owned-gear-opportunity"/,
  'Show an actual owned upgrade or empty-slot opportunity in the victory path');
assert.match(fight, /gearOpportunity\.kind === 'empty'/,
  'An empty slot must not be described as an upgrade over equipped gear');
assert.match(fight, /gearImprovements\.map\(\(\{ stat, delta \}\)/,
  'Only actual positive stat deltas may be displayed');
assert.match(fight, /Из сохранённого инвентаря, не дополнительная награда за бой/,
  'Do not misrepresent a pre-owned item as new battle loot');
assert.match(fight, /onEquipment=\{onEquipment \? \(\) => \{ nextCancelled\.current = true; onExit\(\); onEquipment\(\); \} : undefined\}/,
  'Upgrade route must reuse existing inventory without spending another stone');
assert.match(fight, /onEquipment=\{onEquipment \? \(\) => \{ nextCancelled\.current = true; onExit\(\); onEquipment\(\); \} : undefined\}/,
  'Equipment navigation must close the fight and cancel pending next-battle work');
assert.match(battle, /onEquipment=\{onEquipment\}/,
  'Use the existing inventory route rather than a duplicate equipment screen');
// A real material drop must lead to the existing Forge, not a fake inventory reward.
// The route is available in both classic modes and returning never auto-spends a stone.
const appForForge = readFileSync('src/App.tsx', 'utf8');
assert.match(fight, /outcome\.won && outcome\.materials > 0 && onForge/, 'Forge CTA requires confirmed positive material delta');
assert.match(fight, /data-testid="pve-visit-forge"/, 'Material loot must offer the actual Forge');
assert.match(fight, /onForge=\{onForge \? \(\) => \{ nextCancelled\.current = true; onExit\(\); onForge\(\); \} : undefined\}/,
  'Forge navigation must cancel pending next fight and exit combat');
assert.match(battle, /onForge=\{onForge\}/, 'Battle must pass the existing Forge action into its result');
assert.match(appForForge, /onForge=\{\(\) => openForge\(undefined, battleView === 'trial' \? 'trial' : 'campaign'\)\}/,
  'Victory Forge route must preserve Campaign vs Trials');
assert.match(appForForge, /setBattleView\(forgeReturnBattleView \?\? 'campaign'\); setForgeReturnBattleView\(null\); setAutoStart\(false\)/,
  'Forge return must not spend stones or lose the selected classic mode');
assert.match(battle, /import\.meta\.env\.BASE_URL \+ "city-bg\.webp"/,
  'Campaign chapter artwork must resolve under the published GitHub Pages subpath');
console.log('PvE forge loop PASS: actual material delta -> existing Forge -> original classic mode, no auto-spend.');

console.log('PvE real forge loot and equipment preparation PASS: saved deltas, no invented drops or duplicate battle.');
