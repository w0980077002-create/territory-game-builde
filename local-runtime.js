(function(){
'use strict';
function ready(){
 const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
 const show=id=>{id=({market:'shop',casino:'games',districts:'quests'}[id]||id||'home');$$('.screen').forEach(x=>{x.classList.toggle('active',x.id===id);x.setAttribute('aria-hidden',x.id!==id)});document.body.dataset.screen=id;window.dispatchEvent(new CustomEvent('territory:screen',{detail:id}));if(id==='inventory')window.TerritoryStore?.saveNow?.();};
 window.showScreen=show;window.TerritoryUI={show};
 const toggleAuto=()=>{const s=window.TerritoryStore?.state||{};s.auto=!s.auto;window.TerritoryStore?.saveNow?.('home-auto');window.dispatchEvent(new CustomEvent('territory:state-changed',{detail:{source:'home-auto'}}));window.dispatchEvent(new CustomEvent('territory:home-auto',{detail:{enabled:s.auto}}));};
 const toggleSpeed=()=>{const s=window.TerritoryStore?.state||{};const cur=Number(s.battleSpeed??s.speed)||1;const next=cur===2?1:2;s.battleSpeed=next;s.speed=next;window.TerritoryStore?.saveNow?.('home-speed');window.dispatchEvent(new CustomEvent('territory:state-changed',{detail:{source:'home-speed',speed:next}}));window.dispatchEvent(new CustomEvent('territory:home-speed',{detail:{speed:next}}));};
 document.addEventListener('click',e=>{
  const back=e.target.closest('[data-back]');if(back){e.preventDefault();show('home');return}
  const b=e.target.closest('[data-screen]');if(b){e.preventDefault();const target=b.dataset.screen;if(target==='battle'){show('home');setTimeout(()=>window.PvEBattle?.startCurrent?.(),0);return}show(target);return}
  const a=e.target.closest('[data-home-action]');if(!a)return;const k=a.dataset.homeAction;
  const map={home:'home',inventory:'inventory',hero:'hero',shop:'shop',forge:'inventory',trials:'quests',capture:'map',boss:'map',quests:'quests',games:'games',clan:'clan',daily:'quests',events:'quests',invite:'clan',sea:'world',map:'map'};
  if(k==='arena'){window.ArenaGame?.open?.();return}
  if(k==='battle'){show('home');setTimeout(()=>window.PvEBattle?.startCurrent?.(),0);return}
  if(k==='chapter'||k==='map'){show('map');return}
  if(k==='speed'){toggleSpeed();return}
  if(k==='auto'){toggleAuto();return}
  if(/^gear/.test(k)){show('hero');return}
  if(/^potion/.test(k)){show('shop');return}
  if(/^locked/.test(k)){info('🔒 Ячейка закрыта','Этот слот откроется по мере развития героя.');return}
  if(k==='stones'){info('🪨 Боевые камни','Текущее количество: '+Math.max(0,(+(window.TerritoryStore?.state?.battleStones)||0)+(+(window.TerritoryStore?.state?.battleStonesBonus)||0)));return}
  if(k==='profile'||k==='coins'||k==='gems'||k==='redgems'||k==='energy'||k==='trophy'||k==='mail'||k==='settings'||k==='honor'||k==='quest'||k==='blessing'){info(k);return}
  if(map[k])show(map[k]);
 });
 function info(k){const s=window.TerritoryStore?.state||{},labels={stones:'Боевые камни',coins:'Монеты',gems:'Алмазы',redgems:'Красные самоцветы',energy:'Энергия',trophy:'ТОП 100 / Трофеи',mail:'Почта',settings:'Настройки',honor:'Честь',quest:'Задания',blessing:'Благословение',profile:'Профиль'};let body=k==='profile'?'<h2>👤 '+(s.profile?.displayName||'Игрок')+'</h2><p>Уровень: '+(s.level||1)+'</p><p>VIP: '+(s.profile?.vip||0)+'</p>':'<h2>'+labels[k]+'</h2><p>Текущее значение: '+(k==='stones'?Math.max(0,(+s.battleStones||0)+(+s.battleStonesBonus||0)):k==='coins'?s.coins:k==='gems'?s.gems:k==='redgems'?s.redGems:k==='energy'?s.energy:'Раздел готов.')+'</p>';if($('#modalBody'))$('#modalBody').innerHTML=body;if($('#modal'))$('#modal').classList.add('show')}
 $('#modalClose')?.addEventListener('click',()=>$('#modal').classList.remove('show'));
 $('#mapStart')?.addEventListener('click',()=>{show('home');setTimeout(()=>window.PvEBattle?.startCurrent?.(),0)});$('#mapBoss')?.addEventListener('click',()=>{show('home');setTimeout(()=>window.PvEFlow?.openBoss?.(),0)});$('#storyOpen')?.addEventListener('click',()=>show('quests'));
 window.addEventListener('territory:state-changed',()=>{const s=window.TerritoryStore?.state;if(!s)return;document.querySelectorAll('#roadChapter').forEach(ch=>ch.textContent='ГЛАВА '+s.currentChapter);const p=$('#stageProgress');if(p)p.textContent=(s.chapterProgress||0)+'%';});
 show(document.body.dataset.screen||'home');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
