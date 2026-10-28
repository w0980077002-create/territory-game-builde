import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, home, map, world, professions, auction] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/HomeScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/WorldMapCanvas.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ProfessionsScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AuctionScreen.tsx', import.meta.url), 'utf8'),
]);

assert.match(app, /screen === 'map' && <MapScreen\b/, 'Map must remain a standalone screen');
assert.match(app, /onTrial=\{\(\) =>/, 'Map must keep the separate Trials route');
assert.match(app, /onCompanions=\{\(\) =>/, 'Map must keep the Companion route');
assert.match(app, /onRunes=\{\(\) =>/, 'Map must keep the Runes route');
assert.match(app, /screen === 'professions' && \(STAGE8_CLIENT_OPT_IN \? <Stage8ProfessionsScreen onNavigate=/,
  'Owner-enabled secure professions must keep the same standalone screen and a rollback path');
assert.match(app, /screen === 'auction' && <AuctionScreen \/>/, 'Auction must have its own route');
assert.match(world, /\{ id: 'auction', ru: 'Аукцион'/, 'World map must keep an auction destination after sidebar decluttering');
assert.match(map, /default: onNavigate\(place\)/, 'Map landmarks must open the auction through main navigation');
assert.match(map, /onClick=\{\(\) => gatherResource\(res\)\}/, 'Map resource nodes must gather resources');
assert.doesNotMatch(map, /Регион откроется с системой профессий|Скоро: профессии/, 'Gathering zones must not be disabled placeholders');
assert.doesNotMatch(professions, /tab === 'gather'|tab === 'auction'/, 'Gathering and auction must not be embedded as profession tabs');
assert.match(auction, /supabase\.channel\(CHAT_TOPIC/, 'Auction screen must connect to live chat');
assert.match(auction, /event: 'chat-message'/, 'Auction screen must broadcast chat messages');
assert.match(auction, /t\('tradingDisabled'\)/, 'Unimplemented market trades must remain clearly disabled in both languages');

console.log('Feature separation passed: map gathering, profession/crafting screen, and standalone auction with live chat.');
