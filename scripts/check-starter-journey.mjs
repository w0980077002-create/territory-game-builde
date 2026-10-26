import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/game/starterJourney.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { getStarterMilestones } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
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
assert.equal(getStarterMilestones(state)[2].destination, 'inventory', 'Players with gear in the bag should be sent to Inventory');
state.player.equipped.weapon = { name: 'Starter sword' };
assert.equal(getStarterMilestones(state)[2].done, true, 'Only actually equipped gear completes the step');
state.player.level = 5;
assert.ok(getStarterMilestones(state).every(step => step.done));

const quests = readFileSync('src/components/QuestsScreen.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const home = readFileSync('src/components/HomeScreen.tsx', 'utf8');
assert.match(quests, /state\.player\.level < 5 \? getStarterMilestones\(state\)/, 'Guide must never nag established players');
assert.match(quests, /onNavigate\(starterNext\.destination\)/, 'Guide action must open the actual game section');
assert.match(app, /<QuestsScreen[^>]+onNavigate=\{setScreen\}/, 'App must wire beginner actions to real navigation');
assert.match(home, /state\.totalBattlesWon === 0/, 'Preserve existing first-fight hint on the home scene');
assert.doesNotMatch(quests, /starter.*rewardGold|starter.*rewardGems/i, 'Guide must not invent client-side rewards');
console.log('Starter journey PASS: first fights, gear/shop routing, level 5, existing progress only, hidden from veterans, real navigation and no invented rewards.');
