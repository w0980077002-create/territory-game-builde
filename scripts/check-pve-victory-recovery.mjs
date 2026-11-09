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
