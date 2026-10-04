(function(){
'use strict';
if(window.TerritoryEconomyFoundation)return;
const Store=window.TerritoryStore;
if(!Store)return;
const DEFAULT={version:2,resources:{},professions:{blacksmith:{level:1,xp:0},leatherworker:{level:1,xp:0},jeweler:{level:1,xp:0},runesmith:{level:1,xp:0}},permanentGear:[],resourceRuns:{active:null,history:[]},auction:{listings:[],sales:[]},contracts:{orders:[],completed:[]},ledger:{entries:[],pendingWithdrawals:[]},policy:{marketFeePct:10,withdrawalFeePct:7,reviewDays:5,minWithdrawal:5}};
const MAP=[
{id:'greenwood',name:'Зелёный лес',icon:'🌲',risk:'Низкий',resources:[['Древесина','wood'],['Смола','resin'],['Кожа','leather']]},
{id:'ironmine',name:'Железные рудники',icon:'⛏️',risk:'Низкий',resources:[['Железная руда','iron_ore'],['Уголь','coal'],['Камень','stone']]},
{id:'silverpeak',name:'Серебряные вершины',icon:'🏔️',risk:'Средний',resources:[['Серебро','silver_ore'],['Кристалл','crystal'],['Уголь','coal']]},
{id:'runewastes',name:'Рунические пустоши',icon:'🔮',risk:'Высокий',resources:[['Осколок руны','rune_shard'],['Мана-кристалл','mana_crystal'],['Древняя пыль','ancient_dust']]},
{id:'dragonvale',name:'Долина драконов',icon:'🐉',risk:'Очень высокий',resources:[['Чешуя дракона','dragon_scale'],['Кость дракона','dragon_bone'],['Огненное ядро','fire_core']]}
];
const PROFESSIONS={blacksmith:{name:'Кузнец',icon:'⚒️',recipes:'оружие · броня · щиты'},leatherworker:{name:'Кожевник',icon:'🪡',recipes:'кожа · сапоги · перчатки'},jeweler:{name:'Ювелир',icon:'💍',recipes:'кольца · амулеты · аксессуары'},runesmith:{name:'Рунописец',icon:'🔮',recipes:'руны · улучшения · наборы'}};
function ensure(){
 const s=Store.state,e=s.economy=Object.assign({},DEFAULT,s.economy||{});
 e.resources=Object.assign({},e.resources||{});e.professions=Object.assign({},DEFAULT.professions,e.professions||{});
 Object.keys(PROFESSIONS).forEach(k=>e.professions[k]=Object.assign({},DEFAULT.professions[k],e.professions[k]||{}));
 e.permanentGear=Array.isArray(e.permanentGear)?e.permanentGear:[];e.resourceRuns=Object.assign({},DEFAULT.resourceRuns,e.resourceRuns||{});
 e.resourceRuns.history=Array.isArray(e.resourceRuns.history)?e.resourceRuns.history:[];e.auction=Object.assign({},DEFAULT.auction,e.auction||{});
 e.auction.listings=Array.isArray(e.auction.listings)?e.auction.listings:[];e.auction.sales=Array.isArray(e.auction.sales)?e.auction.sales:[];
 e.contracts=Object.assign({},DEFAULT.contracts,e.contracts||{});e.contracts.orders=Array.isArray(e.contracts.orders)?e.contracts.orders:[];e.contracts.completed=Array.isArray(e.contracts.completed)?e.contracts.completed:[];
 e.ledger=Object.assign({},DEFAULT.ledger,e.ledger||{});e.ledger.entries=Array.isArray(e.ledger.entries)?e.ledger.entries:[];e.ledger.pendingWithdrawals=Array.isArray(e.ledger.pendingWithdrawals)?e.ledger.pendingWithdrawals:[];
 e.policy=Object.assign({},DEFAULT.policy,e.policy||{});return e;
}
function save(){Store.saveNow?.();window.dispatchEvent(new CustomEvent('territory:economy-changed'))}
function addResource(id,n){const e=ensure(),q=Math.max(0,Math.floor(Number(n)||0));if(!q)return;e.resources[id]=(Number(e.resources[id])||0)+q;save()}
function addProfessionXp(id,n){const e=ensure(),p=e.professions[id];if(!p)return false;p.xp+=Math.max(0,Math.floor(Number(n)||0));while(p.level<300&&p.xp>=p.level*100){p.xp-=p.level*100;p.level++}save();return true}
function startRun(id){const e=ensure();if(e.resourceRuns.active)return false;const loc=MAP.find(x=>x.id===id);if(!loc)return false;e.resourceRuns.active={id:'run_'+Date.now(),locationId:id,startedAt:Date.now(),encounterPending:false,collected:{}};save();render();return true}
function collect(){const e=ensure(),r=e.resourceRuns.active;if(!r)return{ok:false,reason:'no_run'};if(r.encounterPending)return{ok:false,reason:'encounter'};const loc=MAP.find(x=>x.id===r.locationId);if(!loc)return{ok:false,reason:'location'};const gained={};loc.resources.forEach(([,id],i)=>{const q=1+Math.floor(Math.random()*(i===0?4:3));gained[id]=q;addResource(id,q);r.collected[id]=(r.collected[id]||0)+q});if(Math.random()<0.38)r.encounterPending=true;save();render();return{ok:true,gained,encounter:r.encounterPending}}
function resolveEncounter(win){const e=ensure(),r=e.resourceRuns.active;if(!r)return false;if(win){r.encounterPending=false;addResource('battle_token',1)}else{r.encounterPending=false;r.paused=true}save();render();return true}
function stopRun(){const e=ensure();if(!e.resourceRuns.active)return false;e.resourceRuns.history.push(e.resourceRuns.active);e.resourceRuns.history=e.resourceRuns.history.slice(-30);e.resourceRuns.active=null;save();render();return true}
function createPermanentGear(item,profession){const e=ensure(),g=Object.assign({},JSON.parse(JSON.stringify(item||{})),{id:item?.id||'gear_'+Date.now(),permanent:true,profession,upgradeLevel:Number(item?.upgradeLevel)||0,createdAt:new Date().toISOString()});e.permanentGear.push(g);e.permanentGear=e.permanentGear.slice(-200);save();return g}
function createListing(itemId,price,currency='coins'){const e=ensure(),p=Math.max(1,Number(price)||0);if(!itemId||!['coins','blueDiamonds'].includes(currency))return null;const l={id:'lst_'+Date.now(),itemId:String(itemId),price:p,currency,status:'active',sellerId:'player',createdAt:new Date().toISOString()};e.auction.listings.push(l);save();return l}
function recordSale(listingId){const e=ensure(),l=e.auction.listings.find(x=>x.id===listingId);if(!l||l.status!=='active')return null;const fee=l.price*Number(e.policy.marketFeePct||10)/100,net=l.price-fee;l.status='sold';const sale={id:'sale_'+Date.now(),listingId,gross:l.price,fee,net,currency:l.currency,createdAt:new Date().toISOString()};e.auction.sales.push(sale);e.ledger.entries.push(Object.assign({type:'market_sale'},sale));save();return sale}
function requestWithdrawal(amount){const e=ensure(),gross=Number(amount)||0;if(gross<Number(e.policy.minWithdrawal||5))return{ok:false,reason:'minimum'};const fee=gross*Number(e.policy.withdrawalFeePct||7)/100;const req={id:'wd_'+Date.now(),gross,fee,net:gross-fee,status:'pending_review',reviewDays:Number(e.policy.reviewDays||5),createdAt:new Date().toISOString()};e.ledger.pendingWithdrawals.push(req);save();return req}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function render(){
 const h=document.getElementById('world');if(!h)return;const e=ensure(),r=e.resourceRuns.active;
 const resourceRows=Object.entries(e.resources).filter(([,v])=>v>0).slice(0,12).map(([k,v])=>'<span>'+esc(k)+'</span><b>'+Math.floor(v)+'</b>').join('');
 h.innerHTML='<header class="eco-head"><div><h1>🗺️ Мир Territory</h1><p>Добыча → мастер → экипировка → аукцион</p></div><div class="eco-balance">🪙 '+Math.floor(Store.state.coins||0)+' · 🔵 '+Math.floor(Store.state.gems||0)+' · 🔴 '+Math.floor(Store.state.redGems||0)+'</div></header>'+
 '<div class="eco-note">Разные игроки могут заниматься разными делами: один добывает ресурсы, другой создаёт постоянный шмот, третий покупает готовый предмет. Во время добычи возможна атака бота.</div>'+
 '<div class="eco-map">'+MAP.map(loc=>'<button type="button" class="eco-location" data-location="'+loc.id+'"><strong>'+loc.icon+' '+loc.name+'</strong><small>'+loc.resources.map(x=>x[0]).join(' · ')+'</small><em>Опасность: '+loc.risk+'</em></button>').join('')+'</div>'+
 '<section class="eco-card"><h2>⛏️ Текущая добыча</h2>'+(r?'<p><b>'+esc(MAP.find(x=>x.id===r.locationId)?.name||'Локация')+'</b></p><div class="eco-actions"><button class="eco-btn" data-collect>⛏️ Добыть</button><button class="eco-btn" data-stop>⏹ Остановить</button></div>'+(r.encounterPending?'<div class="eco-danger"><b>⚠️ Нападение!</b><p>Бот остановил добычу. Победи его, чтобы продолжить.</p><button class="eco-btn" data-win>⚔️ Убить бота</button></div>':''):'<p>Добыча не запущена. Выбери локацию выше.</p>')+'</section>'+
 '<section class="eco-grid"><div class="eco-card"><h2>📦 Ресурсы</h2><div class="eco-resources">'+(resourceRows||'<small>Пока пусто</small>')+'</div></div>'+
 '<div class="eco-card"><h2>🔨 Профессии</h2>'+Object.entries(PROFESSIONS).map(([id,p])=>{const q=e.professions[id];return '<div class="eco-row"><span>'+p.icon+' '+p.name+'</span><b>'+q.level+'/300</b></div>'}).join('')+'</div></section>'+
 '<section class="eco-grid"><div class="eco-card"><h2>🏪 Аукцион</h2><p>Комиссия сделки: <b>'+e.policy.marketFeePct+'%</b>. Торговля между игроками будет серверной.</p><button class="eco-btn" data-demo-sale>Показать механику продажи</button></div>'+
 '<div class="eco-card"><h2>💼 Заказ мастеру</h2><p>Игрок может принести свои материалы и договориться о цене изготовления за золото, синие или красные алмазы.</p><button class="eco-btn" data-contract>Создать заказ</button></div></section>'+
 '<section class="eco-card"><h2>💰 Будущий вывод</h2><p>Заработок проходит через pending-проверку. Срок проверки: до '+e.policy.reviewDays+' дней. Комиссия вывода: '+e.policy.withdrawalFeePct+'%.</p><small>Браузер не получает право сам перечислять деньги — окончательное решение только сервер + антифрод.</small></section>';
 h.querySelectorAll('[data-location]').forEach(b=>b.onclick=()=>startRun(b.dataset.location));
 h.querySelector('[data-collect]')?.addEventListener('click',collect);h.querySelector('[data-stop]')?.addEventListener('click',stopRun);h.querySelector('[data-win]')?.addEventListener('click',()=>resolveEncounter(true));
 h.querySelector('[data-demo-sale]')?.addEventListener('click',()=>modal('Аукцион','Продажа: цена → комиссия '+e.policy.marketFeePct+'% → чистая сумма продавцу. Реальные деньги не создаются клиентом.'));
 h.querySelector('[data-contract]')?.addEventListener('click',()=>modal('Заказ мастеру','Следующий слой подключит рецепты, материалы, срок изготовления, репутацию мастера и оплату заказа.'));
}
function modal(t,b){const m=document.getElementById('modal'),x=document.getElementById('modalBody');if(!m||!x)return;x.innerHTML='<h2>'+t+'</h2><p>'+b+'</p>';m.classList.add('show')}
function init(){ensure();window.TerritoryEconomyFoundation={MAP,PROFESSIONS,ensure,startRun,collect,resolveEncounter,stopRun,addResource,addProfessionXp,createPermanentGear,createListing,recordSale,requestWithdrawal,render};document.addEventListener('click',e=>{const b=e.target.closest('[data-home-action="sea"]');if(b){e.preventDefault();window.showScreen?.('world')}},true);window.addEventListener('territory:screen',e=>{if(e.detail==='world')render()});window.addEventListener('territory:economy-changed',()=>{if(document.body.dataset.screen==='world')render()})}
init();
})();