/**
 * TERRITORY mastery quality v2 — offline/staged evaluator.
 *
 * Approved target ladder is measured against a same-slot, same-rarity,
 * same-item-level shop baseline. This module NEVER grants equipment or changes
 * the live Stage8 catalogue. A preview marked blocked MUST NOT be minted.
 */
import {CRAFT_RARITY_POWER, benchmarkShopEquipment, STAGE8_MASTERWORK_EQUIPMENT} from './stage8-model.mjs';

export const MASTERY_QUALITY_TIERS = Object.freeze([
  Object.freeze({level:1,pct:20}),
  Object.freeze({level:25,pct:35}),
  Object.freeze({level:50,pct:50}),
  Object.freeze({level:100,pct:70}),
  Object.freeze({level:150,pct:90}),
  Object.freeze({level:200,pct:110}),
  Object.freeze({level:250,pct:130}),
  Object.freeze({level:300,pct:160,requiresLicense:true}),
]);
const STATS = Object.freeze(['attack','defense','hp','critChance']);
const MAX_HERO_LEVEL = 61;

/** A hero's MASTER LICENSE affects only the final 300 tier. */
export function masteryQualityTier(masteryLevel,masterLicense=false){
  if(!Number.isSafeInteger(masteryLevel)||masteryLevel<1||masteryLevel>300
    ||typeof masterLicense!=='boolean')throw new Error('invalid_mastery_or_license');
  const tier = [...MASTERY_QUALITY_TIERS].reverse().find(row=>row.level<=masteryLevel
    && (!row.requiresLicense||masterLicense));
  if(!tier)throw new Error('missing_quality_tier');
  return tier;
}

/** Exact current PostgreSQL V4 ceilings, not an invitation to expand them. */
export function equipmentServerCaps(slot,level){
  if(!Number.isSafeInteger(level)||level<1||level>500)throw new Error('invalid_item_level');
  return {
    attack:slot==='weapon'?40+6*level:['ring','amulet'].includes(slot)?20+4*level:10+2*level,
    defense:['armor','shield','helmet','boots'].includes(slot)?10+5*level:10+3*level,
    hp:slot==='armor'?50+12*level:['boots','shield','helmet'].includes(slot)?40+10*level:25+5*level,
    critChance:25,
  };
}
export function previewMasterworkAtMastery(recipe,masteryLevel,{
  masterLicense=false,heroLevel=MAX_HERO_LEVEL,
}={}){
  if(!recipe||!recipe.id?.startsWith('mw_')||!recipe.output?.equipment){
    return {status:'not_masterwork'};
  }
  if(!Number.isSafeInteger(heroLevel)||heroLevel<1||heroLevel>500){
    throw new Error('invalid_hero_level');
  }
  const tier=masteryQualityTier(masteryLevel,masterLicense);
  if(recipe.requiredLevel>masteryLevel||recipe.requiredLevel===300&&!masterLicense)
    return {status:'locked',reason:recipe.requiredLevel===300&&!masterLicense?'master_license_required':'mastery_too_low',targetPct:tier.pct};
  const eq=recipe.output.equipment;
  const initialLevel=eq.level;
  if(!Number.isSafeInteger(initialLevel)||initialLevel<1||!CRAFT_RARITY_POWER[eq.rarity]){
    return {status:'invalid_recipe'};
  }
  const originalFields=STATS.filter(stat=>typeof eq[stat]==='number');
  if(!originalFields.length)return {status:'invalid_recipe'};
  const maxLevel=Math.min(MAX_HERO_LEVEL,heroLevel);
  if(initialLevel>maxLevel)return {status:'blocked',reason:'hero_below_recipe_level',targetPct:tier.pct,requiredItemLevel:initialLevel};
  let lastBlockers=[];
  for(let level=initialLevel;level<=maxLevel;level++){
    const shop=benchmarkShopEquipment(eq.slot,eq.rarity,level);
    const rarityScale=CRAFT_RARITY_POWER[eq.rarity]/CRAFT_RARITY_POWER[shop.rarity];
    const caps=equipmentServerCaps(eq.slot,level);
    const predicted={...eq,level};
    const blockers=[];
    for(const stat of originalFields){
      const baseline=shop[stat];
      if(typeof baseline!=='number'||baseline<0){blockers.push(stat+':missing_shop_reference');continue;}
      const target=Math.max(eq[stat],Math.ceil(baseline*rarityScale*(1+tier.pct/100)));
      if(target>caps[stat])blockers.push(stat+':target_'+target+'_cap_'+caps[stat]);
      predicted[stat]=target;
    }
    if(!blockers.length){
      return {
        status:'ready',targetPct:tier.pct,masteryLevel,masterLicense,
        baselineShopId:shop.id,itemLevel:level,requiredItemLevel:level,
        equipment:predicted,
      };
    }
    lastBlockers=blockers;
  }
  return {
    status:'blocked',reason:'server_caps_or_reference_incompatible',targetPct:tier.pct,
    maxCheckedItemLevel:maxLevel,blockers:lastBlockers,
  };
}

/**
 * Snapshot report for every current masterwork recipe & milestone.
 * 'blocked' is an acceptance gate. Do NOT turn these numbers into a UI claim.
 */
export function masteryQualityAudit({
  masterLicense=true,heroLevel=MAX_HERO_LEVEL,
}={}){
  const rows=[];
  for(const recipe of STAGE8_MASTERWORK_EQUIPMENT){
    for(const tier of MASTERY_QUALITY_TIERS){
      const result=previewMasterworkAtMastery(recipe,tier.level,{masterLicense,heroLevel});
      rows.push({recipeId:recipe.id,profession:recipe.profession,
        recipeLevel:recipe.requiredLevel,masteryLevel:tier.level,
        ...result});
    }
  }
  return rows;
}
