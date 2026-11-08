/** Two VIP chest types across every VIP level. Illustrative rewards only.
 * This module is deliberately pure: it does not mint items or change player state.
 * Actual server-validated claims must be enabled separately after owner approval.
 */
export type VipChestKind='daily'|'weekly';
export const VIP_CHEST_ART:Record<VipChestKind,string>={
  daily:'assets/territory/vip/chests/daily-premium.webp',
  weekly:'assets/territory/vip/chests/weekly-premium.webp',
};
export interface VipChestPreview {gold:number;materials:number;potions:number;}
export function previewVipChest(kind:VipChestKind,level:number):VipChestPreview {
  const tier=Number.isFinite(level)?Math.min(10,Math.max(1,Math.floor(level))):1;
  return kind==='daily'
    ?{gold:60*tier,materials:tier,potions:1+Math.floor((tier-1)/3)}
    :{gold:300*tier,materials:3*tier,potions:2+Math.floor((tier-1)/2)};
}
