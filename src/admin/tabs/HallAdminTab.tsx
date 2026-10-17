import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Ticket,Gift,RefreshCw,Activity,ShieldCheck} from 'lucide-react';
import {adminCall,type PlayerSummary} from '@/admin/api';
import {Panel,Loading,Empty,ErrorLine,fmt,fmtDate,inputCls,type Confirm} from '@/admin/ui';
type Scope='one'|'active'|'all';
interface HallOverview{
 wallets:number;tickets:number;games:number;wins:number;pendingGold:number;activeSessions:number;
 recent:{name:string;game:string;won:boolean;gold:number;at:string}[];
}
interface HallAccount {
 tickets:number;played:number;wins:number;points:number;pendingGold:number;claimedGold:number;
 activeGame:string|null;activeSince:string|null;
}
const GAMES:Record<string,string>={monopoly:'Монополия',dice:'Кости судьбы',tower:'Башня',
 targets:'Стрелок',treasury:'Сокровищница'};
export function HallAdminTab({confirm}:{confirm:Confirm}){
 const [stats,setStats]=useState<HallOverview|null>(null),[error,setError]=useState<string|null>(null);
 const [query,setQuery]=useState(''),[players,setPlayers]=useState<PlayerSummary[]>([]);
 const [selected,setSelected]=useState<PlayerSummary|null>(null),[wallet,setWallet]=useState<HallAccount|null>(null);
 const [scope,setScope]=useState<Scope>('one');
 const [amount,setAmount]=useState('20'),[reason,setReason]=useState('Тестирование игрового зала');
 const [searching,setSearching]=useState(false);
 const refresh=useCallback(async()=>{
   try{setStats(await adminCall<HallOverview>('hall_stats'));setError(null)}
   catch(e){setError((e as Error).message)}
 },[]);
 const readWallet=useCallback(async(id:string)=>{
   try{setWallet(await adminCall<HallAccount>('hall_player',{playerId:id}));}
   catch(e){setError((e as Error).message)}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 const search=async()=>{if(!query.trim())return;
  setSearching(true);setError(null);setSelected(null);setWallet(null);
  try{
   const result=await adminCall<{players:PlayerSummary[]}>('search',{query:query.trim()});
   setPlayers(result.players);
   if(result.players.length===1){setSelected(result.players[0]);setWallet(null);void readWallet(result.players[0].id);}
  }catch(e){setError((e as Error).message);}finally{setSearching(false);}
 };
 const submit=(e:FormEvent)=>{
  e.preventDefault();
  const count=Number(amount),note=reason.trim();
  if(!Number.isSafeInteger(count)||count===0||Math.abs(count)>250)
    return setError('Введи целое количество от −250 до 250, кроме нуля.');
  if(note.length<3||note.length>140)return setError('Укажи причину (от 3 до 140 символов).');
  if(scope==='one'&&!selected)return setError('Сначала выбери игрока.');
  setError(null);
  const who=scope==='one'?selected!.name:scope==='all'?'ВСЕ незаблокированные игроки':'все активные игроки за 7 дней';
  confirm((count>0?'Выдать ':'Списать ')+fmt(Math.abs(count))+' билетов: '+who+
    '\nПричина: '+note,async()=>{
      const result=await adminCall<{affected:number;balance:number|null;replayed:boolean}>('hall_grant',{
       scope,playerId:scope==='one'?selected!.id:null,amount:count,reason:note,
       requestId:crypto.randomUUID(),
      });
      await refresh();if(selected)await readWallet(selected.id);
      return 'Обновлены билеты: '+result.affected+' игрок(ов).'+
       (scope==='one'?' Теперь у игрока '+result.balance+' 🎟️':'');
    });
 };
 return <div className="space-y-4">
  <Panel title="Игровой зал · управление билетами" icon={<Ticket className="w-5 h-5"/>}
   right={<button type="button" onClick={()=>void refresh()} title="Обновить"><RefreshCw size={17}/></button>}>
   <p className="text-xs text-slate-400 mb-3">Билеты начисляются сразу на сервере. Не нужно ждать входа в игру или перезапускать админку.</p>
   {stats?<div className="grid grid-cols-3 gap-2">
    {([['Игроков',stats.wallets],['Билетов',stats.tickets],['Партий',stats.games],
     ['Побед',stats.wins],['В игре',stats.activeSessions],['Золото к выдаче',stats.pendingGold]] as const)
      .map(([name,value])=><div key={name} className="rounded-xl bg-slate-950/70 border border-slate-700/50 p-2.5">
      <strong className="text-lg font-bold text-white block">{fmt(Number(value))}</strong>
      <span className="text-[11px] text-slate-400">{name}</span>
     </div>)}
   </div>:<Loading/>}
  </Panel>
  <Panel title="Раздать / списать билеты" icon={<Gift size={17}/>}>
   <form onSubmit={submit} className="space-y-3">
    <label className="block text-xs text-slate-400">Кому
     <select className={inputCls+' mt-1'} value={scope} onChange={e=>setScope(e.target.value as Scope)}>
      <option value="one">Одному игроку</option>
      <option value="active">Активным за 7 дней</option>
      <option value="all">Всем игрокам без бана</option>
     </select>
    </label>
    {scope==='one'&&<div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-2.5 space-y-2">
     <div className="flex gap-2">
      <input className={inputCls} placeholder="Telegram ID, UUID или @ник"
       value={query} onChange={e=>{setQuery(e.target.value);setSelected(null);setWallet(null);}}/>
      <button type="button" disabled={searching} onClick={()=>void search()}
        className="h-11 px-3 rounded-xl bg-sky-600 text-sm font-bold disabled:opacity-50">Найти</button>
     </div>
     {players.length>1&&<div className="max-h-44 overflow-y-auto space-y-1">
      {players.map(p=><button type="button" key={p.id} onClick={()=>{setSelected(p);setWallet(null);void readWallet(p.id);}}
        className="w-full text-left rounded-lg bg-slate-800/70 px-2 py-2 text-xs">{p.name} · ур.{p.level} · TG {p.telegramId??'—'}</button>)}
     </div>}
     {selected&&<div className="rounded-xl border border-emerald-600/40 p-2.5 bg-emerald-900/15">
      <p className="text-xs font-bold text-emerald-200"><ShieldCheck size={14} className="inline mr-1"/>{selected.name} (TG {selected.telegramId??'нет'})</p>
      {wallet?<p className="text-sm mt-1 text-white">
        🎟️ {wallet.tickets} билетов · {wallet.played} игр · {wallet.wins} побед · {wallet.pendingGold} золота ожидает
       </p>:<p className="text-xs text-slate-400">Читаем баланс...</p>}
     </div>}
    </div>}
    <div className="grid grid-cols-2 gap-2">
     <label className="block text-xs text-slate-400">Билетов (+ / −)
      <input className={inputCls+' mt-1'} type="number" min={-250} max={250} step={1}
       value={amount} onChange={e=>setAmount(e.target.value)}/>
     </label>
     <div className="space-y-1 text-xs text-slate-400">
      <p>Быстрый выбор</p>
      <div className="grid grid-cols-3 gap-1">
       {[5,20,100].map(n=><button type="button" key={n} onClick={()=>setAmount(String(n))}
         className="rounded-lg border border-sky-600/50 bg-sky-800/25 text-white font-bold h-10">+{n}</button>)}
      </div>
     </div>
    </div>
    <label className="block text-xs text-slate-400">Причина
     <input className={inputCls+' mt-1'} maxLength={140} value={reason} onChange={e=>setReason(e.target.value)}
      placeholder="Например: тест турнира"/>
    </label>
    {scope!=='one'&&<p className="text-[11px] text-amber-300 bg-amber-950/20 p-2 rounded-lg border border-amber-700/30">
     Массовая выдача изменит билеты всех выбранных игроков. Подтверди действие внимательно.
    </p>}
    <button type="submit" className="h-12 w-full rounded-xl bg-gradient-to-b from-sky-500 to-sky-700 text-white font-bold text-sm flex items-center justify-center gap-2">
     <Ticket size={19}/> {Number(amount)<0?'Списать билеты':'Выдать билеты'}
    </button>
    <p className="text-[11px] text-slate-500">Лимит одной операции ±250, остаток 0–1000. Все операции фиксируются в журнале.</p>
   </form>
   <ErrorLine text={error}/>
  </Panel>
  <Panel title="Последние партии" icon={<Activity size={17}/>}>
   {!stats?<Loading/>:stats.recent?.length===0?<Empty text="Пока партий нет."/>:
    <div className="space-y-1.5">{stats.recent?.slice(0,15).map((x,i)=><div key={i}
     className="flex justify-between gap-2 border border-slate-800 rounded-lg p-2.5 bg-slate-950/40 text-xs">
     <div className="min-w-0">
      <p className="font-semibold text-white truncate">{x.name}</p>
      <p className="text-slate-400">{GAMES[x.game]??x.game} · {fmtDate(x.at)}</p>
     </div>
     <div className="text-right shrink-0">
      <p className={x.won?'text-emerald-300':'text-slate-400'}>{x.won?'Победа':'Проигрыш'}</p>
      <p className="text-amber-300">+{x.gold} 🪙</p>
     </div>
    </div>)}</div>}
  </Panel>
 </div>;
}
