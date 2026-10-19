import {useGame} from '@/game/actions';
import {saveCloudSave,acceptMonopolyClaimReceipt} from '@/game/cloud';
import { supabase } from '@/game/supabase';
import type { HallState, HallResult, HallQuestion } from '@/game/gameHall';
export type MonopolyQuestion = HallQuestion & { steps?:number; event?:string; laps?:number; multiplier?:number; gold?:number; prize?:Prize; doubled?:boolean };
export type MonopolyData = {
 hall:HallState;
 progress:{laps:number;rolls:number;events:number;double_next:boolean;lucky_next:boolean;claimed:string[];pending_rewards:Prize;ends_at:string};
 result:(HallResult & {event?:string;awards?:Prize;laps_added?:number})|null;
 added:number;
 awards?:Prize;
};
export async function monopoly(action='status',value=1,token:string|null=null):Promise<MonopolyData>{
 const {data,error}=await supabase.rpc('territory_monopoly_v2',{p_action:action,p_value:value,p_token:token});
 if(error)throw new Error(error.message);
 if(!data?.hall || !data?.progress || !Array.isArray(data.progress.claimed) ||
  !Number.isSafeInteger(data.hall.tickets) || data.hall.tickets<0 || data.hall.tickets>1000 ||
  !Number.isSafeInteger(data.progress.laps) || !Number.isFinite(Date.parse(data.progress.ends_at)))throw new Error('monopoly_invalid_reply');
 if(!data.progress.pending_rewards || Object.values(data.progress.pending_rewards).some(v=>!Number.isSafeInteger(v)||(v as number)<0||(v as number)>100000))throw new Error('monopoly_invalid_rewards');
 return data;
}
export const cellGold=(position:number)=>position===0?100:35+(position%5)*20;
export function boardPoint(index:number){
 // Diamond circuit, start at the bottom, clockwise around the lagoon.
 const corners=[[50,91],[6,50],[50,9],[94,50],[50,91]];
 const side=Math.floor(index/7),t=(index%7)/7;
 return {x:corners[side][0]+(corners[side+1][0]-corners[side][0])*t,
 y:corners[side][1]+(corners[side+1][1]-corners[side][1])*t};
}

export type Prize = Partial<Record<'gems'|'stones'|'materials'|'potions'|'elixirs',number>>;
export const prizeIcons={gems:'💎',stones:'🪨',materials:'⚒️',potions:'🧪',elixirs:'💪'};
export const prizeLabels={gems:['Алмазы','Gems'],stones:['Боевые камни','Battle stones'],materials:['Материалы','Materials'],potions:['Зелье здоровья','Health potion'],elixirs:['Эликсир силы','Strength elixir']};
export function cellPrize(position:number,multiplier=1):Prize{
 if(position===0||[6,14,21].includes(position))return {};
 const kind=([null,'gems','stones','materials','potions','elixirs'] as const)[position%6];
 return kind?{[kind]:([0,2,5,3,1,1][position%6])*multiplier}:{};
}
export function bundlePrize(action:'quest'|'offer'|'milestone',value:number):Prize{
 if(action==='milestone')return {gems:value*2,stones:value*4,materials:value,potions:value/5,elixirs:value/5};
 if(action==='quest')return {stones:value*5,materials:value*2,potions:1};
 return {gems:value*3,elixirs:1};
}

// A verified receipt contains the post-credit game state and revision, so no
// Telegram Mini App reload is needed after gifting resources to the player.
export async function claimMonopolyRewards():Promise<Prize>{
 const {data:{user},error:authError}=await supabase.auth.getUser();
 if(authError||!user)throw new Error('hall_login_required');
 const snapshot=useGame.get();
 if(!await saveCloudSave(user.id,snapshot)||useGame.get()!==snapshot)throw new Error('monopoly_reload_required');
 const {data:row,error:readError}=await supabase.from('players').select('updated_at').eq('id',user.id).single();
 if(readError||!row?.updated_at||useGame.get()!==snapshot)throw new Error('monopoly_reload_required');
 const {data,error}=await supabase.rpc('territory_monopoly_claim_v2',{p_expected:row.updated_at,p_snapshot:snapshot});
 if(error)throw new Error(error.message);
 const newState=acceptMonopolyClaimReceipt(user.id,data);
 useGame.set(newState);
 return (data?.awards??{}) as Prize;
}
