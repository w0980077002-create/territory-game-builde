import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const battle = readFileSync('src/components/BattleScreen.tsx', 'utf8');

// When the Cave has a pending debit/receipt, legacy Campaign and Trials must
// not offer clickable fight buttons that silently fail or spend a second stone.
assert.match(battle, /const caveRecoveryNeeded = view !== 'cave'/);
assert.match(battle, /if \(caveRecoveryNeeded\) \{/, 'Keep the authoritative start fence');
assert.match(battle, /id="pending-cave-recovery" role="alert"/, 'Recovery explanation must be accessible');
assert.equal((battle.match(/blocked=\{caveRecoveryNeeded\}/g) || []).length, 2,
  'Both Campaign and Trials must receive the pending-recovery fence');
assert.equal((battle.match(/disabled=\{blocked\}/g) || []).length, 2,
  'Both fight buttons must visibly disable during pending Cave recovery');
assert.equal((battle.match(/aria-describedby=\{blocked \? 'pending-cave-recovery' : undefined\}/g) || []).length, 2,
  'Disabled fight buttons must explain the reason');
assert.match(battle, /caveRecoveryNeeded \? \(\) => \{ setError\(null\); onView\('cave'\); \} : onShop/,
  'A pending Cave action must lead to recovery, not the shop');
assert.match(battle, /!caveRecoveryNeeded && <ShoppingBag/,
  'Do not display a shop icon for the recovery action');
assert.match(battle, /onClick=\{\(\) => onView\('cave'\)\}/,
  'Always retain an explicit recovery button');
assert.match(battle, /if \(view === 'cave' \|\| caveRecoveryNeeded\) return;/,
  'Auto-start must not charge stones during pending recovery');

console.log('PvE pending Cave recovery controls PASS: no misleading shop or clickable legacy fights.');
