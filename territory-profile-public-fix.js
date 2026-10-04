(function(){
'use strict';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ATTRS=[['strength','💪','Сила'],['agility','🪽','Ловкость'],['intuition','👁️','Интуиция'],['resilience','🛡️','Стойкость'],['constitution','❤️','Конституция']];
const STYLES={crit:['💥','Критический удар'],dodge:['💨','Уворот'],tank:['🛡️','Танк'],resilience:['🧱','Стойкость']};
const PROFESSIONS={blacksmith:['Кузнец','⚒️'],leatherworker:['Кожевник','🪡'],jeweler:['Ювелир','💍'],runesmith:['Рунописец','🔮']};
const EQ_ICONS=['🪖','📿','🧥','🛡️','🥾','⚔️','💍'];
function skinFor(c,d){
  if(c?.activeUnique==='unique-dikaya') return 'assets/skins/unique-dikaya.png';
  if(/^((male|female)-[1-5])$/.test(String(c?.skin||''))) return `assets/skins/${c.skin}.svg`;
  return d?.skinImage||'assets/ui/profile.png';
}
function equipment(data){
  const a=Array.isArray(data?.equipment)?data.equipment.slice(0,7):[];
  while(a.length<7)a.push(null);
  return a;
}
function slots(data){
  const a=equipment(data);
  const make=(it,i)=>{
    const src=it?.icon&&/^(https?:|assets\/)/.test(String(it.icon))?String(it.icon):null;
    return `<button class="tp-eq-slot ${it?'':'empty'}" tabindex="-1">${src?`<img src="${esc(src)}" alt="">`:`<span class="tp-eq-emoji">${esc(it?.icon||EQ_ICONS[i])}</span>`}<em>${it?.level?`+${esc(it.level)}`:''}</em></button>`;
  };
  return `<div class="tp-eq-col">${a.slice(0,4).map(make).join('')}</div><div class="tp-eq-col">${a.slice(4,7).map((x,i)=>make(x,i+4)).join('')}</div>`;
}
function combat(d,c){
  const level=Math.max(1,Number(d?.level)||Number(d?.profile?.level)||1);
  const hp=Math.round(Number(d?.maxHp||d?.max_hp||100)+Number(c?.constitution||0)*12);
  const attack=Math.round(125+level*2+Number(c?.strength||0)*3);
  const energy=Math.round(Number(d?.maxEnergy||d?.max_energy||100));
  const defense=Math.round(98+level+Number(c?.resilience||0)*3);
  const crit=(8+Number(c?.intuition||0)*.55).toFixed(1);
  const critDamage=Math.round(150+Number(c?.intuition||0)*1.2);
  const dodge=(5+Number(c?.agility||0)*.5).toFixed(1);
  const block=(3+Number(c?.resilience||0)*.35).toFixed(1);
  const resistance=(4+Number(c?.resilience||0)*.4).toFixed(1);
  const speed=Math.round(100+Number(c?.agility||0)*.7);
  const stone=Number(d?.battleStones||d?.battle_stones);
  const rows=[['❤️','Здоровье',hp],['⚡','Энергия',energy],['🪨','Боевые камни',Number.isFinite(stone)?stone:'—'],['⚔️','Атака',attack],['🛡️','Защита',defense],['💥','Крит. шанс',crit+'%'],['💥','Крит. урон',critDamage+'%'],['💨','Уклонение',dodge+'%'],['🛡️','Блок',block+'%'],['🧱','Сопротивление',resistance+'%'],['⚡','Скорость',speed]];
  return `<section class="tp-section"><div class="tp-section-title">⚔️ Параметры боя</div><div class="tp-stat-grid">${rows.map(r=>`<div class="tp-stat"><span>${r[0]} ${r[1]}</span><b>${r[2]}</b></div>`).join('')}</div></section>`;
}
function achievements(d){
  const pvp=Number(d?.arena?.wins)||0,pve=Number(d?.pve?.wins)||0,boss=Number(d?.pve?.bossDefeated)||0;
  return `<section class="tp-section"><div class="tp-section-title">🏆 Достижения</div><div class="tp-ach"><div>⚔️ Побед в PvP<strong>${pvp}</strong></div><div>⚔️ Побед в PvE<strong>${pve}</strong></div><div>☠️ Боссов<strong>${boss}</strong></div></div></section>`;
}
function follower(d,c){
  const f=c?.follower||d?.follower;
  if(!f)return '';
  return `<section class="tp-section"><div class="tp-section-title">🐾 Последователь</div><div class="tp-follower"><div style="font-size:46px;text-align:center">${esc(f.icon||'🐯')}</div><div><b>${esc(f.name||'Последователь')}</b><small>Уровень ${Number(f.level)||1}</small></div><div class="tp-mini-stats">❤️ <b>${Number(f.hp)||0}</b><br>⚔️ <b>${Number(f.attack)||0}</b><br>🛡️ <b>${Number(f.defense)||0}</b></div></div></section>`;
}
function renderPublic(data){
  const h=document.querySelector('#hero'); if(!h)return;
  const d=data||{},c=d.character||{},p=d.profile||{};
  const level=Math.max(1,Number(d.level)||Number(p.level)||1);
  const prof=PROFESSIONS[c.profession];
  const spec=STYLES[c.specialization]||['⚔️','—'];
  const clan=c.clan||d.clan||{};
  const rank=Math.max(1,Number(d.rank)||100);
  const eq=slots(d);
  const img=skinFor(c,d);
  h.className='screen panel tp-screen tp-public active';
  h.innerHTML=`<div class="tp-wrap">
    <header class="tp-head"><button class="tp-back" data-tp-back>‹</button><div><div class="tp-top">TOP 100</div><h1>Профиль игрока</h1></div><span style="width:42px"></span></header>
    <section class="tp-hero">
      <div class="tp-hero-top"><div class="tp-avatar"><img src="${esc(p.photoUrl||'assets/ui/profile.png')}" alt=""></div><div><div class="tp-name">${esc(p.displayName||d.displayName||'Игрок')}</div><div class="tp-meta">Уровень ${level} · VIP ${Number(p.vip??d.vip)||0}</div><div class="tp-meta">🛡️ <b>${esc(clan.name||'Без клана')}</b></div></div><div class="tp-rank"><div class="medal">🏆</div><small>Рейтинг</small><strong>ТОП ${rank}</strong></div></div>
      <div class="tp-stage"><div class="tp-stage-bg"></div><img class="tp-character" src="${esc(img)}" alt="Персонаж"><div class="tp-equip">${eq}</div></div>
    </section>
    <section class="tp-section"><div class="tp-section-title">👤 Основная информация</div><div class="tp-grid2">
      <div class="tp-info"><div class="tp-row"><span>Имя</span><b>${esc(p.displayName||d.displayName||'Игрок')}</b></div><div class="tp-row"><span>Уровень</span><b>${level}</b></div><div class="tp-row"><span>VIP</span><b>${Number(p.vip??d.vip)||0}</b></div></div>
      <div class="tp-info"><div class="tp-row"><span>Профессия</span><b>${prof?esc(prof[1]+' '+prof[0]):'—'}</b></div><div class="tp-row"><span>Уровень проф.</span><b>${Number(d.professionLevel||d.economy?.prof?.[c.profession]?.l||1)}/300</b></div><div class="tp-row"><span>Клан</span><b>${esc(clan.name||'—')}</b></div><div class="tp-row"><span>Роль</span><b>${esc(clan.role||'—')}</b></div></div>
    </div></section>
    <section class="tp-section"><div class="tp-section-title">⚔️ Характеристики</div><div class="tp-attrs">${ATTRS.map(([k,ico,n])=>`<div class="tp-attr"><span class="ico">${ico}</span><small>${n}</small><strong>${Number(c[k])||0}</strong><span></span></div>`).join('')}</div><div class="tp-special"><span>Специализация: </span><strong>${spec[0]} ${spec[1]}</strong></div></section>
    ${combat(d,c)}${achievements(d)}${follower(d,c)}
    <div class="tp-public-note">Публичный профиль: личный ID, Telegram username, онлайн-статус и ресурсы аккаунта скрыты.</div>
    <div class="tp-actions"><button class="tp-btn" data-tp-back>‹ Назад</button></div>
  </div>`;
  h.querySelectorAll('[data-tp-back]').forEach(b=>b.addEventListener('click',()=>window.TerritoryUI?.show?.('home')));
}
function install(){
 const api=window.TerritoryProfile;
 if(!api||api.__publicPrivacyFix)return;
 api.openPublic=renderPublic;
 api.__publicPrivacyFix=true;
 window.TerritoryPublicProfile={render:renderPublic};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
