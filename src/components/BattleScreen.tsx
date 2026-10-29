import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lock, Crown, Swords, Mountain, Heart, Sword as SwordIcon, ShoppingBag } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { useLanguage } from '@/game/i18n';
import { captureGameEvent } from '@/game/analytics';
import { generateChapter, generateTrial, PVE_STONE_COST } from '@/game/engine';
import { spendStones, trialReward, blessedGold } from '@/game/progression';
import { hapticImpact } from '@/game/telegram';
import type { Enemy } from '@/game/types';
import { PveFight, type FightKind } from './pve/PveFight';
import { ServerAdventureScreen } from './pve/ServerAdventureScreen';
import { Currency } from './ui/Currency';
import { DailyShareCard } from '@/game/DailyShareCard';
import { supabase } from '@/game/supabase';

// The server decides per player. Ineligible accounts keep the legacy campaign.
type ServerMode = 'checking' | 'enabled' | 'legacy';

export type BattleView = 'campaign' | 'trial';

interface Props {
  userId:string;
  view: BattleView;
  onView: (v: BattleView) => void;
  autoStart: boolean;
  onAutoStartHandled: () => void;
  onShop: () => void;
  onQuests: () => void;
  onActiveChange?: (active: boolean) => void;
}

export function BattleScreen({ userId, view, onView, autoStart, onAutoStartHandled, onShop, onQuests, onActiveChange }: Props) {
  const { t, language } = useLanguage();
  const state = useStore(useGame);
  const [fight, setFight] = useState<{ enemy: Enemy; kind: FightKind; id: number } | null>(null);
  const [serverMode, setServerMode] = useState<ServerMode>('checking');
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [legacySelected, setLegacySelected] = useState(false);
  const [serverActive, setServerActive] = useState(false);
  const handleServerActive = useCallback((active: boolean) => {
    setServerActive(active);
    onActiveChange?.(active);
  }, [onActiveChange]);
  useEffect(() => {
    let alive = true;
    const hasPendingServerSession = [
      'territory_adventure_session_v1:',
      'territory_adventure_start_v1:',
      'territory_adventure_pending_v1:',
    ].some(prefix => {
      try { return !!localStorage.getItem(prefix + userId); } catch { return false; }
    });
    if (hasPendingServerSession) {
      setRecoveryRequired(true);
      setServerMode('enabled'); // Recover a durable in-flight server debit/receipt first.
      return () => { alive = false; };
    }
    // Any authenticated player may use the new campaign from the normal
    // Adventure/Battle screen. Keep old campaign available by explicit choice.
    void Promise.resolve(supabase.rpc('territory_adventure_mode_v3'))
      .then(({ data, error }) => {
        if (alive) setServerMode(!error && data?.enabled === true ? 'enabled' : 'legacy');
      })
      .catch(() => { if (alive) setServerMode('legacy'); });
    return () => { alive = false; };
  }, [userId]);
  const showServer = serverMode === 'enabled' &&
    (recoveryRequired || serverActive || !legacySelected);
  const [error, setError] = useState<string | null>(null);
  const chapter = useMemo(() => generateChapter(state.currentChapter), [state.currentChapter]);
  const stages = [...chapter.enemies, chapter.boss];
  const nextIndex = Math.min(state.chapterWins, chapter.enemies.length);
  const autoHandled = useRef(false);
  const fightStartLocked = useRef(false);

  const start = (kind: FightKind) => {
    // One user gesture = at most one stone. Prevent overlapping taps/autostart
    // callbacks from charging twice before React commits setFight.
    if (fightStartLocked.current) return;
    fightStartLocked.current = true;
    const s = useGame.get();
    const paid = spendStones(s, PVE_STONE_COST);
    if (!paid) {
      fightStartLocked.current = false;
      setError(t('noBattleStones'));
      return;
    }
    hapticImpact('medium');
    captureGameEvent('territory_pve_fight_start', { mode: kind === 'trial' ? 'trial' : 'campaign' });
    setError(null);
    useGame.set(paid);
    const ch = generateChapter(paid.currentChapter);
    const enemy = kind === 'trial'
      ? generateTrial(paid.trialLevel)
      : paid.chapterWins >= ch.enemies.length ? ch.boss : ch.enemies[paid.chapterWins];
    setFight({ enemy, kind, id: Date.now() });
    onActiveChange?.(true);
  };

  useEffect(() => {
    if (!autoStart || autoHandled.current || (view === 'campaign' && serverMode === 'checking')) return;
    autoHandled.current = true;
    onAutoStartHandled();
    // No client-side stone deductions or legacy battle while server cutover is active.
    if (showServer && view === 'campaign') return;
    start(view === 'trial' ? 'trial' : 'stage');
  });

  if (view === 'campaign' && serverMode === 'checking' && !fight) {
    return <p role="status" className="p-4 text-center text-xs text-amber-100">
      {language === 'en' ? 'Checking campaign availability…' : 'Проверяем доступность приключений…'}
    </p>;
  }
  if (showServer && view === 'campaign' && !fight) {
    return <div className="space-y-2">
      {!serverActive && !recoveryRequired && (
        <button type="button" onClick={() => setLegacySelected(true)}
          className="w-full rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs font-semibold text-amber-100">
          {language === 'en' ? '← Classic campaign (old progress)' : '← Классический поход (старый прогресс)'}
        </button>
      )}
      <ServerAdventureScreen userId={userId} onTrial={() => onView('trial')}
        onActiveChange={handleServerActive} />
    </div>;
  }

  if (fight) {
    return (
      <PveFight
        key={fight.id}
        enemy={fight.enemy}
        kind={fight.kind}
        onExit={() => {
          fightStartLocked.current = false;
          setFight(null);
          onActiveChange?.(false);
        }}
        onNext={() => { fightStartLocked.current = false; start(fight.kind); }}
        onQuests={() => { fightStartLocked.current = false; onActiveChange?.(false); onQuests(); }}
      />
    );
  }

  return (
    <div className="space-y-3 animate-fade-in pb-2">
      {serverMode === 'enabled' && !fight && view === 'campaign' && (
        <button type="button" onClick={() => setLegacySelected(false)}
          className="w-full rounded-xl border border-emerald-400/50 bg-emerald-950/50 px-3 py-3 text-sm font-bold text-emerald-100">
          {language === 'en' ? '⚔️ New adventure — 100 stages' : '⚔️ Новые приключения — 100 этапов'}
          <span className="mt-1 block text-[11px] font-normal opacity-75">
            {language === 'en' ? 'Server battles and rewards · Classic progress is retained' : 'Серверные бои и награды · Старый прогресс сохранён отдельно'}
          </span>
        </button>
      )}
      <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-black/30 border border-white/10">
        {([
          { id: 'campaign', label: t('campaign'), icon: Swords },
          { id: 'trial', label: t('trials'), icon: Mountain },
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
        <span className="text-xs text-gray-400">{t('oneFightCost')} {PVE_STONE_COST} {t('stone')}</span>
        <Currency kind="stones" value={state.battleStones} size={20} className="text-sm text-amber-100" />
      </div>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-950/40 p-3 animate-fade-in">
          <p className="text-xs text-red-200">{error}</p>
          <button onClick={onShop} className="mt-2 h-9 px-3 rounded-lg bg-amber-500 text-black text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-transform">
            <ShoppingBag className="w-3.5 h-3.5" /> {t('toShop')}
          </button>
        </div>
      )}

      {view === 'campaign' ? (
        <>
          {state.totalBattlesWon === 0 && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-950/30 p-3 text-sm text-amber-100" role="note">
              <strong className="block font-bold">{language === 'en' ? 'Your first victory starts here!' : 'Первая победа начинается здесь!'}</strong>
              <span className="block mt-1 text-xs leading-relaxed">
                {language === 'en'
                  ? 'Press Fight on the highlighted enemy below. Win the battle to gain experience and unlock the next stage.'
                  : 'Нажми «Бой» у выделенного противника ниже. Победи, получи опыт и открой следующий этап.'}
              </span>
            </div>
          )}
          <div className="relative rounded-2xl overflow-hidden border border-amber-500/20">
            <img src="/city-bg.webp" alt="" className="absolute inset-0 w-full h-full object-cover object-top" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/30" />
            <div className="relative p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-amber-300">{t('chapter')} {chapter.number}</p>
              <h2 className="text-xl font-bold text-white mt-0.5">{chapter.title}</h2>
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-black/50 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-500" style={{ width: `${(nextIndex / stages.length) * 100}%` }} />
                </div>
                <span className="text-xs text-amber-100 tabular-nums">{nextIndex}/{stages.length}</span>
              </div>
              <p className="text-[11px] text-gray-300 mt-2">{t('chapterUnlock')} {chapter.number + 1}.</p>
            </div>
          </div>

          <div className="space-y-2">
            {stages.map((e, i) => (
              <StageRow
                key={e.id}
                enemy={e}
                t={t}
                language={language}
                index={i}
                status={i < nextIndex ? 'done' : i === nextIndex ? 'current' : 'locked'}
                gold={blessedGold(state, e.rewardGold)}
                onFight={() => start('stage')}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <DailyShareCard task="trials" userId={userId}/>
          <TrialPanel level={state.trialLevel} onFight={() => start('trial')} t={t} />
        </div>
      )}
    </div>
  );
}

function StageRow({ enemy, index, status, gold, onFight, t, language }: { enemy: Enemy; index: number; status: 'done' | 'current' | 'locked'; gold: number; onFight: () => void; t: (key: string) => string; language: 'ru' | 'en' }) {
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
        <p className="text-[10px] uppercase tracking-wider text-gray-500">{enemy.isBoss ? t('bossLabel') : `${t('stage')} ${index + 1}`}</p>
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

function TrialPanel({ level, onFight, t }: { level: number; onFight: () => void; t: (key: string) => string }) {
  const enemy = generateTrial(level);
  const upcoming = Array.from({ length: 5 }, (_, i) => level + i);
  return (
    <div className="space-y-3">
      <div className="relative rounded-2xl overflow-hidden border border-sky-400/25">
        <img src={import.meta.env.BASE_URL + 'assets/territory/scenes/arena-viking.webp'} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />
        <div className="relative p-4 flex items-end gap-3 min-h-[180px]">
          <img src={enemy.art} alt={enemy.name} className="w-28 h-36 object-contain object-bottom drop-shadow-[0_8px_10px_rgba(0,0,0,0.8)] animate-idle" />
          <div className="flex-1 min-w-0 pb-1">
            <p className="text-[11px] uppercase tracking-[0.2em] text-sky-300">{t('trialTower')}</p>
            <h2 className="text-lg font-bold text-white">{t('floor')} {level}</h2>
            <p className="text-xs text-gray-300">{enemy.name}</p>
            <div className="flex items-center gap-2.5 text-[11px] text-gray-300 mt-1">
              <span className="flex items-center gap-0.5"><Heart className="w-3 h-3 text-red-400" />{enemy.maxHp}</span>
              <span className="flex items-center gap-0.5"><SwordIcon className="w-3 h-3 text-amber-400" />{enemy.attack}</span>
            </div>
          </div>
        </div>
      </div>

      <button onClick={onFight} className="w-full h-12 rounded-2xl bg-gradient-to-b from-sky-400 to-sky-700 border border-sky-200/30 text-white font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
        <Swords className="w-5 h-5" /> {t('startTrial')}
      </button>

      <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
        <p className="text-xs font-semibold text-gray-300 mb-2">{t('floorRewards')}</p>
        <div className="space-y-1.5">
          {upcoming.map((l) => {
            const r = trialReward(l);
            return (
              <div key={l} className={`flex items-center justify-between h-9 px-2.5 rounded-lg ${l === level ? 'bg-sky-500/15 border border-sky-400/30' : 'bg-white/[0.03]'}`}>
                <span className="text-xs text-gray-200">{t('floor')} {l}</span>
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
