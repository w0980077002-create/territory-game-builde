import { supabase } from './supabase';
import { saveCloudSave } from './cloud';
import { useGame } from './actions';
import { claimReferralCloud } from './cloud';

export type ReferralStatus = {
  code: string;
  founder_number: number | null;
  places_left: number;
  registered: number;
  qualified: number;
  pending_claims: number;
  red_fragments: number;
  red_pending: number;
  red_earned_tenths: number;
  sealed_chests: number;
  welcome_pending: boolean;
  rank: 'recruit' | 'bronze' | 'silver' | 'gold' | 'ambassador';
};
export type ReferralReceipt = {
  gold: number; gems: number; stones: number; materials: number;
  red_gems: number; welcome_elixirs: number; friends_claimed: number;
};
export const founderRewardLimit = 10;
export const firstFounderSeasonLimit = 300;
export const friendReward = { gold: 1500, gems: 10, materials: 2, stones: 1, redTenths: 2, chest: 1 };
export const newRecruitBonus = { gold: 600, stones: 3, elixirs: 2 };

export function validReferralStatus(data: unknown): data is ReferralStatus {
  if (!data || typeof data !== 'object') return false;
  const s=data as Record<string,unknown>;
  if (typeof s.code !== 'string' || !/^[a-f0-9]{14}$/.test(s.code)) return false;
  for(const key of ['places_left','registered','qualified','pending_claims','red_fragments','red_pending','red_earned_tenths','sealed_chests']){
    if(!Number.isSafeInteger(s[key]) || (s[key] as number)<0) return false;
  }
  return (s.founder_number===null || (Number.isSafeInteger(s.founder_number) && (s.founder_number as number)>0 && (s.founder_number as number)<=300))
    && (s.red_fragments as number)<5 && typeof s.welcome_pending==='boolean'
    && ['recruit','bronze','silver','gold','ambassador'].includes(String(s.rank));
}

export async function getReferralStatus():Promise<ReferralStatus>{
 const {data,error}=await supabase.rpc('territory_referral_status_v1');
 if(error) throw new Error(error.message);
 if(!validReferralStatus(data)) throw new Error('referral_status_invalid');
 return data;
}

/** Public bot username comes from verified server-side Bot API getMe. Never guess a bot URL. */
export async function getReferralBotUsername():Promise<string | null>{
 try{
  const {data,error}=await supabase.functions.invoke('telegram-auth',{method:'GET'});
  if(error || typeof data?.bot_username !== 'string' || !/^[a-zA-Z0-9_]{5,32}$/.test(data.bot_username))return null;
  return data.bot_username;
 }catch{return null;}
}

export function referralLink(bot:string|null,code:string):string|null{
 if(!bot || !/^[a-zA-Z0-9_]{5,32}$/.test(bot) || !/^[0-9a-f]{14}$/.test(code))return null;
 return 'https://t.me/'+bot+'?startapp=ref_'+code;
}

/** First flush local changes, then redeem at exact saved revision. */
export async function redeemReferrals(userId:string):Promise<ReferralReceipt>{
 const snapshot=useGame.get();
 if(!await saveCloudSave(userId,snapshot) || useGame.get()!==snapshot)
  throw new Error('referral_reload_required');
 const result=await claimReferralCloud(userId);
 if(useGame.get()!==snapshot){window.location.reload();throw new Error('referral_reload_required');}
 useGame.set(result.state);
 return result.receipt;
}
