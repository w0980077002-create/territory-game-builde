import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Crown, Loader2, Lock, Swords, Zap } from 'lucide-react';
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

type Progress = { completed_stage: number; unlocked_stage: number };
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
    || Number(data.unlocked_stage) !== Math.min(100, Number(data.completed_stage) + 1))
    throw new Error('adventure_invalid_progress');
  return data as Progress;
}
function message(error: unknown, en: boolean) {
  const s = error instanceof Error ? error.message : String(error);
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
  const [chapter, setChapter] = useState(1);
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
      setChapter(Math.min(5, Math.floor((found.unlocked_stage - 1) / 20) + 1));
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

  return <section className="space-y-3 pb-4" data-testid="territory-adventure-v1">
    <h2 className="text-lg font-black text-amber-200">{en ? 'Dark Cave' : 'Тёмная пещера'} <span className="text-xs text-amber-100/70">1–100</span></h2>
    {error && <p role="alert" className="rounded-xl border border-red-400/40 bg-red-950/50 p-3 text-xs text-red-100">{error}</p>}
    {recoverable && <button disabled={busy} onClick={()=>void restore()} className="w-full rounded-xl border border-amber-500/60 bg-amber-900/30 p-3 font-semibold text-amber-100">
      {en ? 'Recover server session' : 'Восстановить серверный бой'}
    </button>}
    {busy && <p role="status" className="text-center text-amber-100 text-xs"><Loader2 className="w-4 h-4 animate-spin inline mr-2"/>{en?'Synchronizing':'Синхронизация'}</p>}
    {session ? <div ref={battleRef} data-testid="territory-adventure-battle" className="rounded-2xl border border-amber-600/50 bg-gradient-to-b from-amber-950/70 to-slate-950 p-2 space-y-3 scroll-mt-3">
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
      <div className="grid grid-cols-5 gap-1">
        {CAMPAIGN_CHAPTERS.map((name,i)=><button key={name} disabled={busy} onClick={()=>setChapter(i+1)}
          className={'rounded-lg border px-1 py-2 text-xs '+(chapter===i+1?'bg-amber-500 text-black border-yellow-200':'bg-black/40 text-amber-100 border-amber-700/40')}>
          {i+1}
        </button>)}
      </div>
      <div className="rounded-2xl border border-amber-700/40 bg-black/30 p-3">
        <p className="text-sm font-bold text-amber-200">{CAMPAIGN_CHAPTERS[chapter-1]}</p>
        <p className="text-xs text-gray-300">{en?'Unlocked stage':'Открыт этап'}: {currentStage}</p>
        <div className="grid grid-cols-5 gap-1.5 mt-3">
          {Array.from({length:20},(_,i)=>getCampaignStage((chapter-1)*20+i+1)).map(s=>{
            const done = !!progress && s.index <= progress.completed_stage;
            const now = !!progress && s.index === progress.unlocked_stage;
            return <div key={s.index} className={'rounded-lg border p-1.5 text-center '+(now?'border-amber-300 bg-amber-600/30':'border-white/10 bg-black/25')}>
              <div className="flex justify-center">{s.kind==='boss'?<Crown className="w-3.5 h-3.5 text-amber-400"/>:done?<Check className="w-3.5 h-3.5 text-green-400"/>:!now?<Lock className="w-3 h-3 text-gray-500"/>:<Swords className="w-3.5 h-3.5 text-amber-400"/>}</div>
              <span className="text-xs text-white">{s.stageInChapter}</span>
            </div>;
          })}
        </div>
      </div>
      {ready && progress && progress.completed_stage < 100 && chapter===chosen.chapter && <div className="rounded-xl border border-amber-500/40 bg-amber-950/50 p-3 space-y-2">
        <p className="font-bold text-amber-100">{chosen.enemyName} · {en?'Stage':'Этап'} {currentStage}</p>
        <div className="grid grid-cols-2 gap-2">
          <button disabled={busy || recoverable} onClick={()=>void start('manual')} className="rounded-xl bg-amber-600 text-black font-bold p-3">{en?'Manual battle':'Ручной бой'}</button>
          <button disabled={busy || recoverable} onClick={()=>void start('auto')} className="rounded-xl bg-yellow-400 text-black font-bold p-3">{en?'Auto battle':'Автобой'}</button>
        </div>
      </div>}
    </> : <p role="status" className="rounded-xl border border-amber-700/30 bg-black/25 p-3 text-xs text-amber-100">
      {en ? 'Loading verified cave progress…' : 'Загружаем подтверждённый прогресс пещеры…'}
    </p>}
  </section>;
}
