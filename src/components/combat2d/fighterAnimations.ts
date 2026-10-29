/** Cosmetic presentation of an already-resolved strike. All joints are local:
 * positive x faces the opponent. Contact is the existing PvE 350ms boundary. */
export const CONTACT_MS = 350;
export const ACTION_MS = 810;
export type FighterMotion = 'idle' | 'slash' | 'thrust' | 'overhead' | 'block' | 'dodge' | 'hit' | 'crit-hit' | 'victory' | 'death';
/** Outcome poses have priority over late events. Confirmed queue entries play
 * before a new outcome pose; retirement is required before entering it. */
export function chooseMotion(options: {
  heldTerminal: 'death' | 'victory' | null;
  active: boolean;
  role: 'attacker' | 'target' | null;
  tone?: 'hit' | 'crit' | 'block' | 'dodge';
  swing: number;
  queued: boolean;
  alive: boolean;
  won: boolean;
}): FighterMotion {
  if (options.heldTerminal) return options.heldTerminal;
  if (options.active && options.role === 'attacker') return (['slash', 'thrust', 'overhead'] as const)[options.swing % 3];
  if (options.active && options.role === 'target') return options.tone === 'block' ? 'block' : options.tone === 'dodge' ? 'dodge' : options.tone === 'crit' ? 'crit-hit' : 'hit';
  return options.queued ? 'idle' : !options.alive ? 'death' : options.won ? 'victory' : 'idle';
}
export type Joint = 'root' | 'torso' | 'head' | 'arm-right' | 'forearm-right' | 'weapon' | 'arm-left' | 'forearm-left' | 'shield' | 'leg-right' | 'leg-left' | 'knee-right' | 'knee-left' | 'ankle-right' | 'ankle-left' | 'hair';
type Pose = Partial<Record<Joint, string>>;
export interface PoseStop { at: number; pose: Pose }
const r = (angle: number) => `rotate(${angle}deg)`;
const t = (x: number, y: number, angle = 0) => `translate(${x}px, ${y}px) rotate(${angle}deg)`;
const REST: Pose = {
  root: t(0, 0), torso: r(0), head: r(0), 'arm-right': r(-48), 'forearm-right': r(-44), weapon: r(117),
  'arm-left': r(35), 'forearm-left': r(5), shield: r(-40), 'leg-right': r(-9), 'leg-left': r(9), 'knee-right': r(0), 'knee-left': r(0), 'ankle-right': r(9), 'ankle-left': r(-9), hair: r(0),
};
// Every action explicitly settles all joints. No frame-rate React updates.
const stop = (at: number, pose: Pose = {}): PoseStop => {
  const knees: Pose = {};
  // Counter-rotate each shin as its hip opens, retaining a planted boot during
  // crouch and lunge. The fur cuff and knee plate cover the overlapping joint.
  for (const side of ['left', 'right'] as const) {
    const hip = pose[`leg-${side}`];
    if (hip) knees[`knee-${side}`] = r(-(Number.parseFloat(hip.slice(7)) - (side === 'left' ? 9 : -9)) * .7);
  }
  const result = { ...REST, ...knees, ...pose };
  for (const side of ['left', 'right'] as const) {
    const hip = Number.parseFloat(result[`leg-${side}`]!.slice(7));
    const knee = Number.parseFloat(result[`knee-${side}`]!.slice(7));
    result[`ankle-${side}`] = r(-hip - knee);
  }
  return { at, pose: result };

};
const attacks: Record<'slash' | 'thrust' | 'overhead', PoseStop[]> = {
  slash: [stop(0), stop(160, { root: t(-5, 12), torso: r(-9), head: r(5), 'arm-right': r(55), 'forearm-right': r(-115), weapon: r(0), 'arm-left': r(12), 'leg-right': r(-24), 'leg-left': r(23) }),
    stop(CONTACT_MS, { root: t(25, 20), torso: r(15), head: r(-9), 'arm-right': r(-85), 'forearm-right': r(-10), weapon: r(180), 'arm-left': r(8), 'leg-right': r(-30), 'leg-left': r(24), hair: r(-10) }),
    stop(470, { root: t(15, 10), torso: r(10), 'arm-right': r(-110), 'forearm-right': r(25), weapon: r(235), 'leg-right': r(-24), 'leg-left': r(20) }), stop(600, { root: t(4, 3), torso: r(2), 'arm-right': r(-55), 'forearm-right': r(-38) }), stop(ACTION_MS)],
  thrust: [stop(0), stop(175, { root: t(-7, 12), torso: r(-5), 'arm-right': r(6), 'forearm-right': r(-105), weapon: r(189), 'leg-left': r(22), 'leg-right': r(-19) }),
    stop(CONTACT_MS, { root: t(32, 24), torso: r(19), head: r(-12), 'arm-right': r(-74), 'forearm-right': r(-12), weapon: r(157), 'leg-right': r(-36), 'leg-left': r(29), 'arm-left': r(8) }),
    stop(450, { root: t(18, 12), torso: r(14), 'arm-right': r(-70), 'forearm-right': r(-22), weapon: r(168), 'leg-right': r(-29), 'leg-left': r(25) }), stop(600, { root: t(4, 3), torso: r(3), 'arm-right': r(-54), 'forearm-right': r(-40) }), stop(ACTION_MS)],
  overhead: [stop(0), stop(210, { root: t(-4, 12), torso: r(-12), head: r(-7), 'arm-right': r(154), 'forearm-right': r(56), weapon: r(205), 'arm-left': r(-32), 'leg-right': r(-24), 'leg-left': r(25) }),
    stop(CONTACT_MS, { root: t(23, 24), torso: r(20), head: r(-12), 'arm-right': r(-78), 'forearm-right': r(-4), weapon: r(160), 'arm-left': r(-20), 'leg-right': r(-31), 'leg-left': r(30), hair: r(-16) }),
    stop(490, { root: t(15, 12), torso: r(14), 'arm-right': r(-105), 'forearm-right': r(12), weapon: r(235), 'leg-right': r(-24), 'leg-left': r(22) }), stop(600, { root: t(4, 3), torso: r(3), 'arm-right': r(-56), 'forearm-right': r(-38) }), stop(ACTION_MS)],
};
export function motionStops(motion: FighterMotion, critical = false, rig: 'male_viking' | 'goblin' = 'male_viking', direction: 1 | -1 = 1): PoseStop[] {
  if (motion === 'slash' || motion === 'thrust' || motion === 'overhead') {
    // The goblin's curved blade has a different edge than the Viking sword.
    // Aim its contact pose slightly upward while retaining the same body action.
    const adjustment = rig === 'goblin' ? -30 : direction === -1 && motion === 'overhead' ? -20 : 0;
    const stops = adjustment ? attacks[motion].map(s => s.at === CONTACT_MS
      ? { ...s, pose: { ...s.pose, weapon: r(Number.parseFloat(s.pose.weapon!.slice(7)) + adjustment) } }
      : s) : attacks[motion];
    if (!critical) return stops;
    return stops.map((s, index) => index === 1 ? { ...s, pose: { ...s.pose, root: t(-7, 12), torso: r(-16), 'arm-right': r(motion === 'overhead' ? 165 : 66) } } : s);
  }
  if (motion === 'block') return [stop(0), stop(240, { root: t(-5, 7), torso: r(-5), 'arm-left': r(-50), 'forearm-left': r(-58), shield: r(108), 'leg-right': r(-18), 'leg-left': r(20) }),
    stop(CONTACT_MS, { root: t(-12, 10), torso: r(-10), head: r(5), 'arm-left': r(-40), 'forearm-left': r(-65), shield: r(101), 'leg-right': r(-21), 'leg-left': r(24) }), stop(500, { root: t(-6, 7), 'arm-left': r(-48), 'forearm-left': r(-57), shield: r(105), 'leg-right': r(-18), 'leg-left': r(20) }), stop(ACTION_MS)];
  if (motion === 'dodge') return [stop(0), stop(180), stop(CONTACT_MS, { root: t(-56, 26), torso: r(24), head: r(-17), 'arm-right': r(-25), 'forearm-right': r(-75), 'arm-left': r(12), 'leg-right': r(-38), 'leg-left': r(32), hair: r(18) }), stop(510, { root: t(-42, 20), torso: r(16), 'leg-right': r(-26), 'leg-left': r(30) }), stop(ACTION_MS)];
  if (motion === 'hit' || motion === 'crit-hit') {
    const n = motion === 'crit-hit' ? 1.6 : 1;
    return [stop(0), stop(CONTACT_MS - 1), stop(410, { root: t(-18 * n, 5), torso: r(-13 * n), head: r(-12 * n), 'arm-right': r(-24), 'forearm-right': r(-24), 'arm-left': r(8), 'leg-right': r(-21), 'leg-left': r(22), hair: r(18) }), stop(590, { root: t(-8, 3), torso: r(-5), head: r(5), 'leg-right': r(-14), 'leg-left': r(15) }), stop(ACTION_MS)];
  }
  if (motion === 'victory') return [stop(0), stop(400, { torso: r(-5), head: r(-7), 'arm-right': r(145), 'forearm-right': r(90), weapon: r(-175), 'arm-left': r(0), 'leg-right': r(-15), 'leg-left': r(15) }), stop(ACTION_MS, { torso: r(-3), head: r(-5), 'arm-right': r(140), 'forearm-right': r(90), weapon: r(-170), 'leg-right': r(-12), 'leg-left': r(13) })];
  if (motion === 'death') return [stop(0), stop(260, { root: t(-12, 28), torso: r(-16), head: r(20), 'arm-right': r(-10), 'forearm-right': r(-12), 'arm-left': r(18), 'leg-right': r(-34), 'leg-left': r(38) }), stop(ACTION_MS, { root: t(-18, 65), torso: r(26), head: r(23), 'arm-right': r(-12), 'forearm-right': r(30), weapon: r(25), 'arm-left': r(-15), 'leg-right': r(-65), 'leg-left': r(62), hair: r(12) })];
  return [stop(0), stop(ACTION_MS)];
}
export function jointFrames(joint: Joint, stops: PoseStop[]): Keyframe[] {
  return stops.map(({ at, pose }) => ({ offset: at / ACTION_MS, transform: pose[joint] ?? REST[joint], easing: 'cubic-bezier(.25,.6,.3,1)' }));
}
