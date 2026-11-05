import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const entry = readFileSync('src/main.tsx', 'utf8');
const skin = readFileSync('src/components/ui/territoryOakUnified.css', 'utf8');
const list = app.match(/const OAK_HERITAGE_SCREENS = new Set<Screen>\(\[([\s\S]*?)\]\);/);
assert(list, 'Explicit limited skin scope is required');
const routes = [...list[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
for (const route of ['inventory', 'hero', 'runes', 'forge', 'leaderboard',
  'quests', 'professions', 'auction', 'friends', 'messages', 'events', 'clan', 'games']) {
  assert(routes.includes(route), 'Missing ordinary screen: ' + route);
}
for (const protectedRoute of ['city', 'map', 'battle', 'arena', 'shop', 'vip', 'hall-play']) {
  assert(!routes.includes(protectedRoute), 'Owner-approved game screen must not be restyled: ' + protectedRoute);
}
assert(app.includes('OAK_HERITAGE_SCREENS.has(screen)'), 'Skin scope must follow the actual game screen');
assert(entry.includes("import './components/ui/territoryOakUnified.css';"), 'Skin must be loaded in the real app');
for (const path of [
  '/assets/territory/arena-ui/old-oak-photographic.svg',
  '/assets/territory/arena-ui/rope-wrap.svg',
  '/assets/territory/arena-ui/iron-corner.svg',
  '/assets/territory/ui/shop/shop-wood-planks.webp',
]) {
  assert(existsSync('public' + path), 'Real approved material missing: ' + path);
  assert(skin.includes(path), 'Real approved material not applied: ' + path);
}
assert(skin.includes('.territory-shell.territory-oak-heritage'),
  'Do not recolour the full game or change approved screens');
assert(!skin.includes('.territory-nav'), 'Bottom navigation must not change');
console.log('TERRITORY old-oak visual scope PASS: 13 standard screens, approved images, protected Arena/Shop/City/Map/PvE/VIP and bottom nav.');
