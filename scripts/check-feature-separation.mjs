import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, home, map, professions, auction] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/HomeScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ProfessionsScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AuctionScreen.tsx', import.meta.url), 'utf8'),
]);

assert.match(app, /screen === 'map' && <MapScreen \/>/, 'Map must remain a standalone screen');
assert.match(app, /screen === 'professions' && <ProfessionsScreen \/>/, 'Professions must remain a standalone screen');
assert.match(app, /screen === 'auction' && <AuctionScreen \/>/, 'Auction must have its own route');
assert.match(home, /label=\{t\('auction'\)\} onClick=\{\(\) => onOpen\('auction'\)\}/, 'City must expose a separate auction shortcut');
assert.match(map, /onClick=\{\(\) => gatherResource\(res\)\}/, 'Map resource nodes must gather resources');
assert.doesNotMatch(map, /Регион откроется с системой профессий|Скоро: профессии/, 'Gathering zones must not be disabled placeholders');
assert.doesNotMatch(professions, /tab === 'gather'|tab === 'auction'/, 'Gathering and auction must not be embedded as profession tabs');
assert.match(auction, /supabase\.channel\(CHAT_TOPIC/, 'Auction screen must connect to live chat');
assert.match(auction, /event: 'chat-message'/, 'Auction screen must broadcast chat messages');
assert.match(auction, /t\('tradingDisabled'\)/, 'Unimplemented market trades must remain clearly disabled in both languages');

console.log('Feature separation passed: map gathering, profession/crafting screen, and standalone auction with live chat.');
