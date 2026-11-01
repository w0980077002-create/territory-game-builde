import { getFollowerArt } from '@/game/combatArt';
import './pumpkinWitch.css';

/** All transient actions are keyed by actual events, never by a combat timer. */
export function PumpkinWitch({ attack = 0, heal = 0, appear = 0 }: { attack?: number; heal?: number; appear?: number }) {
  const root = import.meta.env.BASE_URL + 'assets/territory/characters/followers/pumpkin_witch_2026/';
  return <span className="pumpkin-witch" aria-hidden="true">
    <span className="pumpkin-witch__aura" />
    <span key={`${attack}-${heal}`} className={`pumpkin-witch__body ${attack > heal ? "pumpkin-witch__body--attack" : heal > 0 ? "pumpkin-witch__body--heal" : ""}`}>
      <img className="pumpkin-witch__figure" src={getFollowerArt('follower_pumpkin_witch_2026')} alt="" draggable={false} />
      <img className="pumpkin-witch__blink" src={root + 'blink.svg'} alt="" draggable={false} />
    </span>
    <span className="pumpkin-witch__spark pumpkin-witch__spark--one">✦</span>
    <span className="pumpkin-witch__spark pumpkin-witch__spark--two">✦</span>
    {attack > 0 && <span key={'attack' + attack} className="pumpkin-witch__effect pumpkin-witch__effect--attack" />}
    {heal > 0 && <span key={'heal' + heal} className="pumpkin-witch__effect pumpkin-witch__effect--heal" />}
    {appear > 0 && <span key={'appear' + appear} className="pumpkin-witch__effect pumpkin-witch__effect--appear">✦ 🎃 ✦</span>}
  </span>;
}
