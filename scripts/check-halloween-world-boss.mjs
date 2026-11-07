import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261031090000_halloween_world_boss_2026.sql');
const limit100 = read('supabase/migrations/20261101071516_halloween_2026_daily_attack_limit_100.sql');
const unlimited = read('supabase/migrations/20261101220000_halloween_2026_unlimited_attacks.sql');
const home = read('src/components/HomeScreen.tsx');
const app = read('src/App.tsx');
const api = read('src/game/halloweenBoss.ts');

for (const pattern of [
  /SECURITY DEFINER[\s\S]*?SET search_path = ''/i,
  /auth\.uid\(\)/i,
  /FOR UPDATE/i,
  /hit_day_utc/,
  /v_hits >= 40/,
  /INTERVAL '8 seconds'/,
  /v_damage := LEAST\(v_event\.hp/,
  /GRANT EXECUTE ON FUNCTION public\.territory_halloween_boss_attack_v1\(\) TO authenticated/i,
  /REVOKE ALL ON public\.territory_halloween_boss_2026_players FROM PUBLIC, anon, authenticated/i,
]) assert.match(sql, pattern);

assert.doesNotMatch(sql, /UPDATE public\.players|DELETE FROM public\.players|TRUNCATE|DROP TABLE|red_gems|game_state\s*=/i, 'World boss must not mutate existing progression or economy');
// The original event migration is historical (40 hits); the additive guarded live migration raises it to 100.
assert.match(limit100, /md5\(state_src\)/);
assert.match(limit100, /md5\(attack_src\)/);
assert.match(limit100, /'''maxHitsToday'', 100'/);
assert.match(limit100, /IF v_hits >= 100 THEN/);
assert.doesNotMatch(limit100, /UPDATE public\.players|DELETE FROM public\.players|TRUNCATE|DROP TABLE|game_state\s*=/i);

assert.match(unlimited,/c90ca0ebc55db1138f3d755a4c8d4668/);
assert.match(unlimited,/c7231efbaae5e21fa93337e141090a2f/);
assert.match(unlimited,/maxHitsToday'', NULL/);
assert.match(unlimited,/Daily cap removed by owner/);
assert.match(unlimited,/INTERVAL ''8 seconds''/);
assert.doesNotMatch(unlimited,/UPDATE public\.players|DELETE FROM public\.players|TRUNCATE|DROP TABLE|game_state\s*=/i);
// The 2026 event is closed. Retire only its public screen, preserving the SQL
// history, earned rewards and server-side administration contracts.
assert.doesNotMatch(home, /halloweenBossInSeason|halloween-boss|halloweenRaid\\.css/,
  'Expired Halloween boss must not remain in the City UI');
assert.doesNotMatch(app, /HalloweenBossScreen|halloween-boss/,
  'Expired Halloween route must not be included in the live game');
assert.match(api, /supabase\\.rpc\\(name\\)/);
assert.match(api, /maxHitsToday: number \\| null/);
assert.match(api, /ranking\\.slice\\(0, 20\\)/);
console.log('Halloween world boss: historical server contracts preserved, expired frontend retired: PASS');
