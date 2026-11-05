import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const built=await build({entryPoints:['src/game/vipBeltClassic.ts'],bundle:true,
  platform:'node',format:'esm',write:false,logLevel:'silent'});
const {prepareClassicPveBeltSnapshot:refill}=await import(
  'data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

const choice={type:'potion',name:'Healing',rarity:'common',effect:{stat:'hp',value:50}};
const item=(id,qty,expiresAt='2099-01-01T00:00:00Z')=>({id,qty,
  type:'potion',name:'Healing',rarity:'common',description:'HP',
  icon:'potion.webp',effect:choice.effect,expiresAt});
const state=()=>({autoRefillBelt:true,player:{level:90,gold:100,gems:20},
  activeDays:90,belt:Array(7).fill(null),
  inventory:[item('stock',5)],beltRefillChoices:[choice,...Array(6).fill(null)]});
const account=(tier=5)=>({permanentVip:tier,vip:tier,vipRemaining:0,vipCheckedAt:10});
const total=s=>[...s.inventory,...s.belt.filter(Boolean)].reduce((n,x)=>n+x.qty,0);

const original=state();
const winner=refill(original,account(),100,100);
assert.notStrictEqual(winner,original);
assert.equal(winner.belt[0].qty,5);
assert.equal(winner.inventory.length,0);
assert.equal(total(winner),total(original));
assert.equal(original.belt[0],null,'must not mutate result or original inventory');
assert.strictEqual(refill(winner,account(),100,100),winner,'same snapshot cannot transfer stock twice');

// Both terminal outcomes save the SAME pure snapshot. No extra gold/XP/currency.
const afterLoss=refill(state(),account(),100,100);
assert.equal(afterLoss.player.gold,100);
assert.equal(afterLoss.player.gems,20);
assert.equal(afterLoss.belt[0].qty,5);

// A VIP2/disabled/expired temp cannot move consumables.
const ordinary=state();
assert.strictEqual(refill(ordinary,account(2),100,100),ordinary);
assert.strictEqual(refill({...ordinary,autoRefillBelt:false},account(),100,100).belt[0],null);
const temp={permanentVip:0,vip:3,vipRemaining:2000,vipCheckedAt:100};
assert.equal(refill(state(),temp,100,2099).belt[0].qty,5);
assert.strictEqual(refill(ordinary,temp,100,2101),ordinary,'expired temporary VIP cannot refill');
assert.strictEqual(refill(ordinary,account(),-1,100),ordinary,'bad Arena wins cannot unlock slots');
const expired=state();
expired.inventory=[item('expired',5,'2020-01-01T00:00:00Z')];
assert.strictEqual(refill(expired,account(),100,100),expired,'expired stock must remain untouched');

// The post-fight UI must never call the pure refill again upon Next/Back.
const fight=readFileSync('src/components/pve/PveFight.tsx','utf8');
const battle=readFileSync('src/components/BattleScreen.tsx','utf8');
assert.match(fight,/prepareClassicPveBeltSnapshot\(recordTrialWin/);
assert.match(fight,/prepareClassicPveBeltSnapshot\(recordBattleResult/);
assert.match(fight,/if \(!won\) \{[\s\S]*?stagePveVictoryJournal\(userId, refilledState\)/);
assert.match(fight,/saveRequired = outcome\.won \|\| victorySnapshotRef\.current !== null/);
assert.match(fight,/disabled=\{nextPending \|\| \(saveRequired && saveState !== 'confirmed'\)\}/);
assert.doesNotMatch(battle,/refillAfterConfirmedBattle|refillBeltFromInventory/);
assert.match(fight,/confirmPveVictorySave\(userId, \(\) => persistPveVictoryJournal\(userId, snapshot\)\)/);
console.log('Classic PvE VIP: win/loss refills inside same WAL and CAS snapshot, no replay or reward creation PASS');
