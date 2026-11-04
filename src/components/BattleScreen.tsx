import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lock, Crown, Swords, Mountain, Heart, Sword as SwordIcon, ShoppingBag, Shirt, ScrollText, ChevronRight } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame, useArena, useAccount } from '@/game/actions';
import { beltContext, refillBeltFromInventory } from '@/game/belt';
import { useLanguage, localizeText } from '@/game/i18n';
import { captureGameEvent } from '@/game/analytics';
import { EQUIPMENT_SLOTS, generateChapter, generateTrial, getComputedStats, PVE_STONE_COST } from '@/game/engine';
import { spendStones, trialReward, blessedGold } from '@/game/progression';
import { saveBlocked } from '@/game/cloud';
import { confirmPveVictorySave, pveVictorySaveBlocked, pveVictorySaveState, subscribePveVictorySave } from '@/game/pveVictorySaveFence';
import { canJournalPveVictory, pendingPveVictoryJournal, retryPveVictoryJournal } from '@/game/pveVictoryRecovery';
import { hapticImpact } from '@/game/telegram';
import type { Enemy } from '@/game/types';
import { PveFight, type FightKind } from './pve/PveFight';
import { ServerAdventureScreen } from './pve/ServerAdventureScreen';
import { Currency } from './ui/Currency';
import { DailyShareCard } from '@/game/DailyShareCard';
import { getAppearanceIcon } from '@/game/appearance';
import { getEliteEncounterBrief } from '@/game/eliteEncounterBrief';
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
  onEquipment: () => void;
  onForge?: () => void;
  onActiveChange?: (active: boolean) => void;
}

export function BattleScreen({ userId, view, onView, autoStart, onAutoStartHandled, onShop, onQuests, onEquipment, onForge, onActiveChange }: Props) {
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
  const refillAfterConfirmedBattle = () => {
    if (useAccount.get().permanentVip < 3 || !useGame.get().autoRefillBelt
      || saveBlocked.has(userId) || pveVictorySaveBlocked(userId)
      || pendingPveVictoryJournal(userId)) return;
    useGame.set(current => refillBeltFromInventory(current, beltContext(current, useArena.get().wins)));
  };
  const [error, setError] = useState<string | null>(null);
  const [retryingVictorySave, setRetryingVictorySave] = useState(false);
  // A late save acknowledgement must immediately re-enable Campaign/Trials.
  // The battle screen may be mounted even when its result view has been closed.
  const [, refreshVictoryFence] = useState(0);
  useEffect(() => subscribePveVictorySave(userId, () => refreshVictoryFence(v => v + 1)), [userId]);
  const victorySaveStillPending = pveVictorySaveState(userId) === 'pending';
  const storageAvailable = canJournalPveVictory();
  const blockedBySave = pveVictorySaveBlocked(userId) || saveBlocked.has(userId) || pendingPveVictoryJournal(userId);
  const battleStartBlocked = caveRecoveryNeeded || blockedBySave || !storageAvailable;
  const chapter = useMemo(() => generateChapter(state.currentChapter), [state.currentChapter]);
  const stages = [...chapter.enemies, chapter.boss];
  const nextIndex = Math.min(state.chapterWins, chapter.enemies.length);
  // Read-only classic PvE preparation; server Cave stats and ownership are never inferred here.
  const equippedCount = EQUIPMENT_SLOTS.filter(({ id }) => !!state.player.equipped[id]).length;
  const heroAttack = getComputedStats(state).attack;
  const heroDefense = getComputedStats(state).defense;
  const autoHandled = useRef(false);
  const fightStartLocked = useRef(false);

  const start = (kind: FightKind) => {
    if (!canJournalPveVictory()) {
      setError(language === 'en'
        ? 'Device storage is unavailable. Classic battles are paused to prevent loss of rewards after restart.'
        : 'Хранилище телефона недоступно. Бои приостановлены, чтобы не потерять награды при перезапуске.');
      return false;
    }
    if (pveVictorySaveBlocked(userId) || saveBlocked.has(userId) || pendingPveVictoryJournal(userId)) {
      setError(language === 'en'
        ? 'The last victory has not been safely saved. Confirm it before another fight.'
        : 'Последняя победа ещё не сохранена. Подтверди сохранение перед новым боем.');
      return false;
    }
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
        userId={userId}
        enemy={fight.enemy}
        kind={fight.kind}
        onExit={() => {
          refillAfterConfirmedBattle();
          fightStartLocked.current = false;
          setFight(null);
          onActiveChange?.(false);
        }}
        onNext={() => { refillAfterConfirmedBattle(); fightStartLocked.current = false; return start(fight.kind); }}
        onQuests={() => { fightStartLocked.current = false; onActiveChange?.(false); onQuests(); }}
        onEquipment={onEquipment}
        onForge={onForge}
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
      {!storageAvailable && (
        <div data-testid="pve-storage-unavailable" role="alert" className="rounded-xl border border-red-400/65 bg-red-950/60 p-3 text-xs text-red-100">
          {language === 'en'
            ? 'Phone storage is unavailable. Campaign and Trials are paused to protect victory progress. Enable browser storage and reopen Telegram.'
            : 'Хранилище телефона недоступно. Поход и Испытания приостановлены для защиты прогресса. Разреши хранение данных и перезапусти Telegram.'}
        </div>
      )}
      {blockedBySave && (
        <div id="pending-pve-save" data-testid="pending-pve-save" role="alert"
          className="rounded-xl border border-amber-400/70 bg-amber-950/65 p-3 text-xs text-amber-100">
          <p className="font-bold">{language === 'en'
            ? 'A previous victory has not been safely saved. New Campaign and Trials fights are paused.'
            : 'Предыдущая победа ещё не сохранена. Новые бои Похода и Испытаний приостановлены.'}</p>
          {saveBlocked.has(userId) ? (
            <p className="mt-1">{language === 'en'
              ? 'The server has a newer save. Restart the game to reload safely; unconfirmed local changes may be lost.'
              : 'На сервере более новое сохранение. Перезапусти игру для безопасной загрузки; неподтверждённые изменения могут не сохраниться.'}</p>
          ) : (
            <button type="button" disabled={retryingVictorySave || victorySaveStillPending} data-testid="pve-retry-save-before-fight"
              onClick={() => {
                if (retryingVictorySave) return;
                setRetryingVictorySave(true);
                void confirmPveVictorySave(userId, () => retryPveVictoryJournal(userId))
                  .then(ok => setError(ok ? null : (language === 'en'
                    ? 'Could not save yet. Check your connection and retry without starting another fight.'
                    : 'Пока не удалось сохранить победу. Проверь соединение и повтори без нового боя.')))
                  .finally(() => setRetryingVictorySave(false));
              }}
              className="mt-2 min-h-11 rounded-lg border border-amber-200 bg-gradient-to-b from-amber-400 to-amber-700 px-4 font-extrabold text-[#251508] disabled:opacity-50">
              {retryingVictorySave || victorySaveStillPending
                ? (language === 'en' ? 'Saving…' : 'Сохраняем…')
                : (language === 'en' ? 'Retry saving victory' : 'Повторить сохранение победы')}
            </button>
          )}
          {error && <p role="alert" className="mt-2 text-red-200">{error}</p>}
        </div>
      )}
      {view === 'cave' ? (
        <ServerAdventureScreen userId={userId} onActiveChange={handleCaveActive} />
      ) : <>
      <div className="flex items-center justify-between rounded-xl bg-black/30 border border-white/10 px-3 h-11">
        <span className="text-xs text-gray-400">{t('oneFightCost')} {PVE_STONE_COST} {t('stone')}</span>
        <Currency kind="stones" value={state.battleStones} size={20} className="text-sm text-amber-100" />
      </div>

      <section data-testid="battle-preparation-journey" aria-label={language === 'en' ? 'Prepare your hero for classic battles' : 'Подготовка героя к обычным боям'}
        className="rounded-2xl border-2 border-amber-600/60 bg-gradient-to-r from-[#4d2e1b] via-[#30221b] to-[#171b24] p-2.5 shadow-[inset_0_1px_0_rgba(255,225,155,.22),0_5px_15px_rgba(0,0,0,.22)]">
        <div className="flex items-center gap-2.5">
          <img src={getAppearanceIcon(state.appearance)} alt="" loading="lazy" draggable={false}
            className="h-20 w-16 shrink-0 object-contain object-bottom drop-shadow-[0_4px_5px_rgba(0,0,0,.65)]"/>
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-sm font-black text-[#ffe6a4]">{language === 'en' ? 'Ready for the next fight?' : 'Готов к следующему бою?'}</strong>
            <span className="block truncate text-xs font-semibold text-amber-100">{state.player.name} · {t('levelWord')} {state.player.level}</span>
            <span className="block text-[11px] text-amber-200">
              {language === 'en' ? 'Attack' : 'Атака'}: {heroAttack} · {language === 'en' ? 'Equipped' : 'Надето'}: {equippedCount}/7
            </span>
            <span className="block text-[10px] leading-snug text-amber-100/75">
              {caveRecoveryNeeded
                ? (language === 'en' ? 'Recover the pending Cave action before spending battle stones.' : 'Сначала восстанови операцию Пещеры, затем начинай бой.')
                : equippedCount < 7
                  ? (language === 'en' ? 'Check your saved equipment before battle.' : 'Проверь сохранённую экипировку перед боем.')
                  : (language === 'en' ? 'Equipment is ready; choose your next encounter.' : 'Экипировка готова — выбирай противника.')}
            </span>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" data-testid="battle-open-equipment" onClick={onEquipment}
            className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-[#ffdf9d] bg-gradient-to-b from-[#f8d78a] to-[#a96c32] px-2 text-xs font-black text-[#28170e]">
            <Shirt size={16} aria-hidden="true"/>{language === 'en' ? 'Equipment' : 'Снаряжение'}<ChevronRight size={15} aria-hidden="true"/>
          </button>
          <button type="button" data-testid="battle-open-quests" onClick={onQuests}
            className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-amber-500/50 bg-[#32251f] px-2 text-xs font-bold text-amber-100">
            <ScrollText size={16} aria-hidden="true"/>{language === 'en' ? 'Quests' : 'Задания'}<ChevronRight size={15} aria-hidden="true"/>
          </button>
        </div>
      </section>

      {error && !blockedBySave && (
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
            <img src={import.meta.env.BASE_URL + "city-bg.webp"} alt="" className="absolute inset-0 w-full h-full object-cover object-top" />
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

          <div data-testid="campaign-next-goal" role="status" aria-live="polite"
            className="rounded-xl border border-amber-400/50 bg-gradient-to-r from-[#51321c] to-[#241c19] px-3 py-2.5 shadow-inner">
            <div className="flex items-center gap-2">
              <Crown size={18} className="shrink-0 text-amber-300" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <strong className="block text-sm font-black text-amber-100">
                  {nextIndex === chapter.enemies.length
                    ? (language === 'en' ? 'Boss unlocked — final fight!' : 'Босс открыт — решающий бой!')
                    : (language === 'en'
                      ? `To the boss: ${chapter.enemies.length - nextIndex} ${chapter.enemies.length - nextIndex === 1 ? 'fight' : 'fights'}`
                      : `До босса: ${chapter.enemies.length - nextIndex} боёв`)}
                </strong>
                <p className="text-[11px] leading-snug text-amber-100/85">
                  {nextIndex === chapter.enemies.length
                    ? (language === 'en' ? 'Check equipment, choose attack and block zones, then challenge the boss.' : 'Проверь снаряжение, выбирай зоны удара и блока — и бросай вызов боссу.')
                    : (language === 'en' ? 'Win the next encounter to advance. After the fight, check your actual loot and equipment.' : 'Победи следующего врага, чтобы продвинуться. После боя проверь настоящую добычу и снаряжение.')}
                </p>
              </div>
            </div>
            {state.battleStones < PVE_STONE_COST && !caveRecoveryNeeded && (
              <p role="status" className="mt-2 text-xs font-semibold text-amber-200">
                {language === 'en'
                  ? 'Not enough battle stones. Visit the shop before challenging this enemy.'
                  : 'Не хватает боевых камней. Загляни в лавку перед следующим боем.'}
              </p>
            )}
            <button type="button" data-testid="campaign-next-fight" onClick={() => {
              if (state.battleStones < PVE_STONE_COST && !caveRecoveryNeeded) {
                onShop();
                return;
              }
              start('stage');
            }}
              disabled={battleStartBlocked || fightStartLocked.current}
              className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-200/70 bg-gradient-to-b from-amber-300 to-amber-600 px-3 py-2 text-sm font-black text-[#241509] shadow-md active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50">
              <Swords size={17} aria-hidden="true" />
              {nextIndex === chapter.enemies.length
                ? (language === 'en' ? 'Challenge the boss' : 'Сразиться с боссом')
                : (language === 'en' ? 'Fight the next enemy' : 'Сразиться со следующим врагом')}
            </button>
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
                heroAttack={heroAttack}
                heroDefense={heroDefense}
                onFight={() => start('stage')}
                blocked={battleStartBlocked}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <DailyShareCard task="trials" userId={userId}/>
          <TrialPanel level={state.trialLevel} onFight={() => start('trial')} blocked={battleStartBlocked} t={t} language={language} heroAttack={heroAttack} heroDefense={heroDefense} />
        </div>
      )}
      </>}
    </div>
  );
}

/** Read-only advice for the existing manual elite PvE resolver.
 * The numbers are real hero/enemy stats, not a predicted win rate or a buff.
 * The elite guard and combo already run in PveFight/playRound. */
function EliteTacticPreview({ enemy, heroAttack, heroDefense, language }: {
  enemy: Enemy; heroAttack: number; heroDefense: number; language: 'ru' | 'en';
}) {
  const brief = getEliteEncounterBrief(enemy, { attack: heroAttack, defense: heroDefense });
  const en = language === 'en';
  return (
    <div data-testid="elite-tactic-preview" role="note"
      className="mt-2 rounded-xl border border-amber-400/40 bg-black/45 px-2.5 py-2 text-[11px] leading-snug text-amber-50">
      <strong className="block text-amber-200">{en ? 'Elite tactics · before spending a stone' : 'Тактика элиты · до расхода камня'}</strong>
      <p className="mt-1">{en
        ? `Your attack ${brief.heroAttack} / enemy defense ${brief.enemyDefense}. Your defense ${brief.heroDefense} / enemy attack ${brief.enemyAttack}.`
        : `Твоя атака ${brief.heroAttack} / защита врага ${brief.enemyDefense}. Твоя защита ${brief.heroDefense} / атака врага ${brief.enemyAttack}.`}</p>
      {brief.attackAtOrBelowDefense && <p className="mt-1 font-bold text-orange-200">{en
        ? 'Enemy defense matches or exceeds your attack. Compare owned weapons before the fight.'
        : 'Защита врага не ниже твоей атаки. Сравни своё оружие перед боем.'}</p>}
      {brief.enemyAttackExceedsDefense && <p className="mt-1 font-bold text-orange-200">{en
        ? 'Enemy attack exceeds your defense. Plan blocks and healing.'
        : 'Атака врага выше твоей защиты. Продумай блоки и лечение.'}</p>}
      <p className="mt-1 text-sky-100">{en
        ? 'Manual fight: below half HP the elite adapts its guard. Alternate successful strike zones to charge a +15% next-hit combo.'
        : 'Ручной бой: ниже половины HP элита меняет блоки. Чередуй успешные удары по разным зонам, чтобы зарядить +15% к следующему попаданию.'}</p>
    </div>
  );
}

function StageRow({ enemy, index, status, gold, onFight, blocked, t, language, heroAttack, heroDefense }: { enemy: Enemy; index: number; status: 'done' | 'current' | 'locked'; gold: number; onFight: () => void; blocked: boolean; t: (key: string) => string; language: 'ru' | 'en'; heroAttack: number; heroDefense: number }) {
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
        <div data-testid="campaign-real-loot-preview" className="journey-encounter__reward">
          <span>{language === 'en' ? 'Victory reward' : 'Награда за победу'}</span>
          <Currency kind="gold" value={gold} size={17} />
          <span className="font-bold text-sky-200">+{enemy.rewardXp} XP</span>
        </div>
        <p data-testid="campaign-material-drop-odds" className="text-[10px] leading-tight text-amber-200/90">
          {enemy.isBoss
            ? (language === 'en' ? 'Boss loot: +3 Forge materials guaranteed' : 'Добыча босса: +3 материала кузницы гарантированно')
            : (language === 'en' ? '35% chance: +1 Forge material' : '35% шанс: +1 материал кузницы')}
        </p>
        {enemy.isBoss && <EliteTacticPreview enemy={enemy} heroAttack={heroAttack} heroDefense={heroDefense} language={language} />}
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

function TrialPanel({ level, onFight, blocked, t, language, heroAttack, heroDefense }: { level: number; onFight: () => void; blocked: boolean; t: (key: string) => string; language: 'ru' | 'en'; heroAttack: number; heroDefense: number }) {
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

      <EliteTacticPreview enemy={enemy} heroAttack={heroAttack} heroDefense={heroDefense} language={language} />
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
