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
  TRIAL_FRAGMENT_WEIGHTS, TRIAL_CHEST_RULES, TRIAL_CHEST_ART,
} = m.exports;
const snap = JSON.stringify;
const withChoicesFactory = values => {
  let p=0; return () => values[p++] ?? 0.99;
};

assert.equal(trialChestTier(0), null);
assert.equal(trialChestTier(1), 'common');
assert.equal(trialChestTier(2), 'common');
assert.equal(trialChestTier(4), 'common');
assert.equal(trialChestTier(6), 'common');
assert.equal(trialChestTier(5), 'explorer');
assert.equal(trialChestTier(10), 'guardian');
assert.equal(trialChestTier(25), 'legendary');
assert.equal(trialChestTier(50), 'legendary', '25-floor chest supersedes 10-floor chest');
assert.equal(trialChestTier(100), 'legendary');
assert.equal(TRIAL_FRAGMENT_WEIGHTS.reduce((a,b)=>a+b,0), 100);
assert.equal(rollTrialChest(0, () => 0), null);
const common = rollTrialChest(1, withChoicesFactory([0, 0]));
assert.equal(common.tier, 'common');
assert.equal(common.gold, 20);
assert.equal(common.potions, 1);
assert.equal(common.gems, 0);
assert.equal(common.materials, 0);
assert.equal(common.elixirs, 0);
assert.equal(common.reputation, 0);
assert.equal(common.fragment, undefined);
assert.equal(common.component, undefined);
// Exactly one ordinary bonus with transparent non-overlapping thresholds.
for (const [drawn, bonus] of [[0, 'potions'], [0.449, 'potions'], [0.45, 'materials'], [0.799, 'materials'], [0.8, 'elixirs'], [0.949, 'elixirs'], [0.95, 'gems'], [0.999, 'gems']]) {
  const loot = rollTrialChest(1, withChoicesFactory([drawn, 0.5]));
  assert.equal(loot.gold, 30);
  assert.equal(['potions','materials','elixirs','gems'].filter(kind => loot[kind] > 0).length, 1, String(drawn));
  assert.equal(loot[bonus], 1, String(drawn));
}

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

// Ordinary chests are earned once, including after a reset to floor one.
// They never grant reputation, blueprints or the restricted red currency.
const commonWon = applyTrialChest({ ...base, trialLevel: 1 }, common, Date.UTC(2026, 10, 8));
assert.equal(commonWon.player.gold, 220);
assert.equal(commonWon.player.redGems, 0);
assert.equal(commonWon.player.gems, 40);
assert.equal(commonWon.forgeMaterials, 6);
assert.equal(commonWon.territoryCityReputation, 0);
assert.equal(commonWon.inventory.find(item => item.id === 'trial_health_potion_1').qty, 1);
assert.match(commonWon.inventory.find(item => item.id === 'trial_health_potion_1').expiresAt, /2026-11-15/);
assert.deepEqual([...commonWon.trialChestClaims], [1]);
const commonReset = applyTrialChest({ ...commonWon, trialLevel: 1 }, common);
assert.equal(commonReset.lastTrialChest, null);
assert.equal(commonReset.player.gold, commonWon.player.gold);
assert.equal(commonReset.inventory.length, commonWon.inventory.length);
assert.equal(commonReset.trialChestClaims.length, 1);
// Old special chest receipts (without 'potions') remain valid.
assert.equal(won.inventory.some(item => item.id.startsWith('trial_health_potion_')), false);

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
  'chest-common.svg','chest-explorer.svg','chest-guardian.svg','chest-legendary.svg',
  'blueprint-fragment.svg','guardian-shard.svg','trial-essence.svg','ancient-mechanism.svg'
]) {
  const path='public/assets/territory/ui/trial-loot/'+file;
  assert.ok(existsSync(path), 'missing real loot art '+file);
  const svg=readFileSync(path,'utf8');
  assert.match(svg,/<svg[^>]*viewBox=/);
}
// The ordinary chest must be a finished transparent game illustration, never
// the crude line-art SVG reported by the owner. Both UIs use the same mapping.
assert.equal(TRIAL_CHEST_ART.common, 'assets/territory/ui/materials/royal-chest.webp');
const commonChestArt = readFileSync('public/' + TRIAL_CHEST_ART.common);
assert.equal(commonChestArt.toString('ascii', 0, 4), 'RIFF', 'common chest must be a real WEBP');
assert.equal(commonChestArt.toString('ascii', 8, 12), 'WEBP', 'common chest must be a real WEBP');
assert.ok(commonChestArt.length > 12000, 'the prize must be detailed artwork, not a placeholder');
for (const tier of ['explorer', 'guardian', 'legendary']) {
  assert.ok(existsSync('public/' + TRIAL_CHEST_ART[tier]), 'missing tier art ' + tier);
}
const badge = readFileSync('public/assets/territory/ui/trial-loot/city-reputation.png');
assert.equal(badge.subarray(0,8).toString('hex'), '89504e470d0a1a0a', 'the approved royal badge must be a real PNG');
assert.ok(badge.length > 5000, 'approved royal badge must contain actual artwork');
const collectionSource = readFileSync('src/components/trials/TrialLootCollection.tsx','utf8');
assert.match(collectionSource, /city-reputation\.png/, 'collection must display the newly approved royal crest');
assert.doesNotMatch(collectionSource, /city-reputation\.svg/, 'old badge must not be shown in the collection');
const sourceFight=readFileSync('src/components/pve/PveFight.tsx','utf8');
assert(sourceFight.includes('TRIAL_CHEST_ART[loot.tier]'), 'victory card must use the real art mapping');
assert(collectionSource.includes('TRIAL_CHEST_ART[tier]'), 'collection must match the actual victory chest');
assert.match(readFileSync('src/components/pve/trialChestReveal.css', 'utf8'), /trial-chest-stage--common/, 'missing rich common chest styling');

assert.match(sourceFight, /city-reputation\.png/, 'victory reward must display the same royal crest');
assert.doesNotMatch(sourceFight, /city-reputation\.svg/, 'old badge must not be shown in battle rewards');
const sourceVictory=readFileSync('src/game/progression.ts','utf8');
assert.match(sourceVictory, /applyTrialChest\(next, canRollChest \? rollTrialChest\(floor\) : null\)/);
assert.match(sourceFight,/data-testid="trial-earned-chest"/);
assert.match(sourceFight,/data-testid="trial-open-chest"/);
assert.match(sourceFight,/data-testid="trial-chest-revealed"/);
assert.match(sourceFight,/trial-chest-already-claimed/);
assert.match(sourceFight,/saveState !== 'confirmed' \|\| chestOpened/, 'never open a chest before saving, and never credit loot on click');
assert.ok(existsSync('src/components/pve/trialChestReveal.css'), 'missing live opening animation');
// Visual reveal must remain a real three-state animation, not a static chest image.
// Keep this independent of loot generation and protect motion-sensitive players.
const revealCss = readFileSync('src/components/pve/trialChestReveal.css', 'utf8');
assert.match(revealCss, /\.trial-chest-stage:not\(\.trial-chest-open\)\s*\{[^}]*animation:\s*territory-chest-idle/s, 'closed chest needs idle state');
assert.match(revealCss, /\.trial-chest-stage\.trial-chest-open \.trial-chest-lid\s*\{[^}]*animation:\s*territory-chest-lid/s, 'opening must animate the actual lid');
assert.match(revealCss, /\.trial-chest-open \.trial-chest-aura\s*\{[^}]*animation:\s*territory-chest-glow/s, 'opening must reveal warm glow');
assert.match(revealCss, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?animation:\s*none !important/, 'motion-sensitive players must be able to disable chest animation');
assert.match(revealCss, /\.trial-chest-stage\.trial-chest-open \.trial-chest-lid\s*\{\s*transform:/, 'reduced-motion open state must still show an opened lid');
assert.match(readFileSync('src/components/InventoryScreen.tsx','utf8'),/<TrialLootCollection language=\{language\} \/>/);
assert.match(readFileSync('src/components/BattleScreen.tsx','utf8'),/<TrialLootCollection language=\{language\} \/>/);
console.log('TRIAL LOOT PASS: all-floor common chests, exclusive one-in-four rewards, special odds, reset replay protection, visuals and saved victory reveal');
