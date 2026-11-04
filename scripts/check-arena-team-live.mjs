import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261104155000_arena_team_realtime_activity_v1.sql','utf8');
const room = readFileSync('src/components/arena/ArenaRoom.tsx','utf8');
const battle = readFileSync('src/components/arena/BattleScene.tsx','utf8');
const api = readFileSync('src/game/arenaApi.ts','utf8');
const rules = readFileSync('src/components/arena/ArenaRulesModal.tsx','utf8');
const section = (name) => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION ' + name);
  assert(start>=0, name + ' missing');
  const next = migration.indexOf('CREATE OR REPLACE FUNCTION ',start+1);
  return migration.slice(start,next<0?undefined:next);
};
const start = section('public.arena_start_room');
const tick = section('public.arena_tick');
const move = section('public.arena_move');
const state = section('public.arena_state');
const resolve = section('public.arena_resolve_round');
const attack = section('territory_private.arena_team_strike_actor_v1');
const bots = section('territory_private.arena_team_bot_strikes_v1');
const potion = section('public.arena_time_potion');

assert.match(migration,/ADD COLUMN IF NOT EXISTS team_live_v1 boolean NOT NULL DEFAULT false/,
  'Active historical rooms must remain on old combat logic');
assert.match(start,/team_live_v1 = \(v_room.mode <> 'duel'\)/,
  'Only new 3v3 and chaos rooms may use realtime strikes');
assert.match(start,/runes_pin_arena_room_v1/, 'Existing rune snapshot must remain intact');
assert.match(move,/IF v_room.team_live_v1 THEN[\s\S]*arena_tick\(p_room\);[\s\S]*arena_team_strike_actor_v1/,
  'Live attacks must resolve server-side immediately and expire the team first');
assert(move.indexOf('arena_team_strike_actor_v1') < move.lastIndexOf('already_moved'),
  'Repeated team attacks must bypass the one-move-per-round legacy restriction');
assert.match(attack,/last_live_attack_at \+ interval '3 seconds'/,
  'Attacker must have a server-enforced cooldown');
assert.match(attack,/WHERE id=p_room FOR UPDATE/, 'Concurrent RPCs must serialize per room');
assert.match(attack,/team1_last_attack_at=now\(\)/, 'A real attack must refresh team one');
assert.match(attack,/team2_last_attack_at=now\(\)/, 'A real attack must refresh team two');
assert.match(attack,/arena_zone_ru/, 'Preserve original zones');
assert.match(attack,/runes_arena_chance_v1/, 'Preserve original dodge and crit rune effects');
assert.match(attack,/runes_arena_damage_v1/, 'Preserve original rune damage');
assert.match(attack,/PERFORM public.arena_finish/, 'Actual kills must end a fully defeated team');
assert.match(bots,/p\.is_bot OR \(p\.auto AND p\.left_at IS NULL\)/,
  'Bots and elected autobattle must both produce server-authoritative strikes');
assert.match(tick,/IF v_room.team_live_v1 THEN[\s\S]*now\(\)>=v_d1 AND now\(\)>=v_d2/,
  'Simultaneous silence cannot award an arbitrary victory');
assert.match(tick,/ELSIF now\(\)>=v_d1[\s\S]*arena_finish\(p_room,2\)/,
  'Silent Wolves must lose to Ravens');
assert.match(tick,/ELSIF now\(\)>=v_d2[\s\S]*arena_finish\(p_room,1\)/,
  'Silent Ravens must lose to Wolves');
assert.match(tick,/RETURN;[\s\S]*PERFORM arena_bot_moves\(p_room, false\);/,
  'Live team branch must skip all legacy individual-timeout processing');
assert.match(resolve,/IF v_room.team_live_v1 THEN RETURN; END IF;/,
  'Individual timeout resolve must be disabled for live team fights');
assert.match(resolve,/не сделал ход/, 'Legacy 1v1 timeout behavior stays unchanged');
assert.match(potion,/team2_clock_penalty/, 'Enemy team time potion still must have an effect');
assert.match(potion,/team1_clock_penalty/, 'Time potion must work for both sides');
assert.match(state,/'teamDeadline1'/, "Show own team's authoritative deadline");
assert.match(state,/'teamDeadline2'/, "Show opposing team's authoritative deadline");
assert.match(state,/'nextStrikeAt'/, 'Show attack cooldown without locally guessing it');
assert.match(state,/WHEN v_room.team_live_v1 THEN false/, 'No personal waiting state after a live strike');

assert.match(room,/data-testid="arena-team-timers"/, 'Mobile UI must show both team clocks');
assert.match(room,/cooldown=\{attackCooldown\}/, 'Mobile UI must disable rapid duplicate strikes');
assert.match(battle,/cooldown === 0/, 'Battle action must be disabled until the next real strike');
assert.match(api,/attack_cooldown/, 'Server cooldown error must have a player-readable message');
assert.match(rules,/Если вся команда 60 секунд не атакует/, 'RU rules must explain team timeout');
assert.match(rules,/A team loses if nobody attacks for 60 seconds/, 'EN rules must explain team timeout');
assert.doesNotMatch(migration,/DELETE\s+FROM\s+(?:public\.)?players|TRUNCATE\s+\w*players/i,
  'Combat migration must not delete players');
assert.doesNotMatch(migration,/UPDATE\s+(?:public\.)?players\s+SET/i,
  'Combat migration must not change player profiles');
console.log('Arena team live: immediate hits, shared 60s inactivity, 3s cooldown, bots, items, runes, legacy duel isolation OK.');
