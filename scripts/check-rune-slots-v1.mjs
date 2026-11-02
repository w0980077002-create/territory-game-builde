import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';

const compiled=await build({entryPoints:['src/game/builds/runeSlotsV1.ts'],
  bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const runeCatalog=JSON.parse(readFileSync('src/game/config/territory-independent-rune-slots-v1.json','utf8'));
const oldSkillBook=JSON.parse(readFileSync('src/game/config/territory-rune-skill-book-v1.json','utf8'));
const defs=api.runeSlotCatalog(runeCatalog);
assert.equal(defs.length,15);
assert.equal(defs.flatMap(d=>d.options).length,45);
assert.equal(new Set(defs.map(d=>d.slotId)).size,15);
assert(defs.every((d,i)=>d.slotId===`rune_slot_${String(i+1).padStart(2,'0')}` && d.slotId!==d.legacySkillId));
// Reject the old 15 SKILLS × 3 runes visual catalog as a slot contract.
assert.throws(()=>api.runeSlotCatalog(oldSkillBook),/rune_catalog_invalid/);
// The legacy mapping is explicit, bijective and used ONLY in migration.
const historic=oldSkillBook.groups.flatMap(g=>g.skills);
assert.equal(new Set(defs.map(d=>d.legacySkillId)).size,15);
assert.deepEqual(new Set(defs.map(d=>d.legacySkillId)),new Set(historic.map(s=>s.id)));
for(const def of defs) {
  const source=historic.find(s=>s.id===def.legacySkillId);
  assert.deepEqual(def.options,source.runes.map(r=>r.id));
}
const ownership=Object.fromEntries(defs.flatMap(d=>d.options.map(id=>[id,3])));
const empty=api.emptyRuneSlots(defs);
assert.equal(empty.slots.length,15);
assert(empty.slots.every(s=>s.runeId===null));
// All 15 runes are selected simultaneously independent of the 5 equipped skills.
const full={...empty,revision:9,slots:defs.map((d,i)=>({slotId:d.slotId,runeId:d.options[i%3]}))};
const checked=api.validateRuneSlots(full,defs,ownership,9);
assert.deepEqual(checked.slots,full.slots);
const snapshot=api.runeBattleSnapshot(checked,defs,ownership);
assert.equal(snapshot.slots.filter(x=>x.level===3).length,15);
const reject=(state,owned,reason)=>assert.throws(
  ()=>api.validateRuneSlots(state,defs,owned,state.revision),new RegExp(reason));
reject({...full,slots:full.slots.slice(0,5)},ownership,'rune_count_invalid');
reject({...full,slots:full.slots.map((s,i)=>i===1?{...s,slotId:full.slots[0].slotId}:s)},ownership,'rune_duplicate_slot');
reject({...full,slots:full.slots.map((s,i)=>i===1?{...s,runeId:full.slots[0].runeId}:s)},ownership,'rune_wrong_slot');
reject(full,{...ownership,[full.slots[0].runeId]:0},'rune_not_owned');
reject(full,{},'rune_not_owned');
assert.throws(()=>api.validateRuneSlots(full,defs,ownership,8),/rune_revision_conflict/);
const legacy=defs.slice(0,5).map(d=>({skillId:d.legacySkillId,runes:[{runeId:d.options[0],level:3}]}));
const converted=api.migrateLegacyRunes(legacy,defs,ownership);
assert.equal(converted.slots.length,15);
assert.equal(converted.slots.filter(s=>s.runeId!==null).length,5);
assert.equal(converted.slots[0].slotId,'rune_slot_01');
assert.deepEqual(api.migrateLegacyRunes([],defs,ownership).slots,empty.slots);
assert.throws(()=>api.migrateLegacyRunes([{skillId:defs[0].legacySkillId,runes:[
  {runeId:defs[0].options[0],level:3},{runeId:defs[0].options[1],level:3}]}],defs,ownership),
  /rune_legacy_ambiguous/,'Never silently discard the second old rune');
assert.throws(()=>api.migrateLegacyRunes([{skillId:defs[0].legacySkillId,runes:[
  {runeId:defs[0].options[0],level:1}]}],defs,ownership),
  /rune_legacy_rank_conflict/,'Never silently raise selected old rank');
assert.throws(()=>api.migrateLegacyRunes([{skillId:defs[0].legacySkillId,runes:[
  {runeId:defs[0].options[0],level:3}]}],defs,{}),
  /rune_legacy_rank_conflict/,'Never fabricate missing ownership');
const malformed=structuredClone(runeCatalog);
malformed.slots[1].slotId=malformed.slots[0].slotId;
assert.throws(()=>api.runeSlotCatalog(malformed),/rune_slots_invalid/);
const badLegacy=structuredClone(runeCatalog);
badLegacy.slots[1].legacySkillId=badLegacy.slots[0].legacySkillId;
assert.throws(()=>api.runeSlotCatalog(badLegacy),/rune_slots_invalid/);
const badOptions=structuredClone(runeCatalog);
badOptions.slots[1].options[0].runeId=badOptions.slots[0].options[0].runeId;
assert.throws(()=>api.runeSlotCatalog(badOptions),/rune_duplicate_id/);
// The actual 15-slot status RPC is the only source of ownership for the
// editable book. Reject malformed ownership, duplicate entries and stale
// selections rather than replacing a legacy save with an empty build.
const serverStatus={schema:api.RUNE_SCHEMA,revision:9,slots:full.slots,
  owned:Object.entries(ownership).map(([runeId,level])=>({runeId,level}))};
const parsed=api.parseRuneServerStatus(serverStatus,defs);
assert.equal(parsed.slots.length,15);
assert.equal(parsed.owned[defs[0].options[0]],3);
assert.deepEqual(parsed.slots,full.slots);
assert.throws(()=>api.parseRuneServerStatus({...serverStatus,owned:[]},defs),/rune_not_owned/);
assert.throws(()=>api.parseRuneServerStatus({...serverStatus,owned:[
  ...serverStatus.owned,serverStatus.owned[0]]},defs),/rune_status_ownership_invalid/);
assert.throws(()=>api.parseRuneServerStatus({...serverStatus,owned:[
  {runeId:'not_a_rune',level:3},...serverStatus.owned]},defs),/rune_status_ownership_invalid/);
assert.throws(()=>api.parseRuneServerStatus({...serverStatus,owned:[
  {...serverStatus.owned[0],level:4},...serverStatus.owned.slice(1)]},defs),/rune_status_ownership_invalid/);
assert.throws(()=>api.parseRuneServerStatus({...serverStatus,slots:full.slots.slice(0,5)},defs),/rune_count_invalid/);
assert.throws(()=>api.parseRuneServerStatus({...serverStatus,schema:'legacy-skills'},defs),/rune_status_invalid/);
const runeUi=readFileSync('src/components/builds/ServerRuneBook.tsx','utf8');
assert(runeUi.includes("territory_runes_status_v1") && runeUi.includes("territory_runes_save_v1"));
assert(runeUi.includes("p_operation: command.operationId") && runeUi.includes("p_revision: command.revision"));
assert(runeUi.includes("parseRuneServerStatus(data, definitions)"));
assert(!runeUi.includes("territory_combat_loadout_status_v1"),'No five-skill RPC in the 15-slot book');
assert(!runeUi.includes("RuneSkillBookSelection"),'No skill-bound rune mapping');
assert(runeUi.includes('const FIFTEEN_SLOT_CONTRACT_READY = false;'),'Unreleased PvE/PvP effects must remain gated');

console.log('Independent rune slots: 15 stable IDs, 45 options, trusted ownership, explicit legacy mapping, rank and revision checks PASS');
