import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(p, 'utf8');
const ui = read('src/components/pve/ServerAdventureScreen.tsx');
const battle = read('src/components/BattleScreen.tsx');
const app = read('src/App.tsx');
const bridge = read('src/game/combatV1/receiptAdapter.ts');

assert.match(battle, /VITE_TERRITORY_V1_SERVER_COMBAT === 'verified'/);
assert.match(battle, /SERVER_ADVENTURE_OPT_IN && view === 'campaign'/);
assert.match(battle, /if \(SERVER_ADVENTURE_OPT_IN && view === 'campaign'\) return;/);
assert.match(app, /VITE_TERRITORY_V1_SERVER_COMBAT === 'verified'/);
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
assert.match(ui, /getCampaignStage\(\(chapter-1\)\*20\+i\+1\)/, '20 stages per chapter must be rendered');
assert.match(ui, /setProgress\(found\)/, 'unlock progress must arrive from server');
assert.doesNotMatch(ui, /recordBattleResult|spendStones|trialReward|Math\.random|setBalance/,
  'the server campaign must never issue client-side currency, level, experience, or RNG rewards');
assert.match(bridge, /acceptAdventureSettlementReceipt\(/,
  'accept authenticated receipts using existing save-token CAS');
console.log('Adventure client UI contract PASS: dual gate, server progress, durable command recovery, no client-authoritative grants, autosave fence.');
