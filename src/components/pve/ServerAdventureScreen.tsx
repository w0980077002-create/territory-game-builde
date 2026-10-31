import { useCallback, useEffect, useRef, useState } from 'react';
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
import { getCampaignStage } from '@/game/idleContent/campaign';
import type { IdleCombatState, IdleCombatEvent } from '@/game/idleEngine/types';
import { getCombatAppearance } from '@/game/appearance';
import { getEnemyCombatFrames } from '@/game/combatArt';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { FighterFigure } from '@/components/arena/FighterFigure';

type Progress = { completed_stage: number; unlocked_stage: number; dark_stones: number; active_session_id?: string | null };
type Settlement = { outcome: string; reward?: { gold: number; xp: number } };
type Session = { session_id: string; revision: number; state: IdleCombatState; events?: IdleCombatEvent[]; settlement?: Settlement | null };
type Props = { userId: string; onActiveChange?: (active: boolean) => void };
const sessionKey = (id: string) => 'territory_adventure_session_v1:' + id;
const startKey = (id: string) => 'territory_adventure_start_v1:' + id;
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
    ? 'The server rejected that action without a new charge. Your save was synchronized. Recover the fight to continue.'
    : 'Сервер отклонил действие без нового списания. Сохранение синхронизировано. Восстанови бой, чтобы продолжить.';
  if (/combat_starts_paused/.test(s)) return en
    ? 'New cave fights are temporarily paused. Existing fights can continue.'
    : 'Новые бои в пещере временно приостановлены. Начатые бои можно продолжить.';
  if (/dark_stone/.test(s)) return en ? 'No Dark Stones; next grant at 00:00 UTC.' : 'Тёмные камни закончились. Новые будут в 00:00 UTC.';
  if (/reconciliation|profile|ownership/.test(s)) return en
    ? 'Hero equipment must be verified before using the new campaign.'
    : 'Для новой кампании требуется сверка характеристик героя и экипировки.';
  if (/adventure_reload_required|adventure_save_blocked/.test(s)) return en
    ? 'A newer save exists. Reopen Telegram to synchronize safely.'
    : 'Есть более новое сохранение. Перезапусти Telegram для синхронизации.';
  if (/settlement|not_enabled|not_configured|unavailable|not_ready/.test(s)) return en
    ? 'This adventure is not available yet. Your progress is safe.'
    : 'Этот поход пока недоступен. Твой прогресс сохранён.';
  return en ? 'Cannot confirm the result. Use recovery; no duplicate reward will be sent.'
    : 'Не удалось подтвердить результат. Используй восстановление — награда не задвоится.';
}

/** Separate V1 server campaign: NEVER computes a win, cost, loot or stats in the browser. */
export function ServerAdventureScreen({ userId, onActiveChange }: Props) {
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
  const floorListRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const mounted = useRef(true);
  const lock = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const battleRef = useRef<HTMLDivElement | null>(null);
  const strikeId = useRef(0);
  const [strikeQueue, setStrikeQueue] = useState<StrikeEvent[]>([]);
  const strike = strikeQueue[0] ?? null;
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const hooks = { getState: () => useGame.get(), applyState: (state: ReturnType<typeof useGame.get>) => useGame.set(state) };

  const install = useCallback((value: Session) => {
    if (!mounted.current) return;
    sessionRef.current = value;
    setSession(value);
    // Visual effects follow the authoritative server event stream, never invented client hits.
    const events = Array.isArray(value.events) ? value.events : [];
    const hits = events.filter(event =>
      ['impact', 'critical', 'block', 'dodge'].includes(event.type)
      && (event.target === 'hero' || event.target === 'enemy')).slice(-6);
    if (hits.length) {
      const opponent = getCampaignStage(value.state.input.stage).enemyName;
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
          : `${event.actor === 'hero' ? (en ? 'Hero' : 'Герой') : getCampaignStage(value.state.input.stage).enemyName}: ${event.type === 'critical' ? (en ? 'Critical hit' : 'Критический удар') : event.type === 'block' ? (en ? 'Block' : 'Блок') : event.type === 'dodge' ? (en ? 'Dodge' : 'Уклонение') : (en ? 'Hit' : 'Удар')}${typeof event.value === 'number' ? ' −' + Math.floor(event.value) : ''}`)
    ].slice(-8));
    localStorage.setItem(sessionKey(userId), value.session_id);
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

  const start = async (control: 'auto' | 'manual') => {
    if (lock.current || !ready || !progress || sessionRef.current?.state.status === 'fighting') return;
    lock.current = true; setBusy(true); setError('');
    try {
      const command=restoreAdventureStartFence(userId) || {
        action: 'start' as const, operationId: crypto.randomUUID(),
        encounterId: 'adventure_v1_stage_' + progress.unlocked_stage, control,
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
    if (!session || session.state.status !== 'fighting' || session.state.input.control !== 'auto'
      || busy || recoverable || !visible) return;
    const timer = window.setTimeout(() => { void advance(); }, 1100);
    return () => window.clearTimeout(timer);
  }, [session, busy, recoverable, visible, advance]);

  const clearFinished = () => {
    if (lock.current || sessionRef.current?.state.status === 'fighting') return;
    localStorage.removeItem(sessionKey(userId));
    sessionRef.current = null; setSession(null); setStrikeQueue([]); setBattleLog([]); onActiveChange?.(false);
    // A finished pinned session does not approve the new equipment. Recheck
    // before offering a new start, including on a different device.
    setReady(false);
    void restore();
  };

  const currentStage = progress?.unlocked_stage ?? 1;
  const chosen = getCampaignStage(currentStage);
  const actor = session?.state.actors;
  const hp = (side: 'hero' | 'enemy') => {
    const stats = actor?.[side]?.stats;
    const left = actor?.[side]?.stats.hp ?? 0;
    const max = Math.max(1, stats?.maxHp ?? 1);
    return { left, max, pct: Math.max(0, Math.min(100, 100 * left / max)) };
  };
  const finished = session && session.state.status !== 'fighting';
  const battleStage = session ? getCampaignStage(session.state.input.stage) : chosen;
  const heroName = useGame.get().player.name;
  const enemyName = battleStage.enemyName;
  // Keep the exact hero appearance chosen by the player.
  const heroFrames = getCombatAppearance(game.appearance);
  const fighterSrc = heroFrames.idle;
  const enemySrc = import.meta.env.BASE_URL + 'assets/territory/characters/' + battleStage.enemyArt + '/idle.webp';
  const darkStoneArt = import.meta.env.BASE_URL + 'assets/territory/items/dark-stone.svg';
  const realmArt = import.meta.env.BASE_URL + 'assets/territory/scenes/dark-cave-realm.svg';
  const floors = Array.from({ length: 100 }, (_, i) => getCampaignStage(i + 1));
  const floorFocus = selectedFloor ?? currentStage;
  const highlightedFloor = getCampaignStage(floorFocus);
  const mayChallenge = progress !== null && floorFocus === progress.unlocked_stage && progress.completed_stage < 100;
  const jumpToCurrent = () => {
    setSelectedFloor(null);
    const panel = floorListRef.current;
    const current = panel?.querySelector<HTMLElement>('[data-current-floor="true"]');
    if (panel && current) {
      panel.scrollTop = current.offsetTop - panel.offsetTop - panel.clientHeight / 2 + current.clientHeight / 2;
    }
  };
  // Scroll inside the floor list, not the entire Telegram WebApp or the battle page.
  useEffect(() => {
    if (session || !progress) return;
    const frame = requestAnimationFrame(() => {
      const panel = floorListRef.current;
      const current = panel?.querySelector<HTMLElement>('[data-current-floor="true"]');
      if (panel && current) {
        panel.scrollTop = current.offsetTop - panel.offsetTop - panel.clientHeight / 2 + current.clientHeight / 2;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [session?.session_id, progress?.unlocked_stage]);

  return <section className="flex h-full min-h-0 flex-1 flex-col gap-1.5 overflow-hidden" data-testid="territory-adventure-v1">
    <h2 className="sr-only">{en ? 'Dark Cave' : 'Тёмная пещера'}</h2>
    {error && <p role="alert" className="rounded-xl border border-red-400/40 bg-red-950/50 p-3 text-xs text-red-100">{error}</p>}
    {recoverable && <button disabled={busy} onClick={()=>void restore()} className="w-full rounded-xl border border-amber-500/60 bg-amber-900/30 p-3 font-semibold text-amber-100">
      {en ? 'Recover server session' : 'Восстановить серверный бой'}
    </button>}
    {busy && <p role="status" className="text-center text-amber-100 text-xs"><Loader2 className="w-4 h-4 animate-spin inline mr-2"/>{en?'Synchronizing':'Синхронизация'}</p>}
    {session ? <div ref={battleRef} data-testid="territory-adventure-battle" className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-2xl border border-amber-600/50 bg-gradient-to-b from-amber-950/70 to-slate-950 p-2 space-y-3 scroll-mt-3">
      <p className="text-center text-xs text-amber-200 font-bold">{en?'Dark Cave':'Тёмная пещера'} · {en?'Floor':'Этаж'} {session.state.input.stage} · {enemyName}</p>
      <div className="relative min-h-[340px] overflow-hidden rounded-xl border border-amber-400/25 bg-slate-900">
        <img src={realmArt} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover object-center pointer-events-none" data-testid="dark-cave-battle-background" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/75 pointer-events-none" />
        <div className="relative grid grid-cols-2 gap-2 p-2 min-h-[340px]">
          {(['hero','enemy'] as const).map(side => <div key={side} className="relative min-w-0 flex flex-col">
            <div className="relative z-20 rounded-lg border border-white/15 bg-black/65 p-2">
              <p className="text-xs text-white font-semibold truncate mb-1">{side === 'hero' ? heroName : enemyName}</p>
              <div className="h-2 bg-black rounded-full overflow-hidden"><div className={side === 'hero' ? 'h-full bg-emerald-400 transition-[width] duration-500' : 'h-full bg-red-400 transition-[width] duration-500'} style={{ width: hp(side).pct + '%' }} /></div>
              <p className="text-[10px] text-gray-200 mt-1 text-right tabular-nums">{Math.ceil(hp(side).left)}/{Math.ceil(hp(side).max)} HP</p>
            </div>
            <div className="relative flex-1 z-10 min-h-[270px]">
              {side === 'hero'
                ? <FighterFigure src={fighterSrc} combatFrames={heroFrames}
                    name={heroName} dir={1} alive={hp(side).left > 0} won={session.state.status === 'hero_won'}
                    strike={strike} idleSeconds={3.1} scale={1.2}
                    className="absolute right-0 bottom-0 h-full w-full object-contain object-right-bottom" />
                : <FighterFigure src={enemySrc} combatFrames={getEnemyCombatFrames(enemySrc)}
                    name={enemyName} dir={-1} alive={hp(side).left > 0} won={session.state.status === 'enemy_won'}
                    strike={strike} idleSeconds={2.8}
                    className="absolute left-0 bottom-0 h-[86%] w-full object-contain object-left-bottom" />}
            </div>
          </div>)}
        </div>
      </div>
      <div className="flex justify-between items-center gap-2 text-xs text-amber-100">
        <span className="flex items-center gap-1"><Zap size={14}/>{en ? 'Energy' : 'Энергия'}: {Math.floor(session.state.actors.hero.energy)}/{session.state.input.rules.maxEnergy}</span>
        <span className="text-yellow-200">{session.state.input.control === 'auto' ? (en?'Auto':'Авто') : (en?'Manual':'Ручной')}</span>
      </div>
      {!!battleLog.length && <div data-testid="dark-cave-battle-log" className="rounded-lg bg-black/35 border border-white/10 px-2 py-1 text-[11px] text-slate-200 max-h-24 overflow-auto" aria-live="polite">
        {battleLog.slice(-4).map((line, i) => <p key={i}>{line}</p>)}
      </div>}
      <div className="grid grid-cols-1 gap-1.5" data-testid="dark-cave-combat-panels">
        <FoldSection title={en?'Equipment':'Экипировка'}
          summary={<span className="text-[10px] text-amber-100">{Object.values(game.player.equipped ?? {}).filter(Boolean).length}/7</span>}
          open={gearOpen} onToggle={() => setGearOpen(v => !v)}>
          <GearStrip equipped={game.player.equipped}/>
          <p className="mt-1.5 text-[10px] text-amber-100/75">
            {en?'This fight uses the server-verified stats fixed at its start. Gear shown here reflects your current save.':'В этом бою действуют подтверждённые сервером характеристики на момент входа. Здесь показана текущая экипировка.'}
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
            {en?'View only: cave elixir effects are not enabled on the combat server. The belt is not consumed or charged here.':'Только просмотр: эффекты эликсиров ещё не подключены к серверным боям пещеры. Здесь они не расходуются и не списываются.'}
          </p>
        </FoldSection>
      </div>
      {finished ? <>
        <p className="text-center text-amber-200 font-bold" role="status">{session.state.status==='hero_won' ? (en?'Victory!':'Победа!') : session.state.status==='enemy_won' ? (en?'Defeat':'Поражение') : (en?'Draw':'Ничья')}</p>
        {session.state.status==='hero_won' && session.settlement?.reward && <p className="text-center text-xs text-yellow-100">
          +{session.settlement.reward.gold} {en?'gold':'монет'} · +{session.settlement.reward.xp} XP
        </p>}
        {session.state.status === 'hero_won' && progress && progress.unlocked_stage > session.state.input.stage && (
          <p className="rounded-lg border border-emerald-400/40 bg-emerald-950/40 px-3 py-2 text-center text-sm font-bold text-emerald-200" data-testid="dark-cave-next-floor">
            {en ? 'Next floor unlocked: ' : 'Открыт следующий этаж: '}{progress.unlocked_stage}
          </p>
        )}
        {session.state.status !== 'hero_won' && <p className="text-center text-xs text-amber-100/80">
          {en ? 'Try this floor again when you are ready.' : 'Попробуй пройти этот этаж ещё раз, когда будешь готов.'}
        </p>}
        <button onClick={clearFinished} disabled={busy} className="w-full rounded-xl bg-amber-500 text-black p-3 font-bold">{en?'Back to cave stages':'К этапам пещеры'}</button>
      </> : <>
        {session.state.input.control==='manual' && <div className="space-y-1.5" data-testid="dark-cave-manual-actions">
          {session.state.actors.hero.loadout.skills.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {session.state.actors.hero.loadout.skills.map(slot=>{
                const def = session.state.input.catalog.skills.find(item => item.id === slot.skillId);
                const rank = def?.levels[slot.level - 1];
                const onCooldown = (session.state.actors.hero.cooldowns[slot.skillId] ?? 0) > session.state.atMs;
                const enoughEnergy = !!rank && session.state.actors.hero.energy >= rank.energyCost;
                return <button key={slot.skillId} type="button"
                  disabled={busy || recoverable || !rank || onCooldown || !enoughEnergy}
                  onClick={()=>void advance(slot.skillId)}
                  className="min-h-11 rounded-lg border border-amber-500/50 bg-gradient-to-b from-[#5b381d] to-[#28170c] p-1.5 text-xs font-bold text-amber-100 disabled:opacity-45"
                  aria-label={slot.skillId.replace(/_/g,' ')}>
                  <Swords size={15} className="mx-auto text-yellow-200"/>
                  <span className="block truncate">{slot.skillId.replace(/_/g,' ')}</span>
                  <span className="block text-[10px] text-amber-200/90">{onCooldown ? (en?'Cooldown':'Откат') : rank ? `${rank.energyCost} ⚡` : (en?'Unavailable':'Недоступно')}</span>
                </button>;
              })}
            </div>
          ) : <p className="rounded-lg border border-amber-500/20 bg-amber-950/25 px-2 py-1.5 text-[11px] text-amber-100/80">
            {en?'No skills equipped. Your hero fights with basic attacks; continue to see the next result.':'Боевые умения не установлены. Герой сражается обычными ударами — продолжай бой.'}
          </p>}
          <button type="button" disabled={busy || recoverable} onClick={()=>void advance()}
            className="min-h-11 w-full rounded-xl border border-yellow-300/60 bg-gradient-to-b from-amber-400 to-amber-600 px-3 py-2 text-sm font-black text-[#2c170b] disabled:opacity-50">
            <Swords size={18} aria-hidden="true" className="inline-block mr-2 align-[-3px]"/>{en?'Continue battle':'Продолжить бой'}
          </button>
        </div>}
        <p className="text-center text-xs text-amber-100/70">{session.state.input.control==='auto'
          ? (en?'The hero fights automatically':'Герой сражается автоматически')
          : (en?'Each tap advances the ongoing battle':'Каждое нажатие продолжает текущий бой')}</p>
      </>}
    </div> : progress ? <>
      <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-[#624478] bg-[#090b1b] p-2 shadow-[inset_0_0_42px_rgba(66,21,94,.45),0_8px_24px_rgba(0,0,0,.48)]" data-testid="dark-cave-realm">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_4%,rgba(129,56,205,.19),transparent_62%)]" />
        <div className="relative shrink-0 text-center">
          <div className="mx-auto mb-0.5 flex max-w-[88%] items-center gap-2 text-[#a46bcd]">
            <span className="h-px grow bg-gradient-to-r from-transparent to-[#77479a]"/>
            <span className="h-2 w-2 rotate-45 border border-[#a97bda] bg-[#3d205a]"/>
            <span className="h-px grow bg-gradient-to-l from-transparent to-[#77479a]"/>
          </div>
          <h3 className="text-[clamp(17px,4.8vw,22px)] font-black leading-tight tracking-tight text-[#f2d9ff] drop-shadow-[0_2px_5px_#060413]">
            {en?'Realm of Dark Energy':'Царство тёмной энергии'}
          </h3>
        </div>
        <div className="relative z-10 mt-1 flex shrink-0 items-center justify-between gap-2">
          <button type="button" onClick={()=>setStoneInfo(v=>!v)} aria-expanded={stoneInfo} data-testid="dark-stone-balance"
            className="flex min-h-9 items-center gap-1.5 rounded-xl border border-[#9860cb]/60 bg-[#0b0818]/95 py-1 pl-1.5 pr-3 font-black text-[17px] tabular-nums text-white shadow-[0_2px_12px_rgba(134,50,204,.25)]">
            <img src={darkStoneArt} alt={en?'Dark Stone':'Тёмный камень'} className="h-7 w-7 rounded-md object-cover"/>
            {progress.dark_stones}
            <Info size={13} className="ml-0.5 text-[#ceacfa]"/>
          </button>
          <span className="rounded-full border border-[#8a628f]/50 bg-[#0a0818]/90 px-3 py-1.5 text-[11px] font-bold text-[#eed6f7]">
            {en?'Floor':'Этаж'} {currentStage} / 100
          </span>
        </div>
        {stoneInfo&&<div className="relative z-20 mt-1 rounded-lg border border-violet-500/50 bg-[#160e28] px-2.5 py-1.5 text-[11px] text-violet-100">
          {en?'Entry costs 1 Dark Stone; +3 daily at 00:00 UTC, starting grant 5.':'Вход — 1 Тёмный камень. При первом посещении — 5, далее +3 ежедневно в 00:00 UTC.'}
        </div>}
        <div className="relative mt-1.5 h-[clamp(76px,13dvh,120px)] shrink-0 overflow-hidden rounded-xl border border-[#6e4389]/70 bg-[#090615] shadow-[inset_0_0_28px_#090415,0_0_13px_rgba(107,41,155,.3)]" data-testid="dark-cave-visual">
          <img src={realmArt} alt={en?'Violet abyss beneath the mountains':'Фиолетовая бездна в глубине подземелья'} draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-center" data-testid="dark-cave-portal"/>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#070511]/90 via-transparent to-[#070511]/10"/>
          <div className="absolute bottom-1.5 left-2.5 right-2.5 flex items-end justify-between gap-2 text-[11px] font-bold text-[#e9caff]">
            <span className="rounded-md bg-[#0b091b]/65 px-2 py-0.5">{en?'Depth':'Глубина'} {highlightedFloor.chapter} / 5</span>
            <span className="text-[#c99eec]">{en?'The abyss awaits':'Бездна ждёт'}</span>
          </div>
        </div>
        <div className="relative mt-1.5 flex shrink-0 items-center justify-between gap-2 px-1 py-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rotate-45 bg-[#ad65ed] shadow-[0_0_6px_#a25cfa]"/>
            <h4 className="truncate text-[12px] font-black uppercase tracking-[.10em] text-[#edcfef]">{en?'Cave floors':'Этажи подземелья'}</h4>
          </div>
          <button onClick={jumpToCurrent} type="button" className="shrink-0 rounded-md border border-[#8056a7]/60 bg-[#28183e] px-2.5 py-1 text-[11px] font-bold text-[#f5d7ff]">{en?'My floor':'Мой этаж'}</button>
        </div>
        <div className="relative min-h-[168px] flex-1 overflow-hidden rounded-xl border border-[#51416c]/80 bg-[#080a17]/90 p-1.5 shadow-[inset_0_4px_18px_#050711]" data-testid="dark-cave-floor-list">
          <div ref={floorListRef} data-testid="dark-cave-floor-scroll" role="region" aria-label={en?'Scrollable cave floors':'Прокручиваемый список этажей'}
            tabIndex={0} className="dark-cave-floor-scroll relative h-full min-h-0 space-y-1 overflow-y-auto overscroll-contain pr-1 touch-pan-y">
            {floors.map(floor=>{
              const cleared = floor.index <= progress.completed_stage;
              const current = floor.index === progress.unlocked_stage && progress.completed_stage < 100;
              const locked = floor.index > progress.unlocked_stage || progress.completed_stage === 100 && !cleared;
              const highlighted = floor.index === floorFocus;
              const rowClass = 'relative flex min-h-[49px] w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ' +
                (current ? 'border-[#bf7df0] bg-gradient-to-r from-[#422052] via-[#271833] to-[#1a112b] text-[#fff1fc] shadow-[inset_0_0_12px_rgba(163,89,231,.14),0_0_10px_rgba(147,70,211,.2)]' :
                  locked ? 'border-[#322c46] bg-[#141426] text-[#86829d]' :
                    highlighted ? 'border-[#8063a2] bg-[#28223f] text-[#eaddfb]' :
                      'border-[#514263] bg-[#1b1b31] text-[#d4c6e5]');
              return <div key={floor.index}>
                {floor.index % 20 === 1 && <p className="px-2 pt-0.5 text-[9px] font-extrabold uppercase tracking-[.14em] text-[#9e8db7]">
                  {en?'Depth':'Глубина'} {floor.chapter}
                </p>}
                {locked?<div aria-label={(en?'Floor ':'Этаж ')+floor.index+(en?' locked':' закрыт')} className={rowClass}>
                  <Lock size={16} className="shrink-0 text-[#706987]"/>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-black">{en?'Floor':'Этаж'} {floor.index}</p>
                    <p className="truncate text-[10px] text-[#827e9a]">{en?'Not unlocked':'Ещё не открыт'}</p>
                  </div>
                  {floor.kind==='boss'&&<Crown size={17} className="shrink-0 text-[#83648c]"/>}
                </div>:<button type="button" aria-pressed={highlighted} data-current-floor={current?'true':undefined}
                  data-testid={current?'dark-cave-current-floor':undefined} onClick={()=>setSelectedFloor(floor.index)}
                  className={rowClass}>
                  {floor.kind==='boss'?<Crown size={17} className="shrink-0 text-[#e2a9f4]"/>:
                    cleared?<Check size={17} className="shrink-0 text-[#8ad1a4]"/>:
                      <Swords size={17} className="shrink-0 text-[#d7a2f9]"/>}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-black">{en?'Floor':'Этаж'} {floor.index}</p>
                    <p className="truncate text-[10px] text-[#b5a4c5]">{cleared?(en?'Cleared':'Пройден'):floor.kind==='boss'?(en?'Boss battle':'Битва с боссом'):(en?'Ready for challenge':'Можно бросить вызов')}</p>
                  </div>
                  {current&&<span className="rounded border border-[#ae7ad4]/50 px-1.5 py-0.5 text-[9px] font-black text-[#eec9ff]">{en?'NOW':'СЕЙЧАС'}</span>}
                  <ChevronRight size={16} className="shrink-0 text-[#b58acd]"/>
                </button>}
              </div>;
            })}
          </div>
        </div>
        <div className="relative z-10 mt-1.5 shrink-0 border-t border-[#68457d]/55 pt-2" data-testid="dark-cave-actions">
          {progress.completed_stage < 100 ? <>
            <div className="grid grid-cols-2 gap-2" data-testid="dark-cave-start-modes">
              {(['auto','manual'] as const).map(control => <button key={control} type="button"
                disabled={!ready||busy||recoverable||!mayChallenge||progress.dark_stones<1}
                onClick={()=>void start(control)}
                data-testid={control==='auto'?'dark-cave-challenge':'dark-cave-challenge-manual'}
                aria-label={control==='auto'?(en?'Auto challenge, 1 Dark Stone':'Авто вызов, 1 Тёмный камень'):(en?'Manual challenge, 1 Dark Stone':'Ручной вызов, 1 Тёмный камень')}
                className="flex min-h-[46px] w-full items-center justify-center gap-1 rounded-xl border border-[#dfb56c] bg-gradient-to-b from-[#f7d484] via-[#daa94f] to-[#9d672e] px-2 text-[14px] font-black text-[#2b180f] shadow-[inset_0_1px_1px_#fff0b0,0_3px_0_#392517] active:scale-[.99] disabled:cursor-not-allowed disabled:grayscale-[.35] disabled:opacity-55">
                <img src={darkStoneArt} alt="" className="h-5 w-5 shrink-0 rounded object-cover"/>
                {control==='auto'?(en?'Auto':'Авто'):(en?'Manual':'Ручной')}
                <span className="rounded bg-[#4d341e]/15 px-1 text-[13px]">1</span>
              </button>)}
            </div>
            {!mayChallenge?<p className="mt-1 text-center text-[11px] text-[#c7b6d8]">
              {en?'Return to your current floor to continue.':'Выбери текущий этаж, чтобы продолжить.'}
            </p>:progress.dark_stones<1?<p className="mt-1 text-center text-[11px] text-[#c9b3e8]">
              {en?'Dark Stones exhausted · +3 at 00:00 UTC':'Тёмные камни закончились · +3 в 00:00 UTC'}
            </p>:<p className="mt-1 text-center text-[11px] text-[#bdacca]">
              {en?'Entry costs 1 Dark Stone':'Вход — 1 Тёмный камень'}
            </p>}
          </>:<p className="text-center text-sm font-black text-[#e7c1f8]">{en?'All 100 cave floors cleared!':'Все 100 этажей подземелья пройдены!'}</p>}
        </div>
      </div>
    </> : <p role="status" className="rounded-xl border border-amber-700/30 bg-black/25 p-3 text-xs text-amber-100">
      {en ? 'Loading verified cave progress…' : 'Загружаем подтверждённый прогресс пещеры…'}
    </p>}
  </section>;
}
