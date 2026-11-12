/**
 * TERRITORY 1.0 profession rebalance proposal. Staging ONLY: not imported by
 * the live game, no migrations, no client-side XP authority.
 *
 * Single source for the progression simulation and versioned draft catalogue.
 * Publishing requires a separately tested server-authoritative cutover.
 */
import { readFileSync } from 'node:fs';

// The 17 existing V1 recipes are the authoritative historical catalog. Never
// retype or silently drop them when offering a new Stage8 progression: their
// names, ingredients, item outputs and equipment stats stay byte-for-byte
// equivalent to the old server catalog. Only the XP of level-300 recipes must
// be capped because the new daily ceiling is 300 XP.
const legacyCatalogue = JSON.parse(readFileSync(new URL('../../supabase/staged/territory_craft_catalog.json',import.meta.url),'utf8'));

export const STAGE8_VERSION = 'profession-stage8-draft-20261112-r3';
export const MAX_MASTERY_LEVEL = 300;
export const DAILY_SERVER_XP_CAP = 300;
export const GATHER_HOURS_PER_UNIT = 4;

// xpToNext applies to every level in [from, to]. Level 300 has no next level.
export const MASTERY_BANDS = Object.freeze([
  { from: 1, to: 24, xpToNext: 26, trainingXp: 30, trainingCost: 1, name: 'Ученик' },
  { from: 25, to: 49, xpToNext: 67, trainingXp: 80, trainingCost: 2, name: 'Подмастерье' },
  { from: 50, to: 99, xpToNext: 90, trainingXp: 100, trainingCost: 2, name: 'Ремесленник' },
  { from: 100, to: 149, xpToNext: 162, trainingXp: 180, trainingCost: 3, name: 'Опытный мастер' },
  { from: 150, to: 199, xpToNext: 270, trainingXp: 225, trainingCost: 3, name: 'Знаток' },
  { from: 200, to: 249, xpToNext: 383, trainingXp: 255, trainingCost: 3, name: 'Старший мастер' },
  { from: 250, to: 299, xpToNext: 513, trainingXp: 285, trainingCost: 3, name: 'Великий мастер' },
]);

// Each training action consumes exactly the listed verified gathered resources.
// It does not create a pile of fake inventory items; its reward is mastery XP.
// Keeping training separate from item crafting allows gear to remain expensive.
export const PROFESSION_TRACKS = Object.freeze([
  { id: 'smith', name: 'Кузнец', practices: ['gather-ore', 'gather-ore', 'gather-wood', 'gather-ore', 'gather-hide', 'gather-ore', 'gather-crystal'] },
  { id: 'alchemist', name: 'Алхимик', practices: ['gather-herb', 'gather-herb', 'gather-wood', 'gather-herb', 'gather-crystal', 'gather-herb', 'gather-crystal'] },
  { id: 'artisan', name: 'Ремесленник', practices: ['gather-wood', 'gather-wood', 'gather-hide', 'gather-wood', 'gather-ore', 'gather-wood', 'gather-crystal'] },
  { id: 'jeweler', name: 'Ювелир', practices: ['gather-ore', 'gather-ore', 'gather-crystal', 'gather-ore', 'gather-crystal', 'gather-ore', 'gather-crystal'] },
  { id: 'engineer', name: 'Инженер', practices: ['gather-wood', 'gather-ore', 'gather-wood', 'gather-ore', 'gather-wood', 'gather-ore', 'gather-crystal'] },
]);

const gear = (slot, rarity, level, stats) => ({slot, rarity, level, ...stats});
const equipment = (id, profession, requiredLevel, name, icon, ingredients, slot, rarity, level, stats, masteryXp) => ({
  id, profession, requiredLevel, masteryXp, kind: 'item', ingredients,
  output: { name, icon, type: 'equipment', rarity, description: `Ремесленная экипировка: ${name}.`, equipment: { ...gear(slot, rarity, level, stats), name, icon } },
});
const gather = (id, qty) => ({ id, qty });

// Masterwork equipment is compared with current shop baselines; never weaken previously crafted items.
// 300-tier is prestige gated by the future verified master licence, not live.
const STAGE8_EQUIPMENT_BASE = Object.freeze([
  equipment('s8_smith_watch_blade','smith',25,'Клинок дозорного','🗡️',[gather('gather-ore',5),gather('gather-wood',2)],'weapon','rare',3,{attack:17,critChance:2},100),
  equipment('s8_smith_north_armor','smith',100,'Латы северянина','🛡️',[gather('gather-ore',9),gather('gather-hide',6)],'armor','rare',3,{defense:11,hp:70},180),
  equipment('s8_smith_storm_axe','smith',200,'Секира бури','🪓',[gather('gather-ore',14),gather('gather-wood',8),gather('gather-crystal',4)],'weapon','epic',5,{attack:33,critChance:7},255),
  equipment('s8_smith_jarl_blade','smith',300,'Клинок первого ярла','⚔️',[gather('gather-ore',30),gather('gather-wood',20),gather('gather-crystal',12)],'weapon','legendary',5,{attack:35,critChance:8},1),

  equipment('s8_jeweler_spark_ring','jeweler',25,'Кольцо искры','💍',[gather('gather-ore',4),gather('gather-crystal',3)],'ring','rare',3,{attack:8,critChance:2},100),
  equipment('s8_jeweler_guard_amulet','jeweler',100,'Оберег северных врат','📿',[gather('gather-ore',6),gather('gather-crystal',7)],'amulet','rare',3,{attack:5,critChance:3},180),
  equipment('s8_jeweler_sapphire_ring','jeweler',200,'Сапфировое кольцо','💎',[gather('gather-ore',12),gather('gather-crystal',12)],'ring','epic',5,{attack:14,critChance:4},255),
  equipment('s8_jeweler_jarl_seal','jeweler',300,'Печать ярла','💍',[gather('gather-ore',25),gather('gather-crystal',20)],'ring','legendary',5,{attack:15,critChance:5},1),

  equipment('s8_engineer_guard_helm','engineer',25,'Шлем дозорного','⛑️',[gather('gather-ore',4),gather('gather-wood',3)],'helmet','common',1,{defense:3,hp:20},100),
  equipment('s8_engineer_path_boots','engineer',100,'Сапоги следопыта','🥾',[gather('gather-ore',7),gather('gather-hide',6)],'boots','rare',2,{defense:4,hp:36,critChance:1},180),
  equipment('s8_engineer_north_shield','engineer',200,'Щит северной стражи','🛡️',[gather('gather-ore',13),gather('gather-wood',10)],'shield','rare',2,{defense:5,hp:25},255),
  equipment('s8_engineer_jarl_plate','engineer',300,'Доспех мастера механизмов','🛡️',[gather('gather-ore',30),gather('gather-hide',15),gather('gather-crystal',8)],'armor','legendary',3,{defense:12,hp:80},1),

  equipment('s8_artisan_messenger_boots','artisan',25,'Сапоги гонца','🥾',[gather('gather-wood',4),gather('gather-hide',3)],'boots','rare',2,{defense:3,hp:35,critChance:1},100),
  equipment('s8_artisan_trader_armor','artisan',100,'Броня караванщика','🦺',[gather('gather-hide',8),gather('gather-wood',6)],'armor','rare',3,{defense:10,hp:65},180),
  equipment('s8_artisan_north_helm','artisan',200,'Шлем старейшины','⛑️',[gather('gather-ore',15),gather('gather-hide',8)],'helmet','rare',1,{defense:3,hp:20},255),
  equipment('s8_artisan_jarl_boots','artisan',300,'Сапоги великого мастера','🥾',[gather('gather-hide',28),gather('gather-wood',20),gather('gather-crystal',7)],'boots','legendary',2,{defense:4,hp:40,critChance:2},1),
]);

/** Only NEW crafts receive this budget; historical owned gear is never rewritten. */
export const CRAFT_RARITY_POWER = Object.freeze({"common":1,"rare":1.15,"epic":1.35,"legendary":1.6});
const CRAFT_REFERENCES = Object.freeze({"weapon":{"common":{"attack":8},"rare":{"attack":18,"critChance":3},"epic":{"attack":35,"critChance":8}},"armor":{"common":{"defense":5,"hp":30},"rare":{"defense":12,"hp":80}},"helmet":{"common":{"defense":3,"hp":20}},"boots":{"rare":{"defense":4,"hp":40,"critChance":2}},"shield":{"common":{"defense":5,"hp":25}},"ring":{"rare":{"attack":10,"critChance":3},"epic":{"attack":15,"critChance":5}},"amulet":{"rare":{"attack":6,"critChance":3}}});
export function craftQualityPct(level){if(level>=300)return 10;if(level>=200)return 7;if(level>=100)return 5;if(level>=25)return 3;return 0;}

// New Stage8 crafts only. Rounded values keep the jeweler ahead of current
// shop offers, historical paid epics, and their same-level forge equivalents.
// Do not retroactively rewrite any owned item or server receipt.
const JEWELER_MASTERWORK_TARGETS = Object.freeze({
  'jeweler_raven_amulet': {attack:8,critChance:4},
  's8_jeweler_guard_amulet': {attack:9,critChance:4},
  's8_jeweler_spark_ring': {attack:12,critChance:4},
  'jeweler_power_ring': {attack:19,critChance:6},
  's8_jeweler_sapphire_ring': {attack:21,critChance:6},
  'jeweler_ancient_ring': {attack:25,critChance:7},
  's8_jeweler_jarl_seal': {attack:25,critChance:7},
});

function balanceCraftRecipe(recipe){
 if(!recipe.output?.equipment)return recipe;
 const eq=recipe.output.equipment;
 // Current server canonicalizes shop names. Preserve these historical recipes.
 if((eq.name==='Клинок рыцаря'&&eq.slot==='weapon'&&eq.rarity==='rare')||(eq.name==='Кожаная броня'&&eq.slot==='armor'&&eq.rarity==='common'))return recipe;
 const refs=CRAFT_REFERENCES[eq.slot];
 const refRarity=refs[eq.rarity]?eq.rarity:Object.keys(refs).filter(r=>CRAFT_RARITY_POWER[r]<=CRAFT_RARITY_POWER[eq.rarity]).sort((a,b)=>CRAFT_RARITY_POWER[b]-CRAFT_RARITY_POWER[a])[0]??Object.keys(refs)[0];
 const benchmark=refs[refRarity],factor=CRAFT_RARITY_POWER[eq.rarity]/CRAFT_RARITY_POWER[refRarity]*(1+craftQualityPct(recipe.requiredLevel)/100),level=eq.level;
 const caps={attack:eq.slot==='weapon'?40+6*level:['ring','amulet'].includes(eq.slot)?20+4*level:10+2*level,defense:['armor','shield','helmet','boots'].includes(eq.slot)?10+5*level:10+3*level,hp:eq.slot==='armor'?50+12*level:['boots','shield','helmet'].includes(eq.slot)?40+10*level:25+5*level};
 const balanced={...eq};
 for(const stat of ['attack','defense','hp'])if(typeof eq[stat]==='number'&&typeof benchmark[stat]==='number')balanced[stat]=Math.min(caps[stat],Math.max(eq[stat],Math.ceil(benchmark[stat]*factor)));
 // Crit is a bounded chance, NOT a rarity-scaled damage stat.
 if(typeof eq.critChance==='number')balanced.critChance=Math.min(10,Math.max(eq.critChance,(benchmark.critChance??eq.critChance)+(eq.rarity==='legendary'?1:0)));
 const masterwork=JEWELER_MASTERWORK_TARGETS[recipe.id];
 if(masterwork){
  balanced.attack=Math.max(balanced.attack??0,masterwork.attack);
  balanced.critChance=Math.max(balanced.critChance??0,masterwork.critChance);
 }
 const description=masterwork?`Атака +${balanced.attack}, шанс крита +${balanced.critChance}%.`:recipe.output.description;
 return {...recipe,output:{...recipe.output,description,equipment:balanced}};
}
export const STAGE8_EQUIPMENT = Object.freeze(STAGE8_EQUIPMENT_BASE.map(balanceCraftRecipe));

const consumable = (id,requiredLevel,name,icon,ingredients,kind,stat,value,masteryXp) => ({
  id, profession: 'alchemist', kind:'item', requiredLevel, masteryXp, ingredients,
  output: {name,icon,type:kind,rarity:requiredLevel>=200?'epic':requiredLevel>=100?'rare':'common',description:`${name}: ${value} ${stat}.`,effect:{stat,value,duration:kind==='elixir'?'battle':'instant'}},
});
export const STAGE8_CONSUMABLES = Object.freeze([
  consumable('s8_alchemist_herbal_mix',25,'Травяной настой','🧪',[gather('gather-herb',5),gather('gather-wood',2)],'potion','hp',50,100),
  consumable('s8_alchemist_focus',100,'Эликсир точности','✨',[gather('gather-herb',9),gather('gather-crystal',4)],'elixir','critChance',3,180),
  consumable('s8_alchemist_health',200,'Зелье северного здоровья','⚗️',[gather('gather-herb',18),gather('gather-crystal',5)],'potion','hp',150,255),
  consumable('s8_alchemist_jarl_elixir',300,'Эликсир стойкости ярла','🧬',[gather('gather-herb',30),gather('gather-crystal',16)],'elixir','defense',15,1),
]);

export const STAGE8_LEGACY_RECIPES = Object.freeze(legacyCatalogue.map((recipe) => Object.freeze(balanceCraftRecipe({
  ...recipe,
  kind:'item',
  masteryXp:recipe.requiredLevel===300 ? 1 : recipe.masteryXp,
}))));

export function bandForLevel(level) {
  return MASTERY_BANDS.find((band) => level >= band.from && level <= band.to) ?? null;
}

export function masteryXpToNext(level) {
  if (!Number.isSafeInteger(level) || level < 1 || level > 300) throw new Error('invalid mastery level');
  return level === 300 ? 0 : bandForLevel(level).xpToNext;
}

export function practiceFor(professionId, level) {
  const track = PROFESSION_TRACKS.find((entry) => entry.id === professionId);
  const band = bandForLevel(level);
  if (!track || !band) return null;
  const index = MASTERY_BANDS.indexOf(band);
  return {
    id: `s8_${professionId}_practice_${band.from}`,
    profession: professionId,
    requiredLevel: band.from,
    kind: 'practice',
    name: `${track.name}: ${band.name}`,
    masteryXp: band.trainingXp,
    ingredients: [gather(track.practices[index],band.trainingCost)],
    output: null,
  };
}

export const STAGE8_PRACTICE_RECIPES = Object.freeze(
  PROFESSION_TRACKS.flatMap((track) => MASTERY_BANDS.map((band) => practiceFor(track.id,band.from))),
);
export const STAGE8_RECIPES = Object.freeze([
  ...STAGE8_PRACTICE_RECIPES,...STAGE8_EQUIPMENT,...STAGE8_CONSUMABLES,...STAGE8_LEGACY_RECIPES,
]);

export function totalXpForLevel(target) {
  if (!Number.isSafeInteger(target) || target < 1 || target > 300) throw new Error('invalid target level');
  let total=0;
  for (let level=1; level<target; level++) total += masteryXpToNext(level);
  return total;
}

/** Deterministic scenario: player directs every gather to current training. */
export function simulateProgression({profession='smith', gathersPerDay=3, maxDays=2000}={}) {
  if (!PROFESSION_TRACKS.some((track)=>track.id===profession) || !Number.isSafeInteger(gathersPerDay) || gathersPerDay<1 || gathersPerDay>6) throw new Error('invalid simulation');
  let level=1, xp=0, totalGathered=0, totalTrained=0;
  const wallet=new Map();
  const milestones={1:0};
  for (let day=1; day<=maxDays; day++) {
    let dayXp=0;
    for (let gatherNumber=0; gatherNumber<gathersPerDay; gatherNumber++) {
      if (level===300) break;
      const practice=practiceFor(profession,level);
      const resource=practice.ingredients[0].id;
      wallet.set(resource,(wallet.get(resource)??0)+1);
      totalGathered++;
    }
    while (level<300) {
      const practice=practiceFor(profession,level);
      const cost=practice.ingredients[0];
      if ((wallet.get(cost.id)??0)<cost.qty || dayXp+practice.masteryXp>DAILY_SERVER_XP_CAP) break;
      wallet.set(cost.id,wallet.get(cost.id)-cost.qty);
      totalTrained++;
      dayXp+=practice.masteryXp;
      xp+=practice.masteryXp;
      while (level<300 && xp>=masteryXpToNext(level)) {
        xp-=masteryXpToNext(level);
        level++;
        if ([25,50,100,150,200,250,300].includes(level)) milestones[level]=day;
      }
      if (level===300) xp=0;
    }
    if (level===300) return {profession,gathersPerDay,days:day,milestones,totalGathered,totalTrained};
  }
  throw new Error(`not reached in ${maxDays} days`);
}
