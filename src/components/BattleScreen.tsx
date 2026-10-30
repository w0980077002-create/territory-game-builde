import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lock, Crown, Swords, Mountain, Heart, Sword as SwordIcon, ShoppingBag } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { useLanguage, localizeText } from '@/game/i18n';
import { captureGameEvent } from '@/game/analytics';
import { generateChapter, generateTrial, PVE_STONE_COST } from '@/game/engine';
import { spendStones, trialReward, blessedGold } from '@/game/progression';
import { hapticImpact } from '@/game/telegram';
import type { Enemy } from '@/game/types';
import { PveFight, type FightKind } from './pve/PveFight';
import { ServerAdventureScreen } from './pve/ServerAdventureScreen';
import { Currency } from './ui/Currency';
import { DailyShareCard } from '@/game/DailyShareCard';
import './battleJourney.css';
// Independent: the old campaign, Trials, and server-operated Dark Cave.
export type BattleView = 'campaign' | 'trial' | 'cave';

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
  const [caveActive, setCaveActive] = useState(false);
  const handleCaveActive = useCallback((active: boolean) => {
    setCaveActive(active);
    onActiveChange?.(active);
  }, [onActiveChange]);
  // Preserve a visible and playable-looking classic campaign instead of silently
  // switching to the cave. A pending debit must still be recovered before any
  // legacy battle spends stones or changes the saved hero.
  const caveRecoveryNeeded = view !== 'cave' && ['territory_adventure_start_v1:', 'territory_adventure_pending_v1:']
    .some(prefix => {
      try { return !!localStorage.getItem(prefix + userId); }
      catch { return true; } // Unreadable storage must not authorize a new spend.
    });
  const [error, setError] = useState<string | null>(null);
  const chapter = useMemo(() => generateChapter(state.currentChapter), [state.currentChapter]);
  const stages = [...chapter.enemies, chapter.boss];
  const nextIndex = Math.min(state.chapterWins, chapter.enemies.length);
  const autoHandled = useRef(false);
  const fightStartLocked = useRef(false);

  const start = (kind: FightKind) => {
    if (caveRecoveryNeeded) {
      setError(language === 'en'
        ? 'Recover your pending Dark Cave fight before starting a Campaign battle.'
        : 'Сначала восстанови незавершённый бой в Тёмной пещере. Награды и камни сохранятся.');
      return false;
    }
    // One user gesture = at most one stone. Prevent overlapping taps/autostart
    // callbacks from charging twice before React commits setFight.
    if (fightStartLocked.current) return false;
    fightStartLocked.current = true;
    const s = useGame.get();
    const paid = spendStones(s, PVE_STONE_COST);
    if (!paid) {
      fightStartLocked.current = false;
      setError(t('noBattleStones'));
      return false;
    }
    // Haptics and analytics are best-effort; an SDK error must never prevent
    // a paid battle from being committed or leave the Next button locked.
    try { hapticImpact('medium'); } catch { /* Unsupported Telegram haptics. */ }
    try { captureGameEvent('territory_pve_fight_start', { mode: kind === 'trial' ? 'trial' : 'campaign' }); } catch { /* Optional telemetry. */ }
    setError(null);
    useGame.set(paid);
    const ch = generateChapter(paid.currentChapter);
    const enemy = kind === 'trial'
      ? generateTrial(paid.trialLevel)
      : paid.chapterWins >= ch.enemies.length ? ch.boss : ch.enemies[paid.chapterWins];
    setFight({ enemy, kind, id: Date.now() });
    onActiveChange?.(true);
    return true;
  };

  useEffect(() => {
    if (!autoStart || autoHandled.current) return;
    autoHandled.current = true;
    onAutoStartHandled();
    // Cave starts and settles exclusively via its own server workflow.
    if (view === 'cave' || caveRecoveryNeeded) return;
    start(view === 'trial' ? 'trial' : 'stage');
  });

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
        onNext={() => { fightStartLocked.current = false; return start(fight.kind); }}
        onQuests={() => { fightStartLocked.current = false; onActiveChange?.(false); onQuests(); }}
      />
    );
  }

  return (
    <div className={view === 'cave'
      ? 'flex h-full min-h-0 flex-col gap-2 overflow-hidden animate-fade-in'
      : 'space-y-3 animate-fade-in pb-2'}>
      <div data-testid="battle-mode-tabs" role="tablist" className="viking-adventure-tabs grid shrink-0 grid-cols-3 gap-1 p-1 rounded-2xl bg-black/30 border border-white/10">
        {([
          { id: 'campaign', label: t('campaign'), icon: Swords },
          { id: 'trial', label: t('trials'), icon: Mountain },
          { id: 'cave', label: language === 'en' ? 'Dark Cave' : 'Тёмная пещера', icon: Mountain },
        ] as const).map((t) => (
          <button
            key={t.id}
            role="tab" aria-selected={view === t.id}
            onClick={() => onView(t.id)}
            disabled={caveActive && view === 'cave' && t.id !== 'cave'}
            className={`min-h-12 rounded-xl text-[11px] leading-tight font-semibold flex flex-col items-center justify-center gap-0.5 transition-all disabled:opacity-40 ${
              view === t.id ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-black shadow-lg shadow-amber-900/30' : 'text-gray-400'
            }`}
          >
            <t.icon className="w-4 h-4" /> <span className="text-center">{t.label}</span>
          </button>
        ))}
      </div>

      {caveRecoveryNeeded && (
        <div id="pending-cave-recovery" role="alert" data-testid="pending-cave-recovery" className="rounded-xl border border-amber-400/60 bg-amber-950/60 px-3 py-2 text-xs text-amber-100">
          <p>{language === 'en'
            ? 'The Dark Cave has an unfinished server action. Campaign progress is safe; recover that action before the next battle.'
            : 'В Тёмной пещере есть незавершённое серверное действие. Поход и прогресс сохранены; сначала восстанови операцию.'}</p>
          <button type="button" onClick={() => onView('cave')} className="mt-2 min-h-10 w-full rounded-lg border border-amber-200 bg-amber-500 px-3 py-2 font-black text-black">
            {language === 'en' ? 'Recover Dark Cave battle' : 'Восстановить бой в пещере'}
          </button>
        </div>
      )}
      {view === 'cave' ? (
        <ServerAdventureScreen userId={userId} onActiveChange={handleCaveActive} />
      ) : <>
      <div className="flex items-center justify-between rounded-xl bg-black/30 border border-white/10 px-3 h-11">
        <span className="text-xs text-gray-400">{t('oneFightCost')} {PVE_STONE_COST} {t('stone')}</span>
        <Currency kind="stones" value={state.battleStones} size={20} className="text-sm text-amber-100" />
      </div>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-950/40 p-3 animate-fade-in">
          <p className="text-xs text-red-200">{error}</p>
          <button onClick={caveRecoveryNeeded ? () => { setError(null); onView('cave'); } : onShop} className="mt-2 h-9 px-3 rounded-lg bg-amber-500 text-black text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-transform">
            {!caveRecoveryNeeded && <ShoppingBag className="w-3.5 h-3.5" />} {caveRecoveryNeeded ? (language === 'en' ? 'Recover Dark Cave battle' : 'Восстановить бой в пещере') : t('toShop')}
          </button>
        </div>
      )}

      {view === 'campaign' ? (
        <>
          {state.totalBattlesWon === 0 && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-950/30 px-3 py-2 text-sm font-bold text-amber-100" role="note">
              {language === 'en' ? 'Your first victory starts here!' : 'Первая победа начинается здесь!'}
            </div>
          )}
          <div className="relative rounded-2xl overflow-hidden border border-amber-500/20">
            <img src="/city-bg.webp" alt="" className="absolute inset-0 w-full h-full object-cover object-top" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/30" />
            <div className="relative p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-amber-300">{t('chapter')} {chapter.number}</p>
              <h2 className="text-xl font-bold text-white mt-0.5">{localizeText(chapter.title, language)}</h2>
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
                blocked={caveRecoveryNeeded}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <DailyShareCard task="trials" userId={userId}/>
          <TrialPanel level={state.trialLevel} onFight={() => start('trial')} blocked={caveRecoveryNeeded} t={t} language={language} />
        </div>
      )}
      </>}
    </div>
  );
}

function StageRow({ enemy, index, status, gold, onFight, blocked, t, language }: { enemy: Enemy; index: number; status: 'done' | 'current' | 'locked'; gold: number; onFight: () => void; blocked: boolean; t: (key: string) => string; language: 'ru' | 'en' }) {
  const current = status === 'current';
  if (current) return (
    <article className="journey-encounter" aria-label={language === 'en' ? 'Next encounter' : 'Следующий противник'}>
      <div className="journey-encounter__art"><img src={enemy.art} alt="" draggable={false} /></div>
      <div className="journey-encounter__content">
        <p className="journey-encounter__eyebrow">{enemy.isBoss ? t('bossLabel') : `${t('stage')} ${index + 1}`}</p>
        <h3>{localizeText(enemy.name, language)}</h3>
        <div className="journey-encounter__stats">
          <span><Heart size={15} aria-hidden="true" />{enemy.maxHp}</span>
          <span><SwordIcon size={15} aria-hidden="true" />{enemy.attack}</span>
        </div>
        <div className="journey-encounter__reward"><span>{language === 'en' ? 'Victory reward' : 'Награда за победу'}</span><Currency kind="gold" value={gold} size={17} /></div>
        <button type="button" onClick={onFight} disabled={blocked} aria-describedby={blocked ? 'pending-cave-recovery' : undefined}>
          <Swords size={18} aria-hidden="true" />{language === 'en' ? 'Fight' : 'Бой'}
        </button>
      </div>
    </article>
  );
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
        <p className="text-sm font-semibold text-white truncate">{localizeText(enemy.name, language)}</p>
        <div className="flex items-center gap-2.5 text-[11px] text-gray-400 mt-0.5">
          <span className="flex items-center gap-0.5"><Heart className="w-3 h-3 text-red-400" />{enemy.maxHp}</span>
          <span className="flex items-center gap-0.5"><SwordIcon className="w-3 h-3 text-amber-400" />{enemy.attack}</span>
          <Currency kind="gold" value={gold} size={12} className="text-amber-200" />
        </div>
      </div>
      {status === 'done' && <span className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center"><Check className="w-4 h-4 text-emerald-400" /></span>}
      {status === 'locked' && <Lock className="w-4 h-4 text-gray-600 mr-2" />}
    </div>
  );
}

function TrialPanel({ level, onFight, blocked, t, language }: { level: number; onFight: () => void; blocked: boolean; t: (key: string) => string; language: 'ru' | 'en' }) {
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
            <p className="text-xs text-gray-300">{localizeText(enemy.name, language)}</p>
            <div className="flex items-center gap-2.5 text-[11px] text-gray-300 mt-1">
              <span className="flex items-center gap-0.5"><Heart className="w-3 h-3 text-red-400" />{enemy.maxHp}</span>
              <span className="flex items-center gap-0.5"><SwordIcon className="w-3 h-3 text-amber-400" />{enemy.attack}</span>
            </div>
          </div>
        </div>
      </div>

      <button onClick={onFight} disabled={blocked} aria-describedby={blocked ? 'pending-cave-recovery' : undefined} className="w-full h-12 rounded-2xl bg-gradient-to-b from-sky-400 to-sky-700 border border-sky-200/30 text-white font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40 disabled:cursor-not-allowed">
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
