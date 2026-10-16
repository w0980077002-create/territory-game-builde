import { Coins, Crown, LogOut, MessageCircle, ShieldX, Sparkles, Timer, Trophy } from 'lucide-react';
import type { ArenaReward } from '@/game/arenaApi';
import { useLanguage } from '@/game/i18n';
import { VictorySparks } from './VictorySparks';

export function formatPostFightTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** Inline post-fight summary intentionally never uses a full-screen portal:
 * the arena chat remains in normal document flow, focusable and scrollable.
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
  return (
    <section
      aria-label={language === 'en' ? 'Arena battle result' : 'Результат боя на арене'}
      className={`relative overflow-hidden rounded-[22px] border-2 p-3 shadow-2xl ${won
        ? 'border-amber-300/80 bg-gradient-to-br from-[#322006] via-[#102047] to-[#092e46] shadow-amber-800/30'
        : draw
          ? 'border-violet-300/75 bg-gradient-to-br from-[#25174d] via-[#13254c] to-[#092b40] shadow-violet-800/30'
          : 'border-rose-400/80 bg-gradient-to-br from-[#441322] via-[#24112e] to-[#101932] shadow-rose-900/30'
      }`}
    >
      {won && <VictorySparks />}
      <div aria-hidden="true" className={`pointer-events-none absolute -right-8 -top-14 h-40 w-40 rounded-full blur-2xl ${good ? 'bg-cyan-400/25' : 'bg-rose-500/25'}`} />
      <div aria-hidden="true" className={`pointer-events-none absolute -left-12 top-10 h-40 w-40 rounded-full blur-2xl ${good ? 'bg-amber-400/20' : 'bg-orange-500/15'}`} />
      <div className="relative flex items-center gap-3">
        <span className={`flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_15px_rgba(0,0,0,0.4)] ${good
          ? 'border-amber-200 bg-gradient-to-b from-yellow-300 via-amber-400 to-orange-700'
          : 'border-rose-300 bg-gradient-to-b from-red-400 via-rose-700 to-red-950'
        }`}>
          {won ? <Trophy className="h-8 w-8 text-[#422306] drop-shadow-[0_1px_1px_rgba(255,255,255,0.55)]" />
            : draw ? <Crown className="h-8 w-8 text-[#422306]" />
              : <ShieldX className="h-8 w-8 text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.45)]" />}
        </span>
        <div className="min-w-0">
          <p className={`text-[9px] font-bold uppercase tracking-[0.2em] ${good ? 'text-sky-200' : 'text-rose-200'}`}>
            {language === 'en' ? 'Arena · Battle complete' : 'Арена · Бой завершён'}
          </p>
          <h2 className={`text-2xl font-black tracking-[0.08em] drop-shadow-[0_2px_8px_rgba(0,0,0,0.75)] ${good ? 'text-yellow-200' : 'text-rose-200'}`}>
            {title}
          </h2>
          <p className="text-[11px] text-white/85">{won
            ? (language === 'en' ? 'The glory is yours!' : 'Твоя победа — твоя слава!')
            : draw ? (language === 'en' ? 'An epic clash!' : 'Достойная битва!')
              : (language === 'en' ? 'Rise again, warrior!' : 'Поднимайся, воин!')}</p>
        </div>
      </div>

      <div className="relative mt-3 grid grid-cols-4 gap-1.5">
        {[
          { icon: Coins, caption: language === 'en' ? 'Gold' : 'Монеты', value: reward ? `+${reward.gold}` : '…', color: 'text-yellow-200', border: 'border-amber-300/35' },
          { icon: Sparkles, caption: language === 'en' ? 'XP' : 'Опыт', value: reward ? `+${reward.xp}` : '…', color: 'text-cyan-200', border: 'border-cyan-300/35' },
          { icon: Trophy, caption: language === 'en' ? 'Rating' : 'Рейтинг', value: shownRating === null ? '…' : `${shownRating > 0 ? '+' : ''}${shownRating}`, color: 'text-violet-200', border: 'border-violet-300/35' },
          { icon: Crown, caption: language === 'en' ? 'Kills' : 'Убито', value: reward ? String(reward.kills) : '…', color: 'text-rose-200', border: 'border-rose-300/35' },
        ].map(({ icon: Icon, caption, value, color, border }) => (
          <div key={caption} className={`min-w-0 rounded-xl border ${border} bg-black/40 px-1 py-2 text-center shadow-inner shadow-black/35`}>
            <Icon aria-hidden="true" className={`mx-auto mb-0.5 h-[18px] w-[18px] ${color}`} />
            <div className="text-[9px] text-white/70">{caption}</div>
            <div className={`text-sm font-black tabular-nums ${color}`}>{value}</div>
          </div>
        ))}
      </div>
      <div className="relative mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-sky-300/25 bg-[#031b31]/80 px-2.5 py-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-sky-100">
            <MessageCircle className="h-3.5 w-3.5 text-cyan-300" />
            {language === 'en' ? 'Chat remains open' : 'Чат открыт после боя'}
          </p>
          <p className="text-[10px] text-sky-200/70">{language === 'en' ? 'Chat below. Leave anytime.' : 'Общайся ниже или выйди раньше.'}</p>
        </div>
        <span className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 font-mono text-sm font-black tabular-nums ${deadlineReady && remainingSeconds <= 300
          ? 'border-red-400/50 bg-red-950/70 text-red-200'
          : 'border-cyan-300/40 bg-sky-950/75 text-cyan-200'
        }`}>
          <Timer className="h-4 w-4" />
          {deadlineReady ? formatPostFightTime(remainingSeconds) : '--:--'}
        </span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onLeave}
        className="relative mt-2.5 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/50 bg-gradient-to-b from-[#2088ec] to-[#123eaf] text-sm font-extrabold text-white shadow-[0_5px_14px_rgba(3,13,49,0.75)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" />{language === 'en' ? 'Leave arena' : 'Покинуть арену'}
      </button>
    </section>
  );
}
