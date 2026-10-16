import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (name) => readFileSync(name, 'utf8');
const room = read('src/components/arena/ArenaRoom.tsx');
const result = read('src/components/arena/ArenaResultCard.tsx');
const chat = read('src/components/arena/ArenaChat.tsx');
const api = read('src/game/arenaApi.ts');
const pve = read('src/components/pve/PveFight.tsx');
const server = read('supabase/migrations/20261017_arena_postfight_30m_chat.sql');
const lobby = read('src/components/arena/ArenaLobby.tsx');

assert(!room.includes('createPortal'), 'Result must not block the whole viewport');
assert(!room.includes('z-[10000]'), 'No full-screen result modal allowed');
assert(room.indexOf('<ArenaResultCard') > 0, 'Arena result card missing');
assert(room.indexOf('<ArenaChat') > room.indexOf('<ArenaResultCard'), 'Live chat must stay directly below the result');
assert.match(room, /chatExpired = finished && postFightDeadline !== null && chatSeconds === 0/, 'Use server-backed deadline, not a fresh client timer');
assert.match(room, /\(!view\?\.me\.rewarded && !reward\)/, 'Auto-exit must not discard unclaimed rewards');
assert.match(room, /leaveArena\(roomId\)/, 'Automatic departure must notify the server');
assert.match(api, /arenaPostFightDeadline/, 'Post-fight server deadline RPC missing');
assert.match(chat, /canSend/, 'Chat expiry gating missing');
assert.match(lobby, /30 минут/, 'Arena rules must announce the time limit');
assert.match(result, /VictorySparks/, 'Victory artwork and effects missing');
assert.match(result, /formatPostFightTime/, 'Result countdown missing');
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
console.log('Arena postfight checks OK: 30-minute server deadline, chat access, claim safeguard, vivid result and trial background.');
