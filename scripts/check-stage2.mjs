import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(relativePath, deps={}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: relativePath, reportDiagnostics: true });
  assert.deepEqual(compiled.diagnostics,[], `${relativePath}: transpilation`);
  const module={exports:{}};
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports,
    require: (name)=> {assert.ok(name in deps, `Missing mock ${name} in ${relativePath}`);return deps[name];}, console, Date, Math }, { filename: relativePath });
  return module.exports;
}
const weekly=load('../src/game/weeklyQuests.ts');
const followers=load('../src/game/followers.ts');
const balance=load('../src/game/pveBalance.ts');
const equipment={ EQUIPMENT_BALANCE_VERSION:3, prepareNewEquipment:(x)=>x };
const catalog={ createBossLootEquipment:(chapter, weapon, id)=>({id,slot:weapon?'weapon':'armor',name:'reward',icon:'⚔️',rarity:'common',level:chapter}), SHOP_EQUIPMENT_ITEMS: [] };
const engine=load('../src/game/engine.ts', {'./equipmentBalance':equipment, './equipmentCatalog': catalog, './weeklyQuests':weekly, './pveBalance':balance, './followers':followers});
const actions=load('../src/game/actions.ts', {'./store':{create:(initial)=>({get:()=>initial,set:()=>{},subscribe:()=>()=>{}})}, './equipmentBalance':equipment, './weeklyQuests':weekly, './purchaseGuard':{ canBuyShopItem:()=>true, shopStonesBoughtToday:()=>0, SHOP_STONES_PER_DAY:25 }, './engine':engine, './followers':followers});
assert.equal(weekly.weeklyQuestKey(Date.parse('2026-10-17T20:59:59Z')),'2026-10-11');
assert.equal(weekly.weeklyQuestKey(Date.parse('2026-10-17T21:00:00Z')),'2026-10-18');
assert.equal(weekly.weeklyQuestKey(Date.parse('2026-01-01T00:00:00Z')),'2025-12-28');
assert.equal(weekly.weeklyQuestKey(Date.parse('2026-02-28T22:00:00Z')),'2026-03-01');
assert.equal(weekly.weeklyQuestKey(Date.parse('2026-10-24T22:00:00Z')),'2026-10-25','DST switch on Sunday uses summer-time offset at midnight');
assert.throws(()=>weekly.weeklyQuestKey(Number.NaN),/Invalid date/);
let initial=engine.createInitialGame();
assert.equal(initial.weeklyResetWeek,weekly.weeklyQuestKey());
const sat=Date.parse('2026-10-17T12:00:00Z');
const sun=Date.parse('2026-10-18T12:00:00Z');
const previous = weekly.weeklyQuestKey(sat);
let state={...initial, dailyResetDay:new Date(sun).toDateString(), weeklyResetWeek:previous,
  quests: initial.quests.map(q=>q.id==='q_weekly_1'?{...q,current:1,claimed:true}:q.id==='q_story_1'?{...q,current:2}:q)};
let next=actions.applyTimeEffects(state,sun);
assert.equal(next.weeklyResetWeek,weekly.weeklyQuestKey(sun));
assert.equal(next.quests.find(x=>x.id==='q_weekly_1').claimed,false,'weekly claim should reset');
assert.equal(next.quests.find(x=>x.id==='q_weekly_1').current,0,'weekly count should reset');
assert.equal(next.quests.find(x=>x.id==='q_story_1').current,2,'story should stay');
assert.equal(actions.applyTimeEffects(next,sun).quests.find(x=>x.id==='q_weekly_1').current,0,'idempotent same week');
let legacy = actions.applyTimeEffects({...state, weeklyResetWeek:undefined},sun);
assert.equal(legacy.quests.find(x=>x.id==='q_weekly_1').claimed,true,'legacy earned reward must survive first visit');
assert.equal(legacy.weeklyResetWeek,weekly.weeklyQuestKey(sun));
// Three chapter starter scenario unchanged by level curve, despite stronger later bots.
for(let c of [1,2,3]){
  const mult=balance.chapterEnemyMultipliers(c);
  assert.equal(mult.hp,1);
  assert.equal(mult.attack,1);
  assert.equal(mult.defense,1);
}
const ch1=engine.generateChapter(1), ch20=engine.generateChapter(20), ch100=engine.generateChapter(100);
assert.equal(ch1.enemies[0].maxHp,Math.floor((75+25)*.8));
assert.equal(ch1.boss.maxHp,Math.floor((75+25)*2.55*balance.bossEnemyMultipliers(1).hp),'tutorial boss should use the new stronger base without a milestone bonus');
assert.ok(ch20.enemies[0].attack>Math.floor((12+20*4)*.8),'stronger attack at chapter20');
assert.ok(ch100.enemies[0].maxHp>Math.floor((75+100*25)*.8)*1.30,'stronger HP at chapter100');
assert.ok(engine.generateTrial(60).maxHp > Math.floor((75+60*25)*1.8)*1.3, 'trials should scale faster');
for(const n of [1,3,5,20,81,100,1000,3000]){
  for(const unit of [...engine.generateChapter(n).enemies,engine.generateChapter(n).boss,engine.generateTrial(n)]){
    for(const k of ['maxHp','attack','defense']) assert.ok(Number.isSafeInteger(unit[k])&&unit[k]>0,`${k} invalid for ${unit.id}`);
  }
}
const pve=load('../src/game/pve.ts',{'./arenaApi':{ZONES:[{id:'head',label:'Голова',mult:1.25},{id:'chest',label:'Грудь',mult:1},{id:'belly',label:'Живот',mult:1},{id:'legs',label:'Ноги',mult:.85}]}, './engine':{getComputedStats:(s)=>s.player.stats}, './pveBalance':balance, './followers':followers, './forge':{forgeSetBonus:()=>({hp:0,attack:0,defense:0})}});
const hero={name:'hero',hp:1000000,maxHp:1000000,attack:10000000,defense:1000000,critChance:0,critDamage:50};
for(const elite of [ch1.boss,engine.generateTrial(1)]){
  const enemy=pve.enemySide(elite);
  for(let j=0;j<80;j++){
    const res=pve.playRound(hero,enemy,'head',['head','chest'],5000000,'Companion',10);
    assert.ok(res.enemy.hp>0,`${elite.id} died in one round`);
    const damage=enemy.hp-res.enemy.hp;
    assert.ok(damage<=balance.eliteRoundDamageCap(elite.id,elite.isBoss,elite.maxHp));
    assert.ok(res.hits.filter(h=>h.targetSide==='enemy').reduce((sum,h)=>sum+h.amount,0)<=balance.eliteRoundDamageCap(elite.id,elite.isBoss,elite.maxHp));
  }
}
const regular=pve.enemySide(ch1.enemies[0]);
assert.equal(balance.eliteRoundDamageCap(regular.enemyId,regular.isBoss,regular.maxHp),null);
assert.equal(balance.followerGuardDamage(0,20),0);
assert.equal(balance.followerGuardDamage(100,10),94);
assert.equal(balance.followerGuardDamage(100,9999),88);
assert.equal(balance.followerGuardDamage(1,1000),1);
assert.equal(balance.followerGuardDamage(100,-1),100);
for(let i=0;i<250;i++) { const z=pve.randomZones(); assert.equal(new Set(z.blocks).size,2);assert.ok(z.blocks.every(s=>['head','chest','belly','legs'].includes(s))); }
const fakeBadPotion={effect:{stat:'attack',value:-100}};
assert.equal(pve.applyPotion(hero,fakeBadPotion).ok,false);
assert.equal(pve.applyPotion(hero,{effect:{stat:'hp',value:Number.POSITIVE_INFINITY}}).ok,false);
console.log('Stage2 weekly quest + PvE balance + elite guard + follower protection + potion checks: PASS');
const queue = load('../src/game/saveQueue.ts');
const events = [];
let allowFirst;
const firstDone = new Promise(resolve => { allowFirst = resolve; });
const save = queue.createCoalescingWriter(async snap => {
  events.push(`started:${snap}`);
  if(snap==='first') await firstDone;
  events.push(`finished:${snap}`);
  return true;
});
const a=save('first');
const b=save('second');
const c=save('third');
allowFirst();
assert.equal(await a,true);assert.equal(await b,true);assert.equal(await c,true);
assert.deepEqual(events,['started:first','finished:first','started:third','finished:third']);
const failWrites=[];
const fail=queue.createCoalescingWriter(async v=>{failWrites.push(v);if(v===1)throw Error('offline');return true;});
const failed=fail(1);
const resumed=fail(2);
await assert.rejects(failed,/offline/);
assert.equal(await resumed,true);
assert.deepEqual(failWrites,[1,2]);
console.log('Stage2 latest-state autosave coalescing: PASS');
