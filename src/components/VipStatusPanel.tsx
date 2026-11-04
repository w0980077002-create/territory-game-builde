import { Crown, Check, LockKeyhole, ShieldCheck, Gift } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchVipDailyStatus, claimVipDaily, recoverVipDaily, type VipDailyStatus } from '@/game/vipDaily';
import { useStore } from '@/game/store';
import { useAccount } from '@/game/actions';
import { useLanguage } from '@/game/i18n';
import { VIP_TIERS, vipTier, vipNextThreshold } from '@/game/vipProgram';

/** Prestige page renders only actual permanent entitlement from the server.
 * The amount of donated money is deliberately NOT inferred from gift VIP levels.
 * Payment checkout stays unavailable until a verified provider integration.
 */
const LIVE_DAILY_CHEST = import.meta.env.VITE_VIP_DAILY_ENABLED === 'true';

export function VipStatusPanel({ userId }: { userId:string }) {
  const account = useStore(useAccount);
  const [daily,setDaily] = useState<VipDailyStatus|null>(null);
  const [dailyBusy,setDailyBusy]=useState(false);
  const [dailyError,setDailyError]=useState('');
  const [dailyReward,setDailyReward]=useState('');
  const { language } = useLanguage();
  const en = language === 'en';
  const level = Math.max(0, Math.min(10, account.permanentVip));
  const current = vipTier(level);
  const next = vipNextThreshold(level);
  useEffect(() => {
    if (!LIVE_DAILY_CHEST || !userId) return;
    let active=true;
    void fetchVipDailyStatus(userId).then(status => {
      if (active) setDaily(status);
    }).catch(() => {if (active) setDailyError('unavailable');});
    return () => {active=false;};
  },[userId]);
  const takeDaily = async () => {
    if(!LIVE_DAILY_CHEST || dailyBusy || daily?.claimedToday || level<1)return;
    setDailyBusy(true); setDailyError('');
    try {
      const recovered=await recoverVipDaily(userId);
      const reward=recovered ?? await claimVipDaily(userId);
      setDailyReward(en
        ? `+ ${reward.gold} gold, ${reward.gems} gems, ${reward.stones} stones`
        : `+ ${reward.gold} золота, ${reward.gems} самоцветов, ${reward.stones} камней`);
      setDaily(prev=>prev?{...prev,claimedToday:true}:prev);
    }catch {
      setDailyError('retry');
    }finally {setDailyBusy(false);}
  };

  return (
    <details className="group rounded-2xl border-2 border-[#9e6831] bg-[linear-gradient(140deg,#4b2c1b,#231710_65%,#402719)] p-2.5 shadow-[inset_0_1px_0_#f3c77c50,0_4px_14px_#0007]" data-testid="vip-status-panel">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-300/70 bg-[#4d2d12] text-amber-200"><Crown size={23}/></span>
        <span className="min-w-0 flex-1">
          <strong className="block text-sm font-black text-[#ffdf98]">{en ? 'VIP Program' : 'Программа VIP'} · {level}/10</strong>
          <span className="block truncate text-[11px] text-amber-100/85">{en ? current.nameEn : current.nameRu}</span>
        </span>
        <span className="text-amber-200 group-open:hidden">▾</span>
        <span className="hidden text-amber-200 group-open:inline">▴</span>
      </summary>
      <div className="border-t border-amber-500/25 pt-2">
        <p className="mb-2 text-[11px] leading-relaxed text-amber-100/85">
          {en
            ? 'Your VIP status is permanent. A promotional grant does not count as paid spending.'
            : 'Твой VIP-статус постоянный. Подарочный VIP не считается оплаченным донатом.'}
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-amber-300/20 bg-black/25 px-2 py-1.5">
          <ShieldCheck className="h-4 w-4 shrink-0 text-amber-300"/>
          <p className="text-[11px] text-amber-100">
            {next === null
              ? (en ? 'Maximum prestige achieved' : 'Высшая ступень престижа достигнута')
              : (en ? `Next tier target: $${next} in confirmed cumulative purchases` : `Порог следующей ступени: $${next} подтверждённых покупок суммарно`)}
          </p>
        </div>
        {LIVE_DAILY_CHEST && daily && level>=1 && (
          <div className="mb-2 rounded-xl border border-amber-400/50 bg-black/25 p-2" data-testid="vip-daily-chest">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold text-amber-100">
              <Gift size={16}/>{en?'Your daily VIP chest':'Твой ежедневный VIP-сундук'}
            </div>
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
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {VIP_TIERS.slice(1).map(tier => {
            const reached = level >= tier.level;
            return (
              <div key={tier.level} className={`flex min-w-0 items-start gap-1.5 rounded-lg border p-2 text-left ${reached ? 'border-amber-400/45 bg-amber-500/10' : 'border-white/10 bg-black/20'}`}>
                {reached ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300"/> : <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-amber-700"/>}
                <span className="min-w-0">
                  <strong className={`block text-[11px] font-black ${reached ? 'text-amber-100' : 'text-amber-200/70'}`}>VIP {tier.level} · $${tier.usd}</strong>
                  <small className="block text-[10px] leading-tight text-amber-100/80">{en ? tier.nameEn : tier.nameRu}</small>
                </span>
              </div>
            );
          })}
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
