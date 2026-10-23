import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('src/components/HomeScreen.tsx');
const analytic = read('src/game/analytics.ts');
const shell = read('src/App.tsx');
const edge = read('supabase/functions/admin-api/index.ts');
const tab = read('src/admin/tabs/PlayersTab.tsx');
const ci = read('.github/workflows/pages.yml');

assert.match(home, /state\.totalBattlesWon === 0/, 'New player hint must disappear after first PvE win');
assert.match(home, /onBattle\('campaign', true\)/, 'First-fight shortcut must use existing battle flow');
assert.match(home, /НАЖМИ НА ВРАГА/, 'Starter needs a visible tap target');
assert.match(shell, /territory_screen_dwell/, 'Navigation dwell is reported for audit');
assert.match(analytic, /\$process_person_profile: false/, 'Analytics must stay anonymous');
assert.match(analytic, /under_10s|over_60s/, 'Only coarse activity buckets may be sent');
assert.doesNotMatch(analytic, /telegram_id|user\.id|player\.id|display_name/, 'No personal IDs in event emitter');
assert.match(edge, /case "suspicious":/, 'Preserve authenticated owner suspicious endpoint');
assert.match(edge, /territory_economy_audit_v1/, 'Include actual economy audit log');
assert.match(edge, /admin_grants/, 'Correlate administrator rewards without marking guilt');
assert.match(edge, /auditReply\.error/, 'Temporary audit failures must degrade gracefully');
assert.doesNotMatch(edge.slice(edge.indexOf('case "suspicious":'),edge.indexOf('case "mail":')), /\.delete\(|\.update\(|\.insert\(/,
 'Suspicious endpoint must remain read-only');
assert.match(tab, /Автоматических банов нет/, 'Only owner decides about bans');
assert.match(tab, /auditSummary\.events/, 'Present concrete audit counts');
assert.match(ci, /check-activity-audit\.mjs/, 'Pages gate must check analytics and audit integrity');
console.log('Territory one-pass audit: newcomer path, anonymous metrics, read-only owner alerts, manual bans — PASS');
