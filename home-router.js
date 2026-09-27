/* Territory Game — HOME INPUT ROUTER 10063
   Mobile-safe HOME hit testing.
   Goals: one tap = one route, no overlapping hot-zones, no accidental drag activation,
   and never steal clicks from real DOM controls.
*/
(function(){
  'use strict';
  const S=()=>window.TerritoryStore?.state||{};
  let armed=null, lastRouteAt=0;

  function isHome(){return !!document.querySelector('#home.screen.active');}
  function viewport(){return {w:Math.max(1,window.innerWidth||document.documentElement.clientWidth||1),h:Math.max(1,window.innerHeight||document.documentElement.clientHeight||1)};}
  function point(e){
    const p=e.changedTouches?.[0]||e.touches?.[0]||e;
    const v=viewport();
    return {px:Number(p.clientX)||0,py:Number(p.clientY)||0,x:(Number(p.clientX)||0)/v.w*100,y:(Number(p.clientY)||0)/v.h*100};
  }
  function realControlAt(p){
    const el=document.elementFromPoint(p.px,p.py);
    if(!el)return false;
    return !!el.closest('button,a,input,select,textarea,[role="button"],[data-no-home-router]');
  }

  /* Zones are intentionally non-overlapping. Header wins only in its own band;
     energy/chapter start below it. Side buttons never overlap the center. */
  const Z=[
    // header
    ['profile',0,0,27.5,5.6],['coins',27.5,0,18,5.6],['gems',45.5,0,18,5.6],['redgems',63.5,0,16,5.6],['trophy',79.5,0,6.5,5.6],['messages',86,0,7,5.6],['settings',93,0,7,5.6],
    // center
    ['energy',30,5.7,28,4.7],['chapter',30,10.5,41,5.7],
    // left rail
    ['events',0,10.5,14,7.5],['daily',0,18.2,14,7.5],['leftQuests',0,25.9,14,7.5],['friends',0,33.6,14,7.5],['sea',0,41.3,14,7.5],
    // right rail
    ['shop',87,10.5,13,7.5],['forge',87,18.2,13,7.5],['challenges',87,25.9,13,7.5],['streets',87,33.6,13,7.5],['arena',87,41.3,13,7.5],
    // equipment strip
    ['gear0',18,64,10.6,11],['gear1',28.8,64,10.6,11],['gear2',39.6,64,10.6,11],['gear3',50.4,64,10.6,11],['gear4',61.2,64,10.6,11],['gear5',72,64,10.6,11],['gear6',82.8,64,10.6,11],
    // quick items
    ['elixir0',0,76,14.2,8],['elixir1',14.5,76,14.2,8],['elixir2',29,76,14.2,8],['elixir3',43.5,76,14.2,8],
    // bottom nav
    ['home',0,91,14.28,9],['inventory',14.28,91,14.28,9],['hero',28.56,91,14.28,9],['battle',42.84,90,14.32,10],['bottomQuests',57.16,91,14.28,9],['games',71.44,91,14.28,9],['clan',85.72,91,14.28,9]
  ];
  function hit(x,y){for(const z of Z)if(x>=z[1]&&x<z[1]+z[3]&&y>=z[2]&&y<z[2]+z[4])return z[0];return null;}

  function show(id){
    const el=document.getElementById(id);
    if(el){window.showScreen?.(id);return true;}
    return false;
  }
  function panel(title,body){
    let m=document.getElementById('homeRouterPanel10063');
    if(!m){
      m=document.createElement('div');m.id='homeRouterPanel10063';
      m.style.cssText='position:fixed;inset:0;z-index:130000;display:none;background:rgba(3,9,14,.78);padding:18px;box-sizing:border-box;align-items:flex-end;justify-content:center;';
      m.innerHTML='<div style="width:min(620px,100%);max-height:82vh;overflow:auto;background:#07131c;color:#fff;border:1px solid rgba(232,199,107,.45);border-radius:18px;padding:16px;box-sizing:border-box"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h2 id="hr63title" style="margin:0;color:#e8c76b;font-size:18px"></h2><button type="button" id="hr63close" style="border:1px solid #765c27;border-radius:9px;background:#0d1b25;color:#e8c76b;padding:7px 10px;font-weight:900">×</button></div><div id="hr63body" style="margin-top:12px;font-size:12px;line-height:1.45"></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click',e=>{if(e.target===m||e.target.id==='hr63close')m.style.display='none';});
    }
    document.getElementById('hr63title').textContent=title;
    document.getElementById('hr63body').innerHTML=body;
    m.style.display='flex';
  }

  function loadArena(){
    if(!document.getElementById('arenaModal')){
      const m=document.createElement('div');m.id='arenaModal';m.className='arena-modal';m.setAttribute('aria-hidden','true');
      m.innerHTML='<div class="arena-sheet"><header class="arena-modal-head"><h2>⚔️ АРЕНА</h2><button type="button" class="arena-close" id="arenaClose">×</button></header><main id="arenaModalBody"></main></div>';
      document.body.appendChild(m);
    }
    if(!document.getElementById('arenaCss10063')){const l=document.createElement('link');l.id='arenaCss10063';l.rel='stylesheet';l.href='arena.css?v=10063';document.head.appendChild(l);}
    if(window.ArenaGame?.open)return window.ArenaGame.open();
    if(document.querySelector('script[data-arena-input-10063]'))return;
    const s=document.createElement('script');s.dataset.arenaInput10063='1';s.src='arena.js?v=10063';s.onload=()=>window.ArenaGame?.open?.();s.onerror=()=>panel('⚔️ Арена','Не удалось загрузить модуль Arena.');document.body.appendChild(s);
  }
  function loadPvE(){
    const addCss=(id,href)=>{if(document.getElementById(id))return;const l=document.createElement('link');l.id=id;l.rel='stylesheet';l.href=href+'?v=10063';document.head.appendChild(l)};
    const addJs=(id,src)=>new Promise(resolve=>{const old=document.getElementById(id);if(old)return resolve();const s=document.createElement('script');s.id=id;s.src=src+'?v=10063';s.onload=resolve;s.onerror=resolve;document.body.appendChild(s)});
    addCss('pveCss10063','pve-flow.css');addCss('pveBattleCss10063','pve-battle.css');
    return addJs('pveFlow10063','pve-flow.js').then(()=>addJs('pveBattle10063','pve-battle.js'));
  }
  function battle(){return loadPvE().then(()=>window.PvEFlow?.startRunner?.()||panel('⚔️ Бой','Модуль PvE не ответил.'));}
  function chapter(){return loadPvE().then(()=>window.PvEFlow?.open?.()||battle());}
  function gear(i){const st=S();st.selectedEquipmentSlot=Math.max(0,Math.min(6,Number(i)||0));window.TerritoryStore?.saveNow?.('home-gear-select-10063');show('hero');}
  function elixir(i){const ids=['elixir_hp','elixir_energy','elixir_attack','elixir_guard'];const fn=window.CombatItems?.use;if(typeof fn==='function'&&ids[i]){try{fn.call(window.CombatItems,ids[i]);return;}catch(_){} }show('shop')||panel('🧪 Эликсир','Магазин предметов не подключён.');}
  function districts(k){
    if(show('quests'))return;
    const names={events:'События',daily:'Ежедневные задания',leftQuests:'Квесты',friends:'Друзья',sea:'Морской поход',challenges:'Испытания',streets:'Улицы'};
    panel('📍 '+(names[k]||'Раздел'),'<p>Отдельный экран этого раздела пока не подключён.</p><p style="opacity:.65">Кнопка не будет открывать чужой раздел.</p>');
  }
  function route(k){
    if(k==='battle')return battle(); if(k==='arena')return loadArena(); if(k==='chapter')return chapter();
    if(k==='inventory')return show('inventory')||panel('🎒 Инвентарь','Экран инвентаря не найден.');
    if(k==='hero'||k==='profile')return show('hero')||panel('🧙 Герой','Экран героя не найден.');
    if(k==='games')return show('games')||panel('🎲 Игры','Экран игр не найден.');
    if(k==='clan')return show('clan')||panel('🚩 Клан','Экран клана не найден.');
    if(k==='shop')return show('shop')||panel('🛒 Магазин','Экран магазина не найден.');
    if(k==='forge')return typeof window.ForgeV2?.open==='function'?window.ForgeV2.open():show('shop')||panel('🔨 Кузница','Модуль кузницы не подключён.');
    if(k.startsWith('gear'))return gear(Number(k.slice(4)));
    if(k.startsWith('elixir'))return elixir(Number(k.slice(6)));
    if(['events','daily','leftQuests','friends','sea','challenges','streets','bottomQuests'].includes(k))return districts(k==='bottomQuests'?'leftQuests':k);
    if(k==='trophy')return show('roadmap')||show('map')||panel('🏆 Достижения','Открой Квесты для целей и прогресса.');
    if(k==='messages')return panel('💬 Сообщения','Центр сообщений пока не подключён.');
    if(k==='settings')return panel('⚙️ Настройки','Экран настроек пока не подключён.');
    if(k==='coins')return panel('🪙 Монеты',`<p>Баланс: <b>${Math.floor(Number(S().coins)||0).toLocaleString('ru-RU')} 🪙</b></p>`);
    if(k==='gems')return panel('💎 Кристаллы',`<p>Баланс: <b>${Math.floor(Number(S().gems)||0)} 💎</b></p>`);
    if(k==='redgems')return panel('🔴 Красные кристаллы',`<p>Баланс: <b>${Math.floor(Number(S().redGems)||0)} 🔴</b></p>`);
    if(k==='energy')return panel('⚡ Энергия',`<p>Баланс: <b>${Math.floor(Number(S().energy)||0)} / ${Math.floor(Number(S().maxEnergy)||0)}</b></p>`);
  }

  function finishTap(p){
    if(!isHome()||!armed)return;
    const dx=p.px-armed.px,dy=p.py-armed.py;
    armed=null;
    if(Math.hypot(dx,dy)>14)return; // drag/scroll is not a click
    const k=hit(p.x,p.y);if(!k)return;
    if(realControlAt(p))return; // let a real DOM control handle itself
    const now=performance.now();if(now-lastRouteAt<500)return;lastRouteAt=now;
    route(k);
  }
  function down(e){if(!isHome())return;const p=point(e);if(realControlAt(p))return;armed=p;if(e.cancelable)e.preventDefault();}
  function up(e){if(!armed)return;const p=point(e);if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();finishTap(p);}
  function click(e){if(!isHome())return;const p=point(e);if(realControlAt(p))return;/* pointer/touch already handled this tap */if(performance.now()-lastRouteAt<700){if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();return;}finishTap(p);}

  window.addEventListener('pointerdown',down,{capture:true,passive:false});
  window.addEventListener('pointerup',up,{capture:true,passive:false});
  window.addEventListener('touchstart',down,{capture:true,passive:false});
  window.addEventListener('touchend',up,{capture:true,passive:false});
  window.addEventListener('click',click,{capture:true,passive:false});
  window.addEventListener('territory:screen',()=>{armed=null;lastRouteAt=0;});
  window.addEventListener('territory:render',()=>{armed=null;});
})();
