import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { transform } from 'esbuild';
async function load(path) {
 const source = readFileSync(path, 'utf8').replaceAll('import.meta.env.BASE_URL', JSON.stringify('/territory-game-builde/'));
 const {code} = await transform(source, {loader:'ts',format:'esm'});
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
const {getFighterRig,rigAsset} = await load('src/components/combat2d/fighterRigs.ts');
const {motionStops,jointFrames,CONTACT_MS,ACTION_MS} = await load('src/components/combat2d/fighterAnimations.ts');
const root='/territory-game-builde/assets/territory/characters/';
const viking=getFighterRig(root+'heroes/male_viking/idle.webp');
const goblin=getFighterRig(root+'enemies/goblin/idle.webp');
assert.equal(viking.id,'male_viking'); assert.equal(goblin.id,'goblin');
for(const path of ['heroes/female_warrior','heroes/male_rogue','heroes/female_archer','enemies/wolf','bosses/northern_jarl','followers/loyal_shield']) {
 assert.equal(getFighterRig(root+path+'/idle.webp'),undefined,`Unprepared ${path} must keep approved fallback`);
}
assert.equal(getFighterRig(root+'heroes/male_viking/attack.webp'),undefined);
const joints=['root','torso','head','arm-right','forearm-right','weapon','arm-left','forearm-left','shield','leg-right','leg-left','knee-right','knee-left','hair'];
const rest=motionStops('idle')[0].pose;
assert.equal(CONTACT_MS,350); assert(ACTION_MS<870 && ACTION_MS<920,'Actions fit PvE/PvP queues');
const attacks=['slash','thrust','overhead'];
const contactPoses=[];
for(const action of [...attacks,'block','dodge','hit','crit-hit','victory','death']) {
 const stops=motionStops(action);
 assert.equal(stops[0].at,0);assert.equal(stops.at(-1).at,ACTION_MS);
 for(const joint of joints) {
  const frames=jointFrames(joint,stops);
  assert.equal(frames.length,stops.length);
  for(let i=0;i<frames.length;i++) {
   assert(frames[i].offset>=0 && frames[i].offset<=1);
   assert(frames[i].transform && !frames[i].transform.includes('NaN'));
   if(i)assert(frames[i].offset>frames[i-1].offset);
  }
 }
 if(!['victory','death'].includes(action))assert.deepEqual(stops.at(-1).pose,rest,action+' returns every joint to stance');
 if(attacks.includes(action)) {
  const contact=stops.find(stop=>stop.at===CONTACT_MS);assert(contact,'Strike has an explicit contact boundary');
  contactPoses.push(contact.pose);
  for(const joint of ['root','torso','arm-right','forearm-right','weapon','leg-right','leg-left']) assert.notEqual(contact.pose[joint],rest[joint],action+' independent '+joint);
  assert.notDeepEqual(motionStops(action,true)[1].pose,stops[1].pose,'Critical windup must be distinct');
 }
 if(['hit','crit-hit'].includes(action)) assert.deepEqual(stops.find(s=>s.at===CONTACT_MS-1).pose,rest,'No early recoil before contact');
}
for(const joint of ['arm-right','torso','weapon']) assert.equal(new Set(contactPoses.map(p=>p[joint])).size,3,'Three distinct contact poses: '+joint);
let bytes=0;
for(const rig of [viking,goblin])for(const part of ['head','torso','arm-right','arm-left','leg-right','leg-left','weapon','shield']) {
 const path=rigAsset(rig,part);assert(path.startsWith('/territory-game-builde/assets/territory/combat2d/'));
 const file='public/'+path.replace('/territory-game-builde/','');const buffer=readFileSync(file);
 assert.equal(buffer.toString('ascii',0,4),'RIFF');assert.equal(buffer.toString('ascii',8,12),'WEBP');bytes+=statSync(file).size;
}
assert(bytes<600_000,'Two prepared rigs must stay within mobile download budget');
console.log(`Skeletal contract PASS: two explicit rigs, safe fallback, independent joints, contact/recovery, distinct attacks, critical windup, Pages paths; ${Math.round(bytes/1024)} KiB assets.`);
