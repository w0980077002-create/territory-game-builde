import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

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
assert.match(pve, /getEnemyCombatFrames\(enemy\.art\)/, 'PvE enemy animations disconnected');
assert.match(pve, /getFollowerCombatFrames\(follower\.id\)/, 'PvE companion animation frames missing');
assert.match(art, /return itemIcon\('sword'\)/, 'Sword art mapping missing');
assert.match(art, /if \(item\.equipment\) return equipmentArt\(item\.equipment\)/, 'Inventory still shows generic weapon');
assert.match(gear, /equipmentArt\(item\)/, 'Arena gear still shows generic weapon');
assert.match(room, /<ArenaChat roomId=\{roomId\}/, 'Persistent arena chat missing');
assert.match(room, /<BeltBar/, 'Seven-slot item belt missing');
assert.match(room, /<GearStrip/, 'Seven-slot gear missing');
assert.match(effects, /prefers-reduced-motion: reduce/, 'Motion accessibility safeguards missing');

console.log('Battle visuals OK: all character poses/assets, opponent, companion, sword, chat and seven-slot UI.');
