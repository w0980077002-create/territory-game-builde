/** Offline actual PostgreSQL contract; never uses production or player data. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import vm from 'node:vm';
import ts from 'typescript';
const db=new PGlite();
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async(id)=>q("SELECT set_config('request.jwt.claim.sub',$1,false)",[id||'']);
let seq=0;const key=()=>`30000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`;
const expectedVersions=new Map();
const rpc=async(action='status',id=null,lines=null,bet=null,choice=null)=>{
 let expected=null;
 if(action!=='status'){
  if(!expectedVersions.has(id)) {const rows=await q('SELECT state FROM territory_private.slots_rounds_v1 WHERE player_id=auth.uid()');expectedVersions.set(id,rows[0]?.state.revision??0);}
  expected=expectedVersions.get(id);
 }
 return (await q('SELECT public.territory_slots_v1($1,$2,$3,$4,$5,$6) AS r',[action,id,lines,bet,choice,expected]))[0].r;
};
const force=async(n)=>db.exec(`CREATE OR REPLACE FUNCTION territory_private.slots_random_v1(p_max integer) RETURNS integer LANGUAGE sql AS 'SELECT ${n} % p_max';`);
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(readFileSync('src/game/vikingSlots.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports});
const {SLOT_LINES,SLOT_PAYTABLE,SLOT_REEL_STRIPS,scoreSlotGrid,gridFromReelStops}=module.exports;
const config=JSON.parse(readFileSync('supabase/staged/territory_slots_config_v1.json','utf8'));
assert.equal(JSON.stringify(config),JSON.stringify({lines:SLOT_LINES,paytable:SLOT_PAYTABLE,strips:SLOT_REEL_STRIPS}),'published rules parity');
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA territory_private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE players(id uuid PRIMARY KEY,banned boolean DEFAULT false,updated_at timestamptz DEFAULT clock_timestamp(),game_state jsonb,gold integer DEFAULT 100,gems integer DEFAULT 0);`);
 await q('INSERT INTO players(id,game_state) VALUES($1,\'{"player":{"gold":100,"gems":0}}\'),($2,\'{"player":{"gold":100,"gems":0}}\')',[A,B]);
 await db.exec(readFileSync('supabase/migrations/20261017_game_hall_five_v1.sql','utf8'));
 await db.exec(readFileSync('supabase/staged/territory_slots_v1.sql','utf8'));
 await as(A);
 assert.equal((await rpc()).enabled,false);
 assert.equal((await q('SELECT count(*)::integer AS n FROM territory_private.hall_accounts_v1 WHERE player_id=$1',[A]))[0].n,0,
  'disabled status may not create a Hall account');
 await assert.rejects(rpc('spin',key(),9,5),/slots_not_enabled/);
 await q('UPDATE territory_private.slots_release_v1 SET enabled=true');
 const freshStatus=await rpc();
 assert.equal(freshStatus.coins,100);
 assert.equal(freshStatus.state.phase,'ready');
 assert.equal((await q('SELECT count(*)::integer AS n FROM territory_private.hall_accounts_v1 WHERE player_id=$1',[A]))[0].n,0,
  'enabled status must not create wallet rows or acquire bet locks');
 assert.equal((await q('SELECT count(*)::integer AS n FROM territory_private.slots_rounds_v1 WHERE player_id=$1',[A]))[0].n,0,
  'enabled status must not create empty rounds');
 const serverConfig=(await q('SELECT territory_private.slots_config_v1() AS r'))[0].r;
 assert.equal(JSON.stringify(serverConfig.strips),JSON.stringify(SLOT_REEL_STRIPS));
 for(let n=0;n<45;n++) {
  const stops=[n%40,(n*3)%40,(n*7)%40,(n*11)%40,(n*17)%40];
  const grid=gridFromReelStops(stops);
  for(const lines of [1,3,5,7,9]) {
   const expected=scoreSlotGrid(grid,lines,10);
   const actual=(await q('SELECT territory_private.slots_score_v1($1, $2,10) AS r',[JSON.stringify(grid),lines]))[0].r;
   assert.equal(actual.payout,expected.payout,'exact JS/SQL scoring parity');
   assert.equal(actual.bonusSymbols,expected.bonusSymbols);
   assert.equal(actual.lines.length,expected.lines.length);
  }
 }
 for(let i=0;i<20;i++) {const n=(await q('SELECT territory_private.slots_random_v1(40) AS r'))[0].r;assert.ok(n>=0&&n<40);}
 let status=await rpc();assert.equal(status.coins,100);
 await assert.rejects(rpc('spin',key(),9,1),/slots_invalid_arguments/);
 await assert.rejects(rpc('spin',key(),2,1),/slots_invalid_arguments/);
 await q('UPDATE players SET gold=4,game_state=jsonb_set(game_state,\'{player,gold}\',\'4\') WHERE id=$1',[A]);
 await assert.rejects(rpc('spin',key(),9,5),/slots_no_gold/);
 await q('UPDATE players SET gold=100,game_state=jsonb_set(game_state,\'{player,gold}\',\'100\') WHERE id=$1',[A]);
 await force(0);
 const spinKey=key(); const spin=await rpc('spin',spinKey,1,5);
 assert.equal(spin.coins,95);assert.deepEqual(await rpc('spin',spinKey,1,5),spin);
 assert.equal((await q('SELECT gold FROM players WHERE id=$1',[A]))[0].gold,95,'same UUID cannot charge twice');
 assert.equal((await q('SELECT count(*)::integer AS n FROM territory_private.hall_accounts_v1 WHERE player_id=$1',[A]))[0].n,0,'slots do not consume hall tickets');
 await assert.rejects(rpc('spin',spinKey,3,5),/slots_operation_reused/);
 assert.equal(JSON.stringify(spin).includes('bonus_deck'),false,'no sealed deck exposure');
 assert.equal((await rpc()).state.phase,spin.state.phase,'round restores');
 await assert.rejects(q('SELECT public.territory_slots_v1($1,$2,$3,$4,$5,$6)',['spin',key(),1,5,null,0]),/slots_stale_round/,'second device cannot act on an old round revision');
 await as(B);assert.equal((await rpc()).coins,100,'account isolated');
 await as(A);
 // Owner fixtures force branches only in this ephemeral database, never client-controlled.
 const state={phase:'bonus',revision:0,pending:10,stake:1,lines:1,bet:1,riskSteps:0,opened:[],picksLeft:5,shields:1,revealed:{}};
 await q(`UPDATE territory_private.slots_rounds_v1 SET state=$2,bonus_deck='[{"kind":"shield","payout":0},{"kind":"trap","payout":0},{"kind":"treasure","payout":1},{"kind":"treasure","payout":2},{"kind":"treasure","payout":3}]',super_deck='[3,5,9]' WHERE player_id=$1`,[A,state]);
 const bonusKey=key(), bonus=await rpc('bonus',bonusKey,null,null,0);
 assert.deepEqual(await rpc('bonus',bonusKey,null,null,0),bonus);
 assert.equal(bonus.state.shields,2);
 await assert.rejects(rpc('bonus',key(),null,null,0),/slots_already_opened/);
 for(let i=1;i<5;i++)await rpc('bonus',key(),null,null,i);
 assert.equal((await rpc()).state.phase,'superbonus');
 const superKey=key(),superPrize=await rpc('super',superKey,null,null,2);
 assert.equal(superPrize.state.pending,25);
 assert.deepEqual(await rpc('super',superKey,null,null,2),superPrize);
 await rpc('risk_start',key());
 await q(`UPDATE territory_private.slots_rounds_v1 SET risk_deck='[true,false,true,false]' WHERE player_id=$1`,[A]);
 const riskKey=key(),risk=await rpc('risk',riskKey,null,null,0);
 assert.equal(risk.state.pending,50);assert.deepEqual(await rpc('risk',riskKey,null,null,0),risk);
 const collectKey=key(),collected=await rpc('collect',collectKey);
 assert.equal(collected.collected,50);assert.equal(collected.state.pending,0);assert.equal(collected.coins,145);
 assert.deepEqual(await rpc('collect',collectKey),collected,'no duplicate payout');
 assert.equal((await q('SELECT gold FROM players WHERE id=$1',[A]))[0].gold,145);
 await assert.rejects(rpc('collect',key()),/slots_wrong_phase/);
 // Payout is independent of the Hall daily gold cap and uses only hero gold.
 await q(`UPDATE territory_private.slots_rounds_v1 SET state=state||'{"phase":"decision","pending":250000}' WHERE player_id=$1`,[A]);
 let partial=await rpc('collect',key());assert.equal(partial.collected,250000);assert.equal(partial.state.pending,0);
 assert.equal((await q('SELECT gold=(game_state->\'player\'->>\'gold\')::integer AS equal FROM players WHERE id=$1',[A]))[0].equal,true,'saved game gold equals server wallet');
 await q('UPDATE players SET gold=2147483600,game_state=jsonb_set(game_state,\'{player,gold}\',to_jsonb(2147483600)) WHERE id=$1',[A]);
 await q(`UPDATE territory_private.slots_rounds_v1 SET state=state||'{"phase":"decision","pending":250000}' WHERE player_id=$1`,[A]);
 partial=await rpc('collect',key());assert.equal(partial.collected,47);assert.equal(partial.state.pending,249953);
 await assert.rejects(rpc('collect',key()),/slots_wallet_full/);
 await q(`UPDATE territory_private.slots_rounds_v1 SET state=state||'{"phase":"bonus","pending":0,"opened":[],"picksLeft":5,"shields":0}' WHERE player_id=$1`,[A]);
 const trapped=await rpc('bonus',key(),null,null,1);assert.equal(trapped.state.phase,'ready');
 // Risk loss and five-round limit are persistent and enforced by SQL.
 await q(`UPDATE territory_private.slots_rounds_v1 SET state=state||'{"phase":"decision","pending":10,"riskSteps":5}' WHERE player_id=$1`,[A]);
 await assert.rejects(rpc('risk_start',key()),/slots_wrong_phase/);
 await q(`UPDATE territory_private.slots_rounds_v1 SET state=state||'{"phase":"risk","pending":10,"riskSteps":0}',risk_deck='[false,true,false,true]' WHERE player_id=$1`,[A]);
 const lost=await rpc('risk',key(),null,null,0);assert.equal(lost.state.pending,0);assert.equal(lost.state.phase,'ready');
 for(const table of ['slots_release_v1','slots_rounds_v1','slots_receipts_v1']) assert.equal((await q("SELECT has_table_privilege('authenticated',$1,'UPDATE') AS r",['territory_private.'+table]))[0].r,false);
 await as(null);await assert.rejects(rpc(),/slots_login_required/);
 assert.equal((await q("SELECT has_function_privilege('anon','public.territory_slots_v1(text,uuid,integer,integer,integer,integer)','execute') AS r"))[0].r,false);
 console.log('Slots server PASS: gold stakes and payouts, no Hall ticket use, exact published math parity, private RNG/decks, all bonus/risk branches, receipt replay, capped int4 wallet, ACL and account isolation. Disabled staging only; live activation remains a separate step.');
} finally {await db.close();}
