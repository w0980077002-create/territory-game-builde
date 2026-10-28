import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const map = readFileSync('src/components/MapScreen.tsx', 'utf8');
const canvas = readFileSync('src/components/WorldMapCanvas.tsx', 'utf8');
const css = readFileSync('src/components/worldMapCanvas.css', 'utf8');
const worldTest = readFileSync('scripts/check-world-map.mjs', 'utf8');

// Open a resource region: keep the seconds countdown, where a user can see it.
assert.match(map, /const detailOpen = selected !== null && selected !== 'chamber';/);
assert.match(map, /if \(detailOpen\) \{\s*const interval = window\.setInterval\(\(\) => setClock\(Date\.now\(\)\), 1000\)/);
assert.match(map, /window\.clearInterval\(interval\)/);

// Closed region: one timer on gather finish instead of 4 hours of 1 s rerenders.
assert.match(map, /const delay = dueAt - Date\.now\(\);/);
assert.match(map, /window\.setTimeout\(\(\) => setClock\(Date\.now\(\)\), Math\.min\(delay \+ 20, 2_147_483_647\)\)/);
assert.match(map, /window\.clearTimeout\(wakeup\)/);
assert.match(map, /document\.addEventListener\('visibilitychange', onReturn\)/, 'Resume from background without stale ready state');
assert.match(map, /if \(!gather\?\.active\) return;/, 'Idle map must have no polling');
assert.match(map, /Date\.parse\(gather\.active\.finishes_at\) - \(Date\.now\(\) \+ serverOffset\)/, 'Claim checks actual current clock, not last render');
assert.match(map, /const handleWorldVisit = useCallback/, 'Map route prop must be stable across countdown renders');
assert.match(canvas, /export const WorldMapCanvas = memo\(function WorldMapCanvas/, 'Avoid reconciling all 18 map pins on every clock tick');
assert.match(canvas, /requestAnimationFrame\(fling\)/, 'Keep swipe inertia');
assert.match(canvas, /event\.preventDefault\(\)/, 'Keep native touch gestures');
assert.match(canvas, /onClickCapture=/, 'Keep accidental click suppression');
assert.match(canvas, /ref=\{zoomLabelRef\}/, 'Keep map zoom UI');
assert.match(canvas, /sessionStorage\.setItem\(CAMERA_STORAGE_KEY/, 'Keep map camera bookmark');
assert.match(map, /territory_gather_claim/, 'Only server confirms gathering');
assert.doesNotMatch(map, /Math\.random\(|grantRewards\(/, 'No synthetic rewards');
assert.doesNotMatch(css, /territory-world-map__place--ready \{[^}]*animation:/, 'Never animate the filter on the entire location card');
assert.match(css, /territory-world-map__place--ready \.territory-world-map__place-attention[\s\S]*animation: territory-map-ready-pulse/, 'Only the small claim dot pulses');
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(worldTest, /territory_gather_claim/, 'Old world-map regression remains in use');

console.log('Map performance PASS: idle/no polling, countdown only inside modal, one wakeup for ready, preserved swipe/zoom/claims.');
