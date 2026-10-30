import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
const app = read('src/App.tsx');
const friends = read('src/components/FriendsScreen.tsx');
const clan = read('src/components/ClanScreen.tsx');
const quests = read('src/components/QuestsScreen.tsx');
const trail = read('src/components/social/SocialTrail.tsx');
const next = read('src/components/social/ClanNextStep.tsx');
const api = read('src/game/clanApi.ts');

assert.match(app, /<FriendsScreen user=\{user\} onHero=\{\(\) => setScreen\('hero'\)\} onNavigate=\{setScreen\}/, 'Friends must navigate through the real game shell');
assert.match(app, /<ClanScreen userId=\{user\.id\} notify=\{notify\} onNavigate=\{setScreen\}/, 'Clan must navigate through the real game shell');
assert.match(app, /<QuestsScreen[\s\S]*?onSocialNavigate=\{setScreen\}/, 'Community quests must navigate through the real game shell');
for (const screen of [friends, clan, quests]) assert.match(screen, /<SocialTrail active=/, 'Every social screen must show the same real route navigation');
for (const route of ['friends', 'clan', 'quests']) {
  assert.match(trail, new RegExp(`id: '${route}'`), `Social trail must contain real ${route} destination`);
  assert.match(app, new RegExp(`'${route}'`), `Destination ${route} must exist in GameShell`);
}
assert.match(trail, /aria-current=\{route\.id === active \? 'page' : undefined\}/, 'Active destination must be accessible');
assert.match(trail, /min-h-12/, 'Social destinations need mobile-sized touch targets');
assert.match(friends, /readyToClaim && <section data-testid="friends-ready-reward"/, 'Real pending referral rewards must be the first action');
assert.match(friends, /status\.registered > status\.qualified/, 'Progress uses confirmed referral counts');
assert.match(friends, /redeemReferrals\(user\.id\)/, 'Referral claims remain server-confirmed');
assert.match(clan, /<ClanNextStep state=\{state\}/, 'Clan priority must use returned clan state');
assert.match(clan, /fetchClanState\(id, userId\)/, 'Clan progress must come from existing server RPC');
for (const target of ['clan-boss-rewards', 'clan-quests', 'clan-boss', 'clan-chat']) {
  assert.ok(clan.includes(`id="${target}"`), `The real ${target} action must be reachable`);
  assert.ok(next.includes(`target: '${target}'`), `Clan priority must point to real ${target}`);
}
assert.match(next, /pending_boss_rewards\.length > 0/, 'No imaginary boss reward');
assert.match(next, /!q\.claimed && q\.progress >= q\.target && q\.member >= q\.member_req/, 'Clan quest requires actual server-completed conditions');
assert.match(next, /state\.boss_attacks_left > 0/, 'Boss action must respect actual available attacks');
assert.match(api, /supabase\.rpc\('clan_state'/, 'Clan state must remain server-backed');
assert.ok(!next.includes('useGame.set(') && !trail.includes('useGame.set('), 'Social navigation and priority must never mutate player progress');
console.log('Social journey contract PASS: real routes, server-backed priorities, referral claims, mobile navigation, no invented rewards.');
