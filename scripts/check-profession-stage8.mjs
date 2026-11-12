import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  STAGE8_VERSION, MAX_MASTERY_LEVEL, DAILY_SERVER_XP_CAP, GATHER_HOURS_PER_UNIT,
  MASTERY_BANDS, PROFESSION_TRACKS, STAGE8_RECIPES, STAGE8_PRACTICE_RECIPES,
  STAGE8_EQUIPMENT, STAGE8_CONSUMABLES, STAGE8_LEGACY_RECIPES, CRAFT_RARITY_POWER, craftQualityPct,
  STAGE8_SHOP_BASELINES, STAGE8_FORGE_GROWTH, benchmarkShopEquipment,
  MASTERWORK_MIN_PCT, MASTERWORK_MAX_PCT, masterworkBonusPct, masteryXpToNext, totalXpForLevel,
  practiceFor, simulateProgression,
} from './professions/stage8-model.mjs';

const VALID_RESOURCES = new Set(['gather-ore','gather-wood','gather-hide','gather-herb','gather-crystal']);
// The live server enforces slot/level safety caps; unlike the original draft,
// valuable crafted gear is intentionally allowed to beat the ordinary shop.
const SERVER_STAT_CAPS = (eq) => ({
  // Stage8's previous HP cap (86 for lvl3 armor) silently destroyed the
  // approved +25% rare armor baseline (80 -> 100). Guardrails here are
  // draft-only, *not* assertions about deployed production server caps.
  attack: eq.slot === 'weapon' ? 48 + 10 * eq.level : ['ring','amulet'].includes(eq.slot) ? 24 + 5 * eq.level : 10 + 2 * eq.level,
  defense: ['armor','shield','helmet','boots'].includes(eq.slot) ? 15 + 6 * eq.level : 10 + 3 * eq.level,
  hp: eq.slot === 'armor' ? 90 + 20 * eq.level : ['boots','shield','helmet'].includes(eq.slot) ? 60 + 10 * eq.level : 25 + 5 * eq.level,
  critChance:25,
});

assert.match(STAGE8_VERSION,/^profession-stage8-draft-/);
assert.equal(MAX_MASTERY_LEVEL,300);
assert.equal(DAILY_SERVER_XP_CAP,300);
assert.equal(GATHER_HOURS_PER_UNIT,4);
assert.equal(PROFESSION_TRACKS.length,5);
assert.equal(MASTERY_BANDS.length,7);
assert.equal(STAGE8_PRACTICE_RECIPES.length,35);
assert.equal(STAGE8_EQUIPMENT.length,16);
assert.equal(STAGE8_CONSUMABLES.length,4);
assert.equal(STAGE8_LEGACY_RECIPES.length,17);
assert.equal(STAGE8_RECIPES.length,72);
assert.equal(new Set(STAGE8_RECIPES.map((r)=>r.id)).size,STAGE8_RECIPES.length);

for(let level=1;level<300;level++){
  assert.ok(Number.isSafeInteger(masteryXpToNext(level)) && masteryXpToNext(level)>0);
  for(const track of PROFESSION_TRACKS){
    const recipe=practiceFor(track.id,level);
    assert.ok(recipe && recipe.requiredLevel<=level);
    assert.ok(recipe.masteryXp<=DAILY_SERVER_XP_CAP);
  }
}
assert.equal(masteryXpToNext(300),0);
assert.equal(totalXpForLevel(50),2299);
assert.equal(totalXpForLevel(300),73199);

for(const recipe of STAGE8_RECIPES){
  assert.ok(PROFESSION_TRACKS.some((p)=>p.id===recipe.profession),recipe.id);
  assert.ok(recipe.requiredLevel>=1 && recipe.requiredLevel<=300,recipe.id);
  assert.ok(recipe.masteryXp>=1 && recipe.masteryXp<=DAILY_SERVER_XP_CAP,recipe.id);
  assert.ok(recipe.ingredients.length>0,recipe.id);
  for(const ingredient of recipe.ingredients){
    assert.ok(VALID_RESOURCES.has(ingredient.id),recipe.id);
    assert.ok(Number.isSafeInteger(ingredient.qty)&&ingredient.qty>=1,recipe.id);
  }
  if(recipe.kind==='practice'){
    assert.equal(recipe.output,null,'Training must not mint inventory goods');
  }else if(recipe.output.type==='equipment'){
    const eq=recipe.output.equipment;
    const limits=SERVER_STAT_CAPS(eq);
    for(const [stat,limit] of Object.entries(limits)){
      assert.ok((eq[stat]??0)<=limit,`${recipe.id} ${stat} exceeds server gear cap`);
      assert.ok((eq[stat]??0)>=0,recipe.id);
    }
    assert.equal(eq.rarity,recipe.output.rarity);
    assert.ok(eq.level>=1 && eq.level<=5,recipe.id);
    assert.ok(recipe.requiredLevel>=1&&recipe.requiredLevel<=300,recipe.id);
  }else if(recipe.output.type==='potion'||recipe.output.type==='elixir'){
    assert.ok(recipe.output.effect.value>0&&recipe.output.effect.value<=150,recipe.id);
  }else if(recipe.output.type==='material'){
    assert.ok(recipe.output.name&&recipe.output.description,recipe.id);
    assert.equal(recipe.output.effect,undefined,recipe.id);
    assert.equal(recipe.output.equipment,undefined,recipe.id);
  }else{
    assert.fail(`Unexpected crafted output type in ${recipe.id}: ${recipe.output.type}`);
  }
  if(recipe.requiredLevel===300) assert.equal(recipe.kind,'item','Master license must guard prestige item recipes only');
}

// Staging MUST NOT change the actual gathering or perishable item rules.
const professions = await readFile(new URL('../src/game/professions.ts',import.meta.url),'utf8');
const expiry = await readFile(new URL('../src/game/elixirExpiry.ts',import.meta.url),'utf8');
const screen = await readFile(new URL('../src/components/ProfessionsScreen.tsx',import.meta.url),'utf8');
const exported = JSON.parse(await readFile(new URL('../supabase/staged/territory_profession_stage8_catalog.json',import.meta.url),'utf8'));
const originalRecipes = JSON.parse(await readFile(new URL('../supabase/staged/territory_craft_catalog.json',import.meta.url),'utf8'));
for(let i=0;i<originalRecipes.length;i++){
  const original=originalRecipes[i];
  const enhanced=STAGE8_LEGACY_RECIPES[i];
  assert.equal(enhanced.id,original.id,'Never drop or reorder legacy recipes');
  assert.deepEqual(enhanced.ingredients,original.ingredients,'Never change ingredient cost during stat balancing');
  assert.equal(enhanced.requiredLevel,original.requiredLevel,'Never change existing mastery gate');
  assert.equal(enhanced.masteryXp,original.requiredLevel===300?1:original.masteryXp);
  // LIVE Stage8 has historical receipts for these IDs: changing output.name
  // makes old server-owned inventory fail the client's strict name check.
  assert.equal(enhanced.output.name,original.output.name,'Keep historical item name and receipts readable');
  assert.equal(enhanced.output.rarity,original.output.rarity,'Keep rarity');
  if(original.output.equipment){
    assert.equal(enhanced.output.equipment.level,original.output.equipment.level,'Crafted item starts at the same level');
    assert.equal(enhanced.output.equipment.slot,original.output.equipment.slot,'Keep equipment slot');
    for(const stat of ['attack','defense','hp','critChance'])
      assert.ok((enhanced.output.equipment[stat]??0)>=(original.output.equipment[stat]??0),'Never nerf an existing recipe: '+original.id);
  }else assert.deepEqual(enhanced.output,original.output,'Non-gear recipes cannot change');
}
assert.deepEqual(CRAFT_RARITY_POWER,{common:1,rare:1.15,epic:1.35,legendary:1.6});
assert.deepEqual([1,25,50,100,200,300].map(craftQualityPct),[0,3,3,5,7,10]);
const crafted=(id)=>STAGE8_RECIPES.find(r=>r.id===id)?.output?.equipment;
assert.equal(MASTERWORK_MIN_PCT,20);
assert.equal(MASTERWORK_MAX_PCT,30);
assert.deepEqual([1,25,50,100,200,300].map(masterworkBonusPct),[20,23,23,25,27,30]);
assert.equal(STAGE8_EQUIPMENT.length+STAGE8_LEGACY_RECIPES.filter(r=>r.output?.equipment).length,25);

// Prevent hidden shop drift: Stage8's reference stat rows must match the
// actual live TS catalogue and both historic paid epic templates exactly.
const shopSource=await readFile(new URL('../src/game/equipmentCatalog.ts',import.meta.url),'utf8');
const balanceSource=await readFile(new URL('../src/game/equipmentBalance.ts',import.meta.url),'utf8');
const shopBlock=shopSource.slice(shopSource.indexOf('export const EQUIPMENT_TEMPLATES: Equipment[] = ['));
const shopRows=[...shopBlock.slice(0,shopBlock.indexOf('];')).matchAll(/\{ id:\s*'shop_[^\n]+\}/g)]
  .map(([row])=>Function('return ('+row+')')());
assert.equal(shopRows.length,10,'Every real shop template needs a Stage8 benchmark');
for(const item of shopRows){
  const baseline=STAGE8_SHOP_BASELINES.find(ref=>ref.id===item.id);
  assert.ok(baseline,'Missing shop template '+item.id);
  for(const key of ['slot','rarity','level','attack','defense','hp','critChance'])
    assert.equal(baseline[key],item[key],item.id+'/'+key);
}
const historicBlock=balanceSource.slice(balanceSource.indexOf('const HISTORIC_SHOP_EPICS: Equipment[] = ['));
const historicRows=[...historicBlock.slice(0,historicBlock.indexOf('];')).matchAll(/\{\s*id:\s*'historic_shop_[\s\S]*?\}/g)]
  .map(([row])=>Function('return ('+row+')')());
assert.equal(historicRows.length,2);
for(const item of historicRows){
  const baseline=STAGE8_SHOP_BASELINES.find(ref=>ref.id===item.id);
  assert.ok(baseline?.historic,'Historic paid epic item cannot be silently forgotten');
  for(const key of ['slot','rarity','level','attack','defense','hp','critChance'])
    assert.equal(baseline[key],item[key],item.id+'/'+key);
}
const growthBlock=balanceSource.slice(balanceSource.indexOf('export const FORGE_STAT_GROWTH:'));
const growthStart=growthBlock.indexOf('= {');
const canonicalGrowth=Function('return ('+growthBlock.slice(growthStart+2,growthBlock.indexOf('\n};')+2)+')')();
for(const [slot,rarities] of Object.entries(canonicalGrowth))
  for(const [rarity,stats] of Object.entries(rarities))
    for(const key of ['attack','defense','hp'])
      assert.equal(STAGE8_FORGE_GROWTH[slot][rarity][key]??0,stats[key],slot+'/'+rarity+'/'+key);

// Every item from all four gear professions must beat the correct current
// shop item. Same-rarity comparisons stay in 20-30%, apart from the
// unavoidable +1 rounding step for tiny integer stats (3 def -> 4 def).
// If no matching rarity is sold, first scale the strongest lower rarity;
// historic epic purchases count as their own benchmark, never a new sale.
const craftedGear=STAGE8_RECIPES.filter(r=>r.output?.equipment);
const slots=new Set(craftedGear.map(r=>r.output.equipment.slot));
assert.deepEqual([...slots].sort(),['amulet','armor','boots','helmet','ring','shield','weapon']);
for(const recipe of craftedGear){
  const eq=recipe.output.equipment,shop=benchmarkShopEquipment(eq.slot,eq.rarity,eq.level);
  const rarityScale=CRAFT_RARITY_POWER[eq.rarity]/CRAFT_RARITY_POWER[shop.rarity];
  const bonus=masterworkBonusPct(recipe.requiredLevel);
  assert.ok(bonus>=20&&bonus<=30,recipe.id+' mastery bonus');
  assert.ok(!shop.historic||['epic','legendary'].includes(eq.rarity),recipe.id+' historical benchmark');
  for(const key of ['attack','defense','hp','critChance']){
    if(typeof shop[key]!=='number'||typeof eq[key]!=='number')continue;
    const lower=Math.ceil(shop[key]*rarityScale*1.20);
    const upper=Math.ceil(shop[key]*rarityScale*1.30);
    assert.ok(eq[key]>=lower,recipe.id+' '+key+' weaker than +20% shop equivalent: '+eq[key]+' < '+lower);
    assert.ok(eq[key]<=upper,recipe.id+' '+key+' over +30% shop equivalent beyond integer rounding: '+eq[key]+' > '+upper);
    // Across 0/+5/+20 forge upgrades, the ABSOLUTE stat advantage survives
    // even though the additive vanilla forge curve dilutes the % gap.
    // Maintaining a strict 20% AFTER 20 upgrades needs a dedicated
    // server-authoritative masterwork forge curve before live release.
    for(const upgrade of [0,5,20]){
      const projected=(value,growth)=>key==='critChance'?value:value+Math.round(growth*upgrade);
      const owned=projected(eq[key],STAGE8_FORGE_GROWTH[eq.slot][eq.rarity][key]??0);
      const bought=projected(shop[key],STAGE8_FORGE_GROWTH[shop.slot][shop.rarity][key]??0);
      assert.ok(owned>bought,recipe.id+' '+key+' forge+'+upgrade+' must stay better than shop');
    }
  }
  if(recipe.output.rarity==='common'||recipe.output.rarity==='rare')
    assert.ok(recipe.output.description.includes('Мастерское изделие'),recipe.id+' must explain the premium');
}
// Exact protection for the most visible old failure cases.
assert.equal(crafted('smith_apprentice_blade').attack,10);
assert.equal(crafted('smith_leather_armor').defense,6);
assert.equal(crafted('smith_leather_armor').hp,36);
assert.equal(crafted('smith_knight_blade').attack,22);
assert.equal(STAGE8_RECIPES.find(r=>r.id==='smith_knight_blade').output.name,'Клинок рыцаря');
assert.equal(STAGE8_RECIPES.find(r=>r.id==='smith_leather_armor').output.name,'Кожаная броня');
assert.equal(crafted('s8_smith_north_armor').hp,100);
assert.equal(crafted('s8_engineer_jarl_plate').hp,145);
assert.equal(crafted('s8_artisan_jarl_boots').hp,72);
assert.equal(crafted('engineer_oak_shield').hp,30);
assert.equal(crafted('s8_engineer_path_boots').hp,50);
assert.equal(crafted('jeweler_raven_amulet').attack,8);
assert.equal(crafted('s8_jeweler_guard_amulet').attack,8);
assert.equal(crafted('s8_jeweler_spark_ring').attack,11);
assert.equal(crafted('jeweler_power_ring').attack,18);
assert.equal(crafted('s8_jeweler_sapphire_ring').attack,19);
assert.equal(crafted('jeweler_ancient_ring').attack,23);
assert.equal(crafted('s8_jeweler_jarl_seal').attack,23);
assert.equal(crafted('s8_jeweler_spark_ring').attack+1,12,'Rare crafted lvl3 ring stays +20% ahead at lvl5');
for(const r of craftedGear){
  const eq=r.output.equipment;
  for(const [stat,label] of [['attack','атака'],['defense','защита'],['hp','HP'],['critChance','крит %']])
    if(typeof eq[stat]==='number') assert.ok(r.output.description.includes(label+' '+eq[stat]),r.id+' description '+stat);
}

assert.equal(STAGE8_LEGACY_RECIPES.filter((r)=>r.requiredLevel===300).length,5);
assert.ok(STAGE8_LEGACY_RECIPES.every((r)=>r.masteryXp<=DAILY_SERVER_XP_CAP));
assert.equal(exported.version,STAGE8_VERSION);
assert.equal(exported.enabled,false);
assert.equal(exported.requiresServerAuthority,true);
assert.equal(exported.supportsClientLocalCraftFallback,false);
assert.equal(exported.gatheredResourcesExpire,false);
assert.equal(exported.dailyXpCapKyiv,DAILY_SERVER_XP_CAP);
assert.deepEqual(exported.recipes,STAGE8_RECIPES,'Staging JSON must stay identical to the source model');
assert.match(professions,/export function masteryXpToNext\(level: number\)/);
assert.match(expiry,/item\.type === 'elixir'/);
assert.doesNotMatch(expiry,/gather-ore|gather-crystal|gather-hide/);
assert.match(screen,/craftStatus\?\.enabled/);
assert.ok(!screen.includes('stage8-model'),'Draft must not be wired into production');

const targets = {2:483,3:322,4:310,6:297};
for(const perDay of [2,3,4,6]){
  for(const profession of PROFESSION_TRACKS){
    const result=simulateProgression({profession:profession.id,gathersPerDay:perDay});
    // A change of training material can strand 1 unit at a tier boundary.
    assert.ok(result.days>=targets[perDay]&&result.days<=targets[perDay]+1,`${profession.id} at ${perDay} gathers/day`);
    assert.equal(result.milestones[300],result.days);
  }
}
console.log(`Stage8 PASS: ${STAGE8_RECIPES.length} draft recipes, 5 professions, 73,199 XP to level 300; 2/3/4/6 gathers per day = 483/322/310/297 days. Live game unchanged.`);
