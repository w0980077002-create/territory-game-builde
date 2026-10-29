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
  const [finishedKey, setFinishedKey] = useState<number | null>(null);
  const role = strike?.attacker === name ? 'attacker' : strike?.target === name ? 'target' : null;
  const key = role ? strike?.key : null;
  // PvP HP snapshots can precede several queued visual hits. Finish those
  // confirmed events and wait for queue retirement before any terminal pose.
  useEffect(() => {
    if (key == null) return;
    const timer = window.setTimeout(() => setFinishedKey(key ?? null), ACTION_MS / speed);
    return () => window.clearTimeout(timer);
  }, [key, speed]);
  const active = role && key !== finishedKey;
  const swing = strike ? Math.abs(strike.key) % 3 : 0;
  const heldTerminal = !alive && terminalRef.current === 'death' ? 'death' : alive && won && terminalRef.current === 'victory' ? 'victory' : null;
  const animationKey = active && !heldTerminal ? key : null;
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
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animations: Animation[] = [];
    const apply = () => {
      animations.forEach(a => a.cancel());
      const stops = motionStops(motion, critical);
      animations = Array.from(svg.querySelectorAll<SVGGElement>('[data-rig-part]')).map(joint => {
        const frames = jointFrames(joint.dataset.rigPart as Joint, stops);
        // Retain readable final outcome poses without large movement in reduced mode.
        const selected = reduced.matches ? [frames[frames.length - 1], frames[frames.length - 1]] : frames;
        return joint.animate(selected, { duration: reduced.matches ? 1 : ACTION_MS / speed, fill: 'forwards' });
      });
    };
    apply();
    reduced.addEventListener('change', apply);
    return () => { reduced.removeEventListener('change', apply); animations.forEach(a => a.cancel()); };
  }, [motion, animationKey, speed, critical]);
  return <svg ref={svgRef} viewBox="0 0 512 512" preserveAspectRatio="xMidYMax meet" role="img" aria-label={name}
    data-rig={rig.id} data-motion={motion} data-critical={strike?.tone === 'crit' && active ? 'true' : undefined}
    className={`skeletal-fighter ${className}`} onErrorCapture={onAssetError}>
    <g transform={dir === -1 ? 'translate(512 0) scale(-1 1)' : undefined}>
      <FighterRig rig={rig} />
    </g>
  </svg>;
}
