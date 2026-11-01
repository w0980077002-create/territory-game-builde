import { getFollowerArt } from '@/game/combatArt';
import './pumpkinWitch.css';

/** Cosmetic only: action is supplied by the PvE round result, never a timer. */
export function PumpkinWitch({ action, sequence = 0 }: { action?: 'attack' | 'heal'; sequence?: number }) {
  return <span className="pumpkin-witch" aria-hidden="true">
    <span className="pumpkin-witch__aura" />
    <img className="pumpkin-witch__figure" src={getFollowerArt('follower_pumpkin_witch_2026')} alt="" draggable={false} />
    <span className="pumpkin-witch__spark pumpkin-witch__spark--one">✦</span>
    <span className="pumpkin-witch__spark pumpkin-witch__spark--two">✦</span>
    {action && <span key={sequence} className={`pumpkin-witch__effect pumpkin-witch__effect--${action}`} />}
  </span>;
}
