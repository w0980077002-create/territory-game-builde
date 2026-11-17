/** Isolated Postgres contract; no network, production accounts or currencies. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
const op='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const one=async(q,p=[]) => (await db.query(q,p)).rows[0];
try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE SCHEMA territory_private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
 CREATE TABLE players(id uuid PRIMARY KEY,telegram_id bigint,username text,banned boolean DEFAULT false,gold int DEFAULT 10,gems int DEFAULT 2,game_state jsonb,updated_at timestamptz DEFAULT now());
 CREATE TABLE admin_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),player_id uuid,kind text,subject text,body text,payload jsonb);
 CREATE TABLE admin_audit_log(action text,details jsonb);
 CREATE TABLE territory_private.territory_master_license_red_wallet_v1(player_id uuid PRIMARY KEY,balance int CHECK(balance>=0));
 INSERT INTO players(id,telegram_id,username,game_state) VALUES('${a}',123,'Amiksor','{"player":{"redGems":60,"level":61},"sentinel":"preserve"}'),('${b}',456,'Other','{"player":{"redGems":29}}');
 INSERT INTO territory_private.territory_master_license_red_wallet_v1 VALUES('${a}',60),('${b}',29);`);
 await db.exec(readFileSync('supabase/staged/territory_goose_companion_v1.sql','utf8'));
 await db.query("select set_config('test.uid',$1,false)",[a]);
 const rev=(await one('select updated_at from players where id=$1',[a])).updated_at;
 const buy=async(id=op,expected=rev)=>(await one('select territory_goose_buy_v1($1,$2) as r',[id,expected])).r;
 const receipt=await buy(); assert.equal(receipt.owned,true);
 assert.equal((await one('select balance from territory_private.territory_master_license_red_wallet_v1 where player_id=$1',[a])).balance,30);
 assert.equal(receipt.game_state.sentinel,'preserve'); assert.equal(receipt.wallet_gold,10); assert.equal(receipt.wallet_gems,2);
 const duplicate=await buy('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');assert.equal(duplicate.receipt,receipt.receipt);
 assert.equal((await one('select count(*)::int as n from territory_private.goose_entitlements_v1')).n,1);
 // Gift after a purchase: one ownership, one presentation letter, no new debit.
 await assert.rejects(db.query('select territory_goose_gift_v1($1,999,$2,$3)',[a,'Amiksor',op]),/identity_changed/);
 const gift=async()=> (await one('select territory_goose_gift_v1($1,123,$2,$3) as r',[a,'Amiksor',op])).r;
 assert.equal((await gift()).receipt,receipt.receipt);await gift();
 assert.equal((await one('select count(*)::int as n from admin_grants')).n,1);
 assert.equal((await one('select payload from admin_grants')).payload.constructor,Object);
 assert.equal((await one('select body from admin_grants')).body.includes('многочисленные требования компенсации'),true);
 assert.equal((await one('select balance from territory_private.territory_master_license_red_wallet_v1 where player_id=$1',[a])).balance,30);
 // Authenticated players cannot call owner gift or mutate the ledger.
 assert.equal((await one("select has_function_privilege('authenticated','public.territory_goose_gift_v1(uuid,bigint,text,uuid)','execute') as ok")).ok,false);
 assert.equal((await one("select has_table_privilege('authenticated','territory_private.goose_entitlements_v1','insert') as ok")).ok,false);
 await db.query("select set_config('test.uid',$1,false)",[b]);
 const revB=(await one('select updated_at from players where id=$1',[b])).updated_at;
 // A desynchronized red wallet must not be silently reduced during a purchase.
 await db.query('update territory_private.territory_master_license_red_wallet_v1 set balance=31 where player_id=$1',[b]);
 await assert.rejects(buy(op,revB),/goose_wallet_desync/);
 assert.equal((await one('select balance from territory_private.territory_master_license_red_wallet_v1 where player_id=$1',[b])).balance,31);
 assert.equal((await one("select game_state #>> '{player,redGems}' as red from players where id=$1",[b])).red,'29');
 await db.query('update territory_private.territory_master_license_red_wallet_v1 set balance=29 where player_id=$1',[b]);
 await assert.rejects(buy(op,revB),/insufficient_red_gems/);
 // Gift first, then buy from another device: zero total cost, one row/mail.
 await db.query("update players set username='Amiksor' where id=$1",[b]);
 await db.query('select territory_goose_gift_v1($1,456,$2,$3)',[b,'Amiksor',op]);
 const afterGift=await buy(op,revB);assert.equal(afterGift.owned,true);
 assert.equal((await one('select balance from territory_private.territory_master_license_red_wallet_v1 where player_id=$1',[b])).balance,29);
 assert.equal((await one('select count(*)::int as n from admin_grants')).n,2);
 await db.query("select set_config('test.uid','',false)"); await assert.rejects(buy(),/login_required/);
 console.log('PASS goose SQL: purchase/replay/two-device operation IDs, gift-purchase orderings, identity rejection, one mail, rollback, privileges, wallet preservation');
} finally { await db.close(); }
