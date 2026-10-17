import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/game/i18n';
import { getTelegramWebApp } from '@/game/telegram';
import type { AuthUser } from '@/game/auth';
import { CheckCircle2, Copy, Crown, Gift, Gem, Link2, LoaderCircle, LockKeyhole, Send, ShieldCheck, Sparkles, Trophy, UsersRound } from 'lucide-react';
import { friendReward, getReferralBotUsername, getReferralStatus, referralLink, redeemReferrals, type ReferralStatus } from '@/game/referrals';

const milestones = [
  {count:3, ru:'Бронзовый вербовщик',en:'Bronze Recruiter',ruGift:'Рамка основателя и 2 000 золота',enGift:'Founder frame + 2,000 gold'},
  {count:5, ru:'Серебряный вербовщик',en:'Silver Recruiter',ruGift:'Титул, 3 000 золота и 10 алмазов',enGift:'Title, 3,000 gold + 10 gems'},
  {count:10,ru:'Золотой вербовщик',en:'Gold Recruiter',ruGift:'Эксклюзивный облик спутника',enGift:'Exclusive companion appearance'},
  {count:25,ru:'Посол TERRITORY',en:'TERRITORY Ambassador',ruGift:'Знамя, аура и зал славы',enGift:'Banner, aura and hall of fame'},
];

export function FriendsScreen({user}:{user:AuthUser}) {
 const {language}=useLanguage();
 const en=language==='en';
 const [status,setStatus]=useState<ReferralStatus|null>(null);
 const [bot,setBot]=useState<string|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const load=useCallback(async()=>{
  try {
    const data=await getReferralStatus();
    setStatus(data);
    setError('');
  } catch {setError(en ? 'Referral server is unavailable. Try again later.' : 'Система друзей временно недоступна. Попробуй позже.');}
  finally {setLoading(false);}
 },[en]);
 useEffect(()=>{
  void load();
  void getReferralBotUsername().then(setBot);
 },[load]);
 const url=status ? referralLink(bot,status.code):null;
 const text=en
   ? 'Join me in TERRITORY! Become a founder of the new Viking RPG and receive a welcome gift.'
   : 'Присоединяйся ко мне в TERRITORY! Стань основателем новой RPG про викингов и получи подарок за приглашение.';
 const copy=async()=>{
  if(!url)return;
  try{await navigator.clipboard.writeText(url);setMessage(en?'Invite link copied!':'Ссылка приглашения скопирована!');}
  catch{setMessage(en?'Copy not available. Share through Telegram.':'Не удалось скопировать. Отправь через Telegram.');}
 };
 const share=()=>{
  if(!url)return;
  const shareLink='https://t.me/share/url?url='+encodeURIComponent(url)+'&text='+encodeURIComponent(text);
  const webapp=getTelegramWebApp();
  if(webapp?.openTelegramLink) webapp.openTelegramLink(shareLink);
  else window.open(shareLink,'_blank','noopener,noreferrer');
 };
 const claim=async()=>{
  if(busy)return;
  setBusy(true);setError('');setMessage('');
  try{
   const reward=await redeemReferrals(user.id);
   setMessage(en
    ? 'Claimed: +'+reward.gold+' gold, +'+reward.gems+' blue gems, +'+reward.stones+' stones, +'+reward.materials+' forge materials, +'+reward.red_gems+' red gems.'
    : 'Получено: +'+reward.gold+' золота, +'+reward.gems+' синих алмазов, +'+reward.stones+' камней, +'+reward.materials+' материалов, +'+reward.red_gems+' красных алмазов.');
   await load();
  }catch(e){
   const noReward=e instanceof Error && e.message.includes('referral_nothing_to_claim');
   setError(noReward
    ? (en?'No unclaimed rewards yet.':'Пока нечего получать.')
    : (en?'The server could not confirm rewards. Reload the game before trying again.':'Сервер не подтвердил получение. Перезапусти игру перед повтором.'));
  }finally{setBusy(false);}
 };
 return (
  <div className="space-y-3 animate-fade-in pb-6">
   <section className="relative overflow-hidden rounded-2xl border border-amber-400/60 bg-gradient-to-br from-[#4f2c3d] via-[#241336] to-[#10192b] p-4 shadow-[0_0_28px_rgba(161,97,255,.17)]">
    <div className="absolute top-0 right-0 p-3 opacity-20 pointer-events-none"><Crown size={112}/></div>
    <p className="text-xs font-extrabold uppercase tracking-widest text-amber-300 flex items-center gap-2"><Sparkles size={15}/>{en?'FIRST SEASON • BETA':'ПЕРВЫЙ СЕЗОН • ТЕСТ'}</p>
    <h2 className="text-2xl font-black text-white mt-2 leading-tight">{en?'Founders of TERRITORY':'Основатели TERRITORY'}</h2>
    <p className="mt-2 text-sm text-violet-100/85">{en
      ? 'Invite real friends, build your team and earn a unique title. Rewards unlock only after the friend comes back the next day.'
      : 'Зови настоящих друзей, собирай команду и получай редкие награды. Подарки засчитываются после возвращения друга на следующий день.'}</p>
    <div className="grid grid-cols-2 gap-2 mt-4">
      <div className="rounded-xl border border-amber-400/35 bg-black/30 p-3">
        <p className="text-[11px] text-amber-200">{en?'Your founder status':'Твой статус основателя'}</p>
        <strong className="text-lg text-yellow-100">{status?.founder_number ? '#'+status.founder_number : '—'}</strong>
      </div>
      <div className="rounded-xl border border-amber-400/35 bg-black/30 p-3">
        <p className="text-[11px] text-amber-200">{en?'Founder spots left':'Осталось мест'}</p>
        <strong className="text-lg text-yellow-100 tabular-nums">{status?.places_left ?? '—'} / 300</strong>
      </div>
    </div>
   </section>

   <section className="card space-y-3 border border-amber-500/30">
    <h3 className="font-bold text-lg text-amber-100 flex items-center gap-2"><UsersRound size={20}/>{en?'Invite a friend':'Пригласи друга'}</h3>
    <p className="text-xs text-gray-300">{en?'Personal referral link is generated securely for your account.':'Личная ссылка закреплена за твоим аккаунтом и не изменится.'}</p>
    {loading?<p className="text-sm text-gray-400 flex gap-2 items-center"><LoaderCircle size={16} className="animate-spin"/>{en?'Loading…':'Загружаем…'}</p>:
      url?<>
       <div className="rounded-lg border border-amber-500/25 bg-black/40 px-3 py-2 text-xs text-violet-100 break-all select-text">{url}</div>
       <div className="grid grid-cols-2 gap-2">
         <button type="button" onClick={share} className="btn-primary flex items-center justify-center gap-2 py-3"><Send size={16}/>{en?'Send invite':'Пригласить'}</button>
         <button type="button" onClick={()=>void copy()} className="btn-ghost border border-amber-500/40 flex items-center justify-center gap-2 py-3"><Copy size={16}/>{en?'Copy':'Копировать'}</button>
       </div>
      </>:<div className="rounded-xl bg-black/25 p-3 text-xs text-amber-200 flex items-start gap-2"><Link2 size={18} className="shrink-0"/>
        {en?'Open the game through its Telegram bot to activate your personal invite link.':'Открой игру через Telegram-бота, чтобы получить личную ссылку приглашения.'}
      </div>}
   </section>

   <section className="grid grid-cols-3 gap-2">
    {[
      {icon:<UsersRound size={17}/>,label:en?'Joined':'Пришли',value:status?.registered},
      {icon:<ShieldCheck size={17}/>,label:en?'Active':'Активны',value:status?.qualified},
      {icon:<Gift size={17}/>,label:en?'Sealed chests':'Сундуков',value:status?.sealed_chests}
    ].map(v=><div key={v.label} className="rounded-xl border border-violet-500/30 bg-[#181626] p-3 text-center">
      <div className="flex justify-center text-amber-300">{v.icon}</div>
      <strong className="block text-xl font-black tabular-nums">{v.value ?? '—'}</strong>
      <p className="text-[11px] text-gray-400">{v.label}</p>
    </div>)}
   </section>

   <section className="card border border-red-400/25 bg-gradient-to-r from-red-950/25 to-violet-950/20">
    <div className="flex gap-2 items-center"><Gem size={22} className="text-red-400"/><strong className="text-base">{en?'Red diamond fragments':'Осколки красного алмаза'}</strong></div>
    <p className="text-2xl text-red-200 font-black mt-2 tabular-nums">{((status?.red_fragments ?? 0)*0.2).toFixed(1)} <span className="text-sm text-gray-400">/ 1,0</span></p>
    <div className="grid grid-cols-5 gap-1.5 mt-2">{[0,1,2,3,4].map(x=><span key={x} className={'rounded-full h-3 border '+(x<(status?.red_fragments??0)?'bg-red-500 border-red-300':'bg-gray-800 border-gray-600')}/>)}</div>
    <p className="text-xs text-gray-300 mt-2">{en?'Each active friend: 0.2 red diamond. Five fragments become a whole diamond.':'За каждого активного друга — 0,2 красного алмаза. Пять осколков превращаются в целый алмаз.'}</p>
    {(status?.red_pending??0)>0&&<p className="mt-1 text-emerald-300 text-xs font-bold">{en?'Whole red diamonds ready to claim: ':'Целых алмазов к получению: '}{status?.red_pending}</p>}
   </section>

   <section className="card border border-amber-500/25">
    <div className="flex items-center gap-2"><LockKeyhole className="text-amber-300"/><strong>{en?'Sealed Founder Chest':'Запечатанный сундук основателя'}</strong></div>
    <p className="text-xs text-gray-300 mt-2">{en?'One permanent sealed chest for every active invited player. Contents and opening date will be announced at a future event.':'Один запечатанный сундук за каждого активного друга. Содержимое и дата открытия будут объявлены на будущем событии.'}</p>
    <p className="text-sm font-bold text-amber-200 mt-2">{en?'Stored safely: ':'Сохранено: '}{status?.sealed_chests ?? 0} 🎁</p>
   </section>

   <section className="card border border-emerald-600/30">
    <div className="flex items-center gap-2 mb-2"><Gift size={20} className="text-emerald-300"/><h3 className="font-bold">{en?'Recruitment bonuses':'Награды за друзей'}</h3></div>
    <p className="text-sm text-gray-200">{en?'For each of your first 10 active friends':'За каждого из первых 10 активных друзей'}:</p>
    <div className="grid grid-cols-2 gap-2 text-xs mt-2">
      <span className="rounded-lg bg-black/30 p-2">🪙 {friendReward.gold.toLocaleString('ru-RU')} {en?'gold':'золота'}</span>
      <span className="rounded-lg bg-black/30 p-2">💎 {friendReward.gems} {en?'blue gems':'синих алмазов'}</span>
      <span className="rounded-lg bg-black/30 p-2">⚒️ {friendReward.materials} {en?'forge materials':'материала кузницы'}</span>
      <span className="rounded-lg bg-black/30 p-2">🪨 {friendReward.stones} {en?'battle stone':'боевой камень'}</span>
    </div>
    <p className="text-[11px] text-amber-200/80 mt-3">{en?'6 referral battle stones maximum per UTC week. All confirmed friends earn red shards, sealed chests and referral status.':'Не более 6 бонусных боевых камней за неделю. Каждый подтверждённый друг даёт осколок, сундук и прогресс вербовщика.'}</p>
    {!!status && (status.pending_claims>0 || status.welcome_pending || status.red_pending>0) && (
      <button type="button" disabled={busy} className="btn-primary w-full py-3 mt-3 flex items-center justify-center gap-2" onClick={()=>void claim()}>
        {busy?<LoaderCircle className="animate-spin" size={18}/>:<Gift size={18}/>}
        {en?'Claim rewards':'Получить награды'}
      </button>
    )}
    {status?.welcome_pending && <p className="mt-2 text-sm text-emerald-200">{en?'Your welcome gift: 600 gold, 3 stones, 2 elixirs.':'Твой подарок новичка: 600 золота, 3 камня, 2 эликсира.'}</p>}
   </section>

   <section className="card">
    <h3 className="text-amber-100 font-bold mb-3 flex gap-2 items-center"><Trophy className="text-amber-300" size={19}/>{en?'Recruiter milestones':'Звания вербовщика'}</h3>
    <div className="space-y-3">
      {milestones.map((m)=>{
        const reached=(status?.qualified??0)>=m.count;
        const progress=Math.min(100,Math.round((status?.qualified??0)/m.count*100));
        return <div key={m.count} className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex justify-between items-center gap-2">
           <strong className={'text-sm '+(reached?'text-emerald-300':'text-amber-200')}>{reached?<CheckCircle2 size={14} className="inline mr-1"/>:null}{en?m.en:m.ru}</strong>
           <span className="text-xs tabular-nums text-gray-400">{Math.min(status?.qualified??0,m.count)} / {m.count}</span>
          </div>
          <div className="h-2 rounded-full bg-black/50 mt-2 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-amber-600 to-emerald-400" style={{width:progress+'%'}}/></div>
          <p className="text-[11px] text-gray-400 mt-1">{en?m.enGift:m.ruGift}</p>
        </div>;
      })}
    </div>
    <p className="text-[11px] text-amber-200/70 mt-3">{en?'Titles and visual rewards will be activated in the founder season event.':'Титулы и внешние награды откроются в событии сезона основателей.'}</p>
   </section>

   <p className="text-xs text-gray-400 flex items-start gap-2"><ShieldCheck size={15} className="shrink-0 text-emerald-300"/>
     {en?'A friend counts after verified Telegram login and a return after 24 hours on another UTC day. No rewards for clicks or self-invites.':'Друг засчитывается после подтверждённого входа Telegram и возвращения минимум через 24 часа в другой день UTC. За клики и самоприглашения наград нет.'}
   </p>
   {message&&<p role="status" className="rounded-xl border border-emerald-600/40 bg-emerald-950/30 p-3 text-sm text-emerald-200">{message}</p>}
   {error&&<p role="alert" className="rounded-xl border border-rose-600/40 bg-rose-950/30 p-3 text-sm text-rose-300">{error}</p>}
  </div>
 );
}
