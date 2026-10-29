import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const app = read('src/admin/AdminApp.tsx');
const tab = read('src/admin/tabs/NewPlayersTab.tsx');
const dashboard = read('src/admin/tabs/DashboardTab.tsx');
const api = read('supabase/functions/admin-api/index.ts');
const migration = read('supabase/migrations/20261029061500_admin_new_player_registrations_v1.sql');

assert.match(app, /id: 'newplayers', label: 'Новые игроки'/);
assert.match(app, /<NewPlayersTab \/>/);
assert.match(tab, /adminCall<NewPlayersResponse>\('new_players'/);
assert.match(tab, /period, offset: page \* PAGE_SIZE/);
assert.match(tab, /setInterval\(\(\) => void load\(\), 30_000\)/);
assert.match(tab, /Зарегистрирован:/);
assert.match(tab, /countryLabel\(p.country\)/);
assert.match(tab, /online/);
assert.match(dashboard, /Новых сегодня/);
assert.match(dashboard, /Новых за 7 дней/);

assert.match(api, /case "new_players":/);
assert.match(api, /db\.rpc\("territory_admin_new_players_v1"/);
assert.match(api, /newTodayPlayers: newToday\.count/);
assert.match(api, /newWeekPlayers: newWeek\.count/);
assert.match(api, /if \(!\(await verifyToken\(body\.token\)\)\)/);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.territory_admin_new_players_v1/);
assert.match(migration, /created_at >= v_today/);
assert.match(migration, /created_at >= v_week/);
assert.match(migration, /LEFT JOIN territory_private\.player_geo_v1/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.territory_admin_new_players_v1\(text,integer,integer\) FROM PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.territory_admin_new_players_v1\(text,integer,integer\) TO service_role/);
assert.match(migration, /'country', q.country_code/);
console.log('Admin new-player registration integration PASS');
