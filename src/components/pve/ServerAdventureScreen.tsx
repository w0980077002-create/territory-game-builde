import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, Crown, Info, Loader2, Lock, Swords, Zap } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { useGame, useArena } from '@/game/actions';
import { useStore } from '@/game/store';
import { beltContext } from '@/game/belt';
import { BeltCells } from '@/components/ui/BeltCells';
import { GearStrip } from '@/components/arena/GearStrip';
import { FoldSection } from '@/components/arena/FoldSection';
import { ensurePlayerSession } from '@/game/auth';
import { supabase } from '@/game/supabase';
import { restoreAdventureSaveFence, restoreAdventureStartFence, requestAdventureStart, requestAdventureSettlement } from '@/game/combatV1/receiptAdapter';
import { buildCaveFloors, getCaveFloor, type CaveFloor } from '@/game/cave/floors';
import { dispatchCave, useCaveSandbox } from '@/game/cave/sandboxStore';
import { selectedFollower } from '@/game/followers';
import { CaveUmbraScreen } from './cave/CaveUmbraScreen';
import { CaveGemsScreen } from './cave/CaveGemsScreen';
import { CaveBlessingSlots, CaveFloorDialog, CaveFundPanel, CaveLootReveal } from './cave/CavePanels';
import { Dialog, woodStyle } from './cave/caveShared';
import './cavePreview.css';
import type { IdleCombatState, IdleCombatEvent } from '@/game/idleEngine/types';
import { getCombatAppearance } from '@/game/appearance';
import { getEnemyCombatFrames, getFollowerArt } from '@/game/combatArt';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { FighterFigure } from '@/components/arena/FighterFigure';

type Progress = { completed_stage: number; unlocked_stage: number; dark_stones: number; active_session_id?: string | null };
type Settlement = { outcome: string; reward?: { gold: number; xp: number }; dark_stone_refunded?: boolean };
type Session = { session_id: string; revision: number; state: IdleCombatState; events?: IdleCombatEvent[]; settlement?: Settlement | null };
type Props = { userId: string; onActiveChange?: (active: boolean) => void; onShop?: () => void };
// The cave's own 100-floor catalog; ids follow the server encounter adventure_v1_stage_<floor>.
const CAVE_FLOORS = buildCaveFloors();
const floorEnemy = (stage: number, en: boolean) => { const floor = getCaveFloor(stage); return en ? floor.enemyEn : floor.enemyRu; };
// Reads and writes the live store; no component state, so one module-level object.
const hooks = { getState: () => useGame.get(), applyState: (state: ReturnType<typeof useGame.get>) => useGame.set(state) };
const sessionKey = (id: string) => 'territory_adventure_session_v1:' + id;
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function decodeSession(data: unknown): Session {
  if (!obj(data) || data.success !== true || typeof data.session_id !== 'string'
    || !Number.isSafeInteger(data.revision) || Number(data.revision) < 0 || !obj(data.state)
    || !['fighting', 'hero_won', 'enemy_won', 'draw'].includes(String(data.state.status))
    || !obj(data.state.actors) || !obj(data.state.input)) throw new Error('adventure_invalid_session');
  return data as unknown as Session;
}
function decodeProgress(data: unknown): Progress {
  if (!obj(data) || !Number.isInteger(data.completed_stage) || !Number.isInteger(data.unlocked_stage)
    || Number(data.completed_stage) < 0 || Number(data.completed_stage) > 100
    || Number(data.unlocked_stage) !== Math.min(100, Number(data.completed_stage) + 1)
    || !Number.isSafeInteger(data.dark_stones) || Number(data.dark_stones) < 0
    || (data.active_session_id != null && (typeof data.active_session_id !== 'string'
      || !/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(data.active_session_id))))
    throw new Error('adventure_invalid_progress');
  return data as Progress;
}
function message(error: unknown, en: boolean) {
  const s = error instanceof Error ? error.message : String(error);
  if (/adventure_definitively_rejected/.test(s)) return en
    ? 'This action could not continue. Nothing was charged again. Tap Restore fight to return.'
    : 'Не удалось продолжить действие. Повторного списания нет. Нажми «Восстановить бой».';
  if (/combat_starts_paused/.test(s)) return en
    ? 'New cave fights are temporarily paused. Existing fights can continue.'
    : 'Новые бои в пещере временно приостановлены. Начатые бои можно продолжить.';
  if (/dark_stone/.test(s)) return en ? 'No Dark Stones; next grant at 00:00 UTC.' : 'Тёмные камни закончились. Новые будут в 00:00 UTC.';
  if (/reconciliation|profile|ownership/.test(s)) return en
    ? 'Hero equipment must be verified before using the new campaign.'
    : 'Для новой кампании требуется сверка характеристик героя и экипировки.';
  if (/adventure_reload_required|adventure_save_blocked/.test(s)) return en
    ? 'Your progress changed on another screen. Close and reopen the game to load it safely.'
    : 'Прогресс обновился. Закрой игру и открой её заново, чтобы загрузить изменения.';
  if (/settlement|not_enabled|not_configured|unavailable|not_ready/.test(s)) return en
    ? 'This adventure is not available yet. Your progress is safe.'
    : 'Этот поход пока недоступен. Твой прогресс сохранён.';
  return en ? 'Could not confirm the result. Tap Restore fight; rewards will not be duplicated.'
    : 'Пока не удалось подтвердить результат. Нажми «Восстановить бой» — повторной награды не будет.';
}

/** Separate V1 server campaign: NEVER computes a win, cost, loot or stats in the browser. */
export function ServerAdventureScreen({ userId, onActiveChange, onShop }: Props) {
  const { language } = useLanguage();
  const en = language === 'en';
  const game = useStore(useGame);
  const arena = useStore(useArena);
  const [gearOpen, setGearOpen] = useState(false);
  const [elixirsOpen, setElixirsOpen] = useState(false);
  const [selectedElixir, setSelectedElixir] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null);
  const [stoneInfo, setStoneInfo] = useState(false);
  const [floorInfo, setFloorInfo] = useState(false);
  const [caveTab, setCaveTab] = useState<'floors'|'gear'|'gems'|'fund'>('floors');
  const [box] = useCaveSandbox();
  const floorListRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  // Automatic stepping uses the SAME receipt-checked advance as manual input.
  // The single Challenge creates only one server-manual session / Dark Stone debit.
  const [autoFight, setAutoFight] = useState(false);
  const autoFightSession = useRef('');
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const mounted = useRef(true);
  const lock = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const battleRef = useRef<HTMLDivElement | null>(null);
  const strikeId = useRef(0);
  // Resume/retry may return the same authoritative event batch more than once.
  // Event IDs belong to a single server session, not to a React render.
  const seenServerEvents = useRef<{ sessionId: string; keys: Set<string> }>({ sessionId: '', keys: new Set() });
  const [strikeQueue, setStrikeQueue] = useState<StrikeEvent[]>([]);
  const strike = strikeQueue[0] ?? null;
  const [battleLog, setBattleLog] = useState<string[]>([]);

  const install = useCallback((value: Session) => {
    if (!mounted.current) return;
    sessionRef.current = value;
    if (autoFightSession.current !== value.session_id) {
      autoFightSession.current = value.session_id;
      // Keep the player's last Auto choice between fights; legacy auto sessions stay auto.
      setAutoFight(previous => previous || value.state.input.control === 'auto');
    }
    setSession(value);
    // Visual effects follow the authoritative server event stream, never invented client hits.
    if (seenServerEvents.current.sessionId !== value.session_id) {
      seenServerEvents.current = { sessionId: value.session_id, keys: new Set() };
      setStrikeQueue([]);
      setBattleLog([]);
    }
    const events = (Array.isArray(value.events) ? value.events : []).filter((event, index) => {
      const identity = event.id ? `event:${event.id}` : `revision:${value.revision}:index:${index}`;
      if (seenServerEvents.current.keys.has(identity)) return false;
      seenServerEvents.current.keys.add(identity);
      return true;
    });
    const hits = events.filter(event =>
      ['impact', 'critical', 'block', 'dodge'].includes(event.type)
      && (event.target === 'hero' || event.target === 'enemy')).slice(-6);
    if (hits.length) {
      const opponent = floorEnemy(value.state.input.stage, en);
      const hero = useGame.get().player.name;
      const confirmed: StrikeEvent[] = hits.map(hit => ({
        key: ++strikeId.current,
        attacker: hit.actor === 'hero' ? hero : opponent,
        target: hit.target === 'hero' ? hero : opponent,
        tone: (hit.type === 'critical' ? 'crit' : hit.type === 'block' ? 'block' :
          hit.type === 'dodge' ? 'dodge' : 'hit') as StrikeEvent['tone'],
        amount: typeof hit.value === 'number' ? Math.floor(hit.value) : null,
      }));
      setStrikeQueue(old => [...old, ...confirmed].slice(-8));
    }
    if (events.length) setBattleLog(old => [
      ...old,
      ...events.filter(event => ['impact', 'critical', 'block', 'dodge', 'rune_proc'].includes(event.type))
        .slice(-5).map(event => event.type === 'rune_proc'
          ? (en ? 'Rune activated' : 'Сработала руна')
          : `${event.actor === 'hero' ? (en ? 'Hero' : 'Герой') : floorEnemy(value.state.input.stage, en)}: ${event.type === 'critical' ? (en ? 'Critical hit' : 'Критический удар') : event.type === 'block' ? (en ? 'Block' : 'Блок') : event.type === 'dodge' ? (en ? 'Dodge' : 'Уклонение') : (en ? 'Hit' : 'Удар')}${typeof event.value === 'number' ? ' −' + Math.floor(event.value) : ''}`)
    ].slice(-8));
    // Telegram WebView can deny storage writes (private mode/quota). A confirmed
    // server receipt must still render and remain recoverable via server progress.
    try {
      localStorage.setItem(sessionKey(userId), value.session_id);
    } catch {
      // The authoritative session is already held in memory and on the server.
    }
    onActiveChange?.(value.state.status === 'fighting');
  }, [userId, onActiveChange, en]);

  // The stage grid is tall on phones. Move to the actual fight once a session starts.
  useEffect(() => {
    if (!session?.session_id) return;
    const frame = requestAnimationFrame(() => battleRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [session?.session_id]);

  // Only animate hits present in an authenticated server receipt. Never draw
  // fabricated damage while waiting for the next server-confirmed step.
  useEffect(() => {
    if (!strike) return;
    const timer = window.setTimeout(() => setStrikeQueue(q => q.slice(1)), 920);
    return () => window.clearTimeout(timer);
  }, [strike]);

  const readProgress = useCallback(async () => {
    const response = await supabase.rpc('territory_adventure_progress_v1');
    if (response.error) throw new Error('adventure_progress_unavailable');
    const found = decodeProgress(response.data);
    if (mounted.current) {
      setProgress(found);
      // Cave progress and currency always come from the server.
    }
    return found;
  }, []);

  const runSavedStart = useCallback(async () => {
    const command=restoreAdventureStartFence(userId);
    if (!command) return false;
    const started = decodeSession(await requestAdventureStart(userId,command,hooks));
    install(started);
    // Start receipt replay may predate a finished fight. Load its live status.
    install(decodeSession(await requestAdventureSettlement(
      userId, { action: 'resume', sessionId: started.session_id }, hooks)));
    return true;
  }, [install, userId]);

  const restore = useCallback(async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setRecoverable(false);
    try {
      if (!await ensurePlayerSession(userId)) throw new Error('combat_auth_required');
      // Always show real server progress, including when old receipt recovery fails.
      const currentProgress = await readProgress();
      const pending = restoreAdventureSaveFence(userId);
      if (pending) {
        const result = decodeSession(await requestAdventureSettlement(userId, pending, hooks));
        install(result);
        install(decodeSession(await requestAdventureSettlement(
          userId, { action: 'resume', sessionId: result.session_id }, hooks)));
      } else {
        let recoveredStart = false;
        try {
          recoveredStart = await runSavedStart();
        } catch (cause) {
          // A verified 409 proves that the pending start did NOT charge again.
          // Its server-authorized rollback also refreshes the owner's cloud
          // snapshot and removes the rejected start marker. Continue with the
          // already-active server session, not a second challenge/debit.
          if (!(cause instanceof Error) || cause.message !== 'adventure_definitively_rejected'
            || !currentProgress.active_session_id) throw cause;
          install(decodeSession(await requestAdventureSettlement(
            userId, { action: 'resume', sessionId: currentProgress.active_session_id }, hooks)));
          recoveredStart = true;
        }
        if (!recoveredStart) {
          const id = currentProgress.active_session_id || localStorage.getItem(sessionKey(userId));
          if (id) install(decodeSession(await requestAdventureSettlement(
            userId, { action: 'resume', sessionId: id }, hooks)));
        }
      }
      const prepared = await supabase.functions.invoke('territory-combat', { body: { action: 'prepare' } });
      if (prepared.error || !obj(prepared.data)) throw new Error('combat_unavailable');
      // An existing server session keeps its pinned fighter even when a later
      // equipment change requires review. Do not block its controls, and do
      // not authorize a new start until preparation succeeds.
      const mayFinishPinnedSession = prepared.data.status === 'reconciliation_required'
        && prepared.data.reason === 'active_session'
        && sessionRef.current?.state.status === 'fighting';
      if (prepared.data.status !== 'ready' && !mayFinishPinnedSession) throw new Error('combat_profile_not_verified');
      if (mounted.current) setReady(prepared.data.status === 'ready');
      await readProgress();
    } catch (cause) {
      if (mounted.current) { setError(message(cause, en)); setRecoverable(true); }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }, [userId, runSavedStart, install, readProgress, en]);

  useEffect(() => {
    mounted.current = true;
    void restore();
    return () => { mounted.current = false; onActiveChange?.(false); };
  }, [restore, onActiveChange]);

  const start = async () => {
    if (lock.current || !ready || !progress || sessionRef.current?.state.status === 'fighting') return;
    lock.current = true; setBusy(true); setError('');
    try {
      const command=restoreAdventureStartFence(userId) || {
        action: 'start' as const, operationId: crypto.randomUUID(),
        encounterId: 'adventure_v1_stage_' + progress.unlocked_stage, control: 'manual' as const,
      };
      install(decodeSession(await requestAdventureStart(userId,command,hooks)));
      await readProgress();
    } catch (cause) { if (mounted.current) { setError(message(cause,en)); setRecoverable(true); } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };

  const advance = useCallback(async (skillId?: string) => {
    const current = sessionRef.current;
    if (lock.current || !current || current.state.status !== 'fighting') return;
    lock.current = true; setBusy(true); setError('');
    try {
      const saved = restoreAdventureSaveFence(userId);
      const cmd = saved || { action: 'advance' as const, operationId: crypto.randomUUID(),
        sessionId: current.session_id, revision: current.revision, ...(skillId ? { skillId } : {}) };
      const result = decodeSession(await requestAdventureSettlement(userId, cmd, hooks));
      install(result);
      if (result.state.status !== 'fighting') await readProgress();
      setRecoverable(false);
    } catch (cause) {
      if (mounted.current) { setError(message(cause, en)); setRecoverable(true); }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }, [userId, install, readProgress, en]);

  useEffect(() => {
    const onVisibilityChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!session || session.state.status !== 'fighting' || !autoFight
      || busy || recoverable || !visible) return;
    const timer = window.setTimeout(() => { void advance(); }, 1100);
    return () => window.clearTimeout(timer);
  }, [session, busy, recoverable, visible, autoFight, advance]);

  const clearFinished = () => {
    if (lock.current || sessionRef.current?.state.status === 'fighting') return;
    localStorage.removeItem(sessionKey(userId));
    sessionRef.current = null; autoFightSession.current = '';
    seenServerEvents.current = { sessionId: '', keys: new Set() };
    setSession(null); setStrikeQueue([]); setBattleLog([]); onActiveChange?.(false);
    // A finished pinned session does not approve the new equipment. Recheck
    // before offering a new start, including on a different device.
    setReady(false);
    void restore();
  };

  const currentStage = progress?.unlocked_stage ?? 1;
  const actor = session?.state.actors;
  const hp = (side: 'hero' | 'enemy') => {
    const stats = actor?.[side]?.stats;
    const left = actor?.[side]?.stats.hp ?? 0;
    const max = Math.max(1, stats?.maxHp ?? 1);
    return { left, max, pct: Math.max(0, Math.min(100, 100 * left / max)) };
  };
  const finished = session && session.state.status !== 'fighting';
  const floorFocus = selectedFloor ?? currentStage;
  const highlightedFloor = getCaveFloor(floorFocus);
  const battleFloor = session ? getCaveFloor(session.state.input.stage) : highlightedFloor;
  const heroName = useGame.get().player.name;
  const enemyName = en ? battleFloor.enemyEn : battleFloor.enemyRu;
  // Keep the exact hero appearance chosen by the player.
  const heroFrames = getCombatAppearance(game.appearance);
  const fighterSrc = heroFrames.idle;
  const characterArt = (floor: CaveFloor) => import.meta.env.BASE_URL + 'assets/territory/characters/' + floor.enemyArt + '/idle.webp';
  const enemySrc = characterArt(battleFloor);
  const companion = Array.isArray(game.followers) ? selectedFollower(game) : null;
  const darkStoneArt = import.meta.env.BASE_URL + 'assets/territory/items/dark-stone.svg';
  const realmArt = import.meta.env.BASE_URL + 'assets/territory/scenes/dark-cave-realm.svg';
  const sceneArt = import.meta.env.BASE_URL + 'assets/territory/cave/scene/';
  const depthStyle = (floor: CaveFloor) => ({ '--depth': floor.depth.hue }) as CSSProperties;
  const mayChallenge = progress !== null && floorFocus === progress.unlocked_stage && progress.completed_stage < 100;
  const floorState = (index: number): 'cleared' | 'current' | 'locked' => !progress || index > progress.unlocked_stage ? 'locked'
    : index <= progress.completed_stage ? 'cleared' : 'current';
  // Test loot for a server-confirmed victory: keyed by the session, so a
  // remount, resume or double delivery can never loot the same fight twice.
  const victoryLootId = session?.state.status === 'hero_won' && session.settlement ? 'victory:' + session.session_id : null;
  useEffect(() => {
    if (!victoryLootId || !session) return;
    const floor = getCaveFloor(session.state.input.stage);
    dispatchCave({ type: 'loot', floor: floor.index, boss: floor.kind === 'boss' }, victoryLootId);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per confirmed victory id
  }, [victoryLootId]);
  const victoryLoot = victoryLootId && box.lastLoot?.opId === victoryLootId ? box.lastLoot : null;
  const jumpToCurrent = () => {
    setSelectedFloor(null);
    setCaveTab('floors');
    const panel = floorListRef.current;
    const current = panel?.querySelector<HTMLElement>('[data-current-floor="true"]');
    if (panel && current) {
      panel.scrollTop = current.offsetTop - panel.offsetTop - panel.clientHeight / 2 + current.clientHeight / 2;
    }
  };
  // Scroll inside the floor list, not the entire Telegram WebApp or the battle page.
  useEffect(() => {
    if (session || !progress || caveTab !== 'floors') return;
    const frame = requestAnimationFrame(() => {
      const panel = floorListRef.current;
      const current = panel?.querySelector<HTMLElement>('[data-current-floor="true"]');
      if (panel && current) {
        panel.scrollTop = current.offsetTop - panel.offsetTop - panel.clientHeight / 2 + current.clientHeight / 2;
      }
    });
    return () => cancelAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll only when the session, tab or unlocked floor changes
  }, [session?.session_id, progress?.unlocked_stage, caveTab]);

  return <section className="cv-root flex h-full min-h-0 flex-1 flex-col gap-1.5 overflow-hidden" data-testid="territory-adventure-v1">
    <h2 className="sr-only">{en ? 'Dark Cave' : 'Тёмная пещера'}</h2>
    {error && <p role="alert" className="rounded-xl border border-red-400/40 bg-red-950/50 p-3 text-xs text-red-100">{error}</p>}
    {recoverable && <button disabled={busy} onClick={()=>void restore()} className="w-full rounded-xl border border-amber-500/60 bg-amber-900/30 p-3 font-semibold text-amber-100">
      {en ? 'Restore fight' : 'Восстановить бой'}
    </button>}
    {busy && !session && <p role="status" className="text-center text-amber-100 text-xs"><Loader2 className="w-4 h-4 animate-spin inline mr-2"/>{en?'Connecting to fight…':'Подключаем бой…'}</p>}
    {session ? <div ref={battleRef} data-testid="territory-adventure-battle" style={depthStyle(battleFloor)}
      className="cv-panel min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 space-y-1.5 scroll-mt-3">
      <p className="text-center text-[11px] text-amber-200 font-bold">
        {en ? battleFloor.depth.en : battleFloor.depth.ru} · {en?'Floor':'Этаж'} {session.state.input.stage}
        {battleFloor.kind === 'boss' && <span className="ml-1 text-yellow-300">· {en ? 'BOSS' : 'БОСС'}</span>}
        {busy && <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin" aria-label={en?'Confirming…':'Подтверждаем…'}/>}
      </p>
      {/* Layers: background → back VFX → fighters → foreground → HUD. */}
      <div className="cv-arena" data-testid="dark-cave-arena">
        <img src={realmArt} alt="" draggable={false} className="cv-arena-bg" data-testid="dark-cave-battle-background" />
        <div className="cv-arena-tint" />
        <div className="cv-arena-rift" />
        <img src={sceneArt + 'rune-circle.svg'} alt="" className="cv-arena-rune cv-arena-rune--hero" />
        <img src={sceneArt + 'rune-circle.svg'} alt="" className="cv-arena-rune cv-arena-rune--foe" />
        <div className="cv-arena-stage">
          {(['hero','enemy'] as const).map(side => <div key={side} className="relative min-w-0 flex flex-col">
            <div className="cv-fig">
              {side === 'hero' && companion && <img src={getFollowerArt(companion.id)} alt={en ? 'Companion' : 'Спутник'} className="cv-ally" data-testid="dark-cave-companion" draggable={false} />}
              {side === 'hero'
                ? <FighterFigure src={fighterSrc} combatFrames={heroFrames}
                    name={heroName} dir={1} alive={hp(side).left > 0} won={session.state.status === 'hero_won'}
                    strike={strike} idleSeconds={3.1} scale={1.2}
                    className="absolute right-0 bottom-0 h-full w-full object-contain object-right-bottom" />
                : <FighterFigure src={enemySrc} combatFrames={getEnemyCombatFrames(enemySrc)}
                    name={enemyName} dir={-1} alive={hp(side).left > 0} won={session.state.status === 'enemy_won'}
                    strike={strike} idleSeconds={2.8}
                    className={'absolute left-0 bottom-0 w-full object-contain object-left-bottom ' + (battleFloor.kind === 'boss' ? 'h-[96%]' : 'h-[86%]')} />}
            </div>
          </div>)}
        </div>
        <img src={sceneArt + 'foreground.svg'} alt="" className="cv-arena-front" />
        <div className="cv-arena-hud" data-testid="dark-cave-hud">
          {(['hero','enemy'] as const).map(side => <div key={side} className={'cv-hp' + (side === 'enemy' && battleFloor.kind === 'boss' ? ' cv-hp--boss' : '')}>
            <p className="cv-hp-name">{side === 'enemy' && battleFloor.kind === 'boss' && <Crown size={12} className="shrink-0 text-yellow-300"/>}
              <span className="truncate">{side === 'hero' ? heroName : enemyName}</span></p>
            <div className={'cv-hp-bar ' + (side === 'hero' ? 'cv-hp-bar--hero' : 'cv-hp-bar--foe')}><div style={{ width: hp(side).pct + '%' }} /></div>
            <p className="cv-hp-num">{Math.ceil(hp(side).left)}/{Math.ceil(hp(side).max)} HP</p>
          </div>)}
        </div>
        <div className="cv-arena-fog" />
        {[8, 22, 37, 55, 71, 88].map((left, i) => <span key={left} className="cv-mote" style={{ left: left + '%', bottom: (6 + (i % 3) * 9) + '%', animationDelay: (-i * 0.9) + 's' }} />)}
        {strike && <span key={strike.key} data-testid="dark-cave-impact"
          className={'cv-burst ' + (strike.target === heroName ? 'cv-burst--hero' : 'cv-burst--foe') + (strike.tone === 'crit' ? ' cv-burst--crit' : strike.tone === 'block' || strike.tone === 'dodge' ? ' cv-burst--block' : '')} />}
        {strike?.tone === 'crit' && <span key={'flash-' + strike.key} className="cv-flash" />}
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-amber-100">
        <span className="flex items-center gap-1"><Zap size={13}/>{en ? 'Energy' : 'Энергия'}: {Math.floor(session.state.actors.hero.energy)}/{session.state.input.rules.maxEnergy}</span>
        <span className="cv-chip">{battleFloor.kind === 'boss' ? (en?'Boss fight':'Битва с боссом') : battleFloor.kind === 'elite' ? (en?'Elite foe':'Элитный враг') : (en?'Cave dweller':'Обитатель пещеры')}</span>
      </div>
      {!!battleLog.length && <div data-testid="dark-cave-battle-log" className="rounded-lg border border-white/10 bg-black/35 px-2 py-1 text-[11px] leading-tight text-slate-200" aria-live="polite">
        {battleLog.slice(-2).map((line, i) => <p key={i} className="truncate">{line}</p>)}
      </div>}
      {finished ? <>
        <p className={'cv-result ' + (session.state.status==='hero_won' ? 'cv-result--win' : 'cv-result--loss')} role="status">{session.state.status==='hero_won' ? (en?'Victory!':'Победа!') : session.state.status==='enemy_won' ? (en?'Defeat':'Поражение') : (en?'Draw':'Ничья')}</p>
        {session.state.status==='hero_won' && session.settlement?.reward && <p className="text-center text-xs text-yellow-100">
          +{session.settlement.reward.gold} {en?'gold':'монет'} · +{session.settlement.reward.xp} XP
        </p>}
        {session.state.status === 'hero_won' && progress && progress.unlocked_stage > session.state.input.stage && (
          <p className="rounded-lg border border-emerald-400/40 bg-emerald-950/40 px-3 py-1.5 text-center text-sm font-bold text-emerald-200" data-testid="dark-cave-next-floor">
            {en ? 'Next floor unlocked: ' : 'Открыт следующий этаж: '}{progress.unlocked_stage}
          </p>
        )}
        {victoryLoot && <CaveLootReveal en={en} loot={victoryLoot} />}
        {session.state.status !== 'hero_won' && <p className="text-center text-xs text-amber-100/80">
          {en ? 'Strengthen your build and try this floor again.' : 'Усиль сборку и попробуй пройти этот этаж ещё раз.'}
        </p>}
        {session.state.status !== 'hero_won' && session.settlement?.dark_stone_refunded === true && (
          <p className="rounded-lg border border-emerald-400/45 bg-emerald-950/45 px-3 py-2 text-center text-sm font-bold text-emerald-100" data-testid="dark-cave-stone-refunded">
            {en ? 'Dark Stone returned — try again!' : 'Тёмный камень возвращён — попробуй ещё раз!'}
          </p>
        )}
        <button onClick={clearFinished} disabled={busy} className="cv-challenge">{en?'Back to cave floors':'К этажам пещеры'}</button>
      </> : <>
        <div className="cv-controls" data-testid="dark-cave-control-panel">
          <button type="button" data-testid="dark-cave-toggle-auto"
            aria-pressed={autoFight}
            aria-label={en ? 'Toggle automatic battle' : 'Переключить автоматический бой'}
            disabled={recoverable || session.state.input.control === 'auto'}
            onClick={() => setAutoFight(v => !v)}
            className={'cv-btn min-h-11 ' + (autoFight ? 'cv-btn--gold' : '')}>
            {autoFight ? (en ? 'Auto: on' : 'Авто: вкл') : (en ? 'Auto: off' : 'Авто: выкл')}
          </button>
          {session.state.input.control==='manual' && !autoFight
            ? <button type="button" disabled={busy || recoverable} onClick={()=>void advance()} className="cv-btn cv-btn--gold min-h-11 text-sm">
                <Swords size={17} aria-hidden="true"/>{en?'Continue battle':'Продолжить бой'}
              </button>
            : <span className="flex items-center justify-center rounded-lg border border-amber-500/25 bg-black/30 px-2 text-center text-[11px] text-amber-100/80">{en?'The hero fights automatically':'Герой сражается автоматически'}</span>}
        </div>
        {session.state.input.control==='manual' && !autoFight && session.state.actors.hero.loadout.skills.length > 0 && <div className="cv-skills" data-testid="dark-cave-manual-actions">
          {session.state.actors.hero.loadout.skills.map(slot=>{
            const def = session.state.input.catalog.skills.find(item => item.id === slot.skillId);
            const rank = def?.levels[slot.level - 1];
            const onCooldown = (session.state.actors.hero.cooldowns[slot.skillId] ?? 0) > session.state.atMs;
            const enoughEnergy = !!rank && session.state.actors.hero.energy >= rank.energyCost;
            return <button key={slot.skillId} type="button"
              disabled={busy || recoverable || !rank || onCooldown || !enoughEnergy}
              onClick={()=>void advance(slot.skillId)}
              className="cv-btn min-h-11 flex-col !gap-0"
              aria-label={slot.skillId.replace(/_/g,' ')}>
              <span className="block max-w-full truncate">{slot.skillId.replace(/_/g,' ')}</span>
              <span className="block text-[10px] font-bold text-amber-200/90">{onCooldown ? (en?'Cooldown':'Откат') : rank ? `${rank.energyCost} ⚡` : (en?'Unavailable':'Недоступно')}</span>
            </button>;
          })}
        </div>}
      </>}
      <div className="grid grid-cols-1 gap-1.5" data-testid="dark-cave-combat-panels">
        <FoldSection title={en?'Equipment':'Экипировка'}
          summary={<span className="text-[10px] text-amber-100">{Object.values(game.player.equipped ?? {}).filter(Boolean).length}/7</span>}
          open={gearOpen} onToggle={() => setGearOpen(v => !v)}>
          <GearStrip equipped={game.player.equipped}/>
          <p className="mt-1.5 text-[10px] text-amber-100/75">
            {en?'Your combat stats were locked when this fight started. Gear here reflects your current hero.':'Характеристики зафиксированы при входе в бой. Здесь показана текущая экипировка героя.'}
          </p>
        </FoldSection>
        <FoldSection title={en?'Elixir belt':'Пояс эликсиров'}
          summary={<span className="text-[10px] text-amber-100">{game.belt.filter(Boolean).length}/7</span>}
          open={elixirsOpen} onToggle={() => setElixirsOpen(v => !v)}>
          <BeltCells belt={game.belt} ctx={beltContext(game,arena.wins)} disabled
            onTap={(index) => setSelectedElixir(current => current === index ? null : index)}/>
          {selectedElixir !== null && game.belt[selectedElixir] && (
            <p className="mt-1 text-[11px] text-amber-200">{game.belt[selectedElixir]?.name}</p>
          )}
          <p className="mt-1.5 text-[10px] text-amber-100/75" role="note">
            {en?'Elixirs are not available in Cave fights yet. Nothing is consumed from your belt.':'Эликсиры в Пещере пока недоступны. Ничего из пояса не расходуется.'}
          </p>
        </FoldSection>
      </div>
    </div> : progress ? <>
      {caveTab === 'gear' ? <CaveUmbraScreen en={en} hero={fighterSrc} onBack={() => setCaveTab('floors')}/>
      : caveTab === 'gems' ? <CaveGemsScreen en={en} onBack={() => setCaveTab('floors')}/>
      : <div className="cv-panel cv-lobby" style={{ ...woodStyle(), ...depthStyle(highlightedFloor) }} data-testid="dark-cave-realm">
        <div className="cv-head">
          <h3 className="cv-title">{en?'Realm of Dark Energy':'Царство тёмной энергии'}</h3>
          <button type="button" className="cv-chip min-h-9" onClick={jumpToCurrent} data-testid="dark-cave-my-floor"
            aria-label={(en?'My floor: ':'Мой этаж: ') + currentStage + (en?' of 100':' из 100')}>{en?'Floor':'Этаж'} {currentStage}/100</button>
          <button type="button" onClick={()=>setStoneInfo(true)} data-testid="dark-stone-balance" className="cv-stone"
            aria-label={(en?'Dark Stones: ':'Тёмные камни: ') + progress.dark_stones}>
            <img src={darkStoneArt} alt=""/>{progress.dark_stones}<Info size={12} className="text-[#e6c88f]"/>
          </button>
        </div>
        <div className="cv-tabs grid-cols-4" role="group" aria-label={en?'Cave sections':'Разделы пещеры'}>
          {([['floors',en?'Floors':'Этажи'],['gear',en?'Dark gear':'Снаряжение'],['gems',en?'Gems':'Камни'],['fund',en?'Fund':'Фонд']] as const).map(([id,label]) =>
            <button key={id} type="button" onClick={()=>setCaveTab(id)} aria-pressed={caveTab===id} className="cv-tab" data-testid={'cave-tab-'+id}>{label}</button>)}
        </div>
        {caveTab === 'fund' && <CaveFundPanel en={en} clearedDepth={progress.completed_stage}/>}
        {caveTab === 'floors' && <>
        <div className="cv-banner dark-cave-portal-wrap" data-testid="dark-cave-visual">
          <img src={realmArt} alt={en?'Violet abyss beneath the mountains':'Фиолетовая бездна в глубине подземелья'} draggable={false}
            className="cv-banner-art pointer-events-none select-none" data-testid="dark-cave-portal"/>
          <div className="cv-banner-text">
            <small>{en ? highlightedFloor.depth.en : highlightedFloor.depth.ru}</small>
            <strong>{en?'Floor':'Этаж'} {floorFocus} · {en ? highlightedFloor.enemyEn : highlightedFloor.enemyRu}</strong>
          </div>
          <img src={characterArt(highlightedFloor)} alt="" className="cv-banner-foe" draggable={false}
            style={floorState(floorFocus) === 'locked' ? { filter: 'brightness(0) drop-shadow(0 0 6px #b46cf2)' } : undefined}/>
          <button type="button" className="cv-banner-info" data-testid="cave-floor-info" onClick={()=>setFloorInfo(true)}
            aria-label={(en?'Floor details: ':'Подробнее об этаже: ') + floorFocus}/>
        </div>
        <div className="cv-floors dark-cave-floor-wrap min-h-[170px]" data-testid="dark-cave-floor-list">
          <div ref={floorListRef} data-testid="dark-cave-floor-scroll" role="region" aria-label={en?'Scrollable cave floors':'Прокручиваемый список этажей'}
            tabIndex={0} className="dark-cave-floor-scroll relative h-full min-h-0 space-y-1 overflow-y-auto overscroll-contain pr-1 touch-pan-y">
            {CAVE_FLOORS.map(floor=>{
              const state = floorState(floor.index);
              const current = state === 'current' && progress.completed_stage < 100;
              const locked = state === 'locked' || progress.completed_stage === 100 && state !== 'cleared';
              const highlighted = floor.index === floorFocus;
              return <div key={floor.index}>
                {floor.floorInDepth === 1 && <p className="cv-depth-label" style={{ color: floor.depth.hue }}>
                  {en?'Depth':'Глубина'} {floor.depth.id} · {en ? floor.depth.en : floor.depth.ru}
                </p>}
                <button type="button" aria-pressed={highlighted} data-current-floor={current?'true':undefined}
                  data-testid={current?'dark-cave-current-floor':undefined} onClick={()=>setSelectedFloor(floor.index)}
                  aria-label={(en?'Floor ':'Этаж ')+floor.index+(locked?(en?' locked':' закрыт'):'')}
                  className={'cv-floor min-h-[45px]' + (current ? ' cv-floor--current' : locked ? ' cv-floor--locked' : ' cv-floor--cleared') + (floor.kind==='boss' && !locked ? ' cv-floor--boss' : '')}>
                  <span className="cv-floor-ico">{locked ? <Lock size={15} className="text-[#706987]"/> :
                    floor.kind==='boss' ? <Crown size={16} className="text-[#f3c868]"/> :
                    state==='cleared' ? <Check size={16} className="text-[#8ad1a4]"/> : <Swords size={16} className="text-[#f3c868]"/>}</span>
                  <span className="cv-floor-main">
                    <b>{en?'Floor':'Этаж'} {floor.index}{floor.kind==='boss' ? (en?' · Boss':' · Босс') : floor.kind==='elite' ? (en?' · Elite':' · Элита') : ''}</b>
                    <span>{locked ? (en?'Clear the previous floor first':'Сначала пройди предыдущий этаж') : (en ? floor.enemyEn : floor.enemyRu)}</span>
                  </span>
                  {current && <span className="cv-floor-tag">{en?'NOW':'СЕЙЧАС'}</span>}
                  {state==='cleared' && !locked && <span className="text-[9px] text-[#8ad1a4]">{en?'Cleared':'Пройден'}</span>}
                  {locked && floor.kind==='boss' && <Crown size={15} className="shrink-0 text-[#83648c]"/>}
                  {!locked && <ChevronRight size={15} className="shrink-0 text-[#c9a36a]"/>}
                </button>
              </div>;
            })}
          </div>
        </div>
        <CaveBlessingSlots en={en} floor={currentStage} onShop={onShop}/>
        <div className="relative z-10 flex shrink-0 flex-col gap-1" data-testid="dark-cave-actions">
          {progress.completed_stage < 100 ? <>
            {mayChallenge ? <button type="button"
              disabled={!ready||busy||recoverable||!mayChallenge||progress.dark_stones<1}
              onClick={()=>void start()}
              data-testid="dark-cave-challenge"
              aria-label={en?'Challenge, 1 Dark Stone':'Вызов, 1 Тёмный камень'}
              className="cv-challenge">
              <img src={darkStoneArt} alt=""/>
              {en?'Challenge · 1 Dark Stone':'Вызов · 1 Тёмный камень'}
            </button> : <button type="button" className="cv-challenge" data-testid="dark-cave-to-current" onClick={jumpToCurrent}>
              {en?'To my floor · ':'К моему этажу · '}{currentStage}
            </button>}
            {!mayChallenge?<p className="cv-hint">
              {floorFocus <= progress.completed_stage
                ? (en?'Floor cleared. Repeat raids are in preparation.':'Этаж пройден. Повторные рейды готовятся.')
                : (en?'This floor is still locked.':'Этот этаж ещё закрыт.')}
            </p>:progress.dark_stones<1?<p className="cv-hint">
              {en?'Dark Stones exhausted · +3 at 00:00 UTC':'Тёмные камни закончились · +3 в 00:00 UTC'}
            </p>:<p className="cv-hint cv-hint--optional">
              {en?'Entry costs 1 Dark Stone':'Вход — 1 Тёмный камень'}
            </p>}
          </>:<p className="text-center text-sm font-black text-[#ffe1a6]">{en?'All 100 cave floors cleared!':'Все 100 этажей подземелья пройдены!'}</p>}
        </div>
        </>}
        {stoneInfo && <Dialog label={en?'Dark Stones':'Тёмные камни'} onClose={()=>setStoneInfo(false)} testId="dark-stone-info">
          <h3>{en?'Dark Stones':'Тёмные камни'}: {progress.dark_stones}</h3>
          <p className="cv-note">{en
            ? 'The entry key of the cave: 1 stone per confirmed Challenge. First visit grants 5, then +3 every day at 00:00 UTC. The balance is kept by the server.'
            : 'Ключ входа в Пещеру: 1 камень за подтверждённый «Вызов». При первом посещении — 5, далее +3 каждый день в 00:00 UTC. Баланс хранит сервер.'}</p>
          <p className="cv-note" style={{ marginTop: 5 }}>{en
            ? 'This is neither a socket gem nor an Awakening Stone.'
            : 'Это не драгоценный камень для гнёзд и не Камень пробуждения.'}</p>
          <button type="button" className="cv-btn cv-btn--wide" style={{ marginTop: 8 }} disabled data-testid="dark-stone-ad">
            {en?'Stone for a video · not available':'Камень за просмотр видео · недоступно'}</button>
          <p className="cv-note" style={{ marginTop: 4 }}>{en
            ? 'Up to 3 extra stones a day for watched videos are approved, but no ad provider is connected to the game yet, so nothing is granted here.'
            : 'До 3 дополнительных камней в день за просмотр видео одобрены, но рекламный провайдер к игре ещё не подключён — здесь ничего не начисляется.'}</p>
        </Dialog>}
        {floorInfo && <CaveFloorDialog en={en} floor={highlightedFloor} state={floorState(floorFocus)} onClose={()=>setFloorInfo(false)}/>}
      </div>}
    </> : <p role="status" className="rounded-xl border border-amber-700/30 bg-black/25 p-3 text-xs text-amber-100">
      {en ? 'Loading verified cave progress…' : 'Загружаем подтверждённый прогресс пещеры…'}
    </p>}
  </section>;
}
