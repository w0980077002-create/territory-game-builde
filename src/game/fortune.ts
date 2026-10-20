import { refreshFortuneVip } from './fortuneVip';
import { HALL_TICKET_MAX } from './gameHall';
import { supabase } from './supabase';
import { useAccount, useGame } from './actions';
import { acceptMonopolyClaimReceipt, protectFortuneSave, saveCloudSave, saveTokens } from './cloud';

export const FORTUNE_PRIZES = [
 {prize:'gold',quantity:100,weight:3000,ru:'100 золота',en:'100 gold',icon:'gold-coin.webp'},
 {prize:'gems',quantity:1,weight:1400,ru:'1 синий самоцвет',en:'1 blue gem',icon:'blue-gem.webp'},
 {prize:'gems',quantity:3,weight:800,ru:'3 синих самоцвета',en:'3 blue gems',icon:'blue-gem.webp'},
 {prize:'gems',quantity:5,weight:200,ru:'5 синих самоцветов',en:'5 blue gems',icon:'blue-gem.webp'},
 {prize:'potion',quantity:1,weight:1800,ru:'Зелье здоровья',en:'Health potion',icon:'potion-hp.webp'},
 {prize:'elixir',quantity:1,weight:800,ru:'Эликсир силы',en:'Elixir of Strength',icon:'elixir-attack.webp'},
 {prize:'stone',quantity:1,weight:1000,ru:'Боевой камень',en:'Battle stone',icon:'battle-stone.webp'},
 {prize:'common',quantity:1,weight:700,ru:'Обычный сундук',en:'Common chest',symbol:'🧰',icon:'fortune/common-chest.svg'},
 {prize:'rare',quantity:1,weight:200,ru:'Редкий сундук',en:'Rare chest',symbol:'🎁',icon:'fortune/rare-chest.svg'},
 {prize:'golden_key',quantity:1,weight:50,ru:'Золотой ключ',en:'Golden Treasury Key',symbol:'🗝️',icon:'fortune/golden-key.svg'},
 {prize:'vip',quantity:1,weight:45,ru:'VIP на 1 день',en:'VIP for 1 day',symbol:'👑',icon:'fortune/vip-crown.svg'},
 {prize:'level',quantity:1,weight:5,ru:'+1 уровень',en:'+1 full level',icon:'item-helmet.webp'},
] as const;
export type FortuneAction='spin'|'common'|'rare'|'golden';
export type FortuneReceipt={id:string;action:FortuneAction;prize:string;quantity:number;refunded:boolean};
export type FortuneStatus={tickets:number;common:number;rare:number;golden_key:number;vip_until:string|null;server_now:string;vip:number;receipt:FortuneReceipt|null};
const inflight=new Map<string,Promise<FortuneStatus>>();
const storageKey=(userId:string)=>`territory.fortune.pending.${userId}`;
type Pending={action:FortuneAction;key:string;expected:string};
function pending(userId:string):Pending|null{
 const raw=localStorage.getItem(storageKey(userId));
 if(!raw)return null;
 const data=JSON.parse(raw) as Pending;
 if(!['spin','common','rare','golden'].includes(data.action)||!data.key||!data.expected)throw new Error('fortune_reload_required');
 return data;
}
async function call(action:string,key?:string,expected?:string):Promise<FortuneStatus & Record<string,unknown>>{
 const {data,error}=await supabase.rpc('territory_fortune_v1',{p_action:action,p_key:key??null,p_expected:expected??null});
 if(error)throw Object.assign(new Error(error.message),{rejected:/^[0-9A-Z]{5}$|^PGRST/.test(error.code??'')});
 const r=data?.receipt;
 const validReceipt=r===null||(r&&/^[a-f0-9-]{36}$/i.test(r.id)&&
  ['spin','common','rare','golden'].includes(r.action)&&typeof r.refunded==='boolean'&&
  Number.isSafeInteger(r.quantity)&&r.quantity>0&&
  (r.action==='spin'?FORTUNE_PRIZES.some(p=>p.prize===r.prize&&p.quantity===r.quantity):
   ['gold','gems','potion','elixir','stone','materials'].includes(r.prize)&&r.quantity<=100)&&
  (!r.refunded||(r.action==='spin'&&r.prize==='level')));
 if(!data||data.success!==true||!['tickets','common','rare','golden_key','vip'].every(k=>Number.isSafeInteger(data[k])&&data[k]>=0)||
  data.tickets>HALL_TICKET_MAX||data.vip>10||!validReceipt||
  !(data.vip_until===null||Number.isFinite(Date.parse(data.vip_until)))||
  !Number.isFinite(Date.parse(data.server_now)))throw new Error('fortune_invalid_receipt');
 return data;
}
function install(userId:string,data:FortuneStatus & Record<string,unknown>){
 useGame.set(acceptMonopolyClaimReceipt(userId,data));
 useAccount.set({vip:data.vip});
 void refreshFortuneVip();
}
function exclusive(userId:string,run:()=>Promise<FortuneStatus>):Promise<FortuneStatus>{
 const active=inflight.get(userId);if(active)return active;
 const task=run();inflight.set(userId,task);
 void task.finally(()=>{if(inflight.get(userId)===task)inflight.delete(userId);}).catch(()=>{});
 return task;
}
async function submitPending(userId:string,old:Pending,recover:boolean):Promise<FortuneStatus>{
 protectFortuneSave(userId);
 try{
  const data=await call(old.action,old.key,old.expected);
  install(userId,data);localStorage.removeItem(storageKey(userId));return data;
 }catch(error){
  if((error as {rejected?:boolean}).rejected){
   // A PostgreSQL error proves the transaction rolled back. Reconcile the
   // latest snapshot before removing the pending marker or enabling saves.
   const current=await call('status');install(userId,current);
   localStorage.removeItem(storageKey(userId));
   if(recover)return current;
  }
  throw error;
 }
}
export function recoverFortune(userId:string):Promise<FortuneStatus>{
 return exclusive(userId,async()=>{
  const old=pending(userId);
  if(old){
   return submitPending(userId,old,true);
  }
  const data=await call('status');
  if(data.receipt){protectFortuneSave(userId);install(userId,data);}
  return data;
 });
}
export function playFortune(userId:string,action:FortuneAction):Promise<FortuneStatus>{
 return exclusive(userId,async()=>{
  if(pending(userId))throw new Error('fortune_recover_required');
  const snapshot=useGame.get();
  if(!await saveCloudSave(userId,snapshot)||useGame.get()!==snapshot)throw new Error('fortune_reload_required');
  const expected=saveTokens.get(userId);if(!expected)throw new Error('fortune_reload_required');
  const key=crypto.randomUUID();
  // Only the operation identifier is local. Balances and rewards are server-owned.
  localStorage.setItem(storageKey(userId),JSON.stringify({action,key,expected}));
  return submitPending(userId,{action,key,expected},false);
 });
}
export async function acknowledgeFortune(userId:string,id:string):Promise<FortuneStatus>{
 return exclusive(userId,()=>call('ack',id));
}
export function fortuneIndex(receipt:FortuneReceipt):number {
 return FORTUNE_PRIZES.findIndex(p=>p.prize===receipt.prize&&p.quantity===receipt.quantity);
}
export function fortuneRotation(previous:number,index:number):number {
 const target=(360-index*30)%360;
 return previous+2160+((target-previous%360+360)%360);
}
export function fortuneLabel(r:FortuneReceipt,en:boolean):string{
 const exact=FORTUNE_PRIZES.find(p=>p.prize===r.prize&&p.quantity===r.quantity);
 if(exact)return en?exact.en:exact.ru;
 const names:Record<string,[string,string]>={gold:['золота','gold'],gems:['синих самоцветов','blue gems'],potion:['зелий здоровья','health potions'],elixir:['эликсиров силы','Elixirs of Strength'],stone:['боевых камней','battle stones'],materials:['материалов ковки','forge materials']};
 return `${r.quantity} ${names[r.prize]?.[en?1:0]??r.prize}`;
}

export function fortuneError(error:unknown,en:boolean):string {
 const message=error instanceof Error?error.message:'';
 if(message.includes('hall_no_tickets'))return en?'No tickets left. Collect your daily tickets in the Hall.':'Билеты закончились. Забери ежедневные билеты в зале.';
 if(message.includes('fortune_hall_active'))return en?'Finish the active Hall round first.':'Сначала заверши начатый раунд игрового зала.';
 if(message.includes('fortune_no_chest'))return en?'No chest or key available. Refresh your inventory.':'Сундук или ключ уже использован. Обнови инвентарь.';
 if(message.includes('reload'))return en?'Your save changed. Restart the app to load the latest progress.':'Сохранение изменилось. Перезапусти игру, чтобы загрузить актуальный прогресс.';
 return en?'Connection interrupted. Recover the existing operation before trying again.':'Связь прервана. Восстанови существующую операцию перед новой попыткой.';
}
