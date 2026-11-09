import { useEffect, useRef, useState } from 'react';
import { Clock3, RefreshCw, Skull, Sword, Trophy, Users } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import './mortarionBoss.css';

/** An isolated owner-only preview. No server calls or changes to player saves. */
export const MORTARION_HP = 100_000_000;
export const MORTARION_HITS_PER_HOUR = 5;
export const MORTARION_HIT_COOLDOWN_MS = 60_000;
export const MORTARION_WINDOW_MS = 3_600_000;
export const MORTARION_EVENT_DAYS = 5;
const TEST_HIT_DAMAGE = 15_000;

type PreviewCombat = { hits: number; firstHitAt: number; lastHitAt: number; damage: number; sequence: number };
const EMPTY: PreviewCombat = { hits: 0, firstHitAt: 0, lastHitAt: 0, damage: 0, sequence: 0 };

export function mortarionLimitAt(combat: Pick<PreviewCombat, 'hits' | 'firstHitAt' | 'lastHitAt'>, now: number) {
  const expired = combat.firstHitAt > 0 && now - combat.firstHitAt >= MORTARION_WINDOW_MS;
  const hits = expired ? 0 : combat.hits;
  const quotaAt = hits >= MORTARION_HITS_PER_HOUR ? combat.firstHitAt + MORTARION_WINDOW_MS : 0;
  const cooldownAt = combat.lastHitAt + MORTARION_HIT_COOLDOWN_MS;
  const nextHitAt = Math.max(quotaAt, cooldownAt);
  return { hits, nextHitAt, canHit: now >= nextHitAt };
}

const secondsLabel = (n: number) => {
  const sec = Math.max(0, Math.ceil(n / 1000));
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};

export function MortarionBossScreen() {
  const { language } = useLanguage();
  const en = language === 'en';
  const [now, setNow] = useState(() => Date.now());
  const [combat, setCombat] = useState<PreviewCombat>(EMPTY);
  const [impact, setImpact] = useState(false);
  const effectTimer = useRef<number | null>(null);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 300);
    const resume = () => setNow(Date.now());
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', resume);
      if (effectTimer.current !== null) window.clearTimeout(effectTimer.current);
    };
  }, []);

  const { hits, nextHitAt, canHit } = mortarionLimitAt(combat, now);
  const left = MORTARION_HP - combat.damage;
  const hitsLeft = MORTARION_HITS_PER_HOUR - hits;
  const format = (n: number) => Math.max(0, Math.floor(n)).toLocaleString(en ? 'en-US' : 'ru-RU');
  const cooldown = !canHit ? secondsLabel(nextHitAt - now) : null;
  const defeated = left <= 0;

  const attack = () => {
    const clickedAt = Date.now();
    const limit = mortarionLimitAt(combat, clickedAt);
    if (!limit.canHit || defeated) return;
    if (effectTimer.current !== null) window.clearTimeout(effectTimer.current);
    setNow(clickedAt);
    setImpact(false);
    setCombat(current => ({
      hits: limit.hits + 1,
      firstHitAt: limit.hits === 0 ? clickedAt : current.firstHitAt,
      lastHitAt: clickedAt,
      damage: Math.min(MORTARION_HP, current.damage + TEST_HIT_DAMAGE),
      sequence: current.sequence + 1,
    }));
    // Only temporary display state: the raid is still disabled for players.
    window.requestAnimationFrame(() => setImpact(true));
    effectTimer.current = window.setTimeout(() => setImpact(false), 1250);
  };

  return <div className="mortarion-raid mx-auto w-full max-w-[430px] space-y-3 pb-8 text-amber-50" data-testid="mortarion-boss-preview">
    <section className="mortarion-raid__card relative overflow-hidden rounded-2xl border-2 border-amber-600/75 bg-gradient-to-b from-[#2f172a] via-[#241123] to-[#0d1018] p-3 text-center shadow-[0_8px_28px_#0009]">
      <div className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full bg-purple-500/20 blur-3xl"/>
      <p className="relative text-xs font-black uppercase tracking-widest text-orange-300">
        ☠ {en ? 'WORLD RAID · 2026' : 'МИРОВОЙ РЕЙД · 2026'}
      </p>
      <h2 className="relative mt-1 text-[23px] font-black leading-tight text-amber-100 [text-shadow:0_3px_3px_#000]">
        {en ? 'Mortarion' : 'Мортарион'}
      </h2>
      <p className="relative mt-1 flex items-center justify-center gap-1.5 text-[11px] text-amber-200/85">
        <Users size={13}/>{en ? 'Lord of Souls · One boss for all heroes' : 'Властелин Душ · Один босс для всех героев'}
      </p>

      <div className={`mortarion-raid__arena ${impact ? 'mortarion-raid__arena--striking' : ''}`} role="img" aria-label={en ? 'Mortarion the Lord of Souls in a ruined citadel' : 'Мортарион — Властелин Душ в разрушенной цитадели'}>
        <img className="mortarion-raid__scene" src={import.meta.env.BASE_URL + 'assets/territory/events/mortarion-raid-scene.svg'} alt="" draggable={false}/>
        <span className="mortarion-raid__mist" aria-hidden="true"/>
        <span className="mortarion-raid__soul mortarion-raid__soul--one" aria-hidden="true">✦</span>
        <span className="mortarion-raid__soul mortarion-raid__soul--two" aria-hidden="true">✧</span>
        {impact && <span key={combat.sequence} className="mortarion-raid__impact" aria-hidden="true">✦</span>}
        {impact && <span key={`damage-${combat.sequence}`} className="mortarion-raid__damage">−{format(TEST_HIT_DAMAGE)}</span>}
        {defeated && <div className="mortarion-raid__defeated" role="status">{en ? 'MORTARION DEFEATED!' : 'МОРТАРИОН ПОВЕРЖЕН!'}</div>}
      </div>

      <div className="relative mt-4 flex justify-between gap-2 text-xs font-bold">
        <span className="flex items-center gap-1 text-red-200"><Skull size={14}/> HP</span>
        <span className="tabular-nums">{format(left)} / {format(MORTARION_HP)}</span>
      </div>
      <div className="relative mt-1 h-4 overflow-hidden rounded-full border border-red-400/70 bg-[#0c080b]" role="progressbar" aria-label="Boss HP" aria-valuemin={0} aria-valuemax={MORTARION_HP} aria-valuenow={left}>
        <div className="h-full rounded-full bg-gradient-to-r from-red-800 via-orange-600 to-amber-400 transition-[width] duration-500" style={{ width: `${Math.max(0, left / MORTARION_HP * 100)}%` }} />
      </div>
      <div className="relative mt-3 flex items-center justify-between rounded-lg bg-black/35 px-2 py-1.5 text-[11px]">
        <span className="flex items-center gap-1 text-amber-200"><Clock3 size={13}/>{en ? 'Event duration' : 'Срок события'}</span>
        <span className="font-black text-amber-100">{en ? '5 days' : '5 суток'}</span>
      </div>

      <button type="button" onClick={attack} disabled={!canHit || defeated} className="mortarion-raid__attack relative mt-3 flex w-full min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-yellow-300 bg-gradient-to-b from-amber-400 via-orange-600 to-red-800 px-4 py-3 text-base font-black text-white shadow-[0_4px_0_#4a160a,0_7px_15px_#0008] [text-shadow:0_2px_2px_#5c1c06] transition-transform active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-65" data-testid="mortarion-attack">
        <Sword size={22}/>
        {defeated ? (en ? 'BOSS DEFEATED!' : 'БОСС ПОВЕРЖЕН!')
          : cooldown ? (en ? `NEXT HIT IN ${cooldown}` : `УДАР ЧЕРЕЗ ${cooldown}`)
          : (en ? 'STRIKE THE BOSS!' : 'УДАРИТЬ БОССА!')}
      </button>
      <p className="relative mt-2 text-[11px] text-amber-100/85">
        {en ? 'Available strikes' : 'Доступно ударов'}: <b>{hitsLeft}/{MORTARION_HITS_PER_HOUR}</b> · {en ? 'One strike every 60 seconds' : '1 удар раз в 60 секунд'}
      </p>
      <p className="relative mt-1 text-[9px] text-amber-200/65">
        {en ? 'Owner preview — damage is not saved. Live event is off.' : 'Тест владельца — урон не сохраняется. Событие выключено.'}
      </p>
    </section>

    <section className="mortarion-raid__leaderboard rounded-2xl border border-amber-600/50 bg-gradient-to-b from-[#49301d] to-[#151315] p-3 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-black text-amber-100"><Trophy size={19} className="text-yellow-400"/>{en ? 'TOP 10 BY DAMAGE' : 'ТОП-10 ПО УРОНУ'}</h3>
        <span className="rounded-lg border border-amber-400/30 bg-black/40 p-2 text-amber-200" aria-hidden="true"><RefreshCw size={15}/></span>
      </div>
      <ol className="mt-2 space-y-1.5" aria-label={en ? 'Top 10 damage leaderboard' : 'Топ-10 по урону'}>
        {Array.from({ length: 10 }, (_, i) => <li key={i} className="flex min-w-0 items-center gap-2 rounded-lg border border-white/5 bg-black/30 px-2 py-2 text-xs">
          <span className={`w-6 shrink-0 text-center font-black ${i === 0 ? 'text-yellow-300' : i === 1 ? 'text-slate-200' : i === 2 ? 'text-orange-400' : 'text-amber-200/65'}`}>{i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`}</span>
          <span className="min-w-0 flex-1 truncate text-amber-100/50">—</span>
        </li>)}
      </ol>
      <p className="mt-3 text-center text-[10px] leading-relaxed text-amber-200/70">
        {en ? 'Only the ten best heroes appear here during the live event.' : 'После запуска здесь показываются только 10 лучших игроков.'}
      </p>
    </section>
  </div>;
}
