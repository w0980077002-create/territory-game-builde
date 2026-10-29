import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/game/idleContent/campaign.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { buildCampaign, getCampaignStage, ENEMY_ROSTER, BOSS_ROSTER } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

const stages = buildCampaign();
assert.equal(stages.length, 100);
assert.equal(new Set(ENEMY_ROSTER.map(x => x.id)).size, 5);
assert.equal(new Set(BOSS_ROSTER.map(x => x.id)).size, 10);
for (let chapter = 1; chapter <= 5; chapter++) {
  const group = stages.filter(s => s.chapter === chapter);
  assert.equal(group.length, 20);
  assert.deepEqual(group.filter(s => s.kind === 'boss').map(s => s.stageInChapter), [10, 20]);
  assert.deepEqual(group.filter(s => s.kind === 'elite').map(s => s.stageInChapter), [5, 15]);
}
assert.equal(new Set(stages.filter(s => s.kind === 'boss').map(s => s.enemyId)).size, 10);
assert.equal(new Set(stages.filter(s => s.kind !== 'boss').map(s => s.enemyId)).size, 5);
for (const stage of stages) {
  assert.ok(existsSync(`public/assets/territory/characters/${stage.enemyArt}`), `missing approved art ${stage.enemyArt}`);
  assert.equal('stats' in stage, false);
  assert.equal('rewards' in stage, false);
}
for (const index of [0, 101, -1, 1.5, NaN, Infinity]) {
  assert.throws(() => getCampaignStage(index), /invalid_campaign_stage/);
}
console.log('Adventure campaign: 100 stages, 10 unique bosses, 5 enemy types, approved art and strict bounds PASS');
