import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const source = (path) => readFileSync(path, 'utf8');
const bundled = await build({
  entryPoints: ['src/game/mortarionCityClock.ts'],
  platform: 'node', format: 'esm', bundle: true, write: false,
});
const { formatMortarionCityCountdown, mortarionCityTimeRemaining } =
  await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const start = '2026-11-09T16:16:01.000Z';
const end = '2026-11-14T16:16:01.000Z';
const fiveDays = 5 * 24 * 60 * 60 * 1000;
assert.equal(mortarionCityTimeRemaining(end, start, 1000, 1000), fiveDays,
  'Timer starts at exactly five days from server clock');
assert.equal(mortarionCityTimeRemaining(end, start, 1000, 46_000), fiveDays - 45_000,
  'Timer subtracts elapsed monotonic time without needing a device wall clock');
assert.equal(mortarionCityTimeRemaining(end, start, 1000, 0), fiveDays,
  'Timer cannot gain time from a backward tick');
assert.equal(mortarionCityTimeRemaining(end, start, 0, fiveDays + 120), 0,
  'Timer reaches zero and never goes negative');
assert.equal(mortarionCityTimeRemaining('invalid', start, 0, 0), null,
  'An invalid server deadline must not show a fake countdown');
assert.equal(formatMortarionCityCountdown(fiveDays, false), '5д 00:00:00');
assert.equal(formatMortarionCityCountdown(fiveDays - 1000, true), '4d 23:59:59');
assert.equal(formatMortarionCityCountdown(999, false), '0д 00:00:01');
assert.equal(formatMortarionCityCountdown(0, false), '0д 00:00:00');

const home = source('src/components/HomeScreen.tsx');
const app = source('src/App.tsx');
const events = source('src/components/EventsScreen.tsx');
const city = source('src/components/home/MortarionCityShortcut.tsx');
const css = source('src/components/home/mortarionCityShortcut.css');
assert.match(home, /<MortarionCityShortcut/, 'City must show a direct raid entry');
assert.ok(home.indexOf('<MortarionCityShortcut') > home.indexOf('className="home-chapter'),
  'Raid shortcut must appear below the campaign chapter');
assert.ok(home.indexOf('<MortarionCityShortcut') < home.indexOf('home-side-stack absolute'),
  'Raid shortcut should remain inside the City main scene');
assert.match(home, /'events' \| 'mortarion'/, 'City opens Mortarion through normal route');
assert.match(app, /screen === 'mortarion' && <MortarionBossScreen playerId=\{user.id\}/,
  'City route continues to display the existing live boss and reward screen');
assert.doesNotMatch(events, /[Mm]ortarion|Мортарион|bossPreview|onBossPreview/,
  'Events must not render or poll the removed Mortarion event card');
assert.match(city, /getMortarionBossState\(\)/, 'Shortcut reads real server state');
assert.match(city, /if \(!snapshot\?\.raid\.enabled\) return null/,
  'Disabled raids are not advertised');
assert.match(city, /\.active|const closed = defeated \|\| remaining === 0/,
  'Finished raids must retain an entry for rewards');
assert.match(city, /setInterval\(refresh, 30_000\)/, 'A long City session refreshes raid status');
assert.match(city, /document\.addEventListener\('visibilitychange', resume\)/,
  'Timer refreshes after Telegram is foregrounded');
assert.match(city, /<button type="button" onClick=\{onOpen\}/,
  'Tapping the city raid icon opens the real boss');
assert.match(css, /top: calc\(var\(--home-chapter-top\) \+ 24px\)/,
  'Raid tile follows chapter position on short Android and iPhone screens');
assert.match(css, /width: min\(230px, calc\(100% - 112px\)\)/,
  'Tile stays between the two City side menus');
assert.match(css, /prefers-reduced-motion: reduce/,
  'Respect reduced motion');
assert.doesNotMatch(city, /hitMortarionBoss|claimMortarionReward|useGame\.set/,
  'City shortcut must never spend attacks, claim rewards or mutate game saves');
console.log('Mortarion City navigation and five-day server countdown: PASS');
