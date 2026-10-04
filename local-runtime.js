(function(){
'use strict';
function ready(){
 const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
 const show=id=>{id=({market:'shop',casino:'games',districts:'quests'}[id]||id||'home');$$('.screen').forEach(x=>{x.classList.toggle('active',x.id===id);x.setAttribute('aria-hidden',x.id!==id)});document.body.dataset.screen=id;window.dispatchEvent(new CustomEvent('territory:screen',{detail:id}));if(id==='inventory')window.TerritoryStore?.saveNow?.();};
 window.showScreen=show;window.TerritoryUI={show};
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-screen]');if(b){e.preventDefault();show(b.dataset.screen);return}
  const a=e.target.closest('[data-home-action]');if(!a)return;const k=a.dataset.homeAction;
  const map={home:'home',inventory:'inventory',hero:'hero',shop:'shop',forge:'inventory',trials:'quests',capture:'map',boss:'map',quests:'quests',games:'games',clan:'clan',daily:'quests',events:'quests',invite:'clan',sea:'world'};
  if(k==='arena'){window.ArenaGame?.open?.();return}
  if(k==='battle'||k==='chapter'||k==='speed'||k==='auto'){show('map');window.PvEFlow?.startRunner?.();return}
  if(k==='boss'){show('map');window.PvEFlow?.openBoss?.();return}
  if(/^gear/.test(k)){show('hero');return}if(/^potion/.test(k)){show('shop');return}
  if(k==='stones'){info('stones');return}if(k==='profile'||k==='coins'||k==='gems'||k==='redgems'||k==='energy'||k==='trophy'||k==='mail'||k==='settings'||k==='honor'||k==='quest'||k==='blessing'){info(k);return}
  if(map[k])show(map[k]);
 });
 function info(k){const s=window.TerritoryStore?.state||{},labels={stones:'Боевые камни',coins:'Монеты',gems:'Алмазы',redgems:'Красные самоцветы',energy:'Энергия',trophy:'Достижения',mail:'Почта',settings:'Настройки',honor:'Честь',quest:'Задания',blessing:'Благословение',profile:'Профиль'};let body=k==='profile'?'<h2>👤 '+(s.profile?.displayName||'Игрок')+'</h2><p>Уровень: '+(s.level||1)+'</p><p>VIP: '+(s.profile?.vip||0)+'</p><p style="opacity:.65">ID и username доступны внутри профиля, а не в верхней панели.</p>':'<h2>'+labels[k]+'</h2><p>Текущее значение: '+(k==='stones'?Math.max(0,(+s.battleStones||0)+(+s.battleStonesBonus||0)):k==='coins'?s.coins:k==='gems'?s.gems:k==='redgems'?s.redGems:k==='energy'?s.energy:'Раздел готов.')+'</p>';$('#modalBody').innerHTML=body;$('#modal').classList.add('show')}
 $('#modalClose')?.addEventListener('click',()=>$('#modal').classList.remove('show'));
 $('#mapStart')?.addEventListener('click',()=>window.PvEFlow?.startRunner?.());$('#mapBoss')?.addEventListener('click',()=>window.PvEFlow?.openBoss?.());
 $('#storyOpen')?.addEventListener('click',()=>show('quests'));
 window.addEventListener('territory:state-changed',()=>{const s=window.TerritoryStore?.state;if(!s)return;const ch=$('#roadChapter');if(ch)ch.textContent='ГЛАВА '+s.currentChapter;const p=$('#stageProgress');if(p)p.textContent=s.chapterProgress+'%';});
 show(document.body.dataset.screen||'home');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
