import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const entry = readFileSync('src/main.tsx', 'utf8');
const skin = readFileSync('src/components/ui/territoryOakUnified.css', 'utf8');
const approvedArt = '/assets/territory/ui/approved/territory-dark-oak-mobile.webp';
const darkOak = readFileSync('public' + approvedArt);
const oakExtra = readFileSync('src/components/ui/oakScreens.css', 'utf8');
assert.equal(darkOak.toString('ascii',0,4), 'RIFF', 'Owner-approved wood artwork must be a real WebP file');
assert.equal(darkOak.toString('ascii',8,12), 'WEBP', 'WebP header must be valid');
assert(darkOak.length > 5000 && darkOak.length < 50000, 'Fast-loading mobile artwork, not a fake flat background');
assert(skin.includes(approvedArt), 'Standard screens must use the newly approved dark oak artwork');
assert(oakExtra.includes(approvedArt), 'Auction, clan, profession panels use the same dark oak');
assert(skin.includes('background-repeat: no-repeat, no-repeat;'), 'No obviously repeated grain in the empty inbox background');
assert(!skin.includes("shop-wood-planks.webp"), 'Bright orange old Shop plank art must not be used by standard-screen skin');

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
  '/assets/territory/ui/shop/shop-approved-product-border-v2.webp',
  approvedArt,
]) {
  assert(existsSync('public' + path), 'Real approved material missing: ' + path);
  assert(skin.includes(path), 'Real approved material not applied: ' + path);
}
assert(!skin.includes('old-oak-photographic.svg'), 'Mirrored oak grain must not return to standard menus');
assert(!skin.includes('iron-corner.svg'), 'Legacy steel-corner stamps must not return to standard menus');
assert(!/rope-wrap\.svg|--oak-heritage-rope|repeat-x/.test(skin), 'Never re-add repeated rope strips to standard menus');
assert(!skin.includes('.territory-section-head::before'), 'Header must not stamp repeating knots');
assert(!/\.viking-screen-tabs,\s*\.territory-mail__tabs\s*\)::after/.test(skin), 'Inbox and other tab rails must not stamp repeating knots');
assert(!/:is\(\s*\.viking-screen > \.card,\s*\.viking-screen > section\.card,\s*\.territory-profile > \.card\s*\)::before/.test(skin), 'Menu cards must not stamp repeating knots');
assert(skin.includes('content:none;') && skin.includes('display:none;'), 'Legacy corner overlays must remain disabled');
assert(skin.includes(`--oak-heritage-grain: url('${approvedArt}')`), 'Standard screens use owner-approved old walnut art');
assert(!/440px 220px|400px 200px|480px 240px/.test(skin), 'Do not stretch wood grain into artificial waves');
assert(skin.includes('.territory-shell.territory-oak-heritage'),
  'Do not recolour the full game or change approved screens');
assert(!skin.includes('.territory-nav'), 'Bottom navigation must not change');
const arenaCss=readFileSync('src/components/arena/arenaOldOakFinish.css','utf8');
const arenaLobby=readFileSync('src/components/arena/ArenaLobby.tsx','utf8');
assert(!existsSync('public/assets/territory/arena-ui/rope-wrap.svg'), 'Delete the rejected repeat-rope sprite from GitHub');
assert(!arenaCss.includes('--arena-rope') && !arenaCss.includes('arena-weekly::before'), 'Do not stamp repeated rope knots on Arena panels');
assert(!arenaLobby.includes('rope-wrap.svg'), 'Arena must not load the rejected rope sprite');


const heroParity = skin.slice(skin.indexOf('Owner mobile Hero parity'));
assert(!heroParity.includes('.territory-profile > :is(details.card,div.card)::before'), 'Do not restore obsolete Hero rope overrides');
assert(heroParity.includes('summary::-webkit-details-marker'), 'Hero disclosures must hide native duplicate markers');
assert(heroParity.includes('min-height: 44px;'), 'Hero accordion tap targets must remain 44px tall');
assert(heroParity.includes('[data-testid="vip-open-page"]'), 'Hero VIP entry must share approved real timber finish');

console.log('TERRITORY old-oak visual scope PASS: actual owner-approved dark walnut WebP on 13 standard screens, no repetition or mirrored waves, protected Arena/Shop/City/Map/PvE/VIP and bottom nav.');
