// Presentation contract of the cave WOW pass. The stage direction may only READ the world:
// same seeded floor with and without it, no gameplay RNG, no extra reach, no replayed finale.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';

async function module(path) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const { StageMemory, cameraKick, deathFlight, killingBlow, PHASE_COLORS } = await module('src/components/pve/cavePreview/stageFx.ts');
const { electricCut, bladeTrail, BLADE_REACH } = await module('src/components/pve/cavePreview/combatVfx.ts');
const { burst, hash } = await module('src/components/pve/cavePreview/kit.ts');
const { createWorld, start, update, choosePortal } = await module('src/game/cavePreviewWorld/engine.ts');

// 1. Cosmetic code never touches gameplay randomness or storage.
const dir = 'src/components/pve/cavePreview';
for (const file of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
  const source = readFileSync(`${dir}/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Math\.random|Date\.now|performance\.now|setTimeout|setInterval/.test(source), `${file}: presentation must run on the simulation/idle clock only`);
  // Only read-only lookups and types may be imported from the engine.
  for (const [, names] of source.matchAll(/import (?!type)\{([^}]+)\} from '[^']*cavePreviewWorld\/engine'/g))
    for (const name of names.split(',').map(n => n.trim()).filter(n => n && !n.startsWith('type ')))
      assert.ok(['portalsFor', 'portalOffset', 'DIFFICULTY'].includes(name), `${file}: presentation must not drive the engine (${name})`);
}

// 2. Same seed, full floor, with and without the stage direction observing every tick.
const strokes = [];
const canvas = { save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() { strokes.push(1); }, fillText() {}, ellipse() {}, drawImage() {} };
function run(directed) {
  let seed = 2026; const saved = Math.random;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try {
    const world = createWorld(); start(world); world.auto = true; world.critChance = 31;
    const memory = new StageMemory(); let portals = 0, shifts = 0, lastShift = -99, kills = 0, flights = 0, idle = 0;
    for (let i = 0; i < 100000 && !['VICTORY', 'DEFEAT'].includes(world.phase); i++) {
      if (world.phase === 'PORTAL_CHOICE') choosePortal(world, portals++ % 3);
      update(world, .025);
      if (!directed) continue;
      const before = JSON.stringify(world);
      memory.observe(world, idle += .016); cameraKick(world, memory, false);
      electricCut(canvas, world, 380, 1, false, 'high'); bladeTrail(canvas, world, undefined, false, 'high');
      for (const e of world.enemies) if (e.hp <= 0 && e.species !== 'boss') { const f = deathFlight(e, world.time, false); assert.ok(f.alpha >= 0 && f.alpha <= 1 && f.size > 0); flights++; }
      for (const f of world.effects) if (f.kind === 'impact' && killingBlow(world, f.born, f.lane) && world.time === f.born) kills++;
      if (memory.phaseAt !== lastShift) { lastShift = memory.phaseAt; shifts++; }
      assert.equal(JSON.stringify(world), before, 'Stage direction is read-only');
    }
    assert.equal(world.phase, 'VICTORY'); assert.equal(portals, 4);
    if (directed) {
      assert.equal(shifts, 2, 'Exactly two phase-change events: 1→2 and 2→3');
      assert.ok(kills > 0 && flights > 0, 'Killing blows and knock-out flights were observed');
      assert.ok(memory.finale, 'The fall of the boss is remembered for the finale');
    }
    return { world, seed };
  } finally { Math.random = saved; }
}
assert.deepEqual(run(true), run(false), 'Identical seeded outcome and RNG stream with the stage direction attached');

// 3. Knock-out flight is over before the engine clears the fallen foe (1.1 s), and still under reduced motion.
const foe = { id: 4, species: 'eel', worldX: 300, hp: 0, maxHp: 100, pose: 'death', poseUntil: 0, ready: 0, impact: 0, deathAt: 10, lane: 1, attacks: 0, heavy: false };
assert.equal(deathFlight(foe, 10.02, false).white > .5, true, 'White smash frame at the instant of the kill');
assert.ok(deathFlight(foe, 10.5, false).dx > 60 && deathFlight(foe, 10.5, false).dy < -60, 'Flies up and away');
assert.equal(deathFlight(foe, 11.05, false).alpha, 0, 'Gone before the engine removes the enemy');
const still = deathFlight(foe, 10.4, true); assert.deepEqual([still.dx, still.dy, still.turn, still.size], [0, 0, 0, 1], 'Reduced motion: fade only');

// 4. The arc is a projection of an ALREADY scheduled hit and only bridges a real gap.
function arcs(setup) {
  const w = createWorld(); start(w); Object.assign(w, { phase: 'FIGHT', time: 5, pose: 'attack', target: 7, heroImpact: 5.05, heroX: 400, cameraX: 200 });
  w.enemies = [{ ...foe, id: 7, hp: 100, pose: 'idle', worldX: 400 + 150, deathAt: 0 }, { ...foe, id: 8, hp: 100, pose: 'idle', worldX: 400 + 155, deathAt: 0 }];
  setup(w); const before = JSON.stringify(w); strokes.length = 0; electricCut(canvas, w, 380, 1, false, 'high');
  assert.equal(JSON.stringify(w), before); return strokes.length;
}
const one = arcs(() => {});
assert.ok(one > 0, 'A pending strike across a gap is carried by the arc');
assert.equal(arcs(w => { w.enemies[0].worldX = w.heroX + BLADE_REACH + 10; }), 0, 'No arc when the blade itself reaches');
assert.equal(arcs(w => { w.heroImpact = 0; }), 0, 'No arc without a scheduled hit');
assert.equal(arcs(w => { w.enemies[0].hp = 0; }), 0, 'No arc to a dead target');
assert.equal(arcs(w => { w.target = 99; }), 0, 'No target search: an unnamed foe is never struck');
assert.equal(arcs(w => { w.heroImpact = 0; w.cleaveImpact = 5.05; w.cleaveTargets = [7, 8]; }), one * 2, 'Cleave draws one arc per already-named target');
assert.equal(arcs(w => { w.heroImpact = 5.4; }), 0, 'The arc belongs to the last instants before contact');

// 5. Memory: reload/fast-forward never replays an event; the finale continues on the idle clock.
{
  const w = createWorld(); start(w); const m = new StageMemory();
  Object.assign(w, { phase: 'BOSS', time: 50, bossPhase: 1 });
  w.enemies = [{ ...foe, id: 1, species: 'boss', hp: 1000, maxHp: 1000, pose: 'idle', deathAt: 0 }];
  m.observe(w, 0); assert.equal(m.phaseAt, -99);
  w.time = 50.03; w.bossPhase = 2; m.observe(w, 0); assert.equal(m.phaseAt, 50.03, 'Phase change stamped on the simulation clock');
  w.time = 50.06; m.observe(w, 0); assert.equal(m.phaseAt, 50.03, 'One event per change');
  w.time = 80; w.bossPhase = 3; m.observe(w, 0); assert.equal(m.phaseAt, -99, 'A jump in time (reload/fast-forward) resynchronises silently');
  w.time = 80.03; w.enemies[0].hp = 0; w.enemies[0].deathAt = 80.03; m.observe(w, 1);
  assert.ok(Math.abs(m.finaleAge(w, 1)) < 1e-9);
  w.time = 81.13; m.observe(w, 1.5); w.phase = 'VICTORY'; w.enemies = []; m.observe(w, 2);
  assert.ok(Math.abs(m.finaleAge(w, 2) - 1.1) < 1e-6, 'Finale age is continuous at the moment the world stops');
  m.observe(w, 3.5); assert.ok(Math.abs(m.finaleAge(w, 3.5) - 2.6) < 1e-6, 'and keeps running on the idle clock');
  assert.ok(Math.abs(m.endedAge(w, 3.5) - 1.5) < 1e-6);
  const restored = new StageMemory(); restored.observe(w, 9);
  assert.equal(restored.finale, null); assert.equal(restored.endedAge(w, 9), 99, 'A restored victory shows the calm ending, not a second explosion');
  const paused = structuredClone(w); cameraKick(paused, restored, true);
}

// 6. Particles are closed-form: the same age always gives the same picture (exact pause).
{
  const record = () => { const calls = []; const c = { globalAlpha: 1, beginPath() {}, moveTo(x, y) { calls.push(x, y); }, lineTo(x, y) { calls.push(x, y); }, arc(x, y, r) { calls.push(x, y, r); }, fill() {}, stroke() {} }; burst(c, 3.3, .2, 100, 100, { n: 8, speed: 200, angle: -1, spread: 2, gravity: 500, life: .5, size: 3, colors: ['#fff'], shape: 'shard' }); return calls; };
  assert.deepEqual(record(), record()); assert.ok(record().length > 0);
  assert.equal(hash(12.5), hash(12.5)); assert.equal(PHASE_COLORS.length, 3);
}
console.log('PASS cave WOW contract: no gameplay RNG/timers in presentation, read-only direction over a seeded full floor, two phase events, knock-out flight timing, arc only for scheduled hits across a real gap, silent resync and idle-clock finale, closed-form particles.');
