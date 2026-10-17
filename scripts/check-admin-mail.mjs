import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(path, 'utf8');
const edge = read('supabase/functions/admin-api/index.ts');
const mail = read('src/admin/tabs/MailTab.tsx');
const players = read('src/admin/tabs/PlayersTab.tsx');
const sql = read('supabase/migrations/20261017_admin_scheduled_mail_v1.sql');
const home = read('src/components/home/HomeSheets.tsx');
for (const action of ['warn','mail_schedule','mail_schedules','mail_schedule_cancel','mail','ban']) {
 assert.ok(edge.includes('case "'+action+'":'), 'admin action missing: '+action);
}
assert.match(players, /warnPlayer/, 'warnings must be explicitly initiated by owner');
assert.match(players, /confirm\(.*предупреждение без блокировки/, 'manual warning must be confirmed');
assert.match(players, /Автоматических банов нет/, 'owner must see manual-moderation policy');
assert.match(mail, /length: 3/, 'exactly three reward inputs');
assert.match(mail, /selected\.has\(slot\.key\)/, 'duplicate reward selected twice must be rejected');
assert.match(mail, /payload\.items = \{ \.\.\.payload\.items, \.\.\.part\.items \}/, 'item rewards must combine, not overwrite');
assert.match(mail, /datetime-local/, 'date and time picker required');
assert.match(mail, /mail_schedule_cancel/, 'cancellation must be offered');
assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_cron/);
assert.match(sql, /FOR UPDATE SKIP LOCKED/, 'worker must lock scheduled jobs');
assert.match(sql, /status='sent'/, 'dispatch must mark sent');
assert.match(sql, /cron\.schedule/, 'server-side schedule required');
assert.match(sql, /REVOKE ALL ON FUNCTION public\.territory_admin_mail_schedule_v1/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.territory_admin_mail_schedule_v1.* TO service_role/s);
assert.doesNotMatch(edge, /automaticallyBan|autoBan|auto_ban/i, 'never automatically ban');
assert.match(home, /taps\.current\.count >= 5/, 'hidden owner entrance must stay 5 taps');
assert.match(edge, /if \(version === 1\)/, 'original owner login token format unchanged');
console.log('ADMIN MAIL PASS: manual-only moderation, triple rewards, private durable scheduled mail.');
