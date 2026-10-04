(function(){
'use strict';
/* Territory Economy Foundation v1
 * PvE progression + Arena + professions + resource map + auction + future cash-out ledger.
 * This module is intentionally server-ready: no client balance is treated as withdrawable cash.
 */
if(window.TerritoryEconomyFoundation)return;
const Store=window.TerritoryStore;
if(!Store)return;
const clone=v=>JSON.parse(JSON.stringify(v));
const DEFAULT_ECO={
  version:1,
  currencies:{coins:0,blueDiamonds:0,redDiamonds:0},
  professions:{blacksmith:{level:1,xp:0},leatherworker:{level:1,xp:0},jeweler:{level:1,xp:0},runesmith:{level:1,xp:0}},
  resources:{},
  permanentGear:[],
  resourceRuns:{active:null,history:[]},
  auction:{listings:[],sales:[],buyOrders:[]},
  contracts:{orders:[],completed:[]},
  economyLedger:{entries:[],pendingWithdrawals:[]},
  payoutPolicy:{marketFeePct:10,withdrawalFeePct:7,reviewDays:5,minWithdrawal:5},
  licenses:[],
  reputation:{},
  resourceMapVersion:1
};
const MAP=[
 {id:'greenwood',name:'Зелёный лес',type:'gather',resources:[['wood',55],['resin',25],['leather',20]],risk:'low'},
 {id:'ironmine',name:'Железные рудники',type:'mine',resources:[['iron_ore',60],['coal',25],['stone',15]],risk:'low'},
 {id:'silverpeak',name:'Серебряные вершины',type:'mine',resources:[['silver_ore',55],['crystal',25],['coal',20]],risk:'medium'},
 {id:'runewastes',name:'Рунические пустоши',type:'arcane',resources:[['rune_shard',50],['mana_crystal',30],['ancient_dust',20]],risk:'high'},
 {id:'dragonvale',name:'Долина драконов',type:'rare',resources:[['dragon_scale',45],['dragon_bone',30],['fire_core',25]],risk:'very_high'}
];
const PROFESSIONS={
 blacksmith:{name:'Кузнец',recipes:['weapon','armor','shield']},
 leatherworker:{name:'Кожевник',recipes:['light_armor','boots','gloves']},
 jeweler:{name:'Ювелир',recipes:['ring','amulet','arena_accessory']},
 runesmith:{name:'Рунописец',recipes:['rune','rune_upgrade','rune_set']}
};
function ensure(){
 const s=Store.state;
 s.economy=Object.assign({},DEFAULT_ECO,s.economy||{});
 s.economy.currencies=Object.assign({},DEFAULT_ECO.currencies,s.economy.currencies||{});
 s.economy.professions=Object.assign({},DEFAULT_ECO.professions,s.economy.professions||{});
 Object.keys(PROFESSIONS).forEach(k=>s.economy.professions[k]=Object.assign({},DEFAULT_ECO.professions[k],s.economy.professions[k]||{}));
 s.economy.resources=Object.assign({},s.economy.resources||{});
 s.economy.permanentGear=Array.isArray(s.economy.permanentGear)?s.economy.permanentGear:[];
 s.economy.resourceRuns=Object.assign({},DEFAULT_ECO.resourceRuns,s.economy.resourceRuns||{});
 s.economy.resourceRuns.history=Array.isArray(s.economy.resourceRuns.history)?s.economy.resourceRuns.history:[];
 s.economy.auction=Object.assign({},DEFAULT_ECO.auction,s.economy.auction||{});
 ['listings','sales','buyOrders'].forEach(k=>s.economy.auction[k]=Array.isArray(s.economy.auction[k])?s.economy.auction[k]:[]);
 s.economy.contracts=Object.assign({},DEFAULT_ECO.contracts,s.economy.contracts||{});
 s.economy.contracts.orders=Array.isArray(s.economy.contracts.orders)?s.economy.contracts.orders:[];
 s.economy.contracts.completed=Array.isArray(s.economy.contracts.completed)?s.economy.contracts.completed:[];
 s.economy.economyLedger=Object.assign({},DEFAULT_ECO.economyLedger,s.economy.economyLedger||{});
 s.economy.economyLedger.entries=Array.isArray(s.economy.economyLedger.entries)?s.economy.economyLedger.entries:[];
 s.economy.economyLedger.pendingWithdrawals=Array.isArray(s.economy.economyLedger.pendingWithdrawals)?s.economy.economyLedger.pendingWithdrawals:[];
 s.economy.payoutPolicy=Object.assign({},DEFAULT_ECO.payoutPolicy,s.economy.payoutPolicy||{});
 s.economy.licenses=Array.isArray(s.economy.licenses)?s.economy.licenses:[];
 s.economy.reputation=Object.assign({},s.economy.reputation||{});
 return s.economy;
}
function save(){Store.saveNow?.();window.dispatchEvent(new CustomEvent('territory:economy-changed'));}
function addResource(id,qty){const e=ensure();const n=Math.max(0,Math.floor(Number(qty)||0));if(!n)return 0;e.resources[id]=(Number(e.resources[id])||0)+n;save();return n;}
function professionLevel(id){const p=ensure().professions[id];return p?Math.max(1,Math.min(300,Number(p.level)||1)):0;}
function addProfessionXp(id,xp){const e=ensure(),p=e.professions[id];if(!p)return false;p.xp+=Math.max(0,Number(xp)||0);while(p.level<300&&p.xp>=p.level*100){p.xp-=p.level*100;p.level++;}save();return true;}
function startResourceRun(locationId){const e=ensure(),loc=MAP.find(x=>x.id===locationId);if(!loc||e.resourceRuns.active)return false;e.resourceRuns.active={id:'run_'+Date.now(),locationId,startedAt:new Date().toISOString(),paused:false,encounterPending:false,collected:{}};save();return true;}
function resolveEncounter(won=true){const e=ensure(),run=e.resourceRuns.active;if(!run)return false;if(won){run.encounterPending=false;save();return true}run.paused=true;run.encounterPending=false;save();return false;}
function collectResource(locationId,minutes=10){const e=ensure(),run=e.resourceRuns.active;if(!run||run.locationId!==locationId||run.paused)return null;const loc=MAP.find(x=>x.id===locationId);const cycles=Math.max(1,Math.min(12,Math.floor(Number(minutes)/10)||1));const gained={};loc.resources.forEach(([id,weight])=>{const amount=Math.max(0,Math.floor(cycles*(weight/25)*(0.7+Math.random()*0.6)));if(amount){gained[id]=amount;addResource(id,amount);run.collected[id]=(run.collected[id]||0)+amount;}});if(Math.random()<Math.min(.65,.08*cycles+(loc.risk==='very_high'?.2:0)))run.encounterPending=true;save();return gained;}
function stopResourceRun(){const e=ensure();if(!e.resourceRuns.active)return false;e.resourceRuns.history.push(e.resourceRuns.active);e.resourceRuns.history=e.resourceRuns.history.slice(-50);e.resourceRuns.active=null;save();return true;}
function createPermanentGear(item,creatorProfession){const e=ensure();const gear=Object.assign({},item,{id:item?.id||('gear_'+Date.now()),permanent:true,creatorProfession,createdAt:new Date().toISOString(),upgradeLevel:Number(item?.upgradeLevel)||0});e.permanentGear.push(gear);e.permanentGear=e.permanentGear.slice(-200);save();return gear;}
function createListing(itemId,price,currency='coins'){const e=ensure(),n=Math.max(1,Number(price)||0);if(!itemId||!['coins','blueDiamonds'].includes(currency))return null;const listing={id:'lst_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),itemId:String(itemId),price:n,currency,sellerId:'player',createdAt:new Date().toISOString(),status:'active'};e.auction.listings.push(listing);save();return listing;}
function recordSale(listingId,price,currency='coins'){const e=ensure(),listing=e.auction.listings.find(x=>x.id===listingId);if(!listing||listing.status!=='active')return null;const feePct=Math.max(0,Math.min(25,Number(e.payoutPolicy.marketFeePct)||10));const fee=price*feePct/100;const sellerNet=price-fee;listing.status='sold';const sale={id:'sale_'+Date.now(),listingId,price,currency,fee,sellerNet,soldAt:new Date().toISOString()};e.auction.sales.push(sale);e.economyLedger.entries.push({type:'market_sale',saleId:sale.id,gross:price,fee,net:sellerNet,currency,createdAt:sale.soldAt});save();return sale;}
function createCraftContract(recipe,materials,fee,currency='blueDiamonds'){const e=ensure();if(!recipe||!['coins','blueDiamonds','redDiamonds'].includes(currency))return null;const order={id:'contract_'+Date.now(),recipe,materials:clone(materials||{}),fee:Math.max(0,Number(fee)||0),currency,clientId:'player',status:'open',createdAt:new Date().toISOString()};e.contracts.orders.push(order);save();return order;}
function requestWithdrawal(amount){const e=ensure(),n=Number(amount)||0;if(n<e.payoutPolicy.minWithdrawal)return {ok:false,reason:'minimum'};const feePct=Math.max(0,Math.min(25,Number(e.payoutPolicy.withdrawalFeePct)||7));const fee=n*feePct/100;const req={id:'wd_'+Date.now(),gross:n,fee,net:n-fe,status:'pending_review',reviewDays:e.payoutPolicy.reviewDays,createdAt:new Date().toISOString()};e.economyLedger.pendingWithdrawals.push(req);save();return req;}
function renderWorld(){const host=document.getElementById('world');if(!host)return;const e=ensure();host.innerHTML='<div class="eco-head"><div><h1>🗺️ Мир ресурсов</h1><p>Локации, добыча и экономика игроков</p></div><div class="eco-balance">🔵 '+Math.floor(e.currencies.blueDiamonds||0)+' · 🔴 '+Math.floor(e.currencies.redDiamonds||0)+'</div></div><div class="eco-note">Ресурсы добываются игроками и становятся сырьём для постоянной экипировки. Во время добычи возможны нападения ботов.</div><div class="eco-map">'+MAP.map(loc=>'<button class="eco-location" data-location="'+loc.id+'"><b>'+loc.name+'</b><small>'+loc.resources.map(x=>x[0]).join(' · ')+'</small><em>Риск: '+loc.risk+'</em></button>').join('')+'</div><div class="eco-sections"><div class="eco-card"><h2>🔨 Профессии</h2>'+Object.entries(PROFESSIONS).map(([id,p])=>{const pr=e.professions[id];return '<div class="eco-row"><b>'+p.name+'</b><span>ур. '+pr.level+'/300</span></div>'}).join('')+'</div><div class="eco-card"><h2>🏪 Аукцион</h2><p>Продажа ресурсов и постоянного шмота между игроками. Комиссия рынка: '+e.payoutPolicy.marketFeePct+'%.</p><button class="eco-btn" data-auction>Открыть аукцион</button></div><div class="eco-card"><h2>💼 Мастерские</h2><p>Игрок может добыть материалы сам и заказать предмет мастеру за золото, синие или премиальные красные алмазы.</p></div></div>';
 host.querySelectorAll('[data-location]').forEach(b=>b.onclick=()=>{const id=b.dataset.location;if(startResourceRun(id)){modalEco('Добыча запущена','Локация '+MAP.find(x=>x.id===id).name+'. Периодически может появиться бот.');}});
 host.querySelector('[data-auction]')?.addEventListener('click',()=>modalEco('Аукцион','Здесь будет полноценная торговая площадка игрок ↔ игрок. Архитектура комиссии и журнала сделки уже заложена.'));
}
function modalEco(title,body){const m=document.getElementById('modal'),b=document.getElementById('modalBody');if(!m||!b)return;b.innerHTML='<h2>'+title+'</h2><p>'+body+'</p>';m.classList.add('show');}
function init(){ensure();document.addEventListener('click',function(ev){const b=ev.target.closest('[data-home-action=\"sea\"]');if(b){ev.preventDefault();window.showScreen?.('world');}},true);window.TerritoryEconomyFoundation={MAP,PROFESSIONS,ensure,addResource,professionLevel,addProfessionXp,startResourceRun,resolveEncounter,collectResource,stopResourceRun,createPermanentGear,createListing,recordSale,createCraftContract,requestWithdrawal,renderWorld};window.addEventListener('territory:screen',e=>{if(e.detail==='world')renderWorld()});window.addEventListener('territory:economy-changed',()=>{if(document.body.dataset.screen==='world')renderWorld()});}
init();
})();
