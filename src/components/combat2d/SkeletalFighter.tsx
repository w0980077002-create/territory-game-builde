import { useEffect, useRef, useState } from 'react';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { FighterRig } from './FighterRig';
import { ACTION_MS, CONTACT_MS, jointFrames, motionStops, type FighterMotion, type Joint } from './fighterAnimations';
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
  const role = strike?.attacker === name ? 'attacker' : strike?.target === name ? 'target' : null;
  // PvP HP snapshots can precede several queued visual hits. Finish those
  // confirmed events and wait for queue retirement before any terminal pose.
  useEffect(() => {
    if (!role || !strike) { setFinishedEvent(null); return; }
    const timer = window.setTimeout(() => setFinishedEvent(strike), ACTION_MS / speed);
    return () => window.clearTimeout(timer);
  }, [role, strike, speed]);
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
    // Some embedded browsers expose matchMedia but throw when evaluating it.
    // Treat that as no preference rather than losing all confirmed hit poses.
    let reduced: MediaQueryList | null = null;
    try {
      if (typeof window.matchMedia === 'function') reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch { reduced = null; }
    let animations: Animation[] = [];
    const apply = () => {
      animations.forEach(a => { try { a.cancel(); } catch { /* Legacy SVG animation teardown may throw. */ } });
      animations = [];
      // A reduced-motion preference change may switch from the legacy inline
      // fallback to Web Animations; clear the stale inline transform first.
      svg.querySelectorAll<SVGGElement>('[data-rig-part]').forEach(joint => { joint.style.transform = ''; });
      // Broken legacy MediaQueryList implementations can throw from matches.\n      let prefersReducedMotion = false;\n      try { prefersReducedMotion = reduced?.matches === true; } catch { /* Keep the confirmed pose visible. */ }\n      const stops = motionStops(motion, critical);
      animations = Array.from(svg.querySelectorAll<SVGGElement>('[data-rig-part]')).flatMap(joint => {
        // Web Animations may be missing on older embedded SVG implementations.
        const frames = jointFrames(joint.dataset.rigPart as Joint, stops);
        // Resolve one consistent visible pose for both unsupported and throwing
        // SVG Web Animations implementations.
        const visibleFrame = prefersReducedMotion || motion === 'death' || motion === 'victory'
          ? frames[frames.length - 1]
          : frames.find((frame, index) => index > 0 && typeof frame.offset === 'number' && frame.offset >= CONTACT_MS / ACTION_MS) ?? frames[frames.length - 1];
        const showLegacyPose = () => { joint.style.transform = String(visibleFrame.transform ?? ''); };
        // Older Telegram WebViews may lack SVG Web Animations entirely.
        // Keep the resolved pose visible instead of silently freezing every joint.
        if (typeof joint.animate !== 'function') {
          // Nonterminal actions recover to idle at the last frame. Hold the
          // contact pose instead, otherwise legacy engines show no reaction.
          // Respect reduced motion even on engines without SVG Web Animations.
          // Showing a contact pose for the entire action would still imply
          // movement when the player has explicitly disabled it.
          showLegacyPose();
          return [];
        }
        // Retain readable final outcome poses without large movement in reduced mode.
        const selected = prefersReducedMotion ? [frames[frames.length - 1], frames[frames.length - 1]] : frames;
        // Some embedded SVG engines expose animate() but throw for SVG groups.
        // Fall back per joint so one unsupported part cannot freeze the whole rig.
        try {
          return [joint.animate(selected, { duration: prefersReducedMotion ? 1 : ACTION_MS / speed, fill: 'forwards' })];
        } catch {
          showLegacyPose();
          return [];
        }
      });
    };
    apply();
    // Some legacy MediaQueryList objects expose listeners but throw on registration.
    // The initial pose is already applied; failure to subscribe must not break combat.
    let listenerKind: 'modern' | 'legacy' | null = null;
    try {
      if (typeof reduced?.addEventListener === 'function') {
        reduced.addEventListener('change', apply);
        listenerKind = 'modern';
      } else if (typeof reduced?.addListener === 'function') {
        reduced.addListener(apply);
        listenerKind = 'legacy';
      }
    } catch {
      // A few embedded engines expose a broken modern listener API while
      // their legacy addListener implementation still works.
      if (listenerKind === null && typeof reduced?.addListener === 'function') {
        try {
          reduced.addListener(apply);
          listenerKind = 'legacy';
        } catch { listenerKind = null; }
      }
    }
    return () => {
      try {
        if (listenerKind === 'modern') reduced?.removeEventListener('change', apply);
        else if (listenerKind === 'legacy') reduced?.removeListener(apply);
      } catch { /* Legacy MediaQueryList teardown must not block rig cleanup. */ }
      animations.forEach(a => { try { a.cancel(); } catch { /* Legacy SVG animation teardown may throw. */ } });
      svg.querySelectorAll<SVGGElement>('[data-rig-part]').forEach(joint => { joint.style.transform = ''; });
    };
  }, [motion, animationEvent, speed, critical, rig.id]);
  return <svg ref={svgRef} viewBox="0 0 512 512" preserveAspectRatio="xMidYMax meet" role="img" aria-label={name}
    data-rig={rig.id} data-motion={motion} data-critical={strike?.tone === 'crit' && active ? 'true' : undefined}
    className={`skeletal-fighter ${className}`} onErrorCapture={onAssetError}>
    <g transform={dir === -1 ? 'translate(512 0) scale(-1 1)' : undefined}>
      <FighterRig rig={rig} />
    </g>
  </svg>;
}
