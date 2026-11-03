import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hook = readFileSync('src/components/ui/useSceneArt.ts', 'utf8');
const wheel = readFileSync('src/components/WheelOfFortune.tsx', 'utf8');
const wheelCss = readFileSync('src/components/fortune.css', 'utf8');
const hero = readFileSync('src/components/HeroShowcase.tsx', 'utf8');
const heroCss = readFileSync('src/components/profileHero.css', 'utf8');

assert.match(hook, /image\.decode\(\)/, 'Artwork must finish decoding before reveal');
assert.match(hook, /Promise\.all\(assets\.map\(load\)\)/, 'All original layers load together');
assert.match(hook, /image\.complete/, 'Cached images must not hang the gate');
assert.match(hook, /return \(\) => \{ active = false; \}/, 'Unmounted screens cannot update state');
assert.doesNotMatch(hook, /playFortune|buyItem|useGame\.set|supabase/, 'Preloader is display-only');

const essentialWheel = [
  'original-scene.webp', 'original-floor.webp', 'original-wheel.webp',
  'original-title.webp', 'original-pointer.webp', 'original-ticket-panel.webp',
  'original-rules-panel.webp', 'original-spin-frame.webp', 'original-ticket.webp',
];
for (const path of essentialWheel) {
  assert.ok(wheel.includes(path), 'Missing preload of original wheel layer: ' + path);
}
assert.match(wheel, /useSceneArt\(WHEEL_SCENE_ART\)/);
assert.match(wheel, /data-testid="fortune-art-gate"/);
assert.match(wheel, /disabled=\{!artReady\|\|busy/, 'No spin while the art is incomplete');
assert.match(wheel, /onClick=\{onBack\}/, 'Player can leave without consuming a ticket');
assert.match(wheel, /recoverFortune\(userId\)/, 'Server receipt recovery stays active');
assert.match(wheel, /acknowledgeFortune\(userId,receipt\.id\)/, 'Receipt acknowledgement stays active');
assert.match(wheelCss, /fortune-screen--art-pending \.fortune-original-scene/);
assert.match(wheelCss, /visibility:hidden/, 'Prevent text rendering before the wheel painting');

assert.match(hero, /useSceneArt\(HERO_HARBOR_ART\)/);
assert.match(hero, /hero-showcase__stage--art-pending/);
assert.match(hero, /harborReady[\s\S]*?sunlit-harbor.webp/, 'Approved harbor is revealed only after decode');
assert.match(heroCss, /hero-showcase__art-gate/, 'Hero has a scenic loading guard');
assert.match(hero, /onClick=\{retryHarbor\}/, 'Failed artwork can be retried');
console.log('Scene-art loading PASS: original Wheel and Hero compositions reveal only when ready, retries and server receipts preserved.');
