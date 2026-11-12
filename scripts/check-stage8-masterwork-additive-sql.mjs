/**
 * Offline-only additive masterwork migration rehearsal. Ephemeral PGlite,
 * no Supabase credentials, no production network connection.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const r2=JSON.parse(await readFile(new URL('../supabase/staged/territory_profession_stage8_r2_catalog.json',import.meta.url),'utf8'));
const r4=JSON.parse(await readFile(new URL('../supabase/staged/territory_profession_stage8_catalog.json',import.meta.url),'utf8'));
const sql=await readFile(new URL('../supabase/staged/territory_stage8_masterwork_additive_r4.sql',import.meta.url),'utf8');
assert.equal(r2.recipes.length,72);
assert.equal(r4.recipes.length,97);
assert.deepEqual(r4.recipes.slice(0,72),r2.recipes,'Never mutate historical r2 catalog');
const masterworks=r4.recipes.slice(72);
assert.equal(masterworks.length,25);
assert.ok(masterworks.every(r=>r.id.startsWith('mw_')));
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111';
const sampleItem='22222222-2222-4222-8222-222222222222';
const setup=`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  'SELECT nullif(current_setting(''test.uid'',true),'''')::uuid';
CREATE TABLE public.territory_profession_stage8_release(
 id integer PRIMARY KEY, enabled boolean NOT NULL, version text NOT NULL
 CHECK (version='profession-stage8-draft-20261025-r2'));
CREATE TABLE public.territory_profession_stage8_catalog(
 id text PRIMARY KEY, profession text NOT NULL, required_level integer NOT NULL,
 kind text NOT NULL, mastery_xp integer NOT NULL, ingredients jsonb NOT NULL,
 item_output jsonb);
CREATE TABLE public.territory_profession_stage8_items(
 item_id uuid PRIMARY KEY,player_id uuid NOT NULL,recipe_id text NOT NULL,
 item_output jsonb NOT NULL,expires_at timestamptz);
CREATE TABLE public.territory_profession_stage8_receipts(
 receipt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 player_id uuid,recipe_id text,result jsonb);
INSERT INTO public.territory_profession_stage8_release
 VALUES(1,true,'profession-stage8-draft-20261025-r2');
`;
const data=async(sql,params=[]) => (await db.query(sql,params)).rows;
try {
 await db.exec(setup);
 for(const r of r2.recipes) {
   await db.query(`INSERT INTO public.territory_profession_stage8_catalog
    (id,profession,required_level,kind,mastery_xp,ingredients,item_output)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,[
      r.id,r.profession,r.requiredLevel,r.kind,r.masteryXp,
      JSON.stringify(r.ingredients),JSON.stringify(r.output)]);
 }
 const original=r2.recipes.find(r=>r.id==='smith_knight_blade');
 await db.query('INSERT INTO public.territory_profession_stage8_items VALUES($1,$2,$3,$4::jsonb,NULL)',
  [sampleItem,owner,original.id,JSON.stringify(original.output)]);
 await db.query('INSERT INTO public.territory_profession_stage8_receipts(player_id,recipe_id,result) VALUES($1,$2,$3::jsonb)',
  [owner,original.id,JSON.stringify({item_id:sampleItem,item_output:original.output})]);
 const beforeItems=await data('SELECT * FROM public.territory_profession_stage8_items');
 const beforeReceipts=await data('SELECT * FROM public.territory_profession_stage8_receipts');
 const beforeVersion=await data('SELECT * FROM public.territory_profession_stage8_release');
 await db.exec(sql);
 const after=await data('SELECT id,profession,required_level,kind,mastery_xp,ingredients,item_output FROM public.territory_profession_stage8_catalog ORDER BY id');
 assert.equal(after.length,97);
 const byId=new Map(after.map(r=>[r.id,r]));
 for(const rec of r4.recipes){
   const row=byId.get(rec.id);
   assert.ok(row,rec.id);
   assert.deepEqual({id:row.id,profession:row.profession,requiredLevel:row.required_level,
     kind:row.kind,masteryXp:row.mastery_xp,ingredients:row.ingredients,
     output:row.item_output},rec,rec.id+' unchanged or added exactly');
 }
 assert.deepEqual(await data('SELECT * FROM public.territory_profession_stage8_items'),beforeItems);
 assert.deepEqual(await data('SELECT * FROM public.territory_profession_stage8_receipts'),beforeReceipts);
 assert.deepEqual(await data('SELECT * FROM public.territory_profession_stage8_release'),beforeVersion);
 await db.exec("SELECT set_config('test.uid','"+owner+"',false)");
 assert.equal((await data('SELECT public.territory_profession_masterworks_ready() AS ready'))[0].ready,true);
 await db.exec("RESET ROLE; SET ROLE anon;");
 await assert.rejects(()=>data('SELECT public.territory_profession_masterworks_ready()'),/permission denied/i);
 await db.exec('RESET ROLE;');
 await assert.rejects(()=>db.exec(sql),/expected_exactly_72|masterworks_already_present/i,
   'Reapplying migration cannot silently overwrite 25 new server-issued items');
 assert.equal((await data('SELECT count(*)::int AS count FROM public.territory_profession_stage8_catalog'))[0].count,97);
 console.log('Stage8 masterwork ADDITIVE SQL PASS: 72 original catalog recipes untouched, 25 new rows, 1 owned item and receipt unchanged; readiness auth gate secure; second apply denied.');
}finally{await db.close();}
