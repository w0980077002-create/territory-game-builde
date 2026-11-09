import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const boss = read('src/components/MortarionBossScreen.tsx');
const api = read('src/game/mortarionBoss.ts');
const migration = read('supabase/migrations/20261109180000_mortarion_world_raid_2026.sql');
const events = read('src/components/EventsScreen.tsx');
const app = read('src/App.tsx');
const css = read('src/components/mortarionBoss.css');

assert.match(boss, /hitMortarionBoss\(playerId\)/);
assert.match(boss, /getMortarionBossState\(\)/);
assert.match(boss, /nextHitAt/);
assert.match(boss, /eventCountdown\(/);
assert.match(boss, /mortarion-raid__impact/);
assert.match(boss, /mortarion-full-body\.avif/);
assert.match(boss, /data-testid="mortarion-full-body-boss"/);
assert.match(boss, /<picture className="mortarion-raid__boss-picture"/);
assert.match(css, /mortarion-raid__scene\{[^}]*object-fit:contain/, 'Boss crown and armored feet must be visible, not cropped with cover');
assert.match(css, /mortarion-raid__player\{[^}]*left:1\.2%/, 'Player figure stays on the left, separate from the boss');
const fullBodyArt = readFileSync(new URL('../public/assets/territory/events/mortarion-full-body.avif', import.meta.url));
assert.ok(fullBodyArt.length > 6000, 'Full-body Mortarion artwork must be bundled in the game');
assert.equal(fullBodyArt.toString('ascii', 4, 12), 'ftypavif', 'Full-body image should be a valid AVIF container');
assert.match(boss, /useStore\(useGame\)/, 'Selected in-game hero must be read from real game state');
assert.match(boss, /getCombatAppearance\(game\.appearance\)/, 'Actual character skin, not a substitute');
assert.match(boss, /<FighterFigure src=\{heroFrames\.idle\} combatFrames=\{heroFrames\} name=\{game\.player\.name\}/);
assert.match(boss, /data-testid="mortarion-real-player-hero"/);
assert.match(boss, /setStrike\(\{ key, attacker: game\.player\.name, target: 'Мортарион', tone: 'hit', amount: null \}\)/);
assert.match(boss, /if \(next\.hitDamage && next\.hitDamage > 0\)/, 'No client-faked strikes');
assert.match(boss, /contactTimeout\.current = window\.setTimeout/, 'Hero must wind up before showing contact damage');
assert.match(boss, /if \(mounted\.current\) \{ setImpact\(false\); setStrike\(null\); \}/);
assert.match(css, /mortarion-raid__player/);
assert.match(css, /mortarion-raid__slash-trail/);
assert.match(css, /contrast\(1\.16\)/, 'Boss art must not use the prior all-over blurring shadow');
assert.doesNotMatch(css, /saturate\(1\.1\) drop-shadow\(0 0 6px/, 'Avoid softening the whole boss illustration');

assert.match(boss, /Array\.from\(\{length: 10\}/);
assert.doesNotMatch(boss, /TEST_HIT_DAMAGE|setCombat\(|localStorage|sessionStorage|Your rank|Ваше место|Твоё место/);
assert.match(app, /screen === 'mortarion' && <MortarionBossScreen playerId=\{user.id\}/);
assert.doesNotMatch(app, /screen === 'mortarion' && isAdmin/);
assert.match(events, /bossPreview \|\| mortarionStatus\?\.enabled/);
assert.match(events, /mortarion-live/);

assert.match(api, /territory_mortarion_state_v1/);
assert.match(api, /territory_mortarion_attack_v1/);
assert.match(api, /ensurePlayerSession/);
assert.match(api, /top10\.slice\(0, 10\)/);
assert.doesNotMatch(api, /myRank|yourRank|yourPlace/);

assert.match(migration, /max_hp bigint NOT NULL CHECK \(max_hp = 100000000\)/);
assert.match(migration, /VALUES \('mortarion_2026', false/);
assert.match(migration, /v_hits >= 5/);
assert.match(migration, /interval '60 seconds'/);
assert.match(migration, /interval '1 hour'/);
assert.match(migration, /LIMIT 10/);
assert.match(migration, /FOR UPDATE/);
assert.match(migration, /SECURITY DEFINER[\s\S]*?SET search_path = ''/);
assert.match(migration, /ALTER TABLE public\.territory_mortarion_2026 ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /ALTER TABLE public\.territory_mortarion_2026_players ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL ON TABLE public\.territory_mortarion_2026 FROM PUBLIC, anon, authenticated/);
assert.match(migration, /REVOKE ALL ON TABLE public\.territory_mortarion_2026_players FROM PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.territory_mortarion_attack_v1\(\) TO authenticated/);
assert.doesNotMatch(migration, /UPDATE public\.players|DELETE FROM public\.players|TRUNCATE|DROP TABLE|UPDATE public\.territory_halloween/i);

assert.match(boss, /from-red-800 via-orange-600 to-amber-400/);
assert.match(boss, /from-amber-400 via-orange-600 to-red-800/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /mortarion-raid__attack:disabled/);
const image = readFileSync(new URL('../public/assets/territory/events/mortarion-raid-scene.webp', import.meta.url));
assert.equal(image.toString('ascii',0,4),'RIFF');
assert.equal(image.toString('ascii',8,12),'WEBP');
assert.ok(image.length >= 6000);
assert.match(read('src/game/halloweenBoss.ts'), /territory_halloween_boss_state_v1/);

console.log('MORTARION LIVE: server-only damage, global HP, 5/hr, 60-second cooldown, only Top-10, old Halloween preserved — PASS');
