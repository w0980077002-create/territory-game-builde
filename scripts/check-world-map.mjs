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
assert.match(canvas, /className="territory-world-map__backdrop"/, 'Maximum zoom-out should not leave plain green bands');
assert.match(canvas, /backgroundImage: /, 'Backdrop must reuse the world illustration without another download');
assert.match(canvas, /fittedScale \* 1\.035/, 'Overview edge fade should activate only at full-map zoom');
assert.match(canvas, /--map-marker-inverse/, 'Landmarks must counter-scale to stay tappable on phones');
assert.match(canvas, /relativeZoom < 0\.65 \? 'overview'/, 'Overview must show a reduced set of distinct map landmarks');
assert.match(canvas, /OVERVIEW_PLACES\.has\(place\.id\)/, 'Major locations must be explicit in the map design');
assert.match(css, /width: 44px;/, 'At overview, location touch targets must stay at least 44 pixels wide');
assert.match(css, /data-map-mode='overview'/, 'Map decluttering must follow zoom level');
assert.match(css, /territory-world-map__place--minor:not\(\.territory-world-map__place--ready\)/, 'Ready resources must remain visible even when zoomed out');
assert.match(canvas, /function bookmarkCamera\(/, 'Map must save world-space center and relative zoom');
assert.match(canvas, /function restoreCamera\(/, 'Map must restore camera after returning from another section');
assert.match(canvas, /sessionStorage\.setItem\(CAMERA_STORAGE_KEY/, 'Saved camera must remain a local visual preference');
assert.match(canvas, /window\.addEventListener\('pagehide', persistCamera\)/, 'Preserve camera if Telegram pauses the app');
assert.match(canvas, /className="territory-world-map__control-alert"/, 'Hidden destinations with attention need a visible menu indicator');
assert.match(canvas, /territory-world-map__place--notice/, 'Optional actions must use a calm notice state');
assert.match(css, /territory-world-map__destination-alert/, 'The destinations drawer must expose claimable actions');
assert.match(css, /territory-world-map__world--overview/, 'Overview artwork edges must blend into the continuation');
assert.match(css, /filter: blur\(19px\)/, 'The illustration extension should be calm and unobtrusive');
assert.match(canvas, /sessionStorage\.setItem\('territory-map-pan-seen'/);
assert.match(canvas, /<Hand /, 'First swipe must be explained visually');
assert.match(css, /prefers-reduced-motion/, 'Animation should respect accessibility settings');
assert.match(canvas, /setDrawerOpen\(true\)/, 'All sections must remain discoverable without clutter');
assert.match(canvas, /const PLACE_VISUALS: Record<WorldMapPlace, PlaceVisual>/, 'Every destination should have a deliberate Viking visual');
assert.match(canvas, /nav-city\.webp/, 'Reuse approved city iconography');
assert.match(canvas, /ic-arena-viking\.webp/, 'Reuse the approved arena illustration');
assert.match(canvas, /ic-professions-viking\.webp/, 'Reuse the approved professions illustration');
assert.match(canvas, /ic-auction-viking\.webp/, 'Reuse the approved auction illustration');
for (const art of [
  'ore-cart-v1.webp', 'appearance-mirror-v1.webp', 'hunting-bow-v1.webp',
  'dark-forest-v1.webp', 'herb-basket-v1.webp', 'rune-stones-v1.webp',
  'crystal-cave-v1.webp', 'companions-v1.webp',
]) {
  const path = `public/assets/territory/map/icons/${art}`;
  const icon = readFileSync(path);
  assert.equal(icon.subarray(0, 4).toString(), 'RIFF', `${art} must be WebP`);
  assert.equal(icon.subarray(8, 12).toString(), 'WEBP', `${art} must be WebP`);
  assert.ok(statSync(path).size < 100_000, `${art} must remain lightweight for Telegram`);
  assert.ok(canvas.includes(`assets/territory/map/icons/${art}`), `${art} must be used by a destination button`);
}
assert.doesNotMatch(canvas, /Glyph:/, 'All drawer destinations must have painted art, not temporary line icons');
assert.match(canvas, /PLACES\.map\(renderDestination\)/, 'Buildings list should render illustrated destination buttons');
assert.match(canvas, /OTHER_PLACES\.map\(renderDestination\)/, 'Secondary sections should share illustrated destination buttons');
assert.match(canvas, /loading="lazy" decoding="async"/, 'Drawer art must not block initial map rendering');
assert.match(css, /territory-world-map__destination-crest/, 'Destination buttons need illustrated crests');
assert.match(css, /territory-world-map__destination--forest/, 'Resources should be visually differentiated');
assert.match(css, /territory-world-map__drawer-scroll/, 'Location drawer should remain scrollable on phones');

assert.match(map, /<WorldMapCanvas /);
assert.match(map, /attentionPlaces=\{attentionPlaces\}/, 'Map must forward existing attention states');
assert.match(map, /if \(!gather\?\.active\) return;/, 'Idle map should not re-render once per second');
assert.match(map, /case 'trial': onTrial\(\)/);
assert.match(map, /case 'companions': onCompanions\(\)/);
assert.match(map, /case 'runes': setRuneMenuOpen\(true\)/, 'Map runes open the dedicated skill and rune menu');
assert.match(map, /<RuneSkillsMenu/, 'Map must render the mobile rune skills menu');
assert.match(map, /onOpenTraining=\{\(\) => \{ setRuneMenuOpen\(false\); onRunes\(\); \}\}/, 'Existing combat training must remain reachable');
for (const action of ['territory_gather_status', 'territory_gather_start', 'territory_gather_claim']) {
  assert.match(map, new RegExp(action), `Keep server-authoritative ${action} operation`);
}
assert.match(map, /<ChamberModal /, 'Preserve cosmetic appearance selection');
assert.doesNotMatch(map, /\{\/\* Resource Regions \*\/\}/, 'Old text-card map must not remain on screen');

assert.match(app, /screen === 'map' \? 'overflow-hidden !px-0 !py-0'/);
assert.match(app, /mapForgeReady/, 'Forge notice must rely on actually affordable equipment upgrades');
assert.match(app, /questAlerts\.readyCount > 0/, 'Quest notices must reflect real completed quests');
assert.match(app, /live\.mail\.length > 0/, 'Message notices must reflect existing received mail');
assert.match(app, /onTrial=\{\(\) => \{ setBattleView\('trial'\)/);
assert.match(app, /onCompanions=\{\(\) => \{ setInventoryTab\('followers'\)/);
assert.match(app, /onRunes=\{\(\) => \{ setHeroTrainingOpen\(true\)/);
assert.match(inventory, /initialTab\?: 'items' \| 'equipment' \| 'followers'/);
assert.match(profile, /initialTrainingOpen= false|initialTrainingOpen = false/);
assert.match(profile, /open=\{trainingOpen\}/);

console.log('World map: all existing destinations, swipe controls, ready resources, rune/trial/companion deep links, mobile art and unchanged server gathering PASS');
