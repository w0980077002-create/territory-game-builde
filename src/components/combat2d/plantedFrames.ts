import { solveLeg, type Point } from './combatGeometry';
import { ACTION_MS, type Joint, type PoseStop } from './fighterAnimations';
import type { FighterRigDefinition } from './fighterRigs';

/** Coordinates use the actual hip and knee wrappers in FighterRig. The sole
 * points are per-design estimates of the middle of the boot's ground edge. */
const SOLE_X = { left: 0, right: 0 } as const;
const HIP_ANGLES = { left: 9, right: -9 } as const;
const radians = (degrees: number) => degrees * Math.PI / 180;
function ease(progress: number) {
  // Match cubic-bezier(.25,.6,.3,1) on each existing WAAPI segment.
  let low = 0, high = 1;
  for (let i = 0; i < 20; i++) {
    const t = (low + high) / 2, u = 1 - t;
    const x = 3*u*u*t*.25 + 3*u*t*t*.3 + t*t*t;
    if (x < progress) low = t; else high = t;
  }
  const t = (low + high) / 2, u = 1 - t;
  return 3*u*u*t*.6 + 3*u*t*t + t*t*t;
}
function rootAt(stops: PoseStop[], ms: number): Point {
  const next = Math.max(1, stops.findIndex(stop => stop.at >= ms));
  const a = stops[next - 1], b = stops[next];
  const read = (stop: PoseStop) => {
    const match = /translate\(([-.\d]+)px, ([-.\d]+)px\)/.exec(stop.pose.root ?? '');
    return { x: Number(match?.[1] ?? 0), y: Number(match?.[2] ?? 0) };
  };
  const from = read(a), to = read(b), f = ease((ms - a.at) / (b.at - a.at));
  return { x: from.x + (to.x - from.x)*f, y: from.y + (to.y - from.y)*f };
}
function standingFoot(side: 'left' | 'right', sole: Point, hip: number, upper: number): Point {
  const angle = radians(HIP_ANGLES[side]);
  return { x: hip + sole.x*Math.cos(angle) - (upper + sole.y)*Math.sin(angle),
    y: sole.x*Math.sin(angle) + (upper + sole.y)*Math.cos(angle) };
}
/** Precompute the two-link solution at 10ms intervals. Both legs return to
 * their original footing; the rear boot stays planted while the front steps. */
export function plantedLegFrames(stops: PoseStop[], rig: FighterRigDefinition, previous?: Map<Joint, string>): Partial<Record<Joint, Keyframe[]>> {
  const output: Partial<Record<Joint, Keyframe[]>> = { root: [], 'leg-left': [], 'knee-left': [], 'ankle-left': [], 'leg-right': [], 'knee-right': [], 'ankle-right': [] };
  const { upper, lower, footDepth, leftHip, rightHip } = rig.legs;
  const hips = { left: leftHip, right: rightHip };
  const soles = { left: { x: SOLE_X.left, y: footDepth }, right: { x: SOLE_X.right, y: footDepth } };
  const shinLength = lower - footDepth;
  const poseMatrix = (part: Joint) => {
    try { return new DOMMatrix(previous?.get(part) || undefined); } catch { return new DOMMatrix(); }
  };
  const initialRoot = poseMatrix('root');
  const interpolated = previous?.has('root') ? [{ ...stops[0], pose: { ...stops[0].pose, root: `translate(${initialRoot.e}px, ${initialRoot.f}px) rotate(0deg)` } }, ...stops.slice(1)] : stops;
  const initialFoot = (side: 'left' | 'right') => {
    if (!previous?.has(`leg-${side}`) || !previous.has(`knee-${side}`)) { const point = standingFoot(side, { x: 0, y: shinLength }, hips[side], upper); return { x: point.x, y: point.y + footDepth }; }
    const ankle = poseMatrix(`ankle-${side}`), shin = poseMatrix(`knee-${side}`), thigh = poseMatrix(`leg-${side}`);
    const boot = new DOMPoint(soles[side].x, soles[side].y).matrixTransform(ankle);
    const p = new DOMPoint(boot.x, boot.y + shinLength).matrixTransform(shin);
    const q = new DOMPoint(p.x, p.y + upper).matrixTransform(thigh);
    const world = new DOMPoint(q.x + hips[side], q.y).matrixTransform(initialRoot);
    return { x: world.x, y: world.y };
  };
  const feet = { left: initialFoot('left'), right: initialFoot('right') };
  const bendFor = (side: 'left' | 'right'): 1 | -1 => {
    const matrix = poseMatrix(`knee-${side}`);
    const angle = Math.atan2(matrix.b, matrix.a);
    return Math.abs(angle) > .01 ? (angle > 0 ? 1 : -1) : (side === 'left' ? 1 : -1);
  };
  const bends = { left: bendFor('left'), right: bendFor('right') };
  for (let ms = 0; ms <= ACTION_MS; ms += 10) {
    const root = rootAt(interpolated, ms);
    const targets = { left: { ...feet.left }, right: { ...feet.right } };
    const phase = ms < 160 ? 0 : ms <= 350 ? (ms - 160) / 190 : ms <= 600 ? 1 - (ms - 350) / 250 : 0;
    targets.right.x += 38 * phase;
    if (ms >= 160 && ms <= 350) targets.right.y -= 11 * Math.sin(Math.PI * phase);
    if (ms > 350 && ms < 600) targets.right.y -= 7 * Math.sin(Math.PI * phase);
    // Restrict the pelvis to the intersection of the legs' reachable discs.
    // Projecting both constraints prevents IK from silently stretching a limb.
    for (let iteration = 0; iteration < 12; iteration++) {
      for (const side of ['left', 'right'] as const) {
        const centerX = targets[side].x - hips[side], centerY = targets[side].y - footDepth;
        const dx = root.x - centerX, dy = root.y - centerY;
        const distance = Math.hypot(dx, dy), reach = upper + shinLength - .0001;
        if (distance > reach) {
          root.x = centerX + dx * reach / distance;
          root.y = centerY + dy * reach / distance;
        }
      }
    }
    output.root!.push({ offset: ms / ACTION_MS, transform: `translate(${root.x}px, ${root.y}px) rotate(0deg)`, easing: 'linear' });
    for (const side of ['left', 'right'] as const) {
      const solution = solveLeg({ x: hips[side] + root.x, y: root.y }, { x: targets[side].x, y: targets[side].y - footDepth }, upper, shinLength, bends[side]);
      if (!solution.reachable) return {};
      output[`leg-${side}`]!.push({ offset: ms / ACTION_MS, transform: `rotate(${solution.hip}deg)`, easing: 'linear' });
      output[`knee-${side}`]!.push({ offset: ms / ACTION_MS, transform: `rotate(${solution.knee}deg)`, easing: 'linear' });
      output[`ankle-${side}`]!.push({ offset: ms / ACTION_MS, transform: `rotate(${-solution.hip - solution.knee}deg)`, easing: 'linear' });
    }
  }
  return output;
}
