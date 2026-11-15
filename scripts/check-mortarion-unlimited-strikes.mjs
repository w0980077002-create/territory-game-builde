import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261115103000_mortarion_unlimited_player_strikes_60s.sql');
const ui = read('src/components/MortarionBossScreen.tsx');
const api = read('src/game/mortarionBoss.ts');

assert.match(sql, /CHECK \(hits_in_hour >= 0\)/, 'Hourly record remains nonnegative but uncapped');
assert.doesNotMatch(sql, /IF v_hits >= 5/, 'Hourly attack limit must be removed from live RPC replacements');
assert.match(sql, /last_hit_at \+ interval '60 seconds'/, 'Server must enforce a 60-second gap');
assert.match(sql, /THEN RAISE EXCEPTION 'mortarion_cooldown'/, 'Server must reject cooldown bypass');
assert.match(sql, /'hitsInHour',0,'maxHitsInHour',0/, 'Legacy clients must not lock the button after five hits');
assert.match(sql, /FOR UPDATE/, 'Global raid HP must remain serialized');
assert.match(sql, /'top10'/, 'Leaderboard must remain server-owned');

assert.doesNotMatch(ui, /hitsLeft|MORTARION_HITS_PER_HOUR|ЛИМИТ УДАРОВ|mortarion_hourly_limit/, 'No client hourly cap or misleading count');
assert.match(ui, /Без лимита ударов/, 'Show unlimited strikes in UI');
assert.match(ui, /1 удар раз в 60 секунд/, 'Show the unchanged cooldown');
assert.match(ui, /nextHitMs === 0/, 'Disable button during the server cooldown');
assert.match(ui, /state\.nextHitAt && Date\.parse\(state\.nextHitAt\) > when/, 'Guard attacks locally during cooldown');
assert.doesNotMatch(api, /Math\.min\(5, toInt\(o\.hitsInHour\)\)|maxHitsInHour: 5/, 'Do not impose a client-side cap');
console.log('Mortarion unlimited strikes, 60-second cooldown, saved raid state: PASS');
