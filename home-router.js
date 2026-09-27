/* Territory Game — HOME input bridge 10061
   Bootstrapped from app.js so the baked HOME artwork remains clickable even
   when home-router.js is not listed by the current HTML. */
if(!window.__TerritoryHomeRouter10061){
  window.__TerritoryHomeRouter10061=true;
  (function(){
    'use strict';
    const S=()=>window.TerritoryStore?.state||{};
    let busyUntil=0;
    const zones=[
      ['profile',0,0,27.5,8],['coins',27.5,0,18,7],['gems',45.5,0,18,7],['redgems',63.5,0,16,7],['trophy',79.5,0,6.5,7],['messages',86,0,7,7],['settings',93,0,7,7],
      ['energy',30,4.5,28,5],['chapter',30,9,41,6],
      ['events',0,9,14,8],['daily',0,16.5,14,8],['leftQuests',0,24,14,8],['friends',0,31.5,14,8],['sea',0,39,14,8],
      ['shop',87,9,13,8],['forge',87,16.2,13,8],['challenges',87,23.4,13,8],['streets',87,30.6,13,8],['arena',87,38,13,8],
      ['gear0',18,64,10.6,12],['gear1',28.8,64,10.6,12],['gear2',39.6,64,10.6,12],['gear3',50.4,64,10.6,12],['gear4',61.2,64,10.6,12],['gear5',72,64,10.6,12],['gear6',82.8,64,10.6,12],
      ['elixir0',0,76,14.2,8],['elixir1',14.5,76,14.2,8],['elixir2',29,76,14.2,8],['elixir3',43.5,76,14.2,8],
      ['inventory',14.28,91,14.28,9],['hero',28.56,91,14.28,9],['battle',42.84,90,14.32,10],['bottomQuests',57.16,91,14.28,9],['games',71.44,91,14.28,9],['clan',85.72,91,14.28,9],['home',0,91,14.28,9]
    ];
    function home(){const h=document.querySelector('#home');return !!h&&(h.classList.contains('active')||document.body.dataset.screen==='home')}
    function point(e){const p=e.touches?.[0]||e.changedTouches?.[0]||e;const w=Math.max(1,innerWidth),h=Math.max(1,innerHeight);return{x:(Number(p.clientX)||0)/w*100,y:(Number(p.clientY)||0)/h*100}}
    function hit(x,y){for(const z of zones)if(x>=z[1]&&x<=z[1]+z[3]&&y>=z[2]&&y<=z[2]+z[4])return z[0];return null}
    function show(id){if(typeof window.showScreen==='function')window.showScreen(id)}
    function loadCss(id,href){if(document.getElementById(id))return;const l=document.createElement('link');l.id=id;l.rel='stylesheet';l.href=href+'?v=10061';document.head.appendChild(l)}
    function loadJs(id,src){return new Promise(r=>{if(document.getElementById(id)||document.querySelector('script[src^="'+src+'?"]'))return r();const s=document.createElement('script');s.id=id;s.src=src+'?v=10061';s.onload=()=>r();s.onerror=()=>r();document.body.appendChild(s)})}
    function arena(){
      if(!document.getElementById('arenaModal')){const m=document.createElement('div');m.id='arenaModal';m.className='arena-modal';m.setAttribute('aria-hidden','true');m.innerHTML='<div class="arena-sheet"><header class="arena-modal-head"><h2>⚔️ АРЕНА</h2><button type="button" class="arena-close" id="arenaClose">×</button></header><main id="arenaModalBody"></main></div>';document.body.appendChild(m);m.querySelector('#arenaClose').onclick=()=>window.ArenaGame?.close?.()||m.classList.remove('show')}
      loadCss('arenaCss10061','arena.css');if(window.ArenaGame?.open)return window.ArenaGame.open();return loadJs('arenaJs10061','arena.js').then(()=>window.ArenaGame?.open?.())
    }
    function pve(){loadCss('pveFlowCss10061','pve-flow.css');loadCss('pveBattleCss10061','pve-battle.css');return loadJs('pveFlowJs10061','pve-flow.js').then(()=>loadJs('pveBattleJs10061','pve-battle.js'))}
    function route(k){
      if(k==='arena')return arena();
      if(k==='battle')return pve().then(()=>window.PvEFlow?.startRunner?.());
      if(k==='chapter')return pve().then(()=>window.PvEFlow?.open?.());
      if(k==='inventory')return show('inventory'); if(k==='hero'||k==='profile')return show('hero');
      if(k==='bottomQuests'||k==='leftQuests'||['events','daily','friends','sea','challenges','streets'].includes(k))return show(k==='bottomQuests'||k==='leftQuests'?'quests':'districts');
      if(k==='games')return show('games'); if(k==='clan')return show('clan'); if(k==='shop')return show('shop');
      if(k==='forge')return window.ForgeV2?.open?.()||show('shop');
      if(k.startsWith('gear')){S().selectedEquipmentSlot=Math.max(0,Math.min(6,Number(k.slice(4))||0));window.TerritoryStore?.saveNow?.('home-gear');return show('hero')}
      if(k.startsWith('elixir')){const ids=['elixir_hp','elixir_energy','elixir_attack','elixir_guard'];if(window.CombatItems?.use)try{return window.CombatItems.use(ids[Number(k.slice(6))])}catch(_){}return show('shop')}
      if(k==='coins'||k==='gems'||k==='redgems'||k==='trophy'||k==='messages'||k==='settings'||k==='energy')return show('hero');
    }
    function handle(e){if(!home())return;const p=point(e),k=hit(p.x,p.y);if(!k||performance.now()<busyUntil)return;busyUntil=performance.now()+650;if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();route(k)}
    window.addEventListener('touchend',handle,{capture:true,passive:false});window.addEventListener('pointerup',handle,{capture:true,passive:false});window.addEventListener('click',handle,{capture:true,passive:false});
    window.addEventListener('territory:screen',()=>{busyUntil=0});window.addEventListener('territory:render',()=>{busyUntil=0});
  })();
}

