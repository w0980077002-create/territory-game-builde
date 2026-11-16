import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const compile=async entry=>{
  const result=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent',define:{'import.meta.env':'{}'},
    plugins:[{name:'offline-supabase',setup(b){
      b.onResolve({filter:/supabase$/},()=>({path:'fixture',namespace:'offline'}));
      b.onLoad({filter:/.*/,namespace:'offline'},()=>({contents:`export const supabase={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:globalThis.__stage8Row,error:null})})})})};`}));
    }}]});
  const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
  return module.exports;
};
const cloud=await compile('src/game/cloud.ts');
const actions=await compile('src/game/actions.ts');
const gear={id:'stage8_70000000-0000-4000-8000-000000000061',slot:'weapon',name:'Героический меч',
  rarity:'epic',level:61,baseLevel:5,upgradeCount:56,baseStats:{attack:99},attack:999};
const item={id:gear.id,qty:1,type:'equipment',name:gear.name,rarity:gear.rarity,equipment:gear};
const raw={balanceVersion:0,player:{name:'Fixture',level:1,gold:100,equipped:{}},inventory:[item],belt:[]};
globalThis.__stage8Row={game_state:raw,gold:100,gems:0,arena_rating:1000,arena_wins:0,arena_losses:0,
  updated_at:'2026-11-16T00:00:00.000Z',display_name:'Fixture',vip_level:0,photo_url:null};
const profile=await cloud.loadCloudSave('10000000-0000-4000-8000-000000000001','Fixture');
assert.deepEqual(profile.state.inventory[0].equipment,gear,'Real cloud load preserves mirror before old balance migration');
assert.deepEqual(raw.inventory[0],item);
assert.strictEqual(actions.equipItem(profile.state,item),profile.state,'Level-1 owner cannot equip level-61 gear');
const strong={...profile.state,player:{...profile.state.player,level:100}};
const equipped=actions.equipItem(strong,item);
assert.deepEqual(equipped.player.equipped.weapon,gear);
assert.equal(equipped.inventory.length,0);
const unequipped=actions.unequipItem(equipped,'weapon');
assert.equal(unequipped.inventory[0].id,gear.id,'Unequip preserves outer and inner UUID');
assert.deepEqual(unequipped.inventory[0].equipment,gear);
const other={...item,id:'ordinary',equipment:{...gear,id:'ordinary',level:1}};
const replaced=actions.equipItem({...equipped,inventory:[other]},other);
assert.equal(replaced.inventory[0].id,gear.id,'Replacing equipped gear also preserves UUID');
delete globalThis.__stage8Row;
console.log('PASS #366 client: real cloud load, old migration, equip denial, unequip/swap UUID');
