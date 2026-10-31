import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(p, 'utf8');
const ui = read('src/components/pve/ServerAdventureScreen.tsx');
const battle = read('src/components/BattleScreen.tsx');
const app = read('src/App.tsx');
const bridge = read('src/game/combatV1/receiptAdapter.ts');

const arenaSecure = read('src/game/arenaSecure.ts');
assert.match(arenaSecure, /args\.p_action === 'join'/,
  'Cross-mode cave recovery runs on Arena entry only, not during an Arena fight');
assert.match(arenaSecure, /await reconcilePendingCaveBeforeArena\(id,/,
  'Arena must resolve the original cave command before performing a competing CAS save');
assert.ok(arenaSecure.indexOf('await reconcilePendingCaveBeforeArena(id,') < arenaSecure.indexOf('const snapshot = useGame.get();'),
  'Reconcile any pending cave receipt before capturing the Arena snapshot');
assert.match(bridge, /export async function reconcilePendingCaveBeforeArena\(/,
  'Original pending cave commands must be reconciled before unrelated Arena mode');
assert.match(bridge, /await requestAdventureStart\(userId, pendingStart, hooks\)/,
  'Replay only the original cave start UUID, never mint a new operation');
assert.match(bridge, /await requestAdventureSettlement\(userId, pendingAdvance, hooks\)/,
  'Replay only the original pending advance UUID before allowing Arena save');
assert.match(bridge, /error\.message !== 'adventure_definitively_rejected'/,
  'Only a verified 409 rollback may clear a rejected cave operation');
assert.match(bridge, /throw new Error\('cave_recovery_required'\)/,
  'Unknown cave results must keep Arena entry fenced and cannot be skipped');

const map = read('src/components/MapScreen.tsx');
const canvas = read('src/components/WorldMapCanvas.tsx');

// Regression: classic campaign and trials are not replaced by the server cave.
assert.match(battle, /const caveRecoveryNeeded = view !== 'cave'/,
  'An unresolved cave action must not hijack the classic campaign tab');
assert.match(battle, /if \(caveRecoveryNeeded\) \{/,
  'Never spend legacy battle stones while a cave receipt is unresolved');
assert.match(battle, /view === 'cave' \|\| caveRecoveryNeeded/,
  'Autostart must respect the cave receipt fence');
assert.match(battle, /data-testid="pending-cave-recovery"/,
  'Show an explicit recovery action instead of silently switching tabs');
assert.doesNotMatch(battle, /if \(pending\) onView\('cave'\)/,
  'Never silently redirect a campaign player into the cave');
assert.match(battle, /export type BattleView = 'campaign' \| 'trial' \| 'cave'/);
assert.match(battle, /grid-cols-3/);
assert.match(battle, /label: language === 'en' \? 'Dark Cave' : 'Тёмная пещера'/);
assert.match(battle, /view === 'cave' \? \(/);
assert.match(battle, /<ServerAdventureScreen /);
assert.match(battle, /if \(view === 'cave' \|\| caveRecoveryNeeded\) return;/, 'Never charge legacy stones in cave or during unresolved cave recovery');
assert.match(battle, /generateChapter\(state.currentChapter\)/);
assert.match(battle, /<PveFight/);
assert.doesNotMatch(battle, /serverMode|legacySelected|showServer|territory_adventure_mode_v3/);
assert.doesNotMatch(map, /100 этапов · отдельный поход|100 stages · separate campaign/,
  'Dark Cave banner must not cover map with redundant copy');
assert.match(canvas, /id: 'professions', ru: 'Профессии'/,
  'Profession location must be visible and easy to identify');
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
  'crypto.randomUUID()', 'getCampaignStage', "document.addEventListener('visibilitychange'"])
  assert.ok(ui.includes(name), 'missing server-authoritative control: ' + name);
assert.match(read('src/game/combatV1/receiptAdapter.ts'), /localStorage\.setItem\(startKey\(userId\)/,
 'persist original start operation UUID before any wager request');
assert.match(ui, /localStorage\.setItem\(sessionKey\(userId\)/, 'recover active server session across remounts');
assert.match(ui, /busy \|\| recoverable/, 'block conflicting controls during uncertain receipt');
assert.match(ui, /adventure_definitively_rejected/, 'After a verified server rollback the UI must explain safe recovery');
assert.match(ui, /cause\.message !== 'adventure_definitively_rejected'/,
  'A proven 409 rejected duplicate start must auto-recover its existing server fight');
assert.match(ui, /!currentProgress\.active_session_id\) throw cause/,
  'Never switch sessions on a 409 without the owner-scoped active session from the server');
assert.match(ui, /recoveredStart = true/,
  'After safe resume do not try another cave start or recovery request');
assert.match(ui, /data-testid="territory-adventure-battle"/, 'server combat should have a visible battle scene');
assert.match(ui, /data-testid="dark-cave-battle-background"/, 'Cave fights use their own approved cave portal instead of Arena scene');
assert.match(ui, /data-testid="dark-cave-combat-panels"/, 'Cave battle provides compact equipment and elixir inspection panels');
assert.match(ui, /<GearStrip equipped=\{game\.player\.equipped\}/, 'Only saved equipped items are displayed; do not invent combat stats');
assert.match(ui, /<BeltCells belt=\{game\.belt\}/, 'Display the existing seven elixir slots without client-side consumption');
assert.match(ui, /Только просмотр: эффекты эликсиров/, 'Unimplemented cave elixir usage must be labeled truthfully');
assert.match(ui, /data-testid="dark-cave-manual-actions"/, 'Manual combat exposes actual server equipped skills');
assert.match(ui, /cooldowns\[slot\.skillId\]/, 'Skills display server cooldown status');
assert.match(ui, /rank\.energyCost/, 'Skills respect server-reported energy costs');
assert.doesNotMatch(ui, /assets\/territory\/scenes\/arena-viking\.webp/, 'Dark Cave battle cannot silently reuse Arena scenery');
assert.match(ui, /getCombatAppearance\(game\.appearance\)/,
  'Cave must use the saved hero appearance, not always a male viking');
assert.match(ui, /const fighterSrc = heroFrames\.idle;/,
  'Cave fallback art must belong to the selected hero');
assert.match(ui, /setStrikeQueue\(old => \[\.\.\.old, \.\.\.confirmed\]\.slice\(-8\)\)/,
  'Cave must replay multiple genuine server-confirmed hits in order');
assert.match(ui, /data-testid="dark-cave-battle-log"/,
  'Keep confirmed damage and block events visible before optional gear panels');
assert.match(ui, /Продолжить бой/,
  'Manual combat must show an understandable continuation control');
assert.doesNotMatch(ui, /Умения и урон проверяет сервер|Следующий шаг боя/,
  'Remove raw debug language and unclear old action from the live player screen');
assert.match(ui, /<FighterFigure /, 'server combat should animate the same 2D fighters used by the classic game');
assert.match(ui, /getEnemyCombatFrames/, 'server enemies should use existing combat pose art');
assert.match(ui, /battleRef\.current\?\.scrollIntoView/, 'mobile must reveal battle after tapping Start');
assert.match(ui, /Array\.isArray\(value\.events\)/, 'animation should use only confirmed server battle events');
assert.match(ui, /getCampaignStage\(i \+ 1\)/, 'All 100 floors must render from the existing campaign catalog');
assert.match(ui, /dark-cave-floor-scroll/, 'Floor list must support independent vertical scrolling');
assert.match(ui, /floorListRef\.current/, 'Current floor scrolls into view inside the cave');
assert.match(ui, /progress\.unlocked_stage/, 'Current stage remains server-authoritative');
assert.match(ui, /onClick=\{\(\)=>void start\(control\)\}/, 'Challenge passes selected control to server start');
assert.match(ui, /\(\['auto','manual'\] as const\)/, 'Two server-backed cave controls before Dark Stone debit');
assert.match(ui, /dark-cave-challenge-manual/, 'Manual combat must have an actual pre-start button');
assert.match(ui, /progress\.dark_stones<1/, 'Dark Stones must gate the Challenge');
assert.match(ui, /setProgress\(found\)/, 'unlock progress must arrive from server');
assert.doesNotMatch(ui, /recordBattleResult|spendStones|trialReward|Math\.random|setBalance/,
  'the server campaign must never issue client-side currency, level, experience, or RNG rewards');
assert.match(bridge, /acceptAdventureSettlementReceipt\(/,
  'accept authenticated receipts using existing save-token CAS');
assert.match(bridge, /acceptAdventureLatestCloudSnapshot/, 'Replayed historical receipts must use the newest verified cloud save');
assert.match(bridge, /validateAdventureSettlementReceipt/, 'Never skip receipt validation when latest save is newer');
assert.match(bridge, /validateAdventureStartReceipt/, 'Validate a replayed start before adopting latest save');
assert.match(bridge, /id,updated_at,game_state,gold,gems/, 'Reconciliation requires account scoped state and wallet');
assert.match(ui, /const currentProgress = await readProgress\(\);\s*const pending/, 'Load real progress even when recovery fails');
assert.match(ui, /: progress \? <>/, 'Do not invent stage one while progress is missing');
assert.match(ui, /sessionId: result\.session_id/, 'Recover actual session after uncertain advance');
assert.match(ui, /sessionId: started\.session_id/, 'Recover actual session after uncertain start');

const darkSql = read('supabase/staged/territory_dark_stones_20261030.sql');
const darkArt = read('public/assets/territory/items/dark-stone.svg');
assert.match(darkArt, /data:image\/webp;base64,UklGR/, 'Approved violet Dark Stone icon must be bundled');
assert.match(ui, /dark-stone\.svg/, 'Dark Stone image must show in the cave');
assert.match(ui, /dark-cave-floor-list/, 'Dedicated floor selection UI is required');
assert.match(ui, /dark-cave-realm\.svg/, 'A distinct violet abyss scene must be used by the cave');
assert.match(read('public/assets/territory/scenes/dark-cave-realm.svg'), /<svg/, 'Original dark cave art must exist');
assert.doesNotMatch(ui, /Добавить благословение|Режим боя|setBlessingInfo|setControl\(/, 'No fake blessing slots or extra battle mode selector in cave lobby');
assert.match(ui, /min-h-\[168px\]/, 'Cave floor list must reserve space for 3 floor rows on small screens');
assert.match(ui, /data-testid="dark-cave-visual"/, 'Dark cave theme illustration must be visible above floor list');
assert.match(ui, /progress\.dark_stones<1/, 'Never enable entry when no Dark Stones are available');
assert.match(ui, /await readProgress\(\)/, 'Recheck stone balance after server start');
assert.match(darkSql, /dark_stone_take_v1\(p_player\)/, 'Server must atomically consume stone on start');
assert.match(darkSql, /revised_sql:=replace\(revised_sql/, 'Existing arena stones must remain unchanged in receipt');
assert.match(darkSql, /ENABLE ROW LEVEL SECURITY/, 'Private resource table must use RLS');

console.log('Dark Cave separate navigation PASS: old campaign, Trials, 3 buttons, cave stages, safe server receipts.');
