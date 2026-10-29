/** Geometry is local to the SVG rig and independent of combat outcomes. */
export interface Point { x: number; y: number }
export interface LegSolution { hip: number; knee: number; reachable: boolean }

/** Solve a two-link leg with SVG angles (zero points down, positive rotates clockwise).
 * Unreachable targets are reported to the caller; clamped angles are only a safe
 * numerical fallback and must not be mistaken for a planted foot. */
export function solveLeg(hip: Point, foot: Point, upper: number, lower: number, bend: 1 | -1): LegSolution {
  if (!(upper > 0 && lower > 0) || ![hip.x, hip.y, foot.x, foot.y, upper, lower].every(Number.isFinite)) {
    throw new RangeError('Invalid leg geometry');
  }
  const dx = foot.x - hip.x, dy = foot.y - hip.y;
  const distance = Math.hypot(dx, dy);
  const reachable = distance <= upper + lower && distance >= Math.abs(upper - lower) && distance > 1e-8;
  const cosKnee = Math.max(-1, Math.min(1, (distance * distance - upper * upper - lower * lower) / (2 * upper * lower)));
  const knee = bend * Math.acos(cosKnee);
  const hipAngle = Math.atan2(-dx, dy) - Math.atan2(lower * Math.sin(knee), upper + lower * Math.cos(knee));
  return { hip: hipAngle * 180 / Math.PI, knee: knee * 180 / Math.PI, reachable };
}

/** Screen-space coordinates from the actual animated SVG hierarchy. */
export function screenPoint(element: SVGGraphicsElement, point: Point): Point | null {
  const matrix = element.getScreenCTM();
  if (!matrix) return null;
  const p = new DOMPoint(point.x, point.y).matrixTransform(matrix);
  return Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
}
