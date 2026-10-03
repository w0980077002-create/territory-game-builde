
(() => {
"use strict";
const WORKER_BASE = "https://territory-sdolars-server.w0660077702.workers.dev";
const KEY="territory_merged_v1";
const tg=window.Telegram?.WebApp;
try{tg?.ready();tg?.expand()}catch{}

const BOTS=[
 {name:"Валера",level:1,hp:95,atk:12,def:4},
 {name:"Людмила",level:2,hp:110,atk:14,def:5},
 {name:"Ragnar",level:3,hp:125,atk:16,def:6},
 {name:"Mira",level:4,hp:140,atk:18,def:7}
];
const ENEMIES=[
 {name:"Разбойник",hp:70,atk:9,def:3,art:"https://raw.githubusercontent.com/w0980077002-create/territory-bolt-game/main/public/enemy-bandit.webp",gold:25,xp:35},
 {name:"Кабан",hp:85,atk:11,def:4,art:"https://raw.githubusercontent.com/w0980077002-create/territory-bolt-game/main/public/enemy-boar.webp",gold:30,xp:45},
 {name:"Гоблин",hp:105,atk:13,def:5,art:"https://raw.githubusercontent.com/w0980077002-create/territory-bolt-game/main/public/enemy-goblin.webp",gold:38,xp:55},
 {name:"Викинг",hp:130,atk:15,def:7,art:"https://raw.githubusercontent.com/w0980077002-create/territory-bolt-game/main/public/enemy-viking.webp",gold:50,xp:70},
 {name:"Тролль",hp:170,atk:20,def:9,art:"https://raw.githubusercontent.com/w0980077002-create/territory-bolt-game/main/public/enemy-troll.webp",gold:75,xp:95}
];
const BOSS={name:"Главный босс",hp:260,atk:25,def:11,art:"https://raw.githubusercontent.com/w0980077002-create/territory-bolt-game/main/public/enemy-boss.webp",gold:180,xp:220};

const fresh=()=>({
 name:(tg?.initDataUnsafe?.user?.first_name||"Игрок").slice(0,20),
 photo:tg?.initDataUnsafe?.user?.photo_url||"",
 level:1,xp:0,gold:150,gems:20,energy:10,maxEnergy:10,
 attack:12,defense:5,maxHp:120,hp:120,chapter:1,wins:0,totalWins:0,bosses:0,
 battleStones:5,auto:false,speed:1,
 inventory:[],equipment:{weapon:null,armor:null,helmet:null,boots:null,ring:null,amulet:null},
 forge:3,quests:{dailyWins:0,shopBuys:0,stonesClaimed:false},
 arena:{rating:1000,wins:0,losses:0}
});
let state=load();
let current="home", fight=null, arena=null;

function load(){try{const s=JSON.parse(localStorage.getItem(KEY));return s?Object.assign(fresh(),s):fresh()}catch{return fresh()}}
function save(){localStorage.setItem(KEY,JSON.stringify(state));paintTop()}
function esc(x){return String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]))}
function toast(t){const e=document.createElement("div");e.className="toast";e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),1800)}
function paintTop(){
 $("#gold").textContent=state.gold.toLocaleString("ru-RU");$("#gems").textContent=state.gems.toLocaleString("ru-RU");$("#energy").textContent=`${state.energy}/${state.maxEnergy}`;
 $("#miniName").textContent=state.name||"Игрок";
 const a=$("#miniAvatar");a.innerHTML=state.photo?`<img src="${esc(state.photo)}">`:"⚔️";
}
const $=s=>document.querySelector(s);
function render(){paintTop();$("#screen").innerHTML=screens[current]();document.querySelectorAll("[data-screen]").forEach(b=>{b.classList.toggle("active",b.dataset.screen===current);b.onclick=()=>go(b.dataset.screen)});bind();}

function go(s){current=s;render();window.scrollTo?.(0,0)}
function bind(){
 document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>actions[b.dataset.action]?.(b));
 document.querySelectorAll("[data-zone]").forEach(b=>b.onclick=()=>zone(b.dataset.zone));
 document.querySelectorAll("[data-attack]").forEach(b=>b.onclick=()=>attackZone(b.dataset.attack));
 document.querySelectorAll("[data-buy]").forEach(b=>b.onclick=()=>buy(b.dataset.buy));
 document.querySelectorAll("[data-equip]").forEach(b=>b.onclick=()=>equip(b.dataset.equip));
}

const screens={
home(){const xpPct=Math.min(100,state.xp/(state.level*100)*100);const next=ENEMIES[Math.min(ENEMIES.length-1,(state.wins)%ENEMIES.length)];
 return `<div class="home"><div class="home-content">
 <div class="panel"><div class="hero-row"><div class="hero-avatar">${state.photo?`<img src="${esc(state.photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:18px">`:"🪓"}</div><div style="flex:1"><div class="title">${esc(state.name)}</div><div class="muted">Уровень ${state.level} · Боевых побед ${state.totalWins}</div><div style="margin-top:8px"><div class="muted">Опыт ${state.xp}/${state.level*100}</div><div class="bar"><i style="width:${xpPct}%"></i></div></div></div></div></div>
 <div class="res-row"><div class="res">🪙<br><b>${state.gold}</b></div><div class="res">💎<br><b>${state.gems}</b></div><div class="res">🪨<br><b>${state.battleStones}</b> камней</div></div>
 <div class="panel"><div class="section-title">Путь Territory · глава ${state.chapter}</div><p class="muted">Победы: ${state.wins}/4. После 4 побед открывается босс.</p><div class="bar"><i style="width:${Math.min(100,state.wins/4*100)}%"></i></div><div class="grid2" style="margin-top:9px"><button class="btn red" data-action="startFight">⚔️ В бой</button><button class="btn dark" data-action="openBoss">☠️ Босс</button></div></div>
 <div class="panel"><div class="section-title">Ежедневные задания</div><div class="muted">Победы ${state.quests.dailyWins}/3 · награда: 🪨 3</div><div class="bar" style="margin:6px 0 9px"><i style="width:${Math.min(100,state.quests.dailyWins/3*100)}%"></i></div><button class="btn gold" data-action="claimDaily" ${state.quests.stonesClaimed||state.quests.dailyWins<3?"disabled":""}>${state.quests.stonesClaimed?"Награда получена":"Забрать 3 боевых камня"}</button></div>
 <div class="panel"><div class="section-title">Следующий враг</div><div class="enemy-card"><img class="enemy-art" src="${next.art}" onerror="this.style.display='none'"><div><b>${next.name}</b><div class="muted">❤️ ${next.hp} · ⚔️ ${next.atk} · 🛡 ${next.def}</div><button class="btn gold" style="margin-top:7px" data-action="startFight">Сразиться</button></div></div></div>
 </div></div>`},
fight(){if(!fight)return fightLobby();return fightScreen()},
arena(){if(!arena)return arenaLobby();return arenaScreen()},
shop(){return `<div class="panel"><div class="section-title">Лавка</div><p class="muted">Боевые камни не регенерируют. Получай их за задания или покупай за 💎.</p></div>
 <div class="shop-card"><div><b>🪨 3 боевых камня</b><div class="muted">Для PvE/Arena</div></div><button class="btn gold" data-buy="stones">💎 10</button></div>
 <div class="shop-card" style="margin-top:8px"><div><b>🧪 Зелье здоровья</b><div class="muted">+40 HP перед боем</div></div><button class="btn gold" data-buy="potion">🪙 35</button></div>
 <div class="shop-card" style="margin-top:8px"><div><b>⚔️ Железный меч</b><div class="muted">+5 атаки</div></div><button class="btn gold" data-buy="sword">🪙 100</button></div>
 <div class="panel" style="margin-top:10px"><div class="section-title">Кузница</div><p class="muted">Материалы: 🔩 ${state.forge}</p><button class="btn dark" data-action="forge">🔨 Улучшить экипировку</button></div>`},
profile(){return `<div class="panel" style="text-align:center"><div class="hero-avatar" style="margin:auto">${state.photo?`<img src="${esc(state.photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:18px">`:"🪓"}</div><h2>${esc(state.name)}</h2><p class="muted">Telegram-профиль отображается здесь, ID и username не висят в шапке.</p></div>
 <div class="panel"><div class="section-title">Характеристики</div><div class="stat-grid">${stat("❤️","Здоровье",`${state.maxHp}`)}${stat("⚔️","Атака",state.attack)}${stat("🛡","Защита",state.defense)}${stat("💎","Кристаллы",state.gems)}${stat("🏆","Arena рейтинг",state.arena.rating)}${stat("⚔️","Arena побед",state.arena.wins)}</div></div>
 <div class="panel"><div class="section-title">Экипировка</div>${Object.entries(state.equipment).map(([k,v])=>`<div class="item" style="margin:5px 0"><div class="ico">${v?.icon||"⬜"}</div><div style="flex:1"><b>${v?.name||k}</b><div class="muted">${v?`+${v.attack||0} атаки · +${v.defense||0} защиты`:"пусто"}</div></div></div>`).join("")}</div>
 <div class="grid2"><button class="btn dark" data-action="reset">Сбросить тест</button><button class="btn gold" data-action="daily">Получить 1 камень за тест</button></div>`}
};

function stat(i,n,v){return `<div class="stat"><span>${i}</span><small>${n}</small><b>${v}</b></div>`}
function fightLobby(){const e=ENEMIES[Math.min(ENEMIES.length-1,state.wins)];return `<div class="panel"><div class="section-title">PvE · Бой</div><div class="stones"><span>🪨 Боевые камни</span><span class="stone-count">${state.battleStones}</span></div><p class="muted" style="margin-top:9px">Камень расходуется на каждый бой. Автоматического восстановления нет.</p></div><div class="panel"><div class="enemy-card"><img class="enemy-art" src="${e.art}" onerror="this.style.display='none'"><div><b>${e.name}</b><div class="muted">❤️ ${e.hp} · ⚔️ ${e.atk} · 🛡 ${e.def}</div><button class="btn red" style="margin-top:8px" data-action="startFight">⚔️ Начать бой</button></div></div><div class="grid2"><button class="btn dark" data-action="toggleAuto">🤖 ${state.auto?"Авто: ВКЛ":"Авто: ВЫКЛ"}</button><button class="btn dark" data-action="toggleSpeed">×${state.speed} скорость</button></div></div>`}
function fightScreen(){let f=fight;return `<div class="panel"><div class="stones"><b>🪨 Боевые камни</b><span class="stone-count">${state.battleStones}</span></div><div class="combat-stage" style="margin-top:9px"><div class="fighter player"><div class="fighter-icon">🪓</div><div class="name">${esc(state.name)}</div><div class="hpbar"><i style="width:${f.hp/meHP()*100}%"></i></div><small>❤️ ${Math.max(0,Math.ceil(f.hp))}/${meHP()}</small></div><div class="versus">VS</div><div class="fighter bot"><div class="fighter-icon">${f.enemyBoss?"👹":"👾"}</div><div class="name">${esc(f.enemy.name)}</div><div class="hpbar"><i style="width:${f.enemy.hp/f.enemy.maxHp*100}%"></i></div><small>❤️ ${Math.max(0,Math.ceil(f.enemy.hp))}/${f.enemy.maxHp}</small></div></div>
 <div class="controls"><button class="zone ${f.def.includes("head")?"selected":""}" data-zone="head">🛡 Голова</button><button class="zone ${f.attack==="head"?"selected":""}" data-attack="head">⚔ Голова</button><button class="zone ${f.def.includes("chest")?"selected":""}" data-zone="chest">🛡 Грудь</button><button class="zone ${f.attack==="chest"?"selected":""}" data-attack="chest">⚔ Грудь</button><button class="zone ${f.def.includes("belly")?"selected":""}" data-zone="belly">🛡 Живот</button><button class="zone ${f.attack==="belly"?"selected":""}" data-attack="belly">⚔ Живот</button><button class="zone ${f.def.includes("legs")?"selected":""}" data-zone="legs">🛡 Ноги</button><button class="zone ${f.attack==="legs"?"selected":""}" data-attack="legs">⚔ Ноги</button></div>
 <div class="grid2" style="margin-top:9px"><button class="btn red" data-action="strike">⚔️ Удар</button><button class="btn dark" data-action="toggleAuto">🤖 ${state.auto?"Авто ✓":"Авто"}</button></div>
 <div class="log" style="margin-top:9px">${f.log.map(x=>`<div>${esc(x)}</div>`).join("")}</div></div>`}
function meHP(){return state.maxHp}
function startFight(boss=false){if(state.battleStones<=0){toast("Нет боевых камней");return}if(!boss&&state.wins>=4){toast("Сначала убей босса главы");return}if(boss&&state.wins<4){toast("Сначала нужны 4 победы");return}
 const base=boss?BOSS:ENEMIES[state.wins%ENEMIES.length];fight={enemy:Object.assign({},base,{maxHp:base.hp}),hp:state.maxHp,def:["chest","legs"],attack:"head",log:[`⚔️ ${state.name} начинает бой против ${base.name}`],enemyBoss:boss};state.battleStones--;save();current="fight";render();if(state.auto)autoTimer()}
function zone(z){if(!fight)return;const i=fight.def.indexOf(z);if(i>=0)fight.def.splice(i,1);else if(fight.def.length<2)fight.def.push(z);render()}
function attackZone(z){if(!fight)return;fight.attack=z;render()}
function strike(){if(!fight)return;const e=fight.enemy;const mult=fight.attack==="head"?1.25:fight.attack==="legs"?.85:1;let dmg=Math.max(1,state.attack*mult-e.def*.55);if(Math.random()<.12)dmg*=1.7;dmg=Math.round(dmg);e.hp-=dmg;fight.log.unshift(`⚔️ Ты наносишь ${dmg} урона (${fight.attack})`);if(e.hp<=0){winFight();return}
 const botAtk=["head","chest","belly","legs"][Math.floor(Math.random()*4)];let incoming=Math.max(1,e.atk-(fight.def.includes(botAtk)?state.defense*.8:0));incoming=Math.round(incoming);fight.hp-=incoming;fight.log.unshift(`🩸 ${e.name} бьёт в ${botAtk}: -${incoming} HP`);if(fight.hp<=0){fight.log.unshift("☠️ Герой пал");fight=null;toast("Поражение");current="home";render();return}render()}
function autoTimer(){clearInterval(window._auto);window._auto=setInterval(()=>{if(!fight||!state.auto){clearInterval(window._auto);return}strike()},state.speed===2?650:1100)}
function winFight(){const e=fight.enemy;state.gold+=e.gold;state.xp+=e.xp;state.totalWins++;state.quests.dailyWins=Math.min(3,state.quests.dailyWins+1);if(fight.enemyBoss){state.bosses++;state.chapter++;state.wins=0;state.gold+=100;toast("Глава пройдена!")}else state.wins++;if(state.xp>=state.level*100){state.xp-=state.level*100;state.level++;state.maxHp+=12;state.attack+=2;state.defense+=1;state.hp=state.maxHp;toast("Новый уровень!")}save();fight.log.unshift(`🏆 Победа! +${e.gold} 🪙 +${e.xp} XP`);const log=[...fight.log];fight=null;clearInterval(window._auto);toast("Победа!");current="home";render()}
function arenaLobby(){return `<div class="panel"><div class="section-title">Arena · 1×1</div><p class="muted">Живой матчмейкинг можно подключить через сервер. Для тестеров Arena всегда имеет рабочий локальный bot-fallback, поэтому кнопка не зависает и бой не блокирует игру.</p><div class="stones"><span>🪨 Боевые камни</span><span class="stone-count">${state.battleStones}</span></div></div><div class="panel"><div class="section-title">Соперники</div>${BOTS.map((b,i)=>`<div class="item" style="margin:7px 0"><div class="ico">⚔️</div><div style="flex:1"><b>${b.name}</b><div class="muted">Lv.${b.level} · рейтинг ${900+i*45}</div></div><button class="btn red" data-action="arenaStart" data-bot="${i}">Вызвать</button></div>`).join("")}</div>`}
function arenaScreen(){const a=arena;return `<div class="panel"><div class="stones"><b>🪨 Камни: ${state.battleStones}</b><span>🏆 ${state.arena.rating}</span></div><div class="arena-stage" style="margin-top:9px"><div class="fighter player"><div class="fighter-icon">🪓</div><div class="name">${esc(state.name)}</div><div class="hpbar"><i style="width:${a.hp/state.maxHp*100}%"></i></div><small>❤️ ${Math.max(0,Math.ceil(a.hp))}</small></div><div class="versus">VS</div><div class="fighter bot"><div class="fighter-icon">🛡️</div><div class="name">${esc(a.bot.name)}</div><div class="hpbar"><i style="width:${a.bot.hp/a.bot.maxHp*100}%"></i></div><small>❤️ ${Math.max(0,Math.ceil(a.bot.hp))}</small></div><div class="arena-actions"><button class="btn red" data-action="arenaStrike">⚔️ Удар</button><button class="btn dark" data-action="arenaExit">Выйти</button></div></div></div><div class="panel"><div class="section-title">Тактика</div><div class="controls">${["head","chest","belly","legs"].map(z=>`<button class="zone ${a.attack===z?"selected":""}" data-attack="${z}">⚔️ ${z==="head"?"Голова":z==="chest"?"Грудь":z==="belly"?"Живот":"Ноги"}</button>`).join("")}</div><div class="log" style="margin-top:9px">${a.log.map(x=>`<div>${esc(x)}</div>`).join("")}</div></div>`}
function startArena(i){if(state.battleStones<=0){toast("Нет боевых камней");return}const b=BOTS[i];state.battleStones--;arena={bot:{...b,maxHp:b.hp},hp:state.maxHp,attack:"head",log:[`⚔️ ${state.name} вызывает ${b.name}`]};save();current="arena";render()}
function arenaStrike(){if(!arena)return;let mult=arena.attack==="head"?1.25:arena.attack==="legs"?.85:1;let dmg=Math.max(1,Math.round(state.attack*mult-arena.bot.def*.5));arena.bot.hp-=dmg;arena.log.unshift(`⚔️ -${dmg} HP ${arena.bot.name}`);if(arena.bot.hp<=0){state.arena.wins++;state.arena.rating+=20;state.gold+=60;arena=null;save();toast("Победа на арене");current="arena";render();return}let inc=Math.max(1,Math.round(arena.bot.atk-state.defense*.3));arena.hp-=inc;arena.log.unshift(`🩸 Ответный удар -${inc}`);if(arena.hp<=0){state.arena.losses++;state.arena.rating=Math.max(0,state.arena.rating-15);arena=null;save();toast("Поражение на арене");current="arena";render();return}render()}
function buy(k){if(k==="stones"){if(state.gems<10){toast("Не хватает кристаллов");return}state.gems-=10;state.battleStones+=3}if(k==="potion"){if(state.gold<35){toast("Не хватает золота");return}state.gold-=35;state.inventory.push({name:"Зелье здоровья",icon:"🧪",type:"potion",heal:40})}if(k==="sword"){if(state.gold<100){toast("Не хватает золота");return}state.gold-=100;state.inventory.push({name:"Железный меч",icon:"⚔️",type:"equipment",attack:5});}state.quests.shopBuys++;save();render()}
function equip(name){toast(name)}
function forge(){if(state.inventory.length===0){toast("Нет предметов для кузницы");return}if(state.forge<=0){toast("Нет материалов");return}const it=state.inventory.find(x=>x.type==="equipment");if(!it){toast("Нужна экипировка");return}it.attack=(it.attack||0)+1;state.forge--;toast("Предмет улучшен");save();render()}
const actions={
startFight:()=>startFight(false),openBoss:()=>startFight(true),toggleAuto:()=>{state.auto=!state.auto;save();render();if(state.auto&&fight)autoTimer()},toggleSpeed:()=>{state.speed=state.speed===1?2:1;save();render();if(state.auto&&fight)autoTimer()},
claimDaily:()=>{if(state.quests.dailyWins<3||state.quests.stonesClaimed)return;state.battleStones+=3;state.quests.stonesClaimed=true;save();render()},
daily:()=>{state.battleStones++;save();toast("+1 боевой камень")},
reset:()=>{if(confirm("Сбросить тестовый прогресс?")){state=fresh();save();go("home")}},
forge,
arenaStart:b=>startArena(Number(b.dataset.bot)),
arenaStrike:arenaStrike,arenaExit:()=>{arena=null;go("arena")}}
document.addEventListener("click",e=>{const b=e.target.closest("[data-action]");if(b&&actions[b.dataset.action])actions[b.dataset.action](b);});
document.addEventListener("click",e=>{const b=e.target.closest("[data-screen]");if(b)go(b.dataset.screen)});
$("#profileMini").onclick=()=>go("profile");

render();
})();
