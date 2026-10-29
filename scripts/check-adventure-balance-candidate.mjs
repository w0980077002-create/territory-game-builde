import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

async function load(path) {
  const compiled = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
}
const { buildAdventureBalanceCandidate } = await load('src/game/idleContent/adventureBalanceCandidate.ts');
const { createIdleCombat, advanceIdleCombat } = await load('src/game/idleEngine/index.ts');
const candidates = buildAdventureBalanceCandidate();
const reviewFile = JSON.parse(readFileSync('docs/adventure-balance-candidate.staged.json','utf8'));
assert.equal(reviewFile.status,'REVIEW_REQUIRED_NOT_FOR_DEPLOYMENT');
assert.deepEqual(reviewFile.stages,candidates,'regenerate review table when source changes');
assert.deepEqual(candidates, buildAdventureBalanceCandidate(), 'same source must give identical staged candidates');
assert.equal(candidates.length, 100);
assert.equal(new Set(candidates.map(x => x.encounterId)).size, 100);
assert.deepEqual(candidates.filter(x => x.kind === 'boss').map(x => x.stage), [10,20,30,40,50,60,70,80,90,100]);
assert.equal(new Set(candidates.filter(x => x.kind === 'boss').map(x => x.enemyId)).size, 10);
assert.ok(candidates.every(x => !x.enabled && x.approval === 'review_required' && x.items.length === 0));
assert.deepEqual([candidates[0].gold,candidates[0].xp], [20,28]);
assert.deepEqual([candidates[9].gold,candidates[9].xp], [200,280]);
assert.equal(candidates[4].legacySource, 'ordinary', 'elite has no invented multiplier');
const rules={stepMs:50,maxDurationMs:120000,approachMs:450,attackIntervalMs:1450,basicWindupMs:250,basicMultiplier:1,
 defenseFactor:0.45,magicDefenseFactor:0.25,minimumDamage:1,critMultiplier:1.7,blockMultiplier:0.55,
 maxEnergy:100,initialEnergy:45,energyPerSecond:6,modeDamageMultiplier:{pve:1,boss:0.9,pvp:0.7}};
const hero={stats:{hp:1000,maxHp:1000,attack:100,defense:20,critChance:0,dodgeChance:0,blockChance:0},
 loadout:{skills:[],passives:[]},ownership:{heroLevel:1,skills:{},runes:{},passives:{}}};
for (const candidate of candidates) {
  assert.equal(candidate.legacyFloor,candidate.stage);
  const input={seed:42,stage:candidate.stage,mode:candidate.kind==='boss'?'boss':'pve',control:'auto',
    hero,enemy:candidate.enemy,catalog:{skills:[],runes:[],passives:[]},rules};
  const first=advanceIdleCombat(createIdleCombat(input),1000);
  const second=advanceIdleCombat(createIdleCombat(input),1000);
  assert.deepEqual(first,second,`non-deterministic stage ${candidate.stage}`);
}
console.log('Adventure balance candidate PASS: 100 disabled entries, explicit provenance, deterministic engine; review still required.');
