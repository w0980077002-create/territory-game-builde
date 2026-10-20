import { useEffect, useState } from 'react';
import { Megaphone, Send, Clock3, Ticket, Gem, Loader2 } from 'lucide-react';
import { useLanguage } from './i18n';
import { claimDailyShare, dailyShareStatus, prepareDailyShareLink, shareDailyPromo, shareError, type DailyShareTask, type ShareStatus } from './dailyShare';

export function DailyShareCard({task,userId,onClaimed}:{task:DailyShareTask;userId:string;onClaimed?:()=>void}){
 const {language}=useLanguage(),en=language==='en';
 const [status,setStatus]=useState<ShareStatus|null>(null),[url,setUrl]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[now,setNow]=useState(Date.now());
 const refresh=async()=>{try{setStatus(await dailyShareStatus());}catch(e){setError(shareError(e,en));}};
 useEffect(()=>{
  let alive=true;
  void Promise.all([dailyShareStatus(),prepareDailyShareLink(en?'en':'ru')]).then(([state,link])=>{
   if(alive){setStatus(state);setUrl(link);setError('');}
  }).catch(e=>{if(alive)setError(shareError(e,en));});
  const timer=window.setInterval(()=>setNow(Date.now()),15000);
  const resume=()=>{if(!document.hidden)void refresh();};
  document.addEventListener('visibilitychange',resume);
  return()=>{alive=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',resume);};
 },[task,en]);
 const entry=status?.tasks.find(t=>t.task===task);
 const remaining=entry?.next_at?Math.max(0,Date.parse(entry.next_at)-now):0;
 const full=task==='monopoly'&&(status?.tickets??0)>18;
 const ready=!!entry?.enabled&&(!!entry.ready||(entry.next_at!==null&&remaining===0))&&!full;
 const share=()=>{
  if(!ready||!url||busy)return;
  setBusy(true);setError('');setNotice('');
  // Attempt to open the Telegram picker synchronously on the user click.
  // Only then request the reward, so invalid links never award tickets/stones.
  let opened=false;
  try{opened=shareDailyPromo(url,en?'en':'ru');}catch{opened=false;}
  if(!opened){setBusy(false);setError(en?'Cannot open Telegram':'Не удалось открыть Telegram');return;}
  void claimDailyShare(task,userId).then(async()=>{
   setNotice(en?'+2 reward credited!':'Награда +2 зачислена!');
   onClaimed?.();
   try{setStatus(await dailyShareStatus());}catch{/* Credited reward remains safe. */}
  }).catch(e=>setError(shareError(e,en))).finally(()=>setBusy(false));
 };
 return <article data-testid={'daily-share-'+task} className="rounded-xl border border-amber-500/50 bg-gradient-to-br from-[#4c3121] via-[#273c49] to-[#102a3f] p-3 shadow-lg">
  <div className="flex items-center gap-3">
   <div className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl border border-amber-400/60 bg-amber-800/40"><Megaphone size={23} className="text-amber-200"/></div>
   <div className="flex-1 min-w-0"><h4 className="text-sm font-black text-amber-100">{en?'Share TERRITORY':'Поделись TERRITORY'}</h4><p className="text-[11px] leading-snug text-slate-200">{en?'Tell friends about the game and earn a daily reward.':'Расскажи друзьям об игре и получи ежедневную награду.'}</p></div>
   <div className="text-center text-xs font-black text-amber-200 shrink-0">{task==='monopoly'?<Ticket size={23} className="mx-auto"/>:<Gem size={23} className="mx-auto"/>}+2</div>
  </div>
  <button type="button" data-testid={'share-button-'+task} onClick={share} disabled={!ready||!url||busy} className="w-full mt-3 min-h-11 rounded-lg border border-sky-200/50 bg-gradient-to-b from-sky-500 to-blue-800 text-white text-sm font-black flex items-center justify-center gap-2 disabled:opacity-50">
   {busy?<Loader2 size={18} className="animate-spin"/>:<Send size={18}/>}
   {busy?(en?'Opening Telegram…':'Открываем Telegram…'):full?(en?'Use tickets first':'Сначала потрать билеты'):remaining>0?(en?'Claimed today':'Получено сегодня'):en?'Share in Telegram':'Поделиться в Telegram'}
  </button>
  <div className="flex gap-1 items-center text-[10px] text-amber-200 mt-2"><Clock3 size={12}/>{en?'Daily reset at 00:00':'Ежедневное обновление в 00:00'}</div>
  {notice&&<p role="status" className="text-xs text-emerald-300 mt-1">{notice}</p>}
  {error&&<p role="alert" className="text-xs text-rose-200 mt-1">{error} <button type="button" onClick={()=>{setError('');void refresh();}} className="underline">{en?'Refresh':'Обновить'}</button></p>}
  <p className="text-[10px] text-slate-300 mt-1">{en?'You choose the recipient. Telegram cannot confirm delivery; nothing is sent automatically.':'Ты сам выбираешь получателя. Telegram не подтверждает доставку; рассылка не автоматическая.'}</p>
 </article>;
}
