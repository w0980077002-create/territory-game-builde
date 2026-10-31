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
const community = read('src/components/SocialQuestsSection.tsx');
const socialApi = read('src/game/socialQuests.ts');

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
// The social reward journey must fail closed on uncertain network outcomes.
// A disabled button alone is not sufficient to prevent same-frame double taps.
assert.match(clan, /const mutationLock = useRef\(false\)/, 'Clan actions need a synchronous single-flight lock');
assert.match(clan, /if \(mutationLock\.current\) return;/, 'Duplicate clan mutations must be rejected');
assert.match(clan, /setState\(null\);\s*setDir\(null\);\s*setError/, 'Unconfirmed clan actions must invalidate stale actionable state');
assert.match(clan, /const loadState = useCallback\(async \(id: string\) => \{\s*setState\(null\)/, 'Clan refresh must not expose stale boss and quest claims');
assert.match(clan, /Retry clan search|Повторить поиск кланов/, 'Clan directory must be recoverable after an uncertain mutation');
assert.match(friends, /const claimLock = useRef\(false\)/, 'Referral claims need a synchronous single-flight lock');
assert.match(friends, /if \(claimLock\.current\) return;/, 'Duplicate referral claims must be rejected');
assert.match(friends, /setStatus\(null\); \/\/ A receipt is authoritative/, 'Referral receipt must invalidate stale pending claims');
assert.match(friends, /\(url \|\| preparedId\) \?/, 'Verified rich Telegram invitation must work when bot lookup fails');
assert.match(community, /const verifyLock = useRef\(false\)/, 'Community quest claims need a synchronous single-flight lock');
assert.match(community, /if \(verifyLock\.current \|\| !status \|\| status\[task\]\) return;/, 'Community claims must reject same-frame duplicates');
assert.match(community, /statusListener\.current\?\.\(result\)/, 'Community status callback should not trigger repeated network loads');
assert.doesNotMatch(community, /\[en, onStatusChange, attempt\]/, 'Changing callback identity must not refetch community quests');
assert.match(socialApi, /validEconomySnapshot\(receipt\.game_state\)/, 'Community reward remains server-receipt-verified');

console.log('Social journey contract PASS: real routes, server-backed priorities, referral claims, mobile navigation, no invented rewards.');
