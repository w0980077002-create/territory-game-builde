import { WheelOfFortune } from './WheelOfFortune';
import { TreasuryInventory } from './TreasuryInventory';
import { lazy, Suspense, useEffect, useState } from 'react';
const VikingSlots = lazy(() => import('./VikingSlots').then(m => ({default: m.VikingSlots})));
import { MonopolyAdventure } from './monopoly/MonopolyAdventure';
import { ArrowLeft, Coins, Dice5, Dices, DoorOpen, Gift, Loader2, RefreshCw, ShieldCheck, Target, Ticket, Trophy } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { captureGameEvent } from '@/game/analytics';
import { hallStatus, hallStart, hallFinish, autoClaimHallGold, hallError, type HallGame, type HallSession, type HallState, type HallResult } from '@/game/gameHall';

const names:Record<HallGame,[string,string]>={
 monopoly:['Монополия','Monopoly'],dice:['Кости судьбы','Dice of Fate'],
 tower:['Башня испытаний','Trial Tower'],targets:['Меткий стрелок','Sharpshooter'],
 treasury:['Сокровищница','Treasury'],wheel:['Колесо фортуны','Wheel of Fortune'],
 slots:['Сокровища викингов','Viking Treasures'],
};
const icons:Record<HallGame,typeof Dice5>={
 monopoly:Dice5,dice:Dices,tower:DoorOpen,targets:Target,treasury:Gift,wheel:Gift,slots:Trophy,
};
function cellPos(i:number):{row:number;col:number}{
 const side=7;
 if(i<side)return{row:0,col:i};
 i-=side;if(i<side)return{row:i,col:side};
 i-=side;if(i<side)return{row:side,col:side-i};
 i-=side;return{row:side-i,col:0};
}
function MonopolyBoard({session}:{session:HallSession}){
 const q=session.question;const cells=Array.from({length:28},(_,i)=>i);
 return <div className="w-full aspect-square max-w-[410px] mx-auto relative rounded-[28px] border-2 border-emerald-500/35 bg-gradient-to-br from-[#091c27] via-[#211448] to-[#071c18] overflow-hidden shadow-[inset_0_0_35px_#a855f720]">
  {cells.map(i=>{
   const p=cellPos(i),landed=i===q.new_position;
   return <div key={i} className="absolute flex items-center justify-center p-[1.3%]"
     style={{left:(p.col*12.5)+'%',top:(p.row*12.5)+'%',width:'12.5%',height:'12.5%'}}>
    <span className={'w-full h-full rounded-lg border text-center flex items-center justify-center text-xs sm:text-base '+(landed?
      'border-amber-300 bg-amber-500/45 ring-2 ring-amber-300 text-white shadow-[0_0_16px_#fbbf24]':
      i%5===0?'border-violet-300/55 bg-violet-600/20 text-violet-200':
      'border-emerald-300/40 bg-teal-600/10 text-emerald-200/80')}>
      {i===0?'🏰':landed?'🏆':i%5===0?'❔':i%3===0?'💰':'✦'}
    </span>
   </div>;
  })}
  <div className="absolute inset-[17%] flex flex-col items-center justify-center gap-2 rounded-full border border-fuchsia-400/25 bg-gradient-to-br from-violet-800/30 to-black/20">
   <Dice5 size={45} className="text-fuchsia-200 drop-shadow-[0_0_10px_#e879f9]"/>
   <p className="text-xs text-violet-200">TERRITORY</p>
   <strong className="text-3xl font-black text-white">{q.roll}</strong>
   <p className="text-[11px] text-emerald-100">{(q.old_position??0)+1} → {(q.new_position??0)+1}</p>
  </div>
 </div>;
}
function Question({session,onPick,busy,en}:{session:HallSession;onPick:(i:number)=>void;busy:boolean;en:boolean}){
 const game=session.game,q=session.question;
 if(game==='monopoly')return <div className="space-y-3">
  <MonopolyBoard session={session}/>
  <p className="text-center text-xs text-violet-100">{en?'The server rolled your dice. Take the board prize!':'Сервер бросил кубик. Забери награду призовой клетки!'}</p>
  <button className="btn-primary w-full py-3.5 font-black" disabled={busy} onClick={()=>onPick(0)}>{en?'COLLECT BOARD PRIZE':'ЗАБРАТЬ ПРИЗ'}</button>
 </div>;
 const nums=game==='dice'?q.options:game==='tower'?q.doors:game==='targets'?q.targets:q.chests;
 if(!Array.isArray(nums)||nums.length!==3)return <p className="text-amber-300">{en?'Invalid server puzzle. Return to hall.':'Ошибка задания. Вернись в игровой зал.'}</p>;
 const title=game==='dice'?
 (en?'Which pair is closest to 7?':'Какая пара ближе всего к 7?'):
 game==='tower'?(en?'Choose the strongest gate':'Выбери самые сильные ворота'):
 game==='targets'?(en?'Hit the middle-number target':'Попади в мишень со средним числом'):
 (en?'Which chest equals the sum of runes?':'Какой сундук равен сумме рун?');
 const prefix=game==='dice'?['🎲 1+2','🎲 2+3','🎲 1+3']:
   game==='tower'?['🚪 I','🚪 II','🚪 III']:
   game==='targets'?['🎯 1','🎯 2','🎯 3']:['🗝️ 1','🗝️ 2','🗝️ 3'];
 return <div className="space-y-4">
  <h3 className="text-lg text-amber-100 text-center font-black">{title}</h3>
  {game==='dice' && <p className="text-center text-xl font-black text-sky-200 tracking-widest">
     🎲 {(q.dice??[]).join('  ·  ')}
    </p>}
  {game==='treasury' && <div className="rounded-xl bg-violet-950/45 border border-violet-300/30 py-3 text-center text-2xl font-black text-fuchsia-200">
   ✨ {(q.runes??[]).join(' + ')} = ?
  </div>}
  {game==='tower' && <p className="text-center text-xs text-gray-300">{en?'Only the strongest gate opens the tower.':'Только самые сильные ворота откроют башню.'}</p>}
  {game==='targets' && <p className="text-center text-xs text-gray-300">{en?'One shot. Pick the value between the other two.':'Один выстрел. Выбери число между двумя другими.'}</p>}
  <div className="grid grid-cols-3 gap-2">
   {nums.map((value,i)=><button type="button" key={i} disabled={busy} onClick={()=>onPick(i)}
     className={'rounded-2xl p-3.5 h-32 flex flex-col justify-center items-center gap-2 font-black border-2 transition-transform active:scale-95 disabled:opacity-50 '+
     (game==='treasury'?'bg-gradient-to-b from-amber-800/50 to-violet-950 border-amber-400/45 text-amber-200':
     game==='tower'?'bg-gradient-to-b from-orange-700/40 to-slate-900 border-amber-400/45 text-orange-200':
     game==='targets'?'bg-gradient-to-b from-rose-700/45 to-slate-900 border-rose-400/50 text-rose-200':
     'bg-gradient-to-b from-sky-700/45 to-slate-900 border-sky-400/50 text-sky-200')}>
      <span className="text-xs">{prefix[i]}</span><span className="text-3xl">{value}</span>
    </button>)}
  </div>
  {game==='dice'&&<p className="text-[11px] text-gray-400 text-center">{en?'If tied, choose the pair on the left.':'При равенстве выбирай крайнюю левую пару.'}</p>}
 </div>;
}
function HallOtherPlayScreen({game,onBack,userId}:{game:HallGame;onBack:()=>void;userId:string}){
 const {language}=useLanguage();const en=language==='en',Icon=icons[game];
 const [session,setSession]=useState<HallSession|null>(null);
 const [wallet,setWallet]=useState<HallState|null>(null);
 const [result,setResult]=useState<HallResult|null>(null);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [payoutState,setPayoutState]=useState<'credited'|'pending'|null>(null);
 const init=async()=>{
  try{
   const status=await hallStatus();
   setWallet(status);if(status.active)setSession(status.active);
   setError('');
  }catch(e){setError(hallError(e,en));}
  finally{setLoading(false);}
 };
 useEffect(()=>{void init();},[game,en]);
 const start=async()=>{
  if(busy)return;setBusy(true);setError('');setResult(null);
  try{const data=await hallStart(game);captureGameEvent('territory_hall_round_start', { mode: game });setSession(data);setPayoutState(null);setWallet(await hallStatus());}
  catch(e){setError(hallError(e,en));}
  finally{setBusy(false);}
 };
 const finish=async(answer:number)=>{
  if(busy||!session)return;
  setBusy(true);setError('');
  try{
   const prize=await hallFinish(session,answer);
   captureGameEvent('territory_hall_round_end', { mode: game, outcome: prize.won ? 'won' : 'lost' });
   setResult(prize);
   setSession(null);
   if(prize.earned_gold>0){
     try{
       await autoClaimHallGold(userId,prize.earned_gold);
       setPayoutState('credited');
     }catch{
       // The round is already settled; the gold stays pending on the server.
       // Opening the Game Hall retries it without charging another ticket.
       setPayoutState('pending');
     }
   }else setPayoutState(null);
   setWallet(await hallStatus());
  }catch(e){setError(hallError(e,en));}
  finally{setBusy(false);}
 };
 return <div className="space-y-3 animate-fade-in pb-5" data-testid={'hall-play-'+game}>
  <button onClick={onBack} className="flex items-center gap-2 text-amber-100 font-bold text-sm rounded-xl bg-white/5 border border-white/15 p-2.5">
   <ArrowLeft size={18}/>{en?'Game Hall':'Игровой зал'}
  </button>
  <section className="relative overflow-hidden rounded-2xl border border-amber-400/45 bg-gradient-to-br from-[#432444] via-[#231638] to-[#0b1823] p-4">
   <div className="flex items-center justify-between">
    <div className="flex items-center gap-2 min-w-0"><span className="rounded-xl bg-violet-500/20 border border-violet-200/30 p-2.5"><Icon size={27} className="text-amber-200"/></span>
     <div><p className="text-xs uppercase tracking-wider text-amber-300 font-bold">TERRITORY</p>
      <h2 className="font-black text-xl text-white">{names[game][en?1:0]}</h2>
     </div></div>
    <div className="text-amber-100 border border-amber-400/35 bg-black/30 rounded-xl px-3 py-2 text-center">
     <Ticket size={18} className="mx-auto text-amber-300"/>
     <strong className="text-lg">{wallet?.tickets??'—'}</strong>
    </div>
   </div>
  </section>
  {game==='treasury'&&<TreasuryInventory userId={userId}/>}
  {loading?<p className="text-sm text-gray-400 text-center py-8"><Loader2 className="animate-spin inline mr-2" size={17}/>{en?'Loading game…':'Загрузка игры…'}</p>:
   result?<section className={'rounded-2xl border text-center p-5 space-y-3 '+(result.won?'border-emerald-400/40 bg-emerald-950/25':'border-rose-400/35 bg-rose-950/20')}>
    <Trophy size={45} className={'mx-auto '+(result.won?'text-amber-300':'text-gray-500')}/>
    <h3 className="text-xl font-black text-white">{result.won?(en?'Victory!':'Победа!'):(en?'Try another round!':'Попробуй ещё!')}</h3>
    <p className="font-black text-lg text-amber-200">{result.won?'+'+result.earned_gold+' 🪙':'0 🪙'}</p>
    {result.earned_gold>0&&<p className="text-xs text-gray-300">{payoutState==='credited'
      ? (en?'Gold has been credited to your hero automatically.':'Золото автоматически зачислено персонажу.')
      : payoutState==='pending'
        ? (en?'Gold is saved. It will be credited automatically when you return to the hall.':'Золото сохранено. Начисление повторится автоматически при возвращении в зал.')
        : (en?'Crediting gold…':'Зачисляем золото…')}</p>}
    <div className="grid grid-cols-2 gap-2">
     <button type="button" onClick={onBack} disabled={busy} className="rounded-xl bg-white/10 border border-white/20 text-amber-100 py-3 font-bold disabled:opacity-50">{en?'To hall':'В зал'}</button>
     <button type="button" disabled={busy||!wallet?.tickets} onClick={()=>void start()} className="btn-primary py-3 font-bold disabled:opacity-40">{en?'Play again':'Ещё раз'}</button>
    </div>
   </section>:
   session && session.game!==game?
    <div className="rounded-xl border border-amber-500/35 p-4 bg-amber-950/20 text-amber-200 text-sm">{en?'Another game is in progress. Return to the hall to continue it.':'У тебя уже начат другой раунд. Вернись в зал и заверши его.'}</div>:
   session ? <section className="rounded-2xl border border-violet-300/25 bg-gradient-to-b from-violet-950/35 to-[#161b28] p-3.5 space-y-3">
     <Question session={session} onPick={finish} busy={busy} en={en}/>
     <p className="flex items-center justify-center gap-1 text-[11px] text-gray-400"><ShieldCheck size={14}/>{en?'Result validated by the server':'Результат проверяет сервер'}</p>
    </section>:
    <section className="rounded-2xl border border-violet-400/25 bg-gradient-to-b from-violet-950/35 to-[#151a28] p-5 text-center space-y-4">
     <Icon size={58} className="mx-auto text-amber-300 drop-shadow-[0_0_13px_#fbbf24]"/>
     <p className="text-gray-200 text-sm">{en?'One ticket opens a round. Complete the challenge to win gold.':'Один билет открывает раунд. Выполни задание, чтобы выиграть золото.'}</p>
     <button disabled={busy||!wallet?.tickets} onClick={()=>void start()} className="btn-primary w-full py-3.5 font-black flex items-center gap-2 justify-center disabled:opacity-40">
      {busy?<Loader2 size={19} className="animate-spin"/>:<Ticket size={19}/>}
      {en?'START — 1 TICKET':'НАЧАТЬ — 1 БИЛЕТ'}
     </button>
     {!wallet?.tickets && <p className="text-xs text-amber-200">{en?'No tickets. Claim your daily tickets in the hall.':'Нет билетов. Забери ежедневные в игровом зале.'}</p>}
    </section>}
  {error&&<div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200" role="alert">{error}
   <button type="button" onClick={()=>void init()} className="ml-2 underline flex-inline items-center"><RefreshCw className="inline" size={14}/>{en?'Refresh':'Обновить'}</button></div>}
 </div>;
}

export function HallPlayScreen({game,onBack,userId}:{game:HallGame;onBack:()=>void;userId:string}){
 if(game==='wheel')return <WheelOfFortune userId={userId} onBack={onBack}/>;
 if(game==='slots')return <Suspense fallback={<div className="p-4 text-amber-200">Загружаем автомат…</div>}><VikingSlots key={userId} userId={userId} onBack={onBack}/></Suspense>;
 return game==='monopoly'?<MonopolyAdventure onBack={onBack} userId={userId}/>:<HallOtherPlayScreen game={game} onBack={onBack} userId={userId}/>;
}
