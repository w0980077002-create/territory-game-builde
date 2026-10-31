import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/game/starterJourney.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { getStarterMilestones, shouldShowStarterJourney } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const state = { player: { level: 1, equipped: {} }, inventory: [], totalBattlesWon: 0 };

let steps = getStarterMilestones(state);
assert.deepEqual(steps.map(step => step.done), [false, false, false, false]);
assert.deepEqual(steps.map(step => step.destination), ['battle', 'battle', 'shop', 'battle']);
assert.equal(steps[0].titleRu, 'Победи первого врага');

state.totalBattlesWon = 3;
steps = getStarterMilestones(state);
assert.deepEqual(steps.map(step => step.done), [true, true, false, false]);
assert.equal(steps[2].destination, 'shop', 'Players without gear should be sent to the Shop');

state.inventory = [{ type: 'equipment' }];
assert.equal(getStarterMilestones(state)[2].destination, 'shop', 'A malformed item must not send a player to an empty equipment tab');
state.inventory = [{ type: 'equipment', equipment: { slot: 'weapon' } }];
assert.equal(getStarterMilestones(state)[2].destination, 'inventory', 'Players with gear in the bag should be sent to Inventory');
state.player.equipped.weapon = { name: 'Starter sword' };
assert.equal(getStarterMilestones(state)[2].done, true, 'Only actually equipped gear completes the step');
state.player.level = 5;
assert.ok(getStarterMilestones(state).every(step => step.done));

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
assert.match(home, /state\.totalBattlesWon === 0/, 'Preserve existing first-fight hint on the home scene');
assert.match(home, /shouldShowStarterJourney\(state\) \? getStarterMilestones\(state\)/, 'Home roadmap must serve all heroes missing first victories');
assert.match(home, /data-testid="home-hero-path"/, 'The existing quest strip is the roadmap entry point');
assert.match(home, /onClick=\{\(\) => onOpen\('quests'\)\}/, 'Roadmap button opens the real quest screen');
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
console.log('Starter journey PASS: first fights regardless of hero level, gear/shop routing, level 5, existing progress only, quiet for veterans, real navigation.');
