import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Crown, Info, Loader2, Lock, Swords, Zap } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { useGame } from '@/game/actions';
import { ensurePlayerSession } from '@/game/auth';
import { supabase } from '@/game/supabase';
import { restoreAdventureSaveFence, restoreAdventureStartFence, requestAdventureStart, requestAdventureSettlement } from '@/game/combatV1/receiptAdapter';
import { getCampaignStage, CAMPAIGN_CHAPTERS } from '@/game/idleContent/campaign';
import type { IdleCombatState, IdleCombatEvent } from '@/game/idleEngine/types';
import { getCombatAppearance } from '@/game/appearance';
import { getEnemyCombatFrames } from '@/game/combatArt';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { FighterFigure } from '@/components/arena/FighterFigure';

type Progress = { completed_stage: number; unlocked_stage: number; dark_stones: number };
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
    || !Number.isSafeInteger(data.dark_stones) || Number(data.dark_stones) < 0)
    throw new Error('adventure_invalid_progress');
  return data as Progress;
}
function message(error: unknown, en: boolean) {
  const s = error instanceof Error ? error.message : String(error);
  if (/dark_stone/.test(s)) return en ? 'No Dark Stones; next grant at 00:00 UTC.' : 'Тёмные камни закончились. Новые будут в 00:00 UTC.';
  if (/reconciliation|profile|ownership/.test(s)) return en
    ? 'Hero equipment must be verified before using the new campaign.'
    : 'Для новой кампании требуется сверка характеристик героя и экипировки.';
  if (/adventure_reload_required|adventure_save_blocked/.test(s)) return en
    ? 'A newer save exists. Reopen Telegram to synchronize safely.'
    : 'Есть более новое сохранение. Перезапусти Telegram для синхронизации.';
  if (/settlement|not_enabled|not_configured|unavailable|not_ready/.test(s)) return en
    ? 'Server campaign is not yet enabled. Your old campaign is unchanged.'
    : 'Серверная кампания пока не включена. Старая игра не изменена.';
  return en ? 'Cannot confirm the result. Use recovery; no duplicate reward will be sent.'
    : 'Не удалось подтвердить результат. Используй восстановление — награда не задвоится.';
}

/** Separate V1 server campaign: NEVER computes a win, cost, loot or stats in the browser. */
export function ServerAdventureScreen({ userId, onActiveChange }: Props) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [progress, setProgress] = useState<Progress | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null);
  const [control, setControl] = useState<'manual' | 'auto'>('manual');
  const [stoneInfo, setStoneInfo] = useState(false);
  const [blessingInfo, setBlessingInfo] = useState(false);
  const floorListRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  const mounted = useRef(true);
  const lock = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const battleRef = useRef<HTMLDivElement | null>(null);
  const strikeId = useRef(0);
  const [strike, setStrike] = useState<StrikeEvent | null>(null);
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const hooks = { getState: () => useGame.get(), applyState: (state: ReturnType<typeof useGame.get>) => useGame.set(state) };

  const install = useCallback((value: Session) => {
    if (!mounted.current) return;
    sessionRef.current = value;
    setSession(value);
    // Visual effects follow the authoritative server event stream, never invented client hits.
    const events = Array.isArray(value.events) ? value.events : [];
    const lastHit = [...events].reverse().find(event =>
      ['impact', 'critical', 'block', 'dodge'].includes(event.type)
      && (event.target === 'hero' || event.target === 'enemy'));
    if (lastHit) {
      const opponent = getCampaignStage(value.state.input.stage).enemyName;
      const hero = useGame.get().player.name;
      setStrike({ key: ++strikeId.current,
        attacker: lastHit.actor === 'hero' ? hero : opponent,
        target: lastHit.target === 'hero' ? hero : opponent,
        tone: lastHit.type === 'critical' ? 'crit' :
          lastHit.type === 'block' ? 'block' : lastHit.type === 'dodge' ? 'dodge' : 'hit',
        amount: typeof lastHit.value === 'number' ? Math.floor(lastHit.value) : null });
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

  useEffect(() => {
    if (!strike) return;
    const timer = window.setTimeout(() => setStrike(null), 820);
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
      await readProgress();
      const pending = restoreAdventureSaveFence(userId);
      if (pending) {
        const result = decodeSession(await requestAdventureSettlement(userId, pending, hooks));
        install(result);
        install(decodeSession(await requestAdventureSettlement(
          userId, { action: 'resume', sessionId: result.session_id }, hooks)));
      } else if (await runSavedStart()) { /* original UUID and live session recovered */ }
      else {
        const id = localStorage.getItem(sessionKey(userId));
        if (id) install(decodeSession(await requestAdventureSettlement(userId, { action: 'resume', sessionId: id }, hooks)));
      }
      const prepared = await supabase.functions.invoke('territory-combat', { body: { action: 'prepare' } });
      if (prepared.error || !obj(prepared.data)) throw new Error('combat_unavailable');
      if (prepared.data.status !== 'ready') throw new Error('combat_profile_not_verified');
      if (mounted.current) setReady(true);
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
    if (!session || session.state.status !== 'fighting' || session.state.input.control !== 'auto'
      || busy || recoverable || document.visibilityState !== 'visible') return;
    const timer = window.setTimeout(() => { void advance(); }, 1100);
    return () => window.clearTimeout(timer);
  }, [session, busy, recoverable, advance]);

  const clearFinished = () => {
    if (lock.current || sessionRef.current?.state.status === 'fighting') return;
    localStorage.removeItem(sessionKey(userId));
    sessionRef.current = null; setSession(null); setStrike(null); setBattleLog([]); onActiveChange?.(false);
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
  const fighterSrc = import.meta.env.BASE_URL + 'assets/territory/characters/heroes/male_viking/idle.webp';
  const enemySrc = import.meta.env.BASE_URL + 'assets/territory/characters/' + battleStage.enemyArt + '/idle.webp';
  const darkStoneArt = import.meta.env.BASE_URL + 'assets/territory/items/dark-stone.svg';
  const portalArt = import.meta.env.BASE_URL + 'assets/territory/scenes/dark-cave-portal.svg';
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

  return <section className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden" data-testid="territory-adventure-v1">
    <h2 className="sr-only">{en ? 'Dark Cave' : 'Тёмная пещера'}</h2>
    {error && <p role="alert" className="rounded-xl border border-red-400/40 bg-red-950/50 p-3 text-xs text-red-100">{error}</p>}
    {recoverable && <button disabled={busy} onClick={()=>void restore()} className="w-full rounded-xl border border-amber-500/60 bg-amber-900/30 p-3 font-semibold text-amber-100">
      {en ? 'Recover server session' : 'Восстановить серверный бой'}
    </button>}
    {busy && <p role="status" className="text-center text-amber-100 text-xs"><Loader2 className="w-4 h-4 animate-spin inline mr-2"/>{en?'Synchronizing':'Синхронизация'}</p>}
    {session ? <div ref={battleRef} data-testid="territory-adventure-battle" className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-2xl border border-amber-600/50 bg-gradient-to-b from-amber-950/70 to-slate-950 p-2 space-y-3 scroll-mt-3">
      <p className="text-center text-xs text-amber-200 font-bold">{en?'Server battle':'Серверный бой'} · {en?'Stage':'Этап'} {session.state.input.stage} · {enemyName}</p>
      <div className="relative min-h-[340px] overflow-hidden rounded-xl border border-amber-400/25 bg-slate-900">
        <img src={import.meta.env.BASE_URL + 'assets/territory/scenes/arena-viking.webp'} alt="" className="absolute inset-0 h-full w-full object-cover object-center" />
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
                ? <FighterFigure src={fighterSrc} combatFrames={getCombatAppearance(useGame.get().appearance)}
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
      {!!battleLog.length && <div className="rounded-lg bg-black/35 border border-white/10 px-2 py-1 text-[11px] text-slate-200 max-h-24 overflow-auto" aria-live="polite">
        {battleLog.slice(-4).map((line, i) => <p key={i}>{line}</p>)}
      </div>}
      {finished ? <>
        <p className="text-center text-amber-200 font-bold">{session.state.status==='hero_won'?(en?'Victory!':'Победа!'):(en?'Battle finished':'Бой завершён')}</p>
        {session.settlement?.reward && <p className="text-center text-xs text-yellow-100">
          +{session.settlement.reward.gold} {en?'gold':'монет'} · +{session.settlement.reward.xp} XP
        </p>}
        <button onClick={clearFinished} disabled={busy} className="w-full rounded-xl bg-amber-500 text-black p-3 font-bold">{en?'Back to cave stages':'К этапам пещеры'}</button>
      </> : <>
        {session.state.input.control==='manual' && <div className="grid grid-cols-2 gap-2">
          {session.state.actors.hero.loadout.skills.map(skill=><button key={skill.skillId} disabled={busy || recoverable} onClick={()=>void advance(skill.skillId)} className="rounded-lg border border-amber-500/40 bg-amber-900/30 p-2 text-xs text-amber-100">{skill.skillId}</button>)}
          <button disabled={busy || recoverable} onClick={()=>void advance()} className="rounded-lg border border-amber-500/40 p-2 text-xs text-amber-100">{en?'Continue':'Продолжить'}</button>
        </div>}
        <p className="text-center text-xs text-amber-100/70">{session.state.input.control==='auto'
          ? (en?'Auto battle · server confirms every step':'Автобой · каждый шаг подтверждает сервер')
          : (en?'Skills and damage are verified by the server':'Умения и урон проверяет сервер')}</p>
      </>}
    </div> : progress ? <>
      <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-[#54446f] bg-[#101830] px-2 pb-2 pt-2 shadow-[inset_0_0_50px_rgba(51,25,101,.42),0_10px_30px_rgba(0,0,0,.32)]" data-testid="dark-cave-realm">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_45%_25%,rgba(109,42,164,.20),transparent_65%)]"/>
        <div className="relative shrink-0 text-center">
          <div className="mx-auto mb-0.5 flex max-w-[90%] items-center gap-2 text-[#f6b755]">
            <span className="h-px grow bg-gradient-to-r from-transparent to-[#f4a945]"/>
            <span className="h-2 w-2 rotate-45 border border-[#ffc567] bg-[#7639ae]"/>
            <span className="h-px grow bg-gradient-to-l from-transparent to-[#f4a945]"/>
          </div>
          <h3 className="text-[clamp(17px,4.8vw,21px)] font-black leading-tight tracking-tight text-[#ffe4a2] drop-shadow-[0_2px_3px_#070b1e]">
            {en?'Realm of Dark Energy':'Царство Тёмной энергии'}
          </h3>
          <div className="mx-auto mt-1 h-px w-[82%] bg-gradient-to-r from-transparent via-[#f8b343] to-transparent"/>
        </div>
        <div className="relative z-10 mt-0.5 flex shrink-0 items-center justify-between">
          <button type="button" onClick={()=>setStoneInfo(v=>!v)} aria-expanded={stoneInfo} data-testid="dark-stone-balance"
            className="flex min-h-8 items-center gap-1 rounded-xl border border-[#9a5ce0]/70 bg-[#0c0c21]/90 py-0.5 pl-1 pr-3 font-black text-lg tabular-nums text-white shadow-[0_2px_16px_rgba(140,66,244,.22)]">
            <img src={darkStoneArt} alt={en?'Dark Stone':'Тёмный камень'} className="h-7 w-7 rounded-md object-cover"/>
            {progress.dark_stones}
            <Info size={14} className="ml-1 text-amber-300"/>
          </button>
          <span className="rounded-full border border-amber-500/40 bg-[#0a1024]/80 px-3 py-1 text-[11px] font-bold text-amber-200">
            {en?'Floor':'Этаж'} {currentStage} / 100
          </span>
        </div>
        {stoneInfo&&<div className="relative z-20 mt-2 rounded-lg border border-violet-500/50 bg-[#16102c] px-3 py-2 text-xs text-violet-100">
          {en?'Entrance costs 1 Dark Stone. First entry: 5 stones; daily +3 at 00:00 UTC.':'Вход стоит 1 Тёмный камень. Первые 5 камней выдаются при первом посещении; далее +3 ежедневно в 00:00 UTC.'}
        </div>}
        <img src={portalArt} alt={en?'Glowing cave portal':'Светящийся портал Тёмной пещеры'}
          className="pointer-events-none relative -mt-1 h-[clamp(92px,18dvh,152px)] w-full shrink-0 select-none object-cover object-center" data-testid="dark-cave-portal" draggable={false}/>
        <div className="relative mx-auto -mt-1 flex w-full shrink-0 items-center justify-between gap-2 px-1 pb-1 text-xs font-bold text-amber-100">
          <span className="truncate">{en?'Chapter':'Глава'} {highlightedFloor.chapter} · {CAMPAIGN_CHAPTERS[highlightedFloor.chapter-1]}</span>
          <button onClick={jumpToCurrent} type="button"
            className="shrink-0 rounded-md border border-amber-400/50 bg-amber-900/40 px-2 py-1 text-[11px] text-[#ffe5a4]">
            {en?'My floor':'Мой этаж'}
          </button>
        </div>
        <div className="relative min-h-[72px] flex-1 overflow-hidden rounded-xl border border-[#5d5077]/70 bg-[#080c20]/75 p-1 shadow-[inset_0_3px_18px_#060719]" data-testid="dark-cave-floor-list">
          <div ref={floorListRef} data-testid="dark-cave-floor-scroll" role="region" aria-label={en?'Scrollable cave floors':'Прокручиваемый список этажей'}
            tabIndex={0} className="dark-cave-floor-scroll relative h-full min-h-0 space-y-1 overflow-y-auto overscroll-contain pr-2 touch-pan-y">
            {floors.map((floor)=>{
              const cleared=floor.index<=progress.completed_stage;
              const current=floor.index===progress.unlocked_stage && progress.completed_stage<100;
              const locked=floor.index>progress.unlocked_stage || progress.completed_stage===100 && !cleared;
              const highlighted=floor.index===floorFocus;
              const rowClass='relative flex min-h-[42px] w-full items-center gap-2 overflow-hidden rounded-[9px] border-2 px-2.5 text-left text-sm font-black transition-colors '+
                (highlighted && current ? 'border-[#ffe28c] bg-[#713f16] text-[#fff0b7] shadow-[inset_0_0_14px_rgba(255,187,62,.16),0_0_11px_rgba(255,175,52,.48)]':
                locked?'border-[#48435b] bg-[#141b37] text-[#9798b1]':
                highlighted?'border-[#c6a460] bg-[#474062] text-[#fff0be]':
                'border-[#6a5c72] bg-[#232b47] text-[#f4e0b8]');
              return <div key={floor.index}>
                {floor.index%20===1&&<div className="px-2 pb-0.5 pt-1 text-center text-[10px] font-bold tracking-[.11em] text-[#b7a6ce]">
                  {en?'CHAPTER':'ГЛАВА'} {floor.chapter} · {CAMPAIGN_CHAPTERS[floor.chapter-1]}
                </div>}
                {locked?<div aria-label={(en?'Floor ':'Этаж ')+floor.index+(en?' locked':' закрыт')} className={rowClass}>
                  <Lock size={17} className="shrink-0 text-[#9a98a8]"/>
                  <span>{en?'Floor':'Этаж'} {floor.index}</span>
                  {floor.kind==='boss'&&<Crown size={15} className="ml-auto text-[#ab90b8]"/>}
                </div>:<button type="button" aria-pressed={highlighted} data-current-floor={current?'true':undefined}
                  data-testid={current?'dark-cave-current-floor':undefined}
                  onClick={()=>setSelectedFloor(floor.index)} className={rowClass}>
                  {floor.kind==='boss'?<Crown size={18} className="shrink-0 text-amber-300"/>:<Swords size={16} className="shrink-0 text-[#e2b46e]"/>}
                  <span>{en?'Floor':'Этаж'} {floor.index}</span>
                  {cleared?<Check size={21} className="ml-auto shrink-0 text-[#58e66b]"/>:
                    <ChevronRight size={21} className="ml-auto shrink-0 text-amber-200"/>}
                </button>}
              </div>;
            })}
          </div>
        </div>
        <div className="relative z-10 mt-1 shrink-0 space-y-1.5 border-t border-amber-500/30 bg-[#101830] pt-1" data-testid="dark-cave-actions">
          <div className="flex items-center justify-center gap-2 text-center text-[13px] font-black text-[#ffe4ac]">
            <span className="h-px grow bg-gradient-to-r from-transparent to-[#a96b3c]"/>
            {en?'Add a blessing':'Добавить благословение'}
            <span className="h-px grow bg-gradient-to-l from-transparent to-[#a96b3c]"/>
          </div>
          <div className="mx-auto grid max-w-[240px] grid-cols-3 gap-2">
            {[1,2,3].map(slot=><button type="button" key={slot} onClick={()=>setBlessingInfo(v=>!v)}
              aria-label={en?'Blessing slot '+slot:'Благословение '+slot}
              className="flex h-11 items-center justify-center rounded-lg border-2 border-[#7788b0]/80 bg-[#233251]/90 text-[26px] font-light text-[#ffdd97] shadow-[inset_0_2px_12px_#15203d,0_4px_0_#090d20] active:scale-[.98]">+</button>)}
          </div>
          {blessingInfo&&<p role="status" className="rounded-lg border border-[#725a92] bg-[#17162e] px-2 py-2 text-center text-[11px] text-[#e4d6f5]">
            {en?'Blessings are not enabled yet and do not affect battles.':'Благословения ещё не подключены и пока не влияют на бой.'}
          </p>}
          <div className="flex items-center justify-center gap-2 text-[11px] text-amber-100">
            <span>{en?'Battle mode':'Режим боя'}:</span>
            {(['manual','auto'] as const).map(mode=><button type="button" key={mode} disabled={busy}
              aria-pressed={control===mode} onClick={()=>setControl(mode)}
              className={'rounded-md border px-2 py-1 font-bold '+(control===mode?'border-amber-300 bg-amber-500 text-[#2d1b12]':'border-amber-500/30 bg-[#12162c] text-amber-100')}>
              {mode==='manual'?(en?'Manual':'Ручной'):(en?'Auto':'Авто')}
            </button>)}
          </div>
          {progress.completed_stage<100 ? <>
            <button type="button" disabled={!ready||busy||recoverable||!mayChallenge||progress.dark_stones<1}
              onClick={()=>void start(control)} data-testid="dark-cave-challenge"
              className="mx-auto flex min-h-[48px] w-full max-w-[300px] items-center justify-center gap-2 rounded-[15px] border-2 border-[#ffe6a1] bg-gradient-to-b from-[#fff19f] via-[#ffce44] to-[#e8941b] px-3 text-[17px] font-black text-[#4b270c] shadow-[inset_0_2px_3px_#fff9d0,0_5px_0_#694216,0_0_18px_rgba(255,192,73,.26)] transition-transform active:scale-[.98] disabled:opacity-50">
              <img src={darkStoneArt} alt="" className="h-7 w-7 shrink-0 rounded-md object-cover"/>
              <span className="tabular-nums">1</span> {en?'Challenge':'Вызов'}
            </button>
            {!mayChallenge&&<p className="text-center text-xs text-[#ddd1ef]">
              {en?'This floor is already completed. Select your current floor.':'Этот этаж уже пройден. Выбери свой текущий этаж.'}
            </p>}
            {progress.dark_stones<1&&<p className="text-center text-xs text-violet-100">{en?'Next Dark Stones: 00:00 UTC':'Новые Тёмные камни в 00:00 UTC'}</p>}
          </> : <p className="text-center text-sm font-black text-amber-200">{en?'All 100 cave floors completed!':'Все 100 этажей Тёмной пещеры пройдены!'}</p>}
        </div>
      </div>
    </> : <p role="status" className="rounded-xl border border-amber-700/30 bg-black/25 p-3 text-xs text-amber-100">
      {en ? 'Loading verified cave progress…' : 'Загружаем подтверждённый прогресс пещеры…'}
    </p>}
  </section>;
}
