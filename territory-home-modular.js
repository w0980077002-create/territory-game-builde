(function(){
'use strict';
if(window.TerritoryHomeModular)return;
const $=s=>document.querySelector(s), n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const state=()=>window.TerritoryStore?.state||{};
const LEFT=['events','daily','quests','invite','sea'];
const RIGHT=['shop','forge','trials','capture','arena'];
const bottom=['home','inventory','hero','battle','quests','games','clan'];
function render(){
 const h=$('#home'); if(!h)return;
 h.className='screen active territory-home-modular';
 h.innerHTML=`<div class="thm-stage">
  <div class="thm-bg"></div>
  <header class="thm-header">
   <button class="thm-profile-btn" data-home-action="hero" aria-label="Профиль"><img id="homeProfilePhoto" src="assets/ui/profile.png" alt=""></button>
   <div class="thm-resources">
    <button class="thm-res-btn" data-home-action="coins"><img src="assets/ui/coins.png" alt=""></button>
    <button class="thm-res-btn" data-home-action="gems"><img src="assets/ui/gems.png" alt=""></button>
    <button class="thm-res-btn" data-home-action="redgems"><img src="assets/ui/redgems.png" alt=""></button>
    <button class="thm-energy-top" data-home-action="energy"><img src="assets/ui/energy-top.png" alt=""></button>
   </div>
   <div class="thm-actions">
    <button class="thm-act-btn" data-home-action="trophy"><img src="assets/ui/trophy.png" alt=""></button>
    <button class="thm-act-btn" data-home-action="mail"><img src="assets/ui/mail.png" alt=""></button>
    <button class="thm-act-btn" data-home-action="settings"><img src="assets/ui/settings.png" alt=""></button>
   </div>
  </header>
  <div class="thm-chapter-wrap">
   <button class="thm-chapter" data-home-action="chapter"><img src="assets/ui/chapter.png" alt=""><span class="dynamic"></span></button>
   <button class="thm-map-btn" data-home-action="map" aria-label="Карта"><span>🗺️</span><small>КАРТА</small></button>
  </div>
  <aside class="thm-side thm-left">${LEFT.map((x,i)=>`<button class="thm-side-btn" data-home-action="${x}"><img src="assets/ui/left-${i+1}.png" alt=""></button>`).join('')}</aside>
  <aside class="thm-side thm-right">${RIGHT.map((x,i)=>`<button class="thm-side-btn" data-home-action="${x}"><img src="assets/ui/right-${i+1}.png" alt=""></button>`).join('')}</aside>

  <section class="thm-battle-scene" aria-live="polite">
    <div class="thm-battle-track"><span class="done">1</span><span>2</span><span>3</span><span>4</span><span>☠</span></div>
    <div class="thm-battle-field">
      <div class="thm-fighter thm-enemy" id="homeEnemy">
        <div class="thm-fighter-name" id="homeEnemyName">Лесной разбойник</div>
        <div class="thm-fighter-art" id="homeEnemyArt">🗡️</div>
        <div class="thm-bar enemy"><i id="homeEnemyBar"></i></div><small id="homeEnemyHp">—</small>
      </div>
      <div class="thm-battle-center"><div class="thm-vs">VS</div><div id="homeBattleText" class="thm-battle-text">Готов к бою</div></div>
      <div class="thm-fighter thm-hero">
        <div class="thm-fighter-name">Герой</div>
        <img id="homeHeroArt" class="thm-hero-art" src="assets/skins/female-1.svg" alt="">
        <div class="thm-follower-mini">🐯</div>
        <div class="thm-bar hero"><i id="homeHeroBar"></i></div><small id="homeHeroHp">—</small>
      </div>
    </div>
    <div class="thm-battle-pop" id="homeBattlePop"></div>
    <button class="thm-battle-start" data-home-action="battle">⚔️ БОЙ</button>
  </section>

  <section class="thm-combat-ui">
   <div class="thm-meter thm-hp"><img src="assets/ui/hp.png" alt=""></div>
   <div class="thm-meter thm-xp"><img src="assets/ui/xp.png" alt=""></div>
   <div class="thm-meter thm-energy"><img src="assets/ui/energy.png" alt=""></div>
   <div class="thm-gear">${[1,2,3,4,5,6].map(i=>`<button data-home-action="gear${i}"><img src="assets/ui/gear-${i}.png" alt=""></button>`).join('')}</div>
   <div class="thm-potions">${[1,2,3,4].map(i=>`<button data-home-action="potion${i}"><img src="assets/ui/potion-${i}.png" alt=""></button>`).join('')}</div>
   <div class="thm-locks">${[1,2,3].map(i=>`<button data-home-action="locked${i}"><img src="assets/ui/locked-${i}.png" alt=""></button>`).join('')}</div>
   <div class="thm-controls">
    <button class="thm-stones-btn" data-home-action="stones"><span>🪨</span><b class="stone-count">0</b></button>
    <button data-home-action="speed"><img src="assets/ui/speed-x2.png" alt=""></button>
    <button data-home-action="auto"><img src="assets/ui/auto-battle.png" alt=""></button>
   </div>
   <div class="thm-meta"><button data-home-action="honor"><img src="assets/ui/honor.png" alt=""></button><button data-home-action="quest"><img src="assets/ui/quest.png" alt=""></button></div>
  </section>
  <nav class="thm-bottom">${bottom.map((x,i)=>`<button class="thm-bottom-btn ${x==='battle'?'is-battle':''}" data-screen="${x}"><img src="assets/ui/bottom-${i+1}.png" alt=""></button>`).join('')}</nav>
 </div>`;
 paint();
}
function paint(){
 const root=$('#home'); if(!root)return; const s=state();
 const ch=n(s.currentChapter??s.pve?.chapter,1), st=n(s.chapterStage??s.pve?.stage,1);
 const d=root.querySelector('.dynamic'); if(d)d.textContent='Глава '+ch+' • Северные земли '+ch+'-'+st;
 const ph=root.querySelector('#homeProfilePhoto'); if(ph&&s.profile?.photoUrl)ph.src=s.profile.photoUrl;
 const c=root.querySelector('.stone-count'); if(c)c.textContent=Math.max(0,(+s.battleStones||0)+(+s.battleStonesBonus||0));
 const auto=root.querySelector('[data-home-action="auto"]'); if(auto)auto.dataset.active=s.auto?'1':'0';
 const speed=root.querySelector('[data-home-action="speed"]'); if(speed)speed.dataset.speed=String(n(s.battleSpeed??s.speed,1));
 const bar=root.querySelector('#homeHeroBar'); if(bar)bar.style.width=Math.max(0,Math.min(100,(+s.hp||+s.maxHp||100)/(+s.maxHp||100)*100))+'%';
 const hp=root.querySelector('#homeHeroHp'); if(hp)hp.textContent=Math.max(0,+s.hp||+s.maxHp||100)+' / '+Math.max(1,+s.maxHp||100);
 const hero=root.querySelector('#homeHeroArt'); if(hero){const src=s.character?.activeUnique==='unique-dikaya'?'assets/skins/unique-dikaya.png':(/^((male|female)-[1-5])$/.test(String(s.character?.skin||''))?`assets/skins/${s.character.skin}.svg`:'assets/skins/female-1.svg'); hero.src=src;}
}
function init(){render();window.addEventListener('territory:state-changed',paint);window.addEventListener('territory:telegram-authenticated',paint);window.addEventListener('territory:telegram-synced',paint);window.TerritoryHomeModular={render,refresh:paint};window.HomeRebuild={render,refresh:paint,startRunner:()=>window.PvEFlow?.startRunner?.(),openBoss:()=>window.PvEFlow?.openBoss?.()}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
