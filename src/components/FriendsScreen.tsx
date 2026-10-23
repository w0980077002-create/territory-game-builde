import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/game/i18n';
import type { AuthUser } from '@/game/auth';
import {
  CheckCircle2, ChevronDown, Copy, Crown, Gift, Gem, HelpCircle, Link2,
  LoaderCircle, LockKeyhole, RefreshCw, Send, ShieldCheck, Sparkles, Trophy, UsersRound
} from 'lucide-react';
import { Currency } from './ui/Currency';
import { prepareRichShareMessage } from '@/game/dailyShare';
import { captureGameEvent } from '@/game/analytics';
import { getTelegramWebApp } from '@/game/telegram';
import {
  friendReward, getReferralBotUsername, getReferralStatus, referralLink, shareReferralInvite,
  redeemReferrals, getReferralFriends, type ReferralFriend, type ReferralStatus
} from '@/game/referrals';

const milestones = [
  { count: 3, ru: 'Бронзовый вербовщик', en: 'Bronze Recruiter', ruGift: '2 000 золота; рамка позже', enGift: '2,000 gold; frame later' },
  { count: 5, ru: 'Серебряный вербовщик', en: 'Silver Recruiter', ruGift: '3 000 золота + 10 синих алмазов; титул позже', enGift: '3,000 gold + 10 blue gems; title later' },
  { count: 10, ru: 'Золотой вербовщик', en: 'Gold Recruiter', ruGift: 'Особый облик спутника — позже', enGift: 'Unique follower style — coming later' },
  { count: 25, ru: 'Посол TERRITORY', en: 'TERRITORY Ambassador', ruGift: 'Знамя, аура и зал славы — позже', enGift: 'Banner, aura and hall of fame — later' },
];

export function FriendsScreen({ user, onHero }: { user: AuthUser; onHero: () => void }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const isLinked = user.telegramId !== null;
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [bot, setBot] = useState<string | null>(null);
  const [preparedId,setPreparedId]=useState<string|null>(null);
  const [preparing,setPreparing]=useState(false);
  const [loading, setLoading] = useState(isLinked);
  const [botLoading, setBotLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [friends, setFriends] = useState<ReferralFriend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(isLinked);
  const [friendsError, setFriendsError] = useState(false);
  const [showAllFriends, setShowAllFriends] = useState(false);

  const load = useCallback(async () => {
    if (!isLinked) {
      setLoading(false);
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      const data = await getReferralStatus();
      setStatus(data);
      setError('');
    } catch (err) {
      console.error('Referral status unavailable:', err);
      setError(en ? 'Unable to load referrals. Try again.' : 'Не удалось загрузить друзей. Попробуй ещё раз.');
    } finally {
      setLoading(false);
    }
  }, [en, isLinked]);

  const loadFriends = useCallback(async () => {
    if (!isLinked) { setFriends([]); setFriendsLoading(false); return; }
    setFriendsLoading(true);
    try { setFriends(await getReferralFriends()); setFriendsError(false); }
    catch { setFriendsError(true); }
    finally { setFriendsLoading(false); }
  }, [isLinked]);

  const loadBot = useCallback(async () => {
    setBotLoading(true);
    try { setBot(await getReferralBotUsername()); }
    finally { setBotLoading(false); }
  }, []);

  useEffect(() => { void load(); void loadBot(); void loadFriends(); }, [load, loadBot, loadFriends]);
  useEffect(()=>{
    const tg=getTelegramWebApp();
    if(!isLinked||!tg?.shareMessage||(tg.isVersionAtLeast&&!tg.isVersionAtLeast('8.0')))return;
    let active=true;setPreparing(true);setPreparedId(null);
    void prepareRichShareMessage(en?'en':'ru').then(id=>{if(active)setPreparedId(id);})
      .catch(()=>{if(active)setPreparedId(null);})
      .finally(()=>{if(active)setPreparing(false);});
    return()=>{active=false;};
  },[en,isLinked]);

  const url = status ? referralLink(bot, status.code) : null;
  const active = status?.qualified ?? 0;
  const next = milestones.find(m => active < m.count);
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      captureGameEvent('territory_referral_link_copy', { outcome: 'success' });
      setMessage(en ? 'Link copied! Send it to a friend.' : 'Ссылка скопирована! Отправь её другу.');
    } catch {
      setMessage(en ? 'Copy unavailable. Use the Telegram share button.' : 'Не удалось скопировать. Используй кнопку Telegram.');
    }
  };

  const share = () => {
    if(preparing)return;
    if(preparedId || url) captureGameEvent('territory_referral_share_click');
    const tg=getTelegramWebApp();
    if(preparedId&&tg?.shareMessage){
      try{tg.shareMessage(preparedId);}
      catch{setMessage(en?'Could not open the picture invitation. Please retry.':'Не удалось открыть открытку. Попробуй ещё раз.');}
      return;
    }
    if(url)shareReferralInvite(url,en);
  };

  const claim = async () => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const reward = await redeemReferrals(user.id);
      captureGameEvent('territory_referral_reward_claim', { outcome: 'success' });
      setMessage(en
        ? 'Rewards claimed! +' + reward.gold + ' gold, +' + reward.gems + ' gems, +' + reward.stones + ' stones, +' + reward.materials + ' forge materials, +' + reward.red_gems + ' red gems.'
        : 'Награды получены! +' + reward.gold + ' золота, +' + reward.gems + ' алмазов, +' + reward.stones + ' камней, +' + reward.materials + ' материалов, +' + reward.red_gems + ' красных алмазов.');
      await Promise.all([load(), loadFriends()]);
    } catch (err) {
      setError(err instanceof Error && err.message.includes('referral_nothing_to_claim')
        ? (en ? 'No rewards to claim yet.' : 'Пока нечего забирать.')
        : (en ? 'Server could not confirm rewards. Restart the game before retrying.' : 'Сервер не подтвердил награды. Перезапусти игру перед повтором.'));
    } finally { setBusy(false); }
  };

  const readyToClaim = !!status && (status.pending_claims > 0 || status.welcome_pending || status.red_pending > 0);

  return (
    <div className="space-y-2.5 animate-fade-in pb-5 text-white" data-testid="compact-friends-screen">
      {/* ONE lead message and ONE primary call to action. */}
      <section className="relative overflow-hidden rounded-2xl border border-amber-400/60 bg-gradient-to-br from-[#482333] via-[#2d173b] to-[#14182a] p-3.5 shadow-[0_6px_24px_#0006]">
        <div className="absolute -top-5 -right-5 opacity-10 pointer-events-none"><Crown size={125} /></div>
        <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-amber-300"><Sparkles size={15} />{en ? 'FOUNDER SEASON' : 'СЕЗОН ОСНОВАТЕЛЕЙ'}</p>
        <h2 className="mt-1 text-xl font-black tracking-tight text-white">{en ? 'Invite friends — earn rewards!' : 'Зови друзей — забирай награды!'}</h2>
        <p className="mt-1 text-xs text-purple-100/85">{en ? 'For EACH active friend:' : 'ЗА КАЖДОГО активного друга:'}</p>
        <div className="grid grid-cols-2 gap-2 mt-2.5">
          <div className="flex items-center gap-2 rounded-xl border border-rose-400/35 bg-[#2d111e]/80 p-2.5">
            <Gem size={29} className="shrink-0 text-red-400 drop-shadow-[0_0_6px_#ff4068]" />
            <div className="min-w-0">
              <div className="text-xl leading-none font-black text-rose-200">+0,2</div>
              <p className="mt-1 text-[11px] leading-tight text-rose-100">{en ? 'red diamond' : 'красного алмаза'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-[#382819]/80 p-2.5">
            <Gift size={29} className="shrink-0 text-amber-300" />
            <div>
              <div className="text-xl leading-none font-black text-amber-100">+1</div>
              <p className="mt-1 text-[11px] leading-tight text-amber-100">{en ? 'sealed chest' : 'сундук основателя'}</p>
            </div>
          </div>
        </div>
        <p className="mt-2.5 text-[11px] leading-snug text-amber-100/90">{en
          ? 'Plus gold, blue gems, forge materials and battle stones for your first 10 active friends.'
          : 'И ещё золото, синие алмазы, материалы и камни — за первых 10 активных друзей.'}</p>
      </section>

      {/* No fake zeroes/dashes for accounts not authorized for referral rewards. */}
      <section className="rounded-2xl border border-amber-500/25 bg-[#171c28] p-3.5 space-y-2.5">
        <h3 className="flex items-center gap-2 text-base font-bold text-amber-100"><Send size={18} />{en ? 'Your invitation' : 'Твоя реферальная ссылка'}</h3>
        {!isLinked ? (
          <div className="space-y-2.5" data-testid="unlinked-telegram-state">
            <p className="text-sm font-semibold text-amber-200">{en ? 'Telegram account is not linked' : 'Telegram пока не привязан к этому герою'}</p>
            <p className="text-xs leading-relaxed text-gray-300">{en
              ? 'Your invite link and founder number will appear after your current character is linked to Telegram. Do not create another character just to get a link.'
              : 'Ссылка и номер основателя появятся после привязки Telegram к текущему герою. Не создавай нового героя ради рефералки — сначала проверь привязку.'}</p>
            <button type="button" onClick={onHero} className="w-full rounded-xl border border-amber-400/65 bg-gradient-to-b from-amber-600/65 to-amber-900/70 px-3 py-3 font-bold text-white">
              {en ? 'Check Telegram in profile' : 'Проверить Telegram в профиле'}
            </button>
          </div>
        ) : loading && !status ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-amber-200"><LoaderCircle className="animate-spin" size={18} />{en ? 'Loading your link…' : 'Загружаем твою ссылку…'}</div>
        ) : !status ? (
          <div data-testid="referral-load-failure" className="space-y-2">
            <p className="text-sm text-amber-200">{en ? 'Could not load the referral link.' : 'Не удалось получить реферальную ссылку.'}</p>
            <button type="button" className="w-full rounded-xl border border-amber-400/50 bg-amber-900/40 py-3 font-bold flex items-center justify-center gap-2" onClick={() => void load()}><RefreshCw size={17}/>{en ? 'Retry' : 'Повторить'}</button>
          </div>
        ) : url ? (
          <>
            <button type="button" className="btn-primary w-full py-3.5 text-base font-black flex items-center justify-center gap-2 shadow-[0_4px_14px_rgba(245,158,11,.22)]" onClick={share} disabled={preparing}>
              <Send size={20}/>{en ? 'INVITE A FRIEND' : 'ПРИГЛАСИТЬ ДРУГА'}
            </button>
            <button type="button" onClick={() => void copy()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-black/25 px-3 py-2.5 text-sm font-bold text-gray-200">
              <Copy size={16}/>{en ? 'Copy my link' : 'Скопировать мою ссылку'}
            </button>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-amber-200">{botLoading
              ? (en ? 'Connecting to Telegram bot…' : 'Соединяемся с Telegram-ботом…')
              : (en ? 'The bot link is temporarily unavailable. Your referral progress is safe.' : 'Не удалось получить адрес бота. Все твои награды сохранены.')}</p>
            {!botLoading && <button type="button" onClick={() => void loadBot()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-black/25 py-3 font-bold text-amber-200"><RefreshCw size={17}/>{en ? 'Retry bot link' : 'Обновить ссылку'}</button>}
          </div>
        )}
        {status && <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-amber-200/90">
          <span><Crown className="inline mr-1" size={13}/>{status.founder_number ? (en ? 'Founder #' : 'Основатель №') + status.founder_number : (en ? 'Founders season' : 'Сезон основателей')}</span>
          <span className="text-gray-600">•</span>
          <span>{en ? 'Spots left' : 'Свободных мест'}: {status.places_left} / 300</span>
        </div>}
      </section>

      {status && (
        <>
          <section className="grid grid-cols-3 gap-2" aria-label={en ? 'Friend statistics' : 'Статистика друзей'}>
            {([
              [status.registered, en ? 'Пришли' : 'Пришли', UsersRound],
              [status.qualified, en ? 'Active' : 'Засчитаны', ShieldCheck],
              [status.sealed_chests, en ? 'Chests' : 'Сундуки', Gift],
            ] as const).map(([value, label, Icon]) => (
              <div key={label} className="rounded-xl border border-[#644672] bg-[#21182c] p-2.5 text-center">
                <Icon size={17} className="mx-auto text-amber-300"/>
                <strong className="block text-xl font-black tabular-nums leading-tight mt-1">{value}</strong>
                <p className="text-[11px] text-purple-100/70">{label}</p>
              </div>
            ))}
          </section>

          {/* Red diamonds + chest: one tight visual summary, no duplicate panels. */}
          <section className="rounded-xl border border-rose-500/30 bg-[#281622] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-bold text-sm text-rose-100"><Gem size={18} className="text-rose-400"/>{en ? 'Red diamond' : 'Красный алмаз'}</div>
              <span className="font-black text-base tabular-nums text-rose-200">{(status.red_fragments * 0.2).toFixed(1).replace('.', ',')} / 1</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5 mt-2" aria-label={en ? 'Five fragments make one diamond' : 'Пять осколков дают один алмаз'}>
              {[0,1,2,3,4].map(i=><div key={i} className={'h-3 rounded-full border ' + (i<status.red_fragments ? 'border-rose-300 bg-gradient-to-r from-red-600 to-red-400' : 'border-rose-400/25 bg-black/45')}/>)}
            </div>
            <p className="text-[11px] text-gray-300 mt-1.5">{en ? '5 friends = 1 whole red diamond.' : '5 друзей = 1 целый красный алмаз.'}
              {status.red_pending > 0 && <span className="text-emerald-300 font-bold"> {en ? 'Ready to claim:' : 'Можно забрать:'} {status.red_pending}</span>}
            </p>
          </section>

          {next && (
            <section className="rounded-xl border border-amber-400/30 bg-[#1c1b29] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-400">{en ? 'Next milestone' : 'Ближайшая награда'}</p>
                  <strong className="text-sm text-amber-200">{en ? next.en : next.ru}</strong>
                </div>
                <strong className="text-xs text-white tabular-nums shrink-0">{active} / {next.count}</strong>
              </div>
              <div className="mt-2 h-2 rounded-full bg-black/60 overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-600 to-amber-300 rounded-full" style={{width:Math.min(100,active/next.count*100)+'%'}}/></div>
              <p className="text-xs text-gray-300 mt-1.5">{en ? next.enGift : next.ruGift}</p>
            </section>
          )}


          <section className="rounded-xl border border-violet-400/25 bg-[#19182b] p-3" data-testid="referral-friend-list">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black text-amber-100 flex items-center gap-2">
                <UsersRound size={17} />{en ? 'My invited friends' : 'Мои друзья'}
                <span className="text-xs text-amber-300">({status.registered})</span>
              </h3>
              <button type="button" onClick={() => void loadFriends()}
                className="text-xs text-violet-200 border border-violet-300/20 rounded-lg px-2 py-1.5"
                aria-label={en ? 'Refresh friends' : 'Обновить друзей'}><RefreshCw size={15}/></button>
            </div>
            {friendsLoading ? <p className="mt-3 text-xs text-gray-400">{en ? 'Loading friends…' : 'Загружаем друзей…'}</p> :
            friendsError ? (
              <div className="mt-2 text-xs text-amber-200">
                {en ? 'Could not load friends.' : 'Не удалось загрузить список друзей.'}
                <button type="button" onClick={() => void loadFriends()} className="ml-2 underline">{en ? 'Retry' : 'Повторить'}</button>
              </div>
            ) : friends.length === 0 ? (
              <p className="mt-3 text-xs text-gray-300">
                {en ? 'No friends yet. Send your link and the first one will appear here!' :
                'Пока никого нет. Отправь ссылку — здесь появятся приглашённые герои!'}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {(showAllFriends ? friends : friends.slice(0,5)).map((friend, index) => {
                  const wins = Math.min(10,friend.wins);
                  const level = Math.min(5,friend.level);
                  const progress = friend.qualified ? 100 : Math.min(99,Math.round(
                    50 * (wins / 10) + 50 * (Math.max(0,level-1) / 4)));
                  return (
                    <div key={friend.joined_at + index} className="rounded-xl border border-white/10 bg-black/25 p-2.5">
                      <div className="flex gap-2 items-center">
                        <div className="h-9 w-9 rounded-lg bg-violet-900/45 border border-violet-400/25 flex items-center justify-center text-amber-200 shrink-0">
                          <UsersRound size={19}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <strong className="text-xs truncate text-white">{friend.name}</strong>
                            {friend.qualified ? <CheckCircle2 size={15} className="text-emerald-400 shrink-0"/> : null}
                          </div>
                          <p className="text-[11px] text-violet-200/80">
                            {en ? 'Level' : 'Уровень'} {level}/5 · {wins}/10 {en ? 'verified fights' : 'учтённых побед'}
                          </p>
                        </div>
                        <span className={'text-[10px] font-bold shrink-0 ' + (friend.qualified ? 'text-emerald-300' : 'text-amber-200')}>
                          {friend.qualified ? (en ? 'Qualified' : 'Засчитан') : (en ? 'In progress' : 'В процессе')}
                        </span>
                      </div>
                      {!friend.qualified && <div className="mt-2 h-1.5 bg-black/50 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-amber-400" style={{width:progress+'%'}}/>
                      </div>}
                    </div>
                  );
                })}
                {friends.length>5 && <button type="button" onClick={()=>setShowAllFriends(v=>!v)}
                   className="w-full text-xs font-bold text-amber-200 py-2">
                   {showAllFriends ? (en?'Show less':'Свернуть') : (en?'Show all friends':'Показать всех')} ({friends.length})
                </button>}
              </div>
            )}
            <p className="mt-2 text-[10px] text-gray-400">
              {en ? 'A referral qualifies at level 5 with 10 recorded PvE victories; no 24-hour wait.' :
              'Друг засчитывается на 5-м уровне после 10 учтённых побед в походе или испытаниях. Сутки ждать не нужно.'}
            </p>
          </section>

          {readyToClaim && <button type="button" onClick={() => void claim()} disabled={busy} className="btn-primary w-full py-3.5 flex items-center justify-center gap-2 font-black">
            {busy ? <LoaderCircle size={19} className="animate-spin"/> : <Gift size={19}/>}
            {en ? 'CLAIM REWARDS' : 'ЗАБРАТЬ НАГРАДЫ'}
          </button>}
        </>
      )}

      {/* All optional information lives under a single collapsed disclosure. */}
      <details className="group rounded-xl border border-white/10 bg-[#171c27] p-3" data-testid="friends-rewards-details">
        <summary className="cursor-pointer list-none flex items-center gap-2 text-sm font-bold text-amber-100">
          <Trophy size={18} className="text-amber-400"/>
          <span className="flex-1">{en ? 'All rewards & rules' : 'Все награды и правила'}</span>
          <ChevronDown size={18} className="text-amber-300 transition-transform group-open:rotate-180"/>
        </summary>
        <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
          <p className="text-xs font-bold text-amber-200">{en ? 'For each of your first 10 active friends' : 'За каждого из первых 10 активных друзей'}</p>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div className="rounded-lg bg-black/30 p-2"><Currency kind="gold" value={friendReward.gold.toLocaleString('ru-RU')} size={20}/></div>
            <div className="rounded-lg bg-black/30 p-2"><Currency kind="gems" value={friendReward.gems} size={20}/></div>
            <div className="rounded-lg bg-black/30 p-2"><Currency kind="material" value={friendReward.materials} size={20}/></div>
            <div className="rounded-lg bg-black/30 p-2"><Currency kind="stones" value={friendReward.stones} size={20}/></div>
          </div>
          <p className="text-[11px] text-gray-400">{en ? 'Up to 6 referral battle stones per week. Every active friend earns 0.2 red gem and a chest, even after the first 10.' : 'Не более 6 реферальных боевых камней в неделю. Алмаз и сундук начисляются за каждого засчитанного друга, даже после первых 10.'}</p>
          <p className="text-xs font-bold text-amber-200">{en ? 'Recruiter milestones' : 'Звания вербовщика'}</p>
          <div className="space-y-1.5">
            {milestones.map(m=>{
              const done=active>=m.count;
              return <div key={m.count} className="flex items-start gap-2 rounded-lg bg-black/25 px-2.5 py-2">
                {done ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0"/> : <Trophy size={16} className="text-amber-500 shrink-0"/>}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-gray-100">{m.count} {en ? 'friends' : 'друзей'} — {en ? m.en : m.ru}</p>
                  <p className="text-[11px] text-gray-400">{en ? m.enGift : m.ruGift}</p>
                </div>
              </div>;
            })}
          </div>
          <div className="rounded-lg border border-amber-400/20 bg-amber-950/15 p-2.5">
            <strong className="flex items-center gap-1.5 text-xs text-amber-200"><LockKeyhole size={15}/>{en ? 'Sealed Founder Chests' : 'Запечатанные сундуки основателя'}</strong>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-300">{en
              ? 'They are stored on the server. Their gifts and opening date will be revealed at a future event.'
              : 'Хранятся на сервере. Подарки внутри и дату открытия объявим на будущем событии.'}</p>
          </div>
          {status?.welcome_pending && <p className="text-xs text-emerald-200">{en ? 'Starter gift ready: 600 gold, 3 battle stones and 2 elixirs.' : 'Подарок новичка: 600 золота, 3 боевых камня и 2 эликсира.'}</p>}
          <div className="space-y-1 text-xs text-gray-300">
            <p className="flex gap-2"><HelpCircle size={16} className="shrink-0 text-amber-300"/>{en ? 'How it works: share your link → friend logs in → reaches level 5 and 10 recorded wins → claim rewards.' : 'Как работает: отправь ссылку → друг зайдёт → достигнет 5-го уровня и 10 учтённых побед → забери награду.'}</p>
            <p className="text-[11px] text-gray-400">{en ? 'Only verified Telegram accounts count. No rewards for clicks or self-invites.' : 'Учитываются только подтверждённые аккаунты Telegram. За клики и приглашение самого себя наград нет.'}</p>
            <p className="text-[11px] text-amber-300/80">{en ? 'Visual titles and cosmetics will arrive in a future season event.' : 'Визуальные титулы и облики появятся в будущем событии сезона.'}</p>
          </div>
        </div>
      </details>

      {message && <div role="status" className="rounded-xl border border-emerald-600/45 bg-emerald-950/25 p-3 text-sm text-emerald-200">{message}</div>}
      {error && <div role="alert" className="rounded-xl border border-rose-500/35 bg-red-950/25 p-3 text-xs text-red-200">
        {error} {isLinked && <button type="button" onClick={() => void load()} className="ml-2 underline font-bold">{en ? 'Retry' : 'Повторить'}</button>}
      </div>}
    </div>
  );
}
