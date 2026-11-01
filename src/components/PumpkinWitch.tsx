import { getFollowerArt } from '@/game/combatArt';
import './pumpkinWitch.css';

/** All transient actions are keyed by actual events, never by a combat timer. */
export function PumpkinWitch({ attack = 0, heal = 0, appear = 0, pose, preloadActions = false }: { attack?: number; heal?: number; appear?: number; pose?: { kind: 'attack' | 'heal'; sequence: number } | null; preloadActions?: boolean }) {
  const root = import.meta.env.BASE_URL + 'assets/territory/characters/followers/pumpkin_witch_2026/';
  return <span className="pumpkin-witch" aria-hidden="true">
    <span className="pumpkin-witch__aura" />
    {preloadActions && <span className="pumpkin-witch__preload"><img src={root + 'attack.webp'} alt="" decoding="async"/><img src={root + 'heal.webp'} alt="" decoding="async"/></span>}
    <span key={pose?.sequence ?? 0} className={`pumpkin-witch__body ${pose ? `pumpkin-witch__body--${pose.kind}` : ""}`}>
      <img className="pumpkin-witch__figure" src={getFollowerArt('follower_pumpkin_witch_2026')} alt="" draggable={false} />
      {pose && <img key={pose.sequence} className="pumpkin-witch__action-pose" src={root + pose.kind + '.webp'} alt="" draggable={false} />}
      <img className="pumpkin-witch__blink" src={root + 'blink.webp'} alt="" draggable={false} />
    </span>
    <span className="pumpkin-witch__spark pumpkin-witch__spark--one">✦</span>
    <span className="pumpkin-witch__spark pumpkin-witch__spark--two">✦</span>
    {attack > 0 && <span key={'attack' + attack} className="pumpkin-witch__effect pumpkin-witch__effect--attack"><i>✦</i><i>🎃</i><i>✦</i></span>}
    {heal > 0 && <span key={'heal' + heal} className="pumpkin-witch__effect pumpkin-witch__effect--heal"><i>✧</i><i>✚</i><i>✦</i></span>}
    {appear > 0 && <span key={'appear' + appear} className="pumpkin-witch__effect pumpkin-witch__effect--appear">✦ 🎃 ✦</span>}
  </span>;
}
