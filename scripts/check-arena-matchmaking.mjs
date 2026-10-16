import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261017_fair_arena_matchmaking.sql', 'utf8');
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.arena_match_compatible/, 'Server match policy missing');
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.arena_join\(p_mode text\)/, 'Actual join RPC must enforce matching');
assert.match(sql, /NOT EXISTS \([\s\S]*?NOT public\.arena_match_compatible\(/, 'Every other real player in lobby must be compatible');
assert.match(sql, /AND NOT ap\.is_bot/, 'Compare against real opponents, not filler bots');
for (const field of ['v_pl.level', 'v_pl.max_hp', 'v_pl.attack', 'v_pl.defense', 'v_pl.arena_rating',
  'ap.level', 'ap.max_hp', 'ap.attack', 'ap.defense', 'ap.rating']) {
  assert(sql.includes(field), 'Missing secure matchup comparison: ' + field);
}
assert.match(sql, /FOR UPDATE OF r SKIP LOCKED/, 'Concurrent joins must not overfill lobbies');
assert.match(sql, /INSERT INTO public\.arena_rooms/, 'Unmatched users must receive their own room');
assert.match(sql, /IF v_count >= v_cap THEN UPDATE public\.arena_rooms/, 'Existing start-on-full behavior must remain');
assert.match(sql, /IF v_room IS NOT NULL THEN RETURN v_room/, 'Returning players must recover their existing arena');
assert.match(sql, /abs\(coalesce\(a_rating, 1000\)::bigint - coalesce\(b_rating, 1000\)::bigint\) <= 700/, 'Rating range guard');
assert.match(sql, /<= 3 \* greatest\(1, least\(coalesce\(a_hp/, 'HP ratio guard missing');
assert.match(sql, /<= 4 \* greatest\(1, least\(coalesce\(a_attack/, 'Attack ratio guard missing');
assert.match(sql, /<= 4 \* greatest\(1, least\(coalesce\(a_defense/, 'Defense ratio guard missing');
assert(!/UPDATE\s+public\.players/i.test(sql), 'Do not modify any player stats or inventories');
assert(!/DELETE\s+FROM\s+public\./i.test(sql), 'Never delete records as part of matching');
console.log('Arena matcher: human level/rating/power separation; safe bot fallback; existing session preserved.');
