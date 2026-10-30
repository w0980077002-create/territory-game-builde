import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(p, 'utf8');
const ui = read('src/components/pve/ServerAdventureScreen.tsx');
const battle = read('src/components/BattleScreen.tsx');
const app = read('src/App.tsx');
const bridge = read('src/game/combatV1/receiptAdapter.ts');
const map = read('src/components/MapScreen.tsx');
const canvas = read('src/components/WorldMapCanvas.tsx');

assert.match(map, /data-testid="map-server-adventure-entry"/,'Adventure must be visible directly on the map without opening a drawer');
assert.match(map, /onClick=\{\(\) => onNavigate\('battle'\)\}/,'Map entry must open the actual battle screen');
assert.match(canvas, /id: 'battle', ru: 'Приключения · 100 этапов'/,'100-stage Adventure must have its own map landmark');
assert.match(canvas, /'city', 'battle', 'arena'/,'Adventure landmark must remain visible at minimum zoom');
assert.match(battle, /territory_adventure_mode_v3/,'Real server adventure gate must be accessible from gameplay');
assert.doesNotMatch(battle, /p_owner_preview|isAdmin|serverOptIn/,'The server campaign must not require the admin panel');
assert.match(battle, /legacySelected/,'Classic campaign remains an explicit in-game choice');
assert.match(battle, /setLegacySelected\(true\)/,'Classic progress is reachable without admin');
assert.match(battle, /setLegacySelected\(false\)/,'New server campaign is reachable without admin');
assert.match(battle, /serverMode === 'enabled' &&/,'Server readiness remains authoritative');
assert.match(battle, /recoveryRequired \|\| serverActive \|\| !legacySelected/,'New campaign should be default; in-flight fights always recover');
assert.doesNotMatch(app, /<BattleScreen[^>]*isAdmin=/s,'Game battle is not tied to admin authentication');
assert.match(battle, /showServer && view === 'campaign'/);
assert.match(battle, /if \(showServer && view === 'campaign'\) return;/);
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
console.log('Adventure client UI contract PASS: dual gate, server progress, durable command recovery, no client-authoritative grants, autosave fence.');
