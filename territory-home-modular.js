(function(){
'use strict';
if(window.TerritoryHomeModular)return;
const $=s=>document.querySelector(s);
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const state=()=>window.TerritoryStore?.state||{};
const A='assets/ui/territory-hud/';

const side=[
 ['events','side-events.png'],
 ['clan','side-clan.png'],
 ['quests','side-quests.png'],
 ['invite','side-invite.png'],
 ['sea','side-rewards.png']
];
const right=[
 ['shop','side-shop.png'],
 ['forge','side-forge.png'],
 ['trials','side-trials.png'],
 ['capture','side-capture.png'],
 ['arena','side-arena.png']
];
const bottom=[
 ['home','bottom-home.png','Главная'],
 ['hero','bottom-hero.png','Герой'],
 ['battle','bottom-battle.png','Бой'],
 ['quests','bottom-quests.png','Квесты'],
 ['shop','bottom-shop.png','Магазин']
];

function img(src,alt=''){return `<img src="${src}" alt="${alt}" draggable="false">`}
function render(){
 const h=$('#home');if(!h)return;
 h.className='screen active territory-home-modular';
 h.innerHTML=`
 <div class="thm-stage">
  <div class="thm-bg"></div><div class="thm-vignette"></div><div class="thm-grain"></div>
  <header class="thm-header">
   <button class="thm-profile-btn" data-home-action="hero">${img('assets/ui/profile.png','Профиль')}<span><b class="thm-name">Игрок</b><small>Lv. <b class="thm-level">1</b> · VIP <b class="thm-vip">0</b></small></span></button>
   <div class="thm-wallet">
    <button data-home-action="coins"><i class="ico coin">◉</i><b data-home-value="coins">0</b><em>+</em></button>
    <button data-home-action="gems"><i class="ico gem">◆</i><b data-home-value="gems">0</b><em>+</em></button>
    <button data-home-action="redgems"><i class="ico red">◆</i><b data-home-value="redgems">0</b><em>+</em></button>
    <button data-home-action="energy"><i class="ico energy">⚡</i><b data-home-value="energy">100/100</b><em>+</em></button>
   </div>
   <div class="thm-system"><button data-home-action="trophy">🏆</button><button data-home-action="mail"><span class="mail-dot"></span>✉</button><button data-home-action="settings">⚙</button></div>
  </header>

  <button class="thm-chapter" data-home-action="chapter"><span>‹</span><div><b class="dynamic">Глава 1 · Северные земли 1-1</b><small>Основной путь</small></div><span>›</span></button>
  <button class="thm-map" data-home-action="map"><span class="map-icon">🗺️</span><b>КАРТА</b></button>
  <div class="thm-progress"><i class="done">1</i><span></span><i>2</i><span></span><i>3</i><span></span><i>4</i><span></span><i class="boss">☠</i></div>

  <aside class="thm-side left" aria-label="Боковое меню">${side.map(([k,f])=>`<button data-home-action="${k}">${img(A+f)}</button>`).join('')}</aside>
  <aside class="thm-side right" aria-label="Боковое меню">${right.map(([k,f])=>`<button class="${k==='arena'?'arena-side-btn':''}" data-home-action="${k}">${img(A+f)}</button>`).join('')}</aside>

  <section class="thm-battle" aria-label="PvE">
   <div class="battle-title"><span>⚔ PvE</span><b class="battle-stage-label">БОЙ С БОТОМ</b><small class="battle-sub">Следующий противник</small></div>
   <div class="fighter hero"><div class="fighter-name"><b class="hero-name">Герой</b><span class="hero-hp">100/100</span></div><img class="hero-img" src="assets/skins/battle-hero-real.webp" alt="Герой"><div class="follower-chip">🐯 <b>Последователь</b></div></div>
   <div class="battle-vs">VS</div>
   <div class="fighter enemy"><div class="fighter-name"><b class="enemy-name">Лесной разбойник</b><span class="enemy-hp">180/180</span></div><img class="enemy-img" src="assets/skins/battle-enemy-real.webp" alt="Противник"></div>
   <div class="battle-badge">PvE</div>
   <div class="battle-effects" id="thmBattleEffects"></div>
   <div class="battle-status" id="thmBattleStatus">Готов к бою</div>
   <div class="battle-result" id="thmBattleResult" hidden></div>
  </section>

  <section class="thm-combat">
    <div class="hp-row">
      <button class="big-orb attack" id="thmAttack" aria-label="Атака">⚔<small>АТАКА</small></button>
      <div class="hp-center"><div class="hp-bar hero-bar"><span class="unit-fill"></span><b>100/100</b></div><div class="hp-caption"><b class="hero-name">Герой</b><span>Ход <b id="turnNo">0</b></span><b class="enemy-name">Лесной разбойник</b></div></div>
      <button class="big-orb skill" id="thmSkill" aria-label="Умение">✦<small>УМЕНИЕ</small></button>
    </div>
    <div class="enemy-hp-row"><div class="hp-bar enemy-bar"><span class="unit-fill"></span><b class="enemy-hp">180/180</b></div></div>
    <div class="gear-row">${[1,2,3,4,5,6].map(i=>`<button data-home-action="gear-${i}">${img(A+`gear-${i}.png`,`Экипировка ${i}`)}</button>`).join('')}</div>
    <div class="consumables-row"><div class="potions">${['🧪','🧪','🧪','🧪'].map((x,i)=>`<button class="hud-slot potion-slot" data-home-action="potion${i+1}"><span>${x}</span></button>`).join('')}</div><div class="locks">${[1,2,3].map(i=>`<button class="hud-slot lock-slot" data-home-action="locked${i}"><span>🔒</span></button>`).join('')}</div></div>
    <div class="combat-controls">
      <button class="small-control stones" data-home-action="stones">${img(A+'stones.png','Боевые камни')}<b class="stone-count">0</b></button>
      <button class="small-control text-control" data-home-action="speed"><b>x2</b></button>
      <button class="small-control text-control" data-home-action="auto"><b>AUTO</b></button>
      <button class="small-control text-control" data-home-action="honor"><b>☀</b></button>
      <button class="small-control text-control" data-home-action="quest"><b>!</b></button>
    </div>
    <div class="main-quest"><div><b>Пройти основную главу</b><strong class="quest-chapter">1-1</strong><small>Победа откроет следующего противника</small></div><span>🪙 <b>1000</b></span><em>0/1</em></div>
  </section>

  <nav class="thm-bottom" aria-label="Нижняя навигация">${bottom.map(([k,f,label])=>{
    const action=k==='battle'?`data-home-action="battle"`:`data-screen="${k}"`;
    return `<button class="${k==='battle'?'active':''}" ${action}><img class="nav-icon" src="${A+f}" alt=""><span class="nav-label">${label}</span></button>`;
  }).join('')}</nav>
 </div>`;
 bind();paint();
}
function bind(){
 $('#thmAttack')?.addEventListener('click',()=>window.PvEBattle?.attack?.());
 $('#thmSkill')?.addEventListener('click',()=>window.PvEBattle?.skill?.('power'));
}
function paint(){
 const r=$('#home'),s=state();if(!r)return;
 const ch=n(s.currentChapter??s.pve?.chapter,1),st=n(s.chapterStage??s.pve?.stage,1),prog=n(s.chapterProgress??s.pve?.progress,0);
 r.querySelector('.dynamic').textContent=`Глава ${ch} · Северные земли ${ch}-${st}`;
 r.querySelector('.thm-name').textContent=s.profile?.displayName||'Игрок';
 r.querySelector('.thm-level').textContent=n(s.level,1);
 r.querySelector('.thm-vip').textContent=n(s.profile?.vip,0);
 const vals={coins:n(s.coins),gems:n(s.gems),redgems:n(s.redGems),energy:`${n(s.energy,100)}/${n(s.maxEnergy,100)}`};
 for(const [k,v] of Object.entries(vals)){const el=r.querySelector(`[data-home-value="${k}"]`);if(el)el.textContent=v}
 const sc=r.querySelector('.stone-count');if(sc)sc.textContent=Math.max(0,n(s.battleStones)+n(s.battleStonesBonus));
 r.querySelector('[data-home-action="auto"]')?.classList.toggle('active',!!s.auto);
 r.querySelector('[data-home-action="speed"]')?.classList.toggle('active',n(s.battleSpeed??s.speed,1)===2);
 r.querySelector('.quest-chapter').textContent=`${ch}-${st}`;
 const ps=[...r.querySelectorAll('.thm-progress i')];ps.forEach((el,i)=>{el.classList.toggle('done',prog>=i*25);el.classList.toggle('current',st===i+1&&prog<100)});
}
function init(){render();window.addEventListener('territory:state-changed',paint);window.addEventListener('territory:telegram-authenticated',paint);window.addEventListener('territory:telegram-synced',paint);window.TerritoryHomeModular={render,refresh:paint};window.HomeRebuild={render,refresh:paint,startRunner:()=>window.PvEBattle?.startCurrent?.(),openBoss:()=>window.PvEFlow?.openBoss?.()};}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
