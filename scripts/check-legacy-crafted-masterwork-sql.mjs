/**
 * Ephemeral PostgreSQL rehearsal for EXACT 37 old local craft items.
 * Includes an already forged level-61 jeweler amulet. NO production access.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const sql=await readFile(new URL('../supabase/staged/territory_legacy_crafted_masterwork_existing_20261113.sql',import.meta.url),'utf8');
const db=new PGlite();
const players=[
  {name:'Amiksor',lvl:61},
  {name:'AndreyRelax',lvl:57},
  {name:'BlackHawkUA',lvl:54},
  {name:'Borntofrag',lvl:60},
  {name:'Pugalo800',lvl:56},
  {name:'Sergei19391',lvl:60},
  {name:'Tainguyen1006',lvl:55},
  {name:'twOneFz',lvl:40},
];
const byName=new Map(players.map((p,i)=>[p.name,{...p,id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,inventory:[],equipped:{}}]));
const gear=(recipe,name,slot,rarity,level,baseLevel,stats,baseStats,nonce)=>({
  id:`crafted-${recipe}-1792437103735-${nonce}`,name,slot,rarity,level,
  baseLevel,upgradeCount:level-baseLevel,baseStats,icon:'⚒️',...stats,
});
const add=(name,eq,equipped=false)=>{
 const p=byName.get(name);
 if(equipped)p.equipped[eq.slot]=eq;
 else p.inventory.push({id:eq.id,name:eq.name,type:'equipment',rarity:eq.rarity,icon:eq.icon,qty:1,
   equipment:eq,description:'old local recipe'});
};
add('Amiksor',gear('jeweler_raven_amulet','Амулет ворона мастера','amulet','rare',
  61,61,{attack:34,critChance:2},{attack:34,critChance:2},'wmb8rq'));
for(let i=0;i<2;i++)add('Amiksor',gear('jeweler_raven_amulet','Амулет ворона мастера','amulet','rare',
  3,3,{attack:6,critChance:3},{attack:6,critChance:3},'ami'+i));
for(let i=0;i<3;i++)add('Sergei19391',gear('jeweler_raven_amulet','Амулет ворона мастера','amulet','rare',
  i===0?4:3,3,{attack:i===0?7:6,critChance:3},{attack:6,critChance:3},'ser'+i));
add('Tainguyen1006',gear('jeweler_raven_amulet','Амулет ворона мастера','amulet','rare',
  3,3,{attack:6,critChance:3},{attack:6,critChance:3},'tai'));
for(let i=0;i<22;i++)add(i===0?'AndreyRelax':'BlackHawkUA',gear('smith_leather_armor','Кожаная броня','armor','common',
  1,1,{defense:5,hp:30},{defense:5,hp:30},'arm'+i));
for(let i=0;i<4;i++)add(i===0?'twOneFz':'BlackHawkUA',gear('smith_apprentice_blade','Меч подмастерья','weapon','common',
  1,1,{attack:8},{attack:8},'sw'+i));
add('Borntofrag',gear('engineer_oak_shield','Укреплённый щит','shield','common',
  60,2,{defense:34,hp:54,adminTestLevel:true},{defense:5,hp:25},'bron'),true);
add('Pugalo800',gear('engineer_oak_shield','Укреплённый щит','shield','common',
  50,2,{defense:29,hp:49},{defense:5,hp:25},'pug'),true);
add('Borntofrag',gear('engineer_oak_shield','Укреплённый щит','shield','common',
  2,2,{defense:5,hp:25},{defense:5,hp:25},'bron2'));
add('Pugalo800',gear('engineer_oak_shield','Укреплённый щит','shield','common',
  2,2,{defense:5,hp:25},{defense:5,hp:25},'pug2'));

assert.equal([...byName.values()].reduce((n,p)=>n+p.inventory.length+Object.keys(p.equipped).length,0),37);
byName.get('Amiksor').equipped.amulet={
  id:'inv_1791013924506_1q9imjh997z',name:'Амулет ворона',slot:'amulet',
  rarity:'rare',level:61,attack:35,critChance:3,
  baseLevel:3,baseStats:{attack:6,critChance:3},upgradeCount:58,
};
const noMaster=byName.get('BlackHawkUA');
noMaster.inventory.push({id:'shop_only',name:'Меч воина',type:'equipment',qty:1,
 equipment:{id:'shop_only',name:'Меч воина',slot:'weapon',rarity:'common',level:1,attack:8}});
noMaster.inventory.push({id:'crafted-artisan_toolkit-1792503371253-3mwta5',
 name:'Набор ремесленника',type:'material',qty:1});
const original=new Map();
const one=async(query,args=[]) => (await db.query(query,args)).rows[0];
const get=(name)=>one('SELECT game_state FROM public.players WHERE id=$1',[byName.get(name).id]);
try{
 await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE SCHEMA territory_private;
  CREATE TABLE public.players(
   id uuid PRIMARY KEY,
   level integer NOT NULL,
   game_state jsonb NOT NULL,
   attack integer DEFAULT 20,
   defense integer DEFAULT 5,
   max_hp integer DEFAULT 100,
   crit_chance integer DEFAULT 5,
   updated_at timestamptz DEFAULT now()
  );
  -- Rehearse the existing owner-level guard that returns an approved shield
  -- from OLD (before our new, alphabetically later masterwork trigger).
  CREATE FUNCTION public.mock_owner_level_restore() RETURNS trigger
  LANGUAGE plpgsql AS $
  BEGIN
    IF NEW.game_state#>>'{player,equipped,shield,adminTestLevel}'='true' THEN
      NEW.game_state:=jsonb_set(NEW.game_state,'{player,equipped,shield}',
        OLD.game_state#>'{player,equipped,shield}');
    END IF;
    RETURN NEW;
  END $;
  CREATE TRIGGER territory_gear_guard_before_v4
    BEFORE UPDATE OF game_state ON public.players
    FOR EACH ROW EXECUTE FUNCTION public.mock_owner_level_restore();
  CREATE FUNCTION public.territory_gear_recompute_columns_v4(jsonb)
  RETURNS jsonb LANGUAGE sql STABLE AS $
    SELECT jsonb_build_object('attack',20,'defense',100,'max_hp',300,'crit_chance',5)
  $;
  GRANT SELECT,UPDATE ON public.players TO authenticated;
 `);
 for(const p of byName.values()){
   const state={player:{level:p.lvl,stats:{attack:20,defense:5},equipped:p.equipped},
     inventory:p.inventory,belt:[],forgeMaterials:55,gold:3000,gems:100,justSomeQuest:{count:3}};
   await db.query('INSERT INTO public.players(id,level,game_state) VALUES($1,$2,$3::jsonb)',
     [p.id,p.lvl,JSON.stringify(state)]);
   original.set(p.name,state);
 }
 await db.exec(sql);
 const row=await get('Amiksor'),state=row.game_state;
 const amu=state.inventory.find(i=>i.id.endsWith('wmb8rq'));
 assert.equal(amu.equipment.level,61);
 assert.equal(amu.equipment.attack,42);
 assert.equal(amu.equipment.critChance,4);
 assert.equal(amu.equipment.name,'Амулет ворона мастера · мастерская');
 assert.equal(state.player.equipped.amulet.attack,35,'Existing shop item must be unchanged');
 const br=(await get('Borntofrag')).game_state.player.equipped.shield;
 assert.equal(br.defense,41);
 assert.equal(br.hp,65);
 assert.equal(br.level,60);
 assert.equal(br.adminTestLevel,true);
 const black=(await get('BlackHawkUA')).game_state;
 assert.equal(black.inventory.find(i=>i.id==='shop_only').equipment.attack,8);
 assert.deepEqual(black.inventory.find(i=>i.type==='material').id,'crafted-artisan_toolkit-1792503371253-3mwta5');
 assert.ok(black.inventory.filter(i=>i.equipment?.name==='Кожаная броня · мастерская').length>=20);
 assert.equal((await one('SELECT count(*)::int AS n FROM territory_private.legacy_crafted_masterwork_ledger_20261113')).n,37);
 assert.equal((await one('SELECT count(*)::int AS n FROM territory_private.legacy_crafted_masterwork_backup_20261113')).n,8);
 for(const p of byName.values()){
   let row=(await get(p.name)).game_state;
   assert.equal(row.gold,3000);assert.equal(row.gems,100);
   assert.deepEqual(row.justSomeQuest,{count:3});
   assert.deepEqual(row.belt,[]);
 }
 // Repeated, ambiguous old game-state saves must not undo compensation.
 const oldAmiksor=original.get('Amiksor');
 await db.query('UPDATE public.players SET game_state=$1::jsonb WHERE id=$2',
   [JSON.stringify(oldAmiksor),byName.get('Amiksor').id]);
 const second=(await get('Amiksor')).game_state;
 assert.equal(second.inventory.find(i=>i.id.endsWith('wmb8rq')).equipment.attack,42);
 const again=await get('Borntofrag');
 await db.query('UPDATE public.players SET game_state=game_state WHERE id=$1',[byName.get('Borntofrag').id]);
 assert.deepEqual((await get('Borntofrag')).game_state,again.game_state,'Rebalance cannot compound on refresh');
 // Adding a forged matching item under another owner must not gain the boost.
 const wrong=JSON.parse(JSON.stringify(original.get('twOneFz')));
 wrong.inventory.push(original.get('Amiksor').inventory[0]);
 await db.query('UPDATE public.players SET game_state=$1::jsonb WHERE id=$2',
   [JSON.stringify(wrong),byName.get('twOneFz').id]);
 assert.equal((await get('twOneFz')).game_state.inventory.at(-1).equipment.attack,34,
   'Player-ID bound ledger must not bless copied items');
 // The authenticated role can save normally; private ledger tables and
 // helper functions do NOT need any direct client grants.
 await db.exec('SET ROLE authenticated');
 await db.query('UPDATE public.players SET game_state=game_state WHERE id=$1',[byName.get('Amiksor').id]);
 await db.exec('RESET ROLE');
 assert.equal((await get('Amiksor')).game_state.inventory[0].equipment.attack,42);
 console.log('Legacy local craft SQL PASS: 37 gear, 8 accounts, backups, 61-lvl amulet +42/4, forged shields after owner guard, shops untouched, stale-save reapply and cross-owner rejection.');
}finally{await db.close();}
