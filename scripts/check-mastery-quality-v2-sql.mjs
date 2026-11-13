import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {masteryQualityTier} from './professions/mastery-quality-v2.mjs';

const sql=await readFile(new URL('../supabase/staged/territory_mastery_quality_v2_inactive.sql',import.meta.url),'utf8');
assert.doesNotMatch(sql,/\b(?:UPDATE|DELETE|TRUNCATE|INSERT)\s+(?:INTO\s+|FROM\s+)?public\./i,
  'Quality rule must not modify existing server data');
assert.doesNotMatch(sql,/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+.*\b(?:authenticated|anon)\b/i,
  'This private helper is not an open client RPC');

const db=new PGlite();
try{
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  await db.exec(sql);
  const f='territory_private.territory_mastery_quality_pct_v2($1::int,$2::boolean)';
  for(let level=1;level<=300;level++){
    for(const licensed of [false,true]){
      const x=(await db.query('SELECT '+f+' AS pct',[level,licensed])).rows[0].pct;
      assert.equal(x,masteryQualityTier(level,licensed).pct,
        'Postgres and JS quality mismatch at mastery '+level+' licensed '+licensed);
    }
  }
  // Verify the function has no anonymous or authenticated EXECUTE privilege.
  const check=await db.query(`SELECT
    has_function_privilege('anon','territory_private.territory_mastery_quality_pct_v2(integer,boolean)','EXECUTE') AS anon_ok,
    has_function_privilege('authenticated','territory_private.territory_mastery_quality_pct_v2(integer,boolean)','EXECUTE') AS auth_ok`);
  assert.equal(check.rows[0].anon_ok,false);
  assert.equal(check.rows[0].auth_ok,false);
  // Run the deliberately failing SQL last: PGlite rolls back its transaction.
  await assert.rejects(db.query('SELECT '+f,[-1,true]),/invalid_mastery_or_license/);
  console.log('Mastery quality v2 SQL PASS — 600 server/client combinations, private grants, zero player changes');
}finally{await db.close();}
