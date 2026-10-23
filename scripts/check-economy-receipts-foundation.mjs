import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = readFileSync(new URL('../supabase/staged/territory_economy_receipts_foundation_v1.sql', import.meta.url), 'utf8');
const db = new PGlite();
const player = '10000000-0000-4000-8000-000000000001';
const key = '20000000-0000-4000-8000-000000000002';
const secondKey = '20000000-0000-4000-8000-000000000003';
const hash = 'a'.repeat(64);
const other = 'b'.repeat(64);
const call = 'SELECT territory_private.economy_receipt_store_v1($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) result';

async function role(r) {
  await db.exec('RESET ROLE');
  await db.exec('SET ROLE ' + r);
}
async function denied(query, args = []) {
  let failed = false;
  try { await db.query(query,args); }
  catch (e) { failed = /permission denied|not allowed/i.test(String(e)); }
  assert.ok(failed, 'unauthorized operation must be denied');
}
try {
  await db.exec(
    'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; ' +
    'CREATE ROLE service_role NOLOGIN BYPASSRLS; ' +
    'CREATE SCHEMA territory_private; ' +
    'REVOKE ALL ON SCHEMA territory_private FROM PUBLIC, anon, authenticated; ' +
    'CREATE TABLE public.players(id uuid PRIMARY KEY,gold int NOT NULL); ' +
    "INSERT INTO public.players VALUES ('10000000-0000-4000-8000-000000000001',10);"
  );
  const before = await db.query('SELECT count(*)::int n,max(gold) gold FROM public.players');
  await db.exec(sql);
  const after = await db.query('SELECT count(*)::int n,max(gold) gold FROM public.players');
  assert.deepEqual(after.rows,before.rows,'foundation may not alter players');
  const permissions = await db.query(
    "SELECT c.relrowsecurity rls, " +
    "has_table_privilege('anon',c.oid,'INSERT') anon_write, " +
    "has_table_privilege('authenticated',c.oid,'INSERT') auth_write, " +
    "has_table_privilege('authenticated',c.oid,'SELECT') auth_read " +
    "FROM pg_class c WHERE c.oid='territory_private.economy_receipts_v1'::regclass"
  );
  assert.deepEqual(permissions.rows[0],{
    rls:true,anon_write:false,auth_write:false,auth_read:false
  });
  const args=[player,key,'verified_trial',hash,JSON.stringify({gold:10,success:true})];
  await role('authenticated'); await denied(call,args);
  await role('anon'); await denied(call,args);
  await role('service_role');
  const first = await db.query(call,args);
  const retry = await db.query(call,[player,key,'verified_trial',hash,JSON.stringify({gold:999,success:true})]);
  assert.deepEqual(first.rows[0].result,retry.rows[0].result,'retries return first result');
  let collision=false;
  try { await db.query(call,[player,key,'verified_trial',other,JSON.stringify({gold:99})]); }
  catch(e) { collision = String(e).includes('territory_economy_receipt_collision'); }
  assert.ok(collision,'a reused UUID with different parameters must be rejected');
  let count=await db.query('SELECT count(*)::int n FROM territory_private.economy_receipts_v1');
  assert.equal(count.rows[0].n,1);
  await db.exec('BEGIN');
  await db.query(call,[player,secondKey,'verified_shop',hash,JSON.stringify({success:true})]);
  await db.exec('ROLLBACK');
  count=await db.query('SELECT count(*)::int n FROM territory_private.economy_receipts_v1');
  assert.equal(count.rows[0].n,1,'rollback must remove the uncommitted receipt');
  await role('authenticated');
  await denied('SELECT * FROM territory_private.economy_receipts_v1');
  console.log('PASS: protected ledger, replay, collision, rollback, unchanged player');
} finally { await db.close(); }
