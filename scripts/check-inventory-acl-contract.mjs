import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql=readFileSync(new URL('../supabase/staged/territory_inventory_legacy_direct_write_lock_20261021.sql',import.meta.url),'utf8');
const db=new PGlite();
const grants=async()=>(
  await db.query(
    "SELECT has_table_privilege('anon','public.player_inventory','INSERT') ai,"+
    "has_table_privilege('authenticated','public.player_inventory','INSERT') ui,"+
    "has_table_privilege('authenticated','public.player_inventory','UPDATE') uu,"+
    "has_table_privilege('authenticated','public.player_inventory','DELETE') ud,"+
    "has_table_privilege('authenticated','public.player_inventory','SELECT') us,"+
    "has_table_privilege('service_role','public.player_inventory','INSERT') si"
  )
).rows[0];
try {
  await db.exec(
    "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"+
    "CREATE ROLE service_role NOLOGIN BYPASSRLS;"+
    "CREATE TABLE public.player_inventory(id int PRIMARY KEY,owner_id int);"+
    "ALTER TABLE public.player_inventory ENABLE ROW LEVEL SECURITY;"+
    "INSERT INTO public.player_inventory(id,owner_id) VALUES(1,10);"+
    "GRANT ALL ON public.player_inventory TO anon,authenticated,service_role;"
  );
  const before=await grants();
  assert.equal(before.ai,true);
  assert.equal(before.ui,true);
  await db.exec(sql);
  const after=await grants();
  assert.deepEqual(after,{ai:false,ui:false,uu:false,ud:false,us:true,si:true});
  assert.equal((await db.query('SELECT count(*)::int n FROM public.player_inventory')).rows[0].n,1,'no historical items deleted');
  await db.exec('BEGIN;SET LOCAL ROLE service_role;INSERT INTO public.player_inventory VALUES(2,20);COMMIT;');
  assert.equal((await db.query('SELECT count(*)::int n FROM public.player_inventory')).rows[0].n,2,'server signup retains INSERT rights');
  console.log('PASS: legacy inventory client writes forbidden; service signup allowed; no history loss');
} finally { await db.close(); }
