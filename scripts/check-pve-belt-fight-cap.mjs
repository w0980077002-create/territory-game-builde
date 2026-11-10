import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const compiled = await build({ entryPoints:[resolve('src/game/belt.ts')], bundle:true,
  platform:'node',format:'esm',write:false,logLevel:'silent' });
const moduleUrl='data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64');
const { canSpendSnapshottedBattleCharge, consumeBelt }=await import(moduleUrl);
const potion=(qty=5)=>({id:'belt_0',name:'Большое зелье здоровья',icon:'⚗️',
 type:'potion',rarity:'rare',qty,effect:{stat:'hp',value:150,duration:'instant'},
 expiresAt:'2099-01-01T00:00:00Z'});
const selected=[potion(),null,null,null,null,null,null];
const state={belt:selected,inventory:[]};
assert.equal(canSpendSnapshottedBattleCharge(selected,state.belt,0,0),true);
let current=consumeBelt(state,0);
assert.equal(current.belt[0].qty,4);
assert.equal(canSpendSnapshottedBattleCharge(selected,current.belt,0,1),true);
assert.equal(canSpendSnapshottedBattleCharge(selected,[potion(),...selected.slice(1)],0,1),false,
 'Second tab or reload cannot replenish during same fight');
assert.equal(canSpendSnapshottedBattleCharge(selected,[{...potion(4),name:'Зелье здоровья'},...selected.slice(1)],0,1),false);
assert.equal(canSpendSnapshottedBattleCharge(selected,selected,0,5),false,'Sixth use blocked');
assert.equal(canSpendSnapshottedBattleCharge(selected,[potion(6),...selected.slice(1)],0,0),false);
const two=[potion(2),...selected.slice(1)];
assert.equal(canSpendSnapshottedBattleCharge(two,[potion(1),...selected.slice(1)],0,1),true);
assert.equal(canSpendSnapshottedBattleCharge(two,[potion(2),...selected.slice(1)],0,1),false);
const fight=readFileSync('src/components/pve/PveFight.tsx','utf8');
assert.match(fight,/canSpendSnapshottedBattleCharge\(beltAtFightStart\.current, latest\.belt, i, used\)/);
assert.match(fight,/usedPotionCharges\.current\[i\] = used \+ 1/);
console.log('Classic PvE fight belt snapshot: no mid-fight refill, swap or sixth charge.');
