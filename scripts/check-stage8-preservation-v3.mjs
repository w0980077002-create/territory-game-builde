/** #366: actual save-trigger/forge/transfer contract, disposable databases ONLY. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const pgMode=process.argv.includes('--pg17');
let db,second;
if(pgMode){
  const target=new URL(process.env.STAGE8_TEST_DATABASE_URL??'invalid:');
  assert(['postgres:','postgresql:'].includes(target.protocol)
    && ['127.0.0.1','localhost','[::1]'].includes(target.hostname)
    && target.pathname==='/territory_stage8_ci' && !target.search && !target.hash,
    'Only local disposable territory_stage8_ci is allowed');
  const {Client}=await import('pg');
  db=new Client({connectionString:target.href}); second=new Client({connectionString:target.href});
  await db.connect(); await second.connect();
  assert.match((await db.query('SHOW server_version')).rows[0].server_version,/^17\./);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0,'Refuse nonempty DB');
  db.exec=sql=>db.query(sql); db.close=()=>db.end();
}else db=new PGlite();
const load=p=>readFileSync('supabase/'+p,'utf8');
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const player=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const op=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const seller=player(1),buyer=player(2),merchant=player(3);
const uuid='70000000-0000-4000-8000-000000000001',id='stage8_'+uuid;
const output={type:'equipment',name:'Изолированный меч',rarity:'rare',description:'Уровень вещи 5.',
  equipment:{id:'registry-display',slot:'weapon',name:'Изолированный меч',rarity:'rare',level:5,
    baseLevel:5,upgradeCount:0,attack:20,baseStats:{attack:20},history:['crafted']}};
const mirror=out=>({...out,id,qty:1,equipment:{...out.equipment,id}});
const state=(level,items=[])=>({player:{level,gold:100000,equipped:{},stats:{attack:10,defense:5,maxHp:100,critChance:0}},
  inventory:items,belt:[],forgeMaterials:10000});
const save=async(owner,value)=>db.query('UPDATE public.players SET game_state=$2::jsonb,updated_at=clock_timestamp() WHERE id=$1 RETURNING game_state',[owner,JSON.stringify(value)]);
const saved=async owner=>(await one('SELECT game_state FROM public.players WHERE id=$1',[owner])).game_state;
const registry=async()=>(await one('SELECT item_output FROM public.territory_profession_stage8_items WHERE item_id=$1',[uuid])).item_output;
const transfer=(from,to,n)=>db.query('SELECT territory_private.stage8_handoff_v3($1,$2,$3,$4)',[uuid,from,to,op(n)]);
const forge=async(n,expected,owner=seller,item=uuid)=>{
  await db.query("SELECT set_config('request.test_uid',$1,false)",[owner]);
  return (await one('SELECT public.territory_stage8_forge_v1($1,$2,$3) result',[item,expected,op(n)])).result;
};
const extract=(sql,name,tag)=>{
  const begin=sql.indexOf('CREATE OR REPLACE FUNCTION '+name+'('),end=sql.indexOf(tag+';',begin);
  assert(begin>=0&&end>begin,name);return sql.slice(begin,end+tag.length+1);
};
try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA territory_private; CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.test_uid',true),'')::uuid$$;
    CREATE TABLE public.players(id uuid PRIMARY KEY,level int NOT NULL,gold int NOT NULL DEFAULT 100000,
      gems int NOT NULL DEFAULT 17,forge_materials int NOT NULL DEFAULT 10000,banned bool NOT NULL DEFAULT false,
      game_state jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      attack int DEFAULT 10,defense int DEFAULT 5,max_hp int DEFAULT 100,crit_chance int DEFAULT 0);
    CREATE TABLE public.admin_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),player_id uuid,
      kind text,payload jsonb,claimed_at timestamptz);
    CREATE TABLE public.territory_profession_stage8_items(item_id uuid PRIMARY KEY,player_id uuid REFERENCES public.players,
      item_output jsonb NOT NULL);
    CREATE INDEX ON public.territory_profession_stage8_items(player_id);
    ALTER TABLE public.territory_profession_stage8_items ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.territory_profession_stage8_items FROM PUBLIC,anon,authenticated;
  `);
  await db.exec(load('migrations/20261017_equipment_guard_v4.sql'));
  await db.exec(load('migrations/20261018_permanent_gear_level_rule.sql').replaceAll(/^\$function\$$/gm,'$function$;'));
  await db.exec(load('migrations/20261022_owner_test_equipment_levels.sql'));
  await db.exec('ALTER TABLE territory_private.owner_test_gear_v1 ADD COLUMN approved_equipment jsonb');
  await db.exec(extract(load('staged/20261029_owner_gear_authority_forge_fix.sql'),
    'territory_private.owner_cap_item_v1','$owner_gear$'));
  const rare=load('migrations/20261108_legacy_rare_gear_common_preserved.sql');
  await db.exec(rare.slice(rare.indexOf('CREATE OR REPLACE FUNCTION'),rare.indexOf('CREATE OR REPLACE FUNCTION public.territory_gear_guard_v4')));
  const latest=load('migrations/20261109134500_owner_testers_real_equipment.sql').replaceAll(/^\$function\$$/gm,'$function$;');
  await db.exec(`CREATE TABLE territory_private.owner_test_bots_v1(player_id uuid PRIMARY KEY,
    attack_override int,defense_override int,hp_override int,crit_override int);`);
  await db.exec(extract(latest,'public.territory_gear_guard_v4','$function$').replace(/\$function\$\s*$/, '$function$;'));
  // Empty, synthetic heroes; no seed ever calls a production source.
  for(const [owner,level] of [[seller,100],[buyer,10],[merchant,1]])
    await db.query('INSERT INTO public.players(id,level,game_state) VALUES($1,$2,$3)',[owner,level,JSON.stringify(state(level))]);
  await db.query('INSERT INTO public.territory_profession_stage8_items VALUES($1,$2,$3)',[uuid,seller,JSON.stringify(output)]);
  // Negative control proves the REAL trigger destroys level/stats/count.
  const high={...mirror(output),equipment:{...mirror(output).equipment,level:61,upgradeCount:56,attack:104}};
  const broken=(await save(merchant,state(1,[high]))).rows[0].game_state.inventory[0].equipment;
  assert.equal(broken.level,1);assert.notEqual(broken.upgradeCount,56);
  await save(merchant,state(1));
  await db.exec(load('staged/territory_stage8_verified_gear_v2.sql'));
  await db.exec(load('staged/territory_stage8_preservation_v3.sql'));
  await db.exec(load('staged/territory_stage8_forge_v1.sql'));
  await assert.rejects(()=>forge(1,5),/save_guard_inactive/);
  // Activation itself refuses unresolved saved provenance, without mutations.
  await db.exec('ALTER TABLE public.players DISABLE TRIGGER territory_gear_guard_before_v4');
  await save(seller,state(100,[high]));
  await db.exec('ALTER TABLE public.players ENABLE TRIGGER territory_gear_guard_before_v4');
  await assert.rejects(()=>db.exec(load('staged/territory_stage8_preservation_activate_v3.sql')),/reconciliation_required/);
  await db.exec('ROLLBACK');
  assert.equal((await one("SELECT to_regclass('territory_private.stage8_guard_backup_v3') r")).r,null);
  await db.exec('ALTER TABLE public.players DISABLE TRIGGER territory_gear_guard_before_v4');
  await save(seller,state(100));
  await db.exec('ALTER TABLE public.players ENABLE TRIGGER territory_gear_guard_before_v4');
  await db.exec(load('staged/territory_stage8_preservation_activate_v3.sql'));
  await db.exec('SET ROLE authenticated');
  assert.equal((await one('SELECT public.territory_stage8_forge_ready_v1() ready')).ready,true);
  await db.exec('RESET ROLE');
  const activeDefinition=(await one("SELECT pg_get_functiondef('public.territory_gear_guard_v4()'::regprocedure) d")).d;
  assert.match(activeDefinition,/owner_test_bots_v1/,'Retain latest tester overrides');
  await save(seller,state(100,[mirror(output)]));
  let current=5,operation=10;
  // Actual server forge (including authoritative RNG), not direct registry UPDATE.
  // Try until 3 successes. Every failed roll must also have a durable receipt.
  while(current<8){
    assert(operation<200,'Bounded RNG fixture');
    const before=await saved(seller),n=operation++;
    const result=await forge(n,current);
    assert.equal(result.level_before,current);
    assert.equal(result.level_after,current+(result.upgraded?1:0));
    const replay=await forge(n,current);
    assert.equal(replay.replayed,true);assert.equal(replay.wallet_gold,result.wallet_gold);
    assert.deepEqual(await saved(seller),result.game_state,'Lost reply replay cannot debit twice');
    assert.equal(before.player.gold-result.game_state.player.gold,result.cost_gold);
    current=result.level_after;
  }
  let canonical=await registry();
  assert.equal(canonical.equipment.upgradeCount,3);
  assert.deepEqual(canonical.equipment.history,['crafted']);
  const equippedSave=state(100);equippedSave.player.equipped.weapon=mirror(canonical).equipment;
  await save(seller,equippedSave);
  await assert.rejects(()=>transfer(seller,buyer,199),/equipped_handoff/);
  await save(seller,state(100,[mirror(canonical)]));
  // Provenance conflict blocks even when the incoming save deletes the evidence.
  await db.exec('ALTER TABLE public.players DISABLE TRIGGER territory_gear_guard_before_v4');
  const conflict=state(100,[{...mirror(canonical),equipment:{...mirror(canonical).equipment,level:59}}]);
  await save(seller,conflict);
  await db.exec('ALTER TABLE public.players ENABLE TRIGGER territory_gear_guard_before_v4');
  await assert.rejects(()=>save(seller,state(100)),/reconciliation_required/);
  assert.deepEqual(await saved(seller),conflict);
  await assert.rejects(()=>transfer(seller,buyer,200),/reconciliation_required/);
  await db.exec('ALTER TABLE public.players DISABLE TRIGGER territory_gear_guard_before_v4');
  await save(seller,state(100,[mirror(canonical)]));
  await db.exec('ALTER TABLE public.players ENABLE TRIGGER territory_gear_guard_before_v4');
  // Isolated high-level history fixture, alongside the real 5->8 forge above.
  canonical={...canonical,equipment:{...canonical.equipment,level:61,upgradeCount:56,attack:104}};
  await db.query('UPDATE public.territory_profession_stage8_items SET item_output=$1 WHERE item_id=$2',[JSON.stringify(canonical),uuid]);
  await save(seller,state(100,[mirror(canonical)]));
  await db.query('UPDATE public.players SET gold=100000,forge_materials=10000 WHERE id=$1',[seller]);
  const beforeTransfer=await saved(seller);
  await db.exec('BEGIN'); await transfer(seller,buyer,201); await db.exec('ROLLBACK');
  assert.deepEqual(await saved(seller),beforeTransfer);assert.deepEqual(await registry(),canonical);
  await transfer(seller,buyer,202); await transfer(buyer,merchant,203);
  assert.deepEqual((await saved(merchant)).inventory[0],mirror(canonical));
  assert.equal((await saved(buyer)).inventory.length,0);
  await transfer(seller,buyer,202); // Old operation after resale: no reclaim.
  await assert.rejects(()=>transfer(buyer,seller,204),/not_owned/);
  assert.deepEqual((await saved(merchant)).inventory[0],mirror(canonical));
  // Logout/login/old snapshot: both omission and an older level restore registry.
  await save(merchant,state(1));
  await save(merchant,state(1,[mirror(output)]));
  await save(merchant,state(1,[{...mirror(canonical),id:'inv_historical_wrapper'}]));
  assert.deepEqual((await saved(merchant)).inventory[0],mirror(canonical));
  const disguised={id,qty:1,type:'potion'};
  await assert.rejects(()=>save(merchant,state(1,[disguised])),/invalid_mirror/);
  const hidden=state(1);hidden.belt=[disguised];
  await assert.rejects(()=>save(merchant,hidden),/gear_in_belt/);
  const worn=state(1);worn.player.equipped.weapon=mirror(canonical).equipment;
  await assert.rejects(()=>save(merchant,worn),/cannot_equip/);
  await assert.rejects(()=>save(buyer,state(10,[mirror(canonical)])),/not_owned/);
  await assert.rejects(()=>save(merchant,state(1,[mirror(canonical),mirror(canonical)])),/duplicate_item/);
  const forged=mirror(canonical);forged.equipment.level=62;
  await assert.rejects(()=>save(merchant,state(1,[forged])),/reconciliation_required/);
  const bad=mirror(canonical);bad.equipment.level=null;
  await assert.rejects(()=>save(merchant,state(1,[bad])),/invalid_level/);
  const sameLevel=mirror(canonical);sameLevel.equipment.attack=999999;
  await save(merchant,state(1,[sameLevel]));
  assert.deepEqual((await saved(merchant)).inventory[0],mirror(canonical));
  // Low-level ownership is allowed; forge hero cap is an existing forge rule.
  await assert.rejects(()=>forge(250,61,merchant),/level_conflict/);
  await transfer(merchant,seller,205);
  await db.query("UPDATE public.players SET gold=0,game_state=jsonb_set(game_state,'{player,gold}','0') WHERE id=$1",[seller]);
  const poor=await saved(seller);
  await assert.rejects(()=>forge(251,61),/insufficient_resources/);
  assert.deepEqual(await saved(seller),poor);assert.deepEqual(await registry(),canonical);
  await db.query("UPDATE public.players SET gold=100000,game_state=jsonb_set(game_state,'{player,gold}','100000') WHERE id=$1",[seller]);
  // Rollback REAL forge including resources, registry and receipt.
  await db.exec('BEGIN'); await forge(252,61); await db.exec('ROLLBACK');
  assert.deepEqual(await registry(),canonical);
  assert.equal((await one('SELECT count(*)::int n FROM territory_private.stage8_forge_receipts_v1 WHERE operation_id=$1',[op(252)])).n,0);
  // Continue from the actual certified N=61, never baseLevel or recipient level.
  let last;
  do{assert(operation<240,'Bounded RNG fixture');last=await forge(operation++,61);}while(!last.upgraded);
  assert.equal(last.level_after,62);assert.equal((await registry()).equipment.upgradeCount,57);
  // Legacy registry gear without baseline: failed rolls charge once and
  // preserve the exact record; success establishes SERVER baseline at N.
  const legacyUuid='70000000-0000-4000-8000-000000000002';
  const legacy={...output,equipment:{id:'legacy-display',name:output.name,slot:'weapon',rarity:'rare',level:7,attack:20}};
  await db.query('INSERT INTO public.territory_profession_stage8_items VALUES($1,$2,$3)',[legacyUuid,seller,JSON.stringify(legacy)]);
  await save(seller,await saved(seller));
  const seedFor=async success=>{
    for(let n=0;n<100;n++){
      const seed=n/100;
      await db.query('SELECT setseed($1)',[seed]);
      const r=(await one('SELECT random() r')).r;
      if(success?r<0.4:r>0.95){await db.query('SELECT setseed($1)',[seed]);return;}
    }
    assert.fail('No matching PostgreSQL RNG seed');
  };
  await seedFor(false);
  const legacyFailure=await forge(280,7,seller,legacyUuid);
  assert.equal(legacyFailure.upgraded,false);
  assert.deepEqual((await one('SELECT item_output FROM public.territory_profession_stage8_items WHERE item_id=$1',[legacyUuid])).item_output,legacy);
  assert.equal((await forge(280,7,seller,legacyUuid)).wallet_gold,legacyFailure.wallet_gold);
  await seedFor(true);
  const legacySuccess=await forge(281,7,seller,legacyUuid);
  assert.equal(legacySuccess.level_after,8);
  const legacyAfter=(await one('SELECT item_output FROM public.territory_profession_stage8_items WHERE item_id=$1',[legacyUuid])).item_output;
  assert.equal(legacyAfter.equipment.baseLevel,7);assert.equal(legacyAfter.equipment.upgradeCount,1);
  if(pgMode){
    await second.query("SELECT set_config('request.test_uid',$1,false)",[seller]);
    await db.query("SELECT set_config('request.test_uid',$1,false)",[seller]);
    const args=[uuid,62,op(300)];
    const results=await Promise.all([db.query('SELECT public.territory_stage8_forge_v1($1,$2,$3) r',args),
      second.query('SELECT public.territory_stage8_forge_v1($1,$2,$3) r',args)]);
    assert.equal(results.filter(r=>r.rows[0].r.replayed).length,1,'Two devices commit ONE receipt/debit');
    assert.equal((await one('SELECT count(*)::int n FROM territory_private.stage8_forge_receipts_v1 WHERE operation_id=$1',[op(300)])).n,1);
    // Distinct operations racing with the same expected level: force the first
    // roll to succeed using PostgreSQL's per-session RNG seed, not a fake RPC.
    const level=(await registry()).equipment.level;
    let seed;
    for(let n=0;n<20;n++){
      const candidate=n/20;
      await db.query('SELECT setseed($1)',[candidate]);
      if((await one('SELECT random() r')).r<0.5){seed=candidate;break;}
    }
    assert.notEqual(seed,undefined);
    await db.query('SELECT setseed($1)',[seed]);await second.query('SELECT setseed($1)',[seed]);
    const beforeRace=await saved(seller);
    const race=await Promise.allSettled([db.query('SELECT public.territory_stage8_forge_v1($1,$2,$3)',[uuid,level,op(301)]),
      second.query('SELECT public.territory_stage8_forge_v1($1,$2,$3)',[uuid,level,op(302)])]);
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
    assert.match(race.find(r=>r.status==='rejected').reason.message,/level_conflict/);
    assert.equal((await registry()).equipment.level,level+1);
    assert.equal(beforeRace.player.gold-(await saved(seller)).player.gold,50+level*30);
    // True overlapping CAS saves, independent sessions and one shared revision.
    const token=(await one('SELECT updated_at::text t FROM public.players WHERE id=$1',[seller])).t;
    const cas='UPDATE public.players SET game_state=game_state,updated_at=clock_timestamp() WHERE id=$1 AND updated_at=$2 RETURNING id';
    const outcomes=await Promise.all([db.query(cas,[seller,token]),second.query(cas,[seller,token])]);
    assert.equal(outcomes.reduce((n,r)=>n+r.rowCount,0),1);
  }
  // A downstream save hook changes an otherwise untested property. Both
  // success and failure rolls MUST roll back cost, gear and receipt.
  await db.exec(`CREATE FUNCTION public.stage8_fixture_corrupt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.game_state:=jsonb_set(NEW.game_state,'{inventory,0,equipment,history}','["corrupt"]'); RETURN NEW; END $$;
    CREATE TRIGGER zzz_stage8_fixture_corrupt BEFORE UPDATE OF game_state ON public.players
    FOR EACH ROW EXECUTE FUNCTION public.stage8_fixture_corrupt();`);
  const committed=await saved(seller),committedRegistry=await registry();
  await assert.rejects(()=>forge(350,committedRegistry.equipment.level),/result_normalized/);
  assert.deepEqual(await saved(seller),committed);assert.deepEqual(await registry(),committedRegistry);
  assert.equal((await one('SELECT count(*)::int n FROM territory_private.stage8_forge_receipts_v1 WHERE operation_id=$1',[op(350)])).n,0);
  await db.exec('DROP TRIGGER zzz_stage8_fixture_corrupt ON public.players; DROP FUNCTION public.stage8_fixture_corrupt()');
  await assert.rejects(()=>forge(351,null),/bad_request/);
  // Real player-row RLS, with an authenticated SQL role and fixture JWT subject.
  await db.exec(`ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,UPDATE ON public.players TO authenticated;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE POLICY own_player ON public.players TO authenticated USING(auth.uid()=id) WITH CHECK(auth.uid()=id);`);
  // Actual authenticated SQL role cannot alter registry or call internal handoff.
  await db.exec('GRANT USAGE ON SCHEMA territory_private TO authenticated');
  await db.query("SELECT set_config('request.test_uid',$1,false)",[seller]);
  await db.exec('SET ROLE authenticated');
  assert.equal((await db.query('UPDATE public.players SET game_state=game_state WHERE id=$1 RETURNING id',[merchant])).rows.length,0);
  await save(seller,await saved(seller));

  await assert.rejects(()=>db.query('UPDATE public.territory_profession_stage8_items SET player_id=$1',[buyer]),/permission denied/);
  await assert.rejects(()=>transfer(seller,buyer,400),/permission denied/);
  await assert.rejects(()=>db.query('SELECT public.territory_stage8_forge_v1($1,$2,$3)',[op(999),committedRegistry.equipment.level,op(352)]),/not_owned/);
  await db.exec('RESET ROLE');
  await db.exec('GRANT SELECT,UPDATE ON public.territory_profession_stage8_items TO authenticated');
  await db.exec('SET ROLE authenticated');
  assert.equal((await db.query('UPDATE public.territory_profession_stage8_items SET player_id=$1 RETURNING item_id',[buyer])).rows.length,0,'RLS denies even accidental grants');
  await db.exec('RESET ROLE');
  await db.exec('REVOKE SELECT,UPDATE ON public.territory_profession_stage8_items FROM authenticated');
  // Code rollback preserves current registry/history. Writers are quiescent here.
  const beforeRollback=await registry();
  await db.exec(load('staged/territory_stage8_preservation_rollback_v3.sql'));
  assert.deepEqual(await registry(),beforeRollback);
  await assert.rejects(()=>forge(450,beforeRollback.equipment.level),/save_guard_inactive/);
  await assert.rejects(()=>save(seller,committed),/maintenance_hold/);
  assert.doesNotMatch((await one("SELECT pg_get_functiondef('public.territory_gear_guard_v4()'::regprocedure) d")).d,/stage8_preserve_state_v3/);
  await assert.rejects(()=>transfer(seller,buyer,451),/save_guard_inactive/);
  assert.deepEqual(await registry(),beforeRollback);
  await db.exec(load('staged/territory_stage8_preservation_activate_v3.sql'));
  await save(seller,await saved(seller));
  assert.deepEqual(await registry(),beforeRollback,'Reactivation removes hold without changing gear');
  console.log(`PASS #366 ${pgMode?'PostgreSQL 17 (two sessions)':'PGlite'}: real save trigger, forge, receipts, transfer, level-1 resale, stale saves, provenance, rollback, access control`);
}finally{await second?.end();await db.close();}
