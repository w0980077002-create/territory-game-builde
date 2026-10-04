(function(){
'use strict';
if(window.TerritoryHomeModular)return;
const $=s=>document.querySelector(s), n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const state=()=>window.TerritoryStore?.state||{};
const LEFT=['events','daily','quests','invite','sea'];
const RIGHT=['shop','forge','trials','capture','arena'];
const img=(src,alt='')=>`<img src="${src}" alt="${alt}" draggable="false">`;

function render(){
 const h=$('#home'); if(!h)return;
 h.classList.add('territory-home-modular');
 h.innerHTML=`
 <div class="thm-stage">
  <div class="thm-bg"></div><div class="thm-vignette"></div>

  <header class="thm-header">
   <button class="thm-profile-btn" data-home-action="hero">
    ${img('assets/ui/profile.png','Профиль')}
    <span class="thm-profile-text"><b class="thm-name">Игрок</b><small>Lv.<span class="thm-level">1</span> · VIP <span class="thm-vip">0</span></small></span>
   </button>
   <div class="thm-resources">
    <button class="thm-res-btn" data-home-action="coins">${img('assets/ui/coins.png')}<span data-home-value="coins">0</span><i>+</i></button>
    <button class="thm-res-btn" data-home-action="gems">${img('assets/ui/gems.png')}<span data-home-value="gems">0</span><i>+</i></button>
    <button class="thm-res-btn" data-home-action="redgems">${img('assets/ui/redgems.png')}<span data-home-value="redgems">0</span><i>+</i></button>
    <button class="thm-res-btn" data-home-action="energy">${img('assets/ui/energy-top.png')}<span data-home-value="energy">100/100</span><i>+</i></button>
   </div>
   <div class="thm-actions">
    <button data-home-action="trophy">${img('assets/ui/trophy.png')}</button>
    <button data-home-action="mail">${img('assets/ui/mail.png')}<b class="dot"></b></button>
    <button data-home-action="settings">${img('assets/ui/settings.png')}</button>
   </div>
  </header>

  <div class="thm-chapter-strip">
   <button class="thm-chapter" data-home-action="chapter">
    <span class="chapter-pin">●</span><span class="chapter-text dynamic">Глава 1 · Северные земли 1-1</span><span class="chapter-arrow">›</span>
   </button>
   <div class="thm-node-progress" aria-hidden="true">
    <span class="node done">1</span><i></i><span class="node">2</span><i></i><span class="node">3</span><i></i><span class="node">4</span><i></i><span class="node boss">☠</span>
   </div>
   <button class="thm-map-btn" data-home-action="map">${img('assets/ui/chapter.png')}<span>КАРТА</span></button>
  </div>

  <aside class="thm-side thm-left">${LEFT.map((x,i)=>`<button class="thm-side-btn" data-home-action="${x}">${img(`assets/ui/left-${i+1}.png`)}</button>`).join('')}</aside>
  <aside class="thm-side thm-right">${RIGHT.map((x,i)=>`<button class="thm-side-btn" data-home-action="${x}">${img(`assets/ui/right-${i+1}.png`)}</button>`).join('')}</aside>

  <section class="thm-battle" aria-label="PvE бой">
   <div class="battle-title"><span class="battle-mode">PVE</span><b>Северные земли</b><small>Бой ${n(state().chapterStage,1)} / 4 · Босс после 4 побед</small></div>

   <div class="thm-combatant thm-hero">
    <div class="fighter-name hero-name">Герой</div>
    <div class="battle-sprite hero-sprite"><img class="hero-img" src="assets/skins/battle-hero.svg" alt="Герой"><div class="follower-chip"><span>🐯</span></div></div>
    <div class="fighter-hp hero-hp">100/100</div>
   </div>

   <div class="battle-center-mark"><span class="line"></span><b>⚔</b><span class="line"></span></div>

   <div class="thm-combatant thm-enemy">
    <div class="fighter-name enemy-name">Противник</div>
    <div class="battle-sprite enemy-sprite"><img class="enemy-img" src="assets/skins/battle-enemy.svg" alt="Противник"></div>
    <div class="fighter-hp enemy-hp">100/100</div>
   </div>

   <div class="battle-effects" id="thmBattleEffects"></div>
   <div class="thm-battle-status" id="thmBattleStatus">Готов к бою</div>
   <div class="thm-result" id="thmBattleResult" hidden></div>
  </section>

  <section class="thm-combat-ui">
   <div class="thm-hp-row">
    <div class="hp-pill"><span class="hp-fill hero-fill"></span><b class="hero-bar-text">100/100</b></div>
    <div class="hp-pill"><span class="hp-fill enemy-fill"></span><b class="enemy-bar-text">100/100</b></div>
   </div>

   <div class="thm-gear-row">${[1,2,3,4,5,6].map(i=>`<button data-home-action="gear${i}">${img(`assets/ui/gear-${i}.png`)}</button>`).join('')}</div>

   <div class="thm-bottom-combat-row">
    <div class="thm-potions">${[1,2,3,4].map(i=>`<button data-home-action="potion${i}">${img(`assets/ui/potion-${i}.png`)}</button>`).join('')}</div>
    <div class="thm-locks">${[1,2,3].map(i=>`<button data-home-action="locked${i}">${img(`assets/ui/locked-${i}.png`)}</button>`).join('')}</div>
   </div>

   <div class="thm-action-row">
    <button class="combat-main attack" id="thmAttack" aria-label="Атака"><span>⚔</span><small>АТАКА</small></button>
    <div class="combat-tools">
     <button class="tool stone" data-home-action="stones"><span>🪨</span><b class="stone-count">0</b></button>
     <button class="tool" data-home-action="speed"><img src="assets/ui/speed-x2.png" alt="x2"></button>
     <button class="tool" data-home-action="auto"><img src="assets/ui/auto-battle.png" alt="Автобой"></button>
     <button class="tool" data-home-action="honor">☀</button>
    </div>
    <button class="combat-main skill" id="thmSkill" aria-label="Умение"><span>✦</span><small>УМЕНИЕ</small></button>
   </div>
  </section>

  <nav class="thm-bottom">
   ${['home','inventory','hero','battle','quests','games','clan'].map((x,i)=>`<button class="thm-bottom-btn ${x==='battle'?'active':''}" data-screen="${x}">${img(`assets/ui/bottom-${i+1}.png`)}<span>${({home:'Город',inventory:'Инвентарь',hero:'Герой',battle:'Бой',quests:'Квесты',games:'Игры',clan:'Клан'})[x]}</span></button>`).join('')}
  </nav>
 </div>`;
 bind();paint();
}

function bind(){
 $('#thmAttack')?.addEventListener('click',()=>window.PvEBattle?.attack?.());
 $('#thmSkill')?.addEventListener('click',()=>window.PvEBattle?.skill?.('power'));
}
function paint(){
 const r=$('#home'),s=state(); if(!r)return;
 const ch=n(s.currentChapter??s.pve?.chapter,1),st=n(s.chapterStage??s.pve?.stage,1),prog=n(s.chapterProgress??s.pve?.progress,0);
 const d=r.querySelector('.dynamic'); if(d)d.textContent=`Глава ${ch} · Северные земли ${ch}-${st}`;
 const name=r.querySelector('.thm-name');if(name)name.textContent=s.profile?.displayName||'Игрок';
 const lvl=r.querySelector('.thm-level');if(lvl)lvl.textContent=String(n(s.level,1));
 const vip=r.querySelector('.thm-vip');if(vip)vip.textContent=String(n(s.profile?.vip,0));
 const vals={coins:n(s.coins),gems:n(s.gems),redgems:n(s.redGems),energy:`${n(s.energy,100)}/${n(s.maxEnergy,100)}`};
 for(const [k,v] of Object.entries(vals)){const el=r.querySelector(`[data-home-value="${k}"]`);if(el)el.textContent=String(v)}
 const sc=r.querySelector('.stone-count');if(sc)sc.textContent=Math.max(0,n(s.battleStones)+n(s.battleStonesBonus));
 const auto=r.querySelector('[data-home-action="auto"]');if(auto)auto.dataset.active=s.auto?'1':'0';
 const speed=r.querySelector('[data-home-action="speed"]');if(speed)speed.dataset.speed=String(n(s.battleSpeed??s.speed,1));
 const nodes=[...r.querySelectorAll('.thm-node-progress .node:not(.boss)')];nodes.forEach((el,i)=>{el.classList.toggle('done',prog>=i*25);el.classList.toggle('current',st===i+1&&prog<100)});
}
function init(){
 render();
 window.addEventListener('territory:state-changed',paint);
 window.addEventListener('territory:telegram-authenticated',paint);
 window.addEventListener('territory:telegram-synced',paint);
 window.TerritoryHomeModular={render,refresh:paint};
 window.HomeRebuild={render,refresh:paint,startRunner:()=>window.PvEBattle?.startCurrent?.(),openBoss:()=>window.PvEFlow?.openBoss?.()};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
