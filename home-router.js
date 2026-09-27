/* Territory Game — HOME INPUT ROUTER 10062
   Robust mobile fallback for the baked HOME artwork.
   Never leaves the user on a blank screen when a legacy destination is absent.
*/
(function(){
  'use strict';
  const S=()=>window.TerritoryStore?.state||{};
  let busyUntil=0;

  function isHome(){ return !!document.querySelector('#home.screen.active'); }
  function coords(e){
    const p=e.touches?.[0]||e.changedTouches?.[0]||e;
    const w=Math.max(1,window.innerWidth||document.documentElement.clientWidth||1);
    const h=Math.max(1,window.innerHeight||document.documentElement.clientHeight||1);
    return {x:(Number(p.clientX)||0)/w*100,y:(Number(p.clientY)||0)/h*100};
  }

  const Z=[
    ['profile',0,0,27.5,8],['coins',27.5,0,18,7],['gems',45.5,0,18,7],['redgems',63.5,0,16,7],
    ['trophy',79.5,0,6.5,7],['messages',86,0,7,7],['settings',93,0,7,7],
    ['energy',30,4.5,28,5],['chapter',30,9,41,6],
    ['events',0,9,14,8],['daily',0,16.5,14,8],['leftQuests',0,24,14,8],['friends',0,31.5,14,8],['sea',0,39,14,8],
    ['shop',87,9,13,8],['forge',87,16.2,13,8],['challenges',87,23.4,13,8],['streets',87,30.6,13,8],['arena',87,38,13,8],
    ['gear0',18,64,10.6,12],['gear1',28.8,64,10.6,12],['gear2',39.6,64,10.6,12],['gear3',50.4,64,10.6,12],
    ['gear4',61.2,64,10.6,12],['gear5',72,64,10.6,12],['gear6',82.8,64,10.6,12],
    ['elixir0',0,76,14.2,8],['elixir1',14.5,76,14.2,8],['elixir2',29,76,14.2,8],['elixir3',43.5,76,14.2,8],
    ['inventory',14.28,91,14.28,9],['hero',28.56,91,14.28,9],['battle',42.84,90,14.32,10],
    ['bottomQuests',57.16,91,14.28,9],['games',71.44,91,14.28,9],['clan',85.72,91,14.28,9],['home',0,91,14.28,9]
  ];
  function hit(x,y){for(const z of Z)if(x>=z[1]&&x<=z[1]+z[3]&&y>=z[2]&&y<=z[2]+z[4])return z[0];return null;}

  function show(id){
    const el=document.getElementById(id);
    if(el){ window.showScreen?.(id); return true; }
    return false;
  }

  function panel(title,body){
    let m=document.getElementById('homeRouterPanel10062');
    if(!m){
      m=document.createElement('div');m.id='homeRouterPanel10062';
      m.style.cssText='position:fixed;inset:0;z-index:130000;display:none;background:rgba(3,9,14,.78);padding:18px;box-sizing:border-box;align-items:flex-end;justify-content:center;';
      m.innerHTML='<div id="homeRouterPanelCard10062" style="width:min(620px,100%);max-height:82vh;overflow:auto;background:#07131c;color:#fff;border:1px solid rgba(232,199,107,.45);border-radius:18px;padding:16px;box-sizing:border-box;box-shadow:0 16px 50px #000b"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h2 id="homeRouterPanelTitle10062" style="margin:0;color:#e8c76b;font-size:18px"></h2><button id="homeRouterPanelClose10062" type="button" style="border:1px solid #765c27;border-radius:9px;background:#0d1b25;color:#e8c76b;padding:7px 10px;font-weight:900">×</button></div><div id="homeRouterPanelBody10062" style="margin-top:12px;font-size:12px;line-height:1.45"></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click',e=>{if(e.target===m||e.target.id==='homeRouterPanelClose10062')m.style.display='none';});
    }
    document.getElementById('homeRouterPanelTitle10062').textContent=title;
    document.getElementById('homeRouterPanelBody10062').innerHTML=body;
    m.style.display='flex';
  }

  function loadArena(){
    if(!document.getElementById('arenaModal')){
      const m=document.createElement('div');m.id='arenaModal';m.className='arena-modal';m.setAttribute('aria-hidden','true');
      m.innerHTML='<div class="arena-sheet"><header class="arena-modal-head"><h2>⚔️ АРЕНА</h2><button type="button" class="arena-close" id="arenaClose">×</button></header><main id="arenaModalBody"></main></div>';
      document.body.appendChild(m);
    }
    if(!document.getElementById('arenaCss10062')){const l=document.createElement('link');l.id='arenaCss10062';l.rel='stylesheet';l.href='arena.css?v=10062';document.head.appendChild(l);}
    if(window.ArenaGame?.open)return window.ArenaGame.open();
    const old=document.querySelector('script[data-arena-input-10062]');if(old)return;
    const s=document.createElement('script');s.dataset.arenaInput10062='1';s.src='arena.js?v=10062';s.onload=()=>window.ArenaGame?.open?.();s.onerror=()=>panel('⚔️ Арена','Не удалось загрузить модуль Arena. Проверь, что <b>arena.js</b> и <b>arena.css</b> лежат рядом с игрой.');document.body.appendChild(s);
  }

  function loadPvE(){
    const addCss=(id,href)=>{if(document.getElementById(id))return;const l=document.createElement('link');l.id=id;l.rel='stylesheet';l.href=href+'?v=10062';document.head.appendChild(l)};
    const addJs=(id,src)=>new Promise(resolve=>{const old=document.getElementById(id);if(old)return resolve();const s=document.createElement('script');s.id=id;s.src=src+'?v=10062';s.onload=()=>resolve();s.onerror=()=>resolve();document.body.appendChild(s)});
    addCss('pveCss10062','pve-flow.css');addCss('pveBattleCss10062','pve-battle.css');
    return addJs('pveFlow10062','pve-flow.js').then(()=>addJs('pveBattle10062','pve-battle.js'));
  }
  function battle(){return loadPvE().then(()=>window.PvEFlow?.startRunner?.()||panel('⚔️ Бой','Модуль PvE не ответил. Проверь <b>pve-flow.js</b> и <b>pve-battle.js</b>.'));}
  function chapter(){return loadPvE().then(()=>window.PvEFlow?.open?.()||battle());}

  function gear(i){const st=S();st.selectedEquipmentSlot=Math.max(0,Math.min(6,Number(i)||0));window.TerritoryStore?.saveNow?.('home-gear-select-10062');show('hero');}
  function elixir(i){const ids=['elixir_hp','elixir_energy','elixir_attack','elixir_guard'];const fn=window.CombatItems?.use;if(typeof fn==='function'&&ids[i]){try{fn.call(window.CombatItems,ids[i]);return;}catch(_){} }show('shop');}

  function districts(k){
    if(show('quests'))return;
    const names={events:'События',daily:'Ежедневные задания',leftQuests:'Квесты',friends:'Друзья',sea:'Морской поход',challenges:'Испытания',streets:'Улицы'};
    panel('📍 '+(names[k]||'Раздел'),'<p>Этот раздел уже предусмотрен в HOME, но отдельный экран сейчас не подключён.</p><p style="opacity:.65">Я оставил кнопку рабочей, чтобы она не превращалась в пустой экран.</p><button id="routerGoQuests10062" style="margin-top:8px;border:1px solid #c59e4d;border-radius:9px;background:#9c711f;color:#171107;padding:9px 12px;font-weight:900">Открыть Квесты</button>');
    document.getElementById('routerGoQuests10062')?.addEventListener('click',()=>{document.getElementById('homeRouterPanel10062').style.display='none';show('quests');});
  }

  function route(k){
    if(k==='battle')return battle();
    if(k==='arena')return loadArena();
    if(k==='chapter')return chapter();
    if(k==='inventory')return show('inventory')||panel('🎒 Инвентарь','Экран инвентаря не найден в текущем HTML.');
    if(k==='hero'||k==='profile')return show('hero')||panel('🧙 Герой','Экран героя не найден в текущем HTML.');
    if(k==='games')return show('games')||panel('🎲 Игры','Экран игр не найден в текущем HTML.');
    if(k==='clan')return show('clan')||panel('🚩 Клан','Экран клана не найден в текущем HTML.');
    if(k==='shop')return show('shop')||panel('🛒 Магазин','Экран магазина не найден в текущем HTML.');
    if(k==='forge'){
      if(typeof window.ForgeV2?.open==='function')return window.ForgeV2.open();
      return show('shop')||panel('🔨 Кузница','Модуль кузницы не подключён.');
    }
    if(k.startsWith('gear'))return gear(Number(k.slice(4)));
    if(k.startsWith('elixir'))return elixir(Number(k.slice(6)));
    if(['events','daily','leftQuests','friends','sea','challenges','streets','bottomQuests'].includes(k))return districts(k==='bottomQuests'?'leftQuests':k);
    if(k==='trophy')return show('roadmap')||show('map')||panel('🏆 Достижения','Открой Квесты — там доступны ежедневные и недельные цели.');
    if(k==='messages')return panel('💬 Сообщения','Здесь будет центр сообщений и событий игрока. Пока кнопка уже не является пустой.');
    if(k==='settings')return panel('⚙️ Настройки','Настройки интерфейса и игры подготовлены для отдельного экрана.');
    if(k==='coins')return panel('🪙 Монеты',`<p>Баланс: <b>${Math.floor(Number(S().coins)||0).toLocaleString('ru-RU')} 🪙</b></p><p>Монеты используются для покупок и улучшений.</p>`);
    if(k==='gems')return panel('💎 Кристаллы',`<p>Баланс: <b>${Math.floor(Number(S().gems)||0)} 💎</b></p>`);
    if(k==='redgems')return panel('🔴 Красные кристаллы',`<p>Баланс: <b>${Math.floor(Number(S().redGems)||0)} 🔴</b></p>`);
    if(k==='energy')return panel('⚡ Энергия',`<p>Баланс: <b>${Math.floor(Number(S().energy)||0)} / ${Math.floor(Number(S().maxEnergy)||0)}</b></p>`);
  }

  function handle(e){
    if(!isHome())return;
    const {x,y}=coords(e),k=hit(x,y);if(!k)return;
    if(performance.now()<busyUntil)return;
    busyUntil=performance.now()+650;
    if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();route(k);
  }
  window.addEventListener('touchend',handle,{capture:true,passive:false});
  window.addEventListener('pointerup',handle,{capture:true,passive:false});
  window.addEventListener('click',handle,{capture:true,passive:false});
  window.addEventListener('territory:screen',()=>{busyUntil=0;});
  window.addEventListener('territory:render',()=>{busyUntil=0;});
})();
