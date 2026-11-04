import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Real production checkpoint module, executed in isolation: no database,
 // no user data, no currency grants or fake server settlement.
const bundle = await build({
  entryPoints: ['src/game/pveVictorySaveFence.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const {
  pveVictorySaveBlocked, pveVictorySaveState, confirmPveVictorySave, subscribePveVictorySave,
} = await import('data:text/javascript;base64,' +
  Buffer.from(bundle.outputFiles[0].text).toString('base64'));

assert.equal(pveVictorySaveBlocked('hero-a'), false);
assert.equal(pveVictorySaveState('hero-a'), null);
const publishedStates = [];
const unsubscribe = subscribePveVictorySave('hero-a', () => publishedStates.push(pveVictorySaveState('hero-a')));

let release, writes = 0;
const first = confirmPveVictorySave('hero-a', () => {
  writes++;
  return new Promise(resolve => { release = resolve; });
});
const duplicate = confirmPveVictorySave('hero-a', async () => {
  writes++;
  return true;
});
assert.equal(first, duplicate, 'A second click must reuse the same in-flight save');
assert.equal(pveVictorySaveBlocked('hero-a'), true, 'Unconfirmed victory blocks next paid battle');
assert.equal(pveVictorySaveState('hero-a'), 'pending');
await Promise.resolve();
assert.equal(writes, 1, 'One in-flight save, not duplicate writes');
release(false);
assert.equal(await first, false);
assert.equal(pveVictorySaveState('hero-a'), 'failed');
assert.equal(pveVictorySaveBlocked('hero-a'), true, 'Network failure cannot open the Next gate');

assert.equal(await confirmPveVictorySave('hero-a', async () => {
  writes++; return true;
}), true);
assert.equal(writes, 2, 'Retry is a SAVE only, not a battle or reward replay');
assert.equal(pveVictorySaveState('hero-a'), 'confirmed');
assert.equal(pveVictorySaveBlocked('hero-a'), false);

const secondVictory = confirmPveVictorySave('hero-a', async () => false);
assert.equal(pveVictorySaveBlocked('hero-a'), true, 'Next victory must start a new checkpoint');
assert.equal(await secondVictory, false);
assert.equal(pveVictorySaveBlocked('hero-a'), true);
assert.equal(await confirmPveVictorySave('hero-a', () => Promise.reject(Error('offline'))), false);
assert.equal(pveVictorySaveState('hero-a'), 'failed');
assert.equal(pveVictorySaveBlocked('hero-a'), true, 'Rejected writer cannot silently claim success');
assert.equal(await confirmPveVictorySave('hero-a', async () => true), true);
assert.equal(pveVictorySaveBlocked('hero-a'), false);

assert.equal(await confirmPveVictorySave('hero-b', async () => false), false);
assert.equal(pveVictorySaveBlocked('hero-b'), true);
assert.equal(pveVictorySaveBlocked('hero-a'), false, 'A different hero must never inherit someone else\'s fence');
assert.equal(await confirmPveVictorySave('hero-b', async () => true), true);
assert.ok(['pending','confirmed','failed'].every(state => publishedStates.includes(state)),
  'Navigating back from the result must receive asynchronous save state changes');
unsubscribe();

const fight = readFileSync('src/components/pve/PveFight.tsx', 'utf8');
const battle = readFileSync('src/components/BattleScreen.tsx', 'utf8');
const cloud = readFileSync('src/game/cloud.ts', 'utf8');
assert.match(fight, /confirmPveVictorySave\(userId, \(\) => saveCloudSave\(userId, snapshot\)\)/,
  'Each local victory must await the existing cloud save writer');
assert.equal((fight.match(/confirmVictory\(nextState\);/g) || []).length, 2,
  'Campaign AND Trials wins must request durable save confirmation');
assert.match(fight, /data-testid="pve-victory-save-status"/,
  'The player sees pending/confirmed/failed victory save');
assert.match(fight, /data-testid="pve-victory-save-retry"/,
  'Failed saves can be retried without granting another reward');
assert.match(fight, /disabled=\{nextPending \|\| \(outcome\.won && saveState !== 'confirmed'\)\}/,
  'Next cannot spend stones while a victory is unsaved');
assert.match(battle, /if \(pveVictorySaveBlocked\(userId\) \|\| saveBlocked\.has\(userId\)\)/,
  'Returning to Campaign/Trials must not bypass a pending victory checkpoint');
assert.match(battle, /subscribePveVictorySave\(userId/,
  'BattleScreen must refresh after a pending save is acknowledged');
assert.match(battle, /data-testid="pending-pve-save"/,
  'Players can recover after leaving the result panel');
assert.match(battle, /data-testid="pve-retry-save-before-fight"/,
  'Recovery must retry the existing save, never replay the battle');
assert.match(battle, /disabled=\{battleStartBlocked \|\| fightStartLocked\.current\}/,
  'The primary Campaign action must honor the save fence');
assert.match(cloud, /\.eq\('updated_at', expected\)/,
  'Checkpoint uses the existing stale-save CAS protection');
assert.match(cloud, /saveBlocked\.add\(userId\)/,
  'Multi-device conflict must not be bypassed');

console.log('PvE victory save fence PASS: concurrent taps, offline/retry, two users, both modes, exit/re-entry and no new stone debit before cloud ACK.');
