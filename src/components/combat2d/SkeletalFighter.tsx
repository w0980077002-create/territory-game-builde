import { useEffect, useRef, useState } from 'react';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { FighterRig } from './FighterRig';
import { plantedLegFrames } from './plantedFrames';
import { ACTION_MS, chooseMotion, jointFrames, motionStops, type Joint } from './fighterAnimations';
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
  const previousPose = useRef(new Map<Joint, string>());
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
  const motion = chooseMotion({ heldTerminal, active: Boolean(active), role, tone: strike?.tone, swing, queued: Boolean(strike), alive, won });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    terminalRef.current = motion === 'death' || motion === 'victory' ? motion : null;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animations: Animation[] = [];
    const apply = () => {
      animations.forEach(a => a.cancel());
      const stops = motionStops(motion, critical, rig.id);
      const legs = motion === 'slash' || motion === 'thrust' || motion === 'overhead' ? plantedLegFrames(stops, rig, previousPose.current) : {};
      animations = Array.from(svg.querySelectorAll<SVGGElement>('[data-rig-part]')).map(joint => {
        const part = joint.dataset.rigPart as Joint;
        const frames = legs[part] ?? jointFrames(part, stops);
        const previous = previousPose.current.get(part);
        const withStart = previous ? [{ ...frames[0], transform: previous }, ...frames.slice(1)] : frames;
        // Blend interrupted movement back to rest, then let the idle cycle resume.
        const blend = motion === 'idle' ? [{ transform: previous ?? frames[0].transform }, { transform: frames[frames.length - 1].transform }] : withStart;
        const selected = reduced.matches ? [blend[blend.length - 1], blend[blend.length - 1]] : blend;
        return joint.animate(selected, { duration: reduced.matches ? 1 : motion === 'idle' ? 120 / speed : ACTION_MS / speed, fill: motion === 'idle' ? 'none' : 'forwards' });
      });
    };
    apply();
    reduced.addEventListener('change', apply);
    return () => {
      reduced.removeEventListener('change', apply);
      for (const joint of svg.querySelectorAll<SVGGElement>('[data-rig-part]')) {
        previousPose.current.set(joint.dataset.rigPart as Joint, getComputedStyle(joint).transform);
      }
      animations.forEach(a => a.cancel());
    };
  }, [motion, animationKey, speed, critical, rig.id]);
  return <svg ref={svgRef} viewBox="0 0 512 512" preserveAspectRatio="xMidYMax meet" role="img" aria-label={name}
    data-rig={rig.id} data-motion={motion} data-critical={strike?.tone === 'crit' && active ? 'true' : undefined}
    className={`skeletal-fighter ${className}`} onErrorCapture={onAssetError}>
    <g transform={dir === -1 ? 'translate(512 0) scale(-1 1)' : undefined}>
      <FighterRig rig={rig} />
    </g>
  </svg>;
}
