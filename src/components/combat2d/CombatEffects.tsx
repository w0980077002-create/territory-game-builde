import { useEffect, useState } from 'react';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { useLanguage } from '@/game/i18n';

/** Short, bounded effects. This component cannot emit combat events or damage. */
export function CombatEffects({ strike, role, won = false }: { strike: StrikeEvent | null; role: 'attacker' | 'target' | null; won?: boolean }) {
  const { language } = useLanguage();
  const [lowQuality, setLowQuality] = useState(() => navigator.hardwareConcurrency <= 4 || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (lowQuality) return;
    let frame = 0, samples = 0, slow = 0, previous = 0;
    const sample = (now: number) => {
      if (document.hidden) { previous = 0; }
      else {
        if (previous && now - previous > 40) slow++;
        previous = now;
        samples++;
      }
      if (slow >= 6) setLowQuality(true);
      else if (samples < 40) frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [lowQuality]);
  const tone = strike?.tone;
  const target = role === 'target' && strike;
  const label = tone === 'dodge' ? (language === 'en' ? 'DODGE!' : 'УКЛОН!') : tone === 'block' ? (language === 'en' ? 'BLOCK!' : 'БЛОК!') : null;
  return <div key={strike && role ? `${strike.key}-${role}` : won ? 'victory' : 'idle'}
    className={`combat2d-effects combat2d-effects--${tone ?? 'idle'} ${strike && Math.abs(strike.key) % 3 === 2 ? 'combat2d-effects--strong' : ''}`}
    data-quality={lowQuality ? 'low' : 'full'} aria-hidden="true">
    {role === 'attacker' && <span data-effect="dust" className="combat2d-dust" />}
    {target && <>
      {tone === 'dodge' ? <span data-effect="dodge" className="combat2d-escape" />
        : tone === 'block' ? <span data-effect="block" className="combat2d-ring" />
        : <><span data-effect="contact" className="combat2d-flash" /><span data-effect="sparks" className="combat2d-sparks" />{tone === 'crit' && <span data-effect="shockwave" className="combat2d-ring" />}</>}
      {(label || strike.amount !== null) && <span data-effect="label" className="combat2d-label">{tone === 'crit' && <small>{language === 'en' ? 'CRIT!' : 'КРИТ!'}</small>}{label ?? `−${strike.amount}`}</span>}
    </>}
    {won && !role && <span data-effect="victory" className="combat2d-victory" />}
  </div>;
}
