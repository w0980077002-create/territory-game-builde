import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql=readFileSync('supabase/migrations/20261111012000_arena_guard_live_belt_v1.sql','utf8');
const quota=readFileSync('supabase/migrations/20261110224000_arena_limit_consumables_per_battle_v1.sql','utf8');
const expiry=readFileSync('supabase/migrations/20261111015500_arena_expiry_enforcement_v1.sql','utf8');
const body=sql.slice(sql.indexOf('ELSIF p_action = \'item\' THEN'));
const journal=body.indexOf('INSERT INTO territory_private.arena_consumable_usage_v1');
const save=body.indexOf('UPDATE public.players SET game_state=v_state WHERE id=v_uid RETURNING * INTO v_p');
assert.ok(journal>=0 && save>=0 && journal<save, 'Server transaction must journal BEFORE belt mutation');
assert.match(sql,/r\.status='active'/,'Only live fights freeze manual belt changes');
assert.match(sql,/v_changes > 1/,'Reject replacement of multiple slots');
assert.match(sql,/NEW\.game_state->'inventory' IS DISTINCT FROM OLD\.game_state->'inventory'/,
 'Do not hide an inventory transfer inside an authenticated battle debit');
assert.match(sql,/u\.xmin::text=pg_catalog\.pg_current_xact_id\(\)::text/,
 'Only an item ledger row inserted by this transaction can authorize one spent charge');
assert.match(sql,/arena_live_belt_locked/);
assert.match(quota,/>= 5 THEN/,'Enforce max five of every item kind per room and hero');
assert.match(quota,/BEFORE INSERT ON territory_private\.arena_consumable_usage_v1/);
assert.match(expiry,/arena_invalid_item_expiry/,'Server rejects missing or malformed item expiry');
assert.match(expiry,/arena_item_expired/,'Server checks real current time on every use');
assert.match(expiry,/interval '8 days'/,'Server rejects forged perpetual shelf lives');
console.log('Arena guard contract PASS: live belt immutable except journaled transaction debits, max five.');
