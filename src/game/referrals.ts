import { supabase } from './supabase';
import { getTelegramWebApp } from './telegram';
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

export type ReferralFriend = {
  name: string;
  level: number;
  wins: number;
  verified_xp: number;
  qualified: boolean;
  joined_at: string;
};
export type ReferralRound = { attack: 'head' | 'chest' | 'belly' | 'legs'; blocks: string[] };

export async function getReferralFriends(): Promise<ReferralFriend[]> {
 const {data,error}=await supabase.rpc('territory_referral_friends_v2');
 if(error) throw new Error(error.message);
 if(!Array.isArray(data)) throw new Error('referral_friend_list_invalid');
 return data.filter((x:unknown):x is ReferralFriend=>{
  if(!x || typeof x!=='object')return false;
  const row=x as Record<string,unknown>;
  return typeof row.name==='string' && row.name.length<=32
   && Number.isSafeInteger(row.level) && (row.level as number)>=1
   && Number.isSafeInteger(row.wins) && (row.wins as number)>=0
   && Number.isSafeInteger(row.verified_xp) && (row.verified_xp as number)>=0
   && typeof row.qualified==='boolean' && typeof row.joined_at==='string';
 });
}

/** Optional referral activity logging. Does not change how PvE resolves or pays. */
export async function beginReferralFight(kind:'stage'|'trial',enemyId:string):Promise<string|null>{
 const {data,error}=await supabase.rpc('territory_referral_fight_start_v2',{
  p_kind:kind,p_enemy_id:enemyId
 });
 if(error) {
  console.warn('Referral battle start unavailable:',error.message);
  return null;
 }
 if(!data?.tracked || typeof data.ticket!=='string' ||
   !/^[0-9a-f-]{36}$/.test(data.ticket))return null;
 return data.ticket;
}
export async function finishReferralFight(ticket:string,won:boolean,rounds:ReferralRound[]):Promise<boolean>{
 const {data,error}=await supabase.rpc('territory_referral_fight_finish_v2',{
  p_ticket:ticket,p_won:won,p_rounds:rounds
 });
 if(error) {
  console.warn('Referral battle receipt unavailable:',error.message);
  return false;
 }
 return data?.credited===true;
}

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


/** Telegram's native picker is user-initiated: never auto-send to a chat.
 * Only share a validated link generated from the verified bot username. */
export function shareReferralInvite(url:string,en:boolean):boolean{
 if(!/^https:\/\/t\.me\/[a-zA-Z0-9_]{5,32}\?startapp=ref_[a-f0-9]{14}$/.test(url))return false;
 const caption=en?'Join me in TERRITORY! Start your adventure and collect the welcome gift.':'Заходи ко мне в TERRITORY! Играй вместе со мной и получи подарок новичка.';
 const shareUrl='https://t.me/share/url?url='+encodeURIComponent(url)+'&text='+encodeURIComponent(caption);
 const webapp=getTelegramWebApp();
 if(webapp?.openTelegramLink)webapp.openTelegramLink(shareUrl);
 else window.open(shareUrl,'_blank','noopener,noreferrer');
 return true;
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
