import { assetUrl } from '@/game/assets';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lock, Crown, Swords, Mountain, Heart, Sword as SwordIcon, ShoppingBag } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { generateChapter, generateTrial, PVE_STONE_COST } from '@/game/engine';
import { trialReward, blessedGold } from '@/game/progression';
import { beginPveBattle } from '@/game/pveApi';
import { hapticImpact } from '@/game/telegram';
import type { Enemy } from '@/game/types';
import { PveFight, type FightKind } from './pve/PveFight';
import { Currency } from './ui/Currency';

export type BattleView = 'campaign' | 'trial';

interface Props {
  view: BattleView;
  onView: (v: BattleView) => void;
  autoStart: boolean;
  onAutoStartHandled: () => void;
  onShop: () => void;
}

export function BattleScreen({ view, onView, autoStart, onAutoStartHandled, onShop }: Props) {
  const state = useStore(useGame);
  const [fight, setFight] = useState<{ enemy: Enemy; kind: FightKind; battleId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chapter = useMemo(() => generateChapter(state.currentChapter), [state.currentChapter]);
  const stages = [...chapter.enemies, chapter.boss];
  const nextIndex = Math.min(state.chapterWins, chapter.enemies.length);
  const autoHandled = useRef(false);

  const start = async (kind: FightKind) => {
    const s = useGame.get();
    if (s.battleStones < PVE_STONE_COST) {
      setError('Нет боевых камней. Получи их за ежедневную награду, задания или купи в Лавке.');
      return;
    }

    const ch = generateChapter(s.currentChapter);
    const enemy = kind === 'trial'
      ? generateTrial(s.trialLevel)
      : s.chapterWins >= ch.enemies.length ? ch.boss : ch.enemies[s.chapterWins];

    hapticImpact('medium');
    setError(null);
    try {
      const battle = await beginPveBattle(enemy.id, kind);
      useGame.set({ ...useGame.get(), battleStones: battle.battleStones });
      setFight({ enemy, kind, battleId: battle.battleId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось начать бой. Проверь интернет.');
    }
  };

  useEffect(() => {
    if (!autoStart || autoHandled.current) return;
    autoHandled.current = true;
    onAutoStartHandled();
    start(view === 'trial' ? 'trial' : 'stage');
  });

  if (fight) {
    return (
      <PveFight
        key={fight.battleId}
        enemy={fight.enemy}
        kind={fight.kind}
        battleId={fight.battleId}
        onExit={() => setFight(null)}
        onNext={() => start(fight.kind)}
      />
    );
  }

  return (
    <div className="space-y-3 animate-fade-in pb-2">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-black/30 border border-white/10">
        {([
          { id: 'campaign', label: 'Поход', icon: Swords },
          { id: 'trial', label: 'Испытания', icon: Mountain },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => onView(t.id)}
            className={`h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
              view === t.id ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-black shadow-lg shadow-amber-900/30' : 'text-gray-400'
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-xl bg-black/30 border border-white/10 px-3 h-11">
        <span className="text-xs text-gray-400">Один бой стоит {PVE_STONE_COST} камень</span>
        <Currency kind="stones" value={state.battleStones} size={20} className="text-sm text-amber-100" />
      </div>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-950/40 p-3 animate-fade-in">
          <p className="text-xs text-red-200">{error}</p>
          <button onClick={onShop} className="mt-2 h-9 px-3 rounded-lg bg-amber-500 text-black text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-transform">
            <ShoppingBag className="w-3.5 h-3.5" /> В Лавку
          </button>
        </div>
      )}

      {view === 'campaign' ? (
        <>
          <div className="relative rounded-2xl overflow-hidden border border-amber-500/20">
            <img src={assetUrl('/city-bg.webp')} alt="" className="absolute inset-0 w-full h-full object-cover object-top" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/30" />
            <div className="relative p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-amber-300">Глава {chapter.number}</p>
              <h2 className="text-xl font-bold text-white mt-0.5">{chapter.title}</h2>
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-black/50 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-500" style={{ width: `${(nextIndex / stages.length) * 100}%` }} />
                </div>
                <span className="text-xs text-amber-100 tabular-nums">{nextIndex}/{stages.length}</span>
              </div>
              <p className="text-[11px] text-gray-300 mt-2">Победи всех врагов и босса, чтобы открыть главу {chapter.number + 1}.</p>
            </div>
          </div>

          <div className="space-y-2">
            {stages.map((e, i) => (
              <StageRow
                key={e.id}
                enemy={e}
                index={i}
                status={i < nextIndex ? 'done' : i === nextIndex ? 'current' : 'locked'}
                gold={blessedGold(state, e.rewardGold)}
                onFight={() => start('stage')}
              />
            ))}
          </div>
        </>
      ) : (
        <TrialPanel level={state.trialLevel} onFight={() => start('trial')} />
      )}
    </div>
  );
}

function StageRow({ enemy, index, status, gold, onFight }: { enemy: Enemy; index: number; status: 'done' | 'current' | 'locked'; gold: number; onFight: () => void }) {
  const current = status === 'current';
  return (
    <div
      className={`relative flex items-center gap-3 rounded-2xl border p-2.5 transition-all ${
        current
          ? 'bg-gradient-to-r from-amber-900/40 to-black/40 border-amber-400/50 shadow-[0_0_20px_rgba(245,158,11,0.15)]'
          : status === 'done' ? 'bg-black/25 border-emerald-500/20' : 'bg-black/20 border-white/5 opacity-60'
      }`}
    >
      <div className={`relative w-14 h-14 shrink-0 rounded-xl overflow-hidden border ${enemy.isBoss ? 'border-red-400/50 bg-red-950/50' : 'border-white/10 bg-black/40'}`}>
        <img src={enemy.art} alt={enemy.name} className={`w-full h-full object-contain ${status === 'locked' ? 'grayscale' : ''}`} />
        {enemy.isBoss && <Crown className="absolute top-0.5 left-0.5 w-3.5 h-3.5 text-amber-300 drop-shadow" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">{enemy.isBoss ? 'Босс' : `Этап ${index + 1}`}</p>
        <p className="text-sm font-semibold text-white truncate">{enemy.name}</p>
        <div className="flex items-center gap-2.5 text-[11px] text-gray-400 mt-0.5">
          <span className="flex items-center gap-0.5"><Heart className="w-3 h-3 text-red-400" />{enemy.maxHp}</span>
          <span className="flex items-center gap-0.5"><SwordIcon className="w-3 h-3 text-amber-400" />{enemy.attack}</span>
          <Currency kind="gold" value={gold} size={12} className="text-amber-200" />
        </div>
      </div>
      {status === 'done' && <span className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center"><Check className="w-4 h-4 text-emerald-400" /></span>}
      {status === 'locked' && <Lock className="w-4 h-4 text-gray-600 mr-2" />}
      {current && (
        <button onClick={onFight} className="shrink-0 h-10 px-3 rounded-xl bg-gradient-to-b from-red-500 to-red-700 border border-red-300/40 text-white text-sm font-bold flex items-center gap-1.5 active:scale-95 transition-transform">
          <Swords className="w-4 h-4" /> Бой
        </button>
      )}
    </div>
  );
}

function TrialPanel({ level, onFight }: { level: number; onFight: () => void }) {
  const enemy = generateTrial(level);
  const upcoming = Array.from({ length: 5 }, (_, i) => level + i);
  return (
    <div className="space-y-3">
      <div className="relative rounded-2xl overflow-hidden border border-sky-400/25">
        <img src={assetUrl('/arena-bg.webp')} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />
        <div className="relative p-4 flex items-end gap-3 min-h-[180px]">
          <img src={enemy.art} alt={enemy.name} className="w-28 h-36 object-contain object-bottom drop-shadow-[0_8px_10px_rgba(0,0,0,0.8)] animate-idle" />
          <div className="flex-1 min-w-0 pb-1">
            <p className="text-[11px] uppercase tracking-[0.2em] text-sky-300">Башня испытаний</p>
            <h2 className="text-lg font-bold text-white">Этаж {level}</h2>
            <p className="text-xs text-gray-300">{enemy.name}</p>
            <div className="flex items-center gap-2.5 text-[11px] text-gray-300 mt-1">
              <span className="flex items-center gap-0.5"><Heart className="w-3 h-3 text-red-400" />{enemy.maxHp}</span>
              <span className="flex items-center gap-0.5"><SwordIcon className="w-3 h-3 text-amber-400" />{enemy.attack}</span>
            </div>
          </div>
        </div>
      </div>

      <button onClick={onFight} className="w-full h-12 rounded-2xl bg-gradient-to-b from-sky-400 to-sky-700 border border-sky-200/30 text-white font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
        <Swords className="w-5 h-5" /> Начать испытание
      </button>

      <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
        <p className="text-xs font-semibold text-gray-300 mb-2">Награды этажей</p>
        <div className="space-y-1.5">
          {upcoming.map((l) => {
            const r = trialReward(l);
            return (
              <div key={l} className={`flex items-center justify-between h-9 px-2.5 rounded-lg ${l === level ? 'bg-sky-500/15 border border-sky-400/30' : 'bg-white/[0.03]'}`}>
                <span className="text-xs text-gray-200">Этаж {l}</span>
                <span className="flex items-center gap-3 text-xs">
                  <Currency kind="gold" value={r.gold ?? 0} size={14} className="text-amber-200" />
                  <Currency kind="gems" value={r.gems ?? 0} size={14} className="text-sky-200" />
                  <Currency kind="material" value={1} size={14} className="text-gray-200" />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
