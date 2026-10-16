import { Coins, Crown, LogOut, MessageCircle, ShieldX, Sparkles, Timer, Trophy } from 'lucide-react';
import type { ArenaReward } from '@/game/arenaApi';
import { useLanguage } from '@/game/i18n';
import { VictorySparks } from './VictorySparks';

export function formatPostFightTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * Compact HUD anchored INSIDE the arena battlefield, never in a modal and
 * never between the battle scene and the scrollable chat below it.
 * Keeps battle result and rewards readable at 320px Telegram WebView width.
 */
export function ArenaResultCard({
  won, draw, reward, ratingChange, remainingSeconds, deadlineReady, busy, onLeave,
}: {
  won: boolean;
  draw: boolean;
  reward: ArenaReward | null;
  ratingChange: number | null;
  remainingSeconds: number;
  deadlineReady: boolean;
  busy: boolean;
  onLeave: () => void;
}) {
  const { language } = useLanguage();
  const good = won || draw;
  const title = won ? (language === 'en' ? 'VICTORY!' : 'ПОБЕДА!')
    : draw ? (language === 'en' ? 'DRAW!' : 'НИЧЬЯ!')
      : (language === 'en' ? 'DEFEAT!' : 'ПОРАЖЕНИЕ!');
  const shownRating = reward?.ratingChange ?? ratingChange;
  const stats = [
    { icon: Coins, label: language === 'en' ? 'Gold' : 'Монеты', value: reward ? `+${reward.gold}` : '…', tint: 'text-amber-200' },
    { icon: Sparkles, label: language === 'en' ? 'XP' : 'Опыт', value: reward ? `+${reward.xp}` : '…', tint: 'text-cyan-200' },
    { icon: Trophy, label: language === 'en' ? 'Rating' : 'Рейтинг', value: shownRating === null ? '…' : `${shownRating > 0 ? '+' : ''}${shownRating}`, tint: 'text-violet-200' },
    { icon: Crown, label: language === 'en' ? 'Kills' : 'Убито', value: reward ? String(reward.kills) : '…', tint: 'text-rose-200' },
  ];

  return (
    <section
      aria-label={language === 'en' ? 'Arena battle result' : 'Результат боя на арене'}
      className={`absolute inset-x-2 bottom-1.5 z-40 mx-auto max-w-[490px] overflow-hidden rounded-2xl border px-2.5 py-2 shadow-[0_4px_22px_rgba(0,0,0,0.85)] backdrop-blur-md ${good
        ? 'border-amber-300/90 bg-gradient-to-r from-[#442a0a]/95 via-[#102848]/95 to-[#081d43]/95'
        : 'border-rose-400/90 bg-gradient-to-r from-[#491122]/95 via-[#28102f]/95 to-[#111a38]/95'
      }`}
    >
      {won && <VictorySparks />}
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {won ? <Trophy aria-hidden="true" className="h-5 w-5 shrink-0 text-yellow-300 drop-shadow-[0_0_7px_rgba(250,204,21,0.65)]" />
            : draw ? <Crown aria-hidden="true" className="h-5 w-5 shrink-0 text-violet-200" />
              : <ShieldX aria-hidden="true" className="h-5 w-5 shrink-0 text-red-300" />}
          <h2 className={`truncate text-lg font-black tracking-[0.04em] leading-tight drop-shadow-[0_2px_5px_rgba(0,0,0,0.85)] ${good ? 'text-yellow-200' : 'text-rose-200'}`}>
            {title}
          </h2>
        </div>
        <span
          title={language === 'en' ? 'Time left to chat after the battle' : 'Осталось времени для общения после боя'}
          className={`flex shrink-0 items-center gap-1 rounded-lg border px-1.5 py-0.5 font-mono text-xs font-extrabold tabular-nums ${deadlineReady && remainingSeconds <= 300
            ? 'border-red-400/50 bg-red-950/80 text-red-200'
            : 'border-sky-300/40 bg-sky-950/80 text-cyan-200'
          }`}
        >
          <MessageCircle aria-hidden="true" className="h-3 w-3" />
          <Timer aria-hidden="true" className="h-3 w-3" />
          {deadlineReady ? formatPostFightTime(remainingSeconds) : '--:--'}
        </span>
      </div>
      <div className="relative mt-1.5 grid grid-cols-4 gap-1">
        {stats.map(({ icon: Icon, label, value, tint }) => (
          <div key={label} className="flex min-w-0 items-center justify-center gap-1 rounded-md border border-white/15 bg-black/40 px-0.5 py-1" title={label}>
            <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${tint}`} />
            <span className={`truncate text-xs font-black tabular-nums ${tint}`}>{value}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onLeave}
        className="relative mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-sky-200/60 bg-gradient-to-b from-[#258ff7] to-[#1342af] text-xs font-black text-white shadow-[0_2px_10px_rgba(9,39,105,0.9)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
      >
        <LogOut aria-hidden="true" className="h-3.5 w-3.5" />
        {language === 'en' ? 'Leave arena' : 'Покинуть арену'}
      </button>
    </section>
  );
}
