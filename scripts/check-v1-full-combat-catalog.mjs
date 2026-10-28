import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';

const catalog=JSON.parse(readFileSync('src/game/config/territory-v1-combat-catalog.staged.json','utf8'));
const rules=JSON.parse(readFileSync('src/game/config/territory-v1-combat-rules.staged.json','utf8'));
const visual=JSON.parse(readFileSync('src/game/config/territory-rune-skill-book-v1.json','utf8'));
const {outputFiles}=await build({entryPoints:['src/game/idleEngine/index.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const engine=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const {validateIdleCatalog,validateIdleLoadout,createIdleCombat,advanceIdleCombat,queueIdleSkill}=engine;
const copy=value=>JSON.parse(JSON.stringify(value));
const uuidIds=(arr)=>new Set(arr.map(x=>x.id)).size===arr.length;
const cerrors=validateIdleCatalog(catalog);
assert.deepEqual(cerrors,[],'All 15×3 staged definitions pass engine validation: '+cerrors.join(','));
assert.equal(catalog.skills.length,15);
assert.equal(catalog.runes.length,45);
assert.equal(catalog.passives.length,6);
assert(uuidIds([...catalog.skills,...catalog.runes,...catalog.passives]));
for(const group of visual.groups){
 assert.equal(catalog.skills.filter(s=>s.category===group.id).length,3);
 for(const s of group.skills){
  const def=catalog.skills.find(x=>x.id===s.id);
  assert(def,'Skill missing: '+s.id);
  assert.equal(def.levels.length,3,'All skills have 3 ranks');
  for(const rune of s.runes){
   const r=catalog.runes.find(x=>x.id===rune.id);
   assert(r,'Rune missing: '+rune.id);
   assert.deepEqual(r.compatibleSkillIds,[s.id]);
   assert.equal(r.levels.length,3);
  }
 }
}
assert(visual.passives.every(p=>catalog.passives.some(x=>x.id===p.id)));
for(const effectType of ['bleed','evasion','blind','energy_regen']){
 const entry=[...catalog.skills.flatMap(x=>x.levels.flatMap(l=>l.effects)),...catalog.runes.flatMap(x=>x.levels.flatMap(l=>l.effects)),...catalog.passives.flatMap(x=>x.levels.flatMap(l=>l.effects))].find(x=>x.type===effectType);
 assert(entry,'New real combat effect missing: '+effectType);
}
const empty={skills:[],passives:[]};
const owned={heroLevel:100,
 skills:Object.fromEntries(catalog.skills.map(s=>[s.id,3])),
 runes:Object.fromEntries(catalog.runes.map(r=>[r.id,3])),
 passives:Object.fromEntries(catalog.passives.map(p=>[p.id,3]))};
const fighter=(loadout,actor='hero')=>({
 stats:{hp:actor==='hero'?1300:1150,maxHp:actor==='hero'?1300:1150,attack:82,defense:26,critChance:.12,dodgeChance:.08,blockChance:.1},
 loadout,...(actor==='hero'?{ownership:owned}:{})
});
const battle=(loadout,mode='pve',control='auto',seed=42)=>({
 seed,stage:1,mode,control,hero:fighter(loadout),
 enemy:fighter(empty,'enemy'),catalog,rules
});
const chosen=visual.groups.map(g=>g.skills[0]);
const full={skills:chosen.map(s=>({skillId:s.id,level:3,runes:[{runeId:s.runes[0].id,level:3}]})),
 passives:visual.passives.slice(0,3).map(p=>({passiveId:p.id,level:3}))};
assert.deepEqual(validateIdleLoadout(full,catalog,owned),[]);
const invalidOwned=copy(owned);delete invalidOwned.skills[chosen[0].id];
assert(validateIdleLoadout(full,catalog,invalidOwned).some(s=>s.startsWith('not_owned:')));
const invalidCategory=copy(full);invalidCategory.skills[1].skillId=visual.groups[0].skills[1].id;
assert(validateIdleLoadout(invalidCategory,catalog,owned).some(s=>s.startsWith('duplicate_category:')));
const invalidRune=copy(full);invalidRune.skills[0].runes[0].runeId=visual.groups[1].skills[0].runes[0].id;
assert(validateIdleLoadout(invalidRune,catalog,owned).length);
const simulate=(input,times)=>{
 let state=createIdleCombat(copy(input)),events=[];
 for(const time of times){const next=advanceIdleCombat(state,time);state=next.state;events.push(...next.events);}
 return {state,events};
};
for(const mode of ['pve','boss','pvp']){
 const input=battle(full,mode);
 const merged=simulate(input,[6000]),segmented=simulate(input,[600,1100,1800,2500]);
 assert.deepEqual(segmented,merged,'Same server-computed HP regardless of render frame rate: '+mode);
 assert(merged.events.some(e=>e.type==='impact'&&e.actor==='hero'),'Hero actually strikes in '+mode);
 assert(merged.events.some(e=>e.type==='attack_start'&&e.skillId),'Real skill activation occurs in '+mode);
 assert(merged.state.actors.enemy.stats.hp<1150,'Damage applied to opponent in '+mode);
 assert(merged.state.actors.hero.stats.hp>0,'No absurd immediate one-shot during early balance test in '+mode);
 assert.equal(merged.events.filter(e=>e.type==='loot_visual'&&e.value!==undefined).length,0,'No fake loot');
}
let tested=0;
for(const skill of catalog.skills){
 for(const rune of catalog.runes.filter(r=>r.compatibleSkillIds.includes(skill.id))){
  const loadout={skills:[{skillId:skill.id,level:3,runes:[{runeId:rune.id,level:3}]}],passives:[]};
  const input=battle(loadout);
  assert.deepEqual(validateIdleLoadout(loadout,catalog,owned),[]);
  // Force a proc exclusively in the test fixture. The catalog's real chances remain unchanged.
  input.catalog=copy(catalog);
  input.catalog.runes.find(rn=>rn.id===rune.id).levels[2].chance=1;
  const {events,state}=simulate(input,[8000]);
  assert(events.some(e=>e.type==='rune_proc'&&e.runeId===rune.id),'Actual rune proc missing: '+rune.id);
  assert(events.some(e=>e.type==='status_apply'||e.type==='impact'||e.type==='heal'),'Real mechanical effect missing: '+rune.id);
  assert(state.actors.hero.stats.hp>=0&&state.actors.enemy.stats.hp>=0);
  tested++;
 }
}
assert.equal(tested,45);
const manual=battle(full,'pve','manual');
let initial=createIdleCombat(manual);
const noSkill=advanceIdleCombat(initial,2400);
assert(!noSkill.events.some(e=>e.type==='attack_start'&&e.actor==='hero'&&e.skillId),'Manual player must tap to cast a skill');
initial=queueIdleSkill(initial,full.skills[0].skillId,1000);
const manualRun=advanceIdleCombat(initial,2400);
assert(manualRun.events.some(e=>e.type==='attack_start'&&e.skillId===full.skills[0].skillId),'Manual rune attack runs in combat engine');
const phaseInput=battle(full,'boss');
phaseInput.enemy.phases=[{id:'frostward',hpBelow:.98,attackMultiplier:1.1,defenseMultiplier:1.15,resistances:{slow:.7,burn:.5,bleed:.25}}];
const phases=simulate(phaseInput,[6000]);
assert(phases.events.some(e=>e.type==='phase_change'),'Boss vulnerability/resistance phase is active');
const long=simulate(battle(empty,'pve'),[Number.MAX_SAFE_INTEGER]);
assert(long.state.atMs<=rules.maxDurationMs,'Long suspension cannot simulate more than max battle duration');
console.log('TERRITORY staged combat PASS: 15 skills, 45 rune variants, 6 passives, 3 modes, manual+auto, boss phases, no rewards; server-authoritative engine.');
