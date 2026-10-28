// Isolated PostgreSQL, never connects to Supabase or Telegram.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const A='10000000-0000-4000-8000-000000000001', B='10000000-0000-4000-8000-000000000002';
const op = n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const as=async(id)=>q("SELECT set_config('request.jwt.claim.sub',$1,false)",[id??'']);
const rpc=async(name,args=[]) => (await q(`SELECT ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS r`,args))[0].r;
const order=async(n)=>rpc('territory_stars_order_v1',['fixture',op(n)]);
const check=async(o,tg=111,amount=10,query='q-'+o.orderId)=>rpc('territory_stars_precheckout_v1',[o.orderId,tg,'XTR',amount,query]);
const pay=async(o,tg=111,charge='charge-'+o.orderId)=>rpc('territory_stars_fulfill_v1',[o.orderId,tg,'XTR',10,charge]);
try {
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE SCHEMA territory_private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE players(id uuid PRIMARY KEY,telegram_id bigint UNIQUE,banned boolean DEFAULT false,vip_level integer DEFAULT 0,gold integer,gems integer,game_state jsonb,updated_at timestamptz DEFAULT now());
 CREATE TABLE territory_private.fortune_inventory_v1(player_id uuid PRIMARY KEY,vip_until timestamptz);
 CREATE FUNCTION territory_private.fortune_vip_v1(u uuid) RETURNS integer LANGUAGE sql STABLE AS $$SELECT greatest(p.vip_level,CASE WHEN f.vip_until>statement_timestamp() THEN 1 ELSE 0 END) FROM public.players p LEFT JOIN territory_private.fortune_inventory_v1 f ON f.player_id=p.id WHERE p.id=u$$;
 CREATE TABLE territory_private.territory_master_license_red_wallet_v1(player_id uuid PRIMARY KEY,balance integer);`);
await db.exec(readFileSync(new URL('../supabase/staged/territory_v1_monetization_completion.sql',import.meta.url),'utf8'));
for(const [id,tg,tier] of [[A,111,5],[B,222,0]]) {
 await q(`INSERT INTO players(id,telegram_id,vip_level,gold,gems,game_state) VALUES($1,$2,$3,100,20,'{"player":{"gold":100,"gems":20,"redGems":30,"name":"legacy"},"inventory":[{"id":"old","qty":9}],"blessing":{"charges":2},"unknown":{"keep":true}}')`,[id,tg,tier]);
 await q('INSERT INTO territory_private.territory_master_license_red_wallet_v1 VALUES($1,30)',[id]);
}
await as(A);
assert.equal((await rpc('territory_vip_status_v1')).tier,5);
assert.equal((await rpc('territory_vip_status_v1')).bonusesConfigured,false);
await q("INSERT INTO territory_private.fortune_inventory_v1 VALUES($1,now()+interval '24 hours')",[B]);
await as(B);assert.equal((await rpc('territory_vip_status_v1')).tier,1,'existing temporary VIP preserved');
await q("UPDATE territory_private.fortune_inventory_v1 SET vip_until=now()-interval '1 second' WHERE player_id=$1",[B]);
assert.equal((await rpc('territory_vip_status_v1')).tier,0,'expiry uses database time');
await as(A);

await assert.rejects(order(1),/payments_disabled/);
await q('UPDATE territory_private.monetization_config_v1 SET payments_enabled=true');
await assert.rejects(order(1),/pack_not_approved/);
// TEST FIXTURE only: invented test amounts never inserted by staged SQL.
await q("INSERT INTO territory_private.stars_catalog_v1(sku,title,description,stars,gold,gems,red_gems,vip_points,enabled,approval_reference) VALUES('fixture','Fixture','Test only',10,50,7,3,100,true,'AUTOMATED TEST FIXTURE')");
const before=(await q('SELECT * FROM players WHERE id=$1',[A]))[0];
const o=await order(1); assert.deepEqual(await order(1),o);
await assert.rejects(rpc('territory_stars_order_v1',['other',op(1)]),/operation_id_reused/);
assert.equal(await check(o,222),false);assert.equal(await check(o,111,11),false);
await assert.rejects(pay(o),/precheckout_required/);
assert.equal(await check(o),true); assert.equal(await check(o),true);
assert.equal(await check(o,111,10,'different-query'),false,'only one charge attempt per invoice');
await q("UPDATE territory_private.stars_orders_v1 SET expires_at=now()-interval '1 minute' WHERE id=$1",[o.orderId]);
await q('UPDATE territory_private.monetization_config_v1 SET payments_enabled=false');
const paid=await pay(o); assert.equal(paid.replayed,false); assert.equal((await pay(o)).replayed,true);
await assert.rejects(pay(o,111,'other-charge'),/payment_charge_collision/);
const after=(await q('SELECT * FROM players WHERE id=$1',[A]))[0];
assert.equal(after.gold,150);assert.equal(after.gems,27);assert.equal(after.game_state.player.redGems,33);assert.equal(after.vip_level,5);
assert.deepEqual(after.game_state.inventory,before.game_state.inventory);assert.deepEqual(after.game_state.unknown,before.game_state.unknown);
assert.deepEqual(after.game_state.blessing,before.game_state.blessing);assert.equal(after.game_state.player.name,'legacy');
assert.ok(after.updated_at.getTime()>=before.updated_at.getTime(),'stale save token invalidated');
assert.equal((await q('SELECT updated_at>created_at AS newer FROM territory_private.stars_orders_v1 o JOIN players p ON p.id=o.player_id WHERE o.id=$1',[o.orderId]))[0].newer,true);
assert.equal((await q('SELECT points FROM territory_private.vip_progress_v1 WHERE player_id=$1',[A]))[0].points,100);
await q('UPDATE territory_private.monetization_config_v1 SET payments_enabled=true');
await as(B); const ob=await order(2);
assert.equal(await check(ob,222),true);await assert.rejects(pay(ob,222,'charge-'+o.orderId),/payment_charge_collision/);
assert.equal((await q('SELECT gold FROM players WHERE id=$1',[B]))[0].gold,100,'duplicate cross-account charge grants nothing');
assert.equal(await rpc('territory_stars_status_v1',[o.orderId]),null,'other account cannot inspect receipt');
await q("UPDATE players SET gold=2147483647,game_state=jsonb_set(game_state,'{player,gold}','2147483647') WHERE id=$1",[B]);
await assert.rejects(pay(ob,222),/wallet_overflow/);assert.equal((await q('SELECT state FROM territory_private.stars_orders_v1 WHERE id=$1',[ob.orderId]))[0].state,'prechecked');
await q("UPDATE players SET gold=100,game_state=jsonb_set(game_state,'{player,gold}','100') WHERE id=$1",[B]);await pay(ob,222);
await as(A); const o3=await order(3);assert.equal(await check(o3),true);
await q('UPDATE territory_private.territory_master_license_red_wallet_v1 SET balance=0 WHERE player_id=$1',[A]);
await assert.rejects(pay(o3),/red_wallet_reconciliation_required/);
assert.equal((await q('SELECT gold FROM players WHERE id=$1',[A]))[0].gold,150);
await q('UPDATE territory_private.territory_master_license_red_wallet_v1 SET balance=33 WHERE player_id=$1',[A]);
await q("INSERT INTO territory_private.vip_tiers_v1 VALUES(1,0,100,200,300,'TEST'),(6,100,1000,2000,5000,'TEST')");
await q('UPDATE territory_private.monetization_config_v1 SET vip_enabled=true');
const stats={attack:100,defense:50,hp:50,maxHp:100,critChance:10};
assert.deepEqual(await rpc('territory_private.vip_combat_stats_v1',[A,stats]),{attack:110,defense:60,hp:75,maxHp:150,critChance:10});
assert.equal((await rpc('territory_vip_status_v1')).tier,6);
await pay(o3);assert.equal((await q('SELECT vip_level FROM players WHERE id=$1',[A]))[0].vip_level,6);
// Combined staged economy: verified wallets remain the same authority.
await db.exec('CREATE TABLE public.territory_wallet_v1(player_id uuid PRIMARY KEY,gold bigint,gems bigint,verified boolean,updated_at timestamptz DEFAULT now())');
await q('INSERT INTO public.territory_wallet_v1 SELECT id,gold,gems,true,updated_at FROM public.players');
const o4=await order(4);assert.equal(await check(o4),true);
await q('UPDATE public.territory_wallet_v1 SET gems=gems+1 WHERE player_id=$1',[A]);
await assert.rejects(pay(o4),/wallet_reconciliation_required/);
await q('UPDATE public.territory_wallet_v1 SET gems=gems-1,verified=false WHERE player_id=$1',[A]);
await assert.rejects(pay(o4),/wallet_reconciliation_required/);
await q('UPDATE public.territory_wallet_v1 SET verified=true WHERE player_id=$1',[A]);
await pay(o4);
assert.equal((await q('SELECT p.gold=w.gold AND p.gems=w.gems AS agrees FROM public.players p JOIN public.territory_wallet_v1 w ON p.id=w.player_id WHERE p.id=$1',[A]))[0].agrees,true);
assert.equal((await q("SELECT (game_state#>>'{player,gold}')::bigint=gold AND (game_state#>>'{player,gems}')::bigint=gems AS agrees FROM public.players WHERE id=$1",[A]))[0].agrees,true);
// Fund-only paid pack: no unapproved production catalog rows are seeded by SQL.
await q("INSERT INTO territory_private.stars_catalog_v1(sku,title,description,stars,premium_fund,enabled,approval_reference) VALUES('fund-fixture','Fund fixture','Test only',10,'level',true,'AUTOMATED TEST FIXTURE')");
const fundOrder=await rpc('territory_stars_order_v1',['fund-fixture',op(5)]);
assert.equal(await check(fundOrder),false,'missing entitlement backend rejects precheckout');
const beforeFund=(await q('SELECT gold,gems,game_state FROM players WHERE id=$1',[A]))[0];
const progressionFixture=`CREATE FUNCTION territory_private.v1_progression_event(p_player uuid,p_event uuid,p_kind text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
 BEGIN
  IF NOT (SELECT enabled FROM territory_private.v1_progression_config WHERE id=1) THEN RAISE EXCEPTION 'progression_disabled'; END IF;
  INSERT INTO territory_private.fund_delivery_fixture VALUES(p_event,p_player,p_kind,p_payload);
  RETURN '{}'::jsonb;
 END $$;`;
await db.exec(`CREATE TABLE territory_private.fund_delivery_fixture(event_id uuid PRIMARY KEY,player_id uuid,kind text,payload jsonb);
 CREATE TABLE territory_private.v1_progression_config(id integer PRIMARY KEY,enabled boolean);
 INSERT INTO territory_private.v1_progression_config VALUES(1,false);`);
await db.exec(progressionFixture);
assert.equal(await check(fundOrder),false,'disabled entitlement backend rejects precheckout');
assert.equal((await q('SELECT state FROM territory_private.stars_orders_v1 WHERE id=$1',[fundOrder.orderId]))[0].state,'pending');
await q('UPDATE territory_private.v1_progression_config SET enabled=true');
assert.equal(await check(fundOrder),true);
// A dependency can fail after Telegram accepts the precheckout: preserve retry.
await db.exec('DROP FUNCTION territory_private.v1_progression_event(uuid,uuid,text,jsonb)');
await assert.rejects(pay(fundOrder),/premium_fund_delivery_unavailable/);
assert.equal((await q('SELECT state FROM territory_private.stars_orders_v1 WHERE id=$1',[fundOrder.orderId]))[0].state,'prechecked');
assert.deepEqual((await q('SELECT gold,gems,game_state FROM players WHERE id=$1',[A]))[0],beforeFund,'missing entitlement backend rolls back paid delivery');
await db.exec(progressionFixture);
await q('UPDATE territory_private.v1_progression_config SET enabled=false');
await assert.rejects(pay(fundOrder),/progression_disabled/);
assert.equal((await q('SELECT count(*)::int n FROM territory_private.fund_delivery_fixture'))[0].n,0);
// Mutating a live catalog cannot change an existing paid order's entitlement.
await q("UPDATE territory_private.stars_catalog_v1 SET premium_fund='arena' WHERE sku='fund-fixture'");
await q('UPDATE territory_private.v1_progression_config SET enabled=true');
await pay(fundOrder);await pay(fundOrder);
const deliveries=await q('SELECT * FROM territory_private.fund_delivery_fixture');
assert.equal(deliveries.length,1);assert.equal(deliveries[0].player_id,A);assert.equal(deliveries[0].kind,'fund_purchase');assert.deepEqual(deliveries[0].payload,{fund:'level'});
assert.equal(deliveries[0].event_id,(await q("SELECT md5($1||':fund')::uuid AS id",[fundOrder.orderId]))[0].id);
assert.deepEqual((await q('SELECT gold,gems,game_state FROM players WHERE id=$1',[A]))[0],beforeFund,'fund-only reward never fabricates currency');
await q('SET ROLE authenticated');
await assert.rejects(pay(o),/permission denied/);
await assert.rejects(q('SELECT * FROM territory_private.stars_orders_v1'),/permission denied/);
await q('RESET ROLE');await as(null);await assert.rejects(order(9),/not_authenticated/);
console.log('Monetization SQL PASS: disabled/empty catalog, two-account ownership, exact XTR amounts, persistent precheckout, duplicate charge & invoice protection, once rewards, failure rollback, stale-save token, legacy data, VIP formula & tier preservation, immutable premium-fund entitlement, missing/disabled progression retry, ACL.');
} finally { await db.close(); }
