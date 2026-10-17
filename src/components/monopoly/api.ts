import { supabase } from '@/game/supabase';
import type { HallState, HallResult, HallQuestion } from '@/game/gameHall';
export type MonopolyQuestion = HallQuestion & { steps?:number; event?:string; laps?:number; multiplier?:number; gold?:number; doubled?:boolean };
export type MonopolyData = {
 hall:HallState;
 progress:{laps:number;rolls:number;events:number;double_next:boolean;lucky_next:boolean;claimed:string[];ends_at:string};
 result:(HallResult & {event?:string;laps_added?:number})|null;
 added:number;
};
export async function monopoly(action='status',value=1,token:string|null=null):Promise<MonopolyData>{
 const {data,error}=await supabase.rpc('territory_monopoly_v2',{p_action:action,p_value:value,p_token:token});
 if(error)throw new Error(error.message);
 if(!data?.hall || !data?.progress || !Array.isArray(data.progress.claimed) ||
  !Number.isSafeInteger(data.hall.tickets) || data.hall.tickets<0 || data.hall.tickets>1000 ||
  !Number.isSafeInteger(data.progress.laps) || !Number.isFinite(Date.parse(data.progress.ends_at)))throw new Error('monopoly_invalid_reply');
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
