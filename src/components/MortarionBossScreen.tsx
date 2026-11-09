import { useEffect, useState } from 'react';
import { Clock3, Crown, Skull, Swords, Trophy, Zap } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import './mortarionBoss.css';

/**
 * OWNER-ONLY VISUAL PLAYTEST — NEVER records damage, rankings or inventory.
 * The real event needs an independent, server-authoritative release gate.
 */
export const MORTARION_HP = 100_000_000;
export const MORTARION_HITS_PER_HOUR = 5;
export const MORTARION_HIT_COOLDOWN_MS = 60_000;
export const MORTARION_WINDOW_MS = 3_600_000;
export const MORTARION_EVENT_DAYS = 5;

type PreviewCombat = {
  hits: number;
  firstHitAt: number;
  lastHitAt: number;
  damage: number;
  sequence: number;
};
const EMPTY: PreviewCombat = { hits: 0, firstHitAt: 0, lastHitAt: 0, damage: 0, sequence: 0 };
const PREVIEW_DAMAGE = 15_000;

export function mortarionLimitAt(combat: PreviewCombat, now: number) {
  const expired = combat.firstHitAt > 0 && now - combat.firstHitAt >= MORTARION_WINDOW_MS;
  const hits = expired ? 0 : combat.hits;
  const quotaAt = hits >= MORTARION_HITS_PER_HOUR ? combat.firstHitAt + MORTARION_WINDOW_MS : 0;
  const cooldownAt = combat.lastHitAt + MORTARION_HIT_COOLDOWN_MS;
  const nextHitAt = Math.max(quotaAt, cooldownAt);
  return { hits, nextHitAt, canHit: now >= nextHitAt };
}

function clockLeft(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function MortarionBossScreen() {
  const { language } = useLanguage();
  const en = language === 'en';
  const [now, setNow] = useState(() => Date.now());
  const [combat, setCombat] = useState<PreviewCombat>(EMPTY);
  const [showImpact, setShowImpact] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    const onResume = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onResume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, []);

  useEffect(() => {
    if (!showImpact) return;
    const timer = window.setTimeout(() => setShowImpact(false), 850);
    return () => window.clearTimeout(timer);
  }, [showImpact, combat.sequence]);

  const { hits, nextHitAt, canHit } = mortarionLimitAt(combat, now);
  const remaining = Math.max(0, MORTARION_HP - combat.damage);
  const hpPercent = Math.max(0, (remaining / MORTARION_HP) * 100);
  const nextSeconds = clockLeft(nextHitAt - now);
  const hitsLeft = Math.max(0, MORTARION_HITS_PER_HOUR - hits);
  const format = (n: number) => n.toLocaleString(en ? 'en-US' : 'ru-RU');

  const testHit = () => {
    const clickedAt = Date.now();
    const limit = mortarionLimitAt(combat, clickedAt);
    if (!limit.canHit || combat.damage >= MORTARION_HP) return;
    const firstHitAt = limit.hits === 0 ? clickedAt : combat.firstHitAt;
    setCombat(prev => ({
      hits: limit.hits + 1,
      firstHitAt,
      lastHitAt: clickedAt,
      damage: Math.min(MORTARION_HP, prev.damage + PREVIEW_DAMAGE),
      sequence: prev.sequence + 1,
    }));
    setNow(clickedAt);
    setShowImpact(true);
  };

  return <section className="mortarion" data-testid="mortarion-boss-preview">
    <div className="mortarion__runes" aria-hidden="true">ᛟ · ᚷ · ᛜ · ᛉ · ᚱ</div>
    <div className="mortarion__status"><Skull size={13}/>{en ? 'OWNER PLAYTEST · NO SAVED DAMAGE' : 'ТЕСТ ДЛЯ ВЛАДЕЛЬЦА · УРОН НЕ СОХРАНЯЕТСЯ'}</div>
    <header className="mortarion__header">
      <span>{en ? 'WORLD BOSS · LORD OF SOULS' : 'МИРОВОЙ БОСС · ВЛАСТЕЛИН ДУШ'}</span>
      <h2>{en ? 'MORTARION' : 'МОРТАРИОН'}</h2>
      <p>{en ? 'The fallen souls are rising. Who will stop the Lord?' : 'Павшие души пробудились. Кто остановит Властелина?'}</p>
    </header>
    <div className={`mortarion__stage ${showImpact ? 'mortarion__stage--impact' : ''}`} aria-label={en ? 'Animated Mortarion boss' : 'Анимированный босс Мортарион'}>
      <div className="mortarion__aura" aria-hidden="true"/>
      <span className="mortarion__soul mortarion__soul--one" aria-hidden="true">✦</span>
      <span className="mortarion__soul mortarion__soul--two" aria-hidden="true">✧</span>
      <span className="mortarion__soul mortarion__soul--three" aria-hidden="true">✦</span>
      <div className="mortarion__character">
        <img src={import.meta.env.BASE_URL + 'assets/territory/events/mortarion-soul-lord.svg'} alt={en ? 'Mortarion, Lord of Souls' : 'Мортарион — Властелин Душ'} draggable={false} />
      </div>
      <span className="mortarion__ground" aria-hidden="true"/>
      {showImpact && <div key={combat.sequence} className="mortarion__shock" aria-hidden="true"><Zap size={68}/></div>}
      {combat.sequence > 0 && <div key={combat.sequence} className="mortarion__damage" role="status">−{format(PREVIEW_DAMAGE)}</div>}
    </div>
    <div className="mortarion__hp" aria-label={en ? 'Boss health' : 'Здоровье босса'}>
      <div className="mortarion__hp-caption"><span><Skull size={15}/>{en ? 'BOSS HEALTH' : 'ЗДОРОВЬЕ БОССА'}</span><strong>{format(remaining)} / {format(MORTARION_HP)} HP</strong></div>
      <div className="mortarion__hp-track" role="progressbar" aria-valuemin={0} aria-valuemax={MORTARION_HP} aria-valuenow={remaining}>
        <div className="mortarion__hp-fill" style={{ width: `${hpPercent}%` }}/>
      </div>
    </div>
    <div className="mortarion__parameters">
      <div><Clock3 size={17}/><span>{en ? 'EVENT DURATION' : 'СРОК СОБЫТИЯ'}</span><strong>{en ? '5 DAYS' : '5 СУТОК'}</strong></div>
      <div><Swords size={17}/><span>{en ? 'ATTACK LIMIT' : 'ЛИМИТ УДАРОВ'}</span><strong>{en ? '5 PER HOUR' : '5 В ЧАС'}</strong></div>
      <div><Zap size={17}/><span>{en ? 'BETWEEN HITS' : 'МЕЖДУ УДАРАМИ'}</span><strong>{en ? '60 SECONDS' : '60 СЕКУНД'}</strong></div>
    </div>
    <div className="mortarion__attack">
      <div className="mortarion__attack-count">
        <span>{en ? 'Attacks available' : 'Доступно ударов'}</span>
        <strong>{hitsLeft} / {MORTARION_HITS_PER_HOUR}</strong>
      </div>
      <button type="button" onClick={testHit} disabled={!canHit || remaining === 0} data-testid="mortarion-attack">
        <Swords size={21}/>
        {remaining === 0 ? (en ? 'BOSS DEFEATED' : 'БОСС ПОВЕРЖЕН') : !canHit ? `${en ? 'NEXT ATTACK IN' : 'СЛЕДУЮЩИЙ УДАР ЧЕРЕЗ'} ${nextSeconds}` : (en ? 'TEST ATTACK' : 'ПРОБНЫЙ УДАР')}
      </button>
      <small>{en ? 'Only preview effects are simulated. No real battle, rewards or ranking updates.' : 'Это проверка эффектов. Настоящий бой, награды и рейтинг не изменяются.'}</small>
    </div>
    <section className="mortarion__ranking" aria-label={en ? 'Top 10 damage ranking' : 'Топ-10 по нанесённому урону'}>
      <h3><Trophy size={18}/>{en ? 'TOP 10 DAMAGE DEALERS' : 'ТОП-10 ПО НАНЕСЁННОМУ УРОНУ'}<Crown size={15}/></h3>
      <p>{en ? 'Only ten leaders will appear here when the event starts.' : 'После запуска здесь будут видны только десять лидеров.'}</p>
      <ol>{Array.from({ length: 10 }, (_, i) => <li key={i}><b>{i + 1}</b><span>—</span></li>)}</ol>
    </section>
  </section>;
}
