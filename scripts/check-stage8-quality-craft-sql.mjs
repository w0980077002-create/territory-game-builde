/**
 * TERRITORY Stage8 quality integration: read-only, ephemeral PGlite.
 * Live Supabase is never contacted or changed.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {previewMasterworkAtMastery} from './professions/mastery-quality-v2.mjs';

const catalog=JSON.parse(await readFile(new URL('../supabase/staged/territory_profession_stage8_catalog.json',import.meta.url),'utf8'));
const sql=await readFile(new URL('../supabase/staged/territory_mastery_quality_v2_inactive.sql',import.meta.url),'utf8');
const recipes=catalog.recipes.filter(r=>r.id.startsWith('mw_')&&r.output?.equipment);
assert.equal(recipes.length,25);
const db=new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA territory_private;
    CREATE TABLE public.territory_profession_stage8_catalog(
      id text PRIMARY KEY,required_level int NOT NULL,kind text NOT NULL,
      item_output jsonb
    );`);
  for(const recipe of recipes){
    await db.query('INSERT INTO public.territory_profession_stage8_catalog(id,required_level,kind,item_output) VALUES($1,$2,$3,$4::jsonb)',
      [recipe.id,recipe.requiredLevel,recipe.kind,JSON.stringify(recipe.output)]);
  }
  await db.exec(sql);
  let ready=0,locked=0,blocked=0;
  const milestones=[1,25,50,100,150,200,250,300];
  for(const recipe of recipes){
    for(const mastery of milestones){
      for(const licensed of mastery===300?[false,true]:[false]){
        const data=(await db.query(
          'SELECT territory_private.territory_stage8_quality_item_v2($1,$2,$3,61) AS value',
          [recipe.id,mastery,licensed])).rows[0].value;
        const expected=previewMasterworkAtMastery(recipe,mastery,{masterLicense:licensed,heroLevel:61});
        assert.equal(data.status,expected.status,`${recipe.id} mastery ${mastery} license ${licensed}`);
        assert.equal(data.quality_pct,expected.targetPct);
        if(data.status==='ready'){
          ready++;
          assert.equal(data.item_level,expected.itemLevel);
          assert.equal(data.baseline_shop_id,String(expected.baselineShopId));
          assert.equal(data.item_output.equipment.name,recipe.output.equipment.name);
          assert.equal(data.item_output.equipment.qualityVersion,'mastery-v2');
          assert.equal(data.item_output.equipment.masteryQualityPct,expected.targetPct);
          assert.deepEqual(Object.fromEntries(['attack','defense','hp','critChance']
            .filter(x=>typeof expected.equipment[x]==='number')
            .map(x=>[x,data.item_output.equipment[x]])),
            Object.fromEntries(['attack','defense','hp','critChance']
            .filter(x=>typeof expected.equipment[x]==='number')
            .map(x=>[x,expected.equipment[x]])),
            `SQL/JS actual stats differ for ${recipe.id} ${mastery}`);
        }else if(data.status==='locked'){locked++;}
        else if(data.status==='blocked'){blocked++;}
      }
    }
  }
  assert.ok(ready>100 && blocked>0);
  const denied=await db.query(`SELECT has_function_privilege('anon','territory_private.territory_stage8_quality_item_v2(text,integer,boolean,integer)','EXECUTE') AS allowed`);
  assert.equal(denied.rows[0].allowed,false);
  const issued=await db.query('SELECT COUNT(*)::int n FROM public.territory_profession_stage8_catalog');
  assert.equal(issued.rows[0].n,25);
  console.log('Stage8 mastery quality SQL parity PASS',JSON.stringify({ready,locked,blocked}),
    '— no player, receipt or wallet changes');
}finally{await db.close();}
