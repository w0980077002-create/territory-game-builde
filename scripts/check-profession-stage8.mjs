import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  STAGE8_VERSION, MAX_MASTERY_LEVEL, DAILY_SERVER_XP_CAP, GATHER_HOURS_PER_UNIT,
  MASTERY_BANDS, PROFESSION_TRACKS, STAGE8_RECIPES, STAGE8_PRACTICE_RECIPES,
  STAGE8_EQUIPMENT, STAGE8_CONSUMABLES, STAGE8_LEGACY_RECIPES, CRAFT_RARITY_POWER, craftQualityPct, masteryXpToNext, totalXpForLevel,
  practiceFor, simulateProgression,
} from './professions/stage8-model.mjs';

const VALID_RESOURCES = new Set(['gather-ore','gather-wood','gather-hide','gather-herb','gather-crystal']);
// The live server enforces slot/level safety caps; unlike the original draft,
// valuable crafted gear is intentionally allowed to beat the ordinary shop.
const SERVER_STAT_CAPS = (eq) => ({
  attack: eq.slot === 'weapon' ? 40 + 6 * eq.level : ['ring','amulet'].includes(eq.slot) ? 20 + 4 * eq.level : 10 + 2 * eq.level,
  defense: ['armor','shield','helmet','boots'].includes(eq.slot) ? 10 + 5 * eq.level : 10 + 3 * eq.level,
  hp: eq.slot === 'armor' ? 50 + 12 * eq.level : ['boots','shield','helmet'].includes(eq.slot) ? 40 + 10 * eq.level : 25 + 5 * eq.level,
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
  assert.equal(enhanced.output.name,original.output.name,'Keep historical item identity');
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
assert.equal(crafted('s8_smith_watch_blade').attack,19,'Level-25 crafts must beat shop rare weapons');
assert.equal(crafted('s8_smith_storm_axe').attack,38,'Level-200 epic crafts must beat shop epic weapons');
assert.equal(crafted('s8_smith_jarl_blade').attack,46,'Level-300 legendary weapon must beat shop epic baseline');
assert.equal(crafted('smith_ancient_blade').attack,46,'Legacy grandmaster recipes must share the same power budget');
assert.equal(crafted('jeweler_ancient_ring').attack,25);
// Compare all seven new jeweler masterwork outputs against the actual shop.
const jewelTargets = {"jeweler_raven_amulet":[8,4],"s8_jeweler_guard_amulet":[9,4],"s8_jeweler_spark_ring":[12,4],"jeweler_power_ring":[19,6],"s8_jeweler_sapphire_ring":[21,6],"jeweler_ancient_ring":[25,7],"s8_jeweler_jarl_seal":[25,7]};
for (const [id,[attack,critChance]] of Object.entries(jewelTargets)) {
  assert.equal(crafted(id).attack,attack,id+' attack');
  assert.equal(crafted(id).critChance,critChance,id+' critChance');
  const recipe=STAGE8_RECIPES.find((r)=>r.id===id);
  assert.match(recipe.output.description,new RegExp(String(attack)+'[\\s\\S]*'+String(critChance)+'%'),id+' description');
}
// At item lvl 5, the lvl-3 rare crafted ring gains +1 atk through the rare ring forge curve.
assert.equal(crafted('s8_jeweler_spark_ring').attack+1,13,'Master ring lvl5 exceeds shop rare lvl5 atk 10');

assert.equal(crafted('s8_engineer_jarl_plate').hp,86,'Legendary armor must respect the server HP cap at level 3');
assert.equal(crafted('s8_artisan_jarl_boots').hp,60,'Legendary boots must respect the server HP cap at level 2');
assert.equal(crafted('smith_knight_blade').attack,18,'Shop-name collisions stay at canonical server stats');
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
