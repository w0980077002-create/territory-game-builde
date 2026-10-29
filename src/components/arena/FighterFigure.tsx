import type { CSSProperties } from 'react';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { useLanguage } from '@/game/i18n';
import './fighterEffects.css';

interface Props {
  src: string;
  combatFrames?: {
    idle: string;
    attack: string;
    block: string;
    dodge?: string;
    hit: string;
    death: string;
  };
  name: string;
  dir: 1 | -1;
  /** Mirror right-facing hero artwork for a left-facing opponent. */
  mirror?: boolean;
  alive: boolean;
  strike: StrikeEvent | null;
  idleSeconds: number;
  combatSpeed?: number;
  /** Enlarge the EXISTING artwork without introducing replacement characters. */
  scale?: number;
  className: string;
}

export function FighterFigure({
  src, combatFrames, name, dir, mirror = false, alive, strike,
  idleSeconds, combatSpeed = 1, scale = 1, className,
}: Props) {
  // The existing server/combat queue is the ONLY source for attacks and damage.
  const role = !strike ? null : strike.attacker === name ? 'attacker' : strike.target === name ? 'target' : null;
  const tone = strike?.tone;
  const swing = strike ? Math.abs(strike.key) % 3 : 0;
  const motion = role === 'attacker' ? `battle-swing-${swing}`
    : role !== 'target' ? ''
    : tone === 'dodge' ? 'animate-dodge'
    : tone === 'block' ? 'animate-guard'
    : 'animate-recoil';
  const speed = Number.isFinite(combatSpeed) && combatSpeed > 0 ? combatSpeed : 1;
  const size = Number.isFinite(scale) ? Math.min(1.35, Math.max(0.8, scale)) : 1;
  const style = {
    '--dir': dir,
    '--fighter-scale': size,
    '--fighter-hit-delay': `${Math.round(280 / speed)}ms`,
    '--fighter-impact-duration': `${Math.round(470 / speed)}ms`,
    '--fighter-motion-duration': `${Math.round(810 / speed)}ms`,
    '--fighter-sweep-duration': `${Math.round(440 / speed)}ms`,
    '--fighter-idle-duration': `${idleSeconds}s`,
  } as CSSProperties;

  const pose = !alive ? combatFrames?.death ?? src
    : role === 'attacker' ? combatFrames?.attack ?? src
    : role === 'target' && tone === 'dodge' ? combatFrames?.dodge ?? combatFrames?.idle ?? src
    : role === 'target' && tone === 'block' ? combatFrames?.block ?? src
    : role === 'target' ? combatFrames?.hit ?? src
    : combatFrames?.idle ?? src;

  return (
    <div className="fighter-figure absolute inset-0 pointer-events-none" style={style}>
      <div key={role ? `${strike?.key}-${role}` : 'still'} className={`fighter-figure__motion absolute inset-0 ${motion}`}>
        <div className="fighter-figure__size absolute inset-0">
          <div className={`fighter-figure__breath absolute inset-0 ${!role && alive ? 'fighter-figure__breath--idle' : ''}`}>
            <div className={`absolute inset-0 ${mirror ? 'battle-mirror-art' : ''}`}>
            {role === 'attacker' && alive && (
              <img src={pose} alt="" aria-hidden="true" draggable={false}
                className={`${className} fighter-figure__afterimage select-none`} />
            )}
            <img
              src={pose}
              alt={name}
              draggable={false}
              onError={(event) => {
                // Missing poses fall back to the same character's idle art.
                const img = event.currentTarget;
                const candidates = [combatFrames?.idle, src, import.meta.env.BASE_URL + 'assets/territory/characters/heroes/male_viking/idle.webp'];
                const attempt = Number(img.dataset.artRetry ?? '0');
                if (attempt < candidates.length) {
                  img.dataset.artRetry = String(attempt + 1);
                  img.src = candidates[attempt] ?? src;
                }
              }}
              className={`${className} select-none drop-shadow-[0_8px_10px_rgba(0,0,0,0.8)] ${!alive ? 'grayscale opacity-40 translate-y-2' : ''}`}
            />
            </div>
          </div>
        </div>
        {role === 'attacker' && <>
          <span aria-hidden="true" className={`fighter-figure__sweep fighter-figure__sweep--${swing}`} />
          <span aria-hidden="true" className="fighter-figure__footstep" />
        </>}
      </div>
      {role === 'target' && strike && <Impact key={strike.key} strike={strike} />}
    </div>
  );
}

function Impact({ strike }: { strike: StrikeEvent }) {
  const { language } = useLanguage();
  const crit = strike.tone === 'crit';
  const label = strike.tone === 'dodge' ? (language === 'en' ? 'DODGE!' : 'УКЛОН!')
    : strike.tone === 'block' ? (language === 'en' ? 'BLOCK!' : 'БЛОК!') : null;

  return (
    <div className={`fighter-impact fighter-impact--${strike.tone}`} aria-hidden="true">
      {strike.tone === 'dodge'
        ? <span className="fighter-impact__trail" />
        : strike.tone === 'block'
          ? <span className="fighter-impact__shield" />
          : <>
            <span className="fighter-impact__flash" />
            <span className="fighter-impact__arc" />
            <span className="fighter-impact__spark" />
            <span className="fighter-impact__shock" />
          </>}
      {(label || strike.amount !== null) && (
        <span className="fighter-impact__label">
          {crit && <small>{language === 'en' ? 'CRIT!' : 'КРИТ!'}</small>}
          {label ?? `−${strike.amount}`}
        </span>
      )}
    </div>
  );
}

// One purely visual clash at the center of the two fighters, triggered ONLY by
// the already-confirmed PvP strike queue or existing PvE hit. No extra attack,
// damage, timers, backend requests or reward changes are introduced here.
const CLASH_SPARKS = [
  { x: '-43px', y: '-27px' }, { x: '46px', y: '-31px' },
  { x: '-59px', y: '10px' }, { x: '57px', y: '15px' },
  { x: '-22px', y: '43px' }, { x: '27px', y: '37px' },
] as const;

export function CombatClash({ strike, speed = 1 }: { strike: StrikeEvent | null; speed?: number }) {
  if (!strike) return null;
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const style = {
    '--clash-duration': `${Math.round(800 / safeSpeed)}ms`,
  } as CSSProperties;
  const swing = Math.abs(strike.key) % 3;

  return (
    <div key={strike.key}
      className={`combat-clash combat-clash--${strike.tone} combat-clash--swing-${swing}`}
      style={style} aria-hidden="true" data-combat-vfx={strike.tone}>
      <span className="combat-clash__sweep" />
      <span className="combat-clash__center" />
      <span className="combat-clash__ring" />
      {CLASH_SPARKS.map((spark, index) => (
        <span key={index} className="combat-clash__fragment" style={{
          '--fragment-x': spark.x,
          '--fragment-y': spark.y,
        } as CSSProperties} />
      ))}
    </div>
  );
}
