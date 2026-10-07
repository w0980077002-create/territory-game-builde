import { useState } from 'react';
import { useStore } from '@/game/store';
import { useGame, useArena } from '@/game/actions';
import { joinArena, type ArenaMode } from '@/game/arenaApi';
import { beltContext, takeFromBelt } from '@/game/belt';
import { hapticImpact } from '@/game/telegram';
import { BeltBar } from './BeltBar';
import { Swords, Users, Flame, Trophy, Zap, Info, X, Loader2 } from 'lucide-react';

const ENERGY_COST = 1;

const MODES: { id: ArenaMode; title: string; size: string; desc: string; bonus: string; icon: typeof Swords; tint: string }[] = [
  { id: 'duel', title: 'Дуэль', size: '1 на 1', desc: 'Классический поединок один на один', bonus: 'Награда x1', icon: Swords, tint: 'from-amber-500/25 to-orange-700/10 border-amber-500/30 text-amber-300' },
  { id: 'team', title: 'Отряд', size: '3 на 3', desc: 'Командный бой: прикрывай союзников и выбирай цели', bonus: 'Награда x1.2', icon: Users, tint: 'from-sky-500/25 to-sky-800/10 border-sky-500/30 text-sky-300' },
  { id: 'chaos', title: 'Хаос', size: 'до 20 на 20', desc: 'Случайные команды и настоящая мясорубка', bonus: 'Награда x1.5', icon: Flame, tint: 'from-red-500/25 to-red-900/10 border-red-500/30 text-red-300' },
];

export function ArenaLobby({ onJoined }: { onJoined: (roomId: string) => void }) {
  const state = useStore(useGame);
  const arena = useStore(useArena);
  const [joining, setJoining] = useState<ArenaMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const noEnergy = state.player.energy < ENERGY_COST;

  const join = async (mode: ArenaMode) => {
    if (noEnergy || joining) return;
    hapticImpact('medium');
    setJoining(mode);
    setError(null);
    try {
      const roomId = await joinArena(mode);
      useGame.set((s) => ({ ...s, player: { ...s.player, energy: Math.max(0, s.player.energy - ENERGY_COST) } }));
      onJoined(roomId);
    } catch (e) {
      setError((e as Error).message);
      setJoining(null);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      <div className="card relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-red-900/30 via-transparent to-amber-900/20 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Swords className="w-6 h-6 text-red-400" />
              <h2 className="text-xl font-bold text-white">Арена</h2>
            </div>
            <button onClick={() => setShowRules(true)} className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors">
              <Info className="w-4 h-4" /> Правила
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Рейтинг" value={arena.rating} className="text-amber-400" />
            <Stat label="Победы" value={arena.wins} className="text-emerald-400" />
            <Stat label="Поражения" value={arena.losses} className="text-red-400" />
          </div>
          <div className="flex justify-center gap-4 mt-3 text-xs text-gray-400">
            <span className="flex items-center gap-1 text-yellow-400"><Zap className="w-3 h-3" /> {state.player.energy}/{state.player.maxEnergy}</span>
          </div>
        </div>
      </div>

      <div className="card p-3">
        <div className="flex items-center justify-between mb-2 px-0.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-300">Пояс с зельями</h3>
          <span className="text-[10px] text-gray-500">в бою доступно только то, что на поясе</span>
        </div>
        <BeltBar
          belt={state.belt}
          ctx={beltContext(state, arena.wins)}
          actionLabel="Нажми на зелье, чтобы вернуть его в сумку. Положить — в инвентаре."
          onAction={(i) => useGame.set((s) => takeFromBelt(s, i))}
        />
      </div>

      {noEnergy && (
        <div className="card text-center text-sm text-amber-400">Не хватает энергии. 1 единица восстанавливается каждые 5 минут.</div>
      )}
      {error && <div className="card text-center text-sm text-red-400">{error}</div>}

      <div className="space-y-3">
        {MODES.map((m) => {
          const Icon = m.icon;
          const isJoining = joining === m.id;
          return (
            <button
              key={m.id}
              disabled={noEnergy || !!joining}
              onClick={() => join(m.id)}
              className={`w-full text-left rounded-2xl p-4 border bg-gradient-to-br ${m.tint} transition-all hover:brightness-125 active:scale-[0.98] disabled:opacity-50 disabled:hover:brightness-100`}
            >
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-black/30 flex items-center justify-center shrink-0">
                  {isJoining ? <Loader2 className="w-7 h-7 animate-spin" /> : <Icon className="w-7 h-7" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-lg font-bold text-white">{m.title}</h3>
                    <span className="text-sm font-semibold">{m.size}</span>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">{m.desc}</p>
                  <p className="text-[11px] text-gray-400 mt-1">{m.bonus} · {ENERGY_COST} энергия</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="bg-black/25 rounded-lg py-2">
      <div className={`text-lg font-bold ${className}`}>{value}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  const rules = [
    'Каждый раунд выбери цель, 2 из 4 зон защиты слева и 1 зону удара справа, затем жми «УДАР».',
    'Удар в заблокированную зону не проходит. Критический удар пробивает блок, но слабее.',
    'Удар в голову сильнее (×1.25), по ногам слабее (×0.85).',
    'На ход даётся тайм — 60 сек. Не успел сходить — выбываешь из боя по тайму.',
    'Зелье времени сокращает тайм на 10 сек., но не меньше 30 сек.',
    'В бою работает только то, что лежит на поясе: до 5 шт. в слоте, одно зелье за раунд, каждый эликсир — один раз за бой.',
    'Иногда боец успевает увернуться от удара — даже если зона не закрыта.',
    'Павший остаётся в комнате до конца боя. Союзник может вернуть его адреналином.',
    'Автобой: сервер бьёт за тебя, даже если ты свернул игру.',
    'После боя чат остаётся, пока ты не покинешь комнату.',
  ];
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-md animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-white flex items-center gap-2"><Trophy className="w-5 h-5 text-amber-400" /> Как проходит бой</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <ol className="space-y-2">
          {rules.map((r, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-300 leading-relaxed">
              <span className="w-5 h-5 rounded-full bg-teal-500/20 text-teal-300 text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              {r}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
