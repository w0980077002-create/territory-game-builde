import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';

const source = readFileSync('src/game/trialGauntlet.ts', 'utf8');
const js = await transform(source, { loader: 'ts', format: 'esm' });
const { buildTrialGauntlet, TRIAL_REGULAR_ENEMIES, TRIAL_ENCOUNTERS_PER_FLOOR } =
  await import('data:text/javascript;base64,' + Buffer.from(js.code).toString('base64'));

assert.equal(TRIAL_REGULAR_ENEMIES, 5);
assert.equal(TRIAL_ENCOUNTERS_PER_FLOOR, 6);
const hero = { name: 'Tester', hp: 2179, maxHp: 2179, attack: 790, defense: 447 };
for (const floor of [1, 2, 9, 10, 11, 100, 649, 3000]) {
  const guardian = {
    id: `trial_${floor}`,
    name: 'Страж испытаний',
    art: '/assets/territory/characters/bosses/barrow_guardian/idle.webp',
    hp: floor * 300 + 180,
    maxHp: floor * 300 + 180,
    attack: floor * 20 + 180,
    defense: floor * 12 + 150,
    isBoss: true,
    rewardGold: 12,
    rewardXp: 34,
  };
  const waves = buildTrialGauntlet(guardian, hero);
  assert.equal(waves.length, 6, `floor ${floor}: five normal enemies + boss`);
  assert.deepEqual(waves.map(w => w.isBoss), [false, false, false, false, false, true]);
  assert.equal(waves[5].name, guardian.name, `floor ${floor}: final guardian must be the boss`);
  assert.equal(new Set(waves.map(w => w.id)).size, 6, `floor ${floor}: distinct wave identities`);
  assert.ok(waves.every(w => Number.isFinite(w.maxHp) && w.maxHp > 0 && w.attack > 0));
  assert.ok(waves.every(w => w.rewardGold === 0 && w.rewardXp === 0),
    `floor ${floor}: no extra per-enemy rewards`);
  assert.ok(waves.every(w => w.id.startsWith(`trial_${floor}_wave_`)));
}
const code = readFileSync('src/components/pve/PveFight.tsx', 'utf8');
assert.match(code, /kind === 'trial' && waveIndex \+ 1 < trialWaves\.length/,
  'Normal enemies must advance within one fight, not advance the floor');
assert.match(code, /else finish\(true\);/,
  'Only final wave can award floor victory');
assert.match(code, /kind === 'trial' \? 1 : useGame\.get\(\)\.settings\.speed/,
  'Trials runs normal speed without changing shared settings');
assert.match(code, /\{kind !== 'trial' && <button\s+onClick=\{\(\) => setSettings\(\{ speed:/,
  'x2 speed button must not appear in Trials');
const panel = readFileSync('src/components/BattleScreen.tsx', 'utf8');
assert.match(panel, /1 этаж = 5 врагов \+ босс/,
  'Floor overview must describe its actual gauntlet');
console.log('Trial gauntlet PASS: 5 enemies + final boss per floor, one payout, x2 hidden in Trials');
