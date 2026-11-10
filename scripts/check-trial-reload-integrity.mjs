import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = name => readFileSync(name,'utf8');
const app=file('src/App.tsx');
const battle=file('src/components/BattleScreen.tsx');
const fight=file('src/components/pve/PveFight.tsx');
const trial=file('src/game/trialGauntlet.ts');
const rewards=file('src/game/progression.ts');
const recovery=file('src/game/pveVictoryRecovery.ts');
const belt=file('src/game/belt.ts');
const save=file('src/game/immediateSave.ts');

// Refresh intentionally starts from City and drops any local React fight/wave.
// This means restart at the first monster on the SAVED floor, NOT at global floor 1.
assert.match(app,/useState<Screen>\('city'\)/);
assert.match(battle,/useState<\{ enemy: Enemy; kind: FightKind; id: number \} \| null>\(null\)/);
assert.match(battle,/generateTrial\(paid\.trialLevel\)/,'Must start the current saved floor');
assert.match(battle,/setFight\(\{ enemy, kind, id: Date\.now\(\) \}\)/);
assert.match(fight,/const \[waveIndex, setWaveIndex\] = useState\(0\)/);
assert.match(fight,/buildTrialGauntlet\(enemy, heroSide\(useGame\.get\(\)\)\)/);
assert.match(trial,/export const TRIAL_REGULAR_ENEMIES = 5;/);
assert.match(trial,/export const TRIAL_ENCOUNTERS_PER_FLOOR = TRIAL_REGULAR_ENEMIES \+ 1;/);

// A restart may not skip the stone budget or grant a completed-floor reward.
assert.match(battle,/kind === 'trial'[\s\S]*?\(s\.battleStones >= PVE_STONE_COST \? s : null\)/);
assert.match(fight,/if \(kind === 'trial'\) \{\s*const paidStrike = spendStones\(useGame\.get\(\), PVE_STONE_COST\)/);
assert.match(fight,/if \(!paidStrike\) \{\s*finish\(false, 'out_of_stones'\);/);
assert.match(fight,/waveIndex \+ 1 < trialWaves\.length/,'Intermediate enemy must not award floor');
assert.match(fight,/\} else finish\(true\);/,'Last guardian must be the win');
assert.match(rewards,/const canReserveChest = !!trialChestTier\(floor\) && !\(state\.trialChestClaims \?\? \[\]\)\.includes\(floor\)/);
assert.match(rewards,/trialLevel: next\.trialLevel \+ 1/);
assert.match(fight,/stagePveVictoryJournal\(userId, nextState\)/);
assert.match(battle,/pveVictorySaveBlocked\(userId\) \|\| saveBlocked\.has\(userId\) \|\| pendingPveVictoryJournal\(userId\)/);
assert.match(recovery,/recoverPveVictoryOnBoot/);

// A new encounter's UI cannot replenish a live belt mid-battle by a second tab.
// This remains client-side only; server-side per-strike cost and state authority
// are REQUIRED for full protection against fast refreshes and modified clients.
assert.match(fight,/canSpendSnapshottedBattleCharge\(beltAtFightStart\.current, latest\.belt, i, used\)/);
assert.match(belt,/export function canSpendSnapshottedBattleCharge/);

// Cloud save is asynchronous: pagehide flush is not atomic with a reload.
// Keep this test's warning current until issue #466's server-side strike RPC lands.
assert.match(app,/window\.addEventListener\('pagehide', flush\)/);
assert.match(save,/void send\(\)/);
assert.match(app,/saveCloudSave\(user\.id, useGame\.get\(\)\)/);

console.log('Trials reload regression PASS: same saved floor, wave 1, no premature chest, paid strikes, save recovery.');
console.log('Known limitation: an uncommitted strike debit can be lost on fast refresh. Server strike ledger still required (issue #466).');
