import { Coins, Crown, LogOut, MessageCircle, ShieldX, Sparkles, Timer, Trophy } from 'lucide-react';
import type { ArenaReward } from '@/game/arenaApi';
import { useLanguage } from '@/game/i18n';
import { VictorySparks } from './VictorySparks';

export function formatPostFightTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * Arena Result Lux: a vivid, ultra-compact 3-row fantasy HUD rendered INSIDE
 * the battle scene. Never a portal and never pushes down or blocks chat.
 */
export function ArenaResultCard({
  won, draw, reward, alreadyRewarded = false, ratingChange, remainingSeconds, deadlineReady, busy, onLeave,
}: {
  won: boolean;
  draw: boolean;
  reward: ArenaReward | null;
  alreadyRewarded?: boolean;
  ratingChange: number | null;
  remainingSeconds: number;
  deadlineReady: boolean;
  busy: boolean;
  onLeave: () => void;
}) {
  const { language } = useLanguage();
  const title = won ? (language === 'en' ? 'VICTORY!' : 'ПОБЕДА!')
    : draw ? (language === 'en' ? 'DRAW!' : 'НИЧЬЯ!')
      : (language === 'en' ? 'DEFEAT!' : 'ПОРАЖЕНИЕ!');
  const shownRating = reward?.ratingChange ?? ratingChange;
  // A rewarded player may return after a reload: don't fabricate missing
  // gold/XP figures or leave loading dots forever for already-paid rewards.
  const pendingValue = alreadyRewarded ? '✓' : '…';
  const stats = [
    { icon: Coins, label: language === 'en' ? 'Coins' : 'Монеты', value: reward ? `+${reward.gold}` : pendingValue, style: 'gold' },
    { icon: Sparkles, label: language === 'en' ? 'XP' : 'Опыт', value: reward ? `+${reward.xp}` : pendingValue, style: 'xp' },
    { icon: Trophy, label: language === 'en' ? 'Rating' : 'Рейтинг', value: shownRating === null ? pendingValue : `${shownRating > 0 ? '+' : ''}${shownRating}`, style: 'rating' },
    { icon: Crown, label: language === 'en' ? 'Kills' : 'Убито', value: reward ? String(reward.kills) : pendingValue, style: 'kills' },
  ];
  return (
    <section
      aria-label={language === 'en' ? 'Arena battle result' : 'Результат боя на арене'}
      className={`arena-result-lux arena-result-lux-${won ? 'win' : draw ? 'draw' : 'loss'} absolute inset-x-2 bottom-1.5 z-40 mx-auto max-w-[490px] overflow-hidden rounded-2xl border-2 px-2.5 py-2 backdrop-blur-md`}
    >
      <span aria-hidden="true" className="arena-result-lux-sheen pointer-events-none absolute inset-0" />
      {won && <VictorySparks />}
      <div className="relative z-10 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="arena-result-lux-medal flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
            {won ? <Trophy aria-hidden="true" className="h-[21px] w-[21px]" /> : draw
              ? <Crown aria-hidden="true" className="h-[21px] w-[21px]" />
              : <ShieldX aria-hidden="true" className="h-[21px] w-[21px]" />}
          </span>
          <h2 className="arena-result-lux-title truncate text-[clamp(16px,4.8vw,23px)] font-black leading-none tracking-[0.06em]">
            {title}
          </h2>
        </div>
        <span
          title={language === 'en' ? 'Time left to chat after the battle' : 'Осталось времени для общения после боя'}
          className={`arena-result-lux-timer flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 font-mono text-xs font-black tabular-nums ${
            deadlineReady && remainingSeconds <= 300 ? 'arena-result-lux-ending' : ''
          }`}
        >
          <MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />
          <Timer aria-hidden="true" className="h-3 w-3" />
          {deadlineReady ? formatPostFightTime(remainingSeconds) : '--:--'}
        </span>
      </div>
      <div className="relative z-10 mt-1.5 grid grid-cols-4 gap-1.5">
        {stats.map(({ icon: Icon, label, value, style }) => (
          <div
            key={style}
            title={label}
            aria-label={`${label}: ${value}`}
            className={`arena-result-lux-reward arena-result-lux-reward-${style} flex min-w-0 items-center justify-center gap-1 rounded-lg border px-0.5 py-1.5`}
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="truncate text-[13px] font-black tabular-nums leading-none">{value}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onLeave}
        className="arena-result-lux-leave relative z-10 mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border text-[12px] font-black tracking-wide text-white transition active:scale-[0.98] disabled:opacity-50"
      >
        <LogOut aria-hidden="true" className="h-3.5 w-3.5" />
        {language === 'en' ? 'Leave arena' : 'Покинуть арену'}
      </button>
    </section>
  );
}
