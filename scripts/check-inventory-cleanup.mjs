import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const prep=readFileSync('supabase/migrations/20261017_inventory_cleanup_prepare.sql','utf8');
const apply=readFileSync('supabase/migrations/20261017_inventory_cleanup_once.sql','utf8');
const db=new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA territory_private;
    CREATE TABLE public.players(id uuid primary key, game_state jsonb not null,
      updated_at timestamptz not null default now());
    CREATE FUNCTION public.territory_normalize_state_v4(s jsonb)
      RETURNS jsonb LANGUAGE sql IMMUTABLE AS 'SELECT s';
    CREATE FUNCTION public.fixture_save_timestamp() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN IF NEW.game_state IS DISTINCT FROM OLD.game_state THEN
        NEW.updated_at := GREATEST(clock_timestamp(),OLD.updated_at + interval ''1 microsecond'');
       END IF; RETURN NEW; END';
    CREATE TRIGGER fixture_save_timestamp BEFORE UPDATE OF game_state ON public.players
      FOR EACH ROW EXECUTE FUNCTION public.fixture_save_timestamp();`);
  await db.exec(prep);
  const gear=(id,slot,name,attack=0,defense=0,hp=0,upgradeCount=0,level=1,baseLevel=level,rarity='common')=>({
    id,qty:1,type:'equipment',name,rarity, equipment:{id,slot,name,attack,defense,hp,upgradeCount,baseLevel,level,rarity}
  });
  const potion={id:'potion',type:'potion',qty:5,description:'keep consumables'};
  const worn={weapon:gear('worn','weapon','Меч воина',30).equipment,armor:gear('worn_armor','armor','Кожаная броня',0,25,50).equipment};
  const inventory=[
    gear('loot_weak','weapon','Клинок победителя',10),
    gear('loot_top','weapon','Клинок победителя',60),
    gear('loot_mid','weapon','Клинок победителя',45),
    gear('loot_armor','armor','Доспех воина',0,10,30),
    gear('loot_armor_low','armor','Доспех воина',0,1,10),
    gear('inv_upgrade','weapon','Меч воина',35,0,0,5,6,1),
    gear('custom_relic','amulet','Реликвия ярла',25,0,0,0,6,6,'legendary'),
    potion,
    gear('inv_boot','boots','Сапоги скорости',0,5,40,0,2,2,'rare'),
  ];
  const original={balanceVersion:4,player:{equipped:worn,level:20,gold:500,gems:20},inventory,belt:[potion],
    forgeMaterials:25,battleStones:10,trialLevel:15};
  const id='10000000-0000-0000-0000-000000000011';
  await db.query('INSERT INTO public.players(id,game_state) VALUES ($1,$2)',[id,original]);
  const preview=(await db.query('SELECT territory_private.trim_inventory_v1(game_state) AS s FROM public.players')).rows[0].s;
  const ids=preview.inventory.map(x=>x.id);
  assert.deepEqual(ids,['loot_top','inv_upgrade','custom_relic','potion','inv_boot']);
  assert.deepEqual(preview.player.equipped,worn,'equipped must not change');
  assert.equal(preview.inventoryCleanupVersion,1);
  assert.equal((await db.query('SELECT territory_private.trim_inventory_v1($1::jsonb) AS s',[preview])).rows[0].s.inventory.length,5,'idempotent');
  await db.exec(apply);
  const after=(await db.query('SELECT game_state,updated_at FROM public.players WHERE id=$1',[id])).rows[0];
  assert.deepEqual(after.game_state.inventory,preview.inventory,'production migration matches preview');
  assert.equal(after.game_state.battleStones,10);
  assert.equal(after.game_state.player.gold,500);
  assert.equal(after.game_state.forgeMaterials,25);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM territory_private.inventory_before_cleanup_20261017')).rows[0].n,1);
  const before=(await db.query('SELECT original_row FROM territory_private.inventory_before_cleanup_20261017 WHERE player_id=$1',[id])).rows[0].original_row;
  assert.equal(before.game_state.inventory.length,original.inventory.length,'complete original backup retained');
  await assert.rejects(db.query('UPDATE public.players SET game_state=$1 WHERE id=$2',[original,id]),/territory_stale_inventory_cleanup_snapshot/);
  assert.deepEqual((await db.query('SELECT game_state FROM public.players WHERE id=$1',[id])).rows[0].game_state.inventory,preview.inventory,'stale save cannot restore old gear');
  console.log('Inventory cleanup PASS: private backup, worn slots, best spare, forge, unique, non-gear, preservation, stale-save guard.');
} finally { await db.close(); }
