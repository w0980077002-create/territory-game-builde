import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/game/starterJourney.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { getHeroPathDestination, getNextStarterMilestone, getStarterMilestones, shouldShowStarterJourney } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const state = { player: { level: 1, equipped: {} }, inventory: [], totalBattlesWon: 0 };

let steps = getStarterMilestones(state);
assert.deepEqual(steps.map(step => step.done), [false, false, false, false]);
assert.deepEqual(steps.map(step => step.destination), ['battle', 'battle', 'shop', 'battle']);
assert.equal(steps[0].titleRu, 'Победи первого врага');
assert.equal(getNextStarterMilestone(steps)?.id, 'first-fight', 'First fight always comes first');
assert.equal(getHeroPathDestination(getNextStarterMilestone(steps), 0), 'battle', 'City first objective opens real campaign, not quests');
assert.equal(getHeroPathDestination(getNextStarterMilestone(steps), 1), 'quests', 'Claimable quest takes priority over first fight');
state.totalBattlesWon = 1;
steps = getStarterMilestones(state);
assert.equal(getNextStarterMilestone(steps)?.id, 'three-fights', 'No owned equipment: continue fighting, never push an unfunded shop purchase');
assert.equal(getHeroPathDestination(getNextStarterMilestone(steps), 0), 'battle', 'After first win, City continues campaign');

state.totalBattlesWon = 3;
steps = getStarterMilestones(state);
assert.deepEqual(steps.map(step => step.done), [true, true, false, false]);
assert.equal(steps[2].destination, 'shop', 'Players without gear should be sent to the Shop');
assert.equal(getHeroPathDestination(getNextStarterMilestone(steps), 0), 'shop', 'After three wins with no gear, City opens existing shop');

state.inventory = [{ type: 'equipment' }];
assert.equal(getStarterMilestones(state)[2].destination, 'shop', 'A malformed item must not send a player to an empty equipment tab');
state.inventory = [{ type: 'equipment', qty: 0, equipment: { slot: 'weapon' } }];
assert.equal(getStarterMilestones(state)[2].destination, 'shop', 'Zero-count legacy stacks must not advertise equippable loot');
state.inventory = [{ type: 'equipment', qty: -2, equipment: { slot: 'weapon' } }];
assert.equal(getStarterMilestones(state)[2].destination, 'shop', 'Negative-count inventory entries cannot unlock equipment guidance');
state.inventory = [{ type: 'equipment', qty: Number.NaN, equipment: { slot: 'weapon' } }];
assert.equal(getStarterMilestones(state)[2].destination, 'shop', 'Invalid quantities cannot unlock equipment guidance');
state.inventory = [{ type: 'equipment', qty: 1, equipment: { slot: 'unknown' } }];
assert.equal(getStarterMilestones(state)[2].destination, 'shop', 'Unknown legacy slots cannot unlock equipment guidance');
state.inventory = [{ type: 'equipment', qty: 1, equipment: { slot: 'weapon' } }];
assert.equal(getStarterMilestones(state)[2].destination, 'inventory', 'Players with real positive-count gear in the bag should be sent to Inventory');
state.totalBattlesWon = 1;
assert.equal(getNextStarterMilestone(getStarterMilestones(state))?.id, 'first-equipment', 'Owned loot after first victory takes priority over two repetitive fights');
assert.equal(getHeroPathDestination(getNextStarterMilestone(getStarterMilestones(state)), 0), 'inventory', 'Owned gear opens equipment from City');
state.totalBattlesWon = 3;
state.player.equipped.weapon = { name: 'Starter sword' };
assert.equal(getStarterMilestones(state)[2].done, true, 'Only actually equipped gear completes the step');
assert.equal(getNextStarterMilestone(getStarterMilestones(state))?.id, 'level-five', 'After equipping and three wins, level-up is next');
state.player.level = 5;
assert.ok(getStarterMilestones(state).every(step => step.done));
assert.equal(getNextStarterMilestone(getStarterMilestones(state)), undefined, 'Completed guide must not invent another objective');
assert.equal(getHeroPathDestination(undefined, 0), 'quests', 'Completed roadmap falls back to existing quests');
assert.equal(getHeroPathDestination(undefined, 2), 'quests', 'Claimable quest always remains reachable');

const quests = readFileSync('src/components/QuestsScreen.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const home = readFileSync('src/components/HomeScreen.tsx', 'utf8');
assert.match(quests, /shouldShowStarterJourney\(state\) \? getStarterMilestones\(state\)/, 'Quest guide must include heroes without their first three victories');
assert.match(quests, /onNavigate\(starterNext\.destination\)/, 'Guide action must open the actual game section');
assert.match(app, /if \(target === 'inventory'\) setInventoryTab\('equipment'\)/, 'Equipment guidance opens the equipment tab');
assert.match(app, /if \(target === 'shop'\) setShopTab\('equipment'\)/, 'Shop guidance opens the equipment tab');
assert.match(app, /if \(target === 'battle'\) \{ setBattleView\('campaign'\); setAutoStart\(false\); \}/, 'Beginner battle guidance opens the campaign without charging automatically');
const fight = readFileSync('src/components/pve/PveFight.tsx', 'utf8');
assert.match(fight, /state\.quests\.some\(q => !q\.claimed && q\.current >= q\.target\)/, 'Only genuinely ready quests are suggested after combat');
assert.match(fight, /try \{ hapticImpact\('light'\); \} catch \{/,
  'A missing Telegram haptics bridge must not cancel an already paid PvE round');
assert.match(fight, /onQuests=\{onQuests \? \(\) => \{ nextCancelled\.current = true; onExit\(\); onQuests\(\); \} : undefined\}/,
  'Collecting a ready quest must close the settled fight before navigating away');
assert.match(fight, /onForge=\{onForge \? \(\) => \{ nextCancelled\.current = true; onExit\(\); onForge\(\); \} : undefined\}/,
  'Forge navigation must close the settled fight before returning to adventure');
assert.match(fight, /\{onForge && \(outcome\.materials > 0 \|\| !outcome\.won\) && \(/,
  'A defeated hero must be able to open the existing Forge without inventing loot');
assert.match(fight, /\{onEquipment && \(/,
  'A defeated hero must be able to compare and equip owned gear before retrying');
assert.match(fight, /Check equipment before retrying/,
  'The defeat route must explain why equipment preparation matters');

assert.match(home, /state\.totalBattlesWon === 0/, 'Preserve existing first-fight hint on the home scene');
assert.match(home, /shouldShowStarterJourney\(state\) \? getStarterMilestones\(state\)/, 'Home roadmap must serve all heroes missing first victories');
assert.match(home, /data-testid="home-hero-path"/, 'The existing quest strip is the roadmap entry point');
assert.match(home, /getHeroPathDestination\(starterNext, questAlerts\.readyCount\)/, 'City must resolve the real destination with quest-claim priority');
assert.match(home, /heroPathDestination === 'inventory'\) onInventory\('equipment'\)/, 'Owned gear opens the equipment tab');
assert.match(home, /heroPathDestination === 'battle'\) onBattle\('campaign'\)/, 'First-fight roadmap opens manual campaign without automatic stone debit');
assert.match(home, /heroPathDestination === 'shop'\) onOpen\('shop'\)/, 'Missing equipment routes to the existing shop');
assert.match(home, /heroPathDestination === 'arena'\) onOpen\('arena'\)/, 'Future arena objectives route to the existing Arena');
assert.match(home, /else onOpen\('quests'\)/, 'Ready quest claims and completed roadmap open existing quests');
assert.match(home, /getNextStarterMilestone\(starterSteps\)/, 'City must prioritize actual owned loot after the first win');
assert.match(quests, /getNextStarterMilestone\(starterSteps\)/, 'Quest screen must show the same next objective as City');
assert.match(home, /questAlerts\.readyCount === 0/, 'Ready rewards must take visual priority');
assert.match(home, /starterNext\.titleRu/, 'Home must reveal the next real objective from saved progress');
assert.match(home, /\{starterDone\}\/4/, 'The hero path progress must update with completed milestones');
assert.match(quests, /data-testid="quest-hero-path"/, 'Quests must display the matching hero path');
assert.match(quests, /from-yellow-300 via-amber-400 to-amber-600/, 'Hero path must follow the approved gold Viking style');
assert.doesNotMatch(quests, /starter.*rewardGold|starter.*rewardGems/i, 'Guide must not invent client-side rewards');
const noWinsHighLevel = { ...state, player: { ...state.player, level: 82 }, totalBattlesWon: 0 };
assert.equal(shouldShowStarterJourney(noWinsHighLevel), true,
  'Manually raised hero levels must not hide guidance from players with zero campaign wins');
assert.equal(shouldShowStarterJourney({ ...noWinsHighLevel, totalBattlesWon: 2 }), true,
  'Player still missing third victory receives an explicit goal');
assert.equal(shouldShowStarterJourney({ ...noWinsHighLevel, totalBattlesWon: 3 }), false,
  'Experienced players stop receiving early journey guidance');
assert.match(fight, /kind === 'stage' && state\.totalBattlesWon === 0/,
  'First manual battle must teach zones even if hero level was administratively raised');
console.log('Starter journey PASS: owned loot prioritized after first victory, first fights regardless of hero level, gear/shop routing, level 5, existing progress only, quiet for veterans, real navigation.');
