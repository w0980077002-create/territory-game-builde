/**
 * Real V4 balance module regression for historical local crafted inventory.
 * No connected database, API keys, game saves, or test players are touched.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');

const compile=(source,name)=>ts.transpileModule(source,{fileName:name,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
const source=await readFile(new URL('../src/game/equipmentBalance.ts',import.meta.url),'utf8');
const catalogSource=await readFile(new URL('../src/game/equipmentCatalog.ts',import.meta.url),'utf8');
const catalogModule={exports:{}};
new Function('require','module','exports',compile(catalogSource,'equipmentCatalog.ts'))((name)=>{
  throw new Error('Unexpected catalog dependency: '+name);
},catalogModule,catalogModule.exports);
const module={exports:{}};
new Function('require','module','exports',compile(source,'equipmentBalance.ts'))((name)=>{
  if(name==='./equipmentCatalog')return catalogModule.exports;
  throw new Error('Unexpected balance dependency: '+name);
},module,module.exports);
const api=module.exports;
const id=(recipe,n)=>`crafted-${recipe}-1792437103735-${n}`;
const make=(recipe,name,slot,rarity,level,baseLevel,baseStats,stats,suffix)=>
  ({id:id(recipe,suffix),name,slot,rarity,level,baseLevel,baseStats,
    upgradeCount:level-baseLevel,icon:'⚒️',...stats});
const amulet=make('jeweler_raven_amulet','Амулет ворона мастера','amulet','rare',
  61,61,{attack:34,critChance:2},{attack:34,critChance:2},'wmb8rq');
const boosted=api.rebalanceLegacyCraftedEquipment(amulet);
assert.equal(boosted.attack,42,'61-lvl crafted amulet must beat 35 shop attack by 20%');
assert.equal(boosted.critChance,4,'61-lvl crafted amulet must beat shop 3% crit');
assert.equal(boosted.level,61);
assert.equal(boosted.baseLevel,61);
assert.equal(boosted.upgradeCount,0);
assert.equal(boosted.id,amulet.id);
assert.equal(boosted.name,'Амулет ворона мастера · мастерская');
assert.deepEqual(api.rebalanceLegacyCraftedEquipment(boosted),boosted,'Repeated login cannot compound boosts');
assert.deepEqual(api.normalizeEquipmentV4(boosted),boosted,'Generic normalizer must not nerf premium');
const advanced=api.upgradeEquipment(boosted);
assert.equal(advanced.level,62);
assert.ok(advanced.attack>=44,'After forge the masterwork retains a 20% same-level shop advantage');
assert.equal(advanced.critChance,4);
assert.equal(advanced.id,amulet.id);

const fresh=make('jeweler_raven_amulet','Амулет ворона мастера','amulet','rare',
  3,3,{attack:6,critChance:3},{attack:6,critChance:3},'lklxxg');
assert.equal(api.rebalanceLegacyCraftedEquipment(fresh).attack,8);
assert.equal(api.rebalanceLegacyCraftedEquipment(fresh).critChance,4);

const leather=make('smith_leather_armor','Кожаная броня','armor','common',
  1,1,{defense:5,hp:30},{defense:5,hp:30},'armor');
const leatherAfter=api.normalizeEquipmentV4(leather);
assert.equal(leatherAfter.defense,6);
assert.equal(leatherAfter.hp,36);
assert.equal(leatherAfter.name,'Кожаная броня · мастерская',
  'A distinct craft name must not be canonicalized to shop 5/30');

const sword=make('smith_apprentice_blade','Меч подмастерья','weapon','common',
  1,1,{attack:8},{attack:8},'sword');
assert.equal(api.normalizeEquipmentV4(sword).attack,10);

const shield=make('engineer_oak_shield','Укреплённый щит','shield','common',
  60,2,{defense:5,hp:25},{defense:34,hp:54},'shield');
shield.adminTestLevel=true;
const stronger=api.rebalanceLegacyCraftedEquipment(shield);
assert.equal(stronger.defense,41);
assert.equal(stronger.hp,65);
assert.equal(stronger.level,60);
assert.equal(stronger.upgradeCount,58);
assert.equal(stronger.adminTestLevel,true,'Owner-approved level flag must not be revoked');
const shieldNext=api.upgradeEquipment(stronger);
assert.ok(shieldNext.defense>=42&&shieldNext.hp>=66,'Forge keeps the shield premium');

const shop={...amulet,id:'shop_amulet_raven_eq',name:'Амулет ворона',attack:35,critChance:3};
assert.deepEqual(api.rebalanceLegacyCraftedEquipment(shop),shop,'Shop must not receive free boosts');
const fake={...amulet,id:'user-custom-amulet'};
assert.deepEqual(api.rebalanceLegacyCraftedEquipment(fake),fake,'Non-craft IDs are not eligible');
const stage8={...amulet,id:'stage8_89a22504-90f5-4c98-b7e1-5cc680186ffa'};
assert.deepEqual(api.rebalanceLegacyCraftedEquipment(stage8),stage8,'Server-owned receipts are separate');
const forged={...amulet,id:'crafted-jeweler_raven_amulet-abc-nope'};
assert.deepEqual(api.rebalanceLegacyCraftedEquipment(forged),forged,'Malformed IDs never qualify');
const wrong={...amulet,name:'Кольцо силы'};
assert.deepEqual(api.rebalanceLegacyCraftedEquipment(wrong),wrong,'A forged name never qualifies');

const stored={
  balanceVersion:api.EQUIPMENT_BALANCE_VERSION,
  player:{equipped:{shield}},
  inventory:[{id:amulet.id,name:amulet.name,icon:'📿',type:'equipment',rarity:'rare',qty:1,equipment:amulet},
    {id:leather.id,name:leather.name,icon:'🦺',type:'equipment',rarity:'common',qty:1,equipment:leather},
    {id:'shop-test',name:'Shop',qty:1,type:'material'}],
  belt:[{id:sword.id,name:sword.name,icon:'⚔️',type:'equipment',rarity:'common',qty:1,equipment:sword}],
};
const restored=api.migrateGameStateBalance(stored);
assert.equal(restored.inventory[0].equipment.attack,42);
assert.equal(restored.inventory[0].name,'Амулет ворона мастера · мастерская');
assert.equal(restored.inventory[1].equipment.hp,36);
assert.equal(restored.player.equipped.shield.defense,41);
assert.equal(restored.belt[0].equipment.attack,10);
assert.deepEqual(restored.inventory[2],stored.inventory[2]);
assert.deepEqual(api.migrateGameStateBalance(restored),restored,'Already-V4 saves remain idempotent');

console.log('Legacy crafted parity PASS: V4 inventories, equipped, belt, 4 recipes, lvl61 + forge, names, no shop or server-registry mutations.');
