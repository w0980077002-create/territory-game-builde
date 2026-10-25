import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const live = readFileSync('src/game/live.ts', 'utf8');
const home = readFileSync('src/components/home/HomeSheets.tsx', 'utf8');
const city = readFileSync('src/components/HomeScreen.tsx', 'utf8');
const arena = readFileSync('src/components/ArenaScreen.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const adminSql = readFileSync('supabase/migrations/20261008213243_admin_panel_core.sql', 'utf8');

assert.match(adminSql, /CREATE POLICY "select_own_grants" ON admin_grants FOR SELECT TO authenticated USING \(auth\.uid\(\) = player_id\)/,
  'history must only be selectable by the owning player');
assert.match(live, /export async function getClaimedMailHistory/);
assert.match(live, /\.from\('admin_grants'\)/);
assert.match(live, /\.eq\('kind', 'mail'\)/, 'only real letters, not admin adjustments');
assert.match(live, /\.not\('claimed_at', 'is', null\)/, 'only claimed letters appear in history');
assert.match(live, /\.range\(start, start \+ size\)/, 'older letters must be reachable through pagination');
assert.match(home, /setTab\('received'\)/, 'claimed letters should open in the received tab');
assert.match(home, /shownAdminMail = received \? history : adminMail/);
assert.match(home, /getClaimedMailHistory\(offset\)/);
assert.match(home, /historyHasMore/, 'older letters must be loadable');
assert.match(home, /export function MailInbox/, 'mail must be embedded within Messages, not a city modal');
assert.match(home, /aria-expanded=\{expanded\}/, 'message rows should be compact until opened');
assert.doesNotMatch(city, /<MailSheet/, 'city must never overlay the hero with a mail dialog');
assert.match(city, /onOpen\('messages'\)/, 'city envelope must navigate to Messages');
assert.doesNotMatch(arena, /<MailSheet/, 'arena must not overlay combat with a mail dialog');
assert.match(app, /screen === 'messages' && <MessagesScreen/, 'Messages must be a dedicated screen');
assert.match(home, /taps\.current\.count >= 5/, 'hidden admin entry must remain unchanged');

console.log('MAIL HISTORY PASS: private durable archive, new/received tabs, and pagination.');
