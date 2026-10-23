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

const [forge, modal, inventory, arenaLobby, arenaRoom, monopoly, monopolyAdventure] = await Promise.all([
  read('src/components/ForgeScreen.tsx'),
  read('src/components/ui/Modal.tsx'),
  read('src/components/InventoryScreen.tsx'),
  read('src/components/arena/ArenaLobby.tsx'),
  read('src/components/arena/ArenaRoom.tsx'),
  read('src/components/MonopolyScreen.tsx'),
  read('src/components/monopoly/MonopolyAdventure.tsx'),
]);

assert.match(home, /<LiveCityBackdrop animated=\{cityMotion\}/, 'Home must render the approved layered city backdrop');
assert.match(home, /className="home-hero-figure/, 'City hero must have a separate sizing wrapper');
assert.match(home, /className="home-follower-figure/, 'City follower must have a separate sizing wrapper');
for (const [id, scale] of [
  ['follower_1', '1.00'],
  ['follower_2', '1.42'],
  ['follower_3', '1.40'],
  ['follower_4', '1.14'],
  ['follower_5', '1.48'],
]) {
  assert.ok(home.includes(`${id}: ${scale}`), `Companion ${id} must be visually normalized for its sprite padding`);
}
assert.match(home, /HOME_FOLLOWER_ART_SCALE\[follower\.id\]/, 'The selected companion must use its own display scale');
assert.match(home, /home-follower-art-frame absolute inset-x-0 bottom-0/, 'Companions must remain grounded regardless of their sprite');
assert.match(css, /\.home-follower-art-frame\s*\{\s*transform-origin: center bottom;/, 'Sprite scaling must be foot-anchored');

assert.match(css, /\.home-hero-figure\s*\{\s*transform: scale\(1\.25\)/, 'Main hero grows by 25%');
assert.match(css, /\.home-follower-figure\s*\{[\s\S]*?transform: scale\(1\.60\)/, 'Companion is enlarged enough to see at normal phone size');
assert.match(css, /\.home-follower-figure \{ transform: scale\(1\.33\); \}/, 'Keep companion visible without side-menu overlap on very narrow screens');
assert.match(home, /home-follower-ground-shadow/, 'Companion must have a separate ground shadow');
assert.match(css, /\.home-follower-figure\s*\{[\s\S]*?z-index: 1;/, 'Companion must not disappear behind the hero');
assert.match(home, /home-follower-figure relative h-\[66%\] w-\[28%\]/, 'Companion has increased stage room');
assert.match(css, /\.home-character-stage::before/, 'Background contrast must stay local to characters');
assert.match(css, /\.home-hero-art\s*\{[\s\S]*?drop-shadow/, 'Hero must remain legible over the harbor');
assert.match(home, /onClick=\{\(\) => onBattle\('campaign', true\)\}/, 'Enemy tap target must remain active');

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
assert.ok(app.includes("icon: '/nav-hero-crown.webp'"), 'Approved muted gold/blue crown icon must appear in Hero navigation');
assert.ok(app.includes("icon: '/nav-map-parchment.webp'"), 'Approved parchment and compass icon must appear in Map navigation');
assert.ok(app.includes("t.id === 'hero' || t.id === 'map' ? 'w-9 h-9'"), 'Both new icons must be readable without changing the button layout');

assert.match(app, /ic-professions\.svg/, 'Professions sub-screen must use its unique icon');
assert.match(html, /viewport-fit=cover/, 'Viewport must respect modern mobile safe areas');
assert.match(css, /env\(safe-area-inset-bottom/, 'Telegram shell must respect the iPhone home indicator');
assert.match(css, /\.home-side-stack \.home-side/, 'Home side buttons must keep a tappable height');
assert.match(css, /overscroll-behavior-y: contain/, 'Small phone side controls must scroll internally');
assert.match(css, /\.territory-nav-label/, 'Bottom nav labels must wrap instead of clipping');
assert.match(app, /territory-city-screen/, 'City must support very short phone screens');
assert.match(app, /territory-city-screen overflow-y-auto overflow-x-hidden/,
  'City can scroll within its own pane when the Telegram viewport is short');
assert.match(css, /container-name: territory-city;/,
  'Measure usable city pane instead of relying only on device height');
assert.match(css, /@container territory-city \(max-height: 560px\)/,
  'Enable compact city fallback based on actual available height');
assert.match(telegram, /window\.visualViewport\?\.height/,
  'Clamp game viewport against the actually visible WebView');
assert.match(telegram, /Math\.floor\(Math\.min\(\.\.\.candidates\)\)/,
  'Never size game larger than the smallest supported viewport');
assert.match(telegram, /window\.visualViewport\?\.addEventListener\('resize', refresh\)/,
  'Recalculate game height when the WebView visual viewport changes');
assert.match(css, /padding-bottom: max\(6px, env\(safe-area-inset-bottom/,
  'Keep a visible bottom gutter below the navigation');
assert.match(app, /onContextMenuCapture/, 'Android WebView image and button menus must be blocked');
assert.match(app, /onDragStartCapture/, 'Dragging game pictures must not open image URLs');
assert.match(css, /-webkit-touch-callout: none/, 'iOS native image callouts must be disabled');
assert.match(css, /\.territory-shell button img/, 'Artwork inside interactive buttons must pass presses to the button');
assert.match(telegram, /requestFullscreen/, 'Telegram should request fullscreen when supported');
assert.match(telegram, /const iosTelegram = tg.platform === 'ios'/,
  'iOS must use a separate Telegram layout path');
assert.match(telegram, /phoneTelegram && !iosTelegram && tg.requestFullscreen/,
  'iPhone must not force native Telegram into fullscreen under its header');
assert.match(telegram, /tg.isFullscreen && \(iosTelegram \|\| !phoneTelegram\)/,
  'Previously fullscreen iPhones must return to the native expanded window');
assert.match(css, /html\.territory-ios-webapp \.home-side-stack-right \.home-side:last-child/,
  'iPhone must keep Arena visible as the first city shortcut');

assert.match(css, /html\.territory-ios-webapp \.territory-city-screen \.home-game-scene\s*\{[\s\S]*?min-height: 0;/,
  'Native iPhone sheet must override the 540px scene minimum');
assert.match(css, /html\.territory-ios-webapp \.home-bottom-controls\s*\{[\s\S]*?position: relative;/,
  'iPhone bottom controls must stay inside the visible city canvas');
assert.match(home, /className="home-bottom-controls absolute z-20/,
  'Home bottom controls need an iOS-only positioning hook');
assert.match(css, /@container territory-city \(max-height: 620px\)/,
  'Compact native iPhone scene must respond to usable pane height');


/* iOS modal regression guards: important actions must not disappear under the
   permanent bottom navigation. Android and desktop remain unchanged. */
assert.match(modal, /classList\.contains\('territory-ios-webapp'\)/,
  'Only native iOS may move overlays into the game shell');
assert.match(modal, /createPortal\(children, host\)/,
  'iPhone dialogs must render above bottom navigation');
assert.match(modal, /host \? createPortal\(children, host\) : <>\{children\}<\/>/,
  'Android and desktop must preserve their existing dialog tree');
assert.match(forge, /<IosGamePortal>/,
  'Forge dialog must render above the bottom navigation');
assert.match(forge, /className="forge-upgrade-panel /,
  'Forge panel must be height-bounded on iPhone');
assert.match(forge, /className="forge-upgrade-scroll"/,
  'Forge stats and costs must scroll inside the dialog');
assert.match(forge, /className="forge-upgrade-actions"/,
  'Upgrade action must be reachable at the dialog bottom');
assert.match(css, /html\.territory-ios-webapp \.forge-upgrade-actions\s*\{[\s\S]*?flex:\s*0 0 auto/,
  'Upgrade button must stay visible when stats scroll');
for (const [name, source] of [
  ['inventory', inventory], ['arena rules', arenaLobby],
  ['arena confirmation', arenaRoom], ['Monopoly reward', monopoly],
]) {
  assert.match(source, /<IosGamePortal>/, name + ' must also overlay the navigation');
}
assert.match(css, /html\.territory-ios-webapp \.territory-shell > \.territory-modal/,
  'iOS dialogs must be bounded by the shell, not the external Telegram header');
assert.match(css, /html\.territory-ios-webapp \.inventory-item-overlay > \.card/,
  'iOS inventory actions must scroll inside a bounded dialog');
assert.match(monopolyAdventure, /\{panel&&<IosGamePortal>/,
  'Actual Monopoly v2 panels must portal above bottom navigation');
assert.match(monopolyAdventure, /\{reward&&<IosGamePortal>/,
  'Actual Monopoly v2 celebrations must portal above bottom navigation');


assert.match(telegram, /disableVerticalSwipes\?/, 'Telegram SDK typing must expose native swipe control');
assert.match(telegram, /tg\.disableVerticalSwipes\(\)/, 'Telegram must disable sheet drag gestures on supported clients');
assert.match(telegram, /isVersionAtLeast\('7\.7'\)/, 'Swipe setting must be guarded for older Telegram clients');
assert.match(telegram, /classList\.add\('territory-telegram-webapp'\)/, 'Scope no-page-scroll behavior to the game Mini App');
assert.match(css, /html\.territory-telegram-webapp body/, 'Prevent document rubber-band only in the Telegram game');
assert.match(css, /\.territory-screen \{[\s\S]*?overscroll-behavior-y: contain/, 'Keep touch scrolling inside game screens');
assert.match(telegram, /contentSafeAreaInset/, 'Fullscreen must account for Telegram header overlays');
assert.match(app, /--tg-viewport-stable-height, 100dvh/, 'Telegram iOS viewport must not hide the game behind its native header');
assert(home.includes('w-[clamp(74px,23vw,96px)]'), 'Hero name must have responsive width on iPhone');
assert.match(home, /whitespace-nowrap/, 'Hero level and VIP must stay on one line');
assert.match(app, /Прогресс не сохранён! Не закрывайте игру, проверьте сеть/, 'Save failure must remain clearly visible in compact mobile layout');


/* Real iPhone 15 screenshots: avoid the oversized Monopoly reward panel
   and preserve access to dice + inventory filters inside Telegram's sheet. */
const [monopolyCss, gearCss] = await Promise.all([
  read('src/components/monopoly/monopoly.css'),
  read('src/components/GearShowcase.css'),
]);
assert.match(monopolyCss, /html\.territory-ios-webapp \.territory-shell > \.mono-celebration > section\s*\{[\s\S]*?max-height: min\(420px, 100%\)/,
  'iPhone treasure reward must be a compact dialog rather than filling the screen');
assert.match(monopolyCss, /html\.territory-ios-webapp \.mono-celebration \.mono-opening-chest\s*\{[\s\S]*?width: 112px/,
  'iPhone treasure chest artwork must be compact without changing the reward');
assert.match(monopolyCss, /html\.territory-ios-webapp \.territory-monopoly \.mono-scene\s*\{[\s\S]*?--territory-viewport-height/,
  'iPhone Monopoly board should respect available Telegram height');
assert.match(gearCss, /html\.territory-ios-webapp \.gear-stage-ring\s*\{[\s\S]*?height: clamp/,
  'iPhone gear layout must reserve space for the bag');
assert.match(gearCss, /html\.territory-ios-webapp \.gear-filter-strip/,
  'Gear item filters must remain discoverably scrollable on iPhone');

for (const asset of ['public/city-bg-vibrant.webp', 'public/ic-auction.svg', 'public/ic-professions.svg', 'public/territory-mark.svg', 'public/nav-hero-crown.webp', 'public/nav-map-parchment.webp']) {
  await access(new URL(asset, root));
}
console.log('Mobile home UI checks passed: living city, responsive sides and nav, Telegram fullscreen, safe-area, language, gear.');
