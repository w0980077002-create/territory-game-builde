import { supabase } from './supabase';
import { useAccount } from './actions';
/** Refresh only authoritative server entitlements. Missing pre-install RPC keeps
 * permanent VIP intact, allowing the app and migration to be reviewed together. */
export async function refreshFortuneVip():Promise<void>{
 const {data,error}=await supabase.rpc('territory_fortune_entitlement_v1');
 if(error||!data||!Number.isInteger(data.vip)||!Number.isInteger(data.permanent_vip)||!Number.isFinite(Date.parse(data.server_now)))return;
 useAccount.set({vip:data.vip,vipUntil:data.vip_until??null,permanentVip:data.permanent_vip,
  vipRemaining:data.vip_until?Math.max(0,Date.parse(data.vip_until)-Date.parse(data.server_now)):0,
  vipCheckedAt:performance.now()});
}
