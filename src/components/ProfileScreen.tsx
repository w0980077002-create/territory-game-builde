import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { getComputedStats, EQUIPMENT_SLOTS } from '@/game/engine';
import { rarityColor } from '@/game/ui';
import { User, Heart, Sword, Shield, Star, Zap, Coins, Gem } from 'lucide-react';
import type { ReactNode } from 'react';

export function ProfileScreen() {
  const state = useStore(useGame);
  const computed = getComputedStats(state);

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      {/* Profile header */}
      <div className="card relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-900/30 to-transparent" />
        <div className="relative flex flex-col items-center text-center py-2">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal-400 to-teal-700 flex items-center justify-center text-4xl mb-3 animate-float">
            🦸
          </div>
          <h2 className="text-xl font-bold text-white">{state.player.name}</h2>
          <p className="text-sm text-gray-400">Уровень {state.player.level}</p>
          <div className="flex gap-3 mt-3 text-sm">
            <span className="flex items-center gap-1 text-amber-400">
              <Coins className="w-4 h-4" /> {state.player.gold}
            </span>
            <span className="flex items-center gap-1 text-cyan-400">
              <Gem className="w-4 h-4" /> {state.player.gems}
            </span>
            <span className="flex items-center gap-1 text-yellow-400">
              <Zap className="w-4 h-4" /> {state.player.energy}/{state.player.maxEnergy}
            </span>
          </div>
        </div>
      </div>

      {/* Base stats */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">Базовые характеристики</h3>
        <div className="grid grid-cols-2 gap-3">
          <StatBox icon={<Heart className="w-4 h-4 text-red-400" />} label="Здоровье" value={`${state.player.stats.maxHp}`} />
          <StatBox icon={<Sword className="w-4 h-4 text-orange-400" />} label="Атака" value={state.player.stats.attack} />
          <StatBox icon={<Shield className="w-4 h-4 text-blue-400" />} label="Защита" value={state.player.stats.defense} />
          <StatBox icon={<Star className="w-4 h-4 text-yellow-400" />} label="Крит шанс" value={`${state.player.stats.critChance}%`} />
        </div>
      </div>

      {/* Computed stats (with equipment) */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">С учётом экипировки</h3>
        <div className="grid grid-cols-2 gap-3">
          <StatBox icon={<Heart className="w-4 h-4 text-red-400" />} label="Здоровье" value={`${computed.maxHp}`} />
          <StatBox icon={<Sword className="w-4 h-4 text-orange-400" />} label="Атака" value={computed.attack} />
          <StatBox icon={<Shield className="w-4 h-4 text-blue-400" />} label="Защита" value={computed.defense} />
          <StatBox icon={<Star className="w-4 h-4 text-yellow-400" />} label="Крит шанс" value={`${computed.critChance}%`} />
        </div>
      </div>

      {/* Equipment */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">Экипировка</h3>
        <div className="space-y-2">
          {EQUIPMENT_SLOTS.map(({ id: slot, name }) => {
            const eq = state.player.equipped[slot];
            return (
              <div key={slot} className="flex items-center gap-3 py-1">
                <div className="w-10 h-10 rounded-lg bg-black/30 flex items-center justify-center text-lg shrink-0"
                  style={eq ? { border: `1px solid ${rarityColor(eq.rarity)}` } : undefined}
                >
                  {eq ? eq.icon : '⬜'}
                </div>
                <div className="flex-1">
                  <p className="text-xs text-gray-500">{name}</p>
                  {eq ? (
                    <p className="text-sm font-medium" style={{ color: rarityColor(eq.rarity) }}>
                      {eq.name}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-600">Пусто</p>
                  )}
                </div>
                {eq && (
                  <div className="text-xs text-gray-400 text-right">
                    {eq.attack ? <div>⚔️ +{eq.attack}</div> : null}
                    {eq.defense ? <div>🛡️ +{eq.defense}</div> : null}
                    {eq.hp ? <div>❤️ +{eq.hp}</div> : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Battle record */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">Боевой путь</h3>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-2xl font-bold text-white">{state.totalBattlesWon}</div>
            <div className="text-xs text-gray-500">Побед</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-400">{state.totalBossesDefeated}</div>
            <div className="text-xs text-gray-500">Боссов</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-teal-400">{state.currentChapter}</div>
            <div className="text-xs text-gray-500">Глава</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2">
      {icon}
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}
