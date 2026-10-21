// Arena economic-security release wiring regression.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(p, 'utf8');
const api = read('src/game/arenaSecure.ts');
const lobby = read('src/components/arena/ArenaLobby.tsx');
const room = read('src/components/arena/ArenaRoom.tsx');
const sql = read('supabase/migrations/20261021_arena_secure_transactions_v1.sql');
const close = read('supabase/migrations/20261021_arena_disable_legacy_economy_endpoints.sql');

for (const name of ['join', 'item', 'claim']) assert.ok(sql.includes("'"+name+"'"), 'missing secure action '+name);
assert.match(sql, /FOR UPDATE/i);
assert.match(sql, /p_expected timestamptz/i);
assert.match(sql, /UPDATE public\.arena_participants SET rewarded=true/i);
assert.match(sql, /UPDATE public\.players SET[\s\S]*?game_state=v_state/i);
assert.match(sql, /UPDATE public\.players SET energy=v_p\.energy-1/i);
assert.match(sql, /v_belt := jsonb_set\(v_belt/i);
assert.match(lobby, /secureArenaJoin\(mode\)/);
assert.doesNotMatch(lobby, /joinArena\(mode\)/);
assert.match(room, /secureArenaClaim\(roomId\)/);
assert.doesNotMatch(room, /grantRewards\(/);
assert.match(room, /secureArenaItem\(roomId, index/);
assert.doesNotMatch(room, /consumeBelt\(/);
assert.match(api, /protectFortuneSave\(id\)/);
assert.match(api, /acceptMonopolyClaimReceipt\(id, receipt\)/);
for (const fn of ['arena_join\(text\)','arena_claim_reward\(uuid\)','arena_use_item\(uuid,text\)','arena_time_potion\(uuid\)','arena_revive\(uuid,uuid\)']) {
  assert.ok(close.includes(fn), 'legacy endpoint must be revoked: '+fn);
}
console.log('Arena server-authoritative energy, consumable and rewards wiring OK');
