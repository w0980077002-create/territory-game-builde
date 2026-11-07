// Test-mode Trial chest economy: no player/DB access, no reward mutation in production.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync('src/game/trialLoot.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const m = { exports: {} };
vm.runInNewContext(compiled, {
  module:m, exports:m.exports,
  require(name) {
    if (name === './elixirExpiry') return { newElixirExpiry: time => new Date(time + 7*86400000).toISOString() };
    throw Error('unexpected dependency ' + name);
  },
});
const {
  trialChestTier, rollTrialChest, applyTrialChest, assembleTrialBlueprint,
  ownedTrialFragmentCount, trialFragmentItemId, trialBlueprintItemId,
  TRIAL_FRAGMENT_WEIGHTS, TRIAL_CHEST_RULES,
} = m.exports;
const snap = JSON.stringify;
assert.equal(trialChestTier(0), null);
assert.equal(trialChestTier(1), null);
assert.equal(trialChestTier(5), 'explorer');
assert.equal(trialChestTier(10), 'guardian');
assert.equal(trialChestTier(25), 'legendary');
assert.equal(trialChestTier(50), 'legendary', '25-floor chest supersedes 10-floor chest');
assert.equal(trialChestTier(100), 'legendary');
assert.equal(TRIAL_FRAGMENT_WEIGHTS.reduce((a,b)=>a+b,0), 100);
assert.equal(rollTrialChest(1, () => 0), null);
const withChoices = values => {
  let p=0; return () => values[p++] ?? 0.99;
};
const chest = rollTrialChest(5, withChoices([0, 0, 0, 0.97, 0, 0]));
assert.equal(chest.reputation, 1);
assert.equal(chest.fragment.part, 6);
assert.equal(chest.fragment.blueprint, 'guardian_blade');
assert.equal(chest.component.id, 'guardian_shard');
assert.equal(chest.component.qty, 1);
const base = {
  player: { gold: 200, gems: 40, redGems: 0 },
  inventory: [{id:'original-material',type:'material',name:'Original',qty:4}],
  forgeMaterials: 6, trialLevel: 5, battleStones: 12, territoryCityReputation: 0,
  professions: {active:'smith',masteryLevel:1,masteryXp:0},
  trialChestClaims: [], currentChapter: 7, followers:[{id:'keep'}], belt:[{id:'keep-potion'}],
};
const unchanged = snap(base);
const won = applyTrialChest(base,chest,Date.UTC(2026,10,7));
assert.equal(snap(base), unchanged, 'no in-place player mutation');
assert.equal(won.player.gold, 290);
assert.equal(won.player.gems, 42);
assert.equal(won.player.redGems, 0, 'no premium currency');
assert.equal(won.forgeMaterials, 7);
assert.equal(won.territoryCityReputation, 1);
assert.equal(won.inventory.find(v=>v.id==='original-material').qty,4);
assert.equal(won.inventory.find(v=>v.id===trialFragmentItemId('guardian_blade',6)).qty,1);
assert.equal(won.inventory.find(v=>v.id==='trial_component_guardian_shard').qty,1);
assert.equal(won.inventory.find(v=>v.id==='trial_elixir_5').qty,1);
assert.match(won.inventory.find(v=>v.id==='trial_elixir_5').expiresAt,/2026-11-14/);
assert.deepEqual([...won.trialChestClaims],[5]);
assert.equal(snap(won.followers),snap(base.followers));
assert.equal(snap(won.belt),snap(base.belt));
assert.equal(won.currentChapter,7);
const replay=applyTrialChest(won,chest);
assert.equal(replay.player.gold,won.player.gold);
assert.equal(replay.player.gems,won.player.gems);
assert.equal(replay.territoryCityReputation,1);
assert.equal(replay.inventory.length,won.inventory.length);
assert.equal(replay.trialChestClaims.length,1);
assert.equal(replay.lastTrialChest,null,'replay cannot re-display rewarded chest');

// The six parts must be different, duplicates do not turn into a recipe.
const fragments = [1,2,3,4,5].map(part=>({id:trialFragmentItemId('guardian_blade',part),qty:1,type:'material'}));
const partial={...base,inventory:[...fragments,{id:trialFragmentItemId('guardian_blade',1),qty:5,type:'material'}]};
assert.equal(assembleTrialBlueprint(partial,'guardian_blade'),null);
const full={...base,inventory:[...fragments,{id:trialFragmentItemId('guardian_blade',6),qty:1,type:'material'},{id:trialFragmentItemId('guardian_amulet',6),qty:1,type:'material'}]};
assert.equal(assembleTrialBlueprint({...full,professions:{active:'jeweler'}},'guardian_blade'),null,'non-masters cannot assemble another profession blueprint');
const created=assembleTrialBlueprint(full,'guardian_blade');
assert.ok(created);
assert.equal(ownedTrialFragmentCount(created,'guardian_blade',6),0);
assert.equal(created.inventory.some(i=>i.id===trialBlueprintItemId('guardian_blade')),true);
assert.equal(created.inventory.find(i=>i.id===trialFragmentItemId('guardian_amulet',6)).qty,1,'other blueprint must survive');
assert.equal(assembleTrialBlueprint(created,'guardian_blade'),null);
assert.equal(created.player.gold,full.player.gold,'assembly cannot mint free gold');
assert.equal(created.player.redGems,full.player.redGems,'assembly never creates premium currency');

let seed=123456789;
const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for (const [floor,tier] of [[5,'explorer'],[10,'guardian'],[25,'legendary']]) {
  const tries=100000, counts={rep:0,fragment:0,ingredient:0};
  for(let i=0;i<tries;i++){
    const loot=rollTrialChest(floor,rand);
    counts.rep+=loot.reputation;
    counts.fragment+=Number(!!loot.fragment);
    counts.ingredient+=Number(!!loot.component);
  }
  for(const [key,rule] of [['rep','reputation'],['fragment','fragment'],['ingredient','ingredient']]){
    assert.ok(Math.abs(counts[key]/tries - TRIAL_CHEST_RULES[tier][rule]) < 0.01, tier+' '+key+' '+snap(counts));
  }
}
for(const file of [
  'city-reputation.svg','chest-explorer.svg','chest-guardian.svg','chest-legendary.svg',
  'blueprint-fragment.svg','guardian-shard.svg','trial-essence.svg','ancient-mechanism.svg'
]) {
  const path='public/assets/territory/ui/trial-loot/'+file;
  assert.ok(existsSync(path), 'missing real loot art '+file);
  const svg=readFileSync(path,'utf8');
  assert.match(svg,/<svg[^>]*viewBox=/);
}
const sourceFight=readFileSync('src/components/pve/PveFight.tsx','utf8');
const sourceVictory=readFileSync('src/game/progression.ts','utf8');
assert.match(sourceVictory, /applyTrialChest\(next, canRollChest \? rollTrialChest\(floor\) : null\)/);
assert.match(sourceFight,/data-testid="trial-earned-chest"/);
assert.match(readFileSync('src/components/InventoryScreen.tsx','utf8'),/<TrialLootCollection language=\{language\} \/>/);
assert.match(readFileSync('src/components/BattleScreen.tsx','utf8'),/<TrialLootCollection language=\{language\} \/>/);
console.log('TRIAL LOOT PASS: chest schedule, rates, first-clear uniqueness, permanent reputation, six unique fragments, crafted document, visuals and victory/UI integration');
