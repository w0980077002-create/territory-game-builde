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

// Prepared rigs must mount even when SVG Web Animations are unavailable;
// otherwise SkeletalFighter's legacy contact-pose fallback is unreachable.
const figureSource=readFileSync('src/components/arena/FighterFigure.tsx','utf8');
assert.doesNotMatch(figureSource,/canAnimateRig\s*&&\s*enabledRig/, 'Do not gate prepared rigs on SVG animate()');
assert.match(figureSource,/skeletalReady\s*=\s*!!rig\s*&&\s*enabledRig\s*===\s*rig\.id/, 'Prepared rig must remain mounted for legacy fallback');

// Legacy Telegram SVG engines must not leave stale inline poses after a
// reduced-motion preference change or an event cleanup.
const skeletalSource=readFileSync('src/components/combat2d/SkeletalFighter.tsx','utf8');
assert.match(skeletalSource, /const safeSpeed = Number\.isFinite\(speed\) && speed > 0 \? speed : 1;/, 'Invalid combat speed must fall back to a finite positive duration');
assert.doesNotMatch(skeletalSource, /ACTION_MS \/ speed/, 'Both strike timers and SVG animations must use validated speed');
assert.match(skeletalSource, /ACTION_MS \/ safeSpeed/, 'Validated speed must drive combat timing');
const applyBody=skeletalSource.split('const apply = () => {')[1]?.split('const stops =')[0] ?? '';
assert.match(applyBody,/style\.transform = ''/, 'Reapply must clear stale legacy inline transforms');
assert.match(applyBody,/animations\.forEach\(a => \{ try \{ a\.cancel\(\); \} catch \{[^}]*\} \}\);\s*animations = \[\];/, 'Reapply must safely discard cancelled SVG animations before rebuilding the list');
assert.equal((skeletalSource.match(/try \{ a\.cancel\(\); \} catch \{/g) ?? []).length, 2, 'Both reapply and cleanup must tolerate throwing SVG cancellation');
assert.match(skeletalSource,/typeof joint\.animate !== 'function'/, 'Legacy SVG animation fallback must remain');
assert.match(skeletalSource,/try \{\s*if \(typeof joint\.animate !== 'function'\)/, 'Throwing SVG animate getters must be caught per joint');
assert.match(skeletalSource,/try \{\s*if \(typeof window\.matchMedia === 'function'\) reduced = window\.matchMedia\(/, 'Throwing matchMedia must not prevent contact poses');
assert.match(skeletalSource,/catch \{ reduced = null; \}/, 'Legacy matchMedia failures must fall back safely');
assert.match(skeletalSource,/try \{[\s\S]*?reduced\.addEventListener\('change', apply\);[\s\S]*?catch \{ listenerKind = null; \}/, 'Broken media query subscriptions must not interrupt contact poses');
assert.match(skeletalSource,/if \(listenerKind === null && typeof reduced\?\.addListener === 'function'\)/, 'Broken modern subscription must retry supported legacy listener');
assert.match(skeletalSource,/reduced\.addListener\(apply\);\s*listenerKind = 'legacy';/, 'Legacy fallback must track the installed listener for cleanup');
assert.match(skeletalSource,/catch \{\s*\/\/ Legacy WebViews may also throw when reading addListener itself\.[\s\S]*?try \{\s*if \(listenerKind === null && typeof reduced\?\.addListener === 'function'\)/, 'Broken legacy listener getter must be guarded inside the recovery catch');
assert.match(skeletalSource,/if \(listenerKind === 'modern'\)[\s\S]*?else if \(listenerKind === 'legacy'\)[\s\S]*?catch \{/, 'Legacy listener teardown must not interrupt rig cleanup');
assert.match(skeletalSource,/try \{\s*if \(typeof joint\.animate !== 'function'\)[\s\S]*?const animation = joint\.animate\(selected,/, 'SVG animate feature detection and invocation must share a guarded boundary');
assert.match(skeletalSource,/if \(!animation \|\| typeof animation\.cancel !== 'function'\) \{\s*showLegacyPose\(\);\s*return \[\];/, 'Incomplete Web Animations polyfills must retain the visible contact pose');
assert.match(skeletalSource,/catch \{[\s\S]*?showLegacyPose\(\)/, 'Thrown SVG animate must fall back to a visible pose');
assert.equal((skeletalSource.match(/showLegacyPose\(\);/g) ?? []).length, 3, 'Missing, throwing and incomplete Web Animations paths must share the contact pose');
assert.match(skeletalSource,/try \{ prefersReducedMotion = reduced\?\.matches === true; \} catch \{/, 'Throwing legacy MediaQueryList.matches getter must not abort rig animation');
assert.match(skeletalSource,/prefersReducedMotion \|\| motion === 'death' \|\| motion === 'victory'/, 'Legacy SVG fallback must respect reduced motion');
assert.doesNotMatch(skeletalSource,/duration: reduced\?\.matches/, 'Animation duration must use guarded reduced-motion snapshot');
assert.match(skeletalSource,/frames\.find\(\(frame, index\) => index > 0 && typeof frame\.offset === 'number' && frame\.offset >= CONTACT_MS \/ ACTION_MS\)/, 'Legacy nonterminal reactions must show contact instead of the idle recovery frame');
assert.match(skeletalSource.split('return () => {').at(-1),/style\.transform = ''/, 'Effect cleanup must restore base rig poses');
console.log(`Skeletal contract PASS: two explicit rigs, safe fallback, independent joints, contact/recovery, distinct attacks, critical windup, Pages paths; ${Math.round(bytes/1024)} KiB assets.`);
