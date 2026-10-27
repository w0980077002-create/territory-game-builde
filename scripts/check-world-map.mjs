import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const canvas = readFileSync('src/components/WorldMapCanvas.tsx', 'utf8');
const css = readFileSync('src/components/worldMapCanvas.css', 'utf8');
const map = readFileSync('src/components/MapScreen.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const inventory = readFileSync('src/components/InventoryScreen.tsx', 'utf8');
const profile = readFileSync('src/components/ProfileScreen.tsx', 'utf8');
const artPath = 'public/assets/territory/map/world-map-v1-20261027.webp';
const art = readFileSync(artPath);

assert.equal(art.subarray(0, 4).toString(), 'RIFF');
assert.equal(art.subarray(8, 12).toString(), 'WEBP');
assert.ok(statSync(artPath).size < 800_000, 'World map must remain fast to load on mobile');

for (const section of ['city', 'arena', 'shop', 'forge', 'professions', 'auction', 'inventory', 'games', 'hero', 'battle', 'clan', 'friends', 'quests', 'messages', 'events']) {
  assert.match(canvas, new RegExp("id: '" + section + "'"), `Missing ${section} location`);
}
for (const region of ['forest', 'mountain', 'herbs', 'hunting', 'rare', 'chamber']) {
  assert.match(canvas, new RegExp("id: '" + region + "'"), `Missing ${region} resource or appearance destination`);
}
for (const destination of ['runes', 'trial', 'companions']) {
  assert.match(canvas, new RegExp("id: '" + destination + "'"), `Missing ${destination} destination`);
}
assert.doesNotMatch(canvas, /id: 'leaderboard'/, 'Owner disabled the direct global leaderboard entrance');

assert.match(canvas, /touchAction: 'none'/, 'Prevent WebView scrolling while dragging world');
assert.match(canvas, /onPointerDown=/);
assert.match(canvas, /onPointerMove=/);
assert.match(canvas, /onPointerCancel=/);
assert.match(canvas, /addEventListener\('touchmove', touchMove, \{ passive: false \}\)/, 'Android gestures must not be stolen by the Telegram WebView');
assert.match(canvas, /event\.preventDefault\(\)/, 'Native touchmove must block parent scroll during map drag');
assert.match(canvas, /requestAnimationFrame\(fling\)/, 'Long map traversal needs momentum after a flick');
assert.match(canvas, /event\.pointerType === 'touch'\) return;/, 'Avoid duplicate native touch and pointer gestures');
assert.match(canvas, /function clampScale\(/, 'Map must have explicit minimum and maximum zoom levels');
assert.match(canvas, /Math\.min\(width \/ WORLD_WIDTH, height \/ WORLD_HEIGHT\)/, 'Zooming out must reveal the whole world');
assert.match(canvas, /const beginPinch = \(first: Touch, second: Touch\)/, 'Pinching two fingers must start a scale gesture');
assert.match(canvas, /current\.kind === 'pinch'/, 'Pinch movements need a separate path from panning');
assert.match(canvas, /distance \/ current\.startDistance/, 'Pinch distance must drive map scale');
assert.match(canvas, /centerX - current\.worldX \* scale/, 'Pinch midpoint must remain anchored to the world');
assert.match(canvas, /event\.touches\.length === 1\) beginPan\(event\.touches\[0\], true\)/, 'Ending a pinch must allow continued one-finger movement');
assert.match(canvas, /ref=\{zoomLabelRef\}/, 'Current zoom level must be visible');
assert.match(canvas, /onClick=\{\(\) => zoom\(1 \/ 1\.35\)\}/, 'Zoom-out button must have a working click handler');
assert.match(css, /territory-world-map__zoom-label/, 'Zoom level should match existing map controls');
assert.match(canvas, /onClickCapture=/, 'Panning must suppress accidental building taps');
assert.match(canvas, /setPointerCapture\(event\.pointerId\)/);
assert.match(canvas, /ResizeObserver/);
assert.match(canvas, /requestAnimationFrame/, 'Map movement should use browser animation frames');
assert.match(canvas, /world\.style\.transform =/, 'Move one composited layer without React reconciliation');
assert.doesNotMatch(canvas, /setView\(/, 'Pointer movement must not re-render the entire map in React');
assert.match(canvas, /clampView/, 'Players must not lose the entire map beyond viewport');
assert.match(canvas, /sessionStorage\.setItem\('territory-map-pan-seen'/);
assert.match(canvas, /<Hand /, 'First swipe must be explained visually');
assert.match(css, /prefers-reduced-motion/, 'Animation should respect accessibility settings');
assert.match(canvas, /setDrawerOpen\(true\)/, 'All sections must remain discoverable without clutter');

assert.match(map, /<WorldMapCanvas /);
assert.match(map, /if \(!gather\?\.active\) return;/, 'Idle map should not re-render once per second');
assert.match(map, /case 'trial': onTrial\(\)/);
assert.match(map, /case 'companions': onCompanions\(\)/);
assert.match(map, /case 'runes': onRunes\(\)/);
for (const action of ['territory_gather_status', 'territory_gather_start', 'territory_gather_claim']) {
  assert.match(map, new RegExp(action), `Keep server-authoritative ${action} operation`);
}
assert.match(map, /<ChamberModal /, 'Preserve cosmetic appearance selection');
assert.doesNotMatch(map, /\{\/\* Resource Regions \*\/\}/, 'Old text-card map must not remain on screen');

assert.match(app, /screen === 'map' \? 'overflow-hidden !px-0 !py-0'/);
assert.match(app, /onTrial=\{\(\) => \{ setBattleView\('trial'\)/);
assert.match(app, /onCompanions=\{\(\) => \{ setInventoryTab\('followers'\)/);
assert.match(app, /onRunes=\{\(\) => \{ setHeroTrainingOpen\(true\)/);
assert.match(inventory, /initialTab\?: 'items' \| 'equipment' \| 'followers'/);
assert.match(profile, /initialTrainingOpen= false|initialTrainingOpen = false/);
assert.match(profile, /open=\{trainingOpen\}/);

console.log('World map: all existing destinations, swipe controls, ready resources, rune/trial/companion deep links, mobile art and unchanged server gathering PASS');
