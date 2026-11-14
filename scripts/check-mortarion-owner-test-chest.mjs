import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=source('supabase/migrations/20261114115000_mortarion_owner_only_full_test_chest.sql');
const mail=source('src/components/home/HomeSheets.tsx');
const preview=source('src/components/MortarionOwnerTestChestPreview.tsx');
const profile=source('src/components/HeroShowcase.tsx');
const art=source('src/game/art.ts');
const inventory=source('src/components/InventoryScreen.tsx');
const warehouse=source('src/components/CompactWarehouse.tsx');
const claim=source('src/game/live.ts');

assert.match(sql,/v_grant\.id='f4db6d91-863f-4592-a210-8164bc7b1fea'::uuid/);
assert.match(sql,/v_uid='1eb617c1-a7b9-4308-aa85-a8234f7818a1'::uuid/);
assert.match(sql,/v_player\.telegram_id=770693083/);
assert.match(sql,/v_grant\.kind='mail'/);
assert.match(sql,/v_grant\.payload='\{\}'::jsonb/);
assert.match(sql,/v_grant\.subject='ТЕСТ МОРТАРИОН · ПОЛНЫЙ СУНДУК'/);
assert.doesNotMatch(sql,/\bUPDATE public\.players\b|\bINSERT INTO public\.players\b|territory_mortarion_2026_players|mortarion_reward_receipts_v1/);
assert.match(sql,/REVOKE ALL ON FUNCTION territory_private\.mortarion_owner_test_chest_apply_v1\(jsonb\)/);
assert.match(claim,/territory_admin_claim_grant_v2/);
assert.match(mail,/m\.id === MORTARION_OWNER_TEST_MAIL_ID/,'only the uniquely identified owner test mail shows the QA chest');
assert.match(preview,/data-testid="mortarion-owner-test-mail-preview"/);
assert.match(preview,/15/);
for (const tier of ['top1','top2','top4']) assert.match(profile,new RegExp('mortarion-owner-preview-'));
assert.match(profile,/mortarionOwnerTestChest\?\.testOnly === true/);
assert.match(profile,/const displayedHonor = previewHonor \?\? state\.mortarionHonor/,'preview must never overwrite true rank');
assert.match(art,/item\.id\.startsWith\('mortarion_owner_test_'\)/,'test items render actual rare art');
assert.match(inventory,/mortarion-inventory-test-only/);
assert.match(warehouse,/item\.ownerTest/);

const db=new PGlite();
await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA territory_private;');
const begin=sql.indexOf('CREATE OR REPLACE FUNCTION territory_private.mortarion_owner_test_chest_apply_v1(');
const end=sql.indexOf('DO $patch$');
assert(begin>=0&&end>begin);
await db.exec(sql.slice(begin,end));
const sample={
  player:{name:'Owner QA',gold:998,gems:321,redGems:8,level:59,equipped:{}},
  inventory:[{id:'existing',name:'Existing sword',type:'material',rarity:'rare',qty:5}],
  forgeMaterials:42,
  mortarionHonor:{eventId:'mortarion_2026',place:1,title:'REAL HONOR',frame:'real_frame',medal:'REAL MEDAL'},
  mortarionReward:{eventId:'mortarion_2026',gold:999}
};
const one=async x=>(await db.query('SELECT territory_private.mortarion_owner_test_chest_apply_v1($1::jsonb) AS state',[JSON.stringify(x)])).rows[0].state;
const granted=await one(sample);
assert.deepEqual(granted.player,sample.player,'wallet, hero and stats must stay unchanged');
assert.deepEqual(granted.mortarionHonor,sample.mortarionHonor,'official title/frame/medal never changed');
assert.deepEqual(granted.mortarionReward,sample.mortarionReward,'real chest receipt never changed');
assert.equal(granted.forgeMaterials,42);
assert.equal(granted.inventory.length,16,'15 new QA samples plus the pre-existing item');
assert.deepEqual(granted.inventory[0],sample.inventory[0],'old inventory preserved');
const kit=granted.inventory.filter(i=>i.ownerTest===true);
assert.equal(kit.length,15);
assert.equal(new Set(kit.map(i=>i.id)).size,15);
assert(kit.every(i=>i.testOnly===true && i.qty===1 && !('expiresAt' in i)));
assert(kit.every(i=>i.canonicalItemId && i.id==='mortarion_owner_test_'+i.canonicalItemId));
assert.equal(kit.filter(i=>i.canonicalItemId.startsWith('trial_fragment_')).length,12);
for(const type of ['guardian_blade','guardian_amulet']){
 const group=kit.filter(i=>i.canonicalItemId.startsWith('trial_fragment_'+type+'_'));
 assert.deepEqual(group.map(i=>i.canonicalItemId),Array.from({length:6},(_,i)=>'trial_fragment_'+type+'_'+(i+1)));
 assert.deepEqual(group.map(i=>i.rarity),['rare','rare','rare','rare','epic','legendary']);
}
for(const original of ['mortarion_soul_essence','mortarion_heart','cow_awakening_stone']){
 assert.equal(kit.filter(i=>i.canonicalItemId===original).length,1);
}
assert.equal(granted.mortarionOwnerTestChest.mailId,'f4db6d91-863f-4592-a210-8164bc7b1fea');
assert.equal(granted.mortarionOwnerTestChest.uniqueItems,15);
assert.deepEqual(await one(granted),granted,'idempotent helper must not mint a second kit');
await assert.rejects(one({inventory:{}}),/mortarion_owner_test_invalid_save/);
await db.close();
console.log('MORTARION OWNER TEST CHEST PASS: all 15 canonical QA items, no expiry, owner guard, real honors/receipt/resources untouched, duplicate rejection, mail+inventory+hero visual wiring');
