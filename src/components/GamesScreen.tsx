import { useEffect, useState } from 'react';
import { Dice5, Dices, Swords, Target, Gift, Ticket, Sparkles, Trophy, Coins, RefreshCw, Loader2, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { hallStatus, hallDaily, hallClaimGold, hallError, type HallGame, type HallState } from '@/game/gameHall';

interface GameCard {id:HallGame;ru:string;en:string;ruHint:string;enHint:string;icon:LucideIcon;gradient:string;accent:string;}
const GAMES:GameCard[]=[
 {id:'monopoly',ru:'Монополия',en:'Monopoly',ruHint:'Поле, кубик, призовые клетки',enHint:'Dice, board and prizes',icon:Dice5,gradient:'from-emerald-500/35 via-teal-900/35 to-[#111827]',accent:'text-emerald-200'},
 {id:'dice',ru:'Кости судьбы',en:'Dice of Fate',ruHint:'Выбери лучшую пару кубиков',enHint:'Pick the best dice pair',icon:Dices,gradient:'from-sky-500/35 via-blue-900/35 to-[#111827]',accent:'text-sky-200'},
 {id:'tower',ru:'Башня испытаний',en:'Trial Tower',ruHint:'Открой правильные ворота',enHint:'Choose the strongest gate',icon:Swords,gradient:'from-orange-500/35 via-amber-900/35 to-[#111827]',accent:'text-amber-200'},
 {id:'targets',ru:'Меткий стрелок',en:'Sharpshooter',ruHint:'Найди нужную мишень',enHint:'Find the right target',icon:Target,gradient:'from-rose-500/35 via-red-900/35 to-[#111827]',accent:'text-rose-200'},
 {id:'treasury',ru:'Сокровищница',en:'Treasury',ruHint:'Разгадай руны, открой сундук',enHint:'Solve the rune chest puzzle',icon:Gift,gradient:'from-violet-500/35 via-purple-900/35 to-[#111827]',accent:'text-violet-200'},
];
export function GamesScreen({onPlay,userId}:{onPlay:(id:HallGame)=>void;userId:string}){
 const {language}=useLanguage(); const en=language==='en';
 const [state,setState]=useState<HallState|null>(null);
 const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const refresh=async()=>{
  try{setState(await hallStatus());setError('');}
  catch(e){setError(hallError(e,en));}
  finally{setLoading(false);}
 };
 useEffect(()=>{void refresh();},[en]);
 const takeDaily=async()=>{
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{await hallDaily();setNotice(en?'2 free tickets collected!':'Получено 2 бесплатных билета!');await refresh();}
  catch(e){setError(hallError(e,en));}finally{setBusy(false);}
 };
 const claim=async()=>{
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{const amount=await hallClaimGold(userId);setNotice(en?('+'+amount+' gold added to your hero!'):('+'+amount+' золота зачислено герою!'));await refresh();}
  catch(e){setError(hallError(e,en));}finally{setBusy(false);}
 };
 return <div className="space-y-3 animate-fade-in pb-5" data-testid="game-hall">
  <section className="relative overflow-hidden rounded-2xl border border-amber-400/45 bg-gradient-to-br from-[#4a2a4b] via-[#221630] to-[#101928] p-4">
   <Sparkles className="absolute -right-7 -top-5 opacity-10 text-amber-200" size={130}/>
   <p className="text-[11px] font-black tracking-widest uppercase text-amber-300">{en?'TERRITORY • GAME HALL':'TERRITORY • ИГРОВОЙ ЗАЛ'}</p>
   <h2 className="text-2xl font-black text-white mt-1">{en?'5 adventures. One ticket wallet.':'5 игр. Один кошелёк билетов.'}</h2>
   <p className="text-xs text-gray-300 mt-1">{en?'Play for earned tickets, collect points and gold rewards.':'Играй за бесплатные билеты, собирай очки и золотые награды.'}</p>
   <div className="grid grid-cols-3 gap-2 mt-4">
    <div className="rounded-xl bg-black/30 border border-amber-400/35 p-2.5 text-center">
     <Ticket className="text-amber-300 mx-auto" size={21}/>
     <strong className="text-xl text-white block tabular-nums">{loading?'…':state?.tickets??'—'}</strong>
     <span className="text-[11px] text-amber-100">{en?'Tickets':'Билеты'}</span>
    </div>
    <div className="rounded-xl bg-black/30 border border-violet-400/30 p-2.5 text-center">
     <Trophy className="text-violet-300 mx-auto" size={21}/>
     <strong className="text-xl text-white block tabular-nums">{loading?'…':state?.points??'—'}</strong>
     <span className="text-[11px] text-purple-100">{en?'Hall points':'Очки зала'}</span>
    </div>
    <div className="rounded-xl bg-black/30 border border-emerald-400/25 p-2.5 text-center">
     <Coins className="text-amber-300 mx-auto" size={21}/>
     <strong className="text-xl text-white block tabular-nums">{loading?'…':state?.pending_gold??'—'}</strong>
     <span className="text-[11px] text-amber-100">{en?'Gold to claim':'Золота забрать'}</span>
    </div>
   </div>
   <div className="grid grid-cols-2 gap-2 mt-3">
    <button type="button" disabled={busy||loading||!state?.free_ready} onClick={()=>void takeDaily()}
     className="rounded-xl border border-emerald-300/45 bg-gradient-to-b from-emerald-500/40 to-emerald-950/45 py-3 px-1 text-sm font-bold text-emerald-100 disabled:opacity-40 flex gap-1 justify-center items-center">
      {busy?<Loader2 size={17} className="animate-spin"/>:<Gift size={18}/>}
      {en?'Free +2 tickets':'Бесплатно +2 🎟️'}
    </button>
    <button type="button" disabled={busy||loading||!state||state.pending_gold<1} onClick={()=>void claim()}
     className="rounded-xl border border-amber-300/45 bg-gradient-to-b from-amber-500/45 to-amber-950/55 py-3 px-1 text-sm font-bold text-amber-100 disabled:opacity-40 flex gap-1 justify-center items-center">
      <Coins size={18}/>{en?'Claim gold':'Забрать золото'}
    </button>
   </div>
   <p className="text-[11px] text-violet-100/75 mt-2 text-center">{en?'1 ticket per game • daily gold cap: 1,000':'1 билет за игру • лимит выигрыша 1000 золота в сутки'}</p>
  </section>
  {state?.active && <button type="button" onClick={()=>onPlay(state.active!.game)} className="w-full rounded-xl border border-amber-400/60 bg-amber-900/40 text-amber-100 p-3 font-bold flex items-center gap-2 justify-center" data-testid="resume-hall">
    <RefreshCw size={18}/>{en?'Continue unfinished game':'Продолжить незавершённую игру'}
   </button>}
  <div className="grid grid-cols-2 gap-2.5">
   {GAMES.map((game,index)=>{
    const Icon=game.icon,featured=index===0,locked=game.id!=='monopoly'&&(!state||state.tickets<1);
    return <button key={game.id} type="button" onClick={()=>onPlay(state?.active?.game??game.id)}
      disabled={loading||!state || (locked&&!state.active)}
      data-testid={'hall-game-'+game.id}
      className={'relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br '+game.gradient+' p-3.5 text-left flex flex-col justify-between transition-transform active:scale-[.97] disabled:opacity-60 '+(featured?'col-span-2 h-32':'h-36')}>
      <div className="flex justify-between gap-2 items-start">
       <span className={'rounded-xl p-2.5 bg-black/25 border border-white/10 '+game.accent}><Icon size={featured?29:25}/></span>
       <span className="text-[10px] rounded-full bg-black/45 border border-amber-400/30 px-2 py-1 text-amber-100 flex items-center gap-1"><Ticket size={12}/>1</span>
      </div>
      <div>
       <h3 className={'font-black text-white '+(featured?'text-lg':'text-sm')}>{en?game.en:game.ru}</h3>
       <p className="text-[11px] text-gray-200/75 mt-0.5">{en?game.enHint:game.ruHint}</p>
      </div>
     </button>
   })}
  </div>
  <p className="text-xs text-gray-400 flex gap-2 items-start"><ShieldCheck size={17} className="shrink-0 text-emerald-300"/>
    {en?'Results, ticket use and gold payouts are verified by the game server. No red-diamond ticket purchases.':'Результаты, билеты и золото проверяет сервер. Покупки билетов за красные алмазы нет.'}
  </p>
  {notice&&<p className="text-sm rounded-xl border border-emerald-500/35 bg-emerald-950/30 p-3 text-emerald-200" role="status">{notice}</p>}
  {error&&<div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-rose-200 text-sm" role="alert">{error}<button onClick={()=>void refresh()} className="ml-2 underline">{en?'Retry':'Повторить'}</button></div>}
 </div>;
}
