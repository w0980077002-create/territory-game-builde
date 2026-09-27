/* Territory Game — PvE battle engine, Pass 08.
   Reference-driven flow, connected to the canonical TerritoryStore.
   No third-party assets are copied. */
(function(){
  'use strict';
  const S=()=>window.TerritoryStore?.state||{};
  const save=()=>window.TerritoryStore?.saveNow?.('pve-battle');
  let root=null, autoTimer=null, tickTimer=null, model=null, resultTimer=null;
  const CONSUMABLES=[
    ['elixir_hp','🧪','HP'],['elixir_energy','🔵','ЭН'],['elixir_attack','🔴','АТК'],['elixir_guard','🟡','ЗАЩ']
  ];

  const GEAR_ICONS=['🪓','🪖','🛡️','🎗️','🥾','💍','🔮'];
  const FOLLOWERS={
    liabro:{name:'Лиабро',icon:'🦅',effect:'crit'},
    teralel:{name:'Тералель',icon:'🛡️',effect:'guard'},
    'king-cow':{name:'Король-коров',icon:'🐮',effect:'heal'},
    mort:{name:'Морт',icon:'💀',effect:'dodge'},
    stone:{name:'Каменное Лицо',icon:'🗿',effect:'control'}
  };
  const ENEMIES=[
    {name:'Легендарный Морской Император',icon:'🧜‍♂️',hp:1100,damage:12},
    {name:'Страж Золотого Города',icon:'🗿',hp:1250,damage:14},
    {name:'Капитан Чёрного Флага',icon:'🏴‍☠️',hp:1400,damage:16},
    {name:'Хранитель Священных Врат',icon:'👹',hp:1600,damage:18}
  ];
  const BOSS={name:'Вождь Боевого Племени',icon:'👑',hp:2600,damage:26};

  function ensure(){
    const s=S();
    s.pve=s.pve||{chapter:s.currentChapter||1,stage:s.chapterStage||1,progress:s.chapterProgress||0,bossPending:false,bossActive:false,bossDefeated:0};
    s.pve.chapter=Math.max(1,Math.min(240,Number(s.pve.chapter||s.currentChapter)||1));
    s.pve.progress=Math.max(0,Math.min(100,Number(s.pve.progress)||0));
    s.pve.stage=Math.max(1,Math.min(4,Number(s.pve.stage)||Math.floor(s.pve.progress/25)+1));
    s.currentChapter=s.pve.chapter;s.chapterProgress=s.pve.progress;s.chapterStage=s.pve.stage;
    s.chapterBossUnlocked=!!s.pve.bossPending;
    return s;
  }

  function followerInfo(){
    const s=S(); const id=s.followers?.activeFollower ?? s.activeFollower;
    if(!id)return null;
    if(typeof id==='object') return {name:id.name||'Спутник',icon:id.icon||'🐺',effect:id.effect||'guard'};
    return FOLLOWERS[String(id)]||{name:String(id),icon:'🐺',effect:'guard'};
  }
  function equipment(){return Array.isArray(S().equipment)?S().equipment.slice(0,7):Array(7).fill(null)}
  function itemNum(item, keys){if(!item||typeof item!=='object')return 0;for(const k of keys){const v=Number(item[k]);if(Number.isFinite(v)&&v)return v}return 0}
  function equipmentBonus(){
 const eq=equipment();let strength=0,defense=0,agility=0,maxHp=0,critChance=0,damageReduction=0,bonusXp=0;const sets={};
 for(const item of eq){strength+=itemNum(item,['strength','attack','damage','atk']);defense+=itemNum(item,['defense','def','armor','guard']);agility+=itemNum(item,['agility','agi','speed']);maxHp+=itemNum(item,['maxHp','hp','health']);critChance+=Number(item?.critChance)||0;damageReduction+=Number(item?.damageReduction)||0;bonusXp+=Number(item?.bonusXp)||0;const sid=String(item?.setId||'').toLowerCase();if(sid)sets[sid]=(sets[sid]||0)+1}
 const bonus={strength:0,defense:0,agility:0,maxHp:0,critChance:0,damageReduction:0,bonusXp:0};
 const rules={tide:[[2,{agility:4}],[4,{strength:10}],[6,{bonusXp:8}]],gold:[[2,{defense:6}],[4,{maxHp:80}],[6,{damageReduction:8}]],blackflag:[[2,{strength:7}],[4,{agility:7}],[6,{critChance:8}]],sacred:[[2,{defense:8}],[4,{strength:12}],[6,{maxHp:120}]],warchief:[[2,{strength:15}],[4,{defense:15}],[6,{critChance:12}]]};
 Object.entries(sets).forEach(([id,count])=>(rules[id]||[]).forEach(([need,vals])=>{if(count>=need)Object.entries(vals).forEach(([k,v])=>bonus[k]+=v)}));
 return {strength:strength+bonus.strength,defense:defense+bonus.defense,agility:agility+bonus.agility,maxHp:maxHp+bonus.maxHp,critChance:critChance+bonus.critChance,damageReduction:damageReduction+bonus.damageReduction,bonusXp:bonusXp+bonus.bonusXp,sets};
}
  function gearLabel(item,i){
    if(!item)return GEAR_ICONS[i];
    if(typeof item==='string')return item.length<5?item:item.slice(0,4);
    return item.icon||item.emoji||GEAR_ICONS[i];
  }
  function derived(){
    const s=S(), d=window.TerritoryStore?.getDerivedStats?.()||{}, e=equipmentBonus();
    return {strength:(Number(d.strength)||125+(Number(s.level)||1)*2)+e.strength,defense:(Number(d.defense)||98+(Number(s.level)||1))+e.defense,agility:(Number(d.agility)||101+(Number(s.level)||1))+e.agility,maxHp:e.maxHp};
  }

  function ensureRoot(){
    if(root)return root;
    root=document.createElement('section');root.className='pve-battle';root.innerHTML=`
      <div class="pve-bg"></div><div class="pve-ground"></div>
      <div class="top">
        <div class="topline"><button class="close" id="pveBattleClose">✕</button><div class="resources"><span class="res hot" id="pvePower">🔥 0</span><span class="res" id="pveCoins">🪙 0</span><span class="res" id="pveGems">💎 0</span></div><button class="close" id="pveMenu">⌄</button></div>
        <div class="chapter" id="pveChapterTitle"></div><div class="stage-track" id="pveStageTrack"></div>
      </div>
      <div class="enemy">
        <div class="enemy-name" id="pveEnemyName"></div><div class="enemy-bar"><i class="enemy-fill" id="pveEnemyFill"></i></div><div class="enemy-hp" id="pveEnemyHp"></div><div class="boss-timer" id="pveBossTimer"></div>
        <div class="enemy-figure" id="pveEnemyFigure"><div class="fighter-shadow"></div><div class="fighter-visual enemy-visual" data-kind="enemy"><i class="fighter-aura"></i><i class="fighter-body"></i><i class="fighter-head"></i><i class="fighter-weapon"></i><i class="fighter-shield"></i><i class="fighter-hitmark"></i></div></div>
      </div>
      <div class="party">
        <div class="unit hero"><b class="badge">1P</b><div class="unit-figure" id="pveHeroFigure"><div class="fighter-shadow"></div><div class="fighter-visual hero-visual" data-kind="hero"><i class="fighter-aura"></i><i class="fighter-body"></i><i class="fighter-head"></i><i class="fighter-weapon"></i><i class="fighter-shield"></i><i class="fighter-hitmark"></i></div></div><span class="unit-hp"><i id="pveHeroMiniHp"></i></span></div>
        <div class="unit ally" id="pveAllyUnit"><b class="badge">2P</b><div class="unit-figure" id="pveAllyFigure"><div class="fighter-shadow"></div><div class="fighter-visual ally-visual" data-kind="ally"><i class="fighter-aura"></i><i class="fighter-body"></i><i class="fighter-head"></i><i class="fighter-weapon"></i><i class="fighter-shield"></i><i class="fighter-hitmark"></i></div></div><span class="unit-hp"><i id="pveAllyMiniHp"></i></span></div>
      </div>
      <div class="fx-layer" id="pveFx"></div><div class="hit" id="pveHit"></div><div class="mp-pop" id="pveMp"></div><div class="battle-result" id="pveResult"><div class="result-card"><div class="result-icon" id="pveResultIcon">⚔️</div><strong id="pveResultTitle"></strong><span id="pveResultText"></span></div></div>
      <div class="combat-log" id="pveCombatLog"></div>
      <div class="bottom">
        <div class="orb-row"><button class="orb red" id="pveAttack">⚔</button><div class="hpstrip"><i id="pveHpFill"></i><span class="hptext" id="pveHpText"></span></div><button class="orb blue" id="pveSkill">✦</button><button class="auto" id="pveAuto">AUTO</button></div>
        <div class="slots" id="pveSlots"></div>
        <div class="consumables" id="pveConsumables"></div>
        <div class="task" id="pveTask"></div>
        <div class="boss-skills"><div class="skills" id="pveBossSkills"><button class="skill" data-skill="power">🪓</button><button class="skill" data-skill="guard">🛡️</button><button class="skill" data-skill="fire">🔥</button><button class="skill" data-skill="burst">💥</button><button class="skill" data-skill="crown">👑</button></div></div>
        <div class="nav"><span>⚓ Порт</span><span>📜 Навыки</span><span id="pveNavCoins">🪙 0</span><span>🗺 Приключения</span><span>🛒 Магазин</span></div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector('#pveBattleClose').onclick=close;
    root.querySelector('#pveAttack').onclick=()=>attack('basic');
    root.querySelector('#pveSkill').onclick=()=>skill('power');
    root.querySelector('#pveAuto').onclick=()=>{if(!model||model.ended)return;model.auto=!model.auto;render();if(model.auto)queueAuto()};
    root.querySelector('#pveMenu').onclick=()=>{};
    root.querySelector('#pveBossSkills').addEventListener('click',e=>{const b=e.target.closest('[data-skill]');if(b)skill(b.dataset.skill)});
    return root;
  }

  function start(stage){
    const s=ensure(); if(s.pve.progress>=100)return false;
    clear();
    if((Number(s.battleStones)||0)<=0){return false;} s.battleStones=Math.max(0,(Number(s.battleStones)||0)-1); save();
    const index=Math.max(1,Math.min(4,Number(stage)||s.pve.stage));
    const baseEnemy=ENEMIES[index-1]; const chapter=Math.max(1,Number(s.currentChapter)||1); const scale=1+(chapter-1)*0.055; const enemy={...baseEnemy,hp:Math.round(baseEnemy.hp*scale),damage:Math.max(1,Math.round(baseEnemy.damage*(1+(chapter-1)*0.035)))}; const d=derived(); const follower=followerInfo();
    const maxHp=Math.max(1,(Number(s.maxHp)||100)+d.maxHp);
    model={boss:false,stage:index,enemy:{...enemy},enemyHp:enemy.hp,hp:Math.max(1,Number(s.hp)||maxHp),maxHp,mp:0,auto:true,damage:Math.max(20,Math.floor(d.strength/5)),turn:0,startedAt:Date.now(),skillCooldown:0,follower,logs:[],ended:false,attackLocked:false};
    ensureRoot().classList.add('show');root.classList.remove('boss');pushLog(`Этап ${index}: ${enemy.name}`);render();startTicker();queueAuto();return true;
  }
  function startBoss(){
    const s=ensure();if(!s.pve.bossPending)return false;
    clear();if((Number(s.battleStones)||0)<=0){return false;} s.battleStones=Math.max(0,(Number(s.battleStones)||0)-1);s.pve.bossActive=true;save();const d=derived(),follower=followerInfo();
    const maxHp=Math.max(1,(Number(s.maxHp)||100)+d.maxHp);
    model={boss:true,stage:4,enemy:{...boss},enemyHp:boss.hp,hp:Math.max(1,Number(s.hp)||maxHp),maxHp,mp:0,auto:false,damage:Math.max(24,Math.floor(d.strength/4)),turn:0,startedAt:Date.now(),skillCooldown:0,follower,logs:[],bossTime:20,ended:false,attackLocked:false};
    ensureRoot().classList.add('show','boss');pushLog('Босс: Вождь Боевого Племени');render();startTicker();return true;
  }
  function startTicker(){clearInterval(tickTimer);tickTimer=setInterval(()=>{if(!model)return; if(model.boss){model.bossTime=Math.max(0,20-Math.floor((Date.now()-model.startedAt)/1000));if(model.bossTime<=0){pushLog('Время босса истекло.');defeat();return}}if(model.skillCooldown>0)model.skillCooldown=Math.max(0,model.skillCooldown-250);render()},250)}
  function queueAuto(){if(!model||!model.auto)return;clearTimeout(autoTimer);autoTimer=setTimeout(()=>attack('basic'),850)}
  function attack(type){
    if(!model||model.ended||model.attackLocked)return;
    animate('hero','attack');
    spawnFx('slash', model.boss ? 'boss' : 'enemy');
    setTimeout(()=>{ if(model&&!model.ended) { animate('enemy','hit'); spawnFx('impact','enemy'); } },110);if(model.skillCooldown>0&&type!=='basic'){pushLog('Способность ещё не готова.');return render()}
    const d=derived();let dmg=model.damage+Math.floor(Math.random()*Math.max(5,Math.floor(d.agility/20)));
    if((model.follower?.effect==='crit'&&Math.random()<.22)||Math.random()<Math.min(.75,(Number(d.critChance)||0)/100)){dmg=Math.floor(dmg*1.7);spawnFx('crit','enemy')}
    if(model.follower&&model.turn%3===0){const allyDmg=6+Math.floor(d.agility/18);dmg+=allyDmg;animate('ally','attack');spawnFx('ally','enemy');pushLog(`${model.follower.name}: −${allyDmg} HP`)}
    if(type==='power'){dmg=Math.floor(dmg*1.8);model.mp=Math.min(100,model.mp+8);model.skillCooldown=2000;spawnFx('power','enemy')}else model.mp=Math.min(100,model.mp+12);
    model.enemyHp=Math.max(0,model.enemyHp-dmg);model.turn++;flash('hit',`${dmg}`);flash('mp',`MP +${type==='power'?8:12}`);pushLog(`${type==='power'?'Способность':'Атака'}: −${dmg} HP`);
    if(model.enemyHp<=0){victory();return}
    let incoming=model.enemy.damage+Math.floor(Math.random()*6);
    if(model.follower?.effect==='guard')incoming=Math.max(1,Math.floor(incoming*.78));
    if(model.incomingReduction)incoming=Math.max(1,Math.floor(incoming*(1-model.incomingReduction)));
    if(model.follower?.effect==='dodge'&&Math.random()<.18)incoming=0;
    if(model.follower?.effect==='heal'&&model.turn%3===0)model.hp=Math.min(model.maxHp,model.hp+Math.floor(model.maxHp*.08));
    model.hp=Math.max(0,model.hp-incoming);if(incoming){pushLog(`${model.enemy.name}: −${incoming} HP`);spawnFx('damage','hero')}else{pushLog('Уклонение спутника!');spawnFx('dodge','hero')}
    syncHp();
    if(model.hp<=0){defeat();return}
    if(model.boss)model.bossTime=Math.max(0,20-Math.floor((Date.now()-model.startedAt)/1000));render();queueAuto();
  }
  function skill(kind){
    if(!model||model.ended||model.attackLocked)return;
    if(kind!=='burst'&&model.skillCooldown>0){pushLog('Способность ещё не готова.');return render()}
    if(kind==='power')return attack('power');
    if(kind==='guard'){model.hp=Math.min(model.maxHp,model.hp+Math.floor(model.maxHp*.12));spawnFx('heal','hero');model.skillCooldown=2000;pushLog('Щит: восстановлено 12% HP');render();return}
    if(kind==='fire'){model.enemyHp=Math.max(0,model.enemyHp-Math.floor(model.damage*1.45));spawnFx('fire','enemy');model.skillCooldown=2000;flash('hit','ОГОНЬ!');pushLog('Огонь: сильный удар');if(model.enemyHp<=0)return victory();render();return}
    if(kind==='burst'){model.mp=Math.min(100,model.mp+25);spawnFx('burst','hero');model.damage+=4;pushLog('Разгон: урон усилен');render();return}
    if(kind==='crown'){model.hp=Math.min(model.maxHp,model.hp+Math.floor(model.maxHp*.2));spawnFx('crown','hero');model.skillCooldown=3000;pushLog('Корона: восстановлено 20% HP');render()}
  }
  function equipmentAppearance(eq){
    const out={helmet:false,armor:false,belt:false,boots:false,weapon:false,ring:false,amulet:false,labels:[],weaponType:'default',shieldType:'none'};
    const names=['weapon','helmet','armor','belt','boots','ring','amulet'];
    const text=(item)=>typeof item==='string'?item:[item?.name,item?.title,item?.icon,item?.emoji,item?.type,item?.id].filter(Boolean).join(' ').toLowerCase();
    eq.forEach((item,i)=>{
      if(!item)return;
      const slot=names[i]||'slot'; out[slot]=true;
      const t=text(item);
      const label=typeof item==='string'?item:(item.name||item.title||item.icon||item.emoji||'');
      if(label)out.labels.push(label);
      if(slot==='weapon'){
        if(/лук|bow|арбалет|crossbow/.test(t))out.weaponType='bow';
        else if(/копь|spear|пика|halberd/.test(t))out.weaponType='spear';
        else if(/молот|hammer|булава|mace/.test(t))out.weaponType='hammer';
        else if(/топор|axe/.test(t))out.weaponType='axe';
        else if(/кинжал|dagger/.test(t))out.weaponType='dagger';
        else out.weaponType='sword';
      }
      if(/щит|shield|buckler/.test(t))out.shieldType='round';
    });
    return out;
  }
  function itemRarity(item){
    const t=typeof item==='string'?item:[item?.rarity,item?.quality,item?.tier,item?.grade,item?.name,item?.title].filter(Boolean).join(' ').toLowerCase();
    if(/легендар|legend|myth|миф/.test(t))return 'legendary';
    if(/эпич|epic/.test(t))return 'epic';
    if(/редк|rare|super/.test(t))return 'rare';
    if(/необыч|uncommon|green/.test(t))return 'uncommon';
    return 'common';
  }
  function applyEquipmentVisual(eq){
    if(!root)return;
    const a=equipmentAppearance(eq);
    const hero=root.querySelector('#pveHeroFigure');
    if(!hero)return;
    const visual=hero.querySelector('.fighter-visual');
    if(!visual)return;
    Object.keys(a).filter(k=>['helmet','armor','belt','boots','weapon','ring','amulet'].includes(k)).forEach(k=>visual.classList.toggle('gear-'+k,a[k]));
    ['sword','axe','spear','hammer','dagger','bow','default'].forEach(k=>visual.classList.toggle('weapon-'+k,a.weaponType===k));
    ['none','round'].forEach(k=>visual.classList.toggle('shield-'+k,a.shieldType===k));
    visual.dataset.gearCount=String(a.labels.length);
    const rarities=eq.map(itemRarity);
    const topRarity=rarities.includes('legendary')?'legendary':rarities.includes('epic')?'epic':rarities.includes('rare')?'rare':rarities.includes('uncommon')?'uncommon':'common';
    visual.dataset.rarity=topRarity;
    ['common','uncommon','rare','epic','legendary'].forEach(k=>visual.classList.toggle('rarity-'+k,topRarity===k));
    let rack=hero.querySelector('.gear-rack');
    if(!rack){rack=document.createElement('div');rack.className='gear-rack';hero.appendChild(rack);}
    rack.innerHTML=eq.map((item,i)=>{const label=a.labels[i]||'';return `<i class="rarity-${rarities[i]} ${item?'filled':''}" title="${escapeHtml(label)}">${gearLabel(item,i)}</i>`}).join('');
  }
  function followerAppearance(f){
    const t=[f?.name,f?.title,f?.type,f?.id,f?.icon].filter(Boolean).join(' ').toLowerCase();
    if(/волк|wolf/.test(t))return 'wolf';
    if(/ворон|raven|crow|птиц|bird|орёл|eagle/.test(t))return 'bird';
    if(/медвед|bear/.test(t))return 'bear';
    if(/кот|cat|тигр|tiger/.test(t))return 'cat';
    return 'companion';
  }

  function setFighterVisual(host,kind,icon){
    if(!host)return;
    const visual=host.querySelector('.fighter-visual');
    if(!visual)return;
    visual.dataset.kind=kind;
    host.dataset.icon=icon||'';
    host.classList.toggle('has-fighter',!!icon||kind==='hero'||kind==='boss');
    if(kind==='follower')visual.dataset.follower=followerAppearance(model?.follower);
    else visual.dataset.follower='';
  }

  function animate(side,kind){
    if(!root)return;
    const el=root.querySelector(side==='enemy'?'#pveEnemyFigure':side==='hero'?'#pveHeroFigure':'#pveAllyFigure');
    if(!el)return;
    el.classList.remove('anim-'+kind);void el.offsetWidth;el.classList.add('anim-'+kind);
  }
  function spawnFx(type,target){
    if(!root)return;
    const layer=root.querySelector('#pveFx'); if(!layer)return;
    const e=document.createElement('i'); e.className=`fx fx-${type} fx-${target}`;
    e.innerHTML=type==='crit'?'CRIT!':type==='fire'?'🔥':type==='heal'?'+' : type==='dodge'?'MISS':type==='power'?'✦':type==='burst'?'⚡':type==='crown'?'👑':' ';
    layer.appendChild(e); void e.offsetWidth; e.classList.add('go'); setTimeout(()=>e.remove(),900);
  }

  function showResult(win,title,text,icon){
    if(!root)return;
    const box=root.querySelector('#pveResult');
    root.querySelector('#pveResultTitle').textContent=title;
    root.querySelector('#pveResultText').textContent=text;
    root.querySelector('#pveResultIcon').textContent=icon;
    box.classList.toggle('loss',!win);box.classList.add('show');
  }
  function hideResult(){root?.querySelector('#pveResult')?.classList.remove('show','loss')}
  function flash(id,text){const el=root.querySelector('#pve'+(id==='hit'?'Hit':'Mp'));if(text)el.textContent=text;el.classList.remove('show');void el.offsetWidth;el.classList.add('show')}
  function pushLog(text){if(!model)return;model.logs.unshift(text);model.logs=model.logs.slice(0,3);if(root){const el=root.querySelector('#pveCombatLog');el.innerHTML=model.logs.map(x=>`<span>${escapeHtml(x)}</span>`).join('')}}
  function escapeHtml(v){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  
  function useConsumable(key){
    if(!model||model.ended)return;
    const s=S(), count=Number(s.consumables?.[key]||0);
    if(count<=0)return;
    s.consumables[key]=count-1;
    if(key==='elixir_hp'){model.hp=Math.min(model.maxHp,model.hp+30);pushLog('🧪 Эликсир HP: +30 HP');}
    else if(key==='elixir_energy'){s.energy=Math.min(Number(s.maxEnergy)||100,(Number(s.energy)||0)+20);pushLog('🔵 Эликсир энергии: +20 энергии');}
    else if(key==='elixir_attack'){model.damage+=5;pushLog('🔴 Эликсир атаки: +5 урона');}
    else if(key==='elixir_guard'){model.incomingReduction=Math.min(.55,(model.incomingReduction||0)+.08);pushLog('🟡 Эликсир защиты: защита усилена');}
    save();render();
  }

  function syncHp(){const s=S();s.hp=Math.max(0,Math.min(Number(s.maxHp)||100,model.hp));save()}
  function generateLoot(stage,boss){
    const types=[
      ['Оружие','🪓','weapon'],['Шлем','🪖','helmet'],['Доспех','🛡️','armor'],
      ['Пояс','🎗️','belt'],['Сапоги','🥾','boots'],['Кольцо','💍','ring'],['Амулет','🔮','amulet']
    ];
    const [slot,icon,type]=types[(Math.max(1,Number(stage)||1)-1+(boss?2:0))%types.length];
    const rarities=boss?['epic','legendary']:['common','uncommon','rare','epic'];
    const rarity=rarities[Math.floor(Math.random()*rarities.length)];
    const names={common:'Старинный',uncommon:'Закалённый',rare:'Воинский',epic:'Героический',legendary:'Легендарный'};
    const power=(Number(stage)||1)*4+(boss?18:Math.floor(Math.random()*7));
    const setIds=boss?['warchief']:['tide','gold','blackflag','sacred'];const setNames={tide:'Морской дозор',gold:'Золотой страж',blackflag:'Чёрный флаг',sacred:'Священные врата',warchief:'Вождь племени'};const setId=setIds[Math.max(0,Math.min(setIds.length-1,(Number(stage)||1)-1))];
    const affixPool={common:[],uncommon:['crit'],rare:['guard','crit'],epic:['guard','crit','xp'],legendary:['guard','crit','xp']};const aff=affixPool[rarity]||[];
    const item={id:`loot_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,name:`${names[rarity]} ${slot}`,title:`${names[rarity]} ${slot}`,slot,type,icon,rarity,level:Math.max(1,Number(S().level)||1),enhance:0,attack: type==='weapon'?power:0,defense:['armor','helmet','belt','boots'].includes(type)?power:0,agility:['boots','ring'].includes(type)?Math.max(1,Math.floor(power/2)):0,maxHp:type==='armor'?power*3:0,setId,setName:setNames[setId],source:'pve',critChance:aff.includes('crit')?(rarity==='legendary'?4:rarity==='epic'?3:2):0,damageReduction:aff.includes('guard')?(rarity==='legendary'?4:rarity==='epic'?3:2):0,bonusXp:aff.includes('xp')?(rarity==='legendary'?5:3):0};
    const s=S();s.inventoryItems=Array.isArray(s.inventoryItems)?s.inventoryItems:[];s.lootFound=Math.max(0,Number(s.lootFound)||0)+1;s.inventoryItems.unshift(item);s.inventoryItems=s.inventoryItems.slice(0,100);
    return item;
  }
  function equipLoot(item){
    const s=S();const slotMap={weapon:0,helmet:1,armor:2,belt:3,boots:4,ring:5,amulet:6};const i=slotMap[item?.type];if(i===undefined)return false;
    s.equipment=Array.isArray(s.equipment)?s.equipment:Array(7).fill(null);while(s.equipment.length<7)s.equipment.push(null);
    const old=s.equipment[i];s.equipment[i]=item;
    if(old){s.inventoryItems=Array.isArray(s.inventoryItems)?s.inventoryItems:[];s.inventoryItems=s.inventoryItems.filter(x=>x!==item);s.inventoryItems.unshift(old)}
    save();return true;
  }

  function itemRarityLabel(raw){const r=String(raw||'common').toLowerCase();if(r==='legendary')return 'легендарный';if(r==='epic')return 'эпический';if(r==='rare')return 'редкий';if(r==='uncommon')return 'необычный';return 'обычный'}
  function signed(n){return n>0?`+${n}`:String(n)}

  function victory(){if(!model||model.ended)return;model.ended=true;model.attackLocked=true;clearTimeout(autoTimer);clearInterval(tickTimer);model.enemyHp=0;animate('enemy','defeat');pushLog('Победа!');render();
    const wasBoss=model.boss;
    const sVictory=S();sVictory.pve=sVictory.pve||{};if(wasBoss)sVictory.pve.bossDefeated=Math.max(0,Number(sVictory.pve.bossDefeated)||0);else sVictory.pve.wins=Math.max(0,Number(sVictory.pve.wins)||0)+1;
    const loot=generateLoot(model.stage,wasBoss);
    window.TerritoryStore?.state && (window.TerritoryStore.state.story=window.TerritoryStore.state.story||{step:0,progress:0,claimed:{},started:false});
    if(wasBoss) window.TerritoryStore?.state && (window.TerritoryStore.state.daily.bosses=(Number(window.TerritoryStore.state.daily.bosses)||0)+1); else window.TerritoryStore?.state && (window.TerritoryStore.state.daily.wins=(Number(window.TerritoryStore.state.daily.wins)||0)+1);
    window.TerritoryStore?.state && (window.TerritoryStore.state.daily.loot=(Number(window.TerritoryStore.state.daily.loot)||0)+1);
    if(window.TerritoryStore?.state){ const st=window.TerritoryStore.state; if(wasBoss) st.pve.bossDefeated=Math.max(0,Number(st.pve.bossDefeated)||0)+0; st.story.started=true; window.TerritoryStore.saveNow?.(); }
    root.classList.add(wasBoss?'boss-victory':'stage-victory');
    showResult(true,wasBoss?'БОСС ПОВЕРЖЕН!':'ПОБЕДА!',`${wasBoss?'Награды главы будут выданы при продолжении':'Следующий противник загружается…'} · 🎁 ${loot.name} · ${loot.rarity}`,'🏆');
    const lootBox=root.querySelector('#pveResult .result-card');
    if(lootBox&&!lootBox.querySelector('.loot-actions')){
      const actions=document.createElement('div');actions.className='loot-actions';
      const slotMap={weapon:0,helmet:1,armor:2,belt:3,boots:4,ring:5,amulet:6};
      const equipped=Array.isArray(S().equipment)?S().equipment[slotMap[loot.type]]:null;
      const val=(item,keys)=>itemNum(item,keys);
      const lootStats={attack:val(loot,['strength','attack','damage','atk']),defense:val(loot,['defense','def','armor','guard']),agility:val(loot,['agility','agi','speed']),hp:val(loot,['maxHp','hp','health'])};
      const oldStats={attack:val(equipped,['strength','attack','damage','atk']),defense:val(equipped,['defense','def','armor','guard']),agility:val(equipped,['agility','agi','speed']),hp:val(equipped,['maxHp','hp','health'])};
      const diff=k=>lootStats[k]-oldStats[k];
      const compare=document.createElement('div');compare.className='loot-compare';
      compare.innerHTML=`<div class="loot-card"><strong>🎁 ${escapeHtml(loot.name)}</strong><span>${escapeHtml(itemRarityLabel(loot.rarity))} · Lv. ${loot.level}</span><div>⚔ +${lootStats.attack} &nbsp; 🛡 +${lootStats.defense} &nbsp; ⚡ +${lootStats.agility} &nbsp; ❤️ +${lootStats.hp}</div></div><div class="loot-diff">${equipped?`Сравнение со слотом: <b>${escapeHtml(equipped.name||equipped.title||'текущий предмет')}</b><br>⚔ ${signed(diff('attack'))} · 🛡 ${signed(diff('defense'))} · ⚡ ${signed(diff('agility'))} · ❤️ ${signed(diff('hp'))}`:'Слот пуст — предмет можно надеть сразу.'}</div>`;
      const lootActions=document.createElement('div');lootActions.className='loot-actions';
      lootActions.innerHTML=`<button class="loot-equip">⚔ Надеть</button><button class="loot-keep">🎒 Оставить</button><button class="loot-next">▶ Продолжить</button>`;
      lootBox.append(compare,lootActions);
      const continueBattle=()=>{clearTimeout(resultTimer);const s=ensure();hideResult();root.classList.remove('boss-victory','stage-victory');if(model?.boss){const completedChapter=Math.max(1,Number(s.currentChapter)||1);s.pve.bossActive=false;s.pve.bossPending=false;s.chapterBossUnlocked=false;s.chapterBossDefeated=true;s.pve.bossDefeated=(Number(s.pve.bossDefeated)||0)+1;window.TerritoryStore?.addXp?.(Math.round(60*(1+(Number(equipmentBonus().bonusXp)||0)/100)));s.coins=(Number(s.coins)||0)+250;
          s.chapterRewardsClaimed=s.chapterRewardsClaimed||{};
          if(!s.chapterRewardsClaimed[completedChapter]){const baseMat=10+completedChapter;const milestone=completedChapter%10===0;s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials=(Number(s.forge.materials)||0)+baseMat+(milestone?40:0);s.gems=(Number(s.gems)||0)+(milestone?25:5);s.coins=(Number(s.coins)||0)+(milestone?1000:250);s.chapterRewardsClaimed[completedChapter]=true;pushLog(`🎁 Награда главы ${completedChapter}: +${baseMat+(milestone?40:0)} материалов · +${milestone?25:5} 💎`);}
          s.totalChaptersCompleted=Math.max(0,Number(s.totalChaptersCompleted)||0)+1;
          if(s.currentChapter<240){s.currentChapter++;s.pve.chapter=s.currentChapter;s.pve.stage=1;s.pve.progress=0;s.pve.bossPending=false;s.pve.bossActive=false;s.chapterStage=1;s.chapterProgress=0;s.chapterBossUnlocked=false;s.chapterBossDefeated=false;s.chapterCompleted=false;pushLog(`Глава ${s.currentChapter-1} завершена → Глава ${s.currentChapter}`)}else{s.chapterCompleted=true}
          save();close();return} s.pve.progress=Math.min(100,s.pve.progress+25);s.chapterProgress=s.pve.progress;s.pve.stage=Math.min(4,s.pve.stage+1);s.chapterStage=s.pve.stage;s.pve.bossPending=s.pve.progress>=100;s.chapterBossUnlocked=s.pve.bossPending;window.TerritoryStore?.addXp?.(Math.round(20*(1+(Number(equipmentBonus().bonusXp)||0)/100)));s.coins=(Number(s.coins)||0)+25;save();if(s.pve.progress>=100){close();return}start(s.pve.stage)};
      lootActions.querySelector('.loot-equip').onclick=()=>{equipLoot(loot);pushLog(`Надето: ${loot.name}`);lootActions.querySelector('.loot-equip').textContent='✓ Надето';render()};
      lootActions.querySelector('.loot-keep').onclick=()=>{lootActions.querySelector('.loot-keep').textContent='✓ Сохранено'};
      lootActions.querySelector('.loot-next').onclick=continueBattle;
    }
    clearTimeout(resultTimer);resultTimer=setTimeout(()=>{root.querySelector('.loot-next')?.click()},7000)}
  function defeat(){if(!model||model.ended)return;model.ended=true;model.attackLocked=true;clear();animate('hero','defeat');pushLog('Поражение.');render();showResult(false,'ПОРАЖЕНИЕ','Герой восстановит часть HP перед возвращением','☠️');clearTimeout(resultTimer);resultTimer=setTimeout(()=>{hideResult();root.classList.remove('boss-victory','stage-victory');const s=S();s.hp=Math.max(1,Math.floor((Number(s.maxHp)||100)*.35));save();close()},1100)}
  function render(){
    if(!root||!model)return;const s=ensure(),eq=equipment(),f=model.follower;const stats=equipmentBonus();
    root.querySelector('#pvePower').textContent='🔥 '+Math.max(0,Number(s.battleStones)||0);root.querySelector('#pveCoins').textContent='🪙 '+Math.floor(Number(s.coins)||0).toLocaleString('ru-RU');root.querySelector('#pveGems').textContent='💎 '+Math.floor(Number(s.gems)||0).toLocaleString('ru-RU');root.querySelector('#pveNavCoins').textContent='🪙 '+Math.floor(Number(s.coins)||0).toLocaleString('ru-RU');
    root.querySelector('#pveChapterTitle').textContent=model.boss?'ВОЖДЬ БОЕВОГО ПЛЕМЕНИ':`ГЛАВА ${s.currentChapter} · ${s.currentChapter}-${model.stage}`;
    const tr=root.querySelector('#pveStageTrack');tr.innerHTML='';for(let i=1;i<=4;i++){const b=document.createElement('span');b.className='stage '+(s.pve.progress>=i*25?'done ':'')+(i===model.stage&&!model.boss?'current':'');b.textContent=s.pve.progress>=i*25?'✓':i;tr.appendChild(b)}
    root.querySelector('#pveEnemyName').textContent=model.enemy.name;setFighterVisual(root.querySelector('#pveEnemyFigure'),model.boss?'boss':`enemy-${model.stage}`,model.enemy.icon);root.querySelector('#pveEnemyFill').style.width=(model.enemyHp/model.enemy.hp*100)+'%';root.querySelector('#pveEnemyHp').textContent=`${Math.ceil(model.enemyHp).toLocaleString('ru-RU')} / ${model.enemy.hp.toLocaleString('ru-RU')}`;root.querySelector('#pveBossTimer').textContent=model.boss?`⌛ ${model.bossTime}s`:'';
    applyEquipmentVisual(eq);
    root.querySelector('#pveHpFill').style.width=Math.max(0,model.hp/model.maxHp*100)+'%';root.querySelector('#pveHpText').textContent=`${Math.floor(model.hp).toLocaleString('ru-RU')} / ${Math.floor(model.maxHp).toLocaleString('ru-RU')} HP`;root.querySelector('#pveHeroMiniHp').style.width=Math.max(0,model.hp/model.maxHp*100)+'%';root.querySelector('#pveAllyMiniHp').style.width=f?'100%':'0%';setFighterVisual(root.querySelector('#pveHeroFigure'),'hero','🧔');setFighterVisual(root.querySelector('#pveAllyFigure'),'follower',f?.icon||'');root.querySelector('#pveAllyUnit').classList.toggle('empty',!f);
    root.querySelector('#pveAuto').textContent=model.auto?'AUTO ✓':'AUTO';root.querySelector('#pveSkill').disabled=model.skillCooldown>0||model.ended;root.querySelector('#pveSkill').textContent=model.skillCooldown>0?String(Math.ceil(model.skillCooldown/1000)):'✦';root.querySelector('#pveTask').innerHTML=model.boss?`Победите босса до окончания таймера <em>⚔ +${stats.strength} · 🛡 +${stats.defense} · ⚡ +${stats.agility} · 💥 ${stats.critChance||0}% крит</em>`:`Этап ${model.stage} · Победа даст <b>+25%</b> <em>⚔ +${stats.strength} · 🛡 +${stats.defense} · ⚡ +${stats.agility} · 💥 ${stats.critChance||0}% крит</em>`;
    const slots=root.querySelector('#pveSlots');slots.innerHTML=eq.map((item,i)=>{const b=itemNum(item,['strength','attack','damage','atk'])+itemNum(item,['defense','def','armor','guard'])+itemNum(item,['agility','agi','speed']);const title=item?`${item.name||item.title||'Предмет'}${b?` · +${b} стат.`:''}`:`Слот ${i+1}: пусто`;return `<button class="slot ${item?'filled':''}" title="${escapeHtml(title)}"><span>${gearLabel(item,i)}</span><small>${item?.level?`Lv. ${item.level}`:(b?`+${b}`:'—')}</small></button>`}).join('');
    slots.querySelectorAll('.slot').forEach((b,i)=>b.onclick=()=>{const item=eq[i];pushLog(item?`Экипировка: ${item.name||item.title||`слот ${i+1}`}`:`Слот ${i+1} пуст`);});
    const cb=root.querySelector('#pveConsumables');
    cb.innerHTML=CONSUMABLES.map(([key,icon,label])=>{const count=Number(s.consumables?.[key]||0);return `<button class="consumable ${count?'ready':''}" data-consumable="${key}" ${!count||model.ended?'disabled':''}><span>${icon}</span><small>${label} · ${count}</small></button>`}).join('');
    cb.querySelectorAll('[data-consumable]').forEach(b=>b.onclick=()=>useConsumable(b.dataset.consumable));
    root.querySelector('#pveBossSkills').parentElement.style.display=model.boss?'block':'none';
  }
  function clear(){clearTimeout(autoTimer);clearInterval(tickTimer);clearTimeout(resultTimer);autoTimer=null;tickTimer=null;resultTimer=null}
  function close(){clear();if(model?.boss){const s=S();s.pve.bossActive=false;save()}model=null;root?.classList.remove('show','boss');window.showScreen?.('home')}
  window.PvEBattle={start,startBoss,close,attack,skill};
})();
