
(function(){
'use strict';if(window.TerritoryHomeModular)return;
const $=s=>document.querySelector(s),n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const state=()=>window.TerritoryStore?.state||{},auth=()=>window.TerritoryTelegramAuth;
const L=['events','daily','quests','invite','sea'],R=['shop','forge','trials','capture','arena'];
function render(){const h=$('#home');if(!h)return;h.classList.add('territory-home-modular');
h.innerHTML=`<div class="thm-stage"><div class="thm-bg"></div><div class="thm-center"></div>
<header class="thm-header"><button class="thm-profile-btn" data-home-action="hero"><img src="assets/ui/profile.png"></button>
<div class="thm-resources"><button class="thm-res-btn" data-home-action="coins"><img src="assets/ui/coins.png"></button><button class="thm-res-btn" data-home-action="gems"><img src="assets/ui/gems.png"></button><button class="thm-res-btn" data-home-action="redgems"><img src="assets/ui/redgems.png"></button><button class="thm-res-btn" data-home-action="energy"><img src="assets/ui/energy-top.png"></button></div>
<div class="thm-actions"><button class="thm-act-btn" data-home-action="trophy"><img src="assets/ui/trophy.png"></button><button class="thm-act-btn" data-home-action="mail"><img src="assets/ui/mail.png"></button><button class="thm-act-btn" data-home-action="settings"><img src="assets/ui/settings.png"></button></div></header>
<button class="thm-chapter" data-home-action="chapter"><img src="assets/ui/chapter.png"><span class="dynamic"></span></button>
<aside class="thm-side thm-left">${L.map((x,i)=>`<button class="thm-side-btn" data-home-action="${x}"><img src="assets/ui/left-${i+1}.png"></button>`).join('')}</aside>
<aside class="thm-side thm-right">${R.map((x,i)=>`<button class="thm-side-btn" data-home-action="${x}"><img src="assets/ui/right-${i+1}.png"></button>`).join('')}</aside>
<section class="thm-combat-ui"><div class="thm-meter thm-hp"><img src="assets/ui/hp.png"></div><div class="thm-meter thm-xp"><img src="assets/ui/xp.png"></div><div class="thm-meter thm-energy"><img src="assets/ui/energy.png"></div>
<div class="thm-gear">${[1,2,3,4,5,6].map(i=>`<button data-home-action="gear${i}"><img src="assets/ui/gear-${i}.png"></button>`).join('')}</div>
<div class="thm-potions">${[1,2,3,4].map(i=>`<button data-home-action="potion${i}"><img src="assets/ui/potion-${i}.png"></button>`).join('')}</div>
<div class="thm-locks">${[1,2,3].map(i=>`<button data-home-action="locked${i}"><img src="assets/ui/locked-${i}.png"></button>`).join('')}</div>
<div class="thm-controls"><button data-home-action="speed"><img src="assets/ui/speed-x2.png"></button><button data-home-action="auto"><img src="assets/ui/auto-battle.png"></button></div>
<div class="thm-meta"><button data-home-action="honor"><img src="assets/ui/honor.png"></button><button data-home-action="quest"><img src="assets/ui/quest.png"></button><button data-home-action="blessing"><img src="assets/ui/blessing.png"></button></div></section>
<nav class="thm-bottom">${['home','inventory','hero','battle','quests','games','clan'].map((x,i)=>`<button class="thm-bottom-btn" data-screen="${x}"><img src="assets/ui/bottom-${i+1}.png"></button>`).join('')}</nav></div>`;paint()}
function paint(){const r=$('#home'),s=state(),a=auth();if(!r)return;const ch=n(s.currentChapter??s.pve?.chapter,1),st=n(s.chapterStage??s.pve?.stage,1);const d=r.querySelector('.dynamic');if(d)d.textContent='Глава '+ch+' • Северные земли '+ch+'-'+st}
function init(){render();window.addEventListener('territory:state-changed',paint);window.addEventListener('territory:telegram-authenticated',paint);window.TerritoryHomeModular={render,refresh:paint};window.HomeRebuild={render,refresh:paint,startRunner:()=>window.PvEFlow?.startRunner?.(),openBoss:()=>window.PvEFlow?.openBoss?.()}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init()
})();
