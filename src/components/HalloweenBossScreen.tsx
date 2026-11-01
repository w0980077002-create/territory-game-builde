import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, RefreshCw, Skull, Sparkles, Sword, Trophy, Users } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { getCombatAppearance } from '@/game/appearance';
import './halloweenRaid.css';
import { getHalloweenBossState, hitHalloweenBoss, type HalloweenBossState } from '@/game/halloweenBoss';

const formatDamage = (value: number, en: boolean) => Math.floor(value).toLocaleString(en ? 'en-US' : 'ru-RU');

function bossError(error: unknown, en: boolean): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('halloween_boss_daily_limit')) return en ? 'Your attacks for today are used. Return after 00:00 UTC.' : 'Удары на сегодня закончились. Возвращайся после 00:00 UTC.';
  if (raw.includes('halloween_boss_cooldown')) return en ? 'The sword is recharging. Try again in a moment.' : 'Оружие перезаряжается. Повтори через несколько секунд.';
  if (raw.includes('halloween_boss_event_ended') || raw.includes('halloween_boss_defeated')) return en ? 'The event has ended.' : 'Событие завершилось.';
  if (raw.includes('auth_required') || raw.includes('JWT') || raw.includes('session')) return en ? 'Reopen the game in Telegram to confirm your session.' : 'Перезапусти игру через Telegram для подтверждения входа.';
  return en ? 'Connection failed. Progress is safe; try refreshing.' : 'Ошибка соединения. Прогресс сохранён, обнови данные.';
}

function timeToGo(seconds: number, en: boolean): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return days > 0
    ? (en ? `${days}d ${hours}h` : `${days}д ${hours}ч`)
    : (en ? `${hours}h ${minutes}m` : `${hours}ч ${minutes}м`);
}

/** Seasonal standalone raid. The server alone owns total HP, hits and ranking. */
export function HalloweenBossScreen() {
  const { language } = useLanguage();
  const appearance = useStore(useGame).appearance;
  const en = language === 'en';
  const [state, setState] = useState<HalloweenBossState | null>(null);
  const [loading, setLoading] = useState(true);
  const [attacking, setAttacking] = useState(false);
  const [message, setMessage] = useState('');
  const [lastDamage, setLastDamage] = useState<number | null>(null);
  const [impact, setImpact] = useState(false);
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(true);
  const fetching = useRef(false);
  const attackingRef = useRef(false);
  const revision = useRef(0);
  const timers = useRef<number[]>([]);

  const refresh = useCallback(async () => {
    if (fetching.current || attackingRef.current) return;
    fetching.current = true;
    const startedAt = revision.current;
    try {
      const next = await getHalloweenBossState();
      if (mounted.current && startedAt === revision.current && !attackingRef.current) { setState(next); setMessage(''); }
    } catch (error) {
      if (mounted.current && startedAt === revision.current && !attackingRef.current) setMessage(bossError(error, en));
    } finally {
      fetching.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [en]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const poll = window.setInterval(() => { void refresh(); }, 8000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    };
  }, [refresh]);

  const attack = async () => {
    if (!state?.active || attackingRef.current) return;
    attackingRef.current = true;
    revision.current += 1;
    setAttacking(true);
    setMessage('');
    try {
      const next = await hitHalloweenBoss();
      if (!mounted.current) return;
      // Only a confirmed server response starts a visual strike. Never fabricate damage.
      if (next.hitDamage == null) {
        setState(next);
        throw new Error('halloween_boss_bad_response');
      }
      setLastDamage(next.hitDamage);
      setImpact(true);
      timers.current.push(window.setTimeout(() => {
        if (mounted.current) setState(next);
      }, 540));
      timers.current.push(window.setTimeout(() => {
        attackingRef.current = false;
        if (mounted.current) { setImpact(false); setAttacking(false); }
      }, 1250));
    } catch (error) {
      attackingRef.current = false;
      if (mounted.current) { setAttacking(false); setMessage(bossError(error, en)); }
    }
  };

  const hpPercent = state?.maxHp ? Math.max(0, Math.min(100, state.hp / state.maxHp * 100)) : 0;
  const nextAttackTime = state?.nextHitAt ? Date.parse(state.nextHitAt) : 0;
  const cooldown = Math.max(0, Math.ceil((nextAttackTime - now) / 1000) || 0);
  const hitsLeft = Math.max(0, (state?.maxHitsToday ?? 0) - (state?.myHitsToday ?? 0));
  const remaining = state ? Math.max(0, Math.floor((Date.parse(state.endsAt) - now) / 1000) || 0) : 0;
  const canAttack = !!state?.active && !attacking && cooldown === 0 && hitsLeft > 0;

  return (
    <div className="mx-auto w-full max-w-[430px] space-y-3 pb-8 text-amber-50">
      <section className="relative overflow-hidden rounded-2xl border-2 border-amber-600/75 bg-gradient-to-b from-[#2f172a] via-[#241123] to-[#0d1018] p-3 text-center shadow-[0_8px_28px_#0009]">
        <div className="absolute -right-8 -top-8 h-36 w-36 rounded-full bg-purple-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -left-6 top-28 h-28 w-28 rounded-full bg-orange-500/20 blur-3xl pointer-events-none" />
        <p className="relative text-xs font-black uppercase tracking-widest text-orange-300">🎃 {en ? 'HALLOWEEN RAID · 2026' : 'ХЭЛЛОУИНСКИЙ РЕЙД · 2026'}</p>
        <h2 className="relative mt-1 text-[21px] font-black leading-tight text-amber-100 [text-shadow:0_3px_3px_#000]">
          {en ? 'Pumpkin King' : 'Тыквенный король'}
        </h2>
        <p className="relative mt-1 flex items-center justify-center gap-1.5 text-[11px] text-amber-200/85">
          <Users size={13} />{en ? 'One boss for all heroes' : 'Один босс для всех героев'}
        </p>
        <div className={`raid-arena ${impact ? 'raid-arena--striking' : ''}`} style={{ backgroundImage: `url(${import.meta.env.BASE_URL}assets/territory/halloween/arena.webp)` }} role="img" aria-label={en ? 'Pumpkin King, Halloween world boss' : 'Тыквенный король, общий босс'}>
          <div className="raid-mist" aria-hidden="true" />
          <img className="raid-boss" src={`${import.meta.env.BASE_URL}assets/territory/halloween/pumpkin-king.webp`} alt="" />
          <img className="raid-hero" src={impact ? getCombatAppearance(appearance).attack : getCombatAppearance(appearance).idle} alt="" />
          {impact && <><span className="raid-slash" aria-hidden="true"/><span className="raid-impact" aria-hidden="true">✦</span><span className="raid-damage" aria-live="polite">−{formatDamage(lastDamage ?? 0, en)}</span></>}
        </div>

        <div className="relative mt-4 flex justify-between gap-2 text-xs font-bold">
          <span className="flex items-center gap-1 text-red-200"><Skull size={14} /> HP</span>
          <span className="tabular-nums">{state ? formatDamage(state.hp, en) : '…'} / {state ? formatDamage(state.maxHp, en) : '…'}</span>
        </div>
        <div className="relative mt-1 h-4 overflow-hidden rounded-full border border-red-400/70 bg-[#0c080b]" role="progressbar" aria-label="Boss HP" aria-valuemin={0} aria-valuemax={state?.maxHp || 1} aria-valuenow={state?.hp ?? 0}>
          <div className="h-full rounded-full bg-gradient-to-r from-red-800 via-orange-600 to-amber-400 transition-[width] duration-500" style={{ width: `${hpPercent}%` }} />
        </div>
        <div className="relative mt-3 flex items-center justify-between rounded-lg bg-black/35 px-2 py-1.5 text-[11px]">
          <span className="flex items-center gap-1 text-amber-200"><Clock3 size={13}/>{en ? 'Time remaining' : 'До конца события'}</span>
          <span className="font-black text-amber-100">{state ? timeToGo(remaining, en) : '…'}</span>
        </div>

        <button type="button" onClick={() => void attack()} disabled={!canAttack || loading}
          className="relative mt-3 flex w-full min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-yellow-300 bg-gradient-to-b from-amber-400 via-orange-600 to-red-800 px-4 py-3 text-base font-black text-white shadow-[0_4px_0_#4a160a,0_7px_15px_#0008] [text-shadow:0_2px_2px_#5c1c06] transition-transform active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-50">
          <Sword size={22} />
          {loading ? (en ? 'LOADING…' : 'ЗАГРУЗКА…')
            : !state?.active ? (en ? 'EVENT FINISHED' : 'СОБЫТИЕ ЗАВЕРШЕНО')
            : hitsLeft === 0 ? (en ? 'COME BACK TOMORROW' : 'ВОЗВРАЩАЙСЯ ЗАВТРА')
            : cooldown > 0 ? (en ? `READY IN ${cooldown}s` : `УДАР ЧЕРЕЗ ${cooldown} СЕК.`)
            : attacking ? (en ? 'ATTACKING…' : 'АТАКУЕМ…')
            : en ? 'STRIKE THE BOSS!' : 'УДАРИТЬ БОССА!'}
        </button>
        <p className="relative mt-2 text-[11px] text-amber-100/85">
          {en ? 'Free attacks' : 'Бесплатные удары'}: <b>{state ? hitsLeft : '…'}/{state?.maxHitsToday ?? 100}</b> · {en ? 'Resets at 00:00 UTC' : 'Обновление в 00:00 UTC'}
        </p>
        {message && <p role="alert" className="relative mt-2 rounded-lg border border-red-500/50 bg-red-950/60 px-2 py-2 text-xs text-red-100">{message}</p>}
      </section>

      <section className="rounded-2xl border border-amber-600/50 bg-gradient-to-b from-[#49301d] to-[#151315] p-3 shadow-lg">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-black text-amber-100"><Trophy size={19} className="text-yellow-400"/>{en ? 'TOP 10 BY DAMAGE' : 'ТОП-10 ПО УРОНУ'}</h3>
          <button type="button" onClick={() => void refresh()} aria-label={en ? 'Refresh ranking' : 'Обновить рейтинг'} className="rounded-lg border border-amber-400/40 bg-black/40 p-2 text-amber-200 active:scale-95"><RefreshCw size={15}/></button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-orange-400/40 bg-orange-900/35 p-2 text-xs">
          <span><Sparkles size={13} className="mr-1 inline text-yellow-300"/>{en ? 'Your damage' : 'Твой урон'} {state?.myRank ? `· #${state.myRank}` : ''}</span>
          <b className="tabular-nums text-amber-100">{state ? formatDamage(state.myDamage, en) : '…'}</b>
        </div>
        {state?.top10.length ? (
          <ol className="mt-2 space-y-1.5" aria-label={en ? 'Top 10 damage leaderboard' : 'Десятка лидеров по урону'}>
            {state.top10.map((item) => (
              <li key={item.rank} className="flex min-w-0 items-center gap-2 rounded-lg border border-white/5 bg-black/30 px-2 py-2 text-xs">
                <span className={`w-6 shrink-0 text-center font-black ${item.rank === 1 ? 'text-yellow-300' : item.rank === 2 ? 'text-slate-200' : item.rank === 3 ? 'text-orange-400' : 'text-amber-200/65'}`}>{item.rank <= 3 ? ['🥇','🥈','🥉'][item.rank - 1] : `#${item.rank}`}</span>
                <span className="min-w-0 flex-1 truncate font-bold text-amber-50">{item.name}</span>
                <span className="shrink-0 tabular-nums font-black text-orange-200">{formatDamage(item.damage, en)}</span>
              </li>
            ))}
          </ol>
        ) : state ? <p className="mt-4 text-center text-xs text-amber-100/70">{en ? 'No strikes yet. Be the first!' : 'Ударов пока нет. Стань первым!'}</p> : null}
        <p className="mt-3 text-center text-[10px] leading-relaxed text-amber-200/70">
          {en ? 'The leaderboard refreshes every 8 seconds. Only server-confirmed damage counts. No existing energy, stones or potions are spent.' : 'Рейтинг обновляется каждые 8 секунд. Засчитывается только подтверждённый сервером урон. Энергия, камни и эликсиры не тратятся.'}
        </p>
      </section>
    </div>
  );
}
