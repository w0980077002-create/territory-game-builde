import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');
const [home, app, css, html] = await Promise.all([
  read('src/components/HomeScreen.tsx'),
  read('src/App.tsx'),
  read('src/index.css'),
  read('index.html'),
]);

assert.match(home, /city-bg-vibrant\.webp/, 'Home must use the vivid city background asset');
assert.match(home, /ic-auction\.svg/, 'Auction needs its own unique button artwork');
assert.match(home, /ic-professions\.svg/, 'Professions needs its own unique button artwork');
assert.doesNotMatch(home, /SideButton icon="\/ic-shop\.webp" label=\{t\('auction'\)\}/, 'Auction must not reuse the shop image');
assert.doesNotMatch(home, /SideButton icon="\/ic-forge\.webp" label=\{t\('professions'\)\}/, 'Professions must not reuse the forge image');
assert.match(home, /setLanguage\(language === 'ru' \? 'en' : 'ru'\)/, 'Language switch must remain interactive');
assert.match(home, /<EquipCells/, 'Equipment slots must remain on the home screen');
assert.match(home, /<BeltCells/, 'Potion belt must remain on the home screen');
assert.match(app, /ic-auction\.svg/, 'Auction sub-screen must use its unique icon');
assert.match(app, /ic-professions\.svg/, 'Professions sub-screen must use its unique icon');
assert.match(html, /viewport-fit=cover/, 'Viewport must respect modern mobile safe areas');
assert.match(app, /env\(safe-area-inset-bottom\)/, 'Bottom navigation must respect mobile safe areas');
for (const asset of ['public/city-bg-vibrant.webp', 'public/ic-auction.svg', 'public/ic-professions.svg', 'public/territory-mark.svg']) {
  await access(new URL(asset, root));
}
console.log('Mobile home UI checks passed: vivid background, unique Auction/Professions art, language toggle, gear, potion belt and safe-area setup.');
