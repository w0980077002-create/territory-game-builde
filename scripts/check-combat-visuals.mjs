import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { transform } from 'esbuild';

const read = (path) => readFileSync(path, 'utf8');

const poses = ['idle', 'attack', 'block', 'dodge', 'hit', 'death'];
const sets = {
  heroes: ['male_viking', 'male_rogue', 'female_warrior', 'female_archer'],
  followers: ['loyal_shield', 'northern_warrior', 'forest_healer', 'moon_hunter', 'rune_mage'],
  enemies: ['goblin', 'boar', 'bandit', 'wolf', 'troll'],
  bosses: ['bandit_chief', 'northern_jarl', 'dark_priest', 'undead_king', 'barrow_guardian', 'abyss_demon', 'giant_king', 'storm_lord', 'fire_lord', 'chaos_shadow'],
};
for (const [group, names] of Object.entries(sets)) {
  for (const name of names) for (const pose of poses) {
    const image = `public/assets/territory/characters/${group}/${name}/${pose}.webp`;
    assert(existsSync(image), `Missing combat pose: ${image}`);
  }
}
for (const image of ['sword', 'bow', 'staff']) {
  assert(existsSync(`public/assets/territory/ui/items/${image}.webp`), `Missing weapon art: ${image}`);
}

const arena = read('src/components/arena/BattleScene.tsx');
const pve = read('src/components/pve/PveFight.tsx');
const room = read('src/components/arena/ArenaRoom.tsx');
const art = read('src/game/art.ts');
const gear = read('src/components/arena/GearStrip.tsx');
const effects = read('src/index.css');

assert.match(arena, /combatFrames=\{getCombatAppearance\(enemy\.appearance\)\}/, 'PvP opponent animations disconnected');
assert.match(arena, /portraitFollower &&/, 'Companion must not appear before unlocking');
assert.match(arena, /getFollowerCombatFrames\(portraitFollower\.id\)/, 'Companion animation frames missing');
const followerLane = arena.match(/data-testid="arena-visible-follower"[\s\S]*?className="([^"]*)"/)?.[1] ?? '';
assert(followerLane.includes('z-30'), 'Companion needs foreground layer above the hero to remain visible on Android');
assert(followerLane.includes('h-[68%]') && followerLane.includes('w-[66%]'), 'Companion must not shrink behind the hero');
assert(arena.includes("portraitFollower ? '-right-[12%]' : 'right-0'"), 'Make room for active follower without shifting solo hero');
assert(arena.includes('strike={null}'), 'Companion in PvP is visual-only: never inject bonus hits');
assert.match(arena, /getFollowerArt\(portraitFollower\.id\)/, 'Use the selected companion image');
assert(!arena.includes('h-[52%] w-[48%]'), 'Do not restore the invisible follower layout');
assert.match(pve, /getEnemyCombatFrames\(enemy\.art\)/, 'PvE enemy animations disconnected');
assert.match(pve, /getFollowerCombatFrames\(follower\.id\)/, 'PvE companion animation frames missing');
for (const image of ['helmet', 'amulet', 'armor', 'weapon', 'shield', 'ring', 'boots', 'sword', 'knight-blade', 'hero-sword', 'plate-armor']) {
  assert(existsSync(`public/assets/territory/ui/equipment-cartoon/${image}.webp`), `Missing approved cartoon gear: ${image}`);
}
assert.match(art, /equipment-cartoon\//, 'Cartoon shared equipment catalog missing');
assert.match(art, /return eq\('sword'\)/, 'Sword art mapping missing');
assert.match(art, /if \(item\.equipment\) return equipmentArt\(item\.equipment\)/, 'Inventory still shows generic weapon');
assert.match(gear, /equipmentArt\(item\)/, 'Arena gear still shows generic weapon');
assert.match(room, /<ArenaChat\s+roomId=\{roomId\}/, 'Persistent arena chat missing');
assert.match(room, /<BeltBar/, 'Seven-slot item belt missing');
assert.match(room, /<GearStrip/, 'Seven-slot gear missing');
assert.match(effects, /prefers-reduced-motion: reduce/, 'Motion accessibility safeguards missing');

// Regression coverage for the reported Android arena/trials defects.
const figure = read('src/components/arena/FighterFigure.tsx');
const enemyArt = read('src/game/combatArt.ts');
const engine = read('src/game/engine.ts');
const strikes = read('src/game/useStrikeQueue.ts');
assert.match(arena, /dir=\{-1\}\s+mirror\s+alive=\{enemy\.hp > 0\}/, 'PvP enemy must be mirrored toward the hero');
assert.match(figure, /mirror \? 'battle-mirror-art'/, 'Mirroring must affect only the fighter artwork');
assert.match(figure, /battle-swing-\$\{swing\}/, 'Three combat gestures disconnected');
for (const mode of [0, 1, 2]) {
  assert.match(effects, new RegExp('\\.battle-swing-' + mode + '\\s*\\{'), 'Attack movement ' + mode + ' missing');
}
assert.match(pve, /src=\{resolveCombatArtUrl\(enemy\.art\)\}/, 'PvE may double-prefix a public asset path');
assert.match(enemyArt, /url\.startsWith\(base\)/, 'Combat art prefix must be idempotent');
assert.match(engine, /characters\/bosses\/barrow_guardian\/idle\.webp/, 'Trial guardian needs a six-pose art set');

// Run the actual exported resolver in both URL forms that occur in deployed builds.
const base = '/territory-game-builde/';
const transpiled = await transform(enemyArt.replaceAll('import.meta.env.BASE_URL', JSON.stringify(base)), { loader: 'ts', format: 'esm' });
const { resolveCombatArtUrl } = await import('data:text/javascript;base64,' + Buffer.from(transpiled.code).toString('base64'));
const trialPath = 'assets/territory/characters/bosses/barrow_guardian/idle.webp';
assert.equal(resolveCombatArtUrl('/' + trialPath), base + trialPath, 'Bare trial art gets one prefix');
assert.equal(resolveCombatArtUrl(base + trialPath), base + trialPath, 'Already-prefixed art must not get a second prefix');
assert(existsSync('public/assets/territory/characters/bosses/barrow_guardian/death.webp'), 'Trial guardian poses missing');
assert.match(strikes, /STRIKE_MS = 920/, 'Faster strike FX queue timing missing');

// Living battle is purely visual and shares its fighter component across PvP/PvE.
const fighterMotionCss = read('src/components/arena/fighterEffects.css');
assert.match(figure, /fighter-figure__breath--idle/, 'Hero stance must breathe between real strike events');
assert.match(figure, /fighter-figure__footstep/, 'Attacker must step onto the ground on a real strike');
assert.match(figure, /fighter-impact__flash/, 'Contact flash must be tied to the target impact');
assert.match(figure, /combatSpeed = 1/, 'PvE x2 motion support was removed');
for (const animation of ['fighter-breathe', 'fighter-step-dust', 'fighter-cut', 'fighter-thrust', 'fighter-overhead', 'fighter-recoil', 'fighter-guard', 'fighter-dodge', 'fighter-contact']) {
  assert.match(fighterMotionCss, new RegExp('\\\\@keyframes ' + animation + ' \\\\{'.replace('\\\\@','@')), 'Missing live combat animation: ' + animation);
}
assert.match(fighterMotionCss, /\.fighter-figure__breath--idle \{ animation: none !important; \}/, 'Reduced-motion guard must disable continuous breathing');
assert.match(fighterMotionCss, /\.fighter-figure__footstep, \.fighter-impact__flash \{ display: none; \}/, 'Reduced-motion guard must disable extra FX');

console.log('Battle visuals OK: all character poses/assets, opponent, companion, sword, chat and seven-slot UI.');
