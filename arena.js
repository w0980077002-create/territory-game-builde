/* Territory Game — Arena 1×1 isolated tactical engine
   IMPORTANT: Arena state is ONLY arenaBattle. PvE runner never uses it. */
(function(){
  'use strict';
  const S=()=>window.TerritoryStore?.state||{};
  const save=()=>window.TerritoryStore?.saveNow?.('arena');
  const $=(q,r=document)=>r.querySelector(q);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const zones=[['head','Голова'],['chest','Грудь'],['waist','Пояс'],['legs','Ноги']];
  const styles={
    crit:{name:'Крит',attack:5,defense:0,crit:.14,dodge:.03,maxHp:0},
    tank:{name:'Танк',attack:1,defense:8,crit:0,dodge:0,maxHp:35},
    dodge:{name:'Уворот',attack:2,defense:1,crit:.04,dodge:.14,maxHp:0},
    resilience:{name:'Стойкость',attack:2,defense:4,crit:.02,dodge:0,maxHp:18}
  };
  const gear=[['weapon','⚔️','Оружие'],['helmet','🪖','Шлем'],['armor','🛡️','Броня'],['belt','🎗️','Пояс'],['boots','🥾','Сапоги'],['ring','💍','Кольцо'],['amulet','🔮','Амулет']];
  const consumables=[['elixir_hp','🧪','HP'],['elixir_energy','🔵','Энергия'],['elixir_attack','🔥','Атака'],['elixir_guard','🛡️','Защита'],['adrenaline','⚡','Адреналин'],['speed_scroll','📜','Ускорение'],['anti_speed_scroll','🐌','Антиускорение']];
  let arenaBattle=null;

  function root(){const modal=$('#arenaModal'),body=$('#arenaModalBody');return modal&&body?{modal,body}:null;}
  function me(){const s=S();return{id:'player',name:String(s.profile?.displayName||s.name||'Игрок'),level:Math.max(1,Number(s.level)||1),rating:Number(s.arena?.rating)||1000,wins:Number(s.arena?.wins)||0,losses:Number(s.arena?.losses)||0,class:'duelist'};}
  function roster(){const l=me().level,n=['Liam','Jack','Ethan','Oliver','Mason','Ryan','Валера','Людмила'];return n.map((name,i)=>({id:'arena-bot-'+i,name,level:Math.max(1,l+i%3-1),class:['duelist','berserker','tank','assassin'][i%4],rating:820+(7-i)*42,wins:18+i*7,losses:6+i*3,isBot:true}));}
  function profile(id){return id==='player'?me():roster().find(x=>x.id===id);}
  function playerFollower(){
    const id=S().followers?.activeFollower;
    const f=id&&window.Followers?.get?.(id),cfg=id&&window.Followers?.CATALOG?.[id],stats=id&&window.Followers?.getStats?.(id);
    return f?.owned&&cfg&&stats?{id,data:f,cfg,stats}:null;
  }
  function botFollower(op){
    const byClass={berserker:'liabro',tank:'teralel',assassin:'mort',duelist:'stone_face'};
    const id=byClass[op.class]||'stone_face';
    const cfg=window.Followers?.CATALOG?.[id],stats=window.Followers?.getStats?.(id);
    return cfg&&stats?{id,cfg,stats,level:Math.min(100,Math.max(1,op.level))}:null;
  }
  function derived(){
    return window.TerritoryStore?.getDerivedStats?.()||{};
  }
  function fighter(p,side){
    const d=derived(),s=S();
    const key=side==='player'?String(s.arena?.loadout||'crit'):(p.class==='tank'?'tank':p.class==='assassin'?'dodge':p.class==='berserker'?'crit':'resilience');
    const m=styles[key]||styles.crit;
    const max=side==='player'?Math.max(1,Number(d.maxHp||s.maxHp)||120)+m.maxHp:100+p.level*12+m.maxHp;
    return{id:side,name:p.name,level:p.level,hp:max,maxHp:max,attack:(Number(d.strength)||8)+m.attack,defense:(Number(d.defense)||3)+m.defense,crit:.06+m.crit,dodge:Math.max(0,.03+m.dodge),style:key};
  }
  function open(){openHub();}
  function openHub(){
    stopTimer();arenaBattle=null;const r=root();if(!r)return;
    r.modal.classList.remove('arena-in-battle');r.body.innerHTML=`<div class="arena-hub"><div class="arena-hero"><div><small>СОРЕВНОВАТЕЛЬНАЯ АРЕНА</small><h1>⚔️ АРЕНА</h1><p>Тактический бой 1×1. PvE-путь сюда не попадает.</p></div><div class="arena-rating"><span>РЕЙТИНГ</span><b>${me().rating}</b><small>${me().wins} побед · ${me().losses} поражений</small></div></div><button class="arena-start" data-arena-find>⚔️ НАЙТИ СОПЕРНИКА</button><div class="arena-section-title"><b>🏆 СОПЕРНИКИ</b></div><div class="arena-top">${roster().map((p,i)=>`<button class="arena-top-row" data-profile-id="${p.id}"><strong>${i+1}</strong><span class="arena-avatar">⚔️</span><span class="arena-player-copy"><b>${esc(p.name)}</b><small>Lv.${p.level} · ${esc(p.class)}</small></span><span class="arena-player-rating">${p.rating}</span></button>`).join('')}</div></div>`;
    r.modal.classList.add('show');r.modal.setAttribute('aria-hidden','false');
  }
  function openProfile(id){
    const p=profile(id),r=root();if(!p||!r)return;
    r.body.innerHTML=`<div class="arena-profile"><button class="arena-back" data-arena-hub>‹ АРЕНА</button><div class="profile-hero"><div class="profile-big-avatar">⚔️</div><div><small>ИГРОК</small><h1>${esc(p.name)}</h1><p>Уровень ${p.level}</p></div></div><div class="profile-stats"><div><small>РЕЙТИНГ</small><b>${p.rating}</b></div><div><small>ПОБЕДЫ</small><b>${p.wins}</b></div><div><small>ПОРАЖЕНИЯ</small><b>${p.losses}</b></div><div><small>КЛАСС</small><b>${esc(p.class)}</b></div></div><button class="arena-start" data-profile-fight="${p.id}">⚔️ ВЫЗВАТЬ НА БОЙ</button></div>`;
  }
  function start(op){
    const r=root();if(!r||!op)return;
    const pf=playerFollower(),of=botFollower(op);
    arenaBattle={mode:'1v1',player:fighter(me(),'player'),bot:fighter(op,'bot'),opponent:op,playerFollowerId:pf?.id||null,opponentFollowerId:of?.id||null,turn:1,playerDefense:[],attackZone:null,botDefense:[],botAttackZone:null,busy:false,auto:false,ended:false,playerReadyAt:0,botReadyAt:0,baseCooldown:15000,timer:null,logs:[`⚔️ ${me().name} против ${op.name}`],chat:[]};
    prepareBotPlan();render();startTimer();
  }
  function fighterMarkup(u,side){
    const fallback=side==='player'?'🪓':'🛡️';
    return `<div class="combat-fighter ${side}" data-fighter="${side}"><div class="fighter-name">${esc(u.name)} <small>Lv.${u.level}</small></div><div class="fighter-hp-top"><span class="hp-fill" style="width:${Math.round(u.hp/u.maxHp*100)}%"></span><b>${Math.ceil(u.hp)}/${Math.ceil(u.maxHp)} ❤️</b></div><div class="viking-fallback" aria-hidden="true">${fallback}</div><div class="fighter-shadow"></div></div>`;
  }
  function render(){
    const r=root();if(!r||!arenaBattle)return;
    const b=arenaBattle,p=b.player,o=b.bot;
    r.modal.classList.add('arena-in-battle');
    r.body.innerHTML=`<div class="arena-battle" data-battle-root>
      <div class="battle-header"><button class="arena-back" data-arena-hub>‹</button><b>ХОД ${b.turn}</b><span>Рейтинг ${me().rating}</span></div>
      <div class="battle-stage">
        <div class="fighter-wrap player-wrap" data-follower-id="${esc(b.playerFollowerId||'')}">${fighterMarkup(p,'player')}</div>
        <div class="fighter-wrap bot-wrap" data-bot-follower-id="${esc(b.opponentFollowerId||'')}">${fighterMarkup(o,'bot')}</div>
        <div class="battle-zone-controls defense-controls"><div class="side-zone-title">ЗАЩИТА · 2</div>${zones.map(z=>`<button type="button" data-defense-zone="${z[0]}">${z[1]}</button>`).join('')}</div>
        <div class="battle-zone-controls attack-controls"><div class="side-zone-title">АТАКА · 1</div>${zones.map(z=>`<button type="button" data-attack-zone="${z[0]}">${z[1]}</button>`).join('')}</div>
        <div class="combat-effects" data-effects></div>
      </div>
      <div class="battle-command-row"><span class="tactic-mini">2 🛡️ + 1 ⚔️</span><button type="button" class="command-auto" data-autobattle-toggle><span>↻</span><small>${b.auto?'АВТО ✓':'АВТО'}</small></button><button type="button" class="command-hit" data-execute-attack disabled>⚔️ УДАР</button><button type="button" class="command-surrender" data-surrender>Сдаться</button><button type="button" class="command-exit" data-exit-battle>Выйти</button><strong data-cooldown>Готов</strong></div>
      ${combatBar()}<div class="battle-chat-wrap"><button type="button" class="battle-chat-toggle" data-chat-toggle>💬 История и чат <span>⌄</span></button><div class="battle-chat collapsed" data-chat>${chatHtml()}</div></div>${bottomNav()}
    </div>`;
    bindBattleControls();sync();
    window.FollowerArena?.decorate?.();
  }
  function combatBar(){
    const unlocked=Math.max(0,Math.min(6,Number(S().arena?.combatSlotsUnlocked??(3+Math.floor((Math.max(1,Number(S().level)||1)-1)/5)))));
    return `<div class="combat-loadout-strip"><div class="combat-section-head"><b>СНАРЯЖЕНИЕ</b></div><div class="combat-item-row">${gear.map(g=>`<button type="button" class="combat-item-slot" data-gear="${g[0]}"><strong>${g[1]}</strong><span>${g[2]}</span></button>`).join('')}</div><div class="combat-section-head"><b>ЭЛИКСИРЫ И БОЕВЫЕ ПРЕДМЕТЫ</b></div><div class="combat-item-row">${consumables.map((g,i)=>{const locked=i>unlocked;return `<button type="button" class="combat-item-slot ${locked?'locked':''}" data-combat-slot="${g[0]}" ${locked?'disabled':''}><strong>${locked?'🔒':g[1]}</strong><span>${g[2]}</span><small>${locked?'Закрыт':'×'+Number(S().consumables?.[g[0]]||0)}</small></button>`}).join('')}</div></div>`;
  }
  function chatHtml(){return [...arenaBattle.logs.map(x=>`<div class="chat-line system">${esc(x)}</div>`),...arenaBattle.chat.map(x=>`<div class="chat-line"><b>${esc(x.name)}:</b> ${esc(x.text)}</div>`)].join('')+`<div class="chat-compose"><input data-chat-input maxlength="180" placeholder="Написать сообщение…"><button type="button" data-chat-send>➤</button></div>`;}
  function bottomNav(){return `<nav class="arena-bottom-nav">${[['home','🏰','Город'],['inventory','🎒','Инвентарь'],['hero','🪖','Герой'],['battle','⚔️','Бой'],['quests','📜','Квесты'],['game','🎲','Игры'],['clan','🚩','Клан']].map(x=>`<button type="button" data-arena-nav="${x[0]}"><span>${x[1]}</span><b>${x[2]}</b></button>`).join('')}</nav>`;}
  function cooldownLeft(){return Math.max(0,(arenaBattle?.playerReadyAt||0)-Date.now());}
  function botCooldownLeft(){return Math.max(0,(arenaBattle?.botReadyAt||0)-Date.now());}
  function formatClock(ms){const s=Math.max(0,Math.ceil(ms/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
  function startTimer(){stopTimer();if(!arenaBattle)return;arenaBattle.timer=setInterval(()=>{if(!arenaBattle)return;const now=Date.now();if(!arenaBattle.ended&&arenaBattle.botReadyAt&&now>=arenaBattle.botReadyAt){arenaBattle.botReadyAt=0;botTurn();return;}if(!arenaBattle.ended&&arenaBattle.auto&&cooldownLeft()<=0)autoStep();sync();},250);}
  function stopTimer(){if(arenaBattle?.timer){clearInterval(arenaBattle.timer);arenaBattle.timer=null;}}
  function bindBattleControls(){
    const r=root();if(!r?.body)return;
    if(r.body.dataset.controlsBound==='1')return;
    r.body.dataset.controlsBound='1';

    r.body.addEventListener('click',e=>{
      const t=e.target.closest('button');
      if(!t||!r.body.contains(t))return;

      if(t.dataset.defenseZone){selectDefense(t.dataset.defenseZone);}
      else if(t.dataset.attackZone){selectAttack(t.dataset.attackZone);}
      else if(t.dataset.executeAttack){executeAttack();}
      else if(t.dataset.autobattleToggle){toggleAuto();}
      else if(t.dataset.combatSlot){useSlot(t.dataset.combatSlot);}
      else if(t.dataset.gear){chooseGear(t.dataset.gear);}
      else if(t.dataset.surrender){finish(false);}
      else if(t.dataset.exitBattle){exitBattle();}
      else if(t.dataset.chatToggle){toggleChat(t);}
      else if(t.dataset.chatSend){sendChat();}
      else if(t.dataset.arenaNav){navigateArena(t.dataset.arenaNav);}
    });
  }

  function selectDefense(z){
    if(!arenaBattle||arenaBattle.ended)return;
    const i=arenaBattle.playerDefense.indexOf(z);
    if(i>=0)arenaBattle.playerDefense.splice(i,1);
    else if(arenaBattle.playerDefense.length<2)arenaBattle.playerDefense.push(z);
    sync();
  }
  function selectAttack(z){if(!arenaBattle||arenaBattle.ended)return;arenaBattle.attackZone=z;sync();}
  function sync(){
    const r=root();if(!r||!arenaBattle)return;
    r.body.querySelectorAll('[data-defense-zone]').forEach(x=>{x.classList.toggle('selected',arenaBattle.playerDefense.includes(x.dataset.defenseZone));x.disabled=arenaBattle.ended;});
    r.body.querySelectorAll('[data-attack-zone]').forEach(x=>{x.classList.toggle('selected',x.dataset.attackZone===arenaBattle.attackZone);x.disabled=arenaBattle.ended;});
    const ready=arenaBattle.playerDefense.length===2&&!!arenaBattle.attackZone&&!arenaBattle.busy&&!arenaBattle.ended&&cooldownLeft()<=0;
    const hit=r.body.querySelector('[data-execute-attack]');if(hit)hit.disabled=!ready;
    const cd=r.body.querySelector('[data-cooldown]');if(cd)cd.textContent=cooldownLeft()>0?`Удар ${formatClock(cooldownLeft())}`:botCooldownLeft()>0?`Бот ${formatClock(botCooldownLeft())}`:'Готов';
    const auto=r.body.querySelector('[data-autobattle-toggle]');auto?.classList.toggle('active',arenaBattle.auto);
  }
  function effect(type,side,text){const layer=$('[data-effects]');if(!layer)return;const e=document.createElement('div');e.className=`combat-fx fx-${type} fx-${side}`;e.textContent=text||({crit:'КРИТ',block:'БЛОК',hit:'ПОПАДАНИЕ',miss:'ПРОМАХ',heal:'ЛЕЧЕНИЕ'}[type]||type);layer.appendChild(e);setTimeout(()=>e.remove(),850);}
  function animate(side,cls){const e=$(`[data-fighter="${side}"]`);if(!e)return;e.classList.remove(cls);void e.offsetWidth;e.classList.add(cls);setTimeout(()=>e.classList.remove(cls),800);}
  function executeAttack(){
    if(!arenaBattle||arenaBattle.busy||arenaBattle.ended||cooldownLeft()>0||arenaBattle.playerDefense.length!==2||!arenaBattle.attackZone)return;
    arenaBattle.busy=true;const p=arenaBattle.player,b=arenaBattle.bot;const follower=playerFollower();
    let dmg=Math.max(1,p.attack-b.defense);
    if(follower?.id==='liabro'&&Math.random()<Math.min(.35,Number(follower.stats.critChance||0)/100)){dmg=Math.floor(dmg*1.8);arenaBattle.logs.push(`💥 ${follower.cfg.name}: критический удар`);effect('crit','bot');}
    else if(Math.random()<b.dodge){arenaBattle.logs.push('💨 Соперник увернулся');effect('miss','bot','ПРОМАХ');animate('bot','dodge');}
    else if(battleDefenseHas(arenaBattle.attackZone)){dmg=Math.max(1,Math.floor(dmg*.25));arenaBattle.logs.push(`🛡️ Блок: ${dmg}`);effect('block','bot',`БЛОК -${dmg}`);animate('bot','block');}
    else if(Math.random()<p.crit){dmg=Math.floor(dmg*1.8);arenaBattle.logs.push(`💥 Критический удар: ${dmg}`);effect('crit','bot',`КРИТИЧЕСКИЙ УДАР -${dmg}`);animate('bot','hurt');}
    else{arenaBattle.logs.push(`⚔️ Ты нанёс ${dmg} урона`);effect('hit','bot',`УДАР В ${zones.find(z=>z[0]===arenaBattle.attackZone)?.[1]?.toUpperCase()||'ЦЕЛЬ'} -${dmg}`);animate('bot','hurt');}
    b.hp=Math.max(0,b.hp-dmg);arenaBattle.playerReadyAt=Date.now()+arenaBattle.baseCooldown;arenaBattle.botReadyAt=Date.now()+7000+Math.floor(Math.random()*5000);arenaBattle.playerDefense=[];arenaBattle.attackZone=null;
    if(b.hp<=0){setTimeout(()=>finish(true),650);return;}
    setTimeout(()=>{if(!arenaBattle||arenaBattle.ended)return;arenaBattle.busy=false;render();},650);
  }
  function battleDefenseHas(z){return Boolean(z)&&arenaBattle.botDefense.includes(z);}
  function prepareBotPlan(){
    if(!arenaBattle||arenaBattle.ended)return;
    arenaBattle.botDefense=[];
    while(arenaBattle.botDefense.length<2){const z=zones[Math.floor(Math.random()*zones.length)][0];if(!arenaBattle.botDefense.includes(z))arenaBattle.botDefense.push(z);}
    arenaBattle.botAttackZone=zones[Math.floor(Math.random()*zones.length)][0];
  }
  function botTurn(){
    if(!arenaBattle||arenaBattle.ended||arenaBattle.busy)return;
    const p=arenaBattle.player,b=arenaBattle.bot;
    const atk=arenaBattle.botAttackZone;let dmg=Math.max(1,b.attack-p.defense);
    const f=playerFollower();
    if(f?.id==='teralel')dmg=Math.max(1,Math.floor(dmg*(1-Math.min(.35,Number(f.stats.defense||0)/200))));
    if(f?.id==='mort'&&Math.random()<Math.min(.4,Number(f.stats.dodge||0)/100)){arenaBattle.logs.push('💨 Морт: уклонение');effect('miss','player');animate('player','dodge');}
    else if(arenaBattle.playerDefense.includes(atk)){dmg=Math.max(1,Math.floor(dmg*.25));p.hp=Math.max(0,p.hp-dmg);arenaBattle.logs.push(`🛡️ Ты заблокировал: ${dmg}`);effect('block','player');animate('player','block');}
    else if(Math.random()<b.crit){dmg=Math.floor(dmg*1.8);p.hp=Math.max(0,p.hp-dmg);arenaBattle.logs.push(`💥 Соперник: ${dmg}`);effect('crit','player');animate('player','hurt');}
    else{p.hp=Math.max(0,p.hp-dmg);arenaBattle.logs.push(`⚔️ Соперник нанёс ${dmg}`);effect('hit','player');animate('player','hurt');}
    if(f?.id==='king_cows'&&p.hp<p.maxHp){const heal=Math.max(1,Math.round(Number(f.stats.heal||0)));p.hp=Math.min(p.maxHp,p.hp+heal);arenaBattle.logs.push(`❤️ Король Коров: +${heal} HP`);effect('heal','player');}
    if(p.hp<=0){setTimeout(()=>finish(false),650);return;}
    arenaBattle.turn++;arenaBattle.busy=true;arenaBattle.botReadyAt=0;prepareBotPlan();
    setTimeout(()=>{if(!arenaBattle||arenaBattle.ended)return;arenaBattle.busy=false;render();},650);
  }
  function autoStep(){if(!arenaBattle||arenaBattle.busy||arenaBattle.ended||cooldownLeft()>0||!arenaBattle.auto)return;arenaBattle.playerDefense=[];while(arenaBattle.playerDefense.length<2){const z=zones[Math.floor(Math.random()*zones.length)][0];if(!arenaBattle.playerDefense.includes(z))arenaBattle.playerDefense.push(z);}arenaBattle.attackZone=zones[Math.floor(Math.random()*zones.length)][0];sync();setTimeout(()=>{if(arenaBattle?.auto)executeAttack();},180);}
  function toggleAuto(){if(!arenaBattle||arenaBattle.ended)return;arenaBattle.auto=!arenaBattle.auto;if(arenaBattle.auto&&cooldownLeft()<=0)autoStep();sync();}
  function finish(win){
    if(!arenaBattle||arenaBattle.ended)return;
    arenaBattle.ended=true;stopTimer();
    const s=S();s.hp=Math.max(0,Math.min(s.maxHp,arenaBattle.player.hp));s.arena.battles++;
    if(win){s.arena.wins++;s.arena.rating+=25;s.coins+=50;s.exp+=20;arenaBattle.logs.push('🏆 Победа!');}
    else{s.arena.losses++;s.arena.rating=Math.max(0,s.arena.rating-20);arenaBattle.logs.push('☠️ Поражение.');}
    save();render();sync();
  }
  function useSlot(slot){
    if(!arenaBattle||arenaBattle.ended)return;
    const count=Number(S().consumables?.[slot]||0);if(count<=0)return;
    S().consumables[slot]=count-1;
    if(slot==='elixir_hp')arenaBattle.player.hp=Math.min(arenaBattle.player.maxHp,arenaBattle.player.hp+30);
    else if(slot==='elixir_energy')S().energy=Math.min(S().maxEnergy,S().energy+20);
    else if(slot==='elixir_attack')arenaBattle.player.attack+=5;
    else if(slot==='elixir_guard')arenaBattle.player.defense+=5;
    else if(slot==='adrenaline')arenaBattle.playerReadyAt=Date.now()+7500;
    else if(slot==='speed_scroll')arenaBattle.playerReadyAt=Math.max(Date.now(),arenaBattle.playerReadyAt-10000);
    else if(slot==='anti_speed_scroll')arenaBattle.playerReadyAt+=10000;
    save();render();
  }
  function chooseGear(slot){if(!arenaBattle||arenaBattle.ended)return;const keys=Object.keys(styles),i=keys.indexOf(arenaBattle.player.style),next=keys[(i+1)%keys.length];arenaBattle.player.style=next;arenaBattle.logs.push(`👕 ${slot}: ${styles[next].name}`);render();}
  function toggleChat(t){const box=root()?.body.querySelector('[data-chat]');if(!box)return;const open=box.classList.toggle('collapsed')===false;t.setAttribute('aria-expanded',String(open));}
  function sendChat(){const i=$('[data-chat-input]');if(!i?.value.trim()||!arenaBattle)return;arenaBattle.chat.push({name:me().name,text:i.value.trim()});i.value='';render();root()?.body.querySelector('[data-chat]')?.classList.remove('collapsed');}
  function navigateArena(id){root()?.modal.classList.remove('show');const map={home:'home',inventory:'inventory',hero:'hero',game:'casino',quests:'districts',clan:'districts'};window.showScreen?.(map[id]||'home');}
  function exitBattle(){stopTimer();arenaBattle=null;openHub();}
  document.addEventListener('click',e=>{
    const t=e.target.closest?.('button');if(!t)return;
    if(t.id==='arenaClose'){root()?.modal.classList.remove('show');stopTimer();arenaBattle=null;return;}
    if(t.dataset.arenaFind){start(roster()[Math.floor(Math.random()*roster().length)]);return;}
    if(t.dataset.profileId){openProfile(t.dataset.profileId);return;}
    if(t.dataset.arenaHub){openHub();return;}
    if(t.dataset.profileFight){start(profile(t.dataset.profileFight));return;}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&document.activeElement?.matches('[data-chat-input]'))sendChat();});
  window.ArenaGame={open,openHub,startBattle:start,close:()=>{stopTimer();arenaBattle=null;root()?.modal.classList.remove('show');}};
})();
