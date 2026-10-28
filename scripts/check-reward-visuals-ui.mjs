import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = file => readFileSync(file,'utf8');
const events = read('src/components/EventsScreen.tsx');
const home = read('src/components/home/HomeSheets.tsx');
const messages = read('src/components/MessagesScreen.tsx');
const reward = read('src/components/ui/RewardLootStrip.tsx');
const styles = read('src/components/ui/rewardLootStrip.css');
const mailStyles = read('src/components/home/mailVisuals.css');
const eventsStyles = read('src/components/eventsBoard.css');
const progressing = read('src/game/progression.ts');

for (const asset of ['gold-coin.webp','blue-gem.webp','red-gem.webp','battle-stone.webp','potion-hp-large-viking.webp','ic-mail.webp','assets/territory/ui/wooden-plaque.webp'])
  assert.ok(existsSync('public/'+asset), 'Missing approved art '+asset);
assert.match(events, /<RewardLootStrip reward=\{reward\}/, 'Seven-day gifts should show their real reward imagery');
assert.match(events, /territory-events__journey-progress/, 'Hero path should expose progress');
assert.match(events, /aria-valuenow=\{collectedDays\}/, 'Use real current streak, not imaginary points');
assert.match(events, /rewards\.slice\(0, 7\)/, 'Exactly original 7 day items');
assert.match(events, /onClick=\{onOpen\}/, 'The original claim action must stay reachable');
assert.doesNotMatch(events, /useGame\.set\(|supabase\.rpc\(/, 'Events must not grant rewards');
assert.match(home, /<RewardLootStrip reward=\{reward\}/, 'Calendar and original letters show real reward art');
assert.match(home, /claimMailGrant\(id\)/, 'Existing admin-grant verification unchanged');
assert.match(home, /claimMail\(useGame\.get\(\), id\)/, 'Existing game letters unchanged');
assert.match(home, /claimDaily\(useGame\.get\(\)\)/, 'Existing daily claim unchanged');
assert.match(home, /taps\.current\.count >= 5/, 'Hidden admin entrance unchanged');
assert.match(home, /getClaimedMailHistory\(offset\)/, 'Mail history remains visible');
assert.match(messages, /<MailInbox notify=\{notify\}/, 'Inbox navigation remains unchanged');
assert.match(messages, /<WoodenPlaque>/, 'Approved wooden art used for the heading');
assert.match(reward, /Number\.isSafeInteger\(value\) && value > 0/, 'Only real positive quantities');
assert.doesNotMatch(reward, /useGame\.set|grantRewards\(|claimDaily\(|saveCloudSave|supabase/, 'Reward preview is visual only');
assert.match(styles, /reward-loot--mini/, 'Tiny mobile reward visuals');
assert.match(mailStyles, /territory-mail__letter/, 'Compact mail layout');
assert.match(eventsStyles, /@media\(max-width:370px\)/, 'Small Android layout');
assert.match(progressing, /export const DAILY_REWARDS/, 'Reward source remains canonical');
console.log('T16 reward UI PASS: original prize assets, 7 days, claim routes, server mail history, no new payouts.');
