import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(p, 'utf8');
const ui = read('src/components/pve/ServerAdventureScreen.tsx');
const battle = read('src/components/BattleScreen.tsx');
const app = read('src/App.tsx');
const bridge = read('src/game/combatV1/receiptAdapter.ts');
const map = read('src/components/MapScreen.tsx');
const canvas = read('src/components/WorldMapCanvas.tsx');

// Regression: classic campaign and trials are not replaced by the server cave.
assert.match(battle, /export type BattleView = 'campaign' \| 'trial' \| 'cave'/);
assert.match(battle, /grid-cols-3/);
assert.match(battle, /label: language === 'en' \? 'Dark Cave' : 'Тёмная пещера'/);
assert.match(battle, /view === 'cave' \? \(/);
assert.match(battle, /<ServerAdventureScreen /);
assert.match(battle, /if \(view === 'cave'\) return;/, 'Never charge legacy stones in cave');
assert.match(battle, /generateChapter\(state.currentChapter\)/);
assert.match(battle, /<PveFight/);
assert.doesNotMatch(battle, /serverMode|legacySelected|showServer|territory_adventure_mode_v3/);
assert.match(map, /onClick=\{onCave\}/);
assert.match(map, /case 'cave': onCave\(\)/);
assert.match(canvas, /id: 'battle', ru: 'Поход'/);
assert.match(canvas, /id: 'cave', ru: 'Тёмная пещера'/);
assert.match(canvas, /'city', 'battle', 'cave', 'arena'/);
assert.match(app, /onCave=\{\(\) => \{ setBattleView\('cave'\)/);
assert.doesNotMatch(app, /<BattleScreen[^>]*isAdmin=/s);

assert.match(app, /restoreAdventureSaveFence\(user\.id\);\s*restoreAdventureStartFence\(user\.id\);/,'Restore fences on EVERY save load, not only on a compile-time flag');
assert.match(app,/restoreAdventureStartFence\(user.id\)/,'fence a pending start before autosave');
assert.ok(app.indexOf('restoreAdventureSaveFence(user.id)') < app.indexOf('setLoaded(true)'),
  'pending server receipt must be fenced before the global autosave subscription begins');

for (const name of ['territory_adventure_progress_v1','requestAdventureStart','restoreAdventureStartFence','requestAdventureSettlement','restoreAdventureSaveFence',
  "action: 'prepare'", "action: 'start'", "action: 'resume'", "action: 'advance'",
  'crypto.randomUUID()', 'getCampaignStage', "document.visibilityState !== 'visible'"])
  assert.ok(ui.includes(name), 'missing server-authoritative control: ' + name);
assert.match(read('src/game/combatV1/receiptAdapter.ts'), /localStorage\.setItem\(startKey\(userId\)/,
 'persist original start operation UUID before any wager request');
assert.match(ui, /localStorage\.setItem\(sessionKey\(userId\)/, 'recover active server session across remounts');
assert.match(ui, /busy \|\| recoverable/, 'block conflicting controls during uncertain receipt');
assert.match(ui, /data-testid="territory-adventure-battle"/, 'server combat should have a visible battle scene');
assert.match(ui, /<FighterFigure /, 'server combat should animate the same 2D fighters used by the classic game');
assert.match(ui, /getEnemyCombatFrames/, 'server enemies should use existing combat pose art');
assert.match(ui, /battleRef\.current\?\.scrollIntoView/, 'mobile must reveal battle after tapping Start');
assert.match(ui, /Array\.isArray\(value\.events\)/, 'animation should use only confirmed server battle events');
assert.match(ui, /getCampaignStage\(\(chapter-1\)\*20\+i\+1\)/, '20 stages per chapter must be rendered');
assert.match(ui, /setProgress\(found\)/, 'unlock progress must arrive from server');
assert.doesNotMatch(ui, /recordBattleResult|spendStones|trialReward|Math\.random|setBalance/,
  'the server campaign must never issue client-side currency, level, experience, or RNG rewards');
assert.match(bridge, /acceptAdventureSettlementReceipt\(/,
  'accept authenticated receipts using existing save-token CAS');
console.log('Dark Cave separate navigation PASS: old campaign, Trials, 3 buttons, cave stages, safe server receipts.');
