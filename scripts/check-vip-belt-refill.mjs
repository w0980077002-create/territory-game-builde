import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

async function load(path) {
  const compiled = await build({ entryPoints:[resolve(path)], bundle:true, platform:'node',
    format:'esm', write:false, logLevel:'silent' });
  const data = Buffer.from(compiled.outputFiles[0].text).toString('base64');
  return import('data:text/javascript;base64,' + data);
}
const { refillVipBeltAfterBattle, BELT_STACK } = await load('src/game/belt.ts');
const { activeVipForBenefits, VIP_AUTO_BELT_LEVEL } = await load('src/game/vipProgram.ts');
assert.equal(BELT_STACK, 5);
assert.equal(VIP_AUTO_BELT_LEVEL, 3);
assert.equal(activeVipForBenefits({vip:9,permanentVip:0,vipRemaining:0,vipCheckedAt:0},100),0,
  'Preview or expired temporary VIP never unlocks benefits');
assert.equal(activeVipForBenefits({vip:5,permanentVip:0,vipRemaining:1000,vipCheckedAt:50},100),5);
assert.equal(activeVipForBenefits({vip:2,permanentVip:3,vipRemaining:0,vipCheckedAt:0},100),3);

const twoDays = new Date(Date.now() + 2*86_400_000).toISOString();
const sixDays = new Date(Date.now() + 6*86_400_000).toISOString();
const elixir = (id,qty,expiresAt=twoDays) => ({id,qty,name:'Эликсир силы',icon:'💪',
  type:'elixir',rarity:'common',effect:{stat:'attack',value:10,duration:'battle'},expiresAt});
const empty = () => Array(7).fill(null);
const initial = {player:{level:61},activeDays:5,
  inventory:[elixir('stock',8)],belt:[elixir('belt_0',2),...Array(6).fill(null)]};
const selected = [elixir('belt_0',5),...Array(6).fill(null)];
assert.strictEqual(refillVipBeltAfterBattle(initial,selected,0,0),initial,'No VIP: manual only');
assert.strictEqual(refillVipBeltAfterBattle(initial,selected,0,2),initial,'VIP2: manual only');
const filled = refillVipBeltAfterBattle(initial,selected,0,3);
assert.equal(filled.belt[0].qty,5);
assert.equal(filled.inventory[0].qty,5);
assert.equal(initial.inventory[0].qty,8,'Original state remains immutable');
assert.strictEqual(refillVipBeltAfterBattle(filled,selected,0,3),filled,'Already full: idempotent');

const depleted = {...initial,belt:empty()};
const recovered = refillVipBeltAfterBattle(depleted,selected,0,3);
assert.equal(recovered.belt[0].qty,5,'Selected empty slot refills after final dose');
assert.equal(recovered.inventory[0].qty,3);

const batchState = {...initial,belt:empty(),inventory:[
  elixir('later',3,sixDays),elixir('earlier',4,twoDays)]};
const combined = refillVipBeltAfterBattle(batchState,selected,0,3);
assert.equal(combined.belt[0].qty,5,'VIP combines identical different-date lots');
assert.equal(combined.belt[0].expiresAt,undefined,'No expiry remains on belt');
assert.equal(combined.inventory.find(x=>x.id==='earlier')?.qty,2,'Keeps untouched excess doses');
assert.equal(combined.inventory.some(x=>x.id==='later'),false);
const existingDifferentExpiry = {...initial,inventory:[elixir('later',8,sixDays)]};
const toppedDifferent = refillVipBeltAfterBattle(existingDifferentExpiry,selected,0,3);
assert.equal(toppedDifferent.belt[0].qty,5,'A partial belt accepts different historical dates');
assert.equal(toppedDifferent.inventory[0].qty,5,'Exactly three existing doses are moved');

const locked = {...initial,inventory:[elixir('stock',12)],
  belt:[null,elixir('belt_1',1),...Array(5).fill(null)]};
const blocked = refillVipBeltAfterBattle(locked,[null,elixir('belt_1',5),...Array(5).fill(null)],0,3);
assert.strictEqual(blocked,locked,'VIP does not unlock win-gated belt slots');

const expired = {...initial,inventory:[elixir('outdated',8,new Date(Date.now()-1000).toISOString())]};
const revived = refillVipBeltAfterBattle(expired,selected,0,3);
assert.equal(revived.belt[0].qty,5,'Even historical expired stock is valid and refills');
assert.equal(revived.inventory[0].qty,5);
console.log('VIP3+ permanent consumable refill: manual non-VIP, cross-lot totals, win locks, idempotence OK');
