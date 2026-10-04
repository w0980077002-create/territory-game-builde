(function(){
'use strict';
const Store=window.TerritoryStore;
const S=()=>Store?.state||{};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const enemies=[
 {name:'Лесной разбойник',icon:'🗡️',hp:180,atk:18,def:5,coins:45},
 {name:'Рудничный голем',icon:'🗿',hp:270,atk:23,def:12,coins:65},
 {name:'Рунный страж',icon:'🔮',hp:390,atk:29,def:18,coins:90},
 {name:'Элитный вождь',icon:'⚔️',hp:540,atk:36,def:24,coins:125}
];
let battle=null,busy=false,autoTimer=null;
function ensureState(){
 const s=S(); s.pve=s.pve||{};
 s.currentChapter=Math.max(1,Math.min(240,Number(s.currentChapter)||1));
 s.chapterProgress=Math.max(0,Math.min(100,Number(s.chapterProgress)||0));
 s.chapterStage=Math.max(1,Math.min(4,Number(s.chapterStage)||Math.floor(s.chapterProgress/25)+1));
 s.pve.chapter=s.currentChapter;s.pve.stage=s.chapterStage;s.pve.progress=s.chapterProgress;
 s.chapterBossUnlocked=!!(s.chapterBossUnlocked||s.pve.bossPending||s.chapterProgress>=100);
 return s;
}
function heroStats(){
 const s=S(), c=s.character||{}, eq=Array.isArray(s.equipment)?s.equipment:[];
 let atk=100+(+s.level||1)*2+(+c.strength||10)*3, def=80+(+s.level||1)+(+c.resilience||10)*3, hp=+s.maxHp||100, crit=8+(+c.intuition||10)*.55, dodge=5+(+c.agility||10)*.5;
 for(const it of eq){if(!it||typeof it!=='object')continue;atk+=+(it.attack??it.atk??it.damage??0);def+=+(it.defense??it.def??it.armor??0);hp+=+(it.maxHp??it.hp??it.health??0);crit+=+(it.critChance||0);dodge+=+(it.dodgeChance||0)}
 return {atk,def,hp,crit,dodge};
}
function home(){return document.querySelector('#home');}
function mount(){
 const h=home(); if(!h)return null;
 h.classList.add('battle-ready');
 return h;
}
function text(t){const el=document.querySelector('#homeBattleText');if(el)el.textContent=t||'';}
function pop(t,crit=false){const el=document.querySelector('#homeBattlePop');if(!el)return;el.textContent=t;el.classList.remove('show');void el.offsetWidth;el.classList.add('show');el.style.color=crit?'#ff9a65':'#ffe082';}
function paint(){
 const h=mount(); if(!h||!battle)return;
 const s=S(), c=heroStats(), e=battle.enemy;
 h.classList.toggle('battle-running',!battle.ended);
 const name=document.querySelector('#homeEnemyName');if(name)name.textContent=e.name;
 const art=document.querySelector('#homeEnemyArt');if(art)art.textContent=e.icon;
 const ebar=document.querySelector('#homeEnemyBar');if(ebar)ebar.style.width=Math.max(0,e.hp/e.maxHp*100)+'%';
 const ehp=document.querySelector('#homeEnemyHp');if(ehp)ehp.textContent=Math.max(0,Math.ceil(e.hp))+' / '+e.maxHp;
 const hbar=document.querySelector('#homeHeroBar');if(hbar)hbar.style.width=Math.max(0,battle.hp/battle.maxHp*100)+'%';
 const hhp=document.querySelector('#homeHeroHp');if(hhp)hhp.textContent=Math.max(0,Math.ceil(battle.hp))+' / '+battle.maxHp;
 const track=document.querySelector('.thm-battle-track');
 if(track)track.innerHTML=[1,2,3,4,'☠'].map((x,i)=>`<span class="${battle.boss?(i===4?'done':'done'):i<Math.floor((+s.chapterProgress||0)/25)?'done':''}${!battle.boss&&i+1===battle.stage?' current':''}">${x}</span>`).join('');
 const st=document.querySelector('.stone-count');if(st)st.textContent=Math.max(0,(+s.battleStones||0)+(+s.battleStonesBonus||0));
 const auto=document.querySelector('[data-home-action="auto"]');if(auto)auto.dataset.active=battle.auto?'1':'0';
 const speed=document.querySelector('[data-home-action="speed"]');if(speed)speed.dataset.speed=String(battle.speed||1);
 const start=document.querySelector('[data-home-action="battle"]');if(start)start.textContent=battle.ended?'⚔️ БОЙ':(battle.auto?'⏸ ПАУЗА':'▶ ПРОДОЛЖИТЬ');
 text(battle.boss?`Босс · фаза ${battle.phase}${battle.phase===3?' · ЯРОСТЬ':''}`:(battle.auto?`Бой идёт · ×${battle.speed}`:`Готов: ${e.name}`));
}
function takeStone(s){if((+s.battleStones||0)>0){s.battleStones--;return true}if((+s.battleStonesBonus||0)>0){s.battleStonesBonus--;return true}return false}
function makeEnemy(stage,boss){const s=S(),lv=+s.level||1;if(boss){const hp=2600+lv*22;return{name:'Вождь Боевого Племени',icon:'👑',maxHp:hp,hp,atk:32+lv,def:20+Math.floor(lv/3),coins:500,boss:true}}const b=enemies[Math.max(0,Math.min(3,stage-1))],scale=1+(Math.max(0,+s.currentChapter-1)*.055),hp=Math.round(b.hp*scale+lv*8);return{...b,maxHp:hp,hp,atk:Math.round(b.atk*scale+lv*.6),def:Math.round(b.def+lv*.25),boss:false};}
async function start(stage,boss=false){
 if(battle&&!battle.ended){battle.auto=!battle.auto;paint();schedule();return battle;}
 const s=ensureState(); stage=Math.max(1,Math.min(4,Number(stage)||s.chapterStage));
 if(!boss&&s.chapterProgress>=100){openBoss();return;}
 if(boss&&!s.chapterBossUnlocked){text('Сначала победи 4 ботов главы');return;}
 if(!takeStone(s)){text('🪨 Боевые камни закончились');paint();return;}
 Store.saveNow?.('pve-start'); mount();
 busy=true; battle={stage,boss,server:false,enemy:makeEnemy(stage,boss),hp:Math.max(1,Number(s.hp)||Number(s.maxHp)||100),maxHp:Number(s.maxHp)||100,phase:1,turn:0,auto:true,speed:Number(s.battleSpeed??s.speed)||1,ended:false};
 if(window.TerritoryServer?.available?.()){
  try{const r=await window.TerritoryServer.start(s.currentChapter,stage,boss);const c=r.combat||{};Object.assign(Store.state,r.state||{});battle.server=true;battle.session_id=r.session_id;battle.nonce=r.nonce;battle.hp=Number(c.heroHp)||battle.hp;battle.maxHp=Number(c.maxHp)||battle.maxHp;battle.enemy.maxHp=Number(c.enemyMaxHp)||battle.enemy.maxHp;battle.enemy.hp=Number(c.enemyHp)||battle.enemy.hp;}catch(e){text('⚠️ Серверный бой недоступен — локальный бой продолжен');}}
 busy=false; paint();schedule(); return battle;
}
function schedule(){clearTimeout(autoTimer);if(!battle||battle.ended||!battle.auto)return;autoTimer=setTimeout(()=>action('attack'),battle.speed===2?260:700);}
async function action(kind){
 if(!battle||battle.ended||busy)return;busy=true;
 if(battle.server){
  try{const r=await window.TerritoryServer.action(battle.session_id,battle.nonce,kind),c=r.combat||{};battle.hp=Number(c.heroHp)||battle.hp;battle.maxHp=Number(c.maxHp)||battle.maxHp;battle.enemy.hp=Number(c.enemyHp)||battle.enemy.hp;battle.enemy.maxHp=Number(c.enemyMaxHp)||battle.enemy.maxHp;battle.turn=Number(c.turn)||battle.turn;pop(c.result==='win'?'ПОБЕДА':'⚔️');
   if(c.result==='win'||c.result==='lose'||c.ended){busy=false;await finish(c.result==='win');return;}
   busy=false;paint();schedule();return;
  }catch(e){battle.server=false;text('Локальный режим: '+(e.message||'ошибка'))}
 }
 const s=S(),t=heroStats(),e=battle.enemy;
 if(kind==='elixir_hp'){const n=Number(s.consumables?.elixir_hp||0);if(!n){busy=false;text('🧪 Зелья HP закончились');return;}s.consumables.elixir_hp=n-1;battle.hp=Math.min(battle.maxHp,battle.hp+Math.round(battle.maxHp*.3));Store.saveNow?.();busy=false;paint();schedule();return;}
 const crit=Math.random()<t.crit/100,dodge=Math.random()<Math.min(.3,e.def/700),base=Math.max(5,Math.round(t.atk*.72-e.def*.28+Math.random()*12));let dmg=Math.round(base*(crit?1.8:1));
 if(kind==='skill:power')dmg=Math.round(dmg*1.7);
 if(!dodge){e.hp=Math.max(0,e.hp-dmg);pop('-'+dmg+(crit?' КРИТ!':'') ,crit);}else pop('УВОРОТ');
 battle.turn++;
 if(e.hp<=0){busy=false;await finish(true);return;}
 if(battle.boss){const pct=e.hp/e.maxHp;if(battle.phase===1&&pct<=.66){battle.phase=2;e.atk=Math.round(e.atk*1.2);e.def+=8;pop('🔥 ФАЗА 2');}if(battle.phase===2&&pct<=.33){battle.phase=3;e.atk=Math.round(e.atk*1.25);pop('☠️ ЯРОСТЬ');}}
 const incoming=Math.max(3,Math.round(e.atk*.45-t.def*.12+Math.random()*7));battle.hp=Math.max(0,battle.hp-incoming);if(battle.hp<=0||battle.turn>=30){busy=false;await finish(false);return;}
 busy=false;paint();schedule();
}
async function finish(win){clearTimeout(autoTimer);busy=false;const s=S();battle.ended=true;
 if(battle.server&&win){try{const r=await window.TerritoryServer.complete(battle.session_id);Object.assign(Store.state,r.state||{});if(r.economy){s.coins=Number(r.economy.coins)||s.coins;s.gems=Number(r.economy.gems)||s.gems;}Store.saveNow?.();}catch(e){}}
 if(win){s.hp=Math.max(1,Math.floor(battle.hp));
  if(battle.boss){s.coins=(+s.coins||0)+battle.enemy.coins;s.gems=(+s.gems||0)+5;s.pve.bossDefeated=(+s.pve.bossDefeated||0)+1;s.chapterBossUnlocked=false;s.chapterCompleted=true;s.currentChapter=Math.min(240,(+s.currentChapter||1)+1);s.chapterStage=1;s.chapterProgress=0;s.pve.chapter=s.currentChapter;s.pve.stage=1;s.pve.progress=0;s.pve.bossPending=false;Store.trackProgress?.('bosses',1);Store.trackProgress?.('chapters',1);Store.addXp?.(60);text('👑 БОСС ПОВЕРЖЕН · следующая глава открыта');
  }else{s.pve.wins=(+s.pve.wins||0)+1;s.chapterProgress=Math.min(100,(+s.chapterProgress||0)+25);s.pve.progress=s.chapterProgress;s.chapterStage=s.chapterProgress>=100?4:Math.min(4,(+s.chapterStage||1)+1);if(s.chapterProgress>=100){s.chapterBossUnlocked=true;s.pve.bossPending=true;}Store.trackProgress?.('wins',1);Store.addXp?.(25+battle.stage*5);s.coins=(+s.coins||0)+battle.enemy.coins;Store.saveNow?.();text('🏆 ПОБЕДА · следующий противник');
  }
 }else{s.hp=Math.max(1,Math.floor((s.maxHp||100)*.35));text('☠️ Поражение · подготовь героя и повтори');}
 Store.saveNow?.();window.dispatchEvent(new CustomEvent('territory:pve-finished',{detail:{win,boss:!!battle.boss}}));paint();
 if(win&&!battle.boss){setTimeout(()=>{if((+S().battleStones||0)+(+S().battleStonesBonus||0)>0){battle=null;start(ensureState().chapterStage,false);}else{text('🏆 Победа · боевые камни закончились');}},900);}else if(win&&battle.boss){setTimeout(()=>{battle=null;paint();},1200)}
}
function openBoss(){const s=ensureState();if(!s.chapterBossUnlocked){text('☠️ Босс откроется после 4 побед');return;}start(4,true);}
function close(){clearTimeout(autoTimer);battle=null;busy=false;home()?.classList.remove('battle-running');paintIdle();}
function paintIdle(){const s=S();text('Готов к бою');const name=document.querySelector('#homeEnemyName');if(name)name.textContent='Следующий противник';const art=document.querySelector('#homeEnemyArt');if(art)art.textContent='🗡️';const ebar=document.querySelector('#homeEnemyBar');if(ebar)ebar.style.width='100%';const ehp=document.querySelector('#homeEnemyHp');if(ehp)ehp.textContent='—';const hbar=document.querySelector('#homeHeroBar');if(hbar)hbar.style.width=Math.max(0,(+s.hp||+s.maxHp||100)/(+s.maxHp||100)*100)+'%';}
window.PvEFlow={open:()=>window.showScreen?.('home'),startRunner:()=>start(ensureState().chapterStage,false),openBoss,stop:close};
window.PvEBattle={start, startBoss:()=>start(4,true), close, attack:()=>action('attack'), skill:x=>action('skill:'+(x||'power')), potion:()=>action('elixir_hp'), toggleAuto:()=>{if(battle){battle.auto=!battle.auto;paint();schedule();}},toggleSpeed:()=>{if(battle){battle.speed=battle.speed===2?1:2;paint();schedule();}}};
window.addEventListener('territory:state-changed',()=>{if(!battle)paintIdle();else paint();});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',paintIdle,{once:true});else paintIdle();
})();
