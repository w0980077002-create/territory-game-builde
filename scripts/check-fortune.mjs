import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
const db=new PGlite();
const A='10000000-0000-0000-0000-000000000001',B='10000000-0000-0000-0000-000000000002';
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async(id)=>q("SELECT set_config('request.jwt.claim.sub',$1,false)",[id??'']);
const rpc=async(action='status',key=null,expected=null)=>(await q('SELECT public.territory_fortune_v1($1,$2::uuid,$3::timestamptz) AS r',[action,key,expected]))[0].r;
let seq=0;const key=()=>`20000000-0000-0000-0000-${String(++seq).padStart(12,'0')}`;
const fixture=(level=10)=>({player:{name:'Test',gold:100,gems:7,redGems:0,level,xp:level===100?0:10,xpToNext:300,maxEnergy:29,energy:20,stats:{hp:280,maxHp:280,attack:65,defense:23,critChance:5,critDamage:150},equipped:{}},inventory:[],followers:[{id:'follower_3',unlocked:false,level:2,attack:4,defense:2}],forgeMaterials:1,battleStones:10});
const reset=async(level=10)=>{
 await q('DELETE FROM territory_private.fortune_receipts_v1 WHERE player_id=$1',[A]);
 await q('DELETE FROM territory_private.hall_sessions_v1 WHERE player_id=$1',[A]);
 await q('UPDATE public.players SET game_state=$2,gold=100,gems=7,level=$3,vip_level=0 WHERE id=$1',[A,fixture(level),level]);
 await q('UPDATE territory_private.hall_accounts_v1 SET tickets=4 WHERE player_id=$1',[A]);
 await q('UPDATE territory_private.fortune_inventory_v1 SET common=0,rare=0,golden_key=0,vip_until=NULL WHERE player_id=$1',[A]);
};
const force=async(n)=>db.exec(`CREATE OR REPLACE FUNCTION territory_private.fortune_draw_v1() RETURNS integer LANGUAGE sql AS 'SELECT ${n}';`);
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA territory_private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
 CREATE TABLE public.players(id uuid PRIMARY KEY,banned boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),gold integer NOT NULL DEFAULT 100,gems integer NOT NULL DEFAULT 7,level integer NOT NULL DEFAULT 10,xp bigint DEFAULT 10,max_energy integer DEFAULT 29,forge_materials integer DEFAULT 1,vip_level integer NOT NULL DEFAULT 0,game_state jsonb);
 CREATE FUNCTION public.arena_set_auto(p_room uuid,p_on boolean) RETURNS void LANGUAGE plpgsql AS $$ DECLARE v_vip int; BEGIN SELECT vip_level INTO v_vip FROM players WHERE id = auth.uid(); END $$;
 CREATE FUNCTION public.arena_state(p_room uuid,p_after bigint) RETURNS json LANGUAGE plpgsql AS $$ DECLARE v_vip int; BEGIN SELECT vip_level INTO v_vip FROM players WHERE id = auth.uid(); RETURN to_json(v_vip); END $$;`);
 // Apply the actual production snapshot wallet/revision guard, not a mocked credit.
 const guard=readFileSync('supabase/production/territory_economy_guard_20261015.sql','utf8');
 await db.exec(guard.slice(guard.indexOf('CREATE OR REPLACE FUNCTION public.territory_economy_guard_v1()'),guard.indexOf('-- An isolated audit trigger')));
 await db.exec('CREATE TRIGGER economy_guard BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.territory_economy_guard_v1();');
 await q('INSERT INTO public.players(id,game_state) VALUES($1,$3),($2,$3)',[A,B,fixture()]);
 await db.exec(readFileSync('supabase/migrations/20261017_game_hall_five_v1.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261020130000_wheel_fortune.sql','utf8'));
 await as(A);await rpc();
 for(const table of ['fortune_inventory_v1','fortune_receipts_v1','fortune_loot_v1']){
  assert.equal((await q(`SELECT has_table_privilege('authenticated','territory_private.${table}','UPDATE') AS r`))[0].r,false);
  assert.equal((await q(`SELECT relrowsecurity AS r FROM pg_class WHERE oid='territory_private.${table}'::regclass`))[0].r,true);
 }
 assert.equal((await q("SELECT has_function_privilege('anon','public.territory_fortune_v1(text,uuid,timestamptz)','execute') AS r"))[0].r,false);
 for(const fn of ['fortune_draw_v1()','fortune_prize_v1(integer)','fortune_vip_v1(uuid)'])assert.equal((await q("SELECT has_function_privilege('authenticated',$1,'execute') AS r",['territory_private.'+fn]))[0].r,false);
 // Exhaustively enumerate all 10,000 draw positions. Each exact amount is distinct.
 const counts=await q("SELECT v->>'prize' AS prize,(v->>'quantity')::int AS quantity,count(*)::int AS weight FROM (SELECT territory_private.fortune_prize_v1(n) AS v FROM generate_series(0,9999) n) t GROUP BY 1,2 ORDER BY 1,2");
 const expected=[['gold',100,3000],['gems',1,1400],['gems',3,800],['gems',5,200],['potion',1,1800],['elixir',1,800],['stone',1,1000],['common',1,700],['rare',1,200],['golden_key',1,50],['vip',1,45],['level',1,5]];
 assert.equal(counts.length,12);assert.equal(counts.reduce((n,r)=>n+r.weight,0),10000);
 for(const [prize,quantity,weight] of expected)assert.deepEqual(counts.find(r=>r.prize===prize&&r.quantity===quantity),{prize,quantity,weight});
 // Exercise actual secure random generator before replacing it as database owner.
 for(let i=0;i<30;i++){const n=(await q('SELECT territory_private.fortune_draw_v1() AS n'))[0].n;assert.ok(n>=0&&n<10000);}
 const starts=[0,3000,4400,5200,5400,7200,8000,9000,9700,9900,9950,9995];
 for(let i=0;i<12;i++){
  await reset();await force(starts[i]);const before=await rpc(),id=key();
  const r=await rpc('spin',id,before.updated_at);const [prize,quantity]=expected[i];
  assert.equal(r.receipt.prize,prize);assert.equal(r.receipt.quantity,quantity);assert.equal(r.tickets,3);
  assert.notEqual(r.updated_at,before.updated_at);assert.equal(r.game_state.player.redGems,0);
  if(prize==='gold')assert.equal(r.wallet_gold,200);
  if(prize==='gems')assert.equal(r.wallet_gems,7+quantity);
  if(['potion','elixir'].includes(prize)){
   const item=r.game_state.inventory[0];assert.equal(item.qty,1);assert.equal(item.effect.value,prize==='potion'?50:10);assert.equal(item.effect.duration,prize==='potion'?'instant':'battle');
  }
  if(prize==='stone')assert.equal(r.game_state.battleStones,11);
  if(['common','rare','golden_key'].includes(prize))assert.equal(r[prize],1);
  if(prize==='vip'){assert.equal(r.vip,1);assert.ok(Date.parse(r.vip_until)-Date.parse(r.server_now)>86390000);}
  if(prize==='level'){assert.equal(r.game_state.player.level,11);assert.equal(r.game_state.player.stats.attack,70);assert.equal(r.game_state.player.stats.defense,25);assert.equal(r.game_state.player.stats.maxHp,300);assert.equal(r.game_state.player.xp,10);assert.equal(r.game_state.player.maxEnergy,30);}
  // Same key and fresh key from another device both recover the unacknowledged
  // receipt. No re-draw, debit or award, even with an obsolete save revision.
  const retry=await rpc('spin',id,before.updated_at);assert.equal(retry.receipt.id,id);assert.equal(retry.tickets,3);assert.deepEqual(retry.game_state,r.game_state);
  const device=await rpc('spin',key(),before.updated_at);assert.equal(device.receipt.id,id);assert.equal(device.tickets,3);
  assert.equal((await rpc()).receipt.id,id,'reload recovers server receipt');
  await assert.rejects(rpc('rare',id,r.updated_at),/fortune_key_reused/);
  await assert.rejects(q("SELECT public.territory_hall_start_v1('treasury')"),/fortune_recover_required/);
  await rpc('ack',id);await rpc('ack',id);
  const replay=await rpc('spin',id,before.updated_at);assert.equal(replay.tickets,3);assert.equal(replay.receipt.id,id);
 }
 await reset();await force(0);let before=await rpc();
 await q('UPDATE territory_private.hall_accounts_v1 SET tickets=0 WHERE player_id=$1',[A]);
 await assert.rejects(rpc('spin',key(),before.updated_at),/hall_no_tickets/);
 assert.equal((await rpc()).wallet_gold,100);
 await reset();before=await rpc();
 await assert.rejects(rpc('spin',key(),'2000-01-01T00:00:00Z'),/fortune_reload_required/);
 assert.equal((await rpc()).tickets,4);
 await q("SELECT public.territory_hall_start_v1('treasury')");
 await assert.rejects(rpc('spin',key(),before.updated_at),/fortune_hall_active/);
 await reset();before=await rpc();await force(0);
 const id=key();const [one,two]=await Promise.all([rpc('spin',id,before.updated_at),rpc('spin',id,before.updated_at)]);
 assert.equal(one.receipt.id,two.receipt.id);assert.equal(two.wallet_gold,200);assert.equal(two.tickets,3);
 await as(B);assert.equal((await rpc()).receipt,null);await rpc('ack',id);
 await as(A);assert.equal((await rpc()).receipt.id,id,'other account cannot ack');
 await as(null);await assert.rejects(rpc(),/hall_login_required/);await as(A);
 // Failure after ticket debit must roll back both debit and payout.
 await reset();await force(0);before=await rpc();
 await db.exec("CREATE FUNCTION public.fail_fortune_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_failure_after_payout'; END $$; CREATE TRIGGER fail_receipt BEFORE INSERT ON territory_private.fortune_receipts_v1 FOR EACH ROW EXECUTE FUNCTION public.fail_fortune_receipt();");
 await assert.rejects(rpc('spin',key(),before.updated_at),/fixture_failure_after_payout/);
 assert.equal((await rpc()).tickets,4);assert.equal((await rpc()).wallet_gold,100);assert.equal((await rpc()).receipt,null);
 await db.exec('DROP TRIGGER fail_receipt ON territory_private.fortune_receipts_v1;');
 // The client does not get a new draw after changing its expected revision.
 await q('UPDATE public.players SET banned=true WHERE id=$1',[A]);await assert.rejects(rpc(),/hall_login_required/);
 await q('UPDATE public.players SET banned=false WHERE id=$1',[A]);
 // Exact-once chest/key consumption, no additional ticket, persistent inventory.
 for(const kind of ['common','rare','golden']){
  await reset();await q('UPDATE territory_private.fortune_inventory_v1 SET common=1,rare=1,golden_key=1 WHERE player_id=$1',[A]);
  before=await rpc();await force(0);const id=key();const opened=await rpc(kind,id,before.updated_at);
  assert.equal(opened.tickets,4);assert.equal(opened[kind==='golden'?'golden_key':kind],0);
  const again=await rpc(kind,id,before.updated_at);assert.deepEqual(again.game_state,opened.game_state);
  await rpc('ack',id);await assert.rejects(rpc(kind,key(),opened.updated_at),/fortune_no_chest/);
 }
 // Every configured chest loot branch is actually paid by SQL.
 for(const kind of ['common','rare','golden']){
  const loot=await q('SELECT * FROM territory_private.fortune_loot_v1 WHERE kind=$1 ORDER BY prize',[kind]);
  assert.equal(loot.reduce((s,r)=>s+r.weight,0),10000);let offset=0;
  for(const row of loot){
   await reset();await q('UPDATE territory_private.fortune_inventory_v1 SET common=1,rare=1,golden_key=1 WHERE player_id=$1',[A]);
   before=await rpc();await force(offset);const opened=await rpc(kind,key(),before.updated_at);
   assert.equal(opened.receipt.prize,row.prize);assert.equal(opened.receipt.quantity,row.quantity);
   if(row.prize==='gold')assert.equal(opened.wallet_gold,100+row.quantity);
   if(row.prize==='gems')assert.equal(opened.wallet_gems,7+row.quantity);
   if(row.prize==='materials')assert.equal(opened.game_state.forgeMaterials,1+row.quantity);
   if(row.prize==='stone')assert.equal(opened.game_state.battleStones,10+row.quantity);
   offset+=row.weight;
  }
 }
 await reset();await force(9950);before=await rpc();let first=await rpc('spin',key(),before.updated_at);await rpc('ack',first.receipt.id);
 let second=await rpc('spin',key(),first.updated_at);assert.equal(Date.parse(second.vip_until)-Date.parse(first.vip_until),86400000);
 await q("UPDATE territory_private.fortune_inventory_v1 SET vip_until=clock_timestamp()-interval '1 second' WHERE player_id=$1",[A]);assert.equal((await rpc()).vip,0);
 await q('UPDATE public.players SET vip_level=5 WHERE id=$1',[A]);assert.equal((await rpc()).vip,5,'permanent VIP is preserved');
 for(const level of [14,82,99,100]){
  await reset(level);await force(9995);before=await rpc();const id=key();const result=await rpc('spin',id,before.updated_at);
  assert.equal(result.game_state.player.level,Math.min(level+1,100));assert.equal(result.refunded,undefined);
  assert.equal(result.receipt.refunded,level===100);assert.equal(result.tickets,level===100?4:3);
  if(level===14)assert.equal(result.game_state.followers[0].unlocked,true);
  if(level===99){assert.equal(result.game_state.player.xp,0);assert.equal(result.game_state.player.xpToNext,0);}
  assert.equal((await rpc('spin',id,before.updated_at)).tickets,result.tickets);
 }
 // Daily +2 and legacy challenge functions still run with the new guard installed.
 await reset();assert.equal((await q('SELECT public.territory_hall_daily_v1() AS r'))[0].r.added,2);
 await assert.rejects(q('SELECT public.territory_hall_daily_v1()'),/hall_daily_already_claimed/);
 for(const game of ['monopoly','treasury','dice','tower','targets']){
  const start=(await q('SELECT public.territory_hall_start_v1($1) AS r',[game]))[0].r;
  const correct=(await q('SELECT correct_answer FROM territory_private.hall_sessions_v1 WHERE player_id=$1',[A]))[0].correct_answer;
  assert.equal((await q('SELECT public.territory_hall_finish_v1($1::uuid,$2::integer) AS r',[start.token,correct]))[0].r.won,true);
 }
 // Test client angle math from the real module, without importing its Supabase API.
 const source=readFileSync('src/game/fortune.ts','utf8');
 const catalogueJS=ts.transpileModule(source.slice(source.indexOf('export const FORTUNE_PRIZES'),source.indexOf('export type FortuneAction')),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const catalogue={};new Function('exports',catalogueJS)(catalogue);
 assert.deepEqual(catalogue.FORTUNE_PRIZES.map(p=>[p.prize,p.quantity,p.weight]),expected,'UI odds and quantities must match SQL exactly');
 const math=source.slice(source.indexOf('export function fortuneRotation'),source.indexOf('export function fortuneLabel'));
 const js=ts.transpileModule(math,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};new Function('exports',js)(exports);
 for(let i=0;i<12;i++)for(const previous of [0,2170,3600,14592]){const end=exports.fortuneRotation(previous,i);assert.equal((end+i*30)%360,0);assert.ok(end-previous>=2160);}
 assert.match(source,/localStorage\.setItem\(storageKey\(userId\),JSON\.stringify\(\{action,key,expected\}\)\)/);
 assert.match(source,/protectFortuneSave/);assert.match(source,/const active=inflight.get/);
 assert.doesNotMatch(source,/Math.random/);
 console.log('Wheel PASS: all 10000 draws, 12 exact payouts, SQL wallet guard/revisions, retry/restart/two-device receipts, duplicate keys, chest loot, keys, timed/permanent VIP, full levels/cap refund, account isolation, daily tickets and legacy Hall. PGlite serializes calls; real multi-connection lock stress remains a deployment check.');
}finally{await db.close();}
