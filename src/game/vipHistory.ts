import { supabase } from './supabase';

export type VipChestClaim = {
  source:'daily'|'weekly';
  period:string;vip:number;gold:number;gems:number;stones:number;
  materials:number;claimedAt:string;
};
export async function fetchVipChestHistory():Promise<VipChestClaim[]> {
  const {data,error}=await supabase.rpc('territory_vip_claim_history_v1');
  if(error||!data||data.success!==true||!Array.isArray(data.claims)
    ||data.claims.length>14)throw new Error('vip_claim_history_unavailable');
  return data.claims.map((r:unknown)=>{
    if(!r||typeof r!=='object')throw new Error('vip_claim_history_invalid');
    const x=r as Record<string,unknown>;
    if((x.source!=='daily'&&x.source!=='weekly')
      ||typeof x.period!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x.period)
      ||!Number.isInteger(x.vip)||Number(x.vip)<1||Number(x.vip)>10
      ||![x.gold,x.gems,x.stones,x.materials].every(n=>Number.isSafeInteger(n)&&Number(n)>=0)
      ||typeof x.claimedAt!=='string'||!Number.isFinite(Date.parse(x.claimedAt)))
      throw new Error('vip_claim_history_invalid');
    return {source:x.source,period:x.period,vip:Number(x.vip),
      gold:Number(x.gold),gems:Number(x.gems),stones:Number(x.stones),
      materials:Number(x.materials),claimedAt:x.claimedAt} as VipChestClaim;
  });
}
