/**
 * TERRITORY 1.0 profession rebalance proposal. Staging ONLY: not imported by
 * the live game, no migrations, no client-side XP authority.
 *
 * Single source for the progression simulation and versioned draft catalogue.
 * Publishing requires a separately tested server-authoritative cutover.
 */
import { readFileSync } from 'node:fs';

// Preserve all 17 legacy IDs, names and ingredient costs for compatibility.
// New Stage8 craft outputs are versioned and can receive higher masterwork stats;
// existing owned equipment and server receipts are never retroactively rewritten.
// Level-300 recipe XP is capped to fit the 300 XP daily ceiling.
const legacyCatalogue = JSON.parse(readFileSync(new URL('../../supabase/staged/territory_craft_catalog.json',import.meta.url),'utf8'));

export const STAGE8_VERSION = 'profession-stage8-draft-20261112-r4';
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

/**
 * Stage8 draft ONLY. Compare a NEW crafted item against the strongest shop
 * offer of the SAME slot and rarity at the SAME item level. Old purchases,
 * owned equipment, V1 inventory and existing receipt payloads are immutable.
 * Epic historic paid items are benchmarks, never converted into rare goods.
 */
export const CRAFT_RARITY_POWER = Object.freeze({common:1,rare:1.15,epic:1.35,legendary:1.6});
export const MASTERWORK_MIN_PCT = 20;
export const MASTERWORK_MAX_PCT = 30;
export function craftQualityPct(level){if(level>=300)return 10;if(level>=200)return 7;if(level>=100)return 5;if(level>=25)return 3;return 0;}
export const masterworkBonusPct = (masteryLevel) => MASTERWORK_MIN_PCT + craftQualityPct(masteryLevel);

// Mirror the actual shop equipment templates, not the outdated 8/2 ring
// reference. The offline test verifies every row against equipmentCatalog.ts.
export const STAGE8_SHOP_BASELINES = Object.freeze([
  {id:'shop_weapon_warrior_eq',slot:'weapon',rarity:'common',level:1,attack:8},
  {id:'shop_weapon_knight_eq',slot:'weapon',rarity:'rare',level:3,attack:18,critChance:3},
  {id:'shop_weapon_hero_eq',slot:'weapon',rarity:'rare',level:5,attack:22,critChance:4},
  {id:'shop_armor_leather_eq',slot:'armor',rarity:'common',level:1,defense:5,hp:30},
  {id:'shop_armor_plate_eq',slot:'armor',rarity:'rare',level:3,defense:12,hp:80},
  {id:'shop_helmet_iron_eq',slot:'helmet',rarity:'common',level:1,defense:3,hp:20},
  {id:'shop_boots_swift_eq',slot:'boots',rarity:'rare',level:2,defense:4,hp:40,critChance:2},
  {id:'shop_ring_power_eq',slot:'ring',rarity:'rare',level:5,attack:10,critChance:3},
  {id:'shop_shield_oak_eq',slot:'shield',rarity:'common',level:2,defense:5,hp:25},
  {id:'shop_amulet_raven_eq',slot:'amulet',rarity:'rare',level:3,attack:6,critChance:3},
  // Existing historical epic purchases are protected; use their original
  // stats as a quality threshold even though they are no longer sold.
  {id:'historic_shop_hero',slot:'weapon',rarity:'epic',level:5,attack:35,critChance:8,historic:true},
  {id:'historic_shop_ring',slot:'ring',rarity:'epic',level:5,attack:15,critChance:5,historic:true},
]);

// This intentionally mirrors FORGE_STAT_GROWTH from equipmentBalance.ts.
// A regression test checks those two tables for drift.
export const STAGE8_FORGE_GROWTH = Object.freeze({
  weapon:{common:{attack:1},rare:{attack:1.5},epic:{attack:2},legendary:{attack:3}},
  ring:{common:{attack:0.5,defense:0,hp:0.5},rare:{attack:0.5,defense:0.25,hp:0.75},epic:{attack:0.75,defense:0.5,hp:1},legendary:{attack:1,defense:0.5,hp:1.5}},
  amulet:{common:{attack:0.25,defense:0,hp:0.5},rare:{attack:0.5,defense:0.25,hp:0.75},epic:{attack:0.75,defense:0.5,hp:1},legendary:{attack:1,defense:0.5,hp:1.5}},
  armor:{common:{defense:0.25,hp:1},rare:{defense:0.5,hp:1.5},epic:{defense:0.75,hp:2},legendary:{defense:1,hp:3}},
  helmet:{common:{defense:0.25,hp:0.5},rare:{defense:0.25,hp:0.75},epic:{defense:0.5,hp:1},legendary:{defense:0.5,hp:1.5}},
  shield:{common:{defense:0.5,hp:0.5},rare:{defense:0.5,hp:0.75},epic:{defense:0.75,hp:1},legendary:{defense:1,hp:1.5}},
  boots:{common:{defense:0.25,hp:0.5},rare:{defense:0.25,hp:1},epic:{defense:0.5,hp:1.5},legendary:{defense:0.5,hp:2}},
});

export function benchmarkShopEquipment(slot, rarity, itemLevel){
  const candidates=STAGE8_SHOP_BASELINES.filter(
    (item)=>item.slot===slot && CRAFT_RARITY_POWER[item.rarity]<=CRAFT_RARITY_POWER[rarity]);
  if(!candidates.length)throw new Error('Missing shop benchmark: '+slot+'/'+rarity);
  const highest=Math.max(...candidates.map(item=>CRAFT_RARITY_POWER[item.rarity]));
  const tier=candidates.filter(item=>CRAFT_RARITY_POWER[item.rarity]===highest);
  // First compare genuinely obtainable shop items at this level. Only when
  // there is no such item (rare ring lvl3), project the nearest shop baseline
  // backwards using the canonical linear forge slope.
  const eligible=tier.filter(item=>item.level<=itemLevel);
  const compared=(eligible.length?eligible:tier).map(item=>{
    const curve=STAGE8_FORGE_GROWTH[item.slot][item.rarity];
    const normalized={...item};
    for(const key of ['attack','defense','hp']){
      if(typeof item[key]==='number')
        normalized[key]=Math.max(0,item[key]+Math.round((curve[key]??0)*(itemLevel-item.level)));
    }
    normalized.level=itemLevel;
    return normalized;
  });
  return compared.sort((a,b)=>
    ((b.attack??0)*5+(b.defense??0)*5+(b.hp??0)+(b.critChance??0)*10)-
    ((a.attack??0)*5+(a.defense??0)*5+(a.hp??0)+(a.critChance??0)*10))[0];
}

function balanceCraftRecipe(recipe){
  if(!recipe.output?.equipment)return recipe;
  const eq=recipe.output.equipment;
  const benchmark=benchmarkShopEquipment(eq.slot,eq.rarity,eq.level);
  const rarityScale=CRAFT_RARITY_POWER[eq.rarity]/CRAFT_RARITY_POWER[benchmark.rarity];
  const factor=rarityScale*(1+masterworkBonusPct(recipe.requiredLevel)/100);
  const balanced={...eq};
  for(const stat of ['attack','defense','hp','critChance']){
    if(typeof benchmark[stat]!=='number')continue;
    // Craft only grants native stats for this slot; never create arbitrary
    // crit chance on an item that did not have critical strikes before.
    if(typeof eq[stat]!=='number')continue;
    const minimum=Math.ceil(benchmark[stat]*rarityScale*(1+MASTERWORK_MIN_PCT/100));
    const target=Math.max(minimum,Math.round(benchmark[stat]*factor));
    balanced[stat]=Math.max(eq[stat],stat==='critChance'?Math.min(25,target):target);
  }
  // In the old server two legacy recipe item names exactly matched store
  // inventory and were re-canonicalized to the WEAKER shop stats.
  // Preserve IDs and material costs, but give newly minted Stage8 items
  // distinct craft-only names. Existing owned V1 equipment is untouched.
  const collidesWithShop=STAGE8_SHOP_BASELINES.some(
    item=>!item.historic && item.slot===eq.slot && item.rarity===eq.rarity &&
      ((eq.name==='Клинок рыцаря' && item.id==='shop_weapon_knight_eq') ||
       (eq.name==='Кожаная броня' && item.id==='shop_armor_leather_eq')));
  const name=collidesWithShop?eq.name+' мастера':eq.name;
  const improved={...balanced,name};
  const stats=[['attack','атака'],['defense','защита'],['hp','HP'],['critChance','крит %']]
    .filter(([key])=>typeof improved[key]==='number')
    .map(([key,label])=>label+' '+improved[key]).join(', ');
  return {...recipe,output:{...recipe.output,name,
    description:'Мастерское изделие ('+masterworkBonusPct(recipe.requiredLevel)+'% к магазинной базе с учётом редкости): '+stats+'.',
    equipment:improved}};
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
