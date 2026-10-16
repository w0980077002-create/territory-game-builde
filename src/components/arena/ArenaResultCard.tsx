import { Coins, Crown, LogOut, MessageCircle, ShieldX, Sparkles, Timer, Trophy } from 'lucide-react';
import type { ArenaReward } from '@/game/arenaApi';
import { useLanguage } from '@/game/i18n';
import { VictorySparks } from './VictorySparks';

export function formatPostFightTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return String(Math.floor(safe / 60)).padStart(2, '0') + ':' + String(safe % 60).padStart(2, '0');
}

/**
 * A battle-scene overlay, NOT another victory card.
 *
 * Upper part: a magical floating crest/ribbon above the fighters.
 * Lower part: a slim reward-and-exit rail near the ground.
 * The middle remains transparent so the winner and defeated enemy stay visible.
 * No full-screen modal, no added page height; chat remains immediately below.
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
  const mood = won ? 'win' : draw ? 'draw' : 'loss';
  const title = won ? (language === 'en' ? 'VICTORY!' : 'ПОБЕДА!')
    : draw ? (language === 'en' ? 'DRAW!' : 'НИЧЬЯ!')
      : (language === 'en' ? 'DEFEAT!' : 'ПОРАЖЕНИЕ!');
  const shownRating = reward?.ratingChange ?? ratingChange;
  const pending = alreadyRewarded ? '✓' : '…';
  const rewards = [
    { id: 'gold', Icon: Coins, label: language === 'en' ? 'Coins' : 'Монеты', value: reward ? '+' + reward.gold : pending },
    { id: 'xp', Icon: Sparkles, label: language === 'en' ? 'XP' : 'Опыт', value: reward ? '+' + reward.xp : pending },
    { id: 'rating', Icon: Trophy, label: language === 'en' ? 'Rating' : 'Рейтинг', value: shownRating === null ? pending : (shownRating > 0 ? '+' : '') + shownRating },
    { id: 'kills', Icon: Crown, label: language === 'en' ? 'Kills' : 'Убито', value: reward ? String(reward.kills) : pending },
  ];

  return (
    <section
      aria-label={language === 'en' ? 'Arena battle result' : 'Результат боя на арене'}
      className={'arena-result-stage arena-result-stage-' + mood + ' absolute inset-0 z-40 pointer-events-none'}
    >
      {won && <VictorySparks />}
      <div aria-hidden="true" className="arena-result-radiance absolute left-1/2 top-[64px] h-[88px] w-[90%] -translate-x-1/2" />

      {/* Do not cover the character portraits with a large card. */}
      <div className="arena-result-banner absolute left-1/2 top-[68px] z-10 flex -translate-x-1/2 items-center justify-center">
        <span aria-hidden="true" className="arena-result-wing arena-result-wing-left" />
        <div className="arena-result-banner-center relative flex items-center gap-1.5 px-2.5 py-1.5">
          <span aria-hidden="true" className="arena-result-banner-medal flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full">
            {won ? <Trophy className="h-[19px] w-[19px]" /> : draw ? <Crown className="h-[19px] w-[19px]" /> : <ShieldX className="h-[19px] w-[19px]" />}
          </span>
          <div className="min-w-0 text-center">
            <h2 className="arena-result-banner-title whitespace-nowrap text-[clamp(20px,6.3vw,29px)] font-black leading-[1.05] tracking-wide">{title}</h2>
                      </div>
        </div>
        <span aria-hidden="true" className="arena-result-wing arena-result-wing-right" />
      </div>

      {/* One narrow control rail at the bottom. Fighters remain visible above it. */}
      <div className="arena-result-footbar absolute inset-x-2 bottom-1.5 z-20 mx-auto max-w-[490px] rounded-xl border px-2 py-1.5">
        <div className="grid grid-cols-4 gap-1">
          {rewards.map(({ id, Icon, label, value }) => (
            <div
              key={id}
              title={label}
              aria-label={label + ': ' + value}
              className={'arena-result-gem arena-result-gem-' + id + ' flex min-w-0 items-center justify-center gap-0.5 rounded-lg border px-0.5 py-1'}
            >
              <Icon aria-hidden="true" className="h-[15px] w-[15px] shrink-0" />
              <span className="truncate text-xs font-black leading-none tabular-nums">{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onLeave}
            className="arena-result-leave pointer-events-auto flex h-[30px] min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[11px] font-black text-white transition active:scale-[0.98] disabled:opacity-50"
          >
            <LogOut aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            {language === 'en' ? 'Leave arena' : 'Покинуть арену'}
          </button>
          <span
            title={language === 'en' ? 'Remaining post-battle chat time' : 'Осталось времени на общение после боя'}
            className={'arena-result-chatclock flex h-[30px] shrink-0 items-center justify-center gap-1 rounded-lg border px-1.5 font-mono text-[11px] font-black tabular-nums ' + (deadlineReady && remainingSeconds <= 300 ? 'arena-result-chatclock-ending' : '')}
          >
            <MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />
            <Timer aria-hidden="true" className="h-3 w-3" />
            {deadlineReady ? formatPostFightTime(remainingSeconds) : '--:--'}
          </span>
        </div>
      </div>
    </section>
  );
}
