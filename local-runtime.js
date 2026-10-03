(function(){'use strict';
function ready(){
 const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
 const show=id=>{id=({market:'shop',casino:'games',districts:'quests'}[id]||id||'home');$$('.screen').forEach(x=>{x.classList.toggle('active',x.id===id);x.setAttribute('aria-hidden',x.id!==id)});document.body.dataset.screen=id;window.dispatchEvent(new CustomEvent('territory:screen',{detail:id}));};
 window.showScreen=window.showScreen||show;
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-screen]'); if(b){e.preventDefault();show(b.dataset.screen);return;}
  const a=e.target.closest('[data-home-action]'); if(!a)return; const k=a.dataset.homeAction;
  const map={home:'home',inventory:'inventory',hero:'hero',shop:'shop',forge:'inventory',trials:'quests',capture:'map',arena:'home',quests:'quests',games:'games',clan:'clan',daily:'shop',events:'quests',invite:'clan',sea:'map',leftQuests:'quests',bottomQuests:'quests'};
  if(k==='battle'||k==='chapter'||k==='speed'||k==='auto'){battle(k);return}
  if(k==='arena'){arena();return}
  if(/^gear/.test(k)){show('hero');return}
  if(/^potion/.test(k)){show('shop');return}
  if(k==='profile'||k==='coins'||k==='gems'||k==='redgems'||k==='energy'||k==='trophy'||k==='mail'||k==='settings'||k==='honor'||k==='quest'||k==='blessing'){info(k);return}
  if(map[k])show(map[k]);
 });
 function info(k){const s=window.TerritoryStore?.state||{};const labels={coins:'Монеты',gems:'Алмазы',redgems:'Красные самоцветы',energy:'Энергия',trophy:'Достижения',mail:'Почта',settings:'Настройки',honor:'Честь',quest:'Задания',blessing:'Благословение',profile:'Профиль'};let body='';if(k==='profile')body='<h2>👤 '+(s.profile?.displayName||'Игрок')+'</h2><p>Уровень: '+(s.level||1)+'</p><p>VIP: '+(s.profile?.vip||0)+'</p>';else body='<h2>'+labels[k]+'</h2><p>Текущее значение: '+(k==='coins'?s.coins:k==='gems'?s.gems:k==='redgems'?s.redGems:k==='energy'?s.energy:'Раздел готов.')+'</p>';$(' #modalBody'.trim()).innerHTML=body;$('#modal').classList.add('show');}
 function battle(){const s=window.TerritoryStore?.state;if(!s)return;const cost=1;if(Number(s.battleStones||0)<cost){info('trophy');return}if(Number(s.energy||0)<=0){info('energy');return}s.battleStones-=cost;s.energy=Math.max(0,s.energy-1);s.pve=s.pve||{wins:0,bossDefeated:0};s.pve.wins++;s.chapterProgress=Math.min(100,Number(s.chapterProgress||0)+25);s.pve.progress=s.chapterProgress;s.chapterStage=s.chapterProgress>=100?4:Number(s.chapterStage||1);if(s.chapterProgress>=100)s.chapterBossUnlocked=true;s.coins=Number(s.coins||0)+50;s.xp=Number(s.xp||0)+20;window.TerritoryStore.saveNow?.('local-battle');open('<h2>⚔️ Победа</h2><p>Бой завершён.</p><p>Боевые камни: '+s.battleStones+'</p><p>Энергия: '+s.energy+'</p><p>Прогресс главы: '+s.chapterProgress+'%</p><button class="gold-btn" id="battleAgain">Следующий бой</button>');$('#battleAgain').onclick=()=>{close();battle()};}
 function open(html){$('#modalBody').innerHTML=html;$('#modal').classList.add('show')}function close(){$('#modal').classList.remove('show')}
 function arena(){const m=$('#arenaModal');m.setAttribute('aria-hidden','false');if(window.ArenaGame?.open){window.ArenaGame.open();return}if(!window.__arenaLoading){window.__arenaLoading=1;const s=document.createElement('script');s.src='arena.js';s.onload=()=>window.ArenaGame?.open?.();document.body.appendChild(s)}}
 $('#modalClose')?.addEventListener('click',close);$('#mapStart')?.addEventListener('click',()=>battle());$('#mapBoss')?.addEventListener('click',()=>boss());$('#arenaClose')?.addEventListener('click',()=>$('#arenaModal').setAttribute('aria-hidden','true'));
 function boss(){const s=window.TerritoryStore?.state;if(!s)return;if(!s.chapterBossUnlocked){open('<h2>☠️ Босс закрыт</h2><p>Сначала заверши 4 обычных боя.</p>');return}s.chapterBossUnlocked=false;s.chapterBossDefeated=true;s.pve.bossDefeated++;s.coins+=250;s.gems+=3;window.TerritoryStore.saveNow?.('local-boss');open('<h2>🏆 Босс побеждён</h2><p>Награда: 250 монет и 3 алмаза.</p>')}
 show(document.body.dataset.screen||'home');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
