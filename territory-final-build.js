(function(){'use strict';
function boot(){
  const alias={market:'shop',casino:'games',districts:'quests'};
  const ids=['home','map','inventory','hero','quests','games','shop','clan'];
  function norm(id){return alias[id]||id||'home'}
  function isolate(id){id=norm(id);ids.forEach(x=>{const e=document.getElementById(x);if(e){e.classList.toggle('active',x===id);e.setAttribute('aria-hidden',x!==id)}});document.body.dataset.screen=id}
  function sync(){const id=norm(document.body.dataset.screen||'home');isolate(id);const home=document.getElementById('home');if(home){const img=home.querySelector('.home-reference-image,.territory-home-art');if(img)img.src=window.TERRITORY_ASSET_BASE+'home-master.png'} }
  window.TerritoryFinalBuild={sync,go:(id)=>{try{window.TerritoryNavigation?.go?.(norm(id))||window.showScreen?.(norm(id))}finally{setTimeout(sync,0)}}};
  sync();window.addEventListener('territory:screen',sync);window.addEventListener('hashchange',sync);window.addEventListener('pageshow',()=>setTimeout(sync,50));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
