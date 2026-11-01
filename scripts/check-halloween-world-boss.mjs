import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261031090000_halloween_world_boss_2026.sql');
const limit100 = read('supabase/migrations/20261101071516_halloween_2026_daily_attack_limit_100.sql');
const home = read('src/components/HomeScreen.tsx');
const app = read('src/App.tsx');
const api = read('src/game/halloweenBoss.ts');
const season = read('src/game/halloweenBossSeason.ts');
const screen = read('src/components/HalloweenBossScreen.tsx');

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

assert.match(home, /halloweenBossInSeason\(\)/);
assert.match(home, /from '@\/game\/halloweenBossSeason'/);
assert.doesNotMatch(season, /supabase|\.rpc\(/, 'City event visibility must be pure and offline-safe');
assert.match(home, /onOpen\('halloween-boss'\)/);
assert.match(app, /screen === 'halloween-boss' && <HalloweenBossScreen/);
assert.match(api, /supabase\.rpc\(name\)/);
assert.match(screen, /getHalloweenBossState/);
assert.match(screen, /maxHitsToday \\?\\? 100/);
assert.match(screen, /hitHalloweenBoss/);
assert.match(screen, /state\.top10\.map/);
assert.doesNotMatch(screen, /saveCloudSave|useGame\.set|redGems|spendStones|spendEnergy/);
console.log('Halloween world boss: game route, read-only client, protected RPC, HP serialization, UTC quota and leaderboard: PASS');
