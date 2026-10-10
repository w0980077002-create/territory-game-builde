import { Dice5, Lock, Sparkles, Dices, Swords, Target, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLanguage } from '@/game/i18n';

interface GameCard {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  gradient: string;
  accent: string;
  locked?: boolean;
}

const GAMES: GameCard[] = [
  {
    id: 'monopoly',
    title: 'Монополия',
    subtitle: 'Бросай кубик и собирай награды',
    icon: Dice5,
    gradient: 'from-emerald-600/30 via-teal-900/20 to-[#0f1115]',
    accent: 'text-emerald-300',
  },
  {
    id: 'dice-duel',
    title: 'Кости Судьбы',
    subtitle: 'Сразись с удачей',
    icon: Dices,
    gradient: 'from-sky-600/25 via-sky-900/15 to-[#0f1115]',
    accent: 'text-sky-300',
    locked: true,
  },
  {
    id: 'tower',
    title: 'Башня Испытаний',
    subtitle: 'Поднимайся выше',
    icon: Swords,
    gradient: 'from-amber-600/25 via-amber-900/15 to-[#0f1115]',
    accent: 'text-amber-300',
    locked: true,
  },
  {
    id: 'targets',
    title: 'Меткий Стрелок',
    subtitle: 'Проверь свою точность',
    icon: Target,
    gradient: 'from-rose-600/25 via-rose-900/15 to-[#0f1115]',
    accent: 'text-rose-300',
    locked: true,
  },
  {
    id: 'jackpot',
    title: 'Джекпот',
    subtitle: 'Крути и выигрывай',
    icon: Trophy,
    gradient: 'from-violet-600/25 via-violet-900/15 to-[#0f1115]',
    accent: 'text-violet-300',
    locked: true,
  },
];

export function GamesScreen({ onPlay }: { onPlay: (gameId: string) => void }) {
  const { t, language } = useLanguage();
  return (
    <div className="space-y-4 animate-fade-in pb-2">
      <div className="relative rounded-2xl overflow-hidden border border-emerald-500/20 p-4">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/30 via-[#16130d] to-[#0f1115]" />
        <div className="relative flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400/80 to-teal-700/80 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-emerald-100">{t('gameHall')}</h2>
            <p className="text-xs text-gray-400">{t('gameHallHint')}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {GAMES.map((game, idx) => {
          const Icon = game.icon;
          const isLarge = idx === 0;
          return (
            <button
              key={game.id}
              onClick={() => !game.locked && onPlay(game.id)}
              disabled={game.locked}
              className={`relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${game.gradient} ${isLarge ? 'col-span-2' : ''} ${game.locked ? 'cursor-not-allowed' : 'active:scale-[0.97]'} transition-all hover:brightness-110 ${isLarge ? 'h-36' : 'h-32'} flex flex-col justify-between p-4 text-left`}
            >
              <div className="flex items-start justify-between">
                <div className={`w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center ${game.accent}`}>
                  <Icon className="w-6 h-6" />
                </div>
                {game.locked && (
                  <div className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-[10px] font-bold uppercase text-gray-400">
                    <Lock className="w-3 h-3" /> {t('comingSoon')}
                  </div>
                )}
              </div>
              <div>
                <h3 className={`font-bold ${isLarge ? 'text-xl' : 'text-sm'} text-white`}>{t(({ monopoly: 'gameMonopoly', 'dice-duel': 'gameDice', tower: 'gameTower', targets: 'gameTargets', jackpot: 'gameJackpot' } as Record<string, string>)[game.id] ?? game.title)}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{t(({ monopoly: 'gameMonopolyHint', 'dice-duel': 'gameDiceHint', tower: 'gameTowerHint', targets: 'gameTargetsHint', jackpot: 'gameJackpotHint' } as Record<string, string>)[game.id] ?? game.subtitle)}</p>
                {!game.locked && (
                  <span className={`mt-2 inline-flex items-center gap-1 text-xs font-bold ${game.accent}`}>
                    {t('play')} <Dice5 className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>
              {game.locked && (
                <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] pointer-events-none" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
