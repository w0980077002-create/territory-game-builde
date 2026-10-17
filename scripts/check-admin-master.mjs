import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const sql=readFileSync('supabase/migrations/20261017_admin_master_controls_v2.sql','utf8');
const db=new PGlite();
const ids=Array.from({length:4},(_,i)=>'10000000-0000-0000-0000-'+String(i+1).padStart(12,'0'));
const q=async(s,args=[]) => (await db.query(s,args)).rows;
const rpc=async(fn,args=[],casts=[])=>{
 const placeholders=args.map((_,i)=>'$'+(i+1)+(casts[i]?'::'+casts[i]:'')).join(',');
 return (await q('SELECT public.'+fn+'('+placeholders+') AS answer',args))[0].answer;
};
const req=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
try{
 await db.exec([
 'CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;',
 'CREATE SCHEMA territory_private;CREATE SCHEMA auth;',
 "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';",
 'CREATE TABLE public.players(id uuid PRIMARY KEY,telegram_id bigint,display_name text,banned boolean NOT NULL DEFAULT false,last_seen_at timestamptz,created_at timestamptz DEFAULT clock_timestamp());',
 'CREATE TABLE territory_private.hall_accounts_v1(player_id uuid PRIMARY KEY REFERENCES public.players(id),tickets integer NOT NULL DEFAULT 4 CHECK(tickets BETWEEN 0 AND 20),points int DEFAULT 0,played int DEFAULT 0,wins int DEFAULT 0,pending_gold int DEFAULT 0,claimed_gold int DEFAULT 0,daily_gold int DEFAULT 0);',
 'CREATE TABLE territory_private.hall_sessions_v1(player_id uuid PRIMARY KEY REFERENCES public.players(id),game text,created_at timestamptz DEFAULT clock_timestamp());',
 'CREATE TABLE territory_private.hall_history_v1(player_id uuid,game text,won boolean,earned_gold int,played_at timestamptz DEFAULT clock_timestamp());'
 ].join('\n'));
 for(let i=0;i<4;i++)await q('INSERT INTO public.players(id,display_name,last_seen_at,banned) VALUES($1,$2,$3,$4)',[
  ids[i],'User'+(i+1),i===1?new Date().toISOString():new Date(0).toISOString(),i===3
 ]);
 await q('INSERT INTO territory_private.hall_accounts_v1(player_id,tickets) VALUES($1,0)',[ids[0]]);
 await db.exec(sql);
 const ownerFunctions=['territory_hall_admin_adjust_v2(uuid,text,uuid,integer,text)',
  'territory_hall_admin_overview_v2()','territory_hall_admin_player_v2(uuid)',
  'territory_admin_credential_v2()','territory_admin_rotate_v2(text,text,integer)'];
 for(const fn of ownerFunctions){
  for(const role of ['anon','authenticated']){
   assert.equal((await q('SELECT has_function_privilege($1,$2,$3) AS b',[role,'public.'+fn,'execute']))[0].b,false,
    role+' must not execute '+fn);
  }
  assert.equal((await q("SELECT has_function_privilege('service_role',$1,'execute') AS b",['public.'+fn]))[0].b,true);
 }
 assert.equal((await q("SELECT has_table_privilege('authenticated','territory_private.hall_admin_receipts_v2','SELECT') AS b"))[0].b,false);
 const grant=(key,scope,player,delta,note='Test admin grant')=>rpc('territory_hall_admin_adjust_v2',[key,scope,player,delta,note],
  ['uuid','text','uuid','integer','text']);
 const once=await grant(req(1),'one',ids[0],20);
 assert.equal(once.affected,1);assert.equal(once.balance,20);
 assert.equal((await rpc('territory_hall_admin_player_v2',[ids[0]],['uuid'])).tickets,20);
 assert.equal((await grant(req(1),'one',ids[0],20)).replayed,true,'retry does not double gift');
 assert.equal((await rpc('territory_hall_admin_player_v2',[ids[0]],['uuid'])).tickets,20);
 await assert.rejects(grant(req(1),'one',ids[0],25),/admin_request_conflict/,'different amount with same request denied');
 await assert.rejects(grant(req(2),'one',null,5),/admin_bad_ticket_grant/);
 await assert.rejects(grant(req(3),'one',ids[0],251),/admin_bad_ticket_grant/);
 await assert.rejects(grant(req(4),'one',ids[0],1,'x'),/admin_bad_ticket_grant/);
 const active=await grant(req(5),'active',null,12);
 assert.equal(active.affected,1);
 assert.equal((await rpc('territory_hall_admin_player_v2',[ids[1]],['uuid'])).tickets,16);
 const all=await grant(req(6),'all',null,5);
 assert.equal(all.affected,3,'banned player excluded');
 assert.equal((await rpc('territory_hall_admin_player_v2',[ids[0]],['uuid'])).tickets,25);
 assert.equal((await rpc('territory_hall_admin_player_v2',[ids[2]],['uuid'])).tickets,9);
 assert.equal((await rpc('territory_hall_admin_player_v2',[ids[3]],['uuid'])).tickets,4,'banned player untouched');
 const remove=await grant(req(7),'one',ids[0],-250);
 assert.equal(remove.balance,0,'deduction never produces negative tickets');
 for(let i=8;i<=12;i++)await grant(req(i),'one',ids[0],250);
 assert.equal((await rpc('territory_hall_admin_player_v2',[ids[0]],['uuid'])).tickets,1000,'admin cap 1000');
 const overview=await rpc('territory_hall_admin_overview_v2');
 assert.equal(overview.wallets,3);assert.equal(overview.activeSessions,0);
 assert.equal(overview.tickets,1000+21+9);
 assert.equal((await q('SELECT count(*)::int AS n FROM territory_private.hall_admin_receipts_v2'))[0].n,9);
 await q("INSERT INTO territory_private.admin_auth_v2(id,salt,verifier,version) VALUES(1,repeat('a',32),repeat('b',64),1)");
 assert.equal((await rpc('territory_admin_credential_v2')).version,1);
 assert.equal(await rpc('territory_admin_rotate_v2',['c'.repeat(32),'d'.repeat(64),1]),2);
 await assert.rejects(rpc('territory_admin_rotate_v2',['c'.repeat(32),'d'.repeat(64),1]),/admin_auth_conflict/);
 assert.equal((await rpc('territory_admin_credential_v2')).version,2);
 console.log('ADMIN CONTROL PASS: one/active/all tickets, idempotency, bounds, bans, owner-only RPC, balance report, rotating password verifier.');
}finally{await db.close();}
