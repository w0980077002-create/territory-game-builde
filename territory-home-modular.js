(function(){
'use strict';
if(window.TerritoryHomeModular)return;
const $=s=>document.querySelector(s), n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const state=()=>window.TerritoryStore?.state||{};
const img=(src,alt='')=>`<img src="${src}" alt="${alt}" draggable="false">`;

function render(){
 const h=$('#home'); if(!h)return;
 h.className='screen active territory-home-modular';
 h.innerHTML=`
 <div class="thm-stage">
  <div class="thm-bg"></div>
  <div class="thm-vignette"></div>

  <header class="thm-header">
   <button class="thm-profile-btn" data-home-action="hero">
    ${img('assets/ui/profile.png')}
    <span class="thm-profile-text"><b class="thm-name">Игрок</b><small>Lv. <span class="thm-level">1</span> · VIP <span class="thm-vip">0</span></small></span>
   </button>
   <div class="thm-resources">
    <button class="thm-res-btn" data-home-action="coins">${img('assets/ui/coins.png')}<span data-home-value="coins">0</span><i>+</i></button>
    <button class="thm-res-btn" data-home-action="gems">${img('assets/ui/gems.png')}<span data-home-value="gems">0</span><i>+</i></button>
    <button class="thm-res-btn" data-home-action="redgems">${img('assets/ui/redgems.png')}<span data-home-value="redgems">0</span><i>+</i></button>
    <button class="thm-res-btn energy" data-home-action="energy">${img('assets/ui/energy-top.png')}<span data-home-value="energy">100/100</span><i>+</i></button>
   </div>
   <div class="thm-actions">
    <button data-home-action="trophy">${img('assets/ui/trophy.png')}</button>
    <button data-home-action="mail">${img('assets/ui/mail.png')}<b class="dot"></b></button>
    <button data-home-action="settings">${img('assets/ui/settings.png')}</button>
   </div>
  </header>

  <button class="thm-chapter" data-home-action="chapter">
   <span class="arr">‹</span>
   <div><b class="dynamic">Глава 1 · Северные земли 1-1</b><small>Карта мира</small></div>
   <span class="arr">›</span>
  </button>
  <div class="thm-progress">
   <span class="p done">1</span><span class="line"></span><span class="p">2</span><span class="line"></span><span class="p">3</span><span class="line"></span><span class="p">4</span><span class="line"></span><span class="p boss">☠</span>
  </div>
  <button class="thm-map-btn" data-home-action="map">${img('assets/ui/chapter.png')}<span>КАРТА</span></button>

  <aside class="thm-side thm-left">
   ${['events','daily','quests','invite','sea'].map((x,i)=>`<button class="thm-side-btn" data-home-action="${x}">${img(`assets/ui/left-${i+1}.png`)}</button>`).join('')}
  </aside>
  <aside class="thm-side thm-right">
   ${['shop','forge','trials','capture','arena'].map((x,i)=>`<button class="thm-side-btn" data-home-action="${x}">${img(`assets/ui/right-${i+1}.png`)}</button>`).join('')}
  </aside>

  <section class="thm-battle" aria-label="PvE бой">
   <div class="battle-caption"><span>⚔ PvE</span><b class="battle-stage-label">БОЙ С БОТОМ</b><small class="battle-sub">Следующий противник</small></div>
   <div class="thm-combatant thm-hero">
    <div class="nameplate"><span class="hero-name">Герой</span><em class="hero-hp">100/100</em></div>
    <div class="battle-sprite hero-sprite"><img class="hero-img" src="assets/skins/battle-hero-real.png" alt="Герой"><div class="follower-chip">🐯 <b>Последователь</b></div></div>
   </div>
   <div class="thm-combatant thm-enemy">
    <div class="nameplate"><span class="enemy-name">Противник</span><em class="enemy-hp">100/100</em></div>
    <div class="battle-sprite enemy-sprite"><img class="enemy-img" src="assets/skins/battle-enemy-real.png" alt="Противник"></div>
   </div>
   <div class="battle-effects" id="thmBattleEffects"></div>
   <div class="thm-battle-status" id="thmBattleStatus">Готов к бою</div>
   <div id="thmBattleResult" class="thm-result" hidden></div>
  </section>

  <section class="thm-combat-ui">
   <div class="thm-hp-ribbon">
    <button class="combat-orb attack-orb" id="thmAttack" aria-label="Атака">⚔</button>
    <div class="thm-unit-bar hero-bar"><span></span><b>100/100</b></div>
    <button class="combat-pvp" data-home-action="arena">PVP</button>
    <button class="combat-orb skill-orb" id="thmSkill" aria-label="Умение">✦</button>
   </div>

   <div class="thm-gear">
    ${[1,2,3,4,5,6].map(i=>`<button data-home-action="gear${i}">${img(`assets/ui/gear-${i}.png`)}</button>`).join('')}
   </div>
   <div class="thm-potions">
    ${[1,2,3,4].map(i=>`<button data-home-action="potion${i}">${img(`assets/ui/potion-${i}.png`)}</button>`).join('')}
   </div>
   <div class="thm-locks">
    ${[1,2,3].map(i=>`<button data-home-action="locked${i}">${img(`assets/ui/locked-${i}.png`)}</button>`).join('')}
   </div>

   <div class="thm-micro-controls">
    <button class="thm-stones-btn" data-home-action="stones"><span>🪨</span><b class="stone-count">0</b></button>
    <button data-home-action="speed" class="single-control">${img('assets/ui/speed-x2.png')}</button>
    <button data-home-action="auto" class="single-control">${img('assets/ui/auto-battle.png')}</button>
    <button data-home-action="honor" class="micro-action">☀</button>
    <button data-home-action="quest" class="micro-action">!</button>
   </div>

   <div class="thm-questbar">
    <div class="quest-copy"><b>Пройти основную главу</b><strong class="quest-chapter">1-1</strong><small>Победа откроет следующего противника</small></div>
    <div class="quest-reward">🪙 <b>1000</b></div>
    <div class="quest-progress"><span>0/1</span></div>
   </div>
  </section>

  <nav class="thm-bottom">
   ${['home','inventory','hero','battle','quests','games','clan'].map((x,i)=>`<button class="thm-bottom-btn ${x==='battle'?'active':''}" data-screen="${x}">${img(`assets/ui/bottom-${i+1}.png`)}${x==='battle'?'<span class="bottom-active"></span>':''}</button>`).join('')}
  </nav>
 </div>`;

 bindBattle(); paint(); forceRealSprites();
}

function bindBattle(){
 $('#thmAttack')?.addEventListener('click',()=>window.PvEBattle?.attack?.());
 $('#thmSkill')?.addEventListener('click',()=>window.PvEBattle?.skill?.('power'));
 const hero=document.querySelector('.hero-img'),enemy=document.querySelector('.enemy-img');
 const mo=new MutationObserver(()=>forceRealSprites());
 if(hero)mo.observe(hero,{attributes:true,attributeFilter:['src']});
 if(enemy)mo.observe(enemy,{attributes:true,attributeFilter:['src']});
 window.__thmRealSpriteObserver=mo;
}
function forceRealSprites(){
 const hero=$('.hero-img'), enemy=$('.enemy-img');
 if(hero && !hero.src.endsWith('/battle-hero-real.png')) hero.src='assets/skins/battle-hero-real.png';
 if(enemy && !enemy.src.endsWith('/battle-enemy-real.png')) enemy.src='assets/skins/battle-enemy-real.png';
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
 r.querySelector('[data-home-action="auto"]')?.classList.toggle('active',!!s.auto);
 r.querySelector('[data-home-action="speed"]')?.classList.toggle('active',n(s.battleSpeed??s.speed,1)===2);
 const ps=[...r.querySelectorAll('.thm-progress .p')];ps.forEach((el,i)=>{el.classList.toggle('done',prog>=i*25);el.classList.toggle('current',st===i+1&&prog<100)});
 const q=r.querySelector('.quest-chapter'); if(q)q.textContent=`${ch}-${st}`;
 const qp=r.querySelector('.quest-progress span');if(qp)qp.textContent=`${Math.min(1,Math.max(0,prog/100))?1:0}/1`;
 forceRealSprites();
}
function init(){render();window.addEventListener('territory:state-changed',paint);window.addEventListener('territory:telegram-authenticated',paint);window.addEventListener('territory:telegram-synced',paint);window.TerritoryHomeModular={render,refresh:paint};window.HomeRebuild={render,refresh:paint,startRunner:()=>window.PvEBattle?.startCurrent?.(),openBoss:()=>window.PvEFlow?.openBoss?.()};}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
