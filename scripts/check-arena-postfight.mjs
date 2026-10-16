import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (name) => readFileSync(name, 'utf8');
const room = read('src/components/arena/ArenaRoom.tsx');
const result = read('src/components/arena/ArenaResultCard.tsx');
const battle = read('src/components/arena/BattleScene.tsx');
const chat = read('src/components/arena/ArenaChat.tsx');
const api = read('src/game/arenaApi.ts');
const pve = read('src/components/pve/PveFight.tsx');
const server = read('supabase/migrations/20261017_arena_postfight_30m_chat.sql');
const lobby = read('src/components/arena/ArenaLobby.tsx');

assert(!room.includes('createPortal'), 'Result must not block the whole viewport');
assert(!room.includes('z-[10000]'), 'No full-screen result modal allowed');
assert(room.indexOf('<ArenaResultCard') > 0, 'Arena result card missing');
assert(room.indexOf('<ArenaChat') > room.indexOf('<ArenaResultCard'), 'Live chat must be after the battlefield result');
assert.match(room, /resultPanel=\{finished \? \(/, 'Result must be passed INTO the battlefield');
assert.match(battle, /\{resultPanel\}/, 'Battlefield must render result in the arena canvas');
assert.match(room, /finished=\{finished\}/, 'Finished fights must hide battle action controls');
assert.match(battle, /!finished && <div className="flex flex-col gap-1\.5 pt-6">/, 'Unused controls must disappear after the fight');
assert.match(result, /arena-result-footbar absolute inset-x-2 bottom-1\.5/, 'Slim bottom reward rail must remain inside the arena');
assert.match(result, /arena-result-banner absolute left-1\/2 top-\[68px\]/, 'Victory title must float above the fighters, not obscure them');
assert.match(result, /arena-result-stage.*absolute inset-0 z-40 pointer-events-none/, 'Overlay must not steal events from battlefield or chat');
assert.match(result, /arena-result-leave pointer-events-auto/, 'Leave button must be clickable inside transparent overlay');
assert.doesNotMatch(result, /rounded-\[22px\]|mt-3 grid grid-cols-4/, 'Oversized victory cards must not return');
assert.match(room, /chatExpired = finished && postFightDeadline !== null && chatSeconds === 0/, 'Use server-backed deadline, not a fresh client timer');
assert.match(room, /\(!view\?\.me\.rewarded && !reward\)/, 'Auto-exit must not discard unclaimed rewards');
assert.match(room, /leaveArena\(roomId\)/, 'Automatic departure must notify the server');
assert.match(api, /arenaPostFightDeadline/, 'Post-fight server deadline RPC missing');
assert.match(chat, /canSend/, 'Chat expiry gating missing');
assert.match(lobby, /30 минут/, 'Arena rules must announce the time limit');
assert.match(result, /VictorySparks/, 'Victory artwork and effects missing');
assert.match(result, /formatPostFightTime/, 'Result countdown missing');
assert.match(result, /arena-result-banner-title/, 'Illustrated victory title is missing');
assert(!result.includes('СЛАВА ПОБЕДИТЕЛЮ') && !result.includes('GLORY TO THE CHAMPION'), 'Remove the distracting victory caption in both languages');
assert(!result.includes('titleCaption'), 'No extra banner caption may remain');
const belt = read('src/components/arena/BeltBar.tsx');
assert.match(room, /<BeltBar\s+compact/, 'Compact elixir slots must be visible without expanding a fold');
assert(room.indexOf('<BeltBar') < room.indexOf('<ArenaChat'), 'Elixirs must be above the arena chat, below the battle');
assert(room.indexOf('<BeltBar') > room.indexOf('<BattleScene'), 'Elixirs must follow the fight');
assert.equal((room.match(/<BeltBar/g) ?? []).length, 1, 'Do not duplicate the elixir belt below chat');
assert.match(room, /const \[beltOpen, setBeltOpen\] = useState\(true\)/, 'Show quick elixirs by default during combat');
assert.match(room, /aria-expanded=\{beltOpen\}/, 'Restore accessible collapse/expand arrow for elixirs');
assert.match(room, /onClick=\{\(\) => setBeltOpen\(\(open\) => !open\)\}/, 'Elixir fold control must work');
assert.match(room, /if \(finished\) setBeltOpen\(false\)/, 'After the duel, collapse elixirs to reveal chat');
assert.match(room, /\{beltOpen && \(/, 'Only render expanded quick slots when requested');
assert.match(belt, /grid grid-cols-7 gap-1/, 'Seven slots must fit across the Android arena without horizontal scrolling');
assert.match(belt, /min-w-0 w-full h-11 rounded-lg/, 'Quick slots must be compact without losing touch targets');
assert.match(room, /<ChevronDown/, 'Fold arrow must be visible');
assert.match(room, /id="arena-quick-belt"/, 'Collapsible section must have accessible control target');
assert.match(room, /onAction=\{pressBeltSlot\}/, 'Keep potions wired to existing battle actions');
assert.match(room, /disabled=\{!isActive \|\| !alive \|\| busy\}/, 'Keep existing potion use restrictions');
assert.match(result, /arena-result-wing/, 'Winged championship emblem missing');
assert.match(result, /arena-result-radiance/, 'Magical backlighting missing');
assert.match(result, /alreadyRewarded/, 'Already claimed rewards should not show perpetual dots');
assert.match(room, /alreadyRewarded=\{view\.me\.rewarded\}/, 'Keep reward display accurate on returning');
const css = read('src/index.css');
for (const style of ['arena-result-stage-win', 'arena-result-stage-loss', 'arena-result-stage-draw',
  'arena-result-banner', 'arena-result-wing', 'arena-result-footbar',
  'arena-result-gem-gold', 'arena-result-gem-xp', 'arena-result-gem-rating', 'arena-result-gem-kills']) {
  assert(css.includes('.' + style), 'Missing illustrated result artwork: ' + style);
}
assert.match(css, /\.arena-result-radiance \{animation:none!important;\}/, 'Respect reduced motion for the magical glow');
assert.match(result, /Покинуть арену/, 'Manual leave must remain available');
assert.match(pve, /kind === 'trial' \? 'map-chamber\.webp'/, 'Trials must have a separate backdrop');
assert(existsSync('public/map-chamber.webp'), 'Trial backdrop asset does not exist');

assert.match(server, /arena_postfight_deadline/, 'Missing secure deadline function');
assert.match(server, /auth\.uid\(\)/, 'Deadline must require user membership');
assert.match(server, /finished_at \+ interval '30 minutes'/, 'Deadline not anchored to server end time');
assert.match(server, /RAISE EXCEPTION 'chat_expired'/, 'Post-deadline messages must be rejected by server');
assert.match(server, /p\.rewarded IS TRUE/, 'Only credited results can be lazily expired on login');
assert.match(server, /CREATE OR REPLACE FUNCTION public\.arena_current_room/, 'Stale room cleanup missing');
assert(!server.includes('arena_claim_reward('), 'Do not alter payout logic or reward amounts');
console.log('Arena postfight checks OK: winged title, visible fighters, slim rewards, live chat and 30-minute deadline.');
