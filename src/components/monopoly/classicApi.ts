import { supabase } from '@/game/supabase';

export type ClassicPlayer = {
 seat:number;name:string;bot:boolean;cash:number;position:number;bankrupt:boolean;mine:boolean;
};
export type ClassicProperty = {cell:number;owner:number;houses:number;price:number;rent:number};
export type ClassicRoom = {
 id:string;code:string;mode:'solo'|'online';seats:number;
 state:'lobby'|'playing'|'finished'|'cancelled';turn:number;phase:'roll'|'buy';
 turns:number;landed:number|null;last_roll:number|null;winner:number|null;
 last_event:string;updated_at:string;host:boolean;my_seat:number;
};
export type ClassicData = {
 tickets:number;room:ClassicRoom|null;players?:ClassicPlayer[];properties?:ClassicProperty[];
};

export const classicCellPrice=(cell:number)=>cell<=0||cell>=28||[7,14,21].includes(cell)?0:60+8*cell;
export const classicRent=(cell:number,houses=0)=>Math.floor(classicCellPrice(cell)*16/100)*(1+Math.min(3,Math.max(0,houses))*2);
export const classicBoardPoint=(index:number)=>{
 const corners=[[50,92],[7,50],[50,8],[93,50],[50,92]];
 const edge=Math.floor(index/7),ratio=(index%7)/7;
 return {x:corners[edge][0]+(corners[edge+1][0]-corners[edge][0])*ratio,
  y:corners[edge][1]+(corners[edge+1][1]-corners[edge][1])*ratio};
};
export const classicColor=(seat:number)=>['#ffce66','#59edc5','#f77edb','#92baff'][seat%4];
export async function classic(action='status',code:string|null=null,choice:number|null=null):Promise<ClassicData>{
 const {data,error}=await supabase.rpc('territory_monopoly_classic_v1',{
  p_action:action,p_code:code,p_choice:choice,
 });
 if(error)throw new Error(error.message);
 if(!data||!Number.isSafeInteger(data.tickets)||data.tickets<0||data.tickets>1000||
  !('room' in data))throw new Error('mono_bad_reply');
 if(data.room){
  if(!/^[A-F0-9]{6}$/.test(data.room.code)||!['lobby','playing','finished','cancelled'].includes(data.room.state)
   ||!Array.isArray(data.players)||!Array.isArray(data.properties)||data.players.length>4
   ||data.properties.length>24)throw new Error('mono_bad_reply');
 }
 return data as ClassicData;
}
export function classicError(value:unknown,en:boolean):string{
 const msg=value instanceof Error?value.message:'';
 const dict:[string,string,string][]=[
  ['hall_no_tickets','Нет билетов. Забери бесплатные в игровом зале.','No tickets. Collect free tickets in the Game Hall.'],
  ['mono_already_playing','У тебя уже есть партия. Продолжи её или заверши.','You have an active match. Resume or finish it.'],
  ['mono_other_hall_round','Сначала закончи предыдущий раунд другой игры.','Finish your other Hall round first.'],
  ['mono_room_not_found','Комната не найдена или игра уже началась.','Room not found or the game has already started.'],
  ['mono_room_full','Все места заняты.','All seats are taken.'],
  ['mono_need_two_players','Нужно хотя бы два игрока.','At least two players are required.'],
  ['mono_not_your_turn','Сейчас ход другого игрока.','Wait for your turn.'],
  ['mono_not_buy_phase','Этот участок уже недоступен для покупки.','This property cannot be purchased now.'],
  ['mono_insufficient_cash','Не хватает монет этой партии.','Not enough match coins.'],
  ['mono_cannot_build','Сейчас нельзя построить дом.','You cannot build a house now.'],
  ['mono_resign_required','Чтобы выйти из партии, нажми «Сдаться».','To leave this match, tap Resign.'],
  ['mono_no_active_room','Активная партия не найдена.','No active match was found.'],
  ['mono_room_access_denied','Нет доступа к этой партии.','You cannot access this match.'],
  ['mono_invalid_code','Код комнаты состоит из шести символов.','Room code must contain six characters.'],
 ];
 for(const [key,ru,eng] of dict)if(msg.includes(key))return en?eng:ru;
 return en?'Could not reach the game server. Try again.':'Ошибка связи с сервером игры. Попробуй снова.';
}
