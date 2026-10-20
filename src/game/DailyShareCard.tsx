import { useEffect, useState } from 'react';
import { CheckCircle2, Megaphone, Send, Clock3, Ticket, Gem, Loader2 } from 'lucide-react';
import { useLanguage } from './i18n';
import { getTelegramWebApp } from './telegram';
import { claimDailyShare, dailyShareStatus, prepareDailyShareLink, prepareRichShareMessage, shareDailyPromo, shareError, type DailyShareTask, type ShareStatus } from './dailyShare';

/** One daily award per task, but the referral link remains shareable indefinitely. */
export function DailyShareCard({task,userId,onClaimed}:{task:DailyShareTask;userId:string;onClaimed?:()=>void}){
 const {language}=useLanguage(),en=language==='en';
 const [status,setStatus]=useState<ShareStatus|null>(null),[url,setUrl]=useState<string|null>(null);
 const [richId,setRichId]=useState<string|null>(null),[richLoading,setRichLoading]=useState(false);
 const tg=getTelegramWebApp();
 const supportsRich=!!tg?.shareMessage&&(tg.isVersionAtLeast?.('8.0')??true);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[now,setNow]=useState(Date.now());
 const refresh=async()=>{try{setStatus(await dailyShareStatus());}catch(e){setError(shareError(e,en));}};
 useEffect(()=>{
  let alive=true;
  // Do not couple the Telegram link with the reward service: sharing must work
  // after claiming, at a full ticket wallet, and while reward status is offline.
  void prepareDailyShareLink(en?'en':'ru').then(link=>{if(alive)setUrl(link);})
   .catch(e=>{if(alive)setError(shareError(e,en));});
  if(supportsRich){
   setRichLoading(true);setRichId(null);
   void prepareRichShareMessage(en?'en':'ru').then(id=>{if(alive)setRichId(id);})
    .catch(()=>{if(alive)setRichId(null);})
    .finally(()=>{if(alive)setRichLoading(false);});
  }
  void dailyShareStatus().then(state=>{if(alive)setStatus(state);})
   .catch(e=>{if(alive)setError(shareError(e,en));});
  const timer=window.setInterval(()=>setNow(Date.now()),15000);
  const resume=()=>{if(!document.hidden){setNow(Date.now());void refresh();}};
  document.addEventListener('visibilitychange',resume);
  return()=>{alive=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',resume);};
 },[task,en]);
 const entry=status?.tasks.find(t=>t.task===task);
 const remaining=entry?.next_at?Math.max(0,Date.parse(entry.next_at)-now):0;
 const full=task==='monopoly'&&(status?.tickets??0)>18;
 const claimedToday=!!entry?.next_at && remaining>0;
 const rewardReady=!!entry?.enabled&&(!!entry.ready||(entry.next_at!==null&&remaining===0))&&!full;
 // A native Telegram share must be confirmed before any daily award is requested.
 const afterShare=()=>{
  if(!rewardReady){
   setBusy(false);
   setNotice(claimedToday
    ? (en?'Invitation sent — reward already claimed today.':'Приглашение отправлено — награда сегодня уже получена.')
    : full
      ? (en?'Invitation sent — spend tickets to collect the bonus.':'Приглашение отправлено — сначала потрать билеты для награды.')
      : (en?'Invitation shared.':'Приглашение отправлено.'));
   return;
  }
  setBusy(true);
  void claimDailyShare(task,userId).then(async receipt=>{
   setNotice(en?'+2 reward credited!':'Награда +2 зачислена!');
   setStatus(current=>current?{...current,
    tickets:task==='monopoly'?(receipt.tickets??current.tickets):current.tickets,
    tasks:current.tasks.map(t=>t.task===task?{...t,ready:false,next_at:receipt.next_at}:t),
   }:current);
   onClaimed?.();
   try{setStatus(await dailyShareStatus());}catch{/* Server receipt is authoritative. */}
  }).catch(e=>{setError(shareError(e,en));void refresh();}).finally(()=>setBusy(false));
 };
 const share=()=>{
  if(busy||richLoading||(!url&&!richId))return;
  setError('');setNotice('');
  if(supportsRich&&richId){
   // Open Telegram's photo + caption + Play-button picker on this click.
   setBusy(true);
   try{
    tg?.shareMessage?.(richId,(sent:boolean)=>{
     if(!sent){setBusy(false);return;} // Cancelled, no reward.
     afterShare();
    });
   }catch{
    setBusy(false);
    setError(en?'Could not open the Telegram photo card. Try again.':'Не удалось открыть открытку Telegram. Попробуй ещё раз.');
   }
   return;
  }
  // Older Telegram clients: keep the existing verified bot deep-link fallback.
  if(!url){setError(en?'Invitation link unavailable':'Ссылка приглашения недоступна');return;}
  let opened=false;
  try{opened=shareDailyPromo(url,en?'en':'ru');}catch{opened=false;}
  if(!opened){setError(en?'Cannot open Telegram':'Не удалось открыть Telegram');return;}
  afterShare(); // Legacy share/url cannot confirm actual delivery.
 };
 const buttonLabel=richLoading?(en?'Preparing card…':'Готовим открытку…'):busy?(en?'Opening…':'Открываем…'):en?'Share':'Поделиться';
 // Monopoly task: reuse the same dense parchment card as Roll 5 / Events / Lap.
 if(task==='monopoly')return (
  <article data-testid="daily-share-monopoly" className={`mono-quest mono-share-quest ${claimedToday?'mono-share-claimed':''}`}>
   <div className="mono-quest-heading">
    <Megaphone aria-hidden="true" size={20} className="mono-share-symbol"/>
    <b>{en?'Share TERRITORY':'Поделись TERRITORY'}</b>
    {claimedToday&&<CheckCircle2 aria-label={en?'Daily reward claimed':'Дневная награда получена'} size={16} className="mono-share-check"/>}
   </div>
   <div className="mono-share-bottom">
    <div className="mono-share-details">
     <span className="mono-share-prize"><Ticket aria-hidden="true" size={16}/><b>+2</b> {en?'tickets':'билета'}</span>
     <small>{claimedToday?(en?'Reward claimed today':'Награда сегодня получена'):full?(en?'Ticket wallet full':'Лимит билетов'):en?'Daily bonus · 00:00':'Ежедневно · 00:00'}</small>
    </div>
    <button type="button" data-testid="share-button-monopoly" onClick={share} disabled={richLoading||(!url&&!richId)||busy}
     className="mono-share-button">
     {busy?<Loader2 aria-hidden="true" size={14} className="animate-spin"/>:<Send aria-hidden="true" size={14}/>}
     {buttonLabel}
    </button>
   </div>
   {notice&&<p role="status" className="mono-share-notice">{notice}</p>}
   {error&&<p role="alert" className="mono-share-error">{error} <button type="button" onClick={()=>{setError('');void refresh();}}>{en?'Refresh':'Обновить'}</button></p>}
  </article>
 );
 // The Trials reward has its own theme, but the unlimited sharing rule is shared.
 return <article data-testid="daily-share-trials" className="rounded-xl border border-amber-500/50 bg-gradient-to-br from-[#4c3121] via-[#273c49] to-[#102a3f] p-3 shadow-lg">
  <div className="flex items-center gap-3">
   <div className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl border border-amber-400/60 bg-amber-800/40"><Megaphone size={23} className="text-amber-200"/></div>
   <div className="flex-1 min-w-0"><h4 className="text-sm font-black text-amber-100">{en?'Share TERRITORY':'Поделись TERRITORY'}</h4><p className="text-[11px] leading-snug text-slate-200">{en?'Tell friends about the game.':'Расскажи друзьям об игре.'}</p></div>
   <div className="text-center text-xs font-black text-amber-200 shrink-0"><Gem size={23} className="mx-auto"/>+2</div>
  </div>
  <button type="button" data-testid="share-button-trials" onClick={share} disabled={richLoading||(!url&&!richId)||busy} className="w-full mt-3 min-h-11 rounded-lg border border-sky-200/50 bg-gradient-to-b from-sky-500 to-blue-800 text-white text-sm font-black flex items-center justify-center gap-2 disabled:opacity-50">
   {busy?<Loader2 size={18} className="animate-spin"/>:<Send size={18}/>}
   {buttonLabel}
  </button>
  <div className="flex gap-1 items-center text-[10px] text-amber-200 mt-2"><Clock3 size={12}/>{claimedToday?(en?'Reward received today · sharing stays available':'Награда получена сегодня · ссылку можно отправлять'):en?'Daily bonus resets at 00:00':'Ежедневная награда в 00:00'}</div>
  {notice&&<p role="status" className="text-xs text-emerald-300 mt-1">{notice}</p>}
  {error&&<p role="alert" className="text-xs text-rose-200 mt-1">{error} <button type="button" onClick={()=>{setError('');void refresh();}} className="underline">{en?'Refresh':'Обновить'}</button></p>}
 </article>;
}
