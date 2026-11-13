import assert from 'node:assert/strict';
import {
  MASTERY_QUALITY_TIERS,masteryQualityTier,
  equipmentServerCaps,previewMasterworkAtMastery,masteryQualityAudit,
} from './professions/mastery-quality-v2.mjs';
import {
  STAGE8_MASTERWORK_EQUIPMENT,STAGE8_RECIPES,benchmarkShopEquipment,
  CRAFT_RARITY_POWER,
} from './professions/stage8-model.mjs';

const expected=[[1,20],[25,35],[50,50],[100,70],[150,90],[200,110],[250,130],[300,160]];
assert.deepEqual(MASTERY_QUALITY_TIERS.map(x=>[x.level,x.pct]),expected);
for(const [level,pct] of expected){
  assert.equal(masteryQualityTier(level,true).pct,pct);
}
assert.equal(masteryQualityTier(299,true).pct,130);
assert.equal(masteryQualityTier(300,false).pct,130,'The $50 license must be authoritative at tier 300');
assert.throws(()=>masteryQualityTier(301,true),/invalid_mastery/);
assert.throws(()=>masteryQualityTier(-1,false),/invalid_mastery/);
assert.deepEqual(equipmentServerCaps('armor',5),{attack:20,defense:35,hp:110,critChance:25});
assert.deepEqual(equipmentServerCaps('ring',5),{attack:40,defense:25,hp:50,critChance:25});
assert.equal(STAGE8_RECIPES.length,97,'Existing server recipe IDs must remain untouched');
assert.equal(STAGE8_MASTERWORK_EQUIPMENT.length,25);
const original=JSON.stringify(STAGE8_MASTERWORK_EQUIPMENT);
const ring=STAGE8_MASTERWORK_EQUIPMENT.find(x=>x.id==='mw_s8_jeweler_spark_ring');
assert.ok(ring);
assert.equal(previewMasterworkAtMastery(ring,1).status,'locked');
assert.equal(previewMasterworkAtMastery(ring,25).targetPct,35);
assert.equal(previewMasterworkAtMastery(ring,300,{masterLicense:false}).targetPct,130);
assert.equal(previewMasterworkAtMastery(ring,300,{masterLicense:true}).targetPct,160);
const prestige=STAGE8_MASTERWORK_EQUIPMENT.find(x=>x.requiredLevel===300);
assert.equal(previewMasterworkAtMastery(prestige,300,{masterLicense:false}).reason,'master_license_required');
assert.equal(previewMasterworkAtMastery(prestige,300,{masterLicense:true}).targetPct,160);
assert.equal(previewMasterworkAtMastery({id:'old_shop_gear'},300).status,'not_masterwork');
const all=masteryQualityAudit();
assert.equal(all.length,25*8,'Every masterwork and milestone must be reviewed');
const statuses={ready:0,blocked:0,locked:0};
for(const row of all){
  assert.ok(row.status in statuses,'A preview must fail closed');
  statuses[row.status]++;
  const recipe=STAGE8_MASTERWORK_EQUIPMENT.find(r=>r.id===row.recipeId);
  assert.ok(recipe);
  if(row.status!=='ready')continue;
  const shop=benchmarkShopEquipment(recipe.output.equipment.slot,
    recipe.output.equipment.rarity,row.itemLevel);
  const ratio=CRAFT_RARITY_POWER[recipe.output.equipment.rarity]/CRAFT_RARITY_POWER[shop.rarity];
  const caps=equipmentServerCaps(recipe.output.equipment.slot,row.itemLevel);
  for(const stat of ['attack','defense','hp','critChance']){
    if(typeof recipe.output.equipment[stat]!=='number')continue;
    assert.ok(row.equipment[stat]<=caps[stat],row.recipeId+' '+stat+' SQL cap');
    assert.ok(row.equipment[stat]>=recipe.output.equipment[stat],row.recipeId+' '+stat+' cannot nerf existing r4 stats');
    assert.ok(row.equipment[stat]>=Math.ceil((shop[stat]??0)*ratio*(1+row.targetPct/100)),
      row.recipeId+' '+stat+' does not meet displayed percentage');
  }
}
assert.ok(statuses.blocked>0,'High-tier cap conflicts require server-side design, not a fake release');
assert.ok(statuses.ready>0,'At least one validated preview must be achievable');
assert.equal(JSON.stringify(STAGE8_MASTERWORK_EQUIPMENT),original,'Never rewrite the live catalogue in preview');
console.log('Mastery quality v2 STAGED audit PASS',JSON.stringify(statuses),
  '— 25 original masterworks, 8 milestone tiers, no player/receipt/catalog writes');
