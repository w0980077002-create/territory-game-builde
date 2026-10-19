import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const id='11111111-1111-4111-8111-111111111111';
await db.exec([
 "CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA territory_private;",
 "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('test.uid',true),'')::uuid$$;",
 "CREATE TABLE public.players(id uuid PRIMARY KEY,telegram_id bigint,banned boolean DEFAULT false,game_state jsonb,updated_at timestamptz DEFAULT now(),gold int NOT NULL DEFAULT 0,gems int NOT NULL DEFAULT 0);",
 "CREATE TABLE territory_private.hall_accounts_v1(player_id uuid PRIMARY KEY REFERENCES public.players(id),tickets int NOT NULL DEFAULT 4);",
 "INSERT INTO public.players(id,telegram_id,banned,gold,gems,game_state) VALUES ('11111111-1111-4111-8111-111111111111',123456,false,100,5,'{\"player\":{\"gold\":100,\"gems\":5},\"battleStones\":10,\"inventory\":[],\"forgeMaterials\":1}');",
 "SELECT set_config('test.uid','11111111-1111-4111-8111-111111111111',false);"
].join('\n'));
await db.exec(readFileSync('supabase/staged/territory_daily_share_v1.sql','utf8'));
const call=async(action='status',task=null,expected=null)=>(await db.query('SELECT public.territory_daily_share_v1($1,$2,$3) AS data',[action,task,expected])).rows[0].data;
const status=await call();
assert.equal(status.tasks.length,2);
assert.deepEqual(status.tasks.map(t=>t.task).sort(),['monopoly','trials']);
assert(status.tasks.every(t=>t.ready));
const t1=await call('claim','monopoly');
assert.equal(t1.added,2); assert.equal(t1.tickets,6);
await assert.rejects(call('claim','monopoly'),/daily_share_cooldown/);
assert.equal((await db.query('SELECT tickets FROM territory_private.hall_accounts_v1 WHERE player_id=$1',[id])).rows[0].tickets,6);
assert.equal((await call()).tasks.find(t=>t.task==='trials').ready,true);
const before=(await db.query('SELECT updated_at,game_state FROM public.players WHERE id=$1',[id])).rows[0];
await assert.rejects(call('claim','trials',new Date(0).toISOString()),/daily_share_reload_required/);
const s1=await call('claim','trials',before.updated_at);
assert.equal(s1.added,2); assert.equal(s1.game_state.battleStones,12);
assert.equal(s1.wallet_gold,100);assert.equal(s1.wallet_gems,5);
await assert.rejects(call('claim','trials',before.updated_at),/daily_share_cooldown/);
assert.equal((await db.query('SELECT count(*)::int AS n FROM territory_private.daily_share_claims_v1')).rows[0].n,2);
await db.exec("UPDATE territory_private.daily_share_claims_v1 SET claimed_at=clock_timestamp()-interval '25 hours' WHERE task='monopoly';");
await db.exec("UPDATE territory_private.hall_accounts_v1 SET tickets=20 WHERE player_id='11111111-1111-4111-8111-111111111111';");
await assert.rejects(call('claim','monopoly'),/daily_share_ticket_wallet_full/);
assert.equal((await db.query('SELECT tickets FROM territory_private.hall_accounts_v1 WHERE player_id=$1',[id])).rows[0].tickets,20);
assert.equal((await db.query("SELECT has_function_privilege('anon','public.territory_daily_share_v1(text,text,timestamptz)','EXECUTE') AS permitted")).rows[0].permitted,false);
const mono=readFileSync('src/components/monopoly/MonopolyAdventure.tsx','utf8');
const trials=readFileSync('src/components/BattleScreen.tsx','utf8');
const api=readFileSync('src/game/dailyShare.ts','utf8');
assert.match(mono,/DailyShareCard task="monopoly"/);
assert.match(trials,/DailyShareCard task="trials"/);
assert(!mono.includes('monopoly-referral-task'));
assert(api.includes("language==='ru'"));
assert(api.includes('acceptMonopolyClaimReceipt'));
await db.close();
console.log('Daily sharing PASS: separate 24h rewards, ticket cap, CAS game stones, no duplicate awards, locked RPC');
