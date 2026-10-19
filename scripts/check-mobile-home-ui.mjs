import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');
const [home, app, css, html, city, sheets, telegram] = await Promise.all([
  read('src/components/HomeScreen.tsx'),
  read('src/App.tsx'),
  read('src/index.css'),
  read('index.html'),
  read('src/components/home/LiveCityBackdrop.tsx'),
  read('src/components/home/HomeSheets.tsx'),
  read('src/game/telegram.ts'),
]);

assert.match(home, /<LiveCityBackdrop animated=\{cityMotion\}/, 'Home must render the approved layered city backdrop');
assert.match(city, /live-city-bg\.webp/, 'Portrait Viking harbour backdrop must be installed');
assert.match(city, /live-city-ship\.webp/, 'Viking ships must have a subtle motion overlay');
assert.match(city, /live-city-waterfall/, 'Waterfalls must have visual motion');
assert.match(sheets, /Живой город/, 'Animated city must have an on/off setting');
assert.match(css, /prefers-reduced-motion/, 'City motion must respect accessibility setting');
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
assert.match(css, /env\\(safe-area-inset-bottom/, 'Telegram shell must respect the iPhone home indicator');
assert.match(css, /\\.home-side-stack \\.home-side/, 'Home side buttons must keep a tappable height');
assert.match(css, /overscroll-behavior-y: contain/, 'Small phone side controls must scroll internally');
assert.match(css, /\\.territory-nav-label/, 'Bottom nav labels must wrap instead of clipping');
assert.match(app, /territory-city-screen/, 'City must support very short phone screens');
assert.match(telegram, /requestFullscreen/, 'Telegram should request fullscreen when supported');
assert.match(telegram, /contentSafeAreaInset/, 'Fullscreen must account for Telegram header overlays');
assert.match(app, /--tg-viewport-stable-height, 100dvh/, 'Telegram iOS viewport must not hide the game behind its native header');
assert(home.includes('w-[clamp(74px,23vw,96px)]'), 'Hero name must have responsive width on iPhone');
assert.match(home, /whitespace-nowrap/, 'Hero level and VIP must stay on one line');
assert.match(app, /Прогресс не сохранён! Не закрывайте игру, проверьте сеть/, 'Save failure must remain clearly visible in compact mobile layout');

for (const asset of ['public/city-bg-vibrant.webp', 'public/ic-auction.svg', 'public/ic-professions.svg', 'public/territory-mark.svg']) {
  await access(new URL(asset, root));
}
console.log('Mobile home UI checks passed: living city, responsive sides and nav, Telegram fullscreen, safe-area, language, gear.');
