import { Crown, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchVipDailyStatus, claimVipDaily, recoverVipDaily, type VipDailyStatus } from '@/game/vipDaily';
import { fetchVipWeeklyStatus, claimVipWeekly, recoverVipWeekly, type VipWeeklyStatus } from '@/game/vipWeekly';
import { fetchVipChestHistory, type VipChestClaim } from '@/game/vipHistory';
import { useStore } from '@/game/store';
import { useAccount } from '@/game/actions';
import { useLanguage } from '@/game/i18n';
import { VIP_TIERS, vipTier, vipNextThreshold } from '@/game/vipProgram';

/** Prestige page renders only actual permanent entitlement from the server.
 * The amount of donated money is deliberately NOT inferred from gift VIP levels.
 * Payment checkout stays unavailable until a verified provider integration.
 */
const LIVE_DAILY_CHEST = import.meta.env.VITE_VIP_DAILY_ENABLED === 'true';
const LIVE_WEEKLY_CHEST = import.meta.env.VITE_VIP_WEEKLY_ENABLED === 'true';
const vipAssetBase = `${import.meta.env.BASE_URL}assets/territory/vip/`;
const vipBadgeSrc = (n:number) => vipAssetBase + 'badges/vip-' + String(n).padStart(2,'0') + '.svg';
const vipDailyChestSrc = (n:number) => vipAssetBase + 'chests/daily-' + Math.max(1,Math.min(5,Math.ceil(n/2))) + '.svg';
const vipWeeklyChestSrc = (n:number) => vipAssetBase + 'chests/weekly-' + (n<=3?1:n<=5?2:n===6?3:n<=8?4:5) + '.svg';

export function VipStatusPanel({ userId }: { userId:string }) {
  const account = useStore(useAccount);
  const [daily,setDaily] = useState<VipDailyStatus|null>(null);
  const [dailyBusy,setDailyBusy]=useState(false);
  const [dailyError,setDailyError]=useState('');
  const [dailyReward,setDailyReward]=useState('');
  const [weekly,setWeekly] = useState<VipWeeklyStatus|null>(null);
  const [weeklyBusy,setWeeklyBusy] = useState(false);
  const [weeklyError,setWeeklyError] = useState('');
  const [weeklyReward,setWeeklyReward] = useState('');
  const [history,setHistory] = useState<VipChestClaim[]|null>(null);
  const { language } = useLanguage();
  const en = language === 'en';
  const permanentLevel = Math.max(0, Math.min(10, account.permanentVip));
  const remainingVip = Math.max(0, account.vipRemaining - (performance.now() - account.vipCheckedAt));
  const level = Math.max(permanentLevel, remainingVip>0 ? account.vip : 0);
  const current = vipTier(level);
  // A gifted VIP level is NOT evidence of a paid purchase or a paid-progress balance.
  const [selectedLevel,setSelectedLevel] = useState<number|null>(null);
  const inspected = vipTier(selectedLevel ?? Math.max(1, level));
  const nextPaidTarget = account.entitlementVerified ? vipNextThreshold(account.paidVip) : null;
  const verifiedSpent = (account.paidSpendCents / 100).toFixed(2);
  useEffect(() => {
    if (!LIVE_DAILY_CHEST || !userId) return;
    let active=true;
    void fetchVipDailyStatus(userId).then(status => {
      if (active) setDaily(status);
    }).catch(() => {if (active) setDailyError('unavailable');});
    return () => {active=false;};
  },[userId]);
  useEffect(() => {
    if (!LIVE_WEEKLY_CHEST || !userId) return;
    let active=true;
    void fetchVipWeeklyStatus(userId).then(status => {
      if (active) setWeekly(status);
    }).catch(() => { if (active) setWeeklyError('unavailable'); });
    return () => { active=false; };
  },[userId]);
  useEffect(() => {
    if ((!LIVE_DAILY_CHEST && !LIVE_WEEKLY_CHEST) || !userId) return;
    let active=true;
    void fetchVipChestHistory().then(data=>{if(active)setHistory(data);}).catch(()=>{});
    return ()=>{active=false;};
  },[userId]);
  const takeWeekly = async () => {
    if (!LIVE_WEEKLY_CHEST || weeklyBusy || weekly?.claimedThisWeek || (weekly?.vip ?? 0)<2) return;
    setWeeklyBusy(true); setWeeklyError('');
    try {
      const recovered=await recoverVipWeekly(userId);
      const reward=recovered ?? await claimVipWeekly(userId);
      setWeeklyReward(en
        ? `+ ${reward.gold} gold, ${reward.gems} gems, ${reward.stones} stones, ${reward.materials} forge materials`
        : `+ ${reward.gold} золота, ${reward.gems} самоцветов, ${reward.stones} камней, ${reward.materials} материалов`);
      setWeekly(prev=>prev?{...prev,claimedThisWeek:true}:prev);
      void fetchVipChestHistory().then(setHistory).catch(()=>{});
    }catch {
      setWeeklyError('retry');
    }finally {setWeeklyBusy(false);}
  };
  const takeDaily = async () => {
    if(!LIVE_DAILY_CHEST || dailyBusy || daily?.claimedToday || (daily?.vip ?? 0)<1)return;
    setDailyBusy(true); setDailyError('');
    try {
      const recovered=await recoverVipDaily(userId);
      const reward=recovered ?? await claimVipDaily(userId);
      setDailyReward(en
        ? `+ ${reward.gold} gold, ${reward.gems} gems, ${reward.stones} stones`
        : `+ ${reward.gold} золота, ${reward.gems} самоцветов, ${reward.stones} камней`);
      setDaily(prev=>prev?{...prev,claimedToday:true}:prev);
      void fetchVipChestHistory().then(setHistory).catch(()=>{});
    }catch {
      setDailyError('retry');
    }finally {setDailyBusy(false);}
  };

  return (
    <details className="group rounded-2xl border-2 border-[#9e6831] bg-[linear-gradient(140deg,#4b2c1b,#231710_65%,#402719)] p-2.5 shadow-[inset_0_1px_0_#f3c77c50,0_4px_14px_#0007]" data-testid="vip-status-panel">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-300/70 bg-[#4d2d12] text-amber-200">
          {level>=1 ? <img src={vipBadgeSrc(level)} alt="" width={39} height={39}
            className="h-10 w-10 object-contain" /> : <Crown size={23}/>}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block text-sm font-black text-[#ffdf98]">{en ? 'VIP Program' : 'Программа VIP'} · {level}/10</strong>
          <span className="block truncate text-[11px] text-amber-100/85">{en ? current.nameEn : current.nameRu}</span>
        </span>
        <span className="text-amber-200 group-open:hidden">▾</span>
        <span className="hidden text-amber-200 group-open:inline">▴</span>
      </summary>
      <div className="border-t border-amber-500/25 pt-2">
        <p className="mb-2 text-[11px] leading-relaxed text-amber-100/85">
          {remainingVip>0 && account.vip>permanentLevel
            ? (en ? `Temporary VIP ${account.vip} is active; permanent VIP ${permanentLevel} remains unchanged.`
              : `Временный VIP ${account.vip} активен; постоянный VIP ${permanentLevel} не меняется.`)
            : account.entitlementVerified && account.giftVip>0
              ? (en ? `Gifted VIP ${account.giftVip} is confirmed; gifts do not count as paid purchases.`
                : `Подтверждён подарочный VIP ${account.giftVip}; подарки не считаются покупками.`)
              : account.entitlementVerified && permanentLevel>account.paidVip
                ? (en ? `Existing permanent VIP ${permanentLevel} is preserved separately from paid purchases.`
                  : `Существующий постоянный VIP ${permanentLevel} сохранён отдельно от покупок.`)
                : (en ? 'VIP status is server-verified; gifts never count as paid spending.'
                  : 'VIP подтверждается сервером; подарки не считаются донатом.')}
        </p>
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/20 bg-black/25 px-2 py-1.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"/>
          <div className="text-[11px] text-amber-100">
            {account.entitlementVerified ? (
              <>
                <strong className="block">
                  {en
                    ? `Verified purchases: $${verifiedSpent} · paid VIP ${account.paidVip}`
                    : `Подтверждённые покупки: $${verifiedSpent} · оплаченный VIP ${account.paidVip}`}
                </strong>
                <span className="mt-0.5 block text-amber-100/80">
                  {nextPaidTarget === null
                    ? (en ? 'Highest paid tier reached.' : 'Максимальная оплаченная ступень достигнута.')
                    : (en ? `Next paid tier at $${nextPaidTarget}; $${Math.max(0,nextPaidTarget-account.paidSpendCents/100).toFixed(2)} remaining.`
                      : `Следующий оплаченный уровень от $${nextPaidTarget}; осталось $${Math.max(0,nextPaidTarget-account.paidSpendCents/100).toFixed(2)}.`)}
                </span>
              </>
            ) : (en
              ? 'Paid progress is unavailable until the protected VIP payment service is deployed; gifted VIP is not paid spending.'
              : 'Прогресс покупок появится после запуска защищённого платежного сервиса; подаренный VIP не считается донатом.')}
          </div>
        </div>
        {LIVE_DAILY_CHEST && daily && daily.vip>=1 && (
          <div className="mb-2 rounded-xl border border-amber-400/50 bg-black/25 p-2" data-testid="vip-daily-chest">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold text-amber-100">
              <img src={vipDailyChestSrc(daily.vip)} alt="" loading="lazy" width={46} height={40}
                className="h-10 w-12 shrink-0 object-contain" />{en?'Your daily VIP chest':'Твой ежедневный VIP-сундук'}
            </div>
            <p className="mb-1.5 text-[10px] text-amber-100/75">
              {en?'Next chest: ':'Следующий сундук: '}
              <time dateTime={daily.nextResetAt}>{new Date(daily.nextResetAt).toLocaleString(en?'en-GB':'ru-RU',{timeZone:'UTC',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} UTC</time>
            </p>
            <button type="button" onClick={() => void takeDaily()} disabled={daily.claimedToday || dailyBusy}
              className="min-h-10 w-full rounded-lg border border-amber-200/70 bg-gradient-to-b from-[#ffe2a1] to-[#b9792f] px-2 text-xs font-black text-[#281609] disabled:opacity-55">
              {dailyBusy ? (en?'Confirming…':'Подтверждаем…') : daily.claimedToday
                ? (en?'Gift claimed today':'Подарок сегодня получен')
                : (en?'Claim VIP gift':'Получить подарок')}
            </button>
            {dailyReward && <p role="status" className="mt-1 text-[11px] text-emerald-200">{dailyReward}</p>}
            {dailyError && <p role="alert" className="mt-1 text-[11px] text-red-200">{en?'Confirm the existing gift before retrying.':'Сначала проверь получение текущего подарка, затем повтори.'}</p>}
          </div>
        )}
        {LIVE_WEEKLY_CHEST && weekly && weekly.vip>=2 && (
          <div className="mb-2 rounded-xl border border-amber-400/50 bg-black/25 p-2" data-testid="vip-weekly-chest">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold text-amber-100">
              <img src={vipWeeklyChestSrc(weekly.vip)} alt="" loading="lazy" width={46} height={40}
                className="h-10 w-12 shrink-0 object-contain" />{en ? 'Your weekly VIP chest' : 'Твой еженедельный VIP-сундук'}
            </div>
            <p className="mb-1.5 text-[10px] text-amber-100/80">
              {en ? 'Resets Monday 00:00 UTC' : 'Обновление: понедельник 00:00 UTC'}
            </p>
            <p className="mb-1.5 text-[10px] text-amber-100/75">
              {en?'Next chest: ':'Следующий сундук: '}
              <time dateTime={weekly.nextResetAt}>{new Date(weekly.nextResetAt).toLocaleString(en?'en-GB':'ru-RU',{timeZone:'UTC',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} UTC</time>
            </p>
            <button type="button" onClick={() => void takeWeekly()} disabled={weekly.claimedThisWeek || weeklyBusy}
              className="min-h-10 w-full rounded-lg border border-amber-200/70 bg-gradient-to-b from-[#ffe2a1] to-[#b9792f] px-2 text-xs font-black text-[#281609] disabled:opacity-55">
              {weeklyBusy ? (en ? 'Confirming…' : 'Подтверждаем…') : weekly.claimedThisWeek
                ? (en ? 'Weekly gift claimed' : 'Недельный подарок получен')
                : (en ? 'Claim weekly gift' : 'Получить недельный подарок')}
            </button>
            {weeklyReward && <p role="status" className="mt-1 text-[11px] text-emerald-200">{weeklyReward}</p>}
            {weeklyError && <p role="alert" className="mt-1 text-[11px] text-red-200">
              {en ? 'Check existing gift before retrying.' : 'Перед повтором проверь получение подарка.'}
            </p>}
          </div>
        )}
        {(LIVE_DAILY_CHEST || LIVE_WEEKLY_CHEST) && history && history.length>0 && (
          <details className="my-2 rounded-lg border border-amber-300/20 bg-black/25 p-2">
            <summary className="cursor-pointer text-[11px] font-bold text-amber-100">
              {en?'Received VIP gifts':'История VIP-подарков'} · {history.length}
            </summary>
            <div className="mt-1 max-h-36 space-y-1 overflow-y-auto">
              {history.map((entry,i)=><div key={entry.source+entry.period+i}
                className="flex justify-between gap-2 border-t border-amber-200/10 py-1 text-[10px] text-amber-100/85">
                <span>{entry.source==='weekly'?(en?'Weekly':'Недельный'):(en?'Daily':'Дневной')}
                  {' · '}{entry.period}{' · VIP '}{entry.vip}</span>
                <span className="text-right">+{entry.gold} {en?'gold':'зол.'}, +{entry.gems} {en?'gems':'алм.'},
                  +{entry.stones} {en?'stones':'кам.'}{entry.materials>0?', +'+entry.materials+(en?' mats':' мат.'):''}</span>
              </div>)}
            </div>
          </details>
        )}
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={en ? 'Explore VIP tiers' : 'Уровни VIP'} data-testid="vip-tier-selector">
          {VIP_TIERS.slice(1).map(tier => {
            const reached = level >= tier.level;
            const selected = tier.level === inspected.level;
            return (
              <button type="button" key={tier.level} onClick={() => setSelectedLevel(tier.level)}
                aria-pressed={selected} data-testid={`vip-tier-${tier.level}`}
                className={`flex min-h-12 min-w-[65px] shrink-0 flex-col items-center justify-center rounded-lg border px-1.5 py-1 text-center ${selected ? 'border-amber-200 bg-[#8e602b] text-amber-50' : reached ? 'border-amber-400/45 bg-amber-500/10 text-amber-100' : 'border-white/10 bg-black/20 text-amber-200/70'}`}>
                <img src={vipBadgeSrc(tier.level)} alt="" loading="lazy" width={29} height={29}
                  className={`h-7 w-7 object-contain ${reached?'':'opacity-60 grayscale'}`}/>
                <strong className="text-[11px] font-black">VIP {tier.level}</strong>
              </button>
            );
          })}
        </div>
        <div className="rounded-lg border border-amber-300/20 bg-black/25 p-2" data-testid="vip-tier-detail" aria-live="polite">
          <strong className="text-xs font-black text-[#ffdf98]">
            VIP {inspected.level} · {en ? inspected.nameEn : inspected.nameRu}
          </strong>
          <p className="mt-1 text-[11px] text-amber-100/90">
            {en ? `Planned PvE gold and XP bonus: +${inspected.goldXpBonusPercent}%`
              : `Планируемый бонус золота и опыта PvE: +${inspected.goldXpBonusPercent}%`}
          </p>
          <p className="mt-1 text-[11px] text-amber-100/80">{en ? inspected.perkEn : inspected.perkRu}</p>
          <p className="mt-1 text-[10px] text-amber-200/70">
            {en ? `Cumulative paid-tier target: $${inspected.usd} (not an active checkout)`
              : `Ориентир покупок для ступени: $${inspected.usd} (покупка пока недоступна)`}
          </p>
        </div>
        <p className="mt-2 text-[10px] text-gray-300">
          {en
            ? 'VIP bonuses and paid upgrades appear only after the protected reward and payment services are deployed. No purchase is available here.'
            : 'Бонусы и платное повышение появятся после запуска защищённой системы наград и платежей. Сейчас покупок здесь нет.'}
        </p>
      </div>
    </details>
  );
}
