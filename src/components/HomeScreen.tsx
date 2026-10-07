import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { generateChapter } from '@/game/engine';
import { Heart, Sword, Shield, Zap, Star, Coins, Gem } from 'lucide-react';
import type { ReactNode } from 'react';

export function HomeScreen() {
  const state = useStore(useGame);
  const chapter = generateChapter(state.currentChapter);
  const progressPct = Math.min(100, (state.chapterWins / chapter.winsNeeded) * 100);

  const follower = state.followers.find((f) => f.unlocked);

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      {/* Hero card */}
      <div className="card relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-900/20 to-transparent" />
        <div className="relative flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-teal-400 to-teal-700 flex items-center justify-center text-3xl shrink-0 animate-float">
            🦸
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-white truncate">{state.player.name}</h2>
            <p className="text-sm text-gray-400">Уровень {state.player.level}</p>
            <div className="mt-1.5">
              <div className="flex justify-between text-xs text-gray-400 mb-0.5">
                <span>Опыт</span>
                <span>{state.player.xp} / {state.player.xpToNext}</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill bg-gradient-to-r from-teal-400 to-teal-500"
                  style={{ width: `${(state.player.xp / state.player.xpToNext) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Resources */}
      <div className="grid grid-cols-3 gap-2">
        <ResourcePill icon={<Coins className="w-4 h-4" />} label="Золото" value={state.player.gold} color="text-amber-400" />
        <ResourcePill icon={<Gem className="w-4 h-4" />} label="Кристаллы" value={state.player.gems} color="text-cyan-400" />
        <ResourcePill icon={<Zap className="w-4 h-4" />} label="Энергия" value={`${state.player.energy}/${state.player.maxEnergy}`} color="text-yellow-400" />
      </div>

      {/* Stats */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">Характеристики</h3>
        <div className="grid grid-cols-2 gap-3">
          <StatRow icon={<Heart className="w-4 h-4 text-red-400" />} label="Здоровье" value={`${state.player.stats.hp}/${state.player.stats.maxHp}`} />
          <StatRow icon={<Sword className="w-4 h-4 text-orange-400" />} label="Атака" value={state.player.stats.attack} />
          <StatRow icon={<Shield className="w-4 h-4 text-blue-400" />} label="Защита" value={state.player.stats.defense} />
          <StatRow icon={<Star className="w-4 h-4 text-yellow-400" />} label="Крит" value={`${state.player.stats.critChance}%`} />
        </div>
      </div>

      {/* Chapter progress */}
      <div className="card">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-base font-bold text-white">Глава {state.currentChapter}</h3>
          <span className="text-xs text-gray-400">{chapter.title}</span>
        </div>
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Победы: {state.chapterWins} / {chapter.winsNeeded}</span>
            <span>{Math.round(progressPct)}%</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill bg-gradient-to-r from-amber-400 to-amber-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Победи {chapter.winsNeeded} обычных врагов, чтобы открыть босса.
          {progressPct >= 100 && <span className="text-amber-400 font-semibold"> Босс готов к бою!</span>}
        </p>
      </div>

      {/* Follower */}
      {follower && (
        <div className="card flex items-center gap-3 animate-pop">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/30 to-indigo-700/30 flex items-center justify-center text-2xl">
            {follower.icon}
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-white">{follower.name}</h4>
            <p className="text-xs text-gray-400">Уровень {follower.level} · Атака +{follower.attack}</p>
          </div>
          <div className="text-xs text-teal-400 font-semibold">Активен</div>
        </div>
      )}

      {/* Total stats */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">Статистика</h3>
        <div className="grid grid-cols-3 gap-3 text-center">
          <StatBox label="Побед" value={state.totalBattlesWon} />
          <StatBox label="Боссов" value={state.totalBossesDefeated} />
          <StatBox label="Глава" value={state.currentChapter} />
        </div>
      </div>
    </div>
  );
}

function ResourcePill({ icon, label, value, color }: { icon: ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="card flex flex-col items-center py-3">
      <div className={`flex items-center gap-1 ${color}`}>
        {icon}
        <span className="font-bold text-sm">{value}</span>
      </div>
      <span className="text-xs text-gray-500 mt-0.5">{label}</span>
    </div>
  );
}

function StatRow({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-white ml-auto">{value}</span>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
