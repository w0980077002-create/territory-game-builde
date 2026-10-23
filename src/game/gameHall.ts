import { supabase } from './supabase';
import { useGame } from './actions';
import { saveCloudSave, claimHallGoldCloud } from './cloud';

/** Maximum stored Hall tickets allowed by the production database constraint. */
export const HALL_TICKET_MAX = 1000;

export type HallGame = 'monopoly' | 'dice' | 'tower' | 'targets' | 'treasury' | 'wheel' | 'slots';
export const GAME_IDS: HallGame[] = ['monopoly','dice','tower','targets','treasury'];
export type HallQuestion = {
  roll?:number; old_position?:number; new_position?:number;board_size?:number;
  dice?:number[]; options?:number[]; target?:number;
  doors?:number[]; targets?:number[]; runes?:number[]; chests?:number[];
  goal?:string;
};
export type HallSession = {token:string;game:HallGame;question:HallQuestion};
export type HallState = {
 tickets:number;points:number;played:number;wins:number;pending_gold:number;
 claimed_gold:number;position:number;daily_remaining:number;
 free_ready:boolean; active:HallSession|null;
};
export type HallResult = {
 won:boolean;earned_gold:number;points:number;daily_remaining:number;
 tickets:number;game:HallGame;new_position:number|null;
};
function ensureRecord(value:unknown): Record<string,unknown> {
 if(!value || typeof value!=='object'||Array.isArray(value))throw new Error('hall_invalid_server_reply');
 return value as Record<string,unknown>;
}
function natural(x:unknown,max=1e8):x is number {
 return Number.isSafeInteger(x) && (x as number)>=0 && (x as number)<=max;
}
function validSession(s:unknown):s is HallSession{
 if(!s || typeof s!=='object')return false;
 const v=s as Partial<HallSession>;
 return typeof v.token==='string' && /^[a-f0-9-]{36}$/i.test(v.token) &&
 GAME_IDS.includes(v.game as HallGame) && !!v.question && typeof v.question==='object';
}
export async function hallStatus():Promise<HallState> {
 const {data,error}=await supabase.rpc('territory_hall_status_v1');
 if(error)throw new Error(error.message);
 const s=ensureRecord(data);
 for(const key of ['tickets','points','played','wins','pending_gold','claimed_gold','position','daily_remaining']){
  if(!natural(s[key],key==='tickets'?HALL_TICKET_MAX:1e8))throw new Error('hall_invalid_status_'+key);
 }
 if(typeof s.free_ready!=='boolean'|| (s.active!==null && !validSession(s.active)))throw new Error('hall_invalid_status');
 return s as HallState;
}
export async function hallDaily():Promise<number>{
 const {data,error}=await supabase.rpc('territory_hall_daily_v1');
 if(error)throw new Error(error.message);
 // The +2 daily claim itself is server-restricted to a 20-ticket wallet;
 // this is not the maximum for all Hall tickets (e.g., admin-issued tickets).
 if(!natural(data?.tickets,20)||data?.added!==2)throw new Error('hall_invalid_daily');
 return data.tickets;
}
export async function hallStart(game:HallGame):Promise<HallSession>{
 if(!GAME_IDS.includes(game))throw new Error('hall_unknown_game');
 const {data,error}=await supabase.rpc('territory_hall_start_v1',{p_game:game});
 if(error)throw new Error(error.message);
 if(!validSession(data))throw new Error('hall_invalid_session');
 return data;
}
export async function hallFinish(session:HallSession,choice:number):Promise<HallResult>{
 if(!validSession(session)||!natural(choice,2))throw new Error('hall_invalid_choice');
 const {data,error}=await supabase.rpc('territory_hall_finish_v1',{p_token:session.token,p_choice:choice});
 if(error)throw new Error(error.message);
 const d=ensureRecord(data);
 if(typeof d.won!=='boolean' || !natural(d.earned_gold,160) ||
  !natural(d.points,10) || !natural(d.tickets,HALL_TICKET_MAX) || !GAME_IDS.includes(d.game as HallGame))throw new Error('hall_invalid_result');
 return d as HallResult;
}
export async function hallClaimGold(userId:string):Promise<number>{
 const snapshot=useGame.get();
 // Preserve the same cloud revision protocol as referrals and equipment recycling.
 if(!await saveCloudSave(userId,snapshot) || useGame.get()!==snapshot)
  throw new Error('hall_reload_required');
 const claim=await claimHallGoldCloud(userId);
 if(useGame.get()!==snapshot){window.location.reload();throw new Error('hall_reload_required');}
 useGame.set(claim.state);
 return claim.gold;
}
// A single server-verified payout operation shared by the hall and game screens.
// Multiple mounted screens must never issue concurrent wallet mutations.
const autoClaims=new Map<string,Promise<number>>();
export function autoClaimHallGold(userId:string,pendingGold:number):Promise<number>{
 if(!Number.isSafeInteger(pendingGold)||pendingGold<=0)return Promise.resolve(0);
 const inflight=autoClaims.get(userId);
 if(inflight)return inflight;
 const claim=hallClaimGold(userId);
 autoClaims.set(userId,claim);
 void claim.finally(()=>{if(autoClaims.get(userId)===claim)autoClaims.delete(userId);}).catch(()=>{});
 return claim;
}

export function hallError(e:unknown,en:boolean):string {
 const msg=e instanceof Error?e.message:'';
 if(msg.includes('hall_no_tickets'))return en?'No tickets left. Claim free tickets tomorrow.':'Билеты закончились. Забери бесплатные завтра.';
 if(msg.includes('hall_daily_already_claimed'))return en?'Today’s free tickets are already claimed.':'Сегодня бесплатные билеты уже получены.';
 if(msg.includes('hall_ticket_wallet_full'))return en?'Spend tickets before collecting new ones.':'Сначала потрать часть билетов.';
 if(msg.includes('hall_reload')||msg.includes('hall_invalid_wallet'))return en?'Reload the game to protect your progress.':'Перезапусти игру, чтобы не потерять прогресс.';
 if(msg.includes('hall_session_expired')||msg.includes('hall_ticket_used'))return en?'That round has ended. Refresh the hall.':'Раунд уже завершён. Обнови игровой зал.';
 return en?'The game server is temporarily unavailable. Please try again.':'Игровой сервер временно недоступен. Попробуй ещё раз.';
}
