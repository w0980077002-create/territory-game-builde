import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(path, 'utf8');

const sql = read('supabase/migrations/20261103_halloween_final_mail_visibility_v1.sql');
const live = read('src/game/live.ts');
const inbox = read('src/components/home/HomeSheets.tsx');

assert.match(sql, /halloween_final_mail_reads_2026/);
assert.match(sql, /player_id uuid PRIMARY KEY/);
assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
assert.match(sql, /REVOKE ALL ON TABLE territory_private\.halloween_final_mail_reads_2026 FROM PUBLIC, anon, authenticated/);
assert.match(sql, /WHERE m\.player_id = v_uid[\s\S]*?m\.kind = 'mail'/);
assert.match(sql, /m\.claimed_at IS NOT NULL/);
assert.match(sql, /NOT EXISTS \([\s\S]*?halloween_final_mail_reads_2026/);
assert.match(sql, /m\.player_id = v_uid[\s\S]*?m\.kind = 'mail'/);
assert.match(sql, /ON CONFLICT \(player_id\) DO NOTHING/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.territory_halloween_final_mail_unseen_v1\(\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.territory_halloween_final_mail_ack_v1\(uuid\) TO authenticated/);
assert.doesNotMatch(sql, /UPDATE\s+public\.admin_grants|UPDATE\s+public\.players/i,
  'Showing an already-claimed prize must never touch wallets, saves, or claim timestamps');

assert.match(live, /export async function getUnseenHalloweenFinalMail/);
assert.match(live, /export async function acknowledgeHalloweenFinalMail/);
assert.match(live, /supabase\.rpc\('territory_halloween_final_mail_unseen_v1'\)/);
assert.match(live, /supabase\.rpc\('territory_halloween_final_mail_ack_v1'/);
assert.match(inbox, /const previouslyClaimedFinal = !received && unseenHalloweenFinal\?\.id === m\.id/);
assert.match(inbox, /unseenHalloweenFinal \? \[unseenHalloweenFinal/);
assert.match(inbox, /history\.filter\(\(m\) => m\.id !== unseenHalloweenFinal\?\.id\)/);
assert.match(inbox, /onClick=\{\(\) => void acknowledgeFinal\(m\.id\)\}/);
assert.match(inbox, /previouslyClaimedFinal \? \(/);
assert.match(inbox, /onClick=\{\(\) => void claimAdmin\(m\.id\)\}/);
assert.match(inbox, /Награды уже зачислены/);
assert.match(inbox, /Your rewards are already in your inventory/);
assert.ok(inbox.includes('mail.id === id && mail.subject === HALLOWEEN_FINAL_SUBJECT'),
  'Final companion mail must not reappear in New after its normal claim');
for (const fixture of ['build-daily-hero-preview.mjs', 'build-journal-preview.mjs', 'build-comfort-preview.mjs']) {
  const source = read('scripts/' + fixture);
  assert.ok(source.includes('getUnseenHalloweenFinalMail'), fixture + ' must mock inbox read RPC');
  assert.ok(source.includes('acknowledgeHalloweenFinalMail'), fixture + ' must mock one-time notice acknowledgement');
}
console.log('HALLOWEEN FINAL VISIBILITY PASS: one new informational read, private RLS, no double claim.');
