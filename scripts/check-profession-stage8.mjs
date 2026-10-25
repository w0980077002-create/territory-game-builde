import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  STAGE8_VERSION, MAX_MASTERY_LEVEL, DAILY_SERVER_XP_CAP, GATHER_HOURS_PER_UNIT,
  MASTERY_BANDS, PROFESSION_TRACKS, STAGE8_RECIPES, STAGE8_PRACTICE_RECIPES,
  STAGE8_EQUIPMENT, STAGE8_CONSUMABLES, masteryXpToNext, totalXpForLevel,
  practiceFor, simulateProgression,
} from './professions/stage8-model.mjs';

const VALID_RESOURCES = new Set(['gather-ore','gather-wood','gather-hide','gather-herb','gather-crystal']);
const SHOP_BUDGETS = {
  weapon:{attack:35,defense:0,hp:0,critChance:8},
  armor:{attack:0,defense:12,hp:80,critChance:0},
  shield:{attack:0,defense:5,hp:25,critChance:0},
  helmet:{attack:0,defense:3,hp:20,critChance:0},
  boots:{attack:0,defense:4,hp:40,critChance:2},
  ring:{attack:15,defense:0,hp:0,critChance:5},
  amulet:{attack:6,defense:0,hp:0,critChance:3},
};

assert.match(STAGE8_VERSION,/^profession-stage8-draft-/);
assert.equal(MAX_MASTERY_LEVEL,300);
assert.equal(DAILY_SERVER_XP_CAP,300);
assert.equal(GATHER_HOURS_PER_UNIT,4);
assert.equal(PROFESSION_TRACKS.length,5);
assert.equal(MASTERY_BANDS.length,7);
assert.equal(STAGE8_PRACTICE_RECIPES.length,35);
assert.equal(STAGE8_EQUIPMENT.length,16);
assert.equal(STAGE8_CONSUMABLES.length,4);
assert.equal(STAGE8_RECIPES.length,55);
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
    const budget=SHOP_BUDGETS[eq.slot];
    assert.ok(budget,recipe.id);
    for(const [stat,limit] of Object.entries(budget)){
      assert.ok((eq[stat]??0)<=limit,`${recipe.id} ${stat} exceeds shop baseline`);
      assert.ok((eq[stat]??0)>=0,recipe.id);
    }
    assert.equal(eq.rarity,recipe.output.rarity);
  }else{
    assert.ok(['potion','elixir'].includes(recipe.output.type),recipe.id);
    assert.ok(recipe.output.effect.value>0&&recipe.output.effect.value<=150,recipe.id);
  }
  if(recipe.requiredLevel===300) assert.equal(recipe.kind,'item','Master license must guard prestige item recipes only');
}

// Staging MUST NOT change the actual gathering or perishable item rules.
const professions = await readFile(new URL('../src/game/professions.ts',import.meta.url),'utf8');
const expiry = await readFile(new URL('../src/game/elixirExpiry.ts',import.meta.url),'utf8');
const screen = await readFile(new URL('../src/components/ProfessionsScreen.tsx',import.meta.url),'utf8');
const exported = JSON.parse(await readFile(new URL('../supabase/staged/territory_profession_stage8_catalog.json',import.meta.url),'utf8'));
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
