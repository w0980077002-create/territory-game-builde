/**
 * Offline Stage8 profession security integration test. The entire database is
 * ephemeral PGlite; NEVER connects to a live Supabase project.
 *
 * Contract against supabase/staged/territory_profession_stage8_backend.sql.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const source = await readFile(new URL('../supabase/staged/territory_profession_stage8_backend.sql',import.meta.url),'utf8');
const legacyBridge = await readFile(new URL('../supabase/staged/territory_profession_stage8_legacy_bridge.sql',import.meta.url),'utf8');
const catalog = JSON.parse(await readFile(new URL('../supabase/staged/territory_profession_stage8_catalog.json',import.meta.url),'utf8'));
const db = new PGlite();
const smith='11111111-1111-4111-8111-111111111111';
const second='22222222-2222-4222-8222-222222222222';
const legacy='44444444-4444-4444-8444-444444444444';
const alchemist='55555555-5555-4555-8555-555555555555';
const oldWithoutMastery='66666666-6666-4666-8666-666666666666';
const oldUnverified='77777777-7777-4777-8777-777777777777';
const newcomer='88888888-8888-4888-8888-888888888888';
const insufficientNew='99999999-9999-4999-8999-999999999999';
const oldWithoutUnlock='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const adapterNew='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventMismatch='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const auditedLegacy='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const artisan='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const operations=Array.from({length:20},(_,i)=>`33333333-3333-4333-8333-${String(i+1).padStart(12,'0')}`);

const setup = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting('test.uid',true),'')::uuid $$;
  CREATE TABLE public.players(id uuid PRIMARY KEY,gold int NOT NULL DEFAULT 0,
    gems int NOT NULL DEFAULT 0,banned boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    game_state jsonb NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE public.territory_profession_unlocks(
    player_id uuid PRIMARY KEY REFERENCES public.players(id),
    profession text NOT NULL,
    master_license boolean NOT NULL DEFAULT false);
  CREATE TABLE public.territory_resource_wallet(
    player_id uuid NOT NULL REFERENCES public.players(id),
    resource_id text NOT NULL, quantity bigint NOT NULL CHECK(quantity>=0),
    PRIMARY KEY(player_id,resource_id));
  CREATE TABLE public.territory_profession_mastery_v1(
    player_id uuid PRIMARY KEY REFERENCES public.players(id),
    profession text NOT NULL,mastery_level int NOT NULL CHECK(mastery_level BETWEEN 1 AND 300),
    mastery_xp int NOT NULL DEFAULT 0 CHECK(mastery_xp>=0),
    verified boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO public.players(id,gold,gems,game_state)
    VALUES ('${smith}',300,77,'{"keep":"old-save","inventory":[{"id":"gather-ore","qty":9999999}]}'),
           ('${second}',500,88,'{"keep":"other-save"}'),
           ('${legacy}',900,99,'{"keep":"legacy-save"}'),
           ('${alchemist}',800,66,'{"keep":"alchemist-save"}'),
           ('${artisan}',500,150,'{"keep":"artisan-save"}'),
           ('${auditedLegacy}',500,250,'{"professions":{"active":"smith","masteryLevel":6,"masteryXp":45},"inventory":[{"id":"old-equipped","qty":1}]}');
  INSERT INTO public.territory_profession_unlocks(player_id,profession)
    VALUES ('${smith}','smith'),('${second}','smith'),('${legacy}','smith'),
           ('${alchemist}','alchemist'),('${auditedLegacy}','smith'),
           ('${artisan}','artisan');
  INSERT INTO public.territory_profession_mastery_v1(player_id,profession,mastery_level,mastery_xp,verified)
    VALUES ('${smith}','smith',1,0,true),('${second}','smith',1,0,true),
           ('${legacy}','smith',50,300,true),('${alchemist}','alchemist',25,0,true),
           ('${artisan}','artisan',1,0,true);
  INSERT INTO public.territory_resource_wallet(player_id,resource_id,quantity)
    VALUES ('${smith}','gather-ore',50),('${smith}','gather-crystal',100),
           ('${smith}','gather-wood',100),('${smith}','gather-hide',100),
           ('${second}','gather-ore',40),
           ('${alchemist}','gather-herb',10),('${alchemist}','gather-wood',10),
           ('${artisan}','gather-wood',10),('${artisan}','gather-ore',10);
  UPDATE public.players SET created_at=clock_timestamp()-interval '30 days';
  SELECT set_config('test.uid','${smith}',false);
`;
const rows = async(sql,values=[]) => (await db.query(sql,values)).rows;
const one = async(sql,values=[]) => (await rows(sql,values))[0];
const exec = async(recipe,operation) => (await one('SELECT public.territory_profession_stage8_execute($1::text,$2::uuid) AS result',[recipe,operation])).result;
const purchase = async(profession,operation) => (await one('SELECT public.territory_profession_stage8_purchase($1::text,$2::uuid) AS result',[profession,operation])).result;
const status = async() => (await one('SELECT public.territory_profession_stage8_status() AS result')).result;
const inventory = async() => (await one('SELECT public.territory_profession_stage8_inventory() AS result')).result;
let currentRole=null;
const role = async(name) => {await db.exec('RESET ROLE');if(name) await db.exec(`SET ROLE ${name}`);currentRole=name??null;};
const asOwner = async(fn) => {
  const previous=currentRole;
  await role();
  try{return await fn();}finally{await role(previous);}
};
const useUser = async(id) => {await role();await db.query("SELECT set_config('test.uid',$1::text,false)",[id]);await role('authenticated');};
const denied = async(fn,pattern,label) => {
  await assert.rejects(fn(),pattern,label);
};
const wallet = async(id,resource='gather-ore') => asOwner(async()=>Number((await one('SELECT quantity FROM public.territory_resource_wallet WHERE player_id=$1 AND resource_id=$2',[id,resource])).quantity));
const mastery = async(id) => asOwner(async()=>await one('SELECT mastery_level,mastery_xp FROM public.territory_profession_stage8_progress WHERE player_id=$1',[id]));
const dailyUsed = async(id) => asOwner(async()=>Number((await one("SELECT COALESCE(sum(xp_used),0)::int AS used FROM public.territory_profession_stage8_daily_xp WHERE player_id=$1 AND local_day=(clock_timestamp() AT TIME ZONE 'Europe/Kyiv')::date",[id])).used));

try {
  await db.exec(setup);
  const beforePlayers=await rows('SELECT id,gold,gems,game_state FROM public.players ORDER BY id');
  await db.exec(source);
  await db.exec(legacyBridge);
  assert.deepEqual(await rows('SELECT id,gold,gems,game_state FROM public.players ORDER BY id'),beforePlayers,
    'Installing an inactive backend must not mutate player records');
  await useUser(auditedLegacy);
  await denied(()=>rows('SELECT public.territory_profession_stage8_legacy_preview($1::uuid)',[auditedLegacy]),
    /permission denied/i,'Clients cannot inspect private migration review data');
  await role('service_role');
  const firstPreview=(await one('SELECT public.territory_profession_stage8_legacy_preview($1::uuid) AS result',[auditedLegacy])).result;
  assert.equal(firstPreview.eligible,true);
  assert.equal(firstPreview.mastery_level,6);
  assert.equal(firstPreview.mastery_xp,45);
  await role();
  await db.exec(`UPDATE public.players SET created_at=created_at,
    updated_at=clock_timestamp()+interval '1 second' WHERE id='${auditedLegacy}';`);
  await role('service_role');
  await denied(()=>rows('SELECT public.territory_profession_stage8_legacy_approve($1::uuid,$2::text,$3::text)',
    [auditedLegacy,firstPreview.source_digest,'Reviewed old profession and unlock; preserve old gear.']),
    /stale_legacy_snapshot/i,'A changed save cannot be imported from a stale approval');
  const nextPreview=(await one('SELECT public.territory_profession_stage8_legacy_preview($1::uuid) AS result',[auditedLegacy])).result;
  const reviewed=(await one('SELECT public.territory_profession_stage8_legacy_approve($1::uuid,$2::text,$3::text) AS result',
    [auditedLegacy,nextPreview.source_digest,'Reviewed profession and previous items; no suspicious level jump.'])).result;
  assert.equal(reviewed.success,true);
  assert.equal(reviewed.mastery_level,6,'Grandfathered legacy levels must not be reset');
  assert.equal(reviewed.mastery_xp,5,'Fractional legacy XP maps to the new scale');
  assert.equal((await asOwner(()=>one('SELECT origin FROM public.territory_profession_stage8_progress WHERE player_id=$1',[auditedLegacy]))).origin,
    'reviewed_legacy_save','Historical browser snapshots cannot pretend to be verified Stage3 data');
  await denied(()=>rows('SELECT public.territory_profession_stage8_legacy_approve($1::uuid,$2::text,$3::text)',
    [auditedLegacy,nextPreview.source_digest,'Trying an unauthorized second conversion.']),
    /legacy_review_failed|already_reconciled/i,'One-time review must be non-repeatable');
  await role();
  assert.deepEqual(await rows('SELECT id,gold,gems,game_state FROM public.players ORDER BY id'),beforePlayers,
    'Reviewed reconciliation must not modify the original client save or currencies');
  // The real cutover must reconcile existing mastery with an audit. These two
  // rows emulate an already completed, owner-reviewed reconciliation in tests.
  await db.exec(`INSERT INTO public.territory_profession_stage8_progress
      (player_id,profession,mastery_level,mastery_xp,verified,original_v1_level,original_v1_xp,reconciled_at)
    VALUES ('${smith}','smith',1,0,true,1,0,clock_timestamp()),
           ('${second}','smith',1,0,true,1,0,clock_timestamp()),
           ('${alchemist}','alchemist',25,0,true,25,0,clock_timestamp()),
           ('${artisan}','artisan',1,0,true,1,0,clock_timestamp());`);

  // Versioned, immutable 55-recipe catalog, including training-without-item.
  const serverCatalog=await rows('SELECT id,profession,kind,required_level,mastery_xp,ingredients,item_output FROM public.territory_profession_stage8_catalog ORDER BY id');
  assert.equal(serverCatalog.length,catalog.recipes.length,'All draft recipes must be in server catalog');
  for(const local of catalog.recipes){
    const remote=serverCatalog.find(r=>r.id===local.id);
    assert.ok(remote,local.id);
    assert.equal(remote.profession,local.profession);
    assert.equal(remote.kind,local.kind);
    assert.equal(remote.required_level,local.requiredLevel);
    assert.equal(remote.mastery_xp,local.masteryXp);
    assert.deepEqual(remote.ingredients,local.ingredients);
    assert.deepEqual(remote.item_output,local.output);
  }
  const serverBands=await rows('SELECT from_level,to_level,xp_to_next FROM public.territory_profession_stage8_bands ORDER BY from_level');
  assert.deepEqual(serverBands,catalog.masteryBands.map(band=>({
    from_level:band.from,to_level:band.to,xp_to_next:band.xpToNext,
  })),'Server XP thresholds must exactly match the progression simulator');

  // No unapproved release. Role grants and RLS apply to EVERY staging table.
  await useUser(smith);
  assert.equal((await status()).enabled,false,'Stage8 must be off by default');
  await denied(()=>exec('s8_smith_practice_1',operations[0]),/disabled|not_enabled|inactive|craft_not_enabled|not.*active/i,
    'No crafting before server cutover');
  assert.equal(await wallet(smith),50);
  for(const t of ['territory_profession_stage8_release','territory_profession_stage8_catalog',
    'territory_profession_stage8_progress',
    'territory_profession_stage8_new_unlock_events',
    'territory_profession_stage8_receipts','territory_profession_stage8_items','territory_profession_stage8_daily_xp']){
    const row=await one(`SELECT c.relrowsecurity AS rls,
      has_table_privilege('anon',c.oid,'INSERT') AS anon_insert,
      has_table_privilege('authenticated',c.oid,'INSERT') AS auth_insert,
      has_table_privilege('authenticated',c.oid,'UPDATE') AS auth_update
      FROM pg_class c WHERE c.oid=$1::regclass`,[`public.${t}`]);
    assert.equal(row.rls,true,`${t} RLS`);
    assert.equal(row.anon_insert,false,`${t} anon writes`);
    assert.equal(row.auth_insert,false,`${t} auth writes`);
    assert.equal(row.auth_update,false,`${t} auth updates`);
  }
  assert.equal((await one("SELECT has_function_privilege('anon','public.territory_profession_stage8_execute(text,uuid)','EXECUTE') granted")).granted,false);
  assert.equal((await one("SELECT has_function_privilege('authenticated','public.territory_profession_stage8_execute(text,uuid)','EXECUTE') granted")).granted,true);
  assert.equal((await one("SELECT has_function_privilege('authenticated','public.territory_profession_stage8_reconcile(uuid)','EXECUTE') granted")).granted,false);
  assert.equal((await one("SELECT has_function_privilege('service_role','public.territory_profession_stage8_reconcile(uuid)','EXECUTE') granted")).granted,true);
  await denied(()=>rows('SELECT public.territory_profession_stage8_reconcile($1::uuid)',[legacy]),/permission denied/i,
    'Browser must not be able to reconcile arbitrary users');
  await denied(()=>rows('UPDATE public.territory_profession_stage8_release SET enabled=true'),/permission denied/i,
    'Browser must not be allowed to activate release');

  // Owner-controlled migration is independent of the active release. The old
  // level is retained and only its fractional XP is converted to new bands.
  await role('service_role');
  const converted=(await one('SELECT public.territory_profession_stage8_reconcile($1::uuid) AS result',[legacy])).result;
  assert.equal(converted.success,true);
  assert.equal(converted.existing,false);
  assert.equal(converted.mastery_level,50);
  assert.equal(converted.mastery_xp,20,'Old 300/1325 fraction mapped to 90-XP Stage8 level');
  assert.equal((await one('SELECT public.territory_profession_stage8_reconcile($1::uuid) AS result',[legacy])).result.existing,true);
  await role();
  assert.deepEqual(await one('SELECT mastery_level,mastery_xp FROM public.territory_profession_mastery_v1 WHERE player_id=$1',[legacy]),
    {mastery_level:50,mastery_xp:300},'Reconciliation may never alter old XP');

  // Test-only activation by schema owner; the real database remains untouched.
  await role();
  await db.exec("UPDATE public.territory_profession_stage8_release SET enabled=true,cutover_at=clock_timestamp()-interval '1 hour' WHERE id=1");
  await useUser(smith);
  assert.equal((await status()).enabled,true);
  await role();
  await db.exec(`UPDATE public.territory_profession_stage8_progress SET verified=false WHERE player_id='${smith}';`);
  await useUser(smith);
  const unreconciled=await status();
  assert.equal(unreconciled.enabled,false,'Unreconciled player must be disabled');
  assert.match(String(unreconciled.reason),/verified|reconcil|mastery/i);
  await denied(()=>exec('s8_smith_practice_1',operations[0]),/verified|reconcil|mastery/i);
  assert.equal(await wallet(smith),50);
  await role();
  await db.exec(`UPDATE public.territory_profession_stage8_progress SET verified=true WHERE player_id='${smith}';`);
  await db.exec(`UPDATE public.players SET banned=true WHERE id='${smith}';`);
  await useUser(smith);
  await denied(()=>exec('s8_smith_practice_1',operations[0]),/unavailable|ban/i,'Banned player must not craft');
  await role();
  await db.exec(`UPDATE public.players SET banned=false WHERE id='${smith}';`);
  await useUser(smith);
  const first=await exec('s8_smith_practice_1',operations[0]);
  assert.equal(first.success,true);
  assert.equal(first.kind,'practice');
  assert.equal(first.item_id,null,'Practice must never create inventory equipment');
  assert.equal(first.item_output,null);
  assert.equal(first.mastery_level,2);
  assert.equal(first.mastery_xp,4);
  assert.equal(await wallet(smith),49);
  assert.equal((await asOwner(()=>rows('SELECT * FROM public.territory_profession_stage8_items'))).length,0);

  const again=await exec('s8_smith_practice_1',operations[0]);
  assert.deepEqual(again,first,'Exact retry returns original receipt');
  const racing=await Promise.all(Array.from({length:5},()=>exec('s8_smith_practice_1',operations[0])));
  assert.ok(racing.every(value=>JSON.stringify(value)===JSON.stringify(first)),'Five concurrent retries share one result');
  assert.equal(await wallet(smith),49,'Exact retry must not consume resources twice');
  assert.equal(await dailyUsed(smith),30,'Exact retry must not grant XP twice');
  await denied(()=>exec('s8_smith_practice_25',operations[0]),/collision|conflict|operation/i,
    'Reusing same operation UUID with different recipe is forbidden');
  await denied(()=>exec('s8_jeweler_practice_1',operations[1]),/profession|licensed/i);
  await denied(()=>exec('s8_smith_practice_50',operations[1]),/mastery|level/i);
  await denied(()=>exec('unknown_recipe',operations[1]),/unknown|recipe/i);
  assert.equal(await wallet(smith),49,'Rejected requests must not consume resources');

  // 10 * 30 XP = 300/day; the eleventh attempt must fail atomically.
  for(let i=1;i<10;i++) await exec('s8_smith_practice_1',operations[i]);
  assert.equal(await dailyUsed(smith),300);
  assert.equal(await wallet(smith),40);
  const beforeCap=await mastery(smith);
  await denied(()=>exec('s8_smith_practice_1',operations[10]),/daily|cap|limit|xp/i,
    'Daily XP hard cap must reject an eleventh practice');
  assert.equal(await wallet(smith),40);
  assert.deepEqual(await mastery(smith),beforeCap,'Cap rejection must not alter mastery');
  assert.equal((await asOwner(()=>rows('SELECT * FROM public.territory_profession_stage8_receipts'))).length,10);

  // Emulate the Kyiv calendar boundary by moving today's spent quota to the
  // preceding day. Production code still owns the real server clock.
  await role();
  await db.exec("UPDATE public.territory_profession_stage8_daily_xp SET local_day=(clock_timestamp() AT TIME ZONE 'Europe/Kyiv')::date-1 WHERE player_id='"+smith+"';");
  await useUser(smith);
  assert.equal(await dailyUsed(smith),0,'Kyiv new day starts with a fresh quota');
  assert.deepEqual(await exec('s8_smith_practice_1',operations[0]),first,
    'Receipt replay across midnight must not consume new-day XP');
  const nextDay=await exec('s8_smith_practice_1',operations[10]);
  assert.equal(nextDay.daily_xp_used,30);
  assert.equal(await dailyUsed(smith),30);
  assert.equal(await wallet(smith),39);

  // Independently authenticated players cannot spend each other's wallet.
  await useUser(second);
  const other=await exec('s8_smith_practice_1',operations[0]);
  assert.equal(other.success,true,'Same UUID is allowed for a different player');
  assert.equal(await wallet(second),39);
  assert.equal(await wallet(smith),39);
  await denied(()=>rows('SELECT * FROM public.territory_profession_stage8_receipts'),/permission denied/i);

  // A verified 300-level player still needs an independently verified licence.
  await role();
  await db.exec(`UPDATE public.territory_profession_stage8_progress SET mastery_level=300,mastery_xp=0 WHERE player_id='${second}';`);
  await useUser(second);
  await denied(()=>exec('s8_smith_jarl_blade',operations[1]),/licen[cs]e|licensed|master/i);
  await role();
  await db.exec(`UPDATE public.territory_profession_unlocks SET master_license=true WHERE player_id='${second}';`);
  await useUser(second);
  await denied(()=>exec('s8_smith_jarl_blade',operations[1]),/resources|insufficient/i,
    'Licence alone does not bypass ingredient cost');
  await role();
  await db.exec(`INSERT INTO public.territory_resource_wallet(player_id,resource_id,quantity)
    VALUES('${second}','gather-wood',100),('${second}','gather-crystal',100);`);
  await useUser(second);
  const prestige=await exec('s8_smith_jarl_blade',operations[1]);
  assert.equal(prestige.success,true);
  assert.equal(prestige.kind,'item');
  assert.ok(prestige.item_id);
  assert.equal(prestige.item_output.equipment.attack,35);
  assert.equal(await wallet(second),9);
  assert.deepEqual(await exec('s8_smith_jarl_blade',operations[1]),prestige);
  assert.deepEqual(await mastery(second),{mastery_level:300,mastery_xp:0},
    'Mastery must never overflow the level-300 cap');
  const secondItems=await inventory();
  assert.equal(secondItems.success,true);
  assert.equal(secondItems.items.length,1);
  assert.equal(secondItems.items[0].item_id,prestige.item_id);
  assert.equal(secondItems.items[0].item_output.name,'Клинок первого ярла');
  await useUser(smith);
  assert.deepEqual((await inventory()).items,[],
    'Another hero must never receive server-owned crafted items');
  await role();
  await db.exec(`UPDATE public.territory_profession_stage8_progress SET mastery_level=100,mastery_xp=0 WHERE player_id='${second}';`);
  await db.exec(`UPDATE public.territory_profession_stage8_daily_xp SET xp_used=250 WHERE player_id='${second}';`);
  await useUser(second);
  const beforeOverflow=await wallet(second);
  await denied(()=>exec('s8_smith_practice_100',operations[16]),/daily|cap|limit|xp/i,
    'A 180-XP recipe cannot exceed the remaining 50 XP daily allowance');
  assert.equal(await wallet(second),beforeOverflow,'Over-cap craft never spends resources');

  // Created consumables get a server-stamped seven-day lifetime; gathered
  // resources themselves carry no expiry and remain in wallet indefinitely.
  await useUser(alchemist);
  const potion=await exec('s8_alchemist_herbal_mix',operations[15]);
  assert.equal(potion.kind,'item');
  assert.equal(potion.item_output.type,'potion');
  assert.ok(potion.item_id);
  const lifetime=(Date.parse(potion.expires_at)-Date.now())/86400000;
  assert.ok(lifetime>6.99 && lifetime<=7.001,'Potion must expire in seven days');
  const alchemistItems=await inventory();
  assert.equal(alchemistItems.items.length,1);
  assert.equal(alchemistItems.items[0].expires_at,potion.expires_at);
  await role();
  await db.exec(`UPDATE public.territory_profession_stage8_items
    SET expires_at=clock_timestamp()-interval '1 second' WHERE item_id='${potion.item_id}';`);
  await useUser(alchemist);
  assert.deepEqual((await inventory()).items,[],
    'Expired consumables must disappear from authoritative inventory response');
  assert.equal(await wallet(alchemist,'gather-herb'),5);
  assert.equal(await wallet(alchemist,'gather-wood'),8);

  // A legacy recipe must still craft its canonical output and spend its
  // ORIGINAL resource cost, not vanish when switching to the new interface.
  await useUser(artisan);
  const tradeGood=await exec('artisan_toolkit',operations[17]);
  assert.equal(tradeGood.success,true);
  assert.equal(tradeGood.item_output.type,'material');
  assert.equal(tradeGood.item_output.name,'Набор ремесленника');
  assert.equal(tradeGood.expires_at,null,'Durable crafted trade goods do not expire');
  assert.equal(await wallet(artisan,'gather-wood'),6);
  assert.equal(await wallet(artisan,'gather-ore'),8);
  assert.equal((await inventory()).items[0].item_id,tradeGood.item_id);

  // A failed transaction cannot debit the wallet even if later checks fail.
  await role();
  assert.deepEqual(await rows('SELECT id,gold,gems,game_state FROM public.players ORDER BY id'),beforePlayers,
    'New profession backend must not rewrite currencies or old game saves');
  assert.deepEqual(await rows('SELECT player_id,profession,mastery_level,mastery_xp FROM public.territory_profession_mastery_v1 ORDER BY player_id'),[
    {player_id:smith,profession:'smith',mastery_level:1,mastery_xp:0},
    {player_id:second,profession:'smith',mastery_level:1,mastery_xp:0},
    {player_id:legacy,profession:'smith',mastery_level:50,mastery_xp:300},
    {player_id:alchemist,profession:'alchemist',mastery_level:25,mastery_xp:0},
    {player_id:artisan,profession:'artisan',mastery_level:1,mastery_xp:0},
  ],'Stage8 must never mutate legacy mastery');

  // Do not silently grant level 1 to an OLD player whose mastery history is
  // absent or unverified. An independent new-player enrollment path, if added,
  // must distinguish trusted post-cutover newcomers from these legacy cases.
  await db.exec(`INSERT INTO public.players(id,gold,gems,game_state,created_at)
    VALUES('${oldWithoutMastery}',800,80,'{"legacy":"must-not-reset"}',clock_timestamp()-interval '90 days'),
          ('${oldUnverified}',600,60,'{"legacy":"not-verified"}',clock_timestamp()-interval '90 days');
    INSERT INTO public.territory_profession_unlocks(player_id,profession)
      VALUES('${oldWithoutMastery}','smith'),('${oldUnverified}','smith');
    INSERT INTO public.territory_profession_mastery_v1
      (player_id,profession,mastery_level,mastery_xp,verified)
      VALUES('${oldUnverified}','smith',7,53,false);`);
  await role('service_role');
  for(const id of [oldWithoutMastery,oldUnverified]){
    await denied(()=>rows('SELECT public.territory_profession_stage8_reconcile($1::uuid)',[id]),
      /mastery|verified|legacy/i,'Legacy player without verified mastery cannot be reset');
  }
  await role();
  assert.equal((await one('SELECT count(*)::int AS n FROM public.territory_profession_stage8_progress WHERE player_id=ANY($1::uuid[])',[[oldWithoutMastery,oldUnverified]])).n,0);
  await denied(()=>db.exec(`INSERT INTO public.territory_profession_stage8_progress
      (player_id,profession,mastery_level,mastery_xp,verified,original_v1_level,original_v1_xp)
      VALUES('${oldWithoutMastery}','smith',1,0,true,1,0);`),
    /stage8_verified_requires_audit|check constraint/i,'Verified Stage8 progress requires an audit timestamp');
  await useUser(oldWithoutMastery);
  assert.equal((await status()).enabled,false,'Existing account without verified Stage8 status stays locked');
  await denied(()=>exec('s8_smith_practice_1',operations[17]),/mastery|reconcil|verified/i);

  // Post-cutover new player purchases the one permanent profession atomically:
  // server currency (-1000), unlock, event and Stage8 verified level 1 appear
  // together under one idempotent receipt. Existing old accounts are excluded.
  await role();
  await db.exec(`INSERT INTO public.players(id,gold,gems,game_state,created_at)
    VALUES('${newcomer}',10,1500,'{"do":"not-overwrite"}',clock_timestamp()),
          ('${insufficientNew}',20,999,'{"do":"not-overwrite"}',clock_timestamp()),
          ('${oldWithoutUnlock}',30,5000,'{"old":"keep"}',clock_timestamp()-interval '90 days');`);
  await useUser(newcomer);
  const newcomerStatus=await status();
  assert.equal(newcomerStatus.enabled,true,'Clean post-cutover player can see the profession chooser');
  assert.equal(newcomerStatus.profession,null,'New player cannot own an unpurchased profession');
  await denied(()=>exec('s8_smith_practice_1',operations[16]),/mastery|reconcil|verified/i,
    'Visible chooser is not a shortcut to awarding mastery or goods');
  assert.equal((await one("SELECT has_function_privilege('anon','public.territory_profession_stage8_purchase(text,uuid)','EXECUTE') granted")).granted,false);
  assert.equal((await one("SELECT has_function_privilege('authenticated','public.territory_profession_stage8_purchase(text,uuid)','EXECUTE') granted")).granted,true);
  await denied(()=>rows('UPDATE public.players SET gems=9999999 WHERE id=$1',[newcomer]),/permission denied/i,
    'Client cannot directly alter the authoritative gems column');
  await denied(()=>rows(`INSERT INTO public.territory_profession_stage8_new_unlock_events
    (player_id,profession,purchase_operation,verified_at) VALUES($1,'smith',$2::uuid,clock_timestamp())`,[newcomer,operations[17]]),
    /permission denied/i,'Client cannot forge a verified purchase event');
  const bought=await purchase('smith',operations[17]);
  assert.equal(bought.success,true);
  assert.equal((await asOwner(()=>one('SELECT gems FROM public.players WHERE id=$1',[newcomer]))).gems,500);
  const newProgress=await mastery(newcomer);
  assert.deepEqual(newProgress,{mastery_level:1,mastery_xp:0});
  const staged=await asOwner(()=>one('SELECT origin,verified,original_v1_level,original_v1_xp,reconciled_at FROM public.territory_profession_stage8_progress WHERE player_id=$1',[newcomer]));
  assert.equal(staged.origin,'new_unlock');
  assert.equal(staged.verified,true);
  assert.equal(staged.original_v1_level,null);
  assert.equal(staged.original_v1_xp,null);
  assert.ok(staged.reconciled_at);
  assert.equal((await status()).enabled,true,'Newly purchased profession is immediately server-verified');
  assert.equal((await one("SELECT has_function_privilege('anon','public.territory_profession_stage8_initialize()','EXECUTE') granted")).granted,false);
  assert.equal((await one("SELECT has_function_privilege('authenticated','public.territory_profession_stage8_initialize()','EXECUTE') granted")).granted,true);
  const initializedAgain=(await one('SELECT public.territory_profession_stage8_initialize() AS result')).result;
  assert.equal(initializedAgain.existing,true,'Initializing an already purchased account is read-only');
  assert.deepEqual(await purchase('smith',operations[17]),bought,'Repeated purchase UUID is exactly-once');
  assert.equal((await asOwner(()=>one('SELECT gems FROM public.players WHERE id=$1',[newcomer]))).gems,500);
  await denied(()=>purchase('jeweler',operations[17]),/operation|conflict|collision|already_purchased/i);
  await denied(()=>purchase('smith',operations[18]),/already|profession|chosen|unlocked/i);
  assert.equal((await asOwner(()=>rows('SELECT * FROM public.territory_profession_stage8_new_unlock_events WHERE player_id=$1',[newcomer]))).length,1);

  await useUser(insufficientNew);
  await denied(()=>purchase('smith',operations[19]),/insufficient|gems|currency/i);
  assert.equal((await asOwner(()=>one('SELECT gems FROM public.players WHERE id=$1',[insufficientNew]))).gems,999);
  assert.equal((await asOwner(()=>rows('SELECT * FROM public.territory_profession_stage8_progress WHERE player_id=$1',[insufficientNew]))).length,0);
  await useUser(oldWithoutUnlock);
  await denied(()=>purchase('smith',operations[19]),/legacy|old|cutover|new_player|not.*eligible/i,
    'Pre-cutover account with no prior unlock is NOT reclassified as a brand new player');
  assert.equal((await asOwner(()=>one('SELECT gems FROM public.players WHERE id=$1',[oldWithoutUnlock]))).gems,5000);
  await useUser(oldUnverified);
  await denied(()=>purchase('jeweler',operations[19]),/legacy|old|cutover|already|profession|mastery/i,
    'Unverified old player cannot reset into a new profession');

  // If an external, separately audited service-role purchase adapter ever
  // records the purchase event first, initialize() may create the matching
  // Stage8 progress without charging gems a second time.
  await role();
  await db.exec(`INSERT INTO public.players(id,gems,game_state,created_at)
      VALUES('${adapterNew}',500,'{"trusted":"adapter"}',clock_timestamp()),
            ('${eventMismatch}',500,'{"trusted":"mismatch"}',clock_timestamp());
    INSERT INTO public.territory_profession_unlocks(player_id,profession)
      VALUES('${adapterNew}','smith'),('${eventMismatch}','jeweler');`);
  await useUser(adapterNew);
  await denied(()=>rows('SELECT public.territory_profession_stage8_initialize()'),/verified_new_purchase|required|event/i,
    'An unlocked account without server purchase event cannot initialize');
  await role('service_role');
  await db.exec(`INSERT INTO public.territory_profession_stage8_new_unlock_events
      (player_id,profession,purchase_operation,verified_at,gems_after)
      VALUES ('${adapterNew}','smith','${operations[11]}',clock_timestamp(),500),
             ('${eventMismatch}','smith','${operations[12]}',clock_timestamp(),500);`);
  await useUser(adapterNew);
  const initialized=(await one('SELECT public.territory_profession_stage8_initialize() AS result')).result;
  assert.equal(initialized.success,true);
  assert.equal(initialized.existing,false);
  assert.equal(initialized.mastery_level,1);
  assert.equal((await asOwner(()=>one('SELECT gems FROM public.players WHERE id=$1',[adapterNew]))).gems,500,
    'Initialize may not debit gems twice');
  assert.equal((await one('SELECT public.territory_profession_stage8_initialize() AS result')).result.existing,true);
  assert.equal((await asOwner(()=>rows('SELECT * FROM public.territory_profession_stage8_progress WHERE player_id=$1',[adapterNew]))).length,1);
  await useUser(eventMismatch);
  await denied(()=>rows('SELECT public.territory_profession_stage8_initialize()'),/disagreement|profession/i,
    'A purchase event for the wrong profession cannot authorize initialization');
  // Give a pre-cutover account the strongest possible counterfeit-looking
  // input: a *service-role* event with a fresh timestamp and matching unlock.
  // The cutoff must still prevent treating a legacy player as a new customer.
  await role('service_role');
  await db.exec(`INSERT INTO public.territory_profession_stage8_new_unlock_events
      (player_id,profession,purchase_operation,verified_at,gems_after)
      VALUES('${oldWithoutMastery}','smith','${operations[13]}',clock_timestamp(),80);`);
  await useUser(oldWithoutMastery);
  await denied(()=>rows('SELECT public.territory_profession_stage8_initialize()'),/legacy|cutover|old/i,
    'Pre-cutover player cannot be initialized even with a trusted purchase event');

  // A legacy API/column grant would let clients mint backing currencies or
  // unlocks. Stage8 must fail CLOSED if an operator inadvertently restores it.
  await role();
  await db.exec('GRANT UPDATE(gems) ON public.players TO authenticated');
  await useUser(insufficientNew);
  const unsafeGems=await status();
  assert.equal(unsafeGems.enabled,false);
  assert.match(unsafeGems.reason,/economy_not_server_authoritative/);
  await denied(()=>purchase('smith',operations[14]),/economy_not_server_authoritative/);
  await role();
  await db.exec('REVOKE UPDATE(gems) ON public.players FROM authenticated');
  await db.exec(`CREATE FUNCTION public.territory_profession_unlock(text) RETURNS boolean
    LANGUAGE sql AS $$ SELECT true $$;
    GRANT EXECUTE ON FUNCTION public.territory_profession_unlock(text) TO authenticated;`);
  await useUser(insufficientNew);
  assert.equal((await status()).enabled,false,'Exposed legacy unlock RPC blocks Stage8');
  await denied(()=>purchase('smith',operations[14]),/economy_not_server_authoritative/);
  await role();
  await db.exec('REVOKE ALL ON FUNCTION public.territory_profession_unlock(text) FROM PUBLIC, authenticated');
  await useUser(insufficientNew);
  assert.equal((await status()).enabled,true,'Stage8 is ready again once the unsafe grant is removed');
  await role();
  console.log('Stage8 SQL PASS: 72 recipes/XP bands, release OFF/RLS/ACL, audited legacy v1→stage8, atomic 1000-gem purchase, insufficient/cutover defenses, trusted initialize only, unsafe-economy fail-close, atomic resources, replay/UUID collision, Kyiv-day 300-XP cap, per-account isolation, licensed prestige, server inventory and 7-day potion expiry; all in local PGlite.');
}finally{
  await db.close();
}
