import { useEffect, useRef, useState } from 'react';
import { bladeContact } from './combatGeometry';
import { CONTACT_MS } from './fighterAnimations';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { useLanguage } from '@/game/i18n';

/** Short, bounded effects. This component cannot emit combat events or damage. */
export function CombatEffects({ strike, role, won = false, speed = 1 }: { strike: StrikeEvent | null; role: 'attacker' | 'target' | null; won?: boolean; speed?: number }) {
  const effectRef = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    const node = effectRef.current;
    if (!node) return;
    delete node.dataset.contact;
    if (!strike || role !== 'target' || strike.tone === 'dodge') return;
    const scene = node.closest('[data-combat-scene]');
    if (!scene) return;
    const rigs = Array.from(scene.querySelectorAll<SVGSVGElement>('svg[data-rig]'));
    const attacker = rigs.find(svg => svg.getAttribute('aria-label') === strike.attacker);
    const target = rigs.find(svg => svg.getAttribute('aria-label') === strike.target);
    const blade = attacker?.querySelector<SVGPathElement>('[data-anchor="weapon-edge"]');
    const hitArea = target?.querySelector<SVGEllipseElement>(strike.tone === 'block' ? '[data-anchor="shield-hit-area"]' : '[data-anchor="torso-hit-area"]');
    // Unrigged characters retain their existing effects and geometry.
    if (!blade || !hitArea) return;
    node.dataset.contact = 'pending';
    let impact: HTMLDivElement | undefined;
    let removalTimer: number | undefined;
    const timer = window.setTimeout(() => {
      const contact = bladeContact(blade, hitArea);
      const bounds = scene.getBoundingClientRect();
      if (!contact || contact.distance > 12 || !bounds.width || !bounds.height) return;
      const element = scene as HTMLElement;
      // Screen coordinates are converted into the shared scene's local coordinates.
      const x = (contact.point.x - bounds.left) * element.offsetWidth / bounds.width - element.clientLeft;
      const y = (contact.point.y - bounds.top) * element.offsetHeight / bounds.height - element.clientTop;
      impact = document.createElement('div');
      impact.className = `combat2d-scene-impact combat2d-scene-impact--${strike.tone}`;
      impact.dataset.contactEffect = strike.tone;
      impact.style.left = `${x}px`;
      impact.style.top = `${y}px`;
      impact.style.setProperty('--impact-duration', `${470 / speed}ms`);
      const flash = document.createElement('span');
      flash.className = strike.tone === 'block' ? 'combat2d-scene-ring' : 'combat2d-scene-flash';
      impact.append(flash);
      if (strike.tone !== 'block' && node.dataset.quality !== 'low') {
        const sparks = document.createElement('span');
        sparks.className = 'combat2d-scene-sparks';
        impact.append(sparks);
        if (strike.tone === 'crit') {
          const wave = document.createElement('span');
          wave.className = 'combat2d-scene-ring';
          impact.append(wave);
        }
      }
      element.append(impact);
      node.dataset.contact = 'ready';
      removalTimer = window.setTimeout(() => impact?.remove(), 470 / speed);
    }, CONTACT_MS / speed);
    return () => { window.clearTimeout(timer); if (removalTimer !== undefined) window.clearTimeout(removalTimer); impact?.remove(); };
  }, [role, strike, speed]);
  const tone = strike?.tone;
  const target = role === 'target' && strike;
  const label = tone === 'dodge' ? (language === 'en' ? 'DODGE!' : 'УКЛОН!') : tone === 'block' ? (language === 'en' ? 'BLOCK!' : 'БЛОК!') : null;
  return <div ref={effectRef} key={strike && role ? `${strike.key}-${role}` : won ? 'victory' : 'idle'}
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
