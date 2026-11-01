import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const compiled=await build({entryPoints:['src/game/builds/runeSlotsV1.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const catalog=JSON.parse(readFileSync('src/game/config/territory-rune-skill-book-v1.json','utf8'));
const defs=api.runeSlotCatalog(catalog);
assert.equal(defs.length,15);
assert.equal(defs.flatMap(d=>d.options).length,45);
const owned=Object.fromEntries(defs.flatMap(d=>d.options.map(id=>[id,3])));
const empty=api.emptyRuneSlots(defs);
assert.equal(empty.slots.length,15);
assert(empty.slots.every(s=>s.runeId===null));
const full={...empty,revision:9,slots:defs.map((d,i)=>({slotId:d.slotId,runeId:d.options[i%3]}))};
const checked=api.validateRuneSlots(full,defs,owned,9);
assert.deepEqual(checked.slots,full.slots);
const snapshot=api.runeBattleSnapshot(checked,defs,owned);
assert.equal(snapshot.slots.filter(x=>x.level===3).length,15);
const rejects=(raw,ownership,reason)=>assert.throws(()=>api.validateRuneSlots(raw,defs,ownership,raw.revision),new RegExp(reason));
rejects({...full,slots:full.slots.slice(0,5)},owned,'rune_count_invalid');
rejects({...full,slots:full.slots.map((s,i)=>i===1?{...s,slotId:full.slots[0].slotId}:s)},owned,'rune_duplicate_slot');
rejects({...full,slots:full.slots.map((s,i)=>i===1?{...s,runeId:full.slots[0].runeId}:s)},owned,'rune_wrong_slot');
rejects(full,{...owned,[full.slots[0].runeId]:0},'rune_not_owned');
assert.throws(()=>api.validateRuneSlots(full,defs,owned,8),/rune_revision_conflict/);
assert.throws(()=>api.migrateLegacyRunes([{skillId:defs[0].slotId,runes:[
  {runeId:defs[0].options[0],level:1},{runeId:defs[0].options[1],level:1}]}],defs,owned),
  /rune_legacy_ambiguous/);
const legacy=defs.slice(0,5).map(d=>({skillId:d.slotId,runes:[{runeId:d.options[0],level:3}]}));
const migrated=api.migrateLegacyRunes(legacy,defs,owned);
assert.equal(migrated.slots.length,15);
assert.equal(migrated.slots.filter(s=>s.runeId!==null).length,5);
assert.deepEqual(api.migrateLegacyRunes([],defs,owned).slots,empty.slots);
assert.throws(()=>api.migrateLegacyRunes([{skillId:defs[0].slotId,runes:[{runeId:defs[0].options[0],level:1}]}],defs,owned),/rune_legacy_rank_conflict/,'Never silently upgrade a legacy selected rank');
assert.throws(()=>api.migrateLegacyRunes([{skillId:defs[0].slotId,runes:[{runeId:defs[0].options[0],level:3}]}],defs,{}),/rune_legacy_rank_conflict/,'Never migrate unverified ownership');
console.log('15-slot rune contract: 15 choices, 45 options, trusted ownership, revision and legacy losslessness PASS');
