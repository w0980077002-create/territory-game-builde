import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, RefreshCw, Skull, Sword, Trophy, Users } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { getCombatAppearance } from '@/game/appearance';
import { FighterFigure } from '@/components/arena/FighterFigure';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { getMortarionBossState, hitMortarionBoss, type MortarionState } from '@/game/mortarionBoss';
import { claimMortarionReward, getMortarionRewardStatus, type MortarionRewardStatus } from '@/game/mortarionRewards';
import './mortarionBoss.css';

const MORTARION_HP = 100_000_000;
const MORTARION_EVENT_DAYS = 5;
const MORTARION_HITS_PER_HOUR = 5;
const MORTARION_HIT_COOLDOWN_MS = 60_000;

function shortClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`
    : `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
}

function eventCountdown(ms: number, en: boolean) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return en ? `${d}d ${h}h ${m}m` : `${d}д ${h}ч ${m}м`;
}

function errorText(error: unknown, en: boolean) {
  const raw = error instanceof Error ? error.message : String(error);
  if (/mortarion_hourly_limit/.test(raw)) return en ? 'All five strikes used. Return after the hour resets.' : 'Пять ударов израсходованы. Дождись обновления лимита.';
  if (/mortarion_cooldown/.test(raw)) return en ? 'One minute must pass between strikes.' : 'Между ударами должна пройти минута.';
  if (/mortarion_event_closed/.test(raw)) return en ? 'This raid is not active.' : 'Рейд ещё не начался или уже завершился.';
  if (/mortarion_defeated/.test(raw)) return en ? 'Mortarion has been defeated!' : 'Мортарион повержен!';
  if (/auth_required|JWT|session/.test(raw)) return en ? 'Reopen the game in Telegram to verify your login.' : 'Открой игру заново через Telegram для подтверждения входа.';
  return en ? 'Could not contact the raid server. Your progress is safe.' : 'Нет связи с сервером рейда. Твой прогресс сохранён.';
}

/** Actual global raid; HP, per-player hit limits and leaderboard come only from RPC. */
export function MortarionBossScreen({ playerId }: { playerId: string }) {
  const { language } = useLanguage();
  const en = language === 'en';
  // Reuse the saved character selection and genuine game animation set.
  const game = useStore(useGame);
  const heroFrames = getCombatAppearance(game.appearance);
  const [strike, setStrike] = useState<StrikeEvent | null>(null);
  const leaderboardRef = useRef<HTMLElement | null>(null);
  const confirmedStrikeSerial = useRef(0);
  const contactTimeout = useRef<number | null>(null);
  const [state, setState] = useState<MortarionState | null>(null);
  const [rewardStatus, setRewardStatus] = useState<MortarionRewardStatus | null>(null);
  const [rewardBusy, setRewardBusy] = useState(false);
  const [rewardError, setRewardError] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const [skew, setSkew] = useState(0);
  const [loading, setLoading] = useState(true);
  const [attacking, setAttacking] = useState(false);
  const [message, setMessage] = useState('');
  const [impact, setImpact] = useState(false);
  const [lastDamage, setLastDamage] = useState(0);
  const [strikeId, setStrikeId] = useState(0);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const requestNumber = useRef(0);
  const effectTimeout = useRef<number | null>(null);

  const refreshRewards = useCallback(async () => {
    try {
      const value = await getMortarionRewardStatus();
      if (mounted.current) {
        setRewardStatus(value);
        setRewardError('');
      }
    } catch {
      if (mounted.current) setRewardError(en
        ? 'Reward progress is temporarily unavailable.' : 'Пока нет связи с учётом наград.');
    }
  }, [en]);

  const claimRewards = async () => {
    if (!rewardStatus?.canClaim || rewardBusy) return;
    setRewardBusy(true);
    setRewardError('');
    try {
      await claimMortarionReward(playerId);
      await refreshRewards();
    } catch {
      setRewardError(en
        ? 'Claim could not be confirmed. Your reward is protected. Reopen to sync.'
        : 'Не удалось подтвердить получение. Награда защищена. Перезайди для сверки.');
    } finally {
      if (mounted.current) setRewardBusy(false);
    }
  };

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const request = ++requestNumber.current;
    try {
      const next = await getMortarionBossState();
      if (!mounted.current || busyRef.current || request !== requestNumber.current) return;
      setSkew(Date.parse(next.serverNow) - Date.now());
      setState(next);
      setMessage('');
    } catch (error) {
      if (mounted.current && request === requestNumber.current && !busyRef.current) setMessage(errorText(error, en));
    } finally {
      if (mounted.current && request === requestNumber.current) setLoading(false);
    }
  }, [en]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    void refreshRewards();
    const time = window.setInterval(() => setClock(Date.now()), 300);
    const polling = window.setInterval(() => { void refresh(); }, 10000);
    const rewardPolling = window.setInterval(() => { void refreshRewards(); }, 15000);
    const resume = () => { setClock(Date.now()); void refresh(); void refreshRewards(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      mounted.current = false;
      requestNumber.current++;
      window.clearInterval(time);
      window.clearInterval(polling);
      window.clearInterval(rewardPolling);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      if (effectTimeout.current !== null) window.clearTimeout(effectTimeout.current);
      if (contactTimeout.current !== null) window.clearTimeout(contactTimeout.current);
    };
  }, [refresh, refreshRewards]);

  const attack = async () => {
    if (!state?.active || busyRef.current) return;
    const when = clock + skew;
    if (state.hitsInHour >= 5 || (state.nextHitAt && Date.parse(state.nextHitAt) > when)) return;
    busyRef.current = true;
    requestNumber.current++;
    setAttacking(true);
    setMessage('');
    try {
      const next = await hitMortarionBoss(playerId);
      if (!mounted.current) return;
      setSkew(Date.parse(next.serverNow) - Date.now());
      setState(next);
      setClock(Date.now());
      void refreshRewards();
      if (next.hitDamage && next.hitDamage > 0) {
        // The hero attack is purely visual and starts ONLY after a confirmed
        // server hit. Its contact frame lines up with the damage popup.
        const key = ++confirmedStrikeSerial.current;
        setLastDamage(next.hitDamage);
        setStrikeId(key);
        setImpact(false);
        setStrike({ key, attacker: game.player.name, target: 'Мортарион', tone: 'hit', amount: null });
        if (contactTimeout.current !== null) window.clearTimeout(contactTimeout.current);
        if (effectTimeout.current !== null) window.clearTimeout(effectTimeout.current);
        contactTimeout.current = window.setTimeout(() => {
          if (mounted.current) setImpact(true);
        }, 390);
        effectTimeout.current = window.setTimeout(() => {
          if (mounted.current) { setImpact(false); setStrike(null); }
        }, 1560);
      }
    } catch (error) {
      if (mounted.current) {
        setMessage(errorText(error,en));
        void getMortarionBossState().then(next => {
          if (mounted.current) { setState(next); setSkew(Date.parse(next.serverNow) - Date.now()); }
        }).catch(() => undefined);
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setAttacking(false);
    }
  };

  const format = (n: number) => Math.floor(n).toLocaleString(en ? 'en-US' : 'ru-RU');
  const serverNow = clock + skew;
  const health = state?.hp ?? MORTARION_HP;
  const hpPercent = state?.maxHp ? health / state.maxHp * 100 : 100;
  const defeated = Boolean(state?.enabled && health <= 0);
  const expired = Boolean(state?.enabled && serverNow >= Date.parse(state.endsAt));
  const nextHitMs = state?.nextHitAt ? Math.max(0, Date.parse(state.nextHitAt)-serverNow) : 0;
  const hitsLeft = Math.max(0, MORTARION_HITS_PER_HOUR - (state?.hitsInHour ?? 0));
  const canHit = Boolean(state?.active && !attacking && hitsLeft > 0 && nextHitMs === 0);
  const durationMs = state?.enabled ? Date.parse(state.endsAt) - serverNow : MORTARION_EVENT_DAYS * 86400000;

  return <div className="mortarion-raid mx-auto w-full max-w-[430px] space-y-3 pb-8 text-amber-50" data-testid="mortarion-boss-live">
    <section className="mortarion-raid__card relative overflow-hidden rounded-2xl border-2 border-amber-600/75 bg-gradient-to-b from-[#2f172a] via-[#241123] to-[#0d1018] p-3 text-center shadow-[0_8px_28px_#0009]">
      <div className="mortarion-raid__heading relative flex items-center justify-between gap-2">
        <p className="mortarion-raid__eyebrow font-black uppercase tracking-widest text-orange-300">☠ {en ? 'WORLD RAID' : 'МИРОВОЙ РЕЙД'}</p>
        <button type="button" className="mortarion-raid__rank-jump" onClick={() => leaderboardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} aria-label={en ? 'Go to Top 10 by damage' : 'Перейти к Топ-10 по урону'}>
          <Trophy size={14} aria-hidden="true"/>{en ? 'TOP 10' : 'ТОП-10'}
        </button>
      </div>
      <h2 className="mortarion-raid__subtitle relative font-black leading-tight text-amber-100 [text-shadow:0_3px_3px_#000]">{en ? 'Lord of Souls' : 'Властелин Душ'}</h2>
      <p className="mortarion-raid__tagline relative flex items-center justify-center gap-1.5 text-amber-200/85"><Users size={12} aria-hidden="true"/>{en ? 'One boss for all heroes' : 'Один босс для всех героев'}</p>

      <div className={`mortarion-raid__arena ${impact ? 'mortarion-raid__arena--striking' : ''}`} style={{ '--mortarion-backdrop': `url("${import.meta.env.BASE_URL}assets/territory/events/mortarion-background.webp")` } as Record<string,string>} role="img" aria-label={en ? 'Your hero battles Mortarion, Lord of Souls' : 'Твой герой сражается с Мортарионом, Властелином Душ'}>
        <div className="mortarion-raid__layer-bg" aria-hidden="true" />
        <img className="mortarion-raid__layer-souls" src={import.meta.env.BASE_URL + 'assets/territory/events/mortarion-fx-souls.webp'} alt="" draggable={false} aria-hidden="true" />
        <img className="mortarion-raid__layer-boss" src={import.meta.env.BASE_URL + 'assets/territory/events/mortarion-boss-layer.webp'} alt="" draggable={false} data-testid="mortarion-full-body-boss" />
        <img className="mortarion-raid__layer-core" src={import.meta.env.BASE_URL + 'assets/territory/events/mortarion-fx-core.webp'} alt="" draggable={false} aria-hidden="true" />
        <img className="mortarion-raid__layer-vortex" src={import.meta.env.BASE_URL + 'assets/territory/events/mortarion-fx-vortex.webp'} alt="" draggable={false} aria-hidden="true" />
        <img className="mortarion-raid__layer-floor-fx" src={import.meta.env.BASE_URL + 'assets/territory/events/mortarion-fx-floor.webp'} alt="" draggable={false} aria-hidden="true" />
        <span className="mortarion-raid__floor" aria-hidden="true"/>
        <span className="mortarion-raid__mist" aria-hidden="true"/>
        <span className="mortarion-raid__soul mortarion-raid__soul--one" aria-hidden="true">✦</span>
        <span className="mortarion-raid__soul mortarion-raid__soul--two" aria-hidden="true">✧</span>
        <span className="mortarion-raid__hero-aura" aria-hidden="true"/>
        <span className="mortarion-raid__hero-ground" aria-hidden="true"/>
        <div className="mortarion-raid__player" data-testid="mortarion-real-player-hero">
          <FighterFigure src={heroFrames.idle} combatFrames={heroFrames} name={game.player.name}
            dir={1} alive strike={strike} idleSeconds={3.1}
            className="absolute inset-0 h-full w-full object-contain object-bottom"/>
        </div>
        <span className="mortarion-raid__player-name" aria-hidden="true">{game.player.name}</span>
        {strike && <span key={strike.key} className="mortarion-raid__slash-trail" aria-hidden="true"/>}
        {strike && <span key={`flight-${strike.key}`} className="mortarion-raid__strike-flight" data-testid="mortarion-confirmed-hit-flight" aria-hidden="true"/>}
        {impact && <span key={`ring-${strikeId}`} className="mortarion-raid__hit-ring" data-testid="mortarion-confirmed-hit-contact" aria-hidden="true"/>}
        {impact && <span key={strikeId} className="mortarion-raid__impact" aria-hidden="true">✦</span>}
        {impact && <span key={`damage-${strikeId}`} className="mortarion-raid__damage">−{format(lastDamage)}</span>}
        {defeated && <div className="mortarion-raid__defeated" role="status">{en ? 'MORTARION DEFEATED!' : 'МОРТАРИОН ПОВЕРЖЕН!'}</div>}
      </div>

      <div className="relative mt-2 flex justify-between gap-2 text-xs font-bold"><span className="flex items-center gap-1 text-red-200"><Skull size={14}/> HP</span>
        <span className="tabular-nums">{state ? format(health) : '…'} / {format(state?.maxHp ?? MORTARION_HP)}</span>
      </div>
      <div className="relative mt-1 h-2.5 overflow-hidden rounded-full border border-red-400/70 bg-[#0c080b]" role="progressbar" aria-label="Boss HP" aria-valuemin={0} aria-valuemax={state?.maxHp ?? MORTARION_HP} aria-valuenow={health}>
        <div className="h-full rounded-full bg-gradient-to-r from-red-800 via-orange-600 to-amber-400 transition-[width] duration-500" style={{ width: `${Math.max(0,hpPercent)}%` }}/>
      </div>
      <div className="relative mt-2 flex items-center justify-between rounded-lg bg-black/35 px-2 py-1 text-[11px]">
        <span className="flex items-center gap-1 text-amber-200"><Clock3 size={13}/>{en ? 'Time remaining' : 'До конца события'}</span>
        <span className="font-black text-amber-100 tabular-nums">{loading ? '…' : defeated ? (en ? 'Defeated!' : 'Повержен!') : expired ? (en ? 'Ended' : 'Завершено') : state?.enabled ? eventCountdown(durationMs,en) : (en ? 'Not started' : 'Не началось')}</span>
      </div>

      <button type="button" onClick={() => void attack()} disabled={!canHit} className="mortarion-raid__attack relative mt-2 flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border-2 border-yellow-300 bg-gradient-to-b from-amber-400 via-orange-600 to-red-800 px-3 py-2 text-sm font-black text-white [text-shadow:0_2px_2px_#5c1c06] active:translate-y-1 disabled:cursor-not-allowed" data-testid="mortarion-attack">
        <Sword size={18} aria-hidden="true"/>
        {loading ? (en ? 'LOADING…' : 'ЗАГРУЗКА…') : defeated ? (en ? 'BOSS DEFEATED' : 'БОСС ПОВЕРЖЕН') : !state?.active ? (en ? 'RAID NOT ACTIVE' : 'РЕЙД НЕ АКТИВЕН') : attacking ? (en ? 'STRIKING…' : 'НАНОСИМ УДАР…') : nextHitMs > 0 ? (en ? `NEXT STRIKE IN ${shortClock(nextHitMs)}` : `УДАР ЧЕРЕЗ ${shortClock(nextHitMs)}`) : hitsLeft === 0 ? (en ? 'HIT LIMIT REACHED' : 'ЛИМИТ УДАРОВ') : (en ? 'STRIKE THE BOSS!' : 'УДАРИТЬ БОССА!')}
      </button>
      <p className="relative mt-1.5 text-[11px] text-amber-100/85">
        {en ? 'Available strikes' : 'Доступно ударов'}: <b>{state ? hitsLeft : '…'}/{MORTARION_HITS_PER_HOUR}</b> · {en ? 'One strike every 60 seconds' : '1 удар раз в 60 секунд'}
      </p>
      <p className="relative mt-1 text-[10px] leading-tight text-amber-200/70">
        {en ? 'One evolving chest for each participant. Player and tester accounts share the TOP 10.' : 'Один растущий сундук за участие. Игроки и тестеры соревнуются в общем Топ-10.'}
      </p>
      {rewardStatus && <p data-testid="mortarion-reward-teaser" className="relative mt-2 rounded-lg border border-violet-400/35 bg-violet-950/40 px-2 py-1.5 text-[11px] font-bold text-amber-100">
        🎁 {en ? 'Your chest' : 'Твой сундук'}: {rewardStatus.tier === 'legendary' ? (en ? 'Legendary' : 'Легендарный') : rewardStatus.tier === 'hunter' ? (en ? 'Soul hunter' : 'Охотника') : (en ? 'Participant' : 'Участника')} · {rewardStatus.activeDays}/{rewardStatus.requiredDays} {en ? 'days' : 'дней'} · {rewardStatus.totalHits} {en ? 'hits' : 'ударов'}
      </p>}
      {message && <p role="alert" className="relative mt-2 rounded-lg border border-red-500/50 bg-red-950/60 px-2 py-2 text-xs text-red-100">{message}</p>}
    </section>

    <section ref={leaderboardRef} id="mortarion-top10" className="mortarion-raid__leaderboard rounded-2xl border border-amber-600/50 bg-gradient-to-b from-[#49301d] to-[#151315] p-2.5 shadow-lg" data-testid="mortarion-top10">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-black text-amber-100"><Trophy size={19} className="text-yellow-400"/>{en ? 'TOP 10 BY DAMAGE' : 'ТОП-10 ПО УРОНУ'}</h3>
        <button type="button" onClick={() => void refresh()} disabled={attacking} className="rounded-lg border border-amber-400/40 bg-black/40 p-2 text-amber-200 active:scale-95" aria-label={en ? 'Refresh ranking' : 'Обновить рейтинг'}><RefreshCw size={15}/></button>
      </div>
      <ol className="mortarion-raid__rank-list mt-2" aria-label={en ? 'Top 10 damage leaderboard' : 'Топ-10 по урону'}>
        {Array.from({length: 10}, (_, i) => {
          const item = state?.top10[i];
          return <li key={i} className="mortarion-raid__rank-entry flex min-w-0 items-center gap-1.5 rounded-lg border border-white/5 bg-black/30 px-2 py-1 text-xs">
            <span className={`w-6 shrink-0 text-center font-black ${i===0 ? 'text-yellow-300' : i===1 ? 'text-slate-200' : i===2 ? 'text-orange-400' : 'text-amber-200/65'}`}>{i < 3 ? ['🥇','🥈','🥉'][i] : `#${i+1}`}</span>
            <span className="min-w-0 flex-1 truncate font-bold text-amber-50">{item?.name ?? '—'}</span>
            <span className="shrink-0 tabular-nums font-black text-orange-200">{item ? format(item.damage) : ''}</span>
          </li>;
        })}
      </ol>
    </section>
  </div>;
}
