import { supabase } from './supabase';
import { getTelegramWebApp } from './telegram';
import { getReferralStatus, getReferralBotUsername } from './referrals';
import { useGame } from './actions';
import { saveCloudSave, saveTokens, acceptMonopolyClaimReceipt } from './cloud';

export type DailyShareTask='monopoly'|'trials';
export type ShareEntry={task:DailyShareTask;reward_kind:'tickets'|'stones';reward_amount:number;enabled:boolean;ready:boolean;next_at:string|null};
export type ShareStatus={server_time:string;tasks:ShareEntry[];tickets:number|null};
export type ShareReceipt={success:true;task:DailyShareTask;added:number;next_at:string;tickets?:number};
const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export async function dailyShareStatus():Promise<ShareStatus>{
 const {data,error}=await supabase.rpc('territory_daily_share_v1',{p_action:'status'});
 if(error)throw new Error(error.message);
 if(!object(data)||!Array.isArray(data.tasks)||data.tasks.length!==2||typeof data.server_time!=='string'||
  new Set(data.tasks.map((t:ShareEntry)=>t.task)).size!==2||
  !data.tasks.every((t:ShareEntry)=>['monopoly','trials'].includes(t.task)&&t.reward_amount===2&&
   t.reward_kind===(t.task==='monopoly'?'tickets':'stones')&&typeof t.ready==='boolean'&&typeof t.enabled==='boolean'&&
   (t.next_at===null||(typeof t.next_at==='string'&&Number.isFinite(Date.parse(t.next_at))))))
  throw new Error('daily_share_invalid_status');
 return data as ShareStatus;
}
export async function prepareDailyShareLink(language:'ru'|'en'):Promise<string>{
 const [ref,bot]=await Promise.all([getReferralStatus(),getReferralBotUsername()]);
 if(!bot||!/^[a-zA-Z0-9_]{5,32}$/.test(bot)||!/^[a-f0-9]{14}$/.test(ref.code))throw new Error('daily_share_no_bot');
 const origin=window.location.protocol==='https:'?window.location.origin:'https://w0980077002-create.github.io';
 const base=import.meta.env.BASE_URL.startsWith('/')?import.meta.env.BASE_URL:'/territory-game-builde/';
 return origin+base+'promo/'+language+'/?'+new URLSearchParams({ref:ref.code,bot,v:'2'});
}
export function shareDailyPromo(url:string,language:'ru'|'en'):boolean{
 // Validate the intended locale and destination before opening Telegram.
 try{
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' ||
     !['w0980077002-create.github.io',window.location.hostname].includes(parsed.hostname) ||
     !parsed.pathname.endsWith('/promo/'+language+'/') ||
     !/^[a-f0-9]{14}$/.test(parsed.searchParams.get('ref')??'') ||
     !/^[a-zA-Z0-9_]{5,32}$/.test(parsed.searchParams.get('bot')??''))return false;
 }catch{return false;}
 const caption=language==='ru'
 ?'⚔️ Привет! Заходи в TERRITORY: бои на арене, сокровища, Монополия, кланы и приключения. 🏆 Начни играть со мной!'
 :'⚔️ Hey friend! Join TERRITORY for arena battles, treasure, Monopoly, clans and exciting adventures. 🏆 Come play with me!';
 const telegram='https://t.me/share/url?url='+encodeURIComponent(url)+'&text='+encodeURIComponent(caption);
 const tg=getTelegramWebApp();
 if(tg?.openTelegramLink)tg.openTelegramLink(telegram);
 else window.open(telegram,'_blank','noopener,noreferrer');
 return true;
}
/** Reward explicit opening of the Telegram share picker, NOT unprovable message delivery. */
export async function claimDailyShare(task:DailyShareTask,userId:string):Promise<ShareReceipt>{
 if(task!=='monopoly'&&task!=='trials')throw new Error('daily_share_unavailable');
 let expected:string|null=null;
 if(task==='trials'){
  const snapshot=useGame.get();
  if(!await saveCloudSave(userId,snapshot)||useGame.get()!==snapshot)throw new Error('daily_share_reload_required');
  expected=saveTokens.get(userId)??null;
  if(!expected)throw new Error('daily_share_reload_required');
 }
 const {data,error}=await supabase.rpc('territory_daily_share_v1',{p_action:'claim',p_task:task,p_expected:expected});
 if(error)throw new Error(error.message);
 if(!object(data)||data.success!==true||data.task!==task||data.added!==2||
  typeof data.next_at!=='string'||!Number.isFinite(Date.parse(data.next_at)))throw new Error('daily_share_invalid_receipt');
 if(task==='trials'){
  useGame.set(acceptMonopolyClaimReceipt(userId,data));
 }else if(!Number.isSafeInteger(data.tickets)||data.tickets<0||data.tickets>20){
  throw new Error('daily_share_invalid_receipt');
 }
 return data as ShareReceipt;
}
export function shareError(e:unknown,en:boolean):string{
 const m=e instanceof Error?e.message:'';
 if(m.includes('daily_share_cooldown'))return en?'Already rewarded. Return after 24 hours.':'Награда получена. Возвращайся через 24 часа.';
 if(m.includes('daily_share_ticket_wallet_full'))return en?'Spend tickets first (20 maximum).':'Сначала потрать билеты (максимум 20).';
 if(m.includes('daily_share_reload_required'))return en?'Save changed. Reopen the game and retry.':'Сохранение изменилось. Открой игру заново.';
 if(m.includes('daily_share_no_bot'))return en?'Telegram invitation temporarily unavailable.':'Сейчас не удалось получить ссылку на бота.';
 if(m.includes('daily_share_verified_telegram_required'))return en?'Open from your verified Telegram account.':'Зайди через привязанный Telegram.';
 return en?'Unable to collect reward. Try later.':'Не удалось получить награду. Попробуй позже.';
}
