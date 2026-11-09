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
assert.match(boss, /mortarion-background\\.webp/);
assert.match(boss, /data-testid="mortarion-full-body-boss"/);
assert.match(boss, /mortarion-boss-layer\\.webp/);
assert.match(boss, /mortarion-fx-souls\\.webp/);
assert.match(boss, /mortarion-fx-core\\.webp/);
assert.match(boss, /mortarion-fx-vortex\\.webp/);
assert.match(boss, /mortarion-fx-floor\\.webp/);
assert.doesNotMatch(boss, /mortarion-raid__boss-picture|mortarion-raid-scene\.webp/, 'Old one-piece boss scene must not render');
assert.match(css, /mortarion-raid__layer-boss\{[^}]*object-fit:contain/, 'Boss is its own uncropped sprite');
assert.match(css, /mortarion-raid__layer-bg\{[^}]*background-image:/, 'Background is independent of boss');
assert.match(css, /mortarion-raid__player\{[^}]*left:1\.2%/, 'Real player figure stays on the left, separate from boss');
for (const name of ['mortarion-background','mortarion-boss-layer','mortarion-fx-souls','mortarion-fx-core','mortarion-fx-vortex','mortarion-fx-floor']) {
 const image = readFileSync(new URL('../public/assets/territory/events/' + name + '.webp', import.meta.url));
 assert.ok(image.length > 1000, 'Missing game layer: ' + name);
 assert.equal(image.subarray(0,4).toString('ascii'), 'RIFF', 'Layer must be RIFF WebP: ' + name);
 assert.equal(image.subarray(8,12).toString('ascii'), 'WEBP', 'Layer must be WEBP: ' + name);
}
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
assert.match(css, /mortarion-raid__arena--striking \.mortarion-raid__layer-boss/, 'Only boss animates on impact');
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

console.log('MORTARION LAYERS: boss + backdrop + four alpha emitters + actual hero, original raid rules — PASS');
