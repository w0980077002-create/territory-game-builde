import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ROOT = new URL('../', import.meta.url);

function loadTs(file, dependencies = {}) {
  const source = readFileSync(new URL(file, ROOT), 'utf8');
  const parsed = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal((parsed.diagnostics ?? []).filter((e) => e.category === ts.DiagnosticCategory.Error).length, 0, `typescript syntax in ${file}`);
  const module = { exports: {} };
  vm.runInNewContext(parsed.outputText, { module, exports: module.exports,
    require(name) { if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name]; throw new Error(`Unexpected import ${name} in ${file}`); },
  }, { filename: file });
  return module.exports;
}

const expiryMock = { reconcileElixirExpiry: (state) => state };
const followers = loadTs('src/game/followers.ts', { './elixirExpiry': expiryMock });
assert.equal(followers.FOLLOWER_TEMPLATES.length, 6);
assert.equal(new Set(followers.FOLLOWER_TEMPLATES.map((f) => f.role)).size, 6);
assert.equal(new Set(followers.FOLLOWER_TEMPLATES.map((f) => f.id)).size, 6);
assert.deepEqual(followers.FOLLOWER_TEMPLATES.map((f) => f.unlockLevel).join(','), '3,8,15,25,40,50');
const oldShield = { id: 'follower_1', name: 'Верный щит', level: 3, attack: 5, defense: 10, unlocked: true, icon: '🛡️', description: 'old' };
const roster = followers.reconcileFollowers([oldShield], 81);
assert.equal(roster.length, 6);
assert.equal(roster[0].level, 3, 'keep existing shield level');
assert.equal(roster[0].defense, 10, 'keep existing shield stats');
assert.equal(roster[0].description, 'old', 'keep legacy description');
assert(roster.every((f) => f.unlocked), 'high-level legacy hero unlocks all followers');
assert.equal(followers.reconcileFollowers([oldShield], 8).filter((f) => f.unlocked).length, 2);
const starter = { followers: roster, activeFollowerId: null, player: { level: 81, gold: 10_000 }, forgeMaterials: 500 };
assert.equal(followers.selectedFollower(starter).id, 'follower_1');
assert.equal(followers.selectFollower(starter, 'follower_4').activeFollowerId, 'follower_4');
assert.equal(followers.selectFollower(starter, 'fake_follower'), null);
assert.equal(followers.selectFollower({ ...starter, followers: followers.reconcileFollowers([], 1) }, 'follower_1'), null);
const chosen = followers.selectFollower(starter, 'follower_3');
assert.equal(followers.selectedFollower(chosen).id, 'follower_3');
const fee = followers.followerTrainingCost(1);
const trained = followers.trainFollower(starter, 'follower_1');
assert.equal(trained.followers[0].level, 4);
assert.equal(trained.player.gold, starter.player.gold - followers.followerTrainingCost(3).gold);
assert.equal(trained.forgeMaterials, starter.forgeMaterials - followers.followerTrainingCost(3).materials);
assert.equal(starter.followers[0].level, 3, 'training must be immutable');
assert.equal(followers.trainFollower({ ...starter, player: { ...starter.player, gold: -1 } }, 'follower_1'), null);
assert.equal(followers.trainFollower({ ...starter, forgeMaterials: NaN }, 'follower_1'), null);
assert.equal(followers.trainFollower({ ...starter, player: { ...starter.player, level: 3 } }, 'follower_1'), null);
assert.equal(followers.trainFollower({ ...starter, followers: starter.followers.map((f) => f.id === 'follower_1' ? { ...f, level: 60 } : f) }, 'follower_1'), null);
for (const f of roster) {
  const b = followers.followerCombat(f);
  assert(b.attack >= 0 && b.attack <= 135);
  assert(b.defense >= 0 && b.defense <= 130);
  assert(b.crit >= 0 && b.crit <= 5);
  assert(b.pierce >= 0 && b.pierce <= 0.08);
}
assert.equal(followers.followerCombat(roster.find((x) => x.id === 'follower_4')).crit > 0, true);
assert.equal(followers.followerCombat(roster.find((x) => x.id === 'follower_5')).pierce > 0, true);
assert.equal(followers.followerCombat(roster.find((x) => x.id === 'follower_3')).heal > 0, true);
assert.equal(followers.followerCombat(roster.find((x) => x.id === 'follower_6')).heal > 0, true);
assert.equal(followers.followerCombat(roster.find((x) => x.id === 'follower_6')).pierce, 0.02);
assert.equal(followers.selectFollower({ ...starter, followers: followers.reconcileFollowers([], 49) }, 'follower_6'), null, 'Battle Cow unlocks at 50');
assert.equal(followers.followerCombat(roster.find((x) => x.id === 'follower_2')).defense, 0);
assert.equal(fee.gold, 205);
const cowSprite = readFileSync(new URL('../public/assets/territory/characters/followers/battle_cow/idle.svg', import.meta.url), 'utf8');
assert.match(cowSprite, /viewBox="0 0 493 564"/, 'Battle Cow sprite needs a tightly cropped, transparent viewBox');
assert.match(cowSprite, /data:image\/webp;base64,UklGR/, 'Battle Cow must embed the approved raster art, not an external URL');
assert.equal(followers.selectFollower(starter, 'follower_6')?.activeFollowerId, 'follower_6');
assert.equal(followers.AWAKENING_STONE_ITEM.qty, 0, 'the stone is visible but never gifted on install');
assert.equal(followers.AWAKENING_STONE_ITEM.type, 'material');
assert.equal(followers.MAX_BATTLE_COW_LEVEL, 100);
// Product owner explicitly froze awakening stone sources. No PvE battle should
// mint this rare item, including milestones that previously issued one.
for (const chapter of [1, 5, 10, 20, 100]) {
  assert.equal(followers.cowStoneChapterBossReward(chapter, `ch${chapter}_boss`, true), 0);
}
for (const floor of [1, 9, 10, 20, 100]) {
  assert.equal(followers.cowStoneTrialReward(floor), 0);
}
const stoneBlank = { ...starter, inventory: [{ id:'keep', type:'material', qty:4 }] };
assert.equal(followers.awardCowAwakeningStone(stoneBlank, 1), stoneBlank, 'client cannot mint an awakening stone');
assert.equal(followers.cowStonesOwned(stoneBlank), 0);
const savedStone = { ...stoneBlank, inventory: [{ ...followers.AWAKENING_STONE_ITEM, qty: 2 }, ...stoneBlank.inventory] };
assert.equal(followers.cowStonesOwned(savedStone), 2, 'historical stones stay visible');
assert.equal(followers.awardCowAwakeningStone(savedStone, 5), savedStone, 'historical stones must not be changed by a grant');
assert.equal(followers.cowStonesOwned(savedStone), 2);
const actionSource = readFileSync(new URL('../src/game/actions.ts', import.meta.url), 'utf8');
const progressionSource = readFileSync(new URL('../src/game/progression.ts', import.meta.url), 'utf8');
const pveSource = readFileSync(new URL('../src/components/pve/PveFight.tsx', import.meta.url), 'utf8');
const campSource = readFileSync(new URL('../src/components/FollowersPanel.tsx', import.meta.url), 'utf8');
assert(!actionSource.includes('awardCowAwakeningStone('), 'campaign must not award stones');
assert(!progressionSource.includes('awardCowAwakeningStone('), 'trials must not award stones');
assert(!pveSource.includes('awakeningStones'), 'victory must not advertise unavailable drops');
assert(campSource.includes('!isCow &&'), 'cow awakening must remain disabled in live UI');

const oldCow = { ...roster.find((f) => f.id === 'follower_6'), level: 59, attack: 65 };
const existingCow = {
  ...starter,
  player: { ...starter.player, level: 59, gold: 987654, gems: 111, redGems: 2 },
  inventory: [{ ...followers.AWAKENING_STONE_ITEM, qty: 0 },
    { id: 'legacy-material', type: 'material', name: 'Old material', qty: 9 }],
  followers: roster.map((f) => f.id === 'follower_6' ? oldCow : f),
};
assert.equal(followers.trainFollower(existingCow, 'follower_6'), null, 'without stones cannot spend gold for Battle Cow');
const withStone = { ...existingCow, inventory: existingCow.inventory.map((x) =>
  x.id === followers.AWAKENING_STONE_ID ? { ...x, qty: 1 } : x) };
const cowBefore = structuredClone(withStone);
assert.equal(followers.trainFollower(withStone, 'follower_6'), null, 'awakening paused even when historical stones exist');
assert.deepEqual(withStone, cowBefore, 'no stone, level, or currency silently changed');
assert.equal(followers.cowStonesOwned(withStone), 1, 'old saved stone remains available later');
assert.equal(withStone.followers.find(f => f.id === 'follower_6').level, 59, 'old companion level remains unchanged');

const cowMaxed = { ...withStone, followers: withStone.followers.map((x) =>
  x.id === 'follower_6' ? { ...x, level: 100 } : x) };
assert.equal(followers.trainFollower(cowMaxed, 'follower_6'), null, 'never overlevel the cow');

console.log('Stage4: 6 follower roles, approved cow art, legacy migration, one active, level-gated training, bounded PvE bonuses: PASS');

const equipBalance = loadTs('src/game/equipmentBalance.ts', { './equipmentCatalog': { EQUIPMENT_TEMPLATES: [], rarityForChapter: () => 'common' } });
const forge = loadTs('src/game/forge.ts', { './equipmentBalance': equipBalance, './elixirExpiry': expiryMock });
const eq = { id: 'ring-old', name: 'Ring', slot: 'ring', icon: '💍', rarity: 'rare', level: 1, baseLevel: 1, baseStats: { attack: 10 }, upgradeCount: 0, attack: 10 };
const item = { id: eq.id, name: 'Ring', icon: '💍', rarity: 'rare', qty: 1, type: 'equipment', description: 'ring', equipment: eq };
const input = { player: { level: 20, gold: 2000, equipped: {} }, forgeMaterials: 50, inventory: [item] };
const upgraded = forge.forgeAttempt(input, eq.id, 1, 0.1);
assert.equal(upgraded.status, 'success');
assert.equal(upgraded.next.inventory[0].equipment.level, 2);
assert.equal(upgraded.next.player.gold, 2000 - forge.forgeCost(1).gold);
assert.equal(upgraded.next.forgeMaterials, 50 - forge.forgeCost(1).materials);
assert.equal(input.inventory[0].equipment.level, 1, 'forging should not mutate old snapshots');
const replay = forge.forgeAttempt(upgraded.next, eq.id, 1, 0.1);
assert.equal(replay.status, 'invalid', 'stale modal cannot charge twice');
assert.equal(replay.next, upgraded.next);
const fail = forge.forgeAttempt(input, eq.id, 1, 0.99);
assert.equal(fail.status, 'failed');
assert.equal(fail.next.inventory[0].equipment.level, 1);
assert.equal(fail.next.player.gold, 2000 - forge.forgeCost(1).gold);
assert.equal(forge.forgeAttempt({ ...input, forgeMaterials: 0 }, eq.id, 1, 0.1).status, 'invalid');
assert.equal(forge.forgeAttempt(input, eq.id, 1, NaN).status, 'invalid');
assert.equal(forge.forgeAttempt(input, 'another-id', 1, 0.1).status, 'invalid');
const equipInput = { ...input, player: { ...input.player, equipped: { ring: eq } }, inventory: [] };
const eqResult = forge.forgeAttempt(equipInput, 'equipped_ring-old', 1, 0.1);
assert.equal(eqResult.status, 'success');
assert.equal(eqResult.next.player.equipped.ring.level, 2);
const slots = ['weapon','ring','amulet','armor','helmet','shield','boots'];
for (let n = 0; n <= 7; n++) {
  const equipped = Object.fromEntries(slots.slice(0, n).map((slot) => [slot, { ...eq, slot, upgradeCount: 1 }]));
  const bonus = forge.forgeSetBonus(equipped);
  assert.equal(bonus.slots, n);
  assert.equal(bonus.hp, n >= 3 ? 0.02 : 0);
  assert.equal(bonus.defense, n >= 5 ? 0.03 : 0);
  assert.equal(bonus.attack, n >= 7 ? 0.04 : 0);
}
assert.equal(forge.forgeSetBonus({ ring: { ...eq, slot: 'weapon', upgradeCount: 1 } }).slots, 0);
console.log('Stage4: forge stale modal/duplicate transaction guard, seven-slot PvE set bonuses: PASS');

const zones = [{id:'head',label:'head',mult:1},{id:'chest',label:'chest',mult:1},{id:'belly',label:'belly',mult:1},{id:'legs',label:'legs',mult:1}];
const pveBalance = loadTs('src/game/pveBalance.ts');
const pve = loadTs('src/game/pve.ts', {
  './arenaApi': { ZONES: zones },
  './engine': { getComputedStats: () => ({ maxHp: 100, attack: 50, defense: 20, critChance: 5, critDamage: 50 }) },
  './pveBalance': pveBalance,
  './followers': followers,
  './forge': forge,
  './elixirExpiry': loadTs('src/game/elixirExpiry.ts'),
});
const fullSet = Object.fromEntries(slots.map((slot) => [slot, { ...eq, slot, upgradeCount: 1 }]));
const hero = pve.heroSide({ player: { name: 'Test', equipped: fullSet }, followers: roster, activeFollowerId: 'follower_4' });
assert.equal(hero.maxHp, 102);
assert.equal(hero.attack, 52);
assert.equal(hero.defense, 21);
assert(hero.critChance > 5, 'hunter provides PvE crit');
const testHero = {name: 'Hero',hp:40,maxHp:100,attack:3,defense:100,critChance:0,critDamage:0};
const testEnemy = {name: 'Enemy',hp:100000,maxHp:100000,attack:3,defense:20,critChance:0,critDamage:0};
const round = pve.playRound(testHero,testEnemy,'head',['head','chest'],3,'Healer',0, followers.followerCombat(roster.find((x) => x.id === 'follower_3')));
assert(round.healAmount > 0 && round.healAmount <= 15);
assert(round.hero.hp > 0 && round.hero.hp <= testHero.maxHp);
const unboosted = pve.playRound(testHero,testEnemy,'head',['head','chest'],0,'');
assert.equal(unboosted.healAmount, 0);
console.log('Stage4: PvE-only hunter crit / mage pierce / healer heal / forge set integration: PASS');

function checkSourceTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir,entry.name);
    if (entry.isDirectory()) { checkSourceTree(full); continue; }
    if (!/\.(?:tsx?|jsx?)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
    const source = readFileSync(full, 'utf8');
    const transpiled = ts.transpileModule(source, { fileName: full, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
    const errors = (transpiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, `invalid TypeScript in ${full}: ${errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join(' | ')}`);
    // Resolve local TS/TSX imports so a missing file cannot slip into a mobile build.
    for (const re of source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
      const target = join(dirname(full), re[1]);
      assert(['','.ts','.tsx','.js','.jsx','.mjs','.json'].some(suffix => existsSync(target+suffix)) || existsSync(join(target,'index.ts')) || existsSync(join(target,'index.tsx')),
        `Unresolved import ${re[1]} in ${full}`);
    }
  }
}
checkSourceTree(new URL('../src/',import.meta.url).pathname);
assert(existsSync(new URL('../src/components/FollowersPanel.tsx', import.meta.url).pathname));
console.log('Stage4: TypeScript/TSX parse and relative imports for entire project: PASS');
