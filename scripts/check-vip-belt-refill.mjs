import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const bundle = await build({
  entryPoints: [resolve('src/game/belt.ts')], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const belt = await import('data:text/javascript;base64,' +
  Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
const item = (id, name, qty, expiresAt, type = 'potion') => ({
  id, name, qty, type, rarity: 'common', icon: '🧪', description: name,
  effect: { stat: type === 'elixir' ? 'attack' : 'hp', value: 50 },
  expiresAt,
});
const ctx = (wins = 0) => ({ level: 90, activeDays: 90, arenaWins: wins });
const total = (state) => [...state.inventory, ...state.belt.filter(Boolean)]
  .reduce((acc, part) => acc + part.qty, 0);
const base = { belt: Array(7).fill(null), inventory: [], player: { level: 90 }, activeDays: 0 };

const nearDeadline=days(2), farDeadline=days(6);
const original = { ...base, inventory: [
  item('near','Healing',5,nearDeadline), item('far','Healing',5,farDeadline),
]};
const selected = belt.putInBelt(original,'near',ctx());
assert(selected);
assert.equal(selected.beltRefillChoices[0].name,'Healing');
assert.equal(total(selected),total(original));

const afterUse = belt.consumeBelt(selected,0);
assert.equal(afterUse.belt[0].qty,4);
const filled = belt.refillBeltFromInventory(afterUse,ctx());
assert.equal(filled.belt[0].qty,4,'different expiry must not merge');
assert.equal(total(filled),total(afterUse),'no stock may be minted');
assert.equal(belt.refillBeltFromInventory(filled,ctx()),filled,'idempotent when nothing compatible');

let usedAll = selected;
for(let i=0;i<5;i++)usedAll=belt.consumeBelt(usedAll,0);
assert.equal(usedAll.belt[0],null,'last potion is consumed');
assert.equal(usedAll.beltRefillChoices[0].name,'Healing','choice persists after empty');
const fromFar = belt.refillBeltFromInventory(usedAll,ctx());
assert.equal(fromFar.belt[0].qty,5);
assert.equal(fromFar.belt[0].expiresAt,farDeadline,'new lot keeps its own deadline');
assert.equal(total(fromFar),total(usedAll));
assert.equal(belt.refillBeltFromInventory(fromFar,ctx()),fromFar);

const wrongKind = { ...usedAll, inventory: [item('other','Attack',5,days(3),'elixir')] };
assert.equal(belt.refillBeltFromInventory(wrongKind,ctx()),wrongKind,
  'auto refill may not substitute a different consumable kind');

const afterRemove = belt.takeFromBelt(selected,0);
assert.equal(afterRemove.beltRefillChoices[0],null,'unequip erases choice');
assert.equal(belt.refillBeltFromInventory(afterRemove,ctx()),afterRemove,
  'manual opt-out must not be undone');

const locked = { ...base, inventory: [item('a','Healing',6,days(3))],
  beltRefillChoices: [null, { type:'potion', name:'Healing', rarity:'common',
    effect:{stat:'hp',value:50} },...Array(5).fill(null)] };
assert.equal(belt.refillBeltFromInventory(locked,ctx(99)),locked,
  'VIP must not unlock Arena win-gated belt slots');

const dated = { ...usedAll, inventory: [
  item('expired','Healing',100,days(-1)),item('valid','Healing',3,days(4)),
]};
const unexpired = belt.refillBeltFromInventory(dated,ctx());
assert.equal(unexpired.belt[0].qty,3);
assert.equal(unexpired.inventory[0].qty,100,'expired batch cannot be used');

const multi = { ...base, inventory: [
  item('heal','Healing',5,days(3)),
  item('attack','Attack',5,days(3),'elixir'),
]};
const first = belt.putInBelt(multi,'heal',ctx(100));
const second = belt.putInBelt(first,'attack',ctx(100));
assert.equal(second.belt[0].name,'Healing');
assert.equal(second.belt[1].name,'Attack');
assert.equal(total(second),total(multi));
console.log('VIP smart belt: batch provenance, 5-stack, chosen kinds, expiry, slot gates, no minting, idempotence: PASS');
