import { createWorld, type World } from './engine';

export const CAVE_CHECKPOINT_KEY = 'territory_cave_playtest_checkpoint_v1';
type Checkpoint = { version: 1; runId: string; world: World };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 10_000_000;
const poses = ['idle', 'run', 'attack', 'hit', 'block', 'dodge', 'death'];
const phases = ['LOBBY', 'ENTER', 'RUN_RIGHT', 'WAVE_SPAWN', 'APPROACH', 'FIGHT', 'CLEAR', 'PORTAL_CHOICE', 'PORTAL_ENTER', 'NEXT_ROOM', 'BOSS', 'VICTORY', 'DEFEAT'];
export function decodeCheckpoint(raw: string): Checkpoint | null {
  try {
    if (raw.length > 100_000) return null;
    const data: unknown = JSON.parse(raw);
    if (!record(data) || data.version !== 1 || typeof data.runId !== 'string' || !/^[\w-]{1,80}$/.test(data.runId) || !record(data.world)) return null;
    const w = data.world, template = createWorld();
    if (!('rules' in w)) Object.assign(w, {rules: 1, floor: 1, unlockedFloor: 1, stars: []});
    if (![1,2].includes(Number(w.rules)) || !Number.isInteger(w.floor) || !Number.isInteger(w.unlockedFloor) || Number(w.floor)<1 || Number(w.floor)>Number(w.unlockedFloor) || Number(w.unlockedFloor)>100 || !Array.isArray(w.stars) || w.stars.length>4 || !w.stars.every(n=>[1,2,3].includes(n))) return null;
    // Earlier playtest checkpoints predate cosmetic wings and the test rank.
    if (!('wings' in w)) w.wings = 'none';
    if (!('honorBonus' in w)) w.honorBonus = 0;
    if (!('critChance' in w)) w.critChance = 0;
    if (!('critDamage' in w)) w.critDamage = 50;
    for (const [key, value] of Object.entries(template)) {
      if (!(key in w) || (typeof value === 'number' && !finite(w[key]))
        || (typeof value === 'boolean' && typeof w[key] !== 'boolean')) return null;
    }
    if (Number(w.critChance) < 0 || Number(w.critChance) > 100 || Number(w.critDamage) < 0 || Number(w.critDamage) > 10000) return null;
    if (!['none','astral','ember'].includes(String(w.wings)) || !phases.includes(String(w.phase)) || !poses.includes(String(w.pose)) || ![1, 2].includes(Number(w.speed))
      || !Number.isInteger(w.room) || Number(w.room) < 0 || Number(w.room) > (w.rules === 2 ? 3 : 2)
      || Number(w.maxHp) < 900 || Number(w.maxHp) > 1_000_000 || Number(w.hp) < 0 || Number(w.hp) > Number(w.maxHp) || Number(w.energy) < 0 || Number(w.energy) > 100
      || Number(w.time) < 0 || Number(w.time) > 86400 || Number(w.heroV) < 0 || Number(w.heroV) > 400 || Number(w.roomX) < 0 || Number(w.heroX) < Number(w.roomX) || Number(w.cameraX) < 0 || (w.selected !== null && w.selected !== 0 && w.selected !== 1 && !(w.rules === 2 && w.selected === 2))) return null;
    if (w.rules === 2 && (Number(w.wave) < 0 || Number(w.wave) > 4 || !Number.isInteger(w.wave) || (w.stars.length && Number(w.room) !== w.stars.length - 1))) return null;
    if (w.rules === 2 && w.phase === 'VICTORY' && (w.stars.length !== 4 || !w.bossSpawned || Number(w.kills) !== w.stars.reduce((sum, n) => Number(sum) + 8 + Number(n), 1))) return null;
    const biomes = ['crystal', 'spore', 'ember', 'astral', 'forge'];
    if (!biomes.includes(String(w.biome)) || !Array.isArray(w.route) || w.route.length !== Number(w.room) + 1
      || !w.route.every(b => biomes.includes(b)) || w.route[w.route.length - 1] !== w.biome) return null;
    for (const key of ['followerReady', 'followerX', 'followerHp', 'followerUntil', 'followerImpact', 'followerTarget', 'followerV', 'followerStride'])
      if (!Array.isArray(w[key]) || w[key].length !== 2 || !w[key].every(finite)) return null;
    if (!Array.isArray(w.followerPose) || w.followerPose.length !== 2 || !w.followerPose.every(p => poses.includes(p))) return null;
    const cooldown = w.cooldown;
    if (!record(cooldown) || !['cleave', 'ward', 'heal', 'dodge'].every(key => finite(cooldown[key]))) return null;
    if (!Array.isArray(w.cleaveTargets) || w.cleaveTargets.length > 30 || !w.cleaveTargets.every(finite)) return null;
    const used = w.beltUsed;
    if (!Array.isArray(w.belt) || !Array.isArray(used) || w.belt.length !== 7 || used.length !== 7
      || !w.belt.every((n, i) => Number.isInteger(n) && n >= 0 && n <= 5 && Number.isInteger(used[i]) && n + Number(used[i]) === 5)) return null;
    if (!Array.isArray(w.enemies) || w.enemies.length > 30 || !w.enemies.every(e => record(e)
      && ['shardling', 'moth', 'eel', 'boss'].includes(String(e.species)) && poses.includes(String(e.pose))
      && ['id', 'worldX', 'hp', 'maxHp', 'poseUntil', 'ready', 'impact', 'deathAt', 'lane', 'attacks'].every(key => finite(e[key]))
      && Number(e.hp) >= 0 && Number(e.hp) <= Number(e.maxHp) && Number(e.maxHp) > 0 && typeof e.heavy === 'boolean')) return null;
    if (!Array.isArray(w.effects) || w.effects.length > 256 || !w.effects.every(e => record(e)
      && finite(e.x) && finite(e.lane) && finite(e.born) && typeof e.text === 'string' && e.text.length < 120
      && ['hit', 'block', 'heal', 'slash', 'shock', 'energy', 'dodge', 'impact'].includes(String(e.kind)))) return null;
    return data as unknown as Checkpoint;
  } catch { return null; }
}
/** Account-owned checkpoint when integrated; no accidental cross-account cave continuation. */
export const caveCheckpointKey = (userId?: string) => userId ? CAVE_CHECKPOINT_KEY + ':' + userId : CAVE_CHECKPOINT_KEY;
export function readCheckpoint(userId?: string): Checkpoint | null {
  try {
    const raw = localStorage.getItem(caveCheckpointKey(userId)), saved = raw ? decodeCheckpoint(raw) : null;
    if (saved && !['LOBBY', 'VICTORY', 'DEFEAT'].includes(saved.world.phase)) saved.world.paused = true;
    return saved;
  } catch { return null; }
}
export function saveCheckpoint(world: World, runId: string, userId?: string): boolean {
  try { localStorage.setItem(caveCheckpointKey(userId), JSON.stringify({ version: 1, runId, world })); return true; }
  catch { return false; }
}
