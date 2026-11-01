import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = (p) => readFileSync(new URL('../'+p, import.meta.url),'utf8');
const sql=read('supabase/staged/halloween_companion_reward_2026.sql');
const followers=read('src/game/followers.ts');
const cloud=read('src/game/cloud.ts');
const app=read('src/App.tsx');
const panel=read('src/components/FollowersPanel.tsx');
const art=read('src/game/combatArt.ts');
const sprite=read('public/assets/territory/characters/followers/pumpkin_witch_2026/idle.svg');
for (const pattern of [
  /territory_private.halloween_companion_rewards_2026/,
  /ENABLE ROW LEVEL SECURITY/,
  /REVOKE ALL ON TABLE territory_private.halloween_companion_rewards_2026/,
  /FROM PUBLIC, anon, authenticated/,
  /auth.uid\(\)/,
  /total_hits\s*>\s*0/,
  /clock_timestamp\(\)\s*<\s*GREATEST\(v_end, '2026-11-03 00:00:00\+00'::timestamptz\)/,
  /ON CONFLICT \(event_id,player_id,reward_id\) DO NOTHING/,
  /'rewardId','follower_pumpkin_witch_2026'/,
  /'level',100/,
  /GRANT EXECUTE ON FUNCTION public.territory_halloween_companion_claim_v1\(\)\s+TO authenticated/,
]) assert.match(sql,pattern);
assert.doesNotMatch(sql,/\b(?:UPDATE|DELETE|TRUNCATE|DROP)\s+public\.players\b/i);
assert.match(cloud,/halloweenCompanionVerified: false/,'never trust saved entitlement');
assert.match(app,/claimPumpkinWitchEntitlement\(\)/);
assert.match(app,/addEventListener\('online', refreshCompanion\)/);
assert.match(followers,/old\.id !== HALLOWEEN_COMPANION_ID/);
assert.match(followers,/halloweenVerified \? \[\{ \.\.\.PUMPKIN_WITCH_TEMPLATE \}\] : \[\]/);
assert.match(panel,/DISPLAY_FOLLOWER_TEMPLATES.map/);
assert.match(art,/id === 'follower_6'/,'original Battle Cow artwork preserved');
assert.match(art,/follower_pumpkin_witch_2026/);
assert.match(sprite,/<svg/);
assert.match(sprite,/Тыквенная ведьма/);

function load(companionRpc){
 const src=read('src/game/halloweenCompanion2026.ts');
 const out=ts.transpileModule(src,{fileName:'src/game/halloweenCompanion2026.ts',
  compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 const mod={exports:{}};
 vm.runInNewContext(out,{module:mod,exports:mod.exports,Date,Math,Error,
  require(name){
    if(name==='./supabase') return {supabase:{rpc:companionRpc}};
    if(name==='./followers') return {
      HALLOWEEN_COMPANION_ID:'follower_pumpkin_witch_2026',
      HALLOWEEN_COMPANION_LEVEL:100,
      HALLOWEEN_COMPANION_ADVANTAGE:1.05,
      PUMPKIN_WITCH_BASELINE:{attack:62,heal:15},
      PUMPKIN_WITCH_COMBAT:{attack:65,defense:0,heal:16,crit:0,pierce:0},
      PUMPKIN_WITCH_TEMPLATE:{id:'follower_pumpkin_witch_2026',name:'Тыквенная ведьма',level:100,attack:65,defense:1,unlocked:true,role:'pumpkin'},
    };
    throw new Error('Unexpected dependency: '+name);
  }});
 return mod.exports;
}
const valid={eligible:true,rewardId:'follower_pumpkin_witch_2026',level:100,claimedAt:'2026-11-03T00:00:01Z'};
const m=load(async()=>({data:valid,error:null}));
assert.equal(await m.claimPumpkinWitchEntitlement(),true);
const denied=load(async()=>({data:{eligible:false,reason:'event_active'},error:null}));
assert.equal(await denied.claimPumpkinWitchEntitlement(),false);
const fake=load(async()=>({data:{...valid,level:99},error:null}));
await assert.rejects(fake.claimPumpkinWitchEntitlement(),/bad_receipt/);
assert.equal(m.PUMPKIN_WITCH_COMBAT.attack,65);
assert.equal(m.PUMPKIN_WITCH_COMBAT.heal,16);
assert.equal(m.PUMPKIN_WITCH_COMBAT.defense,0);
const saved={ player:{level:53,gold:900,redGems:3}, inventory:[{id:'keep',qty:7}],
 followers:[{id:'follower_6',level:4,unlocked:true,attack:7,defense:2}],
 activeFollowerId:'follower_6' };
const gifted=m.installVerifiedPumpkinWitch(saved);
assert.equal(gifted.followers.length,2);
assert.equal(gifted.followers.find(f=>f.id==='follower_pumpkin_witch_2026').level,100);
assert.deepEqual(gifted.followers[0],saved.followers[0]);
assert.equal(gifted.activeFollowerId,'follower_6');
assert.equal(gifted.player,saved.player);
assert.equal(gifted.inventory,saved.inventory);
assert.equal(m.installVerifiedPumpkinWitch(gifted).followers.length,2,'idempotent client installation');
console.log('Halloween companion contract checks passed: server gate, entitlement, 100/100, +5% PvE and preserved Battle Cow.');
