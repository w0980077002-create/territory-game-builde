import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Isolated, no production network calls or user data.
const baseRevision = '2026-11-04T06:00:00.000Z';
const nextRevision = '2026-11-04T06:01:00.000Z';
const entries = new Map();
globalThis.localStorage = {
  getItem: key => entries.has(key) ? entries.get(key) : null,
  setItem: (key, value) => { entries.set(key, String(value)); },
  removeItem: key => { entries.delete(key); },
};
globalThis.__mockServer = { revision: baseRevision, state: {player:{gold:10,gems:2}}, gold:10, gems:2 };
globalThis.__mockWrites = 0;
globalThis.__mockMode = 'normal';
globalThis.__mockOffline = false;

const mocks = {
  './cloud': [
    "export const saveTokens = new Map([['hero-a','2026-11-04T06:00:00.000Z'],['hero-b','2026-11-04T06:00:00.000Z']]);",
    "globalThis.__mockTokens = saveTokens;",
    "export async function saveCloudSave(userId, snapshot) {",
    " globalThis.__mockWrites++;",
    " if (globalThis.__mockMode === 'failed') return false;",
    " if (globalThis.__mockMode === 'wrong-snapshot') return true;",
    " if (saveTokens.get(userId) !== globalThis.__mockServer.revision) return false;",
    " globalThis.__mockServer.state = JSON.parse(JSON.stringify(snapshot));",
    " globalThis.__mockServer.gold = snapshot.player.gold;",
    " globalThis.__mockServer.gems = snapshot.player.gems;",
    " globalThis.__mockServer.revision = '2026-11-04T06:01:00.000Z';",
    " saveTokens.set(userId, globalThis.__mockServer.revision);",
    " return true;",
    "}",
  ].join('\n'),
  './saveToken': "export const validSaveToken = value => typeof value === 'string' && Number.isFinite(Date.parse(value));",
  './economyInvariant': "export const validEconomySnapshot = s => !!s && !!s.player && Number.isSafeInteger(s.player.gold) && s.player.gold >= 0 && Number.isSafeInteger(s.player.gems) && s.player.gems >= 0;",
  './supabase': [
    "export const supabase = {",
    " from(table) {",
    "  if (table !== 'players') throw Error('Wrong table');",
    "  return {",
    "   select() { return this; },",
    "   eq(field, id) { if (field !== 'id' || !id) throw Error('Unsafe read'); return this; },",
    "   async maybeSingle() {",
    "    if (globalThis.__mockOffline) throw Error('offline');",
    "    const row = globalThis.__mockServer;",
    "    return {data:{game_state:row.state,gold:row.gold,gems:row.gems,updated_at:row.revision},error:null};",
    "   },",
    "  };",
    " },",
    "};",
  ].join('\n'),
};
const bundle = await build({
  entryPoints: ['src/game/pveVictoryRecovery.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'isolated-pve-cloud', setup(builder) {
    builder.onResolve({filter: /^\.\//}, args => Object.hasOwn(mocks, args.path)
      ? {path:args.path,namespace:'mock'} : undefined);
    builder.onLoad({filter: /.*/,namespace:'mock'}, args => ({contents:mocks[args.path],loader:'js'}));
  } }],
});
const {
  canJournalPveVictory, pendingPveVictoryJournal, stagePveVictoryJournal,
  persistPveVictoryJournal, retryPveVictoryJournal, recoverPveVictoryOnBoot,
  archiveUnresolvedPveVictoryForCloudEntry, hasUnresolvedPveVictoryArchive,
} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const original = () => ({player:{gold:10,gems:2},chapterWins:0});
const victory = () => ({player:{gold:30,gems:2},chapterWins:1,totalBattlesWon:1,inventory:[{id:'loot-1'}]});
const profile = () => ({
  state: structuredClone(globalThis.__mockServer.state),
  saveRevision: globalThis.__mockServer.revision,
  savedGameState: structuredClone(globalThis.__mockServer.state),
  walletGold: globalThis.__mockServer.gold,
  walletGems: globalThis.__mockServer.gems,
});
const reset = () => {
  entries.clear();
  globalThis.__mockWrites = 0;
  globalThis.__mockMode = 'normal';
  globalThis.__mockOffline = false;
  globalThis.__mockTokens.set('hero-a', baseRevision);
  globalThis.__mockTokens.set('hero-b', baseRevision);
  globalThis.__mockServer = {revision:baseRevision,state:original(),gold:10,gems:2};
};

assert.equal(canJournalPveVictory(), true);
assert.equal(pendingPveVictoryJournal('hero-a'), false);
assert.deepEqual(await recoverPveVictoryOnBoot('hero-a', profile()), {
  state: globalThis.__mockServer.state, recovered:false,
});

// Crash after victory but before cloud ACK: recover against the original CAS revision.
reset();
assert.equal(stagePveVictoryJournal('hero-a', victory()), true);
assert.equal(stagePveVictoryJournal('hero-a', victory()), true);
assert.equal(stagePveVictoryJournal('hero-a', {...victory(),chapterWins:99}), false);
assert.equal(pendingPveVictoryJournal('hero-a'), true);
assert.deepEqual(await recoverPveVictoryOnBoot('hero-a', profile()), {state:victory(),recovered:true});
assert.equal(globalThis.__mockWrites, 1);
assert.equal(pendingPveVictoryJournal('hero-a'), false);

// ACK lost but server already has exactly the same victory: no second write.
reset();
assert.equal(stagePveVictoryJournal('hero-a', victory()), true);
globalThis.__mockServer = {revision:nextRevision,state:victory(),gold:30,gems:2};
assert.deepEqual(await recoverPveVictoryOnBoot('hero-a', profile()), {state:victory(),recovered:true});
assert.equal(globalThis.__mockWrites, 0);
assert.equal(pendingPveVictoryJournal('hero-a'), false);

// Live PostgreSQL normalizes player.stats and balanceVersion. A successful
// normalized victory is still recoverable, but missing reward inventory is NOT.
reset();
assert.equal(stagePveVictoryJournal('hero-a', victory()), true);
const normalized = {...victory(), balanceVersion:4, player:{
  ...victory().player,
  stats:{attack:20,defense:5,maxHp:100,hp:100,critChance:5,critDamage:50},
}};
globalThis.__mockServer = {revision:nextRevision,state:normalized,gold:30,gems:2};
assert.deepEqual(await recoverPveVictoryOnBoot('hero-a', profile()), {state:normalized,recovered:true});
assert.equal(globalThis.__mockWrites, 0);
reset();
assert.equal(stagePveVictoryJournal('hero-a', victory()), true);
const missingLoot = {...normalized, inventory:[]};
globalThis.__mockServer = {revision:nextRevision,state:missingLoot,gold:30,gems:2};
assert.equal(await recoverPveVictoryOnBoot('hero-a', profile()), null,
  'Normalized stats may differ, but missing loot must never be accepted');
assert.equal(pendingPveVictoryJournal('hero-a'), true);

// PostgreSQL also rewrites derived equipment stats and forge baselines in
// equipped items, inventory AND belt. A real saved Trial win must be accepted
// even when those benign v4 transformations differ from the original WAL.
const gearVictory = () => ({
  ...victory(),
  lastTrialChest: { floor: 7, tier: 'common', gold: 26, materials: 1 },
  trialLevel: 8,
  forgeMaterials: 47,
  player: {
    gold: 30, gems: 2, xp: 110,
    equipped: {
      helmet: { id:'helm-33',name:'Железный шлем',slot:'helmet',rarity:'common',level:33,
        hp:36, defense:11, baseLevel:1, baseStats:{hp:20,defense:3},upgradeCount:32 },
    },
  },
  inventory: [
    { id:'loot-1',qty:1 },
    { id:'crafted-armor',qty:1,rarity:'common',equipment:{
      id:'armor-1',name:'Кожаная броня',slot:'armor',rarity:'common',level:1,
      hp:30,defense:5,attack:0,baseLevel:1,baseStats:{hp:30,defense:5},upgradeCount:0,
    } },
  ],
  belt: [{id:'belt-armor',qty:1,equipment:{
    id:'belt-armor-1',name:'Кожаная броня',slot:'armor',rarity:'common',level:1,
    hp:30,defense:5,baseLevel:1,baseStats:{hp:30,defense:5},upgradeCount:0,
  }}],
});
const normalizedGearVictory = () => {
  const result = structuredClone(gearVictory());
  result.balanceVersion=4;
  result.player.stats={hp:1220,attack:300,defense:117,maxHp:1220,critChance:5,critDamage:50};
  result.player.equipped.helmet.defense=11;
  result.player.equipped.helmet.hp=36;
  delete result.player.equipped.helmet.baseStats;
  result.inventory[1].equipment.defense=5;
  delete result.inventory[1].equipment.attack;
  delete result.inventory[1].equipment.baseLevel;
  result.belt[0].equipment.hp=31;
  result.belt[0].equipment.baseStats={hp:30,defense:5};
  return result;
};
reset();
assert.equal(stagePveVictoryJournal('hero-a',gearVictory()),true);
const canonicalTrial = normalizedGearVictory();
globalThis.__mockServer={revision:nextRevision,state:canonicalTrial,gold:30,gems:2};
assert.deepEqual(await recoverPveVictoryOnBoot('hero-a',profile()), {
  state:canonicalTrial,recovered:true,
},'Saved Trial 7 chest, XP, materials and gear must be confirmed despite server v4 stat normalization');
assert.equal(globalThis.__mockWrites,0,'Never issue a second win write after readback confirmation');
assert.equal(pendingPveVictoryJournal('hero-a'),false);

// The gear readback exemption must NEVER hide missing rewards or item swaps.
for (const modify of [
  s => { s.inventory[1].qty=0; },
  s => { s.inventory[1].equipment.id='wrong-armor'; },
  s => { s.inventory[1].equipment.level=2; },
  s => { s.inventory.pop(); },
  s => { s.lastTrialChest.gold=0; },
  s => { s.trialLevel=7; },
  s => { s.forgeMaterials=45; },
  s => { s.player.xp=109; },
]) {
  reset();
  assert.equal(stagePveVictoryJournal('hero-a',gearVictory()),true);
  const tampered=normalizedGearVictory();
  modify(tampered);
  globalThis.__mockServer={revision:nextRevision,state:tampered,gold:30,gems:2};
  assert.equal(await recoverPveVictoryOnBoot('hero-a',profile()),null,
    'Changed item identity/qty/level, chest, floor, materials or XP must not acknowledge victory');
  assert.equal(pendingPveVictoryJournal('hero-a'),true);
}

// Lost ACK in a *running* session with an obsolete CAS token must not
// unlock a new battle. Boot reloads the authoritative token before clearing.
reset();
assert.equal(stagePveVictoryJournal('hero-a', victory()), true);
globalThis.__mockServer = {revision:nextRevision,state:victory(),gold:30,gems:2};
assert.equal(await retryPveVictoryJournal('hero-a'), false);
assert.equal(pendingPveVictoryJournal('hero-a'), true);
assert.deepEqual(await recoverPveVictoryOnBoot('hero-a', profile()), {state:victory(),recovered:true});
assert.equal(pendingPveVictoryJournal('hero-a'), false);

// Concurrent server change: no stale overwrite; retain WAL for support.
reset();
assert.equal(stagePveVictoryJournal('hero-a', victory()), true);
globalThis.__mockServer.revision = nextRevision;
assert.equal(await recoverPveVictoryOnBoot('hero-a', profile()), null);
assert.equal(globalThis.__mockWrites, 0);
assert.equal(pendingPveVictoryJournal('hero-a'), true);
assert.equal(pendingPveVictoryJournal('hero-b'), false);

// A later cloud save after a fully committed Trial 7 chest cannot leave the
// player locked at startup. The player may have earned/spent gold afterward, so
// prove the exact chest receipt and Trial progress instead of comparing wallets
// to a stale historical snapshot. Keep every byte of the old WAL for support.
const trial7 = () => ({
  ...victory(),
  trialLevel: 8,
  trialChestClaims: [7],
  lastTrialChest: { floor: 7, tier: 'common', gold: 26, gems: 0,
    materials: 1, potions: 0, elixirs: 0, reputation: 0 },
  totalBattlesWon: 301,
  forgeMaterials: 47,
});
reset();
const recordedTrial7 = trial7();
assert.equal(stagePveVictoryJournal('hero-a', recordedTrial7), true);
const oldTrialWal = entries.get('territory:pve-victory-wal:v1:hero-a');
const laterTrialSave = {...trial7(), player:{...trial7().player,gold:80},
  totalBattlesWon: 302, forgeMaterials: 45 };
globalThis.__mockServer = {revision:nextRevision,state:laterTrialSave,gold:80,gems:2};
globalThis.__mockTokens.set('hero-a', nextRevision);
assert.deepEqual(await recoverPveVictoryOnBoot('hero-a', profile()), {
  state:laterTrialSave,recovered:true,
}, 'Proven same Trial chest must release stale checkpoint automatically on startup');
assert.equal(globalThis.__mockWrites,0,'Restore never replays or re-credits Trial 7');
assert.equal(pendingPveVictoryJournal('hero-a'),false);
assert.equal(entries.get('territory:pve-victory-unresolved:v1:hero-a:0'),oldTrialWal,
  'Archive original victory proof verbatim before opening the game');

// Unrelated newer cloud updates MUST NOT auto-close a pending victory. A bare
// Trial level, wallet, or another chest does not prove the old win was saved.
const rejectedTrialCloud = [
  state => { state.trialChestClaims=[]; },
  state => { state.lastTrialChest.gold=10; },
  state => { state.lastTrialChest.floor=8; },
  state => { state.trialLevel=7; },
  state => { state.totalBattlesWon=299; },
  state => { delete state.lastTrialChest; },
  state => { delete state.trialChestClaims; },
];
for (const modify of rejectedTrialCloud) {
  reset();
  assert.equal(stagePveVictoryJournal('hero-a',trial7()),true);
  const row=structuredClone(laterTrialSave);
  modify(row);
  globalThis.__mockServer={revision:nextRevision,state:row,gold:80,gems:2};
  globalThis.__mockTokens.set('hero-a',nextRevision);
  assert.equal(await recoverPveVictoryOnBoot('hero-a',profile()),null,
    'Newer revision without exact saved Trial chest must remain blocked');
  assert.equal(pendingPveVictoryJournal('hero-a'),true);
  assert.equal(hasUnresolvedPveVictoryArchive('hero-a'),false);
}
reset();
assert.equal(stagePveVictoryJournal('hero-a',trial7()),true);
globalThis.__mockServer={revision:nextRevision,state:laterTrialSave,gold:80,gems:2};
// Token from the previously loaded cloud row did not match: do not accept.
assert.equal(await recoverPveVictoryOnBoot('hero-a',profile()),null);
assert.equal(pendingPveVictoryJournal('hero-a'),true);
reset();
assert.equal(stagePveVictoryJournal('hero-a',trial7()),true);
globalThis.__mockServer={revision:nextRevision,state:laterTrialSave,gold:80,gems:2};
globalThis.__mockTokens.set('hero-a',nextRevision);
const archiveWrite = localStorage.setItem;
localStorage.setItem=(k,v)=>{if(k.startsWith('territory:pve-victory-unresolved'))throw Error('quota');return archiveWrite(k,v);};
assert.equal(await recoverPveVictoryOnBoot('hero-a',profile()),null);
assert.equal(pendingPveVictoryJournal('hero-a'),true);
localStorage.setItem=archiveWrite;

// An unrelated coalesced save ACK is not proof that the victory was stored.
reset();
assert.equal(stagePveVictoryJournal('hero-a', victory()), true);
globalThis.__mockMode = 'wrong-snapshot';
assert.equal(await persistPveVictoryJournal('hero-a', victory()), false);
assert.equal(pendingPveVictoryJournal('hero-a'), true);

// Offline read/write retains WAL, followed by safe retry of the same snapshot.
reset();
assert.equal(stagePveVictoryJournal('hero-a', victory()), true);
globalThis.__mockOffline = true;
globalThis.__mockMode = 'failed';
assert.equal(await retryPveVictoryJournal('hero-a'), false);
assert.equal(pendingPveVictoryJournal('hero-a'), true);
globalThis.__mockOffline = false;
globalThis.__mockMode = 'normal';
assert.equal(await retryPveVictoryJournal('hero-a'), true);
assert.equal(pendingPveVictoryJournal('hero-a'), false);

// A permanently divergent cloud snapshot must not strand the player forever:
 // after explicit confirmation, preserve exact WAL bytes in a separate archive
 // and continue with the latest authenticated server row, never award twice.
reset();
assert.equal(stagePveVictoryJournal('hero-a', victory()), true);
const unresolvedBytes = entries.get('territory:pve-victory-wal:v1:hero-a');
globalThis.__mockServer = {revision:nextRevision,state:original(),gold:10,gems:2};
assert.equal(await recoverPveVictoryOnBoot('hero-a', profile()), null);
assert.equal(archiveUnresolvedPveVictoryForCloudEntry('hero-a'), true);
assert.equal(pendingPveVictoryJournal('hero-a'), false);
assert.equal(hasUnresolvedPveVictoryArchive('hero-a'), true);
assert.equal(entries.get('territory:pve-victory-unresolved:v1:hero-a:0'), unresolvedBytes);
const beforeCloudEntry = globalThis.__mockWrites;
assert.deepEqual(await recoverPveVictoryOnBoot('hero-a', profile()), {
  state:globalThis.__mockServer.state,recovered:false,
});
assert.equal(globalThis.__mockWrites, beforeCloudEntry,
  'Continuing from cloud cannot issue a local PvE reward or cloud write');

// Never overwrite the backup when a later, distinct WAL needs separate help.
globalThis.__mockServer = {revision:baseRevision,state:original(),gold:10,gems:2};
globalThis.__mockTokens.set('hero-a', baseRevision);
assert.equal(stagePveVictoryJournal('hero-a', {...victory(),chapterWins:2}), true);
const secondUnresolvedBytes = entries.get('territory:pve-victory-wal:v1:hero-a');
assert.equal(archiveUnresolvedPveVictoryForCloudEntry('hero-a'), true);
assert.equal(entries.get('territory:pve-victory-unresolved:v1:hero-a:0'), unresolvedBytes);
assert.equal(entries.get('territory:pve-victory-unresolved:v1:hero-a:1'), secondUnresolvedBytes);

// Full archive or storage failure: do not discard the blocking source WAL.
reset();
assert.equal(stagePveVictoryJournal('hero-a', victory()), true);
for (let i=0; i<16; i++) entries.set('territory:pve-victory-unresolved:v1:hero-a:'+i, 'older-'+i);
assert.equal(archiveUnresolvedPveVictoryForCloudEntry('hero-a'), false);
assert.equal(pendingPveVictoryJournal('hero-a'), true);
reset();
assert.equal(stagePveVictoryJournal('hero-a', victory()), true);
const originalSetItemForArchive = localStorage.setItem;
localStorage.setItem = () => { throw Error('storage full'); };
assert.equal(archiveUnresolvedPveVictoryForCloudEntry('hero-a'), false);
assert.equal(pendingPveVictoryJournal('hero-a'), true);
localStorage.setItem = originalSetItemForArchive;

// Bad WAL and disabled persistent storage fail closed.
reset();
entries.set('territory:pve-victory-wal:v1:hero-a', '{corrupt');
assert.equal(pendingPveVictoryJournal('hero-a'), true);
assert.equal(await recoverPveVictoryOnBoot('hero-a', profile()), null);
assert.equal(globalThis.__mockWrites, 0);
reset();
const savedSetItem = localStorage.setItem;
localStorage.setItem = () => { throw Error('storage disabled'); };
assert.equal(canJournalPveVictory(), false);
assert.equal(stagePveVictoryJournal('hero-a', victory()), false);
localStorage.setItem = savedSetItem;

// Statically assert runtime integration points beyond the isolated mock.
const fight = readFileSync('src/components/pve/PveFight.tsx', 'utf8');
const battle = readFileSync('src/components/BattleScreen.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const cloud = readFileSync('src/game/cloud.ts', 'utf8');
assert.equal((fight.match(/stagePveVictoryJournal\(userId, nextState\)/g) ?? []).length, 2);
assert.match(fight, /persistPveVictoryJournal\(userId, snapshot\)/);
assert.match(battle, /!canJournalPveVictory\(\)/);
assert.match(battle, /retryPveVictoryJournal\(userId\)/);
assert.ok(app.indexOf('await recoverPveVictoryOnBoot(user.id, profile)') < app.indexOf('useGame.set(loadedState)'));
assert.match(app, /onRetry=\{loadError === 'pve_recovery_pending'/,
  'Blocked player must have a safe retry rather than a permanent splash');
assert.match(app, /setLoadRetry\(attempt => attempt \+ 1\)/,
  'Retry must rerun cloud load and exact victory recovery without deleting WAL');
assert.match(app, /\[user\.id, user\.displayName, loadRetry\]/,
  'Retry must rerun authenticated bootstrap without bypassing recovery guard');
assert.match(cloud, /\.eq\('updated_at', expected\)/);
console.log('PvE restart recovery PASS: crash, lost ACK, stale conflict, exact save, two users, offline, corrupt WAL and storage denial.');
