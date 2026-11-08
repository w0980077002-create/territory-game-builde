import { useEffect, useRef, useState } from 'react';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { FighterRig } from './FighterRig';
import { ACTION_MS, jointFrames, motionStops, type FighterMotion, type Joint } from './fighterAnimations';
import type { FighterRigDefinition } from './fighterRigs';
import './combat2d.css';

interface Props {
  rig: FighterRigDefinition;
  name: string;
  dir: 1 | -1;
  alive: boolean;
  won?: boolean;
  strike: StrikeEvent | null;
  speed: number;
  className: string;
  onAssetError: () => void;
}
export function SkeletalFighter({ rig, name, dir, alive, won = false, strike, speed, className, onAssetError }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const terminalRef = useRef<'death' | 'victory' | null>(null);
  const [finishedEvent, setFinishedEvent] = useState<StrikeEvent | null>(null);
  // Avoid zero-duration and overflowing timeouts in embedded Telegram engines.
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? Math.min(8, Math.max(0.1, speed)) : 1;
  const role = strike?.attacker === name ? 'attacker' : strike?.target === name ? 'target' : null;
  // PvP HP snapshots can precede several queued visual hits. Finish those
  // confirmed events and wait for queue retirement before any terminal pose.
  useEffect(() => {
    if (!role || !strike) { setFinishedEvent(null); return; }
    const timer = window.setTimeout(() => setFinishedEvent(strike), ACTION_MS / safeSpeed);
    return () => window.clearTimeout(timer);
  }, [role, strike, safeSpeed]);
  const active = role && strike !== finishedEvent;
  const swing = strike ? Math.abs(strike.key) % 3 : 0;
  const heldTerminal = !alive && terminalRef.current === 'death' ? 'death' : alive && won && terminalRef.current === 'victory' ? 'victory' : null;
  const animationEvent = active && !heldTerminal ? strike : null;
  const critical = Boolean(active && !heldTerminal && strike?.tone === 'crit');
  const motion: FighterMotion = heldTerminal ?? (active
    ? role === 'attacker' ? (['slash', 'thrust', 'overhead'] as const)[swing]
      : strike?.tone === 'block' ? 'block' : strike?.tone === 'dodge' ? 'dodge' : strike?.tone === 'crit' ? 'crit-hit' : 'hit'
    : strike ? 'idle' : !alive ? 'death' : won ? 'victory' : 'idle');
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    terminalRef.current = motion === 'death' || motion === 'victory' ? motion : null;
    if (motion === 'idle') return;

    // Keep the same cutouts and independent pivots even in old Telegram
    // WebViews which do not expose Element.animate() for SVG <g> nodes.
    const joints = Array.from(svg.querySelectorAll<SVGGElement>('[data-rig-part]'));
    let animations: Animation[] = [];
    let fallbackTimers: number[] = [];
    let reduced: MediaQueryList | null = null;
    try {
      if (typeof window.matchMedia === 'function') reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch { /* Old WebViews may throw from matchMedia. */ }
    const clear = () => {
      fallbackTimers.forEach(timer => window.clearTimeout(timer));
      fallbackTimers = [];
      animations.forEach(animation => {
        try { animation.cancel(); } catch { /* Partial SVG animation shims can throw. */ }
      });
      animations = [];
      joints.forEach(joint => {
        joint.style.transition = '';
        joint.style.transform = '';
      });
    };
    const apply = () => {
      clear();
      let reduce = false;
      try { reduce = reduced?.matches === true; } catch { /* Keep motion usable. */ }
      const stops = motionStops(motion, critical);
      joints.forEach(joint => {
        const frames = jointFrames(joint.dataset.rigPart as Joint, stops);
        // Prefer the original continuous keyframes on capable browsers.
        try {
          if (typeof joint.animate === 'function') {
            const last = frames[frames.length - 1];
            const selection = reduce ? [last, last] : frames;
            const animation = joint.animate(selection, {
              duration: reduce ? 1 : ACTION_MS / safeSpeed,
              fill: 'forwards',
            });
            if (animation && typeof animation.cancel === 'function') {
              animations.push(animation);
              return;
            }
          }
        } catch { /* Fall through to CSS-transform choreography. */ }

        // Fallback still articulates shoulders, elbows, knees and weapon:
        // windup -> contact -> recovery. No simulated hit or damage is created.
        if (reduce) {
          joint.style.transform = String(frames[frames.length - 1]?.transform ?? '');
          return;
        }
        joint.style.transition = 'none';
        joint.style.transform = String(frames[0]?.transform ?? '');
        for (let i = 1; i < stops.length; i++) {
          const duration = Math.max(1, (stops[i].at - stops[i - 1].at) / safeSpeed);
          fallbackTimers.push(window.setTimeout(() => {
            joint.style.transition = `transform ${duration}ms cubic-bezier(.25,.6,.3,1)`;
            joint.style.transform = String(frames[i]?.transform ?? '');
          }, Math.max(16, stops[i - 1].at / safeSpeed)));
        }
      });
    };
    apply();
    let listener: 'modern' | 'legacy' | null = null;
    try {
      if (typeof reduced?.addEventListener === 'function') {
        reduced.addEventListener('change', apply);
        listener = 'modern';
      } else if (typeof reduced?.addListener === 'function') {
        reduced.addListener(apply);
        listener = 'legacy';
      }
    } catch { /* A failed listener must not hide the confirmed strike. */ }
    return () => {
      try {
        if (listener === 'modern') reduced?.removeEventListener('change', apply);
        else if (listener === 'legacy') reduced?.removeListener(apply);
      } catch { /* Continue clearing all transient animation state. */ }
      clear();
    };
  }, [motion, animationEvent, safeSpeed, critical, rig.id]);

  return <svg ref={svgRef} viewBox="0 0 512 512" preserveAspectRatio="xMidYMax meet" role="img" aria-label={name}
    data-rig={rig.id} data-motion={motion} data-critical={strike?.tone === 'crit' && active ? 'true' : undefined}
    className={`skeletal-fighter ${className}`} onErrorCapture={onAssetError}>
    <g transform={dir === -1 ? 'translate(512 0) scale(-1 1)' : undefined}>
      <FighterRig rig={rig} />
    </g>
  </svg>;
}
