(function(){
'use strict';
const DEFAULT={
 profile:{displayName:'Игрок',level:1,vip:0},
 economyVersion:1,
 level:1,coins:0,gems:0,redGems:0,battleStones:30,battleStonesBonus:0,battleStonesDate:'',battleStonesCap:30,energy:100,maxEnergy:100,hp:100,maxHp:100,
 xp:0,xpNext:100,exp:0,expToNext:100,dice:10,pos:0,equipment:Array(7).fill(null),
 inventoryItems:[],
 followers:{activeFollower:null},
 consumables:{elixir_hp:0,elixir_energy:0,elixir_attack:0,elixir_guard:0,adrenaline:0,speed_scroll:0,anti_speed_scroll:0},
 arena:{rating:1000,wins:0,losses:0,battles:0,combatSlotsUnlocked:3,loadout:'crit',gear:Array(7).fill(null)},
 activeFollower:null,auto:false,consumables:{elixir_hp:3,elixir_energy:2,elixir_attack:1,elixir_guard:2,adrenaline:1,speed_scroll:1,anti_speed_scroll:1},arena:{rating:1000,wins:0,losses:0,battles:0,loadout:'crit'},
 currentChapter:1,chapterStage:1,chapterProgress:0,chapterBossUnlocked:false,chapterBossDefeated:false,chapterCompleted:false,
 pve:{chapter:1,stage:1,progress:0,bossPending:false,bossActive:false,bossDefeated:0,wins:0},
 forge:{materials:0,selectedId:null,successes:0,failStreak:0},
 chapterRewardsClaimed:{},
achievementClaims:{},
 daily:{date:'',claims:{},wins:0,loot:0,forge:0,bosses:0},
 weekly:{week:'',claims:{},wins:0,loot:0,forge:0,bosses:0,chapters:0},
 story:{step:0,progress:0,claimed:{},started:false},
 chapterEvents:{},
 worldLocationActions:{},
 worldLocationRewards:{},
 worldEchoes:{},
heroChronicle:{},
worldConvergence:{stage:0,path:null,claimed:false,chapter:0},
worldBranchEvents:{},
worldPathFrontiers:{},
worldFrontierAftermath:{}
};
window.TerritoryStore=window.TerritoryStore||{};
const Store=window.TerritoryStore;
function StoreXpTarget(level){const l=Math.max(1,Number(level)||1);return Math.max(100,Math.round(90+12*Math.pow(l,1.5)))}
function StoreDailyBattleCap(level){const l=Math.max(1,Number(level)||1);return l<=10?20:(l<=25?12:10)}
function clone(v){return JSON.parse(JSON.stringify(v))}
function normalize(saved){
 const s=Object.assign(clone(DEFAULT),saved||{});
 s.profile=Object.assign({},DEFAULT.profile,s.profile||{});
 s.level=Math.max(1,Number(s.level||s.profile.level)||1);s.profile.level=s.level;
 s.xp=Math.max(0,Number(s.xp??s.exp)||0);s.xpNext=Math.max(1,Number(s.xpNext??s.expToNext)||100);
 s.exp=s.xp;s.expToNext=s.xpNext;
 s.coins=Math.max(0,Number(s.coins)||0);s.gems=Math.max(0,Number(s.gems)||0);s.redGems=Math.max(0,Number(s.redGems)||0);s.battleStonesCap=StoreDailyBattleCap(s.level);s.battleStones=Math.max(0,Number(s.battleStones??s.battleStonesCap)||0);s.battleStonesBonus=Math.max(0,Number(s.battleStonesBonus)||0);
 s.energy=Math.max(0,Number(s.energy)||0);s.maxEnergy=Math.max(1,Number(s.maxEnergy)||100);
 s.maxHp=Math.max(1,Number(s.maxHp)||100);s.hp=Math.max(0,Math.min(s.maxHp,Number(s.hp??s.maxHp)||s.maxHp));
 s.equipment=Array.isArray(s.equipment)?s.equipment.slice(0,7):Array(7).fill(null);while(s.equipment.length<7)s.equipment.push(null);s.consumables=Object.assign({},DEFAULT.consumables,s.consumables||{});s.arena=Object.assign({},DEFAULT.arena,s.arena||{});
 s.inventoryItems=Array.isArray(s.inventoryItems)?s.inventoryItems.slice(0,100):[];
 s.followers=Object.assign({},DEFAULT.followers,s.followers||{});
 s.followers.activeFollower=s.followers.activeFollower??s.activeFollower??null;
 s.activeFollower=s.followers.activeFollower;
 s.consumables=Object.assign({},DEFAULT.consumables,s.consumables||{});
 Object.keys(DEFAULT.consumables).forEach(k=>{s.consumables[k]=Math.max(0,Number(s.consumables[k])||0)});
 s.arena=Object.assign({},DEFAULT.arena,s.arena||{});
 s.arena.rating=Math.max(0,Number(s.arena.rating)||1000);
 s.arena.wins=Math.max(0,Number(s.arena.wins)||0);s.arena.losses=Math.max(0,Number(s.arena.losses)||0);s.arena.battles=Math.max(0,Number(s.arena.battles)||0);
 s.arena.combatSlotsUnlocked=Math.max(0,Math.min(6,Number(s.arena.combatSlotsUnlocked)||3));
 s.arena.loadout=['crit','tank','dodge','resilience'].includes(s.arena.loadout)?s.arena.loadout:'crit';
 s.arena.gear=Array.isArray(s.arena.gear)?s.arena.gear.slice(0,7):Array(7).fill(null);while(s.arena.gear.length<7)s.arena.gear.push(null);
 for(let i=0;i<7;i++){if(!s.arena.gear[i]&&s.equipment[i]?.id)s.arena.gear[i]=s.equipment[i].id;}
 s.currentChapter=Math.max(1,Math.min(240,Number(s.currentChapter||s.pve?.chapter)||1));
 s.chapterStage=Math.max(1,Number(s.chapterStage||s.pve?.stage)||1);
 s.chapterProgress=Math.max(0,Math.min(100,Number(s.chapterProgress??s.pve?.progress)||0));
 s.chapterBossUnlocked=Boolean(s.chapterBossUnlocked||s.pve?.bossPending||s.chapterProgress>=100);
 s.chapterBossDefeated=Boolean(s.chapterBossDefeated||false);
 s.pve=Object.assign({},DEFAULT.pve,s.pve||{},{chapter:s.currentChapter,stage:s.chapterStage,progress:s.chapterProgress,bossPending:s.chapterBossUnlocked,bossActive:Boolean(s.pve?.bossActive),wins:Number(s.pve?.wins)||0,bossDefeated:Number(s.pve?.bossDefeated)||0});
 s.lootFound=Math.max(0,Number(s.lootFound)||0);
 s.forge=Object.assign({},DEFAULT.forge,s.forge||{});s.forge.materials=Math.max(0,Number(s.forge.materials)||0);s.forge.selectedId=s.forge.selectedId||null;s.forge.successes=Math.max(0,Number(s.forge.successes)||0);s.forge.failStreak=Math.max(0,Number(s.forge.failStreak)||0);
 s.chapterRewardsClaimed=Object.assign({},DEFAULT.chapterRewardsClaimed,s.chapterRewardsClaimed||{});
 s.achievementClaims=Object.assign({},DEFAULT.achievementClaims,s.achievementClaims||{});
 const now=new Date();const today=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
 if(s.battleStonesDate!==today){s.battleStonesDate=today;s.battleStones=Math.max(0,Number(s.battleStones)||0);if(s.battleStones<s.battleStonesCap)s.battleStones=s.battleStonesCap;}
 s.daily=Object.assign({},DEFAULT.daily,s.daily||{});
 if(s.daily.date!==today){s.daily={date:today,claims:{},wins:0,loot:0,forge:0,bosses:0};}
 s.daily.claims=Object.assign({},s.daily.claims||{});
 s.daily.wins=Math.max(0,Number(s.daily.wins)||0);s.daily.loot=Math.max(0,Number(s.daily.loot)||0);s.daily.forge=Math.max(0,Number(s.daily.forge)||0);s.daily.bosses=Math.max(0,Number(s.daily.bosses)||0);
 const wd=new Date(); const weekStart=new Date(wd); weekStart.setHours(0,0,0,0); weekStart.setDate(wd.getDate()-((wd.getDay()+6)%7)); const week=weekStart.getFullYear()+'-'+String(weekStart.getMonth()+1).padStart(2,'0')+'-'+String(weekStart.getDate()).padStart(2,'0'); s.weekly=Object.assign({},DEFAULT.weekly,s.weekly||{}); if(s.weekly.week!==week)s.weekly={week,claims:{},wins:0,loot:0,forge:0,bosses:0,chapters:0}; s.weekly.claims=Object.assign({},s.weekly.claims||{}); ['wins','loot','forge','bosses','chapters'].forEach(k=>s.weekly[k]=Math.max(0,Number(s.weekly[k])||0));
 s.pve.wins=Math.max(0,Number(s.pve.wins)||0);s.pve.bossDefeated=Math.max(0,Number(s.pve.bossDefeated)||0);
 s.chapterEvents=Object.assign({},DEFAULT.chapterEvents,s.chapterEvents||{});
 s.worldLocationActions=Object.assign({},DEFAULT.worldLocationActions,s.worldLocationActions||{});
 s.worldLocationRewards=Object.assign({},DEFAULT.worldLocationRewards,s.worldLocationRewards||{});
s.premium=Object.assign({},DEFAULT.premium,s.premium||{});s.premium.paidGems=Math.max(0,Number(s.premium.paidGems)||0);s.premium.transactions=Array.isArray(s.premium.transactions)?s.premium.transactions:[];s.premium.firstPurchaseClaimed=Boolean(s.premium.firstPurchaseClaimed);
 s.worldMemories=Object.assign({},DEFAULT.worldMemories,s.worldMemories||{});
 s.worldEchoes=Object.assign({},DEFAULT.worldEchoes,s.worldEchoes||{});
 s.heroChronicle=Object.assign({},DEFAULT.heroChronicle,s.heroChronicle||{});
 s.worldConvergence=Object.assign({},DEFAULT.worldConvergence,s.worldConvergence||{});s.worldConvergence.stage=Math.max(0,Math.min(2,Number(s.worldConvergence.stage)||0));s.worldConvergence.claimed=Boolean(s.worldConvergence.claimed);s.worldConvergence.chapter=Math.max(0,Number(s.worldConvergence.chapter)||0);
 s.worldBranchEvents=Object.assign({},DEFAULT.worldBranchEvents,s.worldBranchEvents||{});s.worldPathFrontiers=Object.assign({},DEFAULT.worldPathFrontiers,s.worldPathFrontiers||{});s.worldFrontierAftermath=Object.assign({},DEFAULT.worldFrontierAftermath,s.worldFrontierAftermath||{});
 s.worldFinale=Object.assign({},DEFAULT.worldFinale,s.worldFinale||{});s.worldFinale.claimed=Boolean(s.worldFinale.claimed);s.worldFinale.chapter=Math.max(0,Number(s.worldFinale.chapter)||0);
 s.npcRelations=Object.assign({},DEFAULT.npcRelations,s.npcRelations||{});
 s.npcInteractionLog=Object.assign({},DEFAULT.npcInteractionLog,s.npcInteractionLog||{});
 s.npcRewards=Object.assign({},DEFAULT.npcRewards,s.npcRewards||{});
 s.npcQuests=Object.assign({},DEFAULT.npcQuests,s.npcQuests||{});s.npcQuests.claimed=Object.assign({},s.npcQuests.claimed||{});s.npcQuests.progress=Object.assign({},s.npcQuests.progress||{});
 s.npcStories=Object.assign({},DEFAULT.npcStories,s.npcStories||{});
 s.npcStoryAftermath=Object.assign({},DEFAULT.npcStoryAftermath,s.npcStoryAftermath||{});
 s.story=Object.assign({},DEFAULT.story,s.story||{});s.story.step=Math.max(0,Math.min(5,Number(s.story.step)||0));s.story.progress=Math.max(0,Number(s.story.progress)||0);s.story.claimed=Object.assign({},s.story.claimed||{});s.story.started=Boolean(s.story.started||s.story.step>0||s.story.progress>0);
 const xpLevel=Math.max(1,Number(s.level)||1); const targetXp=StoreXpTarget(xpLevel); if(Number(s.economyVersion||0)<1){ const oldNext=Math.max(1,Number(s.xpNext)||100); const ratio=Math.max(0,Math.min(.999,Number(s.xp||0)/oldNext)); s.xpNext=targetXp; s.xp=Math.min(Math.max(0,Math.floor(targetXp*ratio)),targetXp-1); s.exp=s.xp; s.expToNext=s.xpNext; s.economyVersion=1; } else { s.xpNext=targetXp; s.exp=s.xp; s.expToNext=s.xpNext; }
 return s;
}
let saved=null;try{saved=JSON.parse(localStorage.getItem('territory_store_v1')||'null')}catch(_){}
Store.state=normalize(saved);
Store.saveNow=function(){try{localStorage.setItem('territory_store_v1',JSON.stringify(Store.state))}catch(_){};window.dispatchEvent(new CustomEvent('territory:state-changed'))};
Store.normalize=normalize;
Store.addXp=function(amount){
 let s=Store.state;const gain=Math.max(0,Number(amount)||0);if(!gain)return;
 s.xp+=gain;
 let levels=0;
 while(s.xp>=s.xpNext){s.xp-=s.xpNext;s.level++;levels++;s.profile.level=s.level;s.xpNext=StoreXpTarget(s.level)}
 s.exp=s.xp;s.expToNext=s.xpNext;Store.saveNow();
 if(levels>0)window.dispatchEvent(new CustomEvent('territory:level-up',{detail:{level:s.level,levels}}));
};
Store.trackProgress=function(key,count=1){
 const n=Math.max(0,Number(count)||0);if(!n)return;
 const keys=['wins','loot','forge','bosses','chapters'];if(!keys.includes(key))return;
 const s=Store.state;
 s.weekly=s.weekly||{week:'',claims:{},wins:0,loot:0,forge:0,bosses:0,chapters:0};
 s.daily=s.daily||{date:'',claims:{},wins:0,loot:0,forge:0,bosses:0};
 s.weekly[key]=Math.max(0,Number(s.weekly[key])||0)+n;
 s.daily[key]=Math.max(0,Number(s.daily[key])||0)+n;
 Store.saveNow();
};
const PROGRESSION_BANDS=[
 {min:1,max:10,name:'Втягивание',note:'Быстрые уровни и частые открытия.'},
 {min:11,max:25,name:'Освоение',note:'Появляется выбор билдов и заметнее стоимость развития.'},
 {min:26,max:50,name:'Мастерство',note:'Каждый уровень становится ценнее, а долгие цели начинают работать.'},
 {min:51,max:100,name:'Легенда',note:'Длинный горизонт: коллекции, Arena и сюжетные ветки.'},
 {min:101,max:240,name:'Наследие',note:'Медленный эндгейм без жёсткого потолка.'}
];
Store.getProgressionBand=function(level){const n=Math.max(1,Number(level)||1);return PROGRESSION_BANDS.find(b=>n>=b.min&&n<=b.max)||PROGRESSION_BANDS[PROGRESSION_BANDS.length-1]};
Store.getProgressionSummary=function(){const s=Store.state,b=Store.getProgressionBand(s.level);return {level:s.level,xp:s.xp,xpNext:s.xpNext,band:b.name,note:b.note,freeDailyBattles:s.battleStonesCap,economyVersion:s.economyVersion||1}};
Store.getEconomyProfile=function(level){const l=Math.max(1,Number(level)||1);const band=Store.getProgressionBand(l);return {level:l,band:band.name,xpNext:StoreXpTarget(l),forgeCostMultiplier:Math.min(3.2,1+(Math.max(0,l-1)/55)),dailyBattleCap:StoreDailyBattleCap(l)}};
Store.getDerivedStats=function(){return {maxHp:Store.state.maxHp,strength:125+Store.state.level*2,defense:98+Store.state.level,agility:101+Store.state.level}};
Store.getItemById=function(id){if(!id)return null;const s=Store.state;const all=[...(Array.isArray(s.equipment)?s.equipment:[]),...(Array.isArray(s.inventoryItems)?s.inventoryItems:[])];return all.find(x=>x&&String(x.id)===String(id))||null};
Store.getArenaGear=function(){const s=Store.state;const refs=Array.isArray(s.arena?.gear)?s.arena.gear:[];return Array.from({length:7},(_,i)=>{const ref=refs[i];return Store.getItemById(ref)||s.equipment?.[i]||null})};
Store.getArenaGearStats=function(){const gear=Store.getArenaGear();const out={attack:0,defense:0,agility:0,maxHp:0,critChance:0,damageReduction:0,bonusXp:0,count:0};gear.forEach(it=>{if(!it)return;out.count++;out.attack+=Number(it.attack??it.strength??it.damage??it.atk)||0;out.defense+=Number(it.defense??it.def??it.armor??it.guard)||0;out.agility+=Number(it.agility??it.agi??it.speed)||0;out.maxHp+=Number(it.maxHp??it.hp??it.health)||0;out.critChance+=Number(it.critChance)||0;out.damageReduction+=Number(it.damageReduction)||0;out.bonusXp+=Number(it.bonusXp)||0});return out};
Store.setArenaGearSlot=function(index,id){const s=Store.state,i=Number(index);if(i<0||i>6)return false;const item=Store.getItemById(id);if(!item)return false;s.arena=s.arena||clone(DEFAULT.arena);s.arena.gear=Array.isArray(s.arena.gear)?s.arena.gear:Array(7).fill(null);while(s.arena.gear.length<7)s.arena.gear.push(null);s.arena.gear[i]=String(id);Store.saveNow();return true};
Store.clearArenaGearSlot=function(index){const s=Store.state,i=Number(index);if(i<0||i>6)return false;s.arena=s.arena||clone(DEFAULT.arena);s.arena.gear=Array.isArray(s.arena.gear)?s.arena.gear:Array(7).fill(null);s.arena.gear[i]=null;Store.saveNow();return true};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
function show(id){
 const aliases={market:'shop',casino:'games',districts:'quests'};id=aliases[id]||id;
 $$('.screen').forEach(x=>x.classList.toggle('active',x.id===id));
 document.body.dataset.screen=id;window.dispatchEvent(new CustomEvent('territory:screen',{detail:id}));
 if(id==='roadmap')roadmap();if(id==='inventory')inventory();if(id==='shop')shop();if(id==='games')games();
}
window.TerritoryUI={show,home:()=>show('home')};window.showScreen=show;
function modal(title,body){$('#modalBody').innerHTML='<h2>'+title+'</h2>'+body;$('#modal').classList.add('show')}
$('#modalClose').onclick=()=>$('#modal').classList.remove('show');

const ACHIEVEMENTS=[
 {id:'first_win',icon:'⚔️',title:'Первый бой',text:'Победить первого обычного противника.',check:s=>Number(s.pve?.wins||0)>=1,reward:{coins:150,xp:25}},
 {id:'first_boss',icon:'👑',title:'Падение вождя',text:'Победить первого босса главы.',check:s=>Number(s.pve?.bossDefeated||0)>=1,reward:{coins:500,gems:5,materials:5}},
 {id:'chapters_5',icon:'📜',title:'Пять глав',text:'Завершить 5 глав.',check:s=>Math.max(0,Number(s.currentChapter||1)-1)>=5,reward:{coins:750,gems:10}},
 {id:'chapters_10',icon:'🏆',title:'Десятая глава',text:'Завершить 10 глав.',check:s=>Math.max(0,Number(s.currentChapter||1)-1)>=10,reward:{coins:1500,gems:20,materials:15}},
 {id:'chapters_25',icon:'🗺️',title:'Дорога героя',text:'Завершить 25 глав.',check:s=>Math.max(0,Number(s.currentChapter||1)-1)>=25,reward:{coins:3000,gems:35,materials:30}},
 {id:'level_10',icon:'🔺',title:'Опытный воин',text:'Достичь 10 уровня.',check:s=>Number(s.level||1)>=10,reward:{coins:1000,gems:10}},
 {id:'loot_20',icon:'🎁',title:'Охотник за добычей',text:'Найти 20 предметов добычи.',check:s=>Number(s.lootFound||0)>=20,reward:{coins:1000,materials:20}},
 {id:'forge_5',icon:'🔨',title:'Кузнец',text:'Успешно улучшить 5 предметов.',check:s=>Number(s.forge?.successes||0)>=5,reward:{coins:1200,gems:15,materials:10}}
];
function achievementProgress(a,s){
 const id=a.id;let cur=0,max=1;
 if(id==='first_win')cur=Math.min(1,Number(s.pve?.wins||0));
 else if(id==='first_boss')cur=Math.min(1,Number(s.pve?.bossDefeated||0));
 else if(id==='chapters_5'){cur=Math.min(5,Math.max(0,Number(s.currentChapter||1)-1));max=5}
 else if(id==='chapters_10'){cur=Math.min(10,Math.max(0,Number(s.currentChapter||1)-1));max=10}
 else if(id==='chapters_25'){cur=Math.min(25,Math.max(0,Number(s.currentChapter||1)-1));max=25}
 else if(id==='level_10'){cur=Math.min(10,Number(s.level||1));max=10}
 else if(id==='loot_20'){cur=Math.min(20,Number(s.lootFound||0));max=20}
 else if(id==='forge_5'){cur=Math.min(5,Number(s.forge?.successes||0));max=5}
 return {cur,max,done:a.check(s),claimed:Boolean(s.achievementClaims?.[id])};
}
function achievementRewardText(r){return [r.coins?`🪙 +${r.coins.toLocaleString('ru-RU')}`:'',r.gems?`💎 +${r.gems}`:'',r.materials?`🔩 +${r.materials}`:'',r.xp?`✨ +${r.xp} XP`:'' ].filter(Boolean).join(' · ')}
function claimAchievement(id){
 const s=Store.state,a=ACHIEVEMENTS.find(x=>x.id===id);if(!a)return;const pr=achievementProgress(a,s);if(!pr.done||pr.claimed)return;const r=a.reward||{};s.coins=(Number(s.coins)||0)+(r.coins||0);s.gems=(Number(s.gems)||0)+(r.gems||0);s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials=(Number(s.forge.materials)||0)+(r.materials||0);s.achievementClaims[id]=true;Store.saveNow();roadmap();modal('Награда получена',`<p><b>${a.icon} ${a.title}</b></p><p>${achievementRewardText(r)}</p>`);}
const DAILY_MISSIONS=[
 {id:'daily_wins',icon:'⚔️',title:'Разогреться',text:'Победить 3 обычных противников.',need:3,key:'wins',reward:{coins:300,xp:20}},
 {id:'daily_loot',icon:'🎁',title:'Собрать добычу',text:'Найти 2 предмета.',need:2,key:'loot',reward:{coins:250,materials:5}},
 {id:'daily_forge',icon:'🔨',title:'Работа кузнеца',text:'Успешно улучшить 1 предмет.',need:1,key:'forge',reward:{coins:350,gems:3}},
 {id:'daily_boss',icon:'👑',title:'Вызов вождю',text:'Победить босса.',need:1,key:'bosses',reward:{coins:500,gems:5}}
];
const WEEKLY_MISSIONS=[
 {id:'weekly_wins',icon:'⚔️',title:'Неделя воина',text:'Победить 15 обычных противников.',need:15,key:'wins',reward:{coins:1800,gems:12,xp:120}},
 {id:'weekly_loot',icon:'🎁',title:'Большая добыча',text:'Найти 10 предметов.',need:10,key:'loot',reward:{coins:1400,materials:20}},
 {id:'weekly_forge',icon:'🔨',title:'Кузнечный марафон',text:'Успешно улучшить 5 предметов.',need:5,key:'forge',reward:{coins:2200,gems:15,materials:15}},
 {id:'weekly_boss',icon:'👑',title:'Покоритель боссов',text:'Победить 2 боссов.',need:2,key:'bosses',reward:{coins:2600,gems:18,xp:150}},
 {id:'weekly_chapters',icon:'🗺️',title:'Поход по землям',text:'Завершить 2 главы.',need:2,key:'chapters',reward:{coins:3000,gems:20,materials:20}}
];
const STORY_CHAIN=[
 {id:'story_1',icon:'🔥',title:'Искра воина',text:'Победи 2 обычных противников.',need:2,key:'wins',reward:{coins:450,xp:35},chapter:'Старый дозор'},
 {id:'story_2',icon:'🎁',title:'След добычи',text:'Найди 3 предмета.',need:3,key:'loot',reward:{coins:600,gems:3,materials:5},chapter:'Следы на снегу'},
 {id:'story_3',icon:'🔨',title:'Клинок кузнеца',text:'Успешно улучши предмет 2 раза.',need:2,key:'forge',reward:{coins:800,gems:5,materials:10},chapter:'Огонь кузницы'},
 {id:'story_4',icon:'👑',title:'Испытание вождя',text:'Победи босса.',need:1,key:'bosses',reward:{coins:1200,gems:8,xp:80},chapter:'Ворота вождя'},
 {id:'story_5',icon:'🗺️',title:'Новая земля',text:'Заверши ещё одну главу.',need:1,key:'chapters',reward:{coins:1800,gems:12,materials:20,xp:120},chapter:'За горизонтом'}
];
function storyCurrent(){const s=Store.state,i=Math.min(STORY_CHAIN.length-1,Math.max(0,Number(s.story?.step)||0));return STORY_CHAIN[i]}
function storyValue(m,s){if(m.key==='wins')return Number(s.pve?.wins)||0;if(m.key==='loot')return Number(s.lootFound)||0;if(m.key==='forge')return Number(s.forge?.successes)||0;if(m.key==='bosses')return Number(s.pve?.bossDefeated)||0;if(m.key==='chapters')return Number(s.totalChaptersCompleted)||0;return 0}
function storyProgress(m,s){const cur=Math.min(m.need,Math.max(0,storyValue(m,s)-(m.key==='wins'&&m.id!=='story_1'?0:0)));return {cur,done:cur>=m.need}}
function storyRewardText(r){return [r.coins?`🪙 +${r.coins.toLocaleString('ru-RU')}`:'',r.gems?`💎 +${r.gems}`:'',r.materials?`🔩 +${r.materials}`:'',r.xp?`✨ +${r.xp} XP`:'' ].filter(Boolean).join(' · ')}
function claimStory(){const s=Store.state,m=storyCurrent();if(!m)return;const p=storyProgress(m,s);if(!p.done||s.story.claimed[m.id])return;const r=m.reward||{};s.coins=(Number(s.coins)||0)+(r.coins||0);s.gems=(Number(s.gems)||0)+(r.gems||0);s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials=(Number(s.forge.materials)||0)+(r.materials||0);s.story.claimed[m.id]=true;s.story.step=Math.min(STORY_CHAIN.length-1,s.story.step+1);s.story.progress=0;s.story.started=true;Store.addXp?.(r.xp||0);Store.saveNow();roadmap();modal('📖 Цепочка героя',`<p><b>${m.icon} ${m.chapter}</b></p><p>${storyRewardText(r)}</p>`)}
function storyTick(key,count=1){const s=Store.state;s.story=s.story||clone(DEFAULT.story);s.story.started=true;Store.saveNow()}
function renderStoryChain(){const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.story-panel');if(!panel){panel=document.createElement('section');panel.className='story-panel';host.appendChild(panel);const style=document.createElement('style');style.textContent=`.story-panel{margin:14px 0;padding:15px;border-radius:16px;background:linear-gradient(180deg,rgba(35,22,16,.98),rgba(12,10,9,.98));border:1px solid rgba(236,166,73,.3);box-shadow:0 10px 28px rgba(0,0,0,.24)}.story-panel h3{margin:0}.story-sub{font-size:10px;opacity:.62;margin:3px 0 11px}.story-track{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-bottom:12px}.story-step{height:5px;border-radius:5px;background:rgba(255,255,255,.1)}.story-step.active,.story-step.done{background:rgba(236,166,73,.75)}.story-card{padding:11px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}.story-card b{font-size:12px}.story-card p{font-size:10px;opacity:.68;margin:4px 0}.story-card small{font-size:9px;opacity:.72}.story-card button{margin-top:9px;border:0;border-radius:9px;padding:8px 11px;background:rgba(236,166,73,.2);color:inherit;font-weight:800}.story-card button:disabled{opacity:.45;background:rgba(255,255,255,.06)}`;document.head.appendChild(style)} const s=Store.state,m=storyCurrent(),p=storyProgress(m,s);panel.innerHTML=`<h3>📖 Путь героя</h3><div class="story-sub">Последовательная история. Каждый шаг открывает следующий.</div><div class="story-track">${STORY_CHAIN.map((x,i)=>`<span class="story-step ${i<s.story.step?'done':''} ${i===s.story.step?'active':''}"></span>`).join('')}</div><div class="story-card"><b>${m.icon} ${m.chapter}</b><p>${m.text}</p><small>${p.cur}/${m.need} · Награда: ${storyRewardText(m.reward)}</small><br><button data-story-claim ${!p.done||s.story.claimed[m.id]?'disabled':''}>${s.story.claimed[m.id]?'✓ Завершено':p.done?'🎁 Забрать награду':'⚔️ Продолжить путь'}</button></div>`;panel.querySelector('[data-story-claim]')?.addEventListener('click',claimStory)}

function weeklyRewardText(r){return [r.coins?`🪙 +${r.coins.toLocaleString('ru-RU')}`:'',r.gems?`💎 +${r.gems}`:'',r.materials?`🔩 +${r.materials}`:'',r.xp?`✨ +${r.xp} XP`:'' ].filter(Boolean).join(' · ')}
function weeklyProgress(m,s){const cur=Math.min(m.need,Number(s.weekly?.[m.key])||0);return {cur,done:cur>=m.need,claimed:Boolean(s.weekly?.claims?.[m.id])}}
function claimWeekly(id){const s=Store.state,m=WEEKLY_MISSIONS.find(x=>x.id===id);if(!m)return;const p=weeklyProgress(m,s);if(!p.done||p.claimed)return;const r=m.reward||{};s.coins=(Number(s.coins)||0)+(r.coins||0);s.gems=(Number(s.gems)||0)+(r.gems||0);s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials=(Number(s.forge.materials)||0)+(r.materials||0);s.weekly.claims[id]=true;Store.addXp?.(r.xp||0);Store.saveNow();roadmap();modal('Недельное задание',`<p><b>${m.icon} ${m.title}</b></p><p>${weeklyRewardText(r)}</p>`) }
function weeklyTick(key,count=1){Store.trackProgress?.(key,count)}
function dailyTick(key,count=1){Store.trackProgress?.(key,count)}function renderProgressionPulse(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.progression-pulse');if(!panel){panel=document.createElement('section');panel.className='progression-pulse';host.appendChild(panel);const style=document.createElement('style');style.textContent=`.progression-pulse{margin:14px 0;padding:13px;border-radius:15px;background:linear-gradient(180deg,rgba(19,28,38,.98),rgba(10,14,18,.98));border:1px solid rgba(90,170,220,.22);box-shadow:0 8px 24px rgba(0,0,0,.18)}.progression-pulse h3{margin:0 0 4px}.progression-pulse p{margin:5px 0;font-size:10px;opacity:.68}.progression-pulse .pp-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.progression-pulse .pp-card{padding:8px;border-radius:10px;background:rgba(255,255,255,.04)}.progression-pulse small{opacity:.58}@media(max-width:520px){.progression-pulse .pp-grid{grid-template-columns:1fr}}`;document.head.appendChild(style)}
 const x=Store.getProgressionSummary();panel.innerHTML=`<h3>🧭 Темп героя</h3><p>Прогресс специально устроен ступенчато: начало быстрое, дальние уровни — долгий горизонт.</p><div class="pp-grid"><div class="pp-card"><b>Lv. ${x.level}</b><br><small>${x.band}</small></div><div class="pp-card"><b>✨ ${Math.floor(x.xp)} / ${Math.floor(x.xpNext)}</b><br><small>до следующего уровня</small></div><div class="pp-card"><b>🔥 ${x.freeDailyBattles}</b><br><small>бесплатных PvE-битв в день</small></div><div class="pp-card"><b>🎯 Дальняя цель</b><br><small>${x.note}</small></div></div>`;
}
function renderDailyMissions(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.daily-panel');if(!panel){panel=document.createElement('section');panel.className='daily-panel';const style=document.createElement('style');style.textContent=`.daily-panel{margin:14px 0;padding:13px;border-radius:15px;background:linear-gradient(180deg,rgba(17,25,30,.98),rgba(10,14,17,.98));border:1px solid rgba(100,190,210,.2);box-shadow:0 8px 24px rgba(0,0,0,.18)}.daily-panel h3{margin:0 0 4px}.daily-sub{font-size:10px;opacity:.62;margin-bottom:10px}.daily-list{display:grid;gap:7px}.daily-m{display:grid;grid-template-columns:34px 1fr auto;gap:8px;align-items:center;padding:9px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.daily-m.done{border-color:rgba(100,190,210,.35)}.daily-m.claimed{opacity:.55}.daily-m .dicon{font-size:23px;text-align:center}.daily-m b{font-size:11px}.daily-m p{margin:2px 0 0;font-size:9px;opacity:.62}.daily-m small{display:block;margin-top:4px;font-size:9px;opacity:.72}.daily-m button{border:0;border-radius:8px;padding:7px 9px;background:rgba(100,190,210,.15);color:inherit;font-weight:700;font-size:10px}.daily-m button:disabled{opacity:.45;background:rgba(255,255,255,.06)}@media(max-width:520px){.daily-m{grid-template-columns:30px 1fr}.daily-m button{grid-column:2;justify-self:start}}`;document.head.appendChild(style);host.insertBefore(panel,host.querySelector('.achievement-panel')||null)}
 const s=Store.state;panel.innerHTML=`<h3>📅 Ежедневные задания</h3><div class="daily-sub">Четыре задания на сегодня. Выполнил — забери награду.</div><div class="daily-list">${DAILY_MISSIONS.map(m=>{const p=dailyProgress(m,s);return `<article class="daily-m ${p.done?'done':''} ${p.claimed?'claimed':''}"><div class="dicon">${m.icon}</div><div><b>${m.title}</b><p>${m.text}</p><small>${p.cur}/${m.need} · ${p.claimed?'✓ Получено':dailyRewardText(m.reward)}</small></div><button data-daily="${m.id}" ${!p.done||p.claimed?'disabled':''}>${p.claimed?'✓ Получено':p.done?'Забрать':'Выполнить'}</button></article>`}).join('')}</div>`;panel.querySelectorAll('[data-daily]').forEach(b=>b.onclick=()=>claimDaily(b.dataset.daily));
}

function renderAchievements(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.achievement-panel');if(!panel){panel=document.createElement('section');panel.className='achievement-panel';host.appendChild(panel);const style=document.createElement('style');style.textContent=`.achievement-panel{margin:14px 0 24px;padding:13px;border-radius:15px;background:linear-gradient(180deg,rgba(29,24,19,.98),rgba(13,11,9,.98));border:1px solid rgba(220,184,104,.24);box-shadow:0 8px 24px rgba(0,0,0,.2)}.achievement-panel h3{margin:0 0 4px}.achievement-sub{font-size:10px;opacity:.62;margin-bottom:10px}.achievement-list{display:grid;gap:7px}.achievement{display:grid;grid-template-columns:34px 1fr auto;gap:8px;align-items:center;padding:9px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.achievement.done{border-color:rgba(220,184,104,.35)}.achievement.claimed{opacity:.55}.achievement .aicon{font-size:23px;text-align:center}.achievement b{font-size:11px}.achievement p{margin:2px 0 0;font-size:9px;opacity:.62}.achievement small{display:block;margin-top:4px;font-size:9px;opacity:.72}.achievement button{border:0;border-radius:8px;padding:7px 9px;background:rgba(220,184,104,.18);color:inherit;font-weight:700;font-size:10px}.achievement button:disabled{opacity:.45;background:rgba(255,255,255,.06)}@media(max-width:520px){.achievement{grid-template-columns:30px 1fr}.achievement button{grid-column:2;justify-self:start}}`;document.head.appendChild(style)}
 const s=Store.state;panel.innerHTML=`<h3>🏅 Достижения</h3><div class="achievement-sub">Награды за реальные шаги героя. Каждая награда забирается один раз.</div><div class="achievement-list">${ACHIEVEMENTS.map(a=>{const p=achievementProgress(a,s);return `<article class="achievement ${p.done?'done':''} ${p.claimed?'claimed':''}"><div class="aicon">${a.icon}</div><div><b>${a.title}</b><p>${a.text}</p><small>${p.cur}/${p.max} · ${p.claimed?'✓ Награда получена':p.done?'🎁 '+achievementRewardText(a.reward):achievementRewardText(a.reward)}</small></div><button data-achievement="${a.id}" ${!p.done||p.claimed?'disabled':''}>${p.claimed?'✓ Получено':p.done?'Забрать':'Закрыто'}</button></article>`}).join('')}</div>`;panel.querySelectorAll('[data-achievement]').forEach(b=>b.onclick=()=>claimAchievement(b.dataset.achievement));
}


const DONATION_OFFERS=[
 {id:'starter',icon:'🎁',title:'Набор странника',price:'$0.99',gems:120,bonus:'Небольшой стартовый набор для удобства.'},
 {id:'adventurer',icon:'⚔️',title:'Набор героя',price:'$4.99',gems:700,bonus:'Большой запас премиальных камней без обязательного гринда.'},
 {id:'chieftain',icon:'👑',title:'Набор вождя',price:'$9.99',gems:1600,bonus:'Премиальный запас для тех, кто хочет ускорить путь.'},
 {id:'cosmetic',icon:'✨',title:'Знак героя',price:'$2.99',gems:0,bonus:'Косметический слот для будущих визуальных предметов.'}
];
function donationPurchase(id){
 const offer=DONATION_OFFERS.find(x=>x.id===id);if(!offer)return;
 const adapter=window.TerritoryPayments;
 if(!adapter?.purchase){
  modal('🛒 Магазин Territory',`<p><b>${offer.icon} ${offer.title}</b></p><p>${offer.bonus}</p><p><b>${offer.price}</b></p><p style="opacity:.65">Платёжный модуль ещё не подключён. Кнопка уже подготовлена для будущего магазина — реальные деньги сейчас не списываются.</p>`);return;
 }
 Promise.resolve(adapter.purchase({productId:offer.id,price:offer.price})).then(result=>{
  if(!result||result.success===false)return;
  const s=Store.state;s.premium=s.premium||{paidGems:0,transactions:[],firstPurchaseClaimed:false};
  s.premium.paidGems=(Number(s.premium.paidGems)||0)+(offer.gems||0);
  s.premium.transactions.push({id:offer.id,at:Date.now(),gems:offer.gems||0});
  if(!s.premium.firstPurchaseClaimed)s.premium.firstPurchaseClaimed=true;
  Store.saveNow();roadmap();modal('🎉 Покупка',`<p><b>${offer.icon} ${offer.title}</b></p><p>Начислено: <b>💎 +${offer.gems||0}</b></p>`);
 }).catch(()=>modal('🛒 Магазин Territory','<p>Платёж не завершён. Покупка ничего не списала.</p>'));
}
function renderDonationShop(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.donation-panel');
 if(!panel){panel=document.createElement('section');panel.className='donation-panel';host.appendChild(panel);const style=document.createElement('style');style.textContent=`.donation-panel{margin:14px 0 24px;padding:14px;border-radius:16px;background:linear-gradient(180deg,rgba(38,27,18,.98),rgba(12,10,9,.98));border:1px solid rgba(240,184,83,.3);box-shadow:0 10px 30px rgba(0,0,0,.24)}.donation-panel h3{margin:0 0 4px}.donation-sub{font-size:10px;opacity:.62;margin-bottom:11px}.donation-list{display:grid;gap:8px}.donation-offer{display:grid;grid-template-columns:38px 1fr auto;gap:9px;align-items:center;padding:10px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.donation-icon{font-size:24px;text-align:center}.donation-offer b{font-size:11px}.donation-offer p{margin:3px 0;font-size:9px;opacity:.64}.donation-offer small{font-size:9px;opacity:.78}.donation-offer button{border:0;border-radius:9px;padding:8px 11px;background:rgba(240,184,83,.18);color:inherit;font-weight:800;font-size:10px}.donation-note{margin-top:9px;font-size:9px;opacity:.48}@media(max-width:520px){.donation-offer{grid-template-columns:30px 1fr}.donation-offer button{grid-column:2;justify-self:start}}`;document.head.appendChild(style)}
 const s=Store.state;panel.innerHTML=`<h3>🛒 Магазин Territory</h3><div class="donation-sub">Покупки — только ускорение и косметика. Основной прогресс остаётся доступен без оплаты.</div><div class="donation-list">${DONATION_OFFERS.map(o=>`<article class="donation-offer"><div class="donation-icon">${o.icon}</div><div><b>${o.title}</b><p>${o.bonus}</p><small>${o.gems?`💎 ${o.gems}`:'✨ Косметика'} · ${o.price}</small></div><button data-donation="${o.id}">Приобрести</button></article>`).join('')}</div><div class="donation-note">Платёжный адаптер не встроен в эту сборку: интерфейс не списывает реальные деньги без подключения TerritoryPayments.</div>`;
 panel.querySelectorAll('[data-donation]').forEach(b=>b.onclick=()=>donationPurchase(b.dataset.donation));
}

const WORLD_EVENTS=[
 {id:'camp',icon:'🔥',title:'Огонь на перевале',text:'После боя отряд находит старый лагерь. В золе ещё тлеют угли.',choices:[
   {id:'rest',title:'Развести костёр',text:'Восстановить силы и поделиться запасами.',reward:{coins:120,xp:20}},
   {id:'search',title:'Обыскать лагерь',text:'Рискнуть и поискать то, что оставили прежние воины.',reward:{coins:220,materials:3}}
 ]},
 {id:'trader',icon:'🧭',title:'Купец с севера',text:'На дороге появляется странствующий торговец. Его товары покрыты инеем.',choices:[
   {id:'trade',title:'Заключить сделку',text:'Обменять монеты на редкие припасы.',reward:{gems:2,materials:5}},
   {id:'help',title:'Помочь с караваном',text:'Помочь вернуть потерянный ящик.',reward:{coins:300,xp:30}}
 ]},
 {id:'shrine',icon:'🗿',title:'Камень предков',text:'В лесу стоит древний камень с символом неизвестного племени.',choices:[
   {id:'honor',title:'Почтить предков',text:'Оставить часть добычи у святилища.',reward:{gems:4,xp:45}},
   {id:'study',title:'Изучить руны',text:'Запомнить символы и забрать найденные материалы.',reward:{coins:180,materials:8}}
 ]}
];
function eventKey(ch,id){return String(ch)+':'+id}
function worldEventState(ch,id){return Boolean(Store.state.chapterEvents?.[eventKey(ch,id)])}
function worldRewardText(r){return [r.coins?`🪙 +${r.coins.toLocaleString('ru-RU')}`:'',r.gems?`💎 +${r.gems}`:'',r.materials?`🔩 +${r.materials}`:'',r.xp?`✨ +${r.xp} XP`:'' ].filter(Boolean).join(' · ')}
function chooseWorldEvent(ch,eventId,choiceId){
 const s=Store.state;const ev=WORLD_EVENTS.find(x=>x.id===eventId);const choice=ev?.choices.find(x=>x.id===choiceId);if(!ev||!choice)return;
 const key=eventKey(ch,eventId);if(s.chapterEvents?.[key])return;
 s.chapterEvents=s.chapterEvents||{};const r=choice.reward||{};s.chapterEvents[key]={choice:choiceId,at:Date.now()};
 s.coins=(Number(s.coins)||0)+(r.coins||0);s.gems=(Number(s.gems)||0)+(r.gems||0);s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials=(Number(s.forge.materials)||0)+(r.materials||0);Store.addXp?.(r.xp||0);Store.saveNow();roadmap();modal('🌍 Событие главы',`<p><b>${ev.icon} ${ev.title}</b></p><p>${choice.title}</p><p>${choice.text}</p><p><b>Награда:</b> ${worldRewardText(r)}</p>`)
}
function renderWorldEvents(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.world-events-panel');if(!panel){panel=document.createElement('section');panel.className='world-events-panel';host.appendChild(panel);const style=document.createElement('style');style.textContent=`.world-events-panel{margin:14px 0;padding:14px;border-radius:16px;background:linear-gradient(180deg,rgba(22,29,34,.98),rgba(9,12,14,.98));border:1px solid rgba(110,190,205,.24);box-shadow:0 10px 28px rgba(0,0,0,.24)}.world-events-panel h3{margin:0 0 4px}.world-events-sub{font-size:10px;opacity:.62;margin-bottom:11px}.world-events-list{display:grid;gap:9px}.world-event{padding:11px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.world-event.done{opacity:.58;border-color:rgba(110,190,205,.28)}.world-event-head{display:flex;gap:8px;align-items:center}.world-event-head span{font-size:23px}.world-event-head b{font-size:12px}.world-event p{margin:5px 0 9px;font-size:10px;opacity:.7}.world-choice{display:grid;grid-template-columns:1fr auto;gap:7px;align-items:center;padding:8px;margin-top:6px;border-radius:9px;background:rgba(255,255,255,.035)}.world-choice strong{font-size:10px}.world-choice small{display:block;font-size:8px;opacity:.58;margin-top:2px}.world-choice button{border:0;border-radius:8px;padding:7px 9px;background:rgba(110,190,205,.16);color:inherit;font-weight:800;font-size:9px}.world-choice button:disabled{opacity:.45}`;document.head.appendChild(style)}
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1);panel.innerHTML=`<h3>🌍 События главы ${ch}</h3><div class="world-events-sub">Небольшие встречи на пути. Выбор одноразовый для каждой главы.</div><div class="world-events-list">${WORLD_EVENTS.map(ev=>{const done=worldEventState(ch,ev.id);return `<article class="world-event ${done?'done':''}"><div class="world-event-head"><span>${ev.icon}</span><b>${ev.title}</b></div><p>${ev.text}</p>${done?'<small>✓ Решение принято — путь запомнен.</small>':ev.choices.map(c=>`<div class="world-choice"><div><strong>${c.title}</strong><small>${c.text} · ${worldRewardText(c.reward)}</small></div><button data-world-event="${ev.id}" data-world-choice="${c.id}">Выбрать</button></div>`).join('')}</article>`}).join('')}</div>`;
 panel.querySelectorAll('[data-world-event]').forEach(b=>b.onclick=()=>chooseWorldEvent(ch,b.dataset.worldEvent,b.dataset.worldChoice));
}


const NPCS=[
 {id:'bjorn',icon:'🔨',name:'Бьорн',role:'Кузнец',desc:'Молчаливый мастер, который чинит оружие у костра.',thresholds:[25,50,75,100],rewards:[{coins:250,materials:5},{coins:500,gems:3},{coins:900,materials:12},{coins:1600,gems:10,materials:20,xp:80}]},
 {id:'astrid',icon:'🏹',name:'Астрид',role:'Следопыт',desc:'Следопыт знает дороги, которые не отмечены ни на одной карте.',thresholds:[25,50,75,100],rewards:[{coins:220,xp:25},{coins:450,gems:3},{coins:800,gems:6},{coins:1400,gems:12,xp:90}]},
 {id:'einar',icon:'🗿',name:'Эйнар',role:'Старейшина',desc:'Хранитель историй племени и забытых знаков на камнях.',thresholds:[25,50,75,100],rewards:[{coins:200,materials:4},{coins:450,xp:35},{coins:750,gems:5},{coins:1500,gems:15,xp:110}]}
];
function npcRelation(id){return Math.max(0,Math.min(100,Number(Store.state.npcRelations?.[id])||0))}
function npcTier(npc){const r=npcRelation(npc.id);return npc.thresholds.reduce((tier,v)=>tier+(r>=v?1:0),0)}
function npcTierName(t){return ['Знакомый','Союзник','Доверенный','Близкий','Верный друг'][Math.min(4,t)]}
function npcLogKey(ch,id,action){return `${ch}:${id}:${action}`}
function npcRewardText(r){return [r.coins?`🪙 +${r.coins.toLocaleString('ru-RU')}`:'',r.gems?`💎 +${r.gems}`:'',r.materials?`🔩 +${r.materials}`:'',r.xp?`✨ +${r.xp} XP`:'' ].filter(Boolean).join(' · ')}
function giveNpcReward(npc,tier){const s=Store.state;if(!tier||tier>npc.rewards.length||s.npcRewards?.[`${npc.id}:${tier}`])return;const r=npc.rewards[tier-1]||{};s.coins=(Number(s.coins)||0)+(r.coins||0);s.gems=(Number(s.gems)||0)+(r.gems||0);s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials=(Number(s.forge.materials)||0)+(r.materials||0);s.npcRewards[`${npc.id}:${tier}`]=true;Store.addXp?.(r.xp||0);Store.saveNow()}
function npcInteract(id,action){
 const s=Store.state,npc=NPCS.find(x=>x.id===id);if(!npc)return;const ch=Math.max(1,Number(s.currentChapter)||1);const key=npcLogKey(ch,id,action);if(s.npcInteractionLog?.[key])return;
 if(action==='help' && Number(s.coins||0)<100){modal('🤝 Помощь',`<p>Для помощи <b>${npc.name}</b> нужно 100 🪙.</p>`);return}
 if(action==='gift' && Number(s.forge?.materials||0)<2){modal('🎁 Подарок',`<p>Нужно 2 🔩 материала кузницы.</p>`);return}
 if(action==='help')s.coins-=100;if(action==='gift'){s.forge.materials-=2}
 const before=npcTier(npc),gain=action==='talk'?5:action==='help'?10:8;s.npcRelations[id]=Math.min(100,npcRelation(id)+gain);s.npcInteractionLog[key]=true;const after=npcTier(npc);if(after>before)giveNpcReward(npc,after);Store.saveNow();renderNPCs();modal('🤝 Отношения',`<p><b>${npc.icon} ${npc.name}</b></p><p>${action==='talk'?'Вы поговорили у костра.':action==='help'?'Ты помог с делом.':'Ты сделал подарок.'}</p><p>Отношение: <b>${npcRelation(id)}/100</b> · ${npcTierName(after)}</p>${after>before?`<p>🎉 Новый уровень доверия!<br>${npcRewardText(npc.rewards[after-1]||{})}</p>`:''}`)
}
const NPC_BOND_DIALOGUE={
 bjorn:[
  'Бьёрн молча проверяет кромку твоего оружия. «Ты уже не новичок. Сталь это помнит».',
  'Бьёрн усмехается: «Ты выбрал свой способ ковать судьбу. Хороший выбор не забывается».',
  'Бьёрн говорит тише обычного: «Я бы доверил тебе работу, которую не доверяю чужим рукам».',
  'Бьёрн кладёт ладонь на наковальню: «Если ты скажешь, что идёшь — кузница будет ждать тебя».',
  'Бьёрн впервые улыбается открыто: «Брат по огню. Что бы ни случилось дальше — мой молот на твоей стороне».'
 ],
 astrid:[
  'Астрид приседает у следа: «Ты начинаешь видеть то, что другие проходят мимо».',
  'Астрид показывает на снег: «Я уже знаю, какой след ты выберешь. И, похоже, доверяю тебе».',
  'Астрид говорит шёпотом: «Есть тропы, которые я показываю только своим».',
  'Астрид отдаёт тебе знак следопыта: «Если потеряешь дорогу — ищи мой след».',
  'Астрид смотрит в лес: «Ты стал частью этой земли. Я не оставлю тебя одного в её тёмных местах».'
 ],
 einar:[
  'Эйнар проводит пальцем по руне: «Ты слушаешь камень внимательнее многих старейшин».',
  'Эйнар кивает: «Твой выбор уже изменил то, что я считал неизменным».',
  'Эйнар открывает старую табличку: «Теперь я могу рассказать тебе то, что хранил годами».',
  'Эйнар говорит торжественно: «Древние знаки узнают тебя. Это случается нечасто».',
  'Эйнар склоняет голову: «Хранитель — это не титул. Это обещание. И я вижу, что ты его понимаешь».'
 ]
};
function npcBondLine(npc,tier,memories){
 const base=(NPC_BOND_DIALOGUE[npc.id]||[])[Math.min(4,tier)]||npc.desc;
 const memory=memories.filter(m=>m.location&&m.location.startsWith(npc.id==='bjorn'?'bjorn_':npc.id==='astrid'?'astrid_':'einar_')).sort((a,b)=>(b.at||0)-(a.at||0))[0];
 return memory?`${base}<br><br><span style="opacity:.62">Он помнит: <b>${memory.title||'твой поступок'}</b>.</span>`:base;
}
function openNpcBond(id){
 const s=Store.state,npc=NPCS.find(x=>x.id===id);if(!npc)return;
 const t=npcTier(npc),r=npcRelation(id),memories=Object.values(s.worldMemories||{});
 const next=t<4?npc.thresholds[t]:100;
 modal(`${npc.icon} ${npc.name}`,`<div class="npc-bond-scene"><div class="npc-bond-art">${npc.icon}</div><div class="npc-bond-tier">${npcTierName(t)} · ${r}/100</div><p>${npcBondLine(npc,t,memories)}</p><div class="npc-bond-progress"><i style="width:${r}%"></i></div><small>${t<4?`До следующего уровня доверия: ${Math.max(0,next-r)}`:'Максимальный уровень доверия достигнут.'}</small></div>`);
}


const NPC_STORY_MOMENTS=[
 {id:'bjorn',npc:'bjorn',icon:'⚒️',title:'Секрет кузницы',need:25,scene:'Бьёрн закрывает двери кузницы и достаёт старую форму для клинка. «Эту сталь я не показывал никому. Если поможешь мне закончить её, она станет твоей».',reward:{coins:300,materials:3,xp:25}},
 {id:'astrid',npc:'astrid',icon:'🌲',title:'Тропа без следов',need:50,scene:'Астрид ведёт тебя глубже в лес. Следы исчезают у старого камня. «Здесь охотятся не звери. Здесь охотятся на тех, кто слишком шумит».',reward:{coins:350,gems:2,xp:30}},
 {id:'einar',npc:'einar',icon:'🕯️',title:'Тайна хранителя',need:75,scene:'Эйнар гасит свечу и говорит почти шёпотом: «Теперь ты достаточно близок, чтобы услышать имя, которое племя забыло».',reward:{coins:400,gems:3,materials:2,xp:40}}
];
function npcStoryMoment(id){return NPC_STORY_MOMENTS.find(x=>x.id===id)}
function npcStoryDone(id){return Boolean(Store.state.npcStories?.[id])}
function openNpcStory(id){
 const s=Store.state,m=npcStoryMoment(id),npc=NPCS.find(x=>x.id===id);if(!m||!npc)return;
 const rel=npcRelation(id);if(rel<m.need){modal(`${npc.icon} ${npc.name}`,`<p>Эта личная история пока закрыта.</p><p>Нужно доверие: <b>${m.need}</b>/100.</p><p>Сейчас: <b>${rel}</b>/100.</p>`);return;}
 if(npcStoryDone(id)){modal(`${m.icon} ${m.title}`,`<p>${m.scene}</p><p style="opacity:.65">Ты уже открыл эту тайну. Она останется частью истории героя.</p>`);return;}
 modal(`${m.icon} ${m.title}`,`<div class="npc-story-scene"><div class="npc-story-art">${m.icon}</div><p>${m.scene}</p><div class="npc-story-reward">Награда: ${npcRewardText(m.reward)}</div><button data-claim-npc-story>Открыть тайну</button></div>`);
 const b=document.querySelector('[data-claim-npc-story]');if(b)b.onclick=()=>{s.npcStories=s.npcStories||{};s.npcStories[id]={at:Date.now(),chapter:Math.max(1,Number(s.currentChapter)||1)};s.coins+=Number(m.reward.coins)||0;s.gems+=Number(m.reward.gems)||0;s.forge=s.forge||{materials:0,successes:0,selectedId:null};s.forge.materials+=Number(m.reward.materials)||0;Store.addXp(Number(m.reward.xp)||0);Store.saveNow();renderNPCs();modal('✨ Тайна открыта',`<p><b>${npc.icon} ${npc.name}</b> теперь доверяет тебе ещё одну часть своей истории.</p><p>${npcRewardText(m.reward)}</p>`)};
}


const NPC_STORY_AFTERMATTER=[
 {id:'bjorn',npc:'bjorn',icon:'⚒️',title:'Клинок из старого огня',needTrust:40,text:'После секрета кузницы Бьёрн оставил для тебя записку: редкая заготовка снова появилась в огне. Он просит закончить работу вместе.',reward:{coins:520,materials:5,xp:55},relation:8},
 {id:'astrid',npc:'astrid',icon:'🐾',title:'Тропа, которую не отмечают',needTrust:60,text:'После разговора Астрид показывает тебе место, которого нет ни на одной карте. «Если увидишь два следа рядом — не выбирай самый простой путь».',reward:{coins:560,gems:2,xp:65},relation:8},
 {id:'einar',npc:'einar',icon:'🕯️',title:'Имя под камнем',needTrust:85,text:'После тайны Эйнар возвращается к древнему камню. Теперь на нём проступило имя, которое он обещал тебе однажды произнести.',reward:{gems:6,materials:4,xp:80},relation:8}
];
function npcStoryAftermath(npcId){return NPC_STORY_AFTERMATTER.find(x=>x.npc===npcId)}
function npcStoryAftermathDone(ch,id){return Boolean(Store.state.npcStoryAftermath?.[`${ch}:${id}`])}
function npcStoryAftermathOpen(x,s,ch){
 const story=s.npcStories?.[x.npc];
 return Boolean(story && ch>Number(story.chapter||0) && npcRelation(x.npc)>=x.needTrust);
}
function openNpcStoryAftermath(id){
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),x=npcStoryAftermath(id),npc=NPCS.find(n=>n.id===id);if(!x||!npc)return;
 if(!npcStoryAftermathOpen(x,s,ch)){modal(`${npc.icon} ${npc.name}`,`<p>Продолжение этой истории пока скрыто.</p><p>Сначала открой тайну персонажа, перейди в следующую главу и продолжай укреплять доверие.</p>`);return;}
 if(npcStoryAftermathDone(ch,id)){modal(`${x.icon} ${x.title}`,`<p>${x.text}</p><p style="opacity:.65">Ты уже продолжил эту историю в главе ${ch}.</p>`);return;}
 modal(`${x.icon} ${x.title}`,`<div class="npc-after-scene"><div class="npc-after-art">${x.icon}</div><p>${x.text}</p><div class="npc-after-reward">Награда: ${npcRewardText(x.reward)} · +${x.relation} доверия</div><button data-claim-npc-after>Продолжить историю</button></div>`);
 const b=document.querySelector('[data-claim-npc-after]');if(b)b.onclick=()=>{
  s.npcStoryAftermath=s.npcStoryAftermath||{};s.npcStoryAftermath[`${ch}:${id}`]={at:Date.now(),chapter:ch};
  s.coins=(Number(s.coins)||0)+(x.reward.coins||0);s.gems=(Number(s.gems)||0)+(x.reward.gems||0);
  s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials+=x.reward.materials||0;
  s.npcRelations=s.npcRelations||{};s.npcRelations[id]=Math.min(100,(Number(s.npcRelations[id])||0)+x.relation);
  Store.addXp?.(x.reward.xp||0);Store.saveNow();roadmap();
  modal(`${x.icon} История продолжается`,`<p><b>${npc.icon} ${npc.name}</b> поделился с тобой новым фрагментом своей истории.</p><p>${npcRewardText(x.reward)} · +${x.relation} доверия</p>`);
 };
}


const NPC_PERSONAL_ENDINGS=[
 {id:'bjorn',npc:'bjorn',icon:'⚒️',title:'Последний огонь кузницы',needTrust:90,needStory:true,variants:{
   blade:{title:'Наследник стали',text:'Бьёрн гасит огонь и впервые отдаёт тебе ключ от старого горна. «Я искал того, кому можно передать не металл, а ремесло. Теперь знаю».',reward:{coins:1200,gems:5,materials:15,xp:120}},
   armor:{title:'Щит мастера',text:'Бьёрн проводит ладонью по укреплённой пластине. «Сила кузницы — не в том, чтобы ударить первым. Она в том, чтобы выдержать». Он оставляет тебе знак своего мастерства.',reward:{coins:1000,gems:8,materials:18,xp:110}}
 }},
 {id:'astrid',npc:'astrid',icon:'🏹',title:'Последний след',needTrust:90,needStory:true,variants:{
   track:{title:'Хранитель тропы',text:'Астрид приводит тебя к месту, где сходятся три старые тропы. «Теперь ты знаешь дорогу. Но главное — знаешь, когда по ней не идти».',reward:{coins:1100,gems:7,xp:125}},
   ambush:{title:'Тень среди деревьев',text:'Астрид молча показывает тебе старый знак охотников. «Ты научился ждать. Значит, лес больше не сможет застать тебя врасплох».',reward:{coins:950,gems:9,xp:120}}
 }},
 {id:'einar',npc:'einar',icon:'🗿',title:'Последнее имя',needTrust:90,needStory:true,variants:{
   read:{title:'Носитель руны',text:'Эйнар открывает последнюю каменную плиту. «Теперь ты знаешь имя. Но вместе с ним принимаешь ответственность хранить его».',reward:{coins:900,gems:15,materials:10,xp:140}},
   touch:{title:'Голос камня',text:'Камень светится под твоей рукой, а Эйнар отступает на шаг. «Он признал тебя. Не как воина — как хранителя пути».',reward:{coins:800,gems:18,materials:8,xp:135}}
 }}
];
function npcEndingMemory(id){
 const s=Store.state,mem=Object.values(s.worldMemories||{}).filter(m=>m.location&&m.location.startsWith(id+'_')).sort((a,b)=>(a.at||0)-(b.at||0));
 const m=mem[0]; if(!m)return null;
 const map={bjorn:{blade:'blade',weapon:'blade',armor:'armor',guard:'armor'},astrid:{track:'track',ambush:'ambush'},einar:{runes:'read',read:'read',stone:'touch',touch:'touch'}};
 return map[id]?.[m.choice]||null;
}
function npcEndingDone(id){return Boolean(Store.state.npcEndings?.[id])}
function npcEndingOpen(e,s,ch){
 const story=s.npcStories?.[e.npc], aftermath=Object.keys(s.npcStoryAftermath||{}).some(k=>k.endsWith(':'+e.npc));
 return Boolean(story&&e.needStory&&ch>Number(story.chapter||0)&&aftermath&&npcRelation(e.npc)>=e.needTrust&&npcEndingMemory(e.npc));
}
function openNpcEnding(id){
 const s=Store.state,e=NPC_PERSONAL_ENDINGS.find(x=>x.id===id),npc=NPCS.find(x=>x.id===id),ch=Math.max(1,Number(s.currentChapter)||1);if(!e||!npc)return;
 if(npcEndingDone(id)){const v=s.npcEndings[id];modal(`${e.icon} ${e.title}`,`<p><b>${v.title||'Личная история завершена'}</b></p><p style="opacity:.7">Ты уже увидел этот финал. Он останется частью хроники героя.</p>`);return;}
 if(!npcEndingOpen(e,s,ch)){modal(`${npc.icon} ${npc.name}`,`<p>Финал личной истории пока скрыт.</p><p>Нужно открыть тайну, продолжить её в следующей главе и поднять доверие до <b>${e.needTrust}/100</b>.</p>`);return;}
 const key=npcEndingMemory(e.npc),v=e.variants[key]||Object.values(e.variants)[0];
 modal(`${e.icon} ${v.title}`,`<div class="npc-ending-scene"><div class="npc-ending-art">${e.icon}</div><div class="npc-ending-mark">ЛИЧНАЯ ЛИНИЯ · ФИНАЛ</div><h3>${v.title}</h3><p>${v.text}</p><div class="npc-ending-reward">Награда: ${npcRewardText(v.reward)}</div><button data-claim-npc-ending>Завершить историю</button></div>`);
 const b=document.querySelector('[data-claim-npc-ending]');if(b)b.onclick=()=>{
   s.npcEndings=s.npcEndings||{};s.npcEndings[id]={at:Date.now(),chapter:ch,title:v.title,variant:key};
   s.coins=(Number(s.coins)||0)+(v.reward.coins||0);s.gems=(Number(s.gems)||0)+(v.reward.gems||0);s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials+=(v.reward.materials||0);Store.addXp?.(v.reward.xp||0);Store.saveNow();roadmap();
   modal('🏆 История завершена',`<p><b>${npc.icon} ${npc.name}</b></p><p>${v.title}</p><p>Эта личная линия теперь записана в хронике героя.</p><p>${npcRewardText(v.reward)}</p>`);
 };
}
function renderNpcPersonalEndings(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.npc-ending-panel');
 if(!panel){panel=document.createElement('section');panel.className='npc-ending-panel';const style=document.createElement('style');style.textContent=`.npc-ending-panel{margin:14px 0;padding:14px;border-radius:16px;background:linear-gradient(180deg,rgba(24,22,30,.99),rgba(8,9,13,.99));border:1px solid rgba(205,160,245,.32);box-shadow:0 12px 32px rgba(0,0,0,.28)}.npc-ending-panel h3{margin:0 0 4px}.npc-ending-sub{font-size:10px;opacity:.62;margin-bottom:10px}.npc-ending-list{display:grid;gap:8px}.npc-ending-card{display:grid;grid-template-columns:38px 1fr auto;gap:9px;align-items:center;padding:11px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.npc-ending-card.ready{border-color:rgba(205,160,245,.42);box-shadow:inset 0 0 18px rgba(205,160,245,.04)}.npc-ending-card.done{opacity:.72}.npc-ending-card.locked{opacity:.46}.npc-ending-icon{font-size:27px;text-align:center}.npc-ending-card b{font-size:11px}.npc-ending-card p{margin:2px 0;font-size:9px;opacity:.65}.npc-ending-card small{font-size:8px;opacity:.58}.npc-ending-card button{border:0;border-radius:8px;padding:8px 10px;background:rgba(205,160,245,.17);color:inherit;font-weight:900;font-size:9px}.npc-ending-card button:disabled{opacity:.42}.npc-ending-scene{text-align:center;padding:4px}.npc-ending-art{font-size:66px;filter:drop-shadow(0 10px 18px rgba(0,0,0,.45));animation:npcEndingFloat 2.8s ease-in-out infinite}.npc-ending-mark{font-size:8px;letter-spacing:1.5px;opacity:.45;margin-top:4px}.npc-ending-scene h3{margin:8px 0;font-size:16px}.npc-ending-scene p{font-size:11px;line-height:1.55}.npc-ending-reward{margin:11px 0;padding:9px;border-radius:9px;background:rgba(205,160,245,.1);font-size:10px}.npc-ending-scene button{width:100%;border:0;border-radius:9px;padding:10px;background:rgba(205,160,245,.2);color:inherit;font-weight:900}@keyframes npcEndingFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-5px) scale(1.025)}}@media(max-width:520px){.npc-ending-card{grid-template-columns:32px 1fr}.npc-ending-card button{grid-column:2;justify-self:start}}`;document.head.appendChild(style)}
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1);
 panel.innerHTML=`<h3>🏆 Финалы личных историй</h3><div class="npc-ending-sub">У каждого близкого героя есть своя последняя глава. Она зависит от пути, который ты выбрал.</div><div class="npc-ending-list">${NPC_PERSONAL_ENDINGS.map(e=>{const npc=NPCS.find(n=>n.id===e.npc),ready=npcEndingOpen(e,s,ch),done=npcEndingDone(e.id);return `<article class="npc-ending-card ${done?'done':ready?'ready':'locked'}"><div class="npc-ending-icon">${e.icon}</div><div><b>${e.title}</b><p>${npc?.name||e.npc} · ${done?(s.npcEndings[e.id]?.title||'История завершена'):ready?'Твой путь определил этот финал.':'🔒 Нужны тайна, продолжение и доверие '+e.needTrust+'/100'}</p><small>${done?'✓ Записано в хронике':ready?'Финал открыт': 'Личная линия ещё продолжается'}</small></div><button data-npc-ending="${e.id}" ${!ready||done?'disabled':''}>${done?'✓ Завершено':ready?'🏆 Открыть':'🔒 Закрыто'}</button></article>`}).join('')}</div>`;
 panel.querySelectorAll('[data-npc-ending]').forEach(b=>b.onclick=()=>openNpcEnding(b.dataset.npcEnding));
}

const TERRITORY_CONVERGENCE={
 title:'Три пути',icon:'⚔️',needChapterGap:1,
 paths:{
  unite:{icon:'🤝',title:'Собрать союз',text:'Ты не выбираешь одного из троих. Ты собираешь их вместе: кузнец даёт силу, следопыт — дорогу, хранитель — знание. Старые разногласия впервые уступают общей цели.',reward:{coins:1800,gems:12,materials:12,xp:180},relations:{bjorn:6,astrid:6,einar:6}},
 forge:{icon:'🔥',title:'Сделать ставку на силу',text:'Ты приносишь три истории к огню Бьёрна. Металл становится знаком общей клятвы, а друзья понимают: теперь у Territory есть оружие, созданное не одним мастером.',reward:{coins:2200,gems:8,materials:20,xp:170},relations:{bjorn:10,astrid:4,einar:4}},
 rune:{icon:'🗿',title:'Открыть древний путь',text:'Ты соединяешь знания Астрид и Эйнара с мастерством Бьёрна. Три истории складываются в одну карту — и на ней появляется дорога, которой раньше не существовало.',reward:{coins:1600,gems:18,materials:8,xp:200},relations:{bjorn:4,astrid:8,einar:10}}
 }
};
function convergenceReady(s){
 const ends=['bjorn','astrid','einar'];
 return ends.every(id=>Boolean(s.npcEndings?.[id])) && Math.max(1,Number(s.currentChapter)||1)>Math.max(...ends.map(id=>Number(s.npcEndings[id]?.chapter)||0));
}
function openTerritoryConvergence(){
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),c=s.worldConvergence||{};
 if(c.claimed){modal('🌍 Три пути',`<p>Большая история уже началась в главе ${c.chapter}.</p><p>Твой выбор: <b>${TERRITORY_CONVERGENCE.paths[c.path]?.title||'Скрытый путь'}</b>.</p><p style="opacity:.7">Это решение останется частью хроники Territory.</p>`);return;}
 if(!convergenceReady(s)){modal('🌍 Три пути',`<p>Общая история пока не готова.</p><p>Нужно завершить личные истории <b>Бьёрна, Астрид и Эйнара</b>, а затем перейти в следующую главу.</p>`);return;}
 const choices=Object.entries(TERRITORY_CONVERGENCE.paths).map(([id,v])=>`<button data-convergence="${id}" style="width:100%;margin-top:7px;border:0;border-radius:10px;padding:10px;background:rgba(190,155,80,.15);color:inherit;font-weight:900;text-align:left"><b>${v.icon} ${v.title}</b><br><span style="font-size:9px;opacity:.68">${v.text}</span><br><small>Награда: ${npcRewardText(v.reward)}</small></button>`).join('');
 modal('🌍 Три пути',`<div class="convergence-scene"><div class="convergence-art">⚒️ 🏹 🗿</div><div class="convergence-mark">ОБЩАЯ ИСТОРИЯ · НАЧАЛО</div><h3>Три судьбы сходятся</h3><p>Ты прошёл три личные истории. Теперь Бьёрн, Астрид и Эйнар впервые смотрят в одну сторону. От тебя зависит, что станет их общей целью.</p><div>${choices}</div></div>`);
 document.querySelectorAll('[data-convergence]').forEach(b=>b.onclick=()=>claimTerritoryConvergence(b.dataset.convergence));
}
function claimTerritoryConvergence(id){
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),v=TERRITORY_CONVERGENCE.paths[id];if(!v||!convergenceReady(s)||s.worldConvergence?.claimed)return;
 s.worldConvergence={stage:2,path:id,claimed:true,chapter:ch,at:Date.now()};
 s.coins=(Number(s.coins)||0)+(v.reward.coins||0);s.gems=(Number(s.gems)||0)+(v.reward.gems||0);s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials+=(v.reward.materials||0);Store.addXp?.(v.reward.xp||0);
 s.npcRelations=s.npcRelations||{};Object.entries(v.relations||{}).forEach(([npc,gain])=>s.npcRelations[npc]=Math.min(100,(Number(s.npcRelations[npc])||0)+Number(gain||0)));
 Store.saveNow();roadmap();modal('🌍 История Territory началась',`<div class="convergence-scene"><div class="convergence-art">${v.icon}</div><h3>${v.title}</h3><p>${v.text}</p><div class="convergence-reward">${npcRewardText(v.reward)}</div><p style="opacity:.68">Это решение записано в хронике героя. Дальнейшие события Territory теперь могут опираться на выбранный путь.</p></div>`);
}


const TERRITORY_BRANCHES={
 unite:{icon:'🤝',title:'Союз трёх',place:'Зал общего огня',text:'Трое героев впервые собираются за одним столом. Теперь нужно решить, кому доверить первую общую задачу.',choices:[
  {id:'council',icon:'🕯️',title:'Созвать совет',text:'Дать каждому право голоса.',reward:{coins:900,gems:5,xp:90},relations:{bjorn:4,astrid:4,einar:4}},
  {id:'mission',icon:'🗺️',title:'Начать с дела',text:'Не спорить о планах — отправиться вместе.',reward:{coins:1100,materials:5,xp:100},relations:{bjorn:3,astrid:5,einar:3}}
 ]},
 forge:{icon:'🔥',title:'Путь стали',place:'Старый горн',text:'После общей клятвы Бьёрн находит старый горн. В его огне можно создать символ нового союза.',choices:[
  {id:'blade',icon:'⚔️',title:'Ковать знамя',text:'Создать клинок, который станет знаком силы.',reward:{coins:1200,gems:3,materials:8,xp:105},relations:{bjorn:7,astrid:2,einar:2}},
  {id:'shield',icon:'🛡️',title:'Ковать щит',text:'Создать защиту, которая будет принадлежать всем троим.',reward:{coins:950,gems:5,materials:10,xp:95},relations:{bjorn:5,astrid:4,einar:3}}
 ]},
 rune:{icon:'🗿',title:'Древний путь',place:'Каменные ворота',text:'На карте, составленной из трёх историй, появляется место, которого никто не видел раньше.',choices:[
  {id:'open',icon:'📜',title:'Открыть ворота',text:'Следовать рунам и узнать, куда ведёт дорога.',reward:{gems:10,materials:5,xp:120},relations:{bjorn:2,astrid:5,einar:8}},
  {id:'mark',icon:'✨',title:'Оставить знак',text:'Не входить сразу, а отметить путь для будущего.',reward:{coins:700,gems:8,xp:110},relations:{bjorn:3,astrid:6,einar:6}}
 ]}
};
function branchEventKey(ch){return `${ch}:${Store.state.worldConvergence?.path||'none'}`}
function branchEventOpen(){const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),c=s.worldConvergence||{};return Boolean(c.claimed&&c.path&&ch>Number(c.chapter||0))}
function openTerritoryBranch(){
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),path=s.worldConvergence?.path,b=TERRITORY_BRANCHES[path];if(!b||!branchEventOpen())return;
 const key=branchEventKey(ch);if(s.worldBranchEvents?.[key]){const old=s.worldBranchEvents[key];modal(`${b.icon} ${b.place}`,`<p><b>${old.title||'Событие завершено'}</b></p><p>Ты уже сделал выбор в этой главе.</p><p style="opacity:.68">Он записан в общей истории Territory.</p>`);return;}
 const choices=b.choices.map(x=>`<button data-branch-choice="${x.id}" style="width:100%;margin-top:7px;border:1px solid rgba(220,180,90,.16);border-radius:10px;padding:10px;background:rgba(255,255,255,.04);color:inherit;text-align:left"><b>${x.icon} ${x.title}</b><br><span style="font-size:9px;opacity:.68">${x.text}</span><br><small>${locationRewardText(x.reward)}</small></button>`).join('');
 modal(`${b.icon} ${b.place}`,`<div class="branch-scene"><div class="branch-art">${b.icon}</div><div class="branch-mark">ПОСЛЕДСТВИЯ ОБЩЕГО ПУТИ · ГЛАВА ${ch}</div><h3>${b.title}</h3><p>${b.text}</p><div class="branch-choices">${choices}</div></div>`);
 document.querySelectorAll('[data-branch-choice]').forEach(btn=>btn.onclick=()=>claimTerritoryBranch(btn.dataset.branchChoice));
}
function claimTerritoryBranch(choiceId){
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),path=s.worldConvergence?.path,b=TERRITORY_BRANCHES[path];if(!b||!branchEventOpen())return;const key=branchEventKey(ch),v=b.choices.find(x=>x.id===choiceId);if(!v||s.worldBranchEvents?.[key])return;
 s.worldBranchEvents=s.worldBranchEvents||{};s.worldBranchEvents[key]={at:Date.now(),path,choice:v.id,title:v.title,chapter:ch};s.coins=(Number(s.coins)||0)+(v.reward.coins||0);s.gems=(Number(s.gems)||0)+(v.reward.gems||0);s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials+=v.reward.materials||0;
 s.npcRelations=s.npcRelations||{};Object.entries(v.relations||{}).forEach(([npc,gain])=>s.npcRelations[npc]=Math.min(100,(Number(s.npcRelations[npc])||0)+Number(gain||0)));
 s.worldMemories=s.worldMemories||{};s.worldMemories[key]={at:Date.now(),chapter:ch,location:`territory_${path}`,choice:v.id,icon:v.icon,title:`${b.title}: ${v.title}`,text:v.text};Store.addXp?.(v.reward.xp||0);Store.saveNow();roadmap();modal(`${b.icon} ${b.place}`,`<div class="branch-scene"><div class="branch-art">${v.icon}</div><h3>${v.title}</h3><p>${v.text}</p><div class="branch-reward">${locationRewardText(v.reward)}</div><p style="opacity:.68">Этот выбор стал первым последствием общего пути и останется в хронике Territory.</p></div>`);
}

const TERRITORY_FRONTIERS={
 unite:{icon:'🤝',title:'Пограничный лагерь',place:'Стан союзников',text:'После общего решения люди начинают стекаться к Territory. Теперь нужно решить, как встретить первых союзников.',choices:[
  {id:'welcome',icon:'🔥',title:'Разжечь общий огонь',text:'Открыть лагерь для всех и показать, что союз начинается с доверия.',reward:{coins:1400,gems:6,xp:130},relations:{bjorn:3,astrid:4,einar:3}},
  {id:'guard',icon:'🛡️',title:'Укрепить заставу',text:'Сначала защитить границу, а уже потом приглашать остальных.',reward:{coins:1700,materials:7,xp:140},relations:{bjorn:4,astrid:3,einar:2}}
 ]},
 forge:{icon:'🔥',title:'Дорога стали',place:'Кузнечный тракт',text:'Слухи о новой кузнице доходят до соседних земель. Первое решение определит, чем станет этот путь.',choices:[
  {id:'trade',icon:'⚒️',title:'Открыть торговый путь',text:'Пусть созданное в огне станет началом обмена с новыми землями.',reward:{coins:2100,gems:4,materials:8,xp:135},relations:{bjorn:6,astrid:2,einar:2}},
  {id:'arm',icon:'⚔️',title:'Вооружить дозор',text:'Первые клинки должны защищать границу, пока новый порядок только рождается.',reward:{coins:1500,gems:6,materials:10,xp:145},relations:{bjorn:5,astrid:4,einar:2}}
 ]},
 rune:{icon:'🗿',title:'Дорога древних',place:'Забытый перевал',text:'После открытия древнего пути на карте появляется перевал. За ним скрывается земля, о которой нет ни одной записи.',choices:[
  {id:'scout',icon:'🏹',title:'Отправить разведку',text:'Сначала узнать, что находится за перевалом, не рискуя всем отрядом.',reward:{gems:12,xp:155},relations:{bjorn:2,astrid:7,einar:7}},
  {id:'cross',icon:'🗿',title:'Перейти перевал',text:'Довериться карте и сделать первый шаг в неизвестность.',reward:{coins:900,gems:15,materials:5,xp:170},relations:{bjorn:2,astrid:5,einar:9}}
 ]}
};
function frontierKey(ch){return `${ch}:${Store.state.worldConvergence?.path||'none'}`}
function frontierOpen(){const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),c=s.worldConvergence||{};const branchDone=Object.keys(s.worldBranchEvents||{}).some(k=>k.startsWith(`${ch}:`));return Boolean(c.claimed&&c.path&&ch>Number(c.chapter||0)&&branchDone)}
function openTerritoryFrontier(){
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),path=s.worldConvergence?.path,f=TERRITORY_FRONTIERS[path];if(!f||!frontierOpen())return;
 const key=frontierKey(ch),old=s.worldPathFrontiers?.[key];
 if(old){modal(`${f.icon} ${f.place}`,`<p><b>${old.title}</b></p><p>Ты уже определил судьбу этой точки в главе ${ch}.</p><p style="opacity:.68">Решение осталось в памяти мира.</p>`);return;}
 const choices=f.choices.map(x=>`<button data-frontier-choice="${x.id}" style="width:100%;margin-top:7px;border:0;border-radius:10px;padding:10px;background:rgba(220,180,90,.15);color:inherit;font-weight:900;text-align:left"><b>${x.icon} ${x.title}</b><br><span style="font-size:9px;opacity:.68">${x.text}</span><br><small>${locationRewardText(x.reward)}</small></button>`).join('');
 modal(`${f.icon} ${f.place}`,`<div class="frontier-scene"><div class="frontier-art">${f.icon}</div><div class="frontier-mark">НОВАЯ ЗЕМЛЯ · ГЛАВА ${ch}</div><h3>${f.title}</h3><p>${f.text}</p><div class="frontier-choices">${choices}</div></div>`);
 document.querySelectorAll('[data-frontier-choice]').forEach(b=>b.onclick=()=>claimTerritoryFrontier(b.dataset.frontierChoice));
}
function claimTerritoryFrontier(choiceId){
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),path=s.worldConvergence?.path,f=TERRITORY_FRONTIERS[path];if(!f||!frontierOpen())return;const key=frontierKey(ch),v=f.choices.find(x=>x.id===choiceId);if(!v||s.worldPathFrontiers?.[key])return;
 s.worldPathFrontiers=s.worldPathFrontiers||{};s.worldPathFrontiers[key]={at:Date.now(),chapter:ch,path,choice:v.id,title:v.title};s.coins=(Number(s.coins)||0)+(v.reward.coins||0);s.gems=(Number(s.gems)||0)+(v.reward.gems||0);s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials+=(v.reward.materials||0);
 s.npcRelations=s.npcRelations||{};Object.entries(v.relations||{}).forEach(([npc,gain])=>s.npcRelations[npc]=Math.min(100,(Number(s.npcRelations[npc])||0)+Number(gain||0)));
 s.worldMemories=s.worldMemories||{};s.worldMemories[`frontier:${key}`]={at:Date.now(),chapter:ch,location:`frontier_${path}`,choice:v.id,icon:v.icon,title:`${f.title}: ${v.title}`,text:v.text};Store.addXp?.(v.reward.xp||0);Store.saveNow();roadmap();modal(`${f.icon} ${f.place}`,`<div class="frontier-scene"><div class="frontier-art">${v.icon}</div><h3>${v.title}</h3><p>${v.text}</p><div class="frontier-reward">${locationRewardText(v.reward)}</div><p style="opacity:.68">Эта точка теперь получила собственную историю. Следующие главы смогут опираться на твой выбор.</p></div>`);
}

const TERRITORY_FRONTIER_AFTERMATH={
 unite:{
  welcome:{icon:'🔥',title:'Первый общий вечер',place:'Стан союзников',text:'После первого костра к лагерю приходят новые люди. Теперь союз должен решить, кому доверить первые припасы.',choices:[
   {id:'share',icon:'🍞',title:'Разделить припасы',text:'Показать, что новый союз начинается с общего стола.',reward:{coins:1800,gems:5,xp:145},relations:{bjorn:4,astrid:5,einar:4}},
   {id:'reserve',icon:'📦',title:'Создать запас',text:'Сохранить часть ресурсов на случай тяжёлой зимы.',reward:{coins:2200,materials:6,xp:150},relations:{bjorn:5,astrid:3,einar:3}}
  ]},
  guard:{icon:'🛡️',title:'Первый дозор',place:'Стан союзников',text:'Укреплённая застава замечает следы чужого отряда. Нужно решить, как встретить неизвестных.',choices:[
   {id:'signal',icon:'🏳️',title:'Поднять знамя',text:'Показать, что граница открыта для переговоров.',reward:{coins:1600,gems:7,xp:155},relations:{bjorn:3,astrid:5,einar:5}},
   {id:'watch',icon:'👁️',title:'Наблюдать из тени',text:'Не раскрывать силы и сначала узнать намерения чужаков.',reward:{coins:1900,gems:4,materials:5,xp:165},relations:{bjorn:4,astrid:6,einar:4}}
  ]}
 },
 forge:{
  trade:{icon:'⚒️',title:'Первый заказ',place:'Кузнечный тракт',text:'Торговцы привезли первый крупный заказ. От него зависит репутация нового тракта.',choices:[
   {id:'quality',icon:'✨',title:'Сделать идеально',text:'Поставить качество выше скорости и заработать имя.',reward:{coins:2600,gems:6,xp:165},relations:{bjorn:7,astrid:2,einar:2}},
   {id:'volume',icon:'📦',title:'Выпустить больше',text:'Увеличить производство и быстро наполнить рынок оружием.',reward:{coins:3200,materials:9,xp:155},relations:{bjorn:6,astrid:3,einar:2}}
  ]},
  arm:{icon:'⚔️',title:'Испытание дозора',place:'Кузнечный тракт',text:'Первое оружие дозора должно пройти настоящее испытание на границе.',choices:[
   {id:'test',icon:'🧪',title:'Испытать клинки',text:'Проверить каждую деталь до выхода отряда.',reward:{coins:2100,gems:7,materials:8,xp:175},relations:{bjorn:7,astrid:5,einar:2}},
   {id:'march',icon:'🏹',title:'Вывести дозор',text:'Не ждать — отправить людей сразу и довериться новой стали.',reward:{coins:2400,gems:5,xp:185},relations:{bjorn:5,astrid:7,einar:3}}
  ]}
 },
 rune:{
  scout:{icon:'🏹',title:'След за перевалом',place:'Земля за перевалом',text:'Разведчики возвращаются с новостью: за перевалом есть древняя дорога, но она ведёт к неизвестным знакам.',choices:[
   {id:'map',icon:'🗺️',title:'Составить карту',text:'Сначала превратить неизвестность в понятный путь.',reward:{gems:14,xp:180},relations:{bjorn:3,astrid:8,einar:8}},
   {id:'follow',icon:'🐺',title:'Идти по следу',text:'Продолжить разведку, пока след ещё свежий.',reward:{coins:1300,gems:10,materials:4,xp:195},relations:{bjorn:3,astrid:9,einar:7}}
  ]},
  cross:{icon:'🗿',title:'Земля за воротами',place:'Земля за перевалом',text:'Первый переход изменил старую карту. Теперь нужно решить, что делать с найденным древним знаком.',choices:[
   {id:'decode',icon:'📜',title:'Расшифровать знак',text:'Остановиться и понять предупреждение, оставленное древними.',reward:{gems:18,materials:5,xp:205},relations:{bjorn:3,astrid:6,einar:10}},
   {id:'advance',icon:'🔥',title:'Продолжить путь',text:'Не останавливаться у первой загадки и двигаться дальше.',reward:{coins:1800,gems:12,xp:215},relations:{bjorn:3,astrid:8,einar:9}}
  ]}
 }
};
function frontierAftermathKey(ch,path,choice){return `${ch}:${path}:${choice}`}
function frontierAftermathOpen(){
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),path=s.worldConvergence?.path;
 if(!path)return null;
 const entries=Object.entries(s.worldPathFrontiers||{}).filter(([k,v])=>v&&v.path===path&&Number(v.chapter)<ch).sort((a,b)=>(Number(a[1].chapter)||0)-(Number(b[1].chapter)||0));
 if(!entries.length)return null;
 const [oldKey,old]=entries[entries.length-1],f=TERRITORY_FRONTIER_AFTERMATH[path]?.[old.choice];
 return f?{oldKey,old,f,ch}:null;
}
function openTerritoryFrontierAftermath(){
 const info=frontierAftermathOpen();if(!info)return;const {old,f,ch}=info,key=frontierAftermathKey(ch,old.path,old.choice),s=Store.state;
 if(s.worldFrontierAftermath?.[key]){modal(`${f.icon} ${f.place}`,`<p><b>${s.worldFrontierAftermath[key].title}</b></p><p>Ты уже прошёл это продолжение в главе ${ch}.</p><p style="opacity:.68">Решение осталось в памяти мира.</p>`);return;}
 const choices=f.choices.map(x=>`<button data-frontier-after="${x.id}" style="width:100%;margin-top:7px;border:1px solid rgba(120,180,150,.16);border-radius:10px;padding:10px;background:rgba(255,255,255,.04);color:inherit;text-align:left"><b>${x.icon} ${x.title}</b><br><span style="font-size:9px;opacity:.68">${x.text}</span><br><small>${locationRewardText(x.reward)}</small></button>`).join('');
 modal(`${f.icon} ${f.place}`,`<div class="frontier-after-scene"><div class="frontier-after-art">${f.icon}</div><div class="frontier-after-mark">ОТГОЛОСОК ГРАНИЦЫ · ГЛАВА ${ch}</div><h3>${f.title}</h3><p>${f.text}</p><div>${choices}</div></div>`);
 document.querySelectorAll('[data-frontier-after]').forEach(b=>b.onclick=()=>claimTerritoryFrontierAftermath(b.dataset.frontierAfter));
}
function claimTerritoryFrontierAftermath(choiceId){
 const info=frontierAftermathOpen();if(!info)return;const {old,f,ch}=info,s=Store.state,key=frontierAftermathKey(ch,old.path,old.choice),v=f.choices.find(x=>x.id===choiceId);if(!v||s.worldFrontierAftermath?.[key])return;
 s.worldFrontierAftermath=s.worldFrontierAftermath||{};s.worldFrontierAftermath[key]={at:Date.now(),chapter:ch,path:old.path,sourceChoice:old.choice,choice:v.id,title:v.title};
 s.coins=(Number(s.coins)||0)+(v.reward.coins||0);s.gems=(Number(s.gems)||0)+(v.reward.gems||0);s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials+=(v.reward.materials||0);
 s.npcRelations=s.npcRelations||{};Object.entries(v.relations||{}).forEach(([npc,gain])=>s.npcRelations[npc]=Math.min(100,(Number(s.npcRelations[npc])||0)+Number(gain||0)));
 s.worldMemories=s.worldMemories||{};s.worldMemories[`frontier-aftermath:${key}`]={at:Date.now(),chapter:ch,location:`frontier_aftermath_${old.path}`,choice:v.id,icon:v.icon,title:`${f.title}: ${v.title}`,text:v.text};Store.addXp?.(v.reward.xp||0);Store.saveNow();roadmap();modal(`${f.icon} ${f.place}`,`<div class="frontier-after-scene"><div class="frontier-after-art">${v.icon}</div><h3>${v.title}</h3><p>${v.text}</p><div class="frontier-after-reward">${locationRewardText(v.reward)}</div><p style="opacity:.68">Граница изменилась после твоего прошлого решения. Этот след останется в хронике.</p></div>`);
}
function renderTerritoryFrontierAftermath(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.frontier-after-panel');if(!panel){panel=document.createElement('section');panel.className='frontier-after-panel';const st=document.createElement('style');st.textContent=`.frontier-after-panel{margin:16px 0;padding:15px;border-radius:18px;background:radial-gradient(circle at 50% 0,rgba(70,120,100,.16),rgba(8,11,10,.99) 62%);border:1px solid rgba(120,180,150,.3);box-shadow:0 14px 34px rgba(0,0,0,.28)}.frontier-after-panel h3{margin:0 0 4px}.frontier-after-sub{font-size:10px;opacity:.62;margin-bottom:10px}.frontier-after-card{padding:11px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.frontier-after-card.ready{border-color:rgba(120,180,150,.44);box-shadow:inset 0 0 22px rgba(120,180,150,.04)}.frontier-after-card.done{opacity:.68}.frontier-after-icons{text-align:center;font-size:30px;margin-bottom:6px}.frontier-after-card p{margin:4px 0;font-size:10px;opacity:.7}.frontier-after-card button{width:100%;margin-top:8px;border:0;border-radius:9px;padding:9px;background:rgba(120,180,150,.16);color:inherit;font-weight:900}.frontier-after-scene{text-align:center}.frontier-after-art{font-size:58px;filter:drop-shadow(0 8px 15px rgba(0,0,0,.45));animation:frontierAfterFloat 3s ease-in-out infinite}.frontier-after-mark{font-size:8px;letter-spacing:1.4px;opacity:.45}.frontier-after-scene h3{margin:8px 0;font-size:16px}.frontier-after-scene p{font-size:11px;line-height:1.55}.frontier-after-reward{margin:10px 0;padding:9px;border-radius:9px;background:rgba(120,180,150,.1);font-size:10px}@keyframes frontierAfterFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}`;document.head.appendChild(st)}
 const info=frontierAftermathOpen();if(!info){panel.innerHTML='';return}const {old,f,ch}=info,s=Store.state,key=frontierAftermathKey(ch,old.path,old.choice),done=Boolean(s.worldFrontierAftermath?.[key]);panel.innerHTML=`<h3>🌌 Отголосок границы</h3><div class="frontier-after-sub">Прошлогодний выбор вернулся в новой главе и получил продолжение.</div><div class="frontier-after-card ${done?'done':'ready'}"><div class="frontier-after-icons">${f.icon} · ${f.place}</div><b>${done?'Продолжение этой главы завершено':f.title}</b><p>${done?`Твой выбор: <b>${s.worldFrontierAftermath[key].title}</b>`:`Ранее ты выбрал: ${old.title}. Теперь граница отвечает.`}</p><button data-open-frontier-after ${done?'disabled':''}>${done?'✓ Записано в хронике':'🌌 Продолжить историю'}</button></div>`;const btn=panel.querySelector('[data-open-frontier-after]');if(btn)btn.onclick=openTerritoryFrontierAftermath;
}

function renderTerritoryFrontier(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.frontier-panel');if(!panel){panel=document.createElement('section');panel.className='frontier-panel';const st=document.createElement('style');st.textContent=`.frontier-panel{margin:16px 0;padding:15px;border-radius:18px;background:radial-gradient(circle at 50% 0,rgba(90,125,80,.16),rgba(8,11,10,.99) 60%);border:1px solid rgba(130,175,105,.3);box-shadow:0 14px 34px rgba(0,0,0,.28)}.frontier-panel h3{margin:0 0 4px}.frontier-sub{font-size:10px;opacity:.62;margin-bottom:10px}.frontier-card{padding:11px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.frontier-card.ready{border-color:rgba(130,175,105,.44);box-shadow:inset 0 0 20px rgba(130,175,105,.04)}.frontier-card.done{opacity:.68}.frontier-icons{text-align:center;font-size:30px;margin-bottom:6px}.frontier-card p{margin:4px 0;font-size:10px;opacity:.7}.frontier-card button{width:100%;margin-top:8px;border:0;border-radius:9px;padding:9px;background:rgba(130,175,105,.16);color:inherit;font-weight:900}.frontier-scene{text-align:center}.frontier-art{font-size:56px;filter:drop-shadow(0 8px 15px rgba(0,0,0,.45));animation:frontierFloat 3s ease-in-out infinite}.frontier-mark{font-size:8px;letter-spacing:1.4px;opacity:.45}.frontier-scene h3{margin:8px 0;font-size:16px}.frontier-scene p{font-size:11px;line-height:1.55}.frontier-choices{margin-top:10px}.frontier-reward{margin:10px 0;padding:9px;border-radius:9px;background:rgba(130,175,105,.1);font-size:10px}@keyframes frontierFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}`;document.head.appendChild(st)}
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),path=s.worldConvergence?.path,f=TERRITORY_FRONTIERS[path],ready=frontierOpen(),key=ready?frontierKey(ch):'',done=Boolean(key&&s.worldPathFrontiers?.[key]);if(!f){panel.innerHTML='';return}
 panel.innerHTML=`<h3>🧭 Новая граница</h3><div class="frontier-sub">Последствие общего пути теперь открывает новую точку мира.</div><div class="frontier-card ${done?'done':ready?'ready':''}"><div class="frontier-icons">${f.icon} · ${f.place}</div><b>${done?'Точка этой главы определена':ready?f.title:'Сначала заверши последствие общего пути'}</b><p>${done?`Твой выбор: <b>${s.worldPathFrontiers[key].title}</b>`:ready?f.text:`Выбранный путь: ${TERRITORY_CONVERGENCE.paths[path]?.title||'неизвестно'}.`}</p><button data-open-frontier ${!ready||done?'disabled':''}>${done?'✓ Записано в хронике':ready?'🧭 Исследовать':'🔒 Закрыто'}</button></div>`;
 const btn=panel.querySelector('[data-open-frontier]');if(btn)btn.onclick=openTerritoryFrontier;
}

function renderTerritoryBranch(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.branch-panel');if(!panel){panel=document.createElement('section');panel.className='branch-panel';const st=document.createElement('style');st.textContent=`.branch-panel{margin:16px 0;padding:15px;border-radius:18px;background:radial-gradient(circle at 50% 0,rgba(140,105,55,.18),rgba(9,10,12,.99) 60%);border:1px solid rgba(220,180,90,.3);box-shadow:0 14px 34px rgba(0,0,0,.28)}.branch-panel h3{margin:0 0 4px;font-size:15px}.branch-sub{font-size:10px;opacity:.62;margin-bottom:10px}.branch-card{padding:11px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.branch-card.ready{border-color:rgba(220,180,90,.42);box-shadow:inset 0 0 20px rgba(220,180,90,.04)}.branch-card.done{opacity:.68}.branch-icons{text-align:center;font-size:30px;margin-bottom:6px}.branch-card p{margin:4px 0;font-size:10px;opacity:.7}.branch-card button{width:100%;margin-top:8px;border:0;border-radius:9px;padding:9px;background:rgba(220,180,90,.17);color:inherit;font-weight:900}.branch-scene{text-align:center}.branch-art{font-size:52px;filter:drop-shadow(0 8px 14px rgba(0,0,0,.45));animation:branchFloat 2.8s ease-in-out infinite}.branch-mark{font-size:8px;letter-spacing:1.2px;opacity:.45}.branch-scene h3{margin:8px 0;font-size:16px}.branch-scene p{font-size:11px;line-height:1.5}.branch-choices{margin-top:10px}.branch-reward{margin:10px 0;padding:9px;border-radius:9px;background:rgba(220,180,90,.1);font-size:10px}@keyframes branchFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}`;document.head.appendChild(st)}
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),path=s.worldConvergence?.path,b=TERRITORY_BRANCHES[path],ready=branchEventOpen(),key=ready?branchEventKey(ch):'',done=Boolean(key&&s.worldBranchEvents?.[key]);
 if(!b){panel.innerHTML='';return}panel.innerHTML=`<h3>🌍 Последствия общего пути</h3><div class="branch-sub">Выбранный путь теперь начинает менять мир в следующих главах.</div><div class="branch-card ${done?'done':ready?'ready':''}"><div class="branch-icons">${b.icon} · ${b.place}</div><b>${done?'Событие этой главы завершено':ready?b.title:'Следующая глава откроет продолжение'}</b><p>${done?`Твой выбор: <b>${s.worldBranchEvents[key].title}</b>`:ready?b.text:`Общий путь выбран в главе ${s.worldConvergence?.chapter||'?'}; перейди в следующую главу.`}</p><button data-open-branch ${!ready||done?'disabled':''}>${done?'✓ Записано в хронике':ready?'🌍 Войти в событие':'🔒 Закрыто'}</button></div>`;
 const btn=panel.querySelector('[data-open-branch]');if(btn)btn.onclick=openTerritoryBranch;
}

function renderTerritoryConvergence(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.convergence-panel');
 if(!panel){panel=document.createElement('section');panel.className='convergence-panel';const style=document.createElement('style');style.textContent=`.convergence-panel{margin:16px 0;padding:15px;border-radius:18px;background:radial-gradient(circle at 50% 0,rgba(121,92,48,.22),rgba(10,11,13,.99) 58%);border:1px solid rgba(215,176,92,.34);box-shadow:0 14px 36px rgba(0,0,0,.3)}.convergence-panel h3{margin:0 0 4px;font-size:15px}.convergence-sub{font-size:10px;opacity:.62;margin-bottom:11px}.convergence-card{padding:11px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.convergence-card.ready{border-color:rgba(215,176,92,.48);box-shadow:inset 0 0 24px rgba(215,176,92,.05)}.convergence-card.done{opacity:.72}.convergence-icons{font-size:28px;letter-spacing:6px;text-align:center;margin-bottom:7px}.convergence-card p{margin:4px 0;font-size:10px;opacity:.7}.convergence-card button{margin-top:8px;width:100%;border:0;border-radius:9px;padding:9px;background:rgba(215,176,92,.17);color:inherit;font-weight:900}.convergence-scene{text-align:center}.convergence-art{font-size:48px;letter-spacing:5px;margin:3px 0 8px;filter:drop-shadow(0 8px 12px rgba(0,0,0,.45));animation:convergenceFloat 3s ease-in-out infinite}.convergence-mark{font-size:8px;letter-spacing:1.5px;opacity:.45}.convergence-scene h3{margin:8px 0;font-size:16px}.convergence-scene p{font-size:11px;line-height:1.55}.convergence-reward{margin:11px 0;padding:9px;border-radius:9px;background:rgba(215,176,92,.1);font-size:10px}@keyframes convergenceFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}`;document.head.appendChild(style)}
 const s=Store.state,ready=convergenceReady(s),done=Boolean(s.worldConvergence?.claimed),ch=Math.max(1,Number(s.currentChapter)||1);panel.innerHTML=`<h3>🌍 Общая история Territory</h3><div class="convergence-sub">Три личные судьбы наконец сходятся в одной большой истории.</div><div class="convergence-card ${done?'done':ready?'ready':''}"><div class="convergence-icons">⚒️ 🏹 🗿</div><b>${done?'История уже началась':ready?'Три пути сошлись':'Большая встреча ещё впереди'}</b><p>${done?`Глава ${s.worldConvergence.chapter} · путь: ${TERRITORY_CONVERGENCE.paths[s.worldConvergence.path]?.title||'выбранный путь'}`:ready?'Все три личные истории завершены. В следующей главе тебя ждёт общий выбор.':'Заверши личные истории Бьёрна, Астрид и Эйнара, затем перейди в следующую главу.'}</p><button data-open-convergence ${!ready||done?'disabled':''}>${done?'✓ Записано в хронике':ready?'🌍 Начать общую историю':'🔒 Закрыто'}</button></div>`;
 const b=panel.querySelector('[data-open-convergence]');if(b)b.onclick=openTerritoryConvergence;
}

function renderNpcStoryAftermath(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.npc-after-panel');
 if(!panel){panel=document.createElement('section');panel.className='npc-after-panel';host.appendChild(panel);const style=document.createElement('style');style.textContent=`.npc-after-panel{margin:14px 0;padding:14px;border-radius:16px;background:linear-gradient(180deg,rgba(34,27,23,.98),rgba(10,10,10,.98));border:1px solid rgba(220,172,82,.3);box-shadow:0 10px 28px rgba(0,0,0,.24)}.npc-after-panel h3{margin:0 0 4px}.npc-after-sub{font-size:10px;opacity:.62;margin-bottom:10px}.npc-after-list{display:grid;gap:8px}.npc-after-card{display:grid;grid-template-columns:34px 1fr auto;gap:8px;align-items:center;padding:10px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.npc-after-card.ready{border-color:rgba(220,172,82,.34)}.npc-after-card.locked{opacity:.48}.npc-after-icon{font-size:24px;text-align:center}.npc-after-card b{font-size:11px}.npc-after-card p{margin:2px 0;font-size:9px;opacity:.65}.npc-after-card small{font-size:9px;opacity:.72}.npc-after-card button{border:0;border-radius:8px;padding:7px 9px;background:rgba(220,172,82,.16);color:inherit;font-weight:900;font-size:9px}.npc-after-card button:disabled{opacity:.42;background:rgba(255,255,255,.05)}.npc-after-scene{text-align:center;padding:4px}.npc-after-art{font-size:58px;animation:npcBondFloat 2.8s ease-in-out infinite}.npc-after-scene p{font-size:11px;line-height:1.5}.npc-after-reward{margin:10px 0;padding:8px;border-radius:9px;background:rgba(220,172,82,.1);font-size:10px}@media(max-width:520px){.npc-after-card{grid-template-columns:30px 1fr}.npc-after-card button{grid-column:2;justify-self:start}}`;document.head.appendChild(style)}
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1);
 panel.innerHTML=`<h3>📖 Продолжение личных историй</h3><div class="npc-after-sub">Открытые тайны не заканчиваются одной сценой. Их след возвращается в следующих главах.</div><div class="npc-after-list">${NPC_STORY_AFTERMATTER.map(x=>{const npc=NPCS.find(n=>n.id===x.npc),ready=npcStoryAftermathOpen(x,s,ch),done=npcStoryAftermathDone(ch,x.npc);return `<article class="npc-after-card ${ready?'ready':'locked'}"><div class="npc-after-icon">${x.icon}</div><div><b>${x.title}</b><p>${npc?.name||x.npc} · ${ready?(done?'✓ Уже пройдено в этой главе':x.text):'🔒 Открой тайну персонажа и продолжи в следующей главе'}</p><small>${ready?(done?'История сохранена':npcRewardText(x.reward)+' · +'+x.relation+' доверия'):'Нужна открытая тайна и следующий глава'}</small></div><button data-npc-after="${x.npc}" ${!ready||done?'disabled':''}>${done?'✓ Завершено':ready?'📖 Продолжить':'🔒 Закрыто'}</button></article>`}).join('')}</div>`;
 panel.querySelectorAll('[data-npc-after]').forEach(b=>b.onclick=()=>openNpcStoryAftermath(b.dataset.npcAfter));
}

function renderNPCs(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.npc-panel');if(!panel){panel=document.createElement('section');panel.className='npc-panel';host.appendChild(panel);const style=document.createElement('style');style.textContent=`.npc-panel{margin:14px 0;padding:14px;border-radius:16px;background:linear-gradient(180deg,rgba(32,25,20,.98),rgba(12,10,9,.98));border:1px solid rgba(205,160,83,.28);box-shadow:0 10px 28px rgba(0,0,0,.24)}.npc-panel h3{margin:0 0 4px}.npc-sub{font-size:10px;opacity:.62;margin-bottom:10px}.npc-list{display:grid;gap:8px}.npc-card{padding:10px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.npc-head{display:flex;gap:9px;align-items:center}.npc-head>span{font-size:26px}.npc-head b{font-size:12px}.npc-head small{display:block;font-size:9px;opacity:.55;margin-top:2px}.npc-desc{margin:6px 0;font-size:9px;opacity:.7}.npc-bar{height:7px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden}.npc-bar i{display:block;height:100%;background:linear-gradient(90deg,#b98235,#e9cb72);transition:width .25s}.npc-meta{display:flex;justify-content:space-between;margin-top:4px;font-size:8px;opacity:.65}.npc-actions{display:flex;gap:5px;margin-top:8px}.npc-actions button{flex:1;border:0;border-radius:8px;padding:7px 4px;background:rgba(205,160,83,.14);color:inherit;font-weight:800;font-size:9px}.npc-actions button:disabled{opacity:.38;background:rgba(255,255,255,.05)}.npc-story-scene{text-align:center;padding:4px 2px}.npc-story-art{font-size:58px;animation:npcBondFloat 2.8s ease-in-out infinite}.npc-story-scene p{font-size:11px;line-height:1.5}.npc-story-reward{margin:10px 0;padding:8px;border-radius:9px;background:rgba(205,160,83,.1);font-size:10px}.npc-story-scene button{width:100%;border:0;border-radius:9px;padding:9px;background:rgba(205,160,83,.18);color:inherit;font-weight:800}.npc-bond-scene{text-align:center;padding:4px 2px}.npc-bond-art{font-size:56px;filter:drop-shadow(0 8px 12px rgba(0,0,0,.4));animation:npcBondFloat 2.6s ease-in-out infinite}.npc-bond-tier{margin-top:5px;font-size:10px;opacity:.62}.npc-bond-scene p{font-size:11px;line-height:1.5;margin:12px 4px}.npc-bond-progress{height:7px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden;margin:10px 0 5px}.npc-bond-progress i{display:block;height:100%;background:linear-gradient(90deg,#b98235,#e9cb72)}.npc-bond-scene>small{font-size:8px;opacity:.58}@keyframes npcBondFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}`;document.head.appendChild(style)}
 const s=Store.state;panel.innerHTML=`<h3>🤝 Люди мира</h3><div class="npc-sub">Поступки героя меняют отношения. Доверие открывает награды.</div><div class="npc-list">${NPCS.map(n=>{const r=npcRelation(n.id),t=npcTier(n),ch=Math.max(1,Number(s.currentChapter)||1),talk=npcLogKey(ch,n.id,'talk'),help=npcLogKey(ch,n.id,'help'),gift=npcLogKey(ch,n.id,'gift');return `<article class="npc-card"><div class="npc-head"><span>${n.icon}</span><div><b>${n.name}</b><small>${n.role} · ${npcTierName(t)}</small></div></div><div class="npc-desc">${n.desc}</div><div class="npc-bar"><i style="width:${r}%"></i></div><div class="npc-meta"><span>${r}/100</span><span>До следующего уровня: ${t<4?Math.max(0,n.thresholds[t]-r):0}</span></div><div class="npc-actions"><button data-npc="${n.id}" data-action="talk" ${s.npcInteractionLog?.[talk]?'disabled':''}>💬 Поговорить</button><button data-npc="${n.id}" data-action="help" ${s.npcInteractionLog?.[help]?'disabled':''}>🤝 Помочь · 100🪙</button><button data-npc="${n.id}" data-action="gift" ${s.npcInteractionLog?.[gift]?'disabled':''}>🎁 Подарок · 2🔩</button><button data-npc-bond="${n.id}">📖 Вспомнить</button><button data-npc-story="${n.id}">🔐 Тайна</button></div></article>`}).join('')}</div>`;
 panel.querySelectorAll('[data-npc]').forEach(b=>b.onclick=()=>npcInteract(b.dataset.npc,b.dataset.action));panel.querySelectorAll('[data-npc-bond]').forEach(b=>b.onclick=()=>openNpcBond(b.dataset.npcBond));panel.querySelectorAll('[data-npc-story]').forEach(b=>{const m=npcStoryMoment(b.dataset.npcStory);b.textContent=npcStoryDone(b.dataset.npcStory)?'🔓 Открыто':(npcRelation(b.dataset.npcStory)>=(m?.need||999)?'🔐 Тайна':'🔒 Тайна');b.onclick=()=>openNpcStory(b.dataset.npcStory)});
}

const NPC_QUESTS=[
 {id:'bjorn_axe',npc:'bjorn',icon:'🔨',title:'Крепкий клинок',text:'Бьёрн просит принести 3 найденных предмета, чтобы выбрать металл для нового клинка.',need:3,key:'loot',tier:1,reward:{coins:700,materials:8,xp:45}},
 {id:'bjorn_forge',npc:'bjorn',icon:'🔥',title:'Огонь кузницы',text:'Покажи Бьёрну, что ты умеешь работать с его кузницей: 3 успешных улучшения.',need:3,key:'forge',tier:2,reward:{coins:1200,gems:5,materials:12,xp:70}},
 {id:'astrid_tracks',npc:'astrid',icon:'🏹',title:'След на снегу',text:'Астрид нужна помощь в разведке. Победи 5 обычных противников.',need:5,key:'wins',tier:1,reward:{coins:800,gems:4,xp:55}},
 {id:'astrid_hunt',npc:'astrid',icon:'🐺',title:'Большая охота',text:'Докажи свою выдержку: победи босса и вернись к Астрид.',need:1,key:'bosses',tier:2,reward:{coins:1600,gems:8,xp:100}},
 {id:'einar_runes',npc:'einar',icon:'🗿',title:'Забытые руны',text:'Эйнар просит завершить ещё одну главу, чтобы найти знак древнего пути.',need:1,key:'chapters',tier:1,reward:{coins:900,materials:10,xp:65}},
 {id:'einar_oath',npc:'einar',icon:'🛡️',title:'Клятва хранителя',text:'Заверши 3 главы и докажи, что тебе можно доверить тайну племени.',need:3,key:'chapters',tier:2,reward:{coins:2200,gems:12,materials:15,xp:130}}
];
function npcQuestValue(q,s){
 if(q.key==='wins')return Number(s.pve?.wins)||0;
 if(q.key==='loot')return Number(s.lootFound)||0;
 if(q.key==='forge')return Number(s.forge?.successes)||0;
 if(q.key==='bosses')return Number(s.pve?.bossDefeated)||0;
 if(q.key==='chapters')return Math.max(0,Number(s.currentChapter||1)-1);
 return 0;
}
function npcQuestProgress(q,s){
 const unlocked=npcTier(NPCS.find(n=>n.id===q.npc)||{id:q.npc,thresholds:[]})>=q.tier;
 const cur=Math.min(q.need,npcQuestValue(q,s));
 return {unlocked,cur,done:unlocked&&cur>=q.need,claimed:Boolean(s.npcQuests?.claimed?.[q.id])};
}
function claimNpcQuest(id){
 const s=Store.state,q=NPC_QUESTS.find(x=>x.id===id);if(!q)return;
 const p=npcQuestProgress(q,s);if(!p.done||p.claimed)return;
 const r=q.reward||{};s.coins=(Number(s.coins)||0)+(r.coins||0);s.gems=(Number(s.gems)||0)+(r.gems||0);
 s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials=(Number(s.forge.materials)||0)+(r.materials||0);
 s.npcQuests.claimed[id]=true;Store.addXp?.(r.xp||0);const unlocked=Object.entries(WORLD_UNLOCKS).filter(([,u])=>u.quest===id).map(([key])=>unlockWorld(key));Store.saveNow();roadmap();
 const npc=NPCS.find(n=>n.id===q.npc);modal('📜 Квест выполнен',`<p><b>${q.icon} ${q.title}</b></p><p>${npc?.name||'Персонаж'} доверяет тебе ещё больше.</p><p>${npcRewardText(r)}</p>`);
}

const WORLD_UNLOCKS={
 bjorn_forge:{icon:'🔥',title:'Кузница Бьёрна',text:'Особое место в поселении. Здесь герой может получать редкие кузнечные события.',npc:'bjorn',quest:'bjorn_forge'},
 astrid_hunt:{icon:'🏹',title:'Охотничья тропа',text:'Скрытая тропа Астрид открывает особые встречи на пути.',npc:'astrid',quest:'astrid_hunt'},
 einar_ruins:{icon:'🗿',title:'Древние руины',text:'Эйнар доверяет тебе путь к рунам, которых нет на обычной карте.',npc:'einar',quest:'einar_oath'}
};
function worldUnlock(id){return Boolean(Store.state.worldUnlocks?.[id])}
function unlockWorld(id){
 const s=Store.state,u=WORLD_UNLOCKS[id];if(!u||worldUnlock(id))return false;
 s.worldUnlocks=s.worldUnlocks||{};s.worldUnlocks[id]={unlockedAt:Date.now(),source:u.quest};Store.saveNow();return true;
}

const WORLD_LOCATIONS={
 bjorn_forge:{unlock:'bjorn_forge',icon:'🔥',title:'Кузница Бьёрна',desc:'Тяжёлый молот гремит над наковальней. Здесь можно один раз за главу закалить найденный металл.',action:'Закалить металл',cost:{materials:5},reward:{coins:450,gems:2,xp:35},choices:[{id:'weapon',icon:'⚔️',title:'Закалить клинок',text:'Сосредоточиться на оружии и сделать удар тяжелее.',reward:{coins:520,gems:1,xp:45},relation:{npc:'bjorn',gain:12}},{id:'armor',icon:'🛡️',title:'Укрепить доспех',text:'Потратить жар на защиту и получить больше кузнечной награды.',reward:{coins:380,gems:3,materials:1,xp:40},relation:{npc:'bjorn',gain:8}}]},
 astrid_hunt:{unlock:'astrid_hunt',icon:'🏹',title:'Охотничья тропа',desc:'Следы уходят в лес. Астрид предлагает короткую охоту за редкой добычей.',action:'Отправиться на охоту',cost:{energy:10},reward:{coins:380,xp:30,loot:1},choices:[{id:'track',icon:'🐺',title:'Идти по следу',text:'Пойти глубже за редкой добычей.',reward:{coins:430,xp:38,loot:1},relation:{npc:'astrid',gain:12}},{id:'ambush',icon:'🌲',title:'Поставить засаду',text:'Остаться в тени и охотиться осторожнее.',reward:{coins:300,gems:1,xp:48,loot:1},relation:{npc:'astrid',gain:8}}]},
 einar_ruins:{unlock:'einar_ruins',icon:'🗿',title:'Древние руины',desc:'На камне проступают руны. Если расшифровать их, старый путь откроет свою награду.',action:'Расшифровать руны',cost:{energy:5},reward:{gems:5,xp:55,materials:4},choices:[{id:'read',icon:'📜',title:'Прочитать руны',text:'Раскрыть смысл древней надписи.',reward:{gems:7,materials:3,xp:65},relation:{npc:'einar',gain:12}},{id:'touch',icon:'✨',title:'Коснуться камня',text:'Довериться странному сиянию и принять его дар.',reward:{gems:4,materials:6,xp:50},relation:{npc:'einar',gain:8}}]}
};
function locationActionKey(ch,id){return `${ch}:${id}`}
function locationDone(ch,id){return Boolean(Store.state.worldLocationActions?.[locationActionKey(ch,id)])}
function locationCostText(c){return [c.materials?`🔩 ${c.materials}`:'',c.energy?`⚡ ${c.energy}`:''].filter(Boolean).join(' · ')}
function locationRewardText(r){return [r.coins?`🪙 +${r.coins}`:'',r.gems?`💎 +${r.gems}`:'',r.materials?`🔩 +${r.materials}`:'',r.xp?`✨ +${r.xp} XP`:'',r.loot?`🎁 +${r.loot} добыча`:'' ].filter(Boolean).join(' · ')}
function createLocationLoot(ch){
 const types=[['Охотничий клинок','🪓','weapon'],['Шкура северного волка','🛡️','armor'],['Амулет следопыта','🔮','amulet']];
 const [name,icon,type]=types[(ch-1)%types.length];const level=Math.max(1,Number(Store.state.level)||1);const power=6+Math.floor(ch/2);
 return {id:`loc_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,name,title:name,slot:type,icon,rarity:'rare',level,enhance:0,attack:type==='weapon'?power:0,defense:type==='armor'?power:0,agility:type==='amulet'?Math.max(1,Math.floor(power/2)):0,maxHp:type==='armor'?power*2:0,setId:'territory',setName:'Пути Territory',source:'world-location'};
}
const WORLD_SCENES={
 bjorn_forge:{art:'🔥',title:'Огонь кузницы',tone:'Огонь отражается в металле, а Бьёрн молча кладёт перед тобой раскалённую заготовку.',scenes:['Искры летят в темноту. Старый молот ждёт одного точного удара.','На наковальне появляется знак, похожий на символ твоего пути.','Бьёрн кивает: «Сегодня металл узнает руку своего хозяина».']},
 astrid_hunt:{art:'🏹',title:'След в снегу',tone:'Лес стихает. Астрид поднимает руку — впереди свежий след, и добыча совсем близко.',scenes:['Снег хранит отпечатки, которым не больше часа.','Из чащи доносится короткий хруст ветки. След ведёт глубже.','Астрид улыбается: «Тихо. Сейчас лес сам расскажет, куда идти».']},
 einar_ruins:{art:'🗿',title:'Шёпот древних рун',tone:'Камни покрыты инеем. Эйнар проводит пальцами по первой руне, и та начинает светиться.',scenes:['На стене проступают новые символы, которых не было мгновение назад.','Холодный ветер стихает, будто сами руины прислушиваются.','Эйнар шепчет: «Не спеши. Старые дороги открываются тем, кто умеет читать».']}
};
function worldSceneText(id,ch){const a=WORLD_SCENES[id];if(!a)return '';const n=Math.max(0,ch-1)%a.scenes.length;return a.scenes[n];}
function openWorldLocation(id){
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),loc=WORLD_LOCATIONS[id];if(!loc||!worldUnlock(loc.unlock)||locationDone(ch,id))return;
 const scene=WORLD_SCENES[id]||{};const c=loc.cost||{};
 const styleId='world-scene-style';if(!document.getElementById(styleId)){const st=document.createElement('style');st.id=styleId;st.textContent=`.world-scene{position:relative;overflow:hidden;margin:-4px -2px 2px;padding:18px 14px 14px;border-radius:18px;background:radial-gradient(circle at 50% 0%,rgba(190,150,74,.22),transparent 52%),linear-gradient(160deg,rgba(28,31,27,.98),rgba(8,10,10,.99));border:1px solid rgba(255,210,120,.2);box-shadow:inset 0 0 35px rgba(0,0,0,.32)}.world-scene:after{content:'';position:absolute;inset:auto -20% -55px;height:110px;background:radial-gradient(ellipse,rgba(255,190,70,.11),transparent 65%);pointer-events:none}.world-scene-art{font-size:54px;text-align:center;filter:drop-shadow(0 8px 12px rgba(0,0,0,.45));animation:worldScenePulse 2.8s ease-in-out infinite}.world-scene h3{text-align:center;margin:7px 0 3px;font-size:18px}.world-scene .scene-tone{text-align:center;font-size:11px;line-height:1.45;opacity:.72;margin:0 auto 10px;max-width:330px}.world-scene .scene-flavor{padding:10px 11px;border-radius:12px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);font-size:10px;line-height:1.5;text-align:center}.world-scene .scene-chapter{text-align:center;font-size:9px;letter-spacing:.08em;text-transform:uppercase;opacity:.48;margin-top:9px}.world-scene .scene-cost{text-align:center;margin:9px 0;font-size:10px;opacity:.72}.world-scene .scene-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.world-scene .scene-action,.world-scene .scene-look{display:block;width:100%;border:0;border-radius:11px;padding:11px;color:inherit;font-weight:900;box-shadow:0 6px 18px rgba(0,0,0,.22)}.world-scene .scene-action{background:linear-gradient(180deg,rgba(195,156,78,.32),rgba(120,90,35,.22))}.world-scene .scene-look{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}.world-scene .scene-choice-title{margin:12px 0 7px;font-size:10px;font-weight:900;opacity:.65;text-transform:uppercase;letter-spacing:.08em}.world-scene .scene-choices{display:grid;gap:7px}.world-scene .scene-choice{display:grid;grid-template-columns:28px 1fr;gap:2px 8px;text-align:left;border:1px solid rgba(255,210,120,.12);border-radius:11px;padding:9px;background:rgba(255,255,255,.045);color:inherit}.world-scene .scene-choice>span{grid-row:1/4;font-size:23px;text-align:center}.world-scene .scene-choice b{font-size:11px}.world-scene .scene-choice small{font-size:9px;opacity:.62;line-height:1.3}.world-scene .scene-choice em{font-size:9px;font-style:normal;opacity:.8;margin-top:2px}.world-scene .scene-choice:active{transform:translateY(1px);background:rgba(195,156,78,.12)}.world-scene .scene-action:active,.world-scene .scene-look:active{transform:translateY(1px)}@keyframes worldScenePulse{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-3px) scale(1.04)}}`;document.head.appendChild(st)}
 modal(`${scene.art||loc.icon} ${scene.title||loc.title}`,`<div class="world-scene"><div class="world-scene-art">${scene.art||loc.icon}</div><h3>${scene.title||loc.title}</h3><p class="scene-tone">${scene.tone||loc.desc}</p><div class="scene-flavor" id="worldSceneFlavor">${worldSceneText(id,ch)||loc.desc}</div><div class="scene-chapter">Глава ${ch} · Особое место</div><div class="scene-cost">Цена входа: ${locationCostText(c)}</div><div class="scene-actions"><button class="scene-look" id="worldSceneLook">🔎 Осмотреть</button></div><div class="scene-choice-title">Сделай выбор</div><div class="scene-choices" id="worldSceneChoices">${(loc.choices||[]).map(ch=>`<button class="scene-choice" data-world-choice="${ch.id}"><span>${ch.icon}</span><b>${ch.title}</b><small>${ch.text}</small><em>${locationRewardText(ch.reward)}</em></button>`).join('')}</div></div>`);
 const b=$('#worldSceneAction');if(b)b.onclick=()=>{performWorldLocation(id)};
 const choiceWrap=$('#worldSceneChoices');
 if(choiceWrap){choiceWrap.querySelectorAll('[data-world-choice]').forEach(btn=>btn.onclick=()=>performWorldLocation(id,btn.dataset.worldChoice));}
 const look=$('#worldSceneLook');if(look)look.onclick=()=>{const a=scene.scenes||[];const flavor=$('#worldSceneFlavor');if(!flavor||!a.length)return;const current=flavor.textContent.trim();const idx=Math.max(0,a.indexOf(current));flavor.textContent=a[(idx+1)%a.length];look.textContent='🔎 Ещё раз';};
}
function performWorldLocation(id,choiceId){
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),loc=WORLD_LOCATIONS[id];if(!loc||!worldUnlock(loc.unlock))return;
 const key=locationActionKey(ch,id);if(s.worldLocationActions?.[key])return;
 const c=loc.cost||{};if(c.materials&&Number(s.forge?.materials||0)<c.materials){modal('🔥 Недостаточно материалов',`<p>Нужно 🔩 ${c.materials} материалов.</p>`);return}
 if(c.energy&&Number(s.energy||0)<c.energy){modal('⚡ Недостаточно энергии',`<p>Нужно ⚡ ${c.energy} энергии.</p>`);return}
 s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials=Math.max(0,Number(s.forge.materials||0)-Number(c.materials||0));s.energy=Math.max(0,Number(s.energy||0)-Number(c.energy||0));
 const choice=(loc.choices||[]).find(x=>x.id===choiceId)||loc.choices?.[0];const r=choice?.reward||loc.reward||{};s.coins=(Number(s.coins)||0)+(r.coins||0);s.gems=(Number(s.gems)||0)+(r.gems||0);s.forge.materials+=r.materials||0;s.worldLocationActions=s.worldLocationActions||{};s.worldLocationRewards=s.worldLocationRewards||{};let lootName='';
 if(r.loot){const item=createLocationLoot(ch);s.inventoryItems=Array.isArray(s.inventoryItems)?s.inventoryItems:[];s.inventoryItems.unshift(item);s.inventoryItems=s.inventoryItems.slice(0,100);s.lootFound=Math.max(0,Number(s.lootFound)||0)+1;Store.trackProgress?.('loot');lootName=`<br>🎁 ${item.name}`;}
 s.worldLocationActions[key]={at:Date.now(),choice:choice?.id||null};s.worldLocationRewards[key]={coins:r.coins||0,gems:r.gems||0,materials:r.materials||0,xp:r.xp||0,loot:r.loot||0};
 const rel=choice?.relation;if(rel?.npc){s.npcRelations=s.npcRelations||{};const before=Number(s.npcRelations[rel.npc])||0;s.npcRelations[rel.npc]=Math.min(100,before+(Number(rel.gain)||0));}
 s.worldMemories=s.worldMemories||{};s.worldMemories[key]={at:Date.now(),chapter:ch,location:id,choice:choice?.id||null,icon:choice?.icon||loc.icon,title:`${loc.title}: ${choice?.title||loc.action}`,text:choice?.text||loc.desc};
 Store.addXp?.(r.xp||0);Store.saveNow();roadmap();modal(`${loc.icon} ${loc.title}`,`<p>${choice?.icon||loc.icon} <b>${choice?.title||loc.action}</b> завершено.</p><p><b>Награда:</b> ${locationRewardText(r)}${lootName}</p><p>Эта возможность доступна снова в следующей главе.</p>`)
}

const WORLD_ECHOES=[
 {id:'bjorn_blade_echo',npc:'bjorn',icon:'⚔️',title:'След закалённого клинка',need:{location:'bjorn_forge',choices:['blade','weapon']},text:'Бьорн заметил, как ты поступил в кузнице раньше. Он приготовил для тебя особую работу.',choice:{title:'Принять работу кузнеца',text:'Помочь закончить редкий клинок.',reward:{coins:700,materials:6,xp:65},relation:15}},
 {id:'bjorn_armor_echo',npc:'bjorn',icon:'🛡️',title:'Доспех, который помнит',need:{location:'bjorn_forge',choices:['armor','guard']},text:'Укреплённый тобой доспех стал поводом для нового поручения.',choice:{title:'Закрепить пластины',text:'Помочь Бьёрну довести защиту до совершенства.',reward:{coins:520,gems:2,materials:8,xp:55},relation:12}},
 {id:'astrid_track_echo',npc:'astrid',icon:'🐺',title:'Старый след',need:{location:'astrid_hunt',choices:['track']},text:'Астрид узнаёт твой следопытский почерк. Она показывает тайный маршрут.',choice:{title:'Пойти тайным маршрутом',text:'След ведёт к спрятанной добыче.',reward:{coins:650,gems:2,xp:70,loot:1},relation:15}},
 {id:'astrid_ambush_echo',npc:'astrid',icon:'🌲',title:'Тихая засада',need:{location:'astrid_hunt',choices:['ambush']},text:'Твоя осторожность не забыта. Астрид предлагает испытать новый способ охоты.',choice:{title:'Повторить приём',text:'Проверить засаду на новой тропе.',reward:{coins:480,xp:78,loot:1},relation:12}},
 {id:'einar_rune_echo',npc:'einar',icon:'📜',title:'Руна отвечает',need:{location:'einar_ruins',choices:['runes','read']},text:'Эйнар заметил, что после прошлого выбора одна из рун изменилась.',choice:{title:'Прочитать вторую строку',text:'Открыть фрагмент древнего пути.',reward:{gems:5,materials:6,xp:85},relation:15}},
 {id:'einar_stone_echo',npc:'einar',icon:'✨',title:'Камень предков',need:{location:'einar_ruins',choices:['stone','touch']},text:'Камень снова отзывается на твоё прикосновение. Эйнар просит не отступать.',choice:{title:'Коснуться камня снова',text:'Принять испытание древнего знака.',reward:{gems:7,xp:95,materials:3},relation:12}}
];
function worldEchoSource(e,s,ch){
 const memories=Object.values(s.worldMemories||{});
 return memories.some(m=>m.chapter<ch&&m.location===e.need.location&&e.need.choices.includes(m.choice));
}
function worldEchoDone(ch,id){return Boolean(Store.state.worldEchoes?.[`${ch}:${id}`])}
function claimWorldEcho(ch,id){
 const s=Store.state,e=WORLD_ECHOES.find(x=>x.id===id);if(!e||worldEchoDone(ch,id)||!worldEchoSource(e,s,ch))return;
 const r=e.choice.reward||{};s.worldEchoes=s.worldEchoes||{};s.worldEchoes[`${ch}:${id}`]={at:Date.now(),source:e.need.location};
 s.coins=(Number(s.coins)||0)+(r.coins||0);s.gems=(Number(s.gems)||0)+(r.gems||0);s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials+=r.materials||0;
 if(r.loot){const item=createLocationLoot(ch);s.inventoryItems=Array.isArray(s.inventoryItems)?s.inventoryItems:[];s.inventoryItems.unshift(item);s.inventoryItems=s.inventoryItems.slice(0,100);s.lootFound=Math.max(0,Number(s.lootFound)||0)+1;Store.trackProgress?.('loot');}
 if(e.npc){s.npcRelations=s.npcRelations||{};s.npcRelations[e.npc]=Math.min(100,(Number(s.npcRelations[e.npc])||0)+(Number(e.choice.relation)||0));}
 Store.addXp?.(r.xp||0);Store.saveNow();roadmap();modal(`${e.icon} ${e.title}`,`<p>${e.text}</p><p><b>${e.choice.title}</b></p><p>${e.choice.text}</p><p><b>Награда:</b> ${locationRewardText(r)}</p><p>🧠 Этот след добавлен в память мира.</p>`);
}
function renderWorldEchoes(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.world-echoes-panel');
 if(!panel){panel=document.createElement('section');panel.className='world-echoes-panel';host.appendChild(panel);const style=document.createElement('style');style.textContent=`.world-echoes-panel{margin:14px 0;padding:14px;border-radius:16px;background:linear-gradient(180deg,rgba(27,23,32,.98),rgba(10,9,14,.98));border:1px solid rgba(172,125,210,.3);box-shadow:0 10px 28px rgba(0,0,0,.25)}.world-echoes-panel h3{margin:0 0 4px}.world-echoes-sub{font-size:10px;opacity:.62;margin-bottom:11px}.world-echo-list{display:grid;gap:8px}.world-echo{display:grid;grid-template-columns:32px 1fr auto;gap:8px;align-items:center;padding:9px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.world-echo.done{opacity:.55}.world-echo .we-icon{font-size:23px;text-align:center}.world-echo b{font-size:10px}.world-echo p{margin:2px 0;font-size:8px;opacity:.62}.world-echo small{font-size:8px;opacity:.65}.world-echo button{border:0;border-radius:8px;padding:7px 9px;background:rgba(172,125,210,.17);color:inherit;font-weight:900;font-size:9px}.world-echo button:disabled{opacity:.4}@media(max-width:520px){.world-echo{grid-template-columns:28px 1fr}.world-echo button{grid-column:2;justify-self:start}}`;document.head.appendChild(style)}
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1);const available=WORLD_ECHOES.filter(e=>worldEchoSource(e,s,ch));
 panel.innerHTML=`<h3>🔮 Отголоски прошлого</h3><div class="world-echoes-sub">Некоторые решения возвращаются в следующих главах.</div>${available.length?`<div class="world-echo-list">${available.map(e=>{const done=worldEchoDone(ch,e.id);return `<article class="world-echo ${done?'done':''}"><div class="we-icon">${e.icon}</div><div><b>${e.title}</b><p>${e.text}</p><small>${done?'✓ Уже выполнено в этой главе':locationRewardText(e.choice.reward)}</small></div><button data-world-echo="${e.id}" ${done?'disabled':''}>${done?'✓ Завершено':'Открыть'}</button></article>`}).join('')}</div>`:`<div class="world-echoes-sub">Пока ничего не открылось. Следующие главы покажут, какие решения остались с тобой.</div>`}`;
 panel.querySelectorAll('[data-world-echo]').forEach(b=>b.onclick=()=>claimWorldEcho(ch,b.dataset.worldEcho));
}


const HERO_BADGES=[
 {id:'forge_master',icon:'⚒️',title:'Закалённый мастер',text:'Ты выбирал путь стали в кузнице Бьёрна.',match:m=>m.location==='bjorn_forge'&&['blade','weapon'].includes(m.choice)},
 {id:'iron_guard',icon:'🛡️',title:'Щит Севера',text:'Ты выбирал путь защиты и укрепления.',match:m=>m.location==='bjorn_forge'&&['armor','guard'].includes(m.choice)},
 {id:'wolf_tracker',icon:'🐺',title:'Следопыт Севера',text:'Ты доверял следу и шёл за ним.',match:m=>m.location==='astrid_hunt'&&['track'].includes(m.choice)},
 {id:'silent_hunter',icon:'🌲',title:'Тихий охотник',text:'Ты выбирал терпение и засаду.',match:m=>m.location==='astrid_hunt'&&['ambush'].includes(m.choice)},
 {id:'rune_reader',icon:'📜',title:'Читающий руны',text:'Ты искал смысл в древних знаках.',match:m=>m.location==='einar_ruins'&&['runes','read'].includes(m.choice)},
 {id:'stone_bearer',icon:'✨',title:'Избранный камнем',text:'Ты принял зов древнего камня.',match:m=>m.location==='einar_ruins'&&['stone','touch'].includes(m.choice)}
];
function heroBadges(){
 const memories=Object.values(Store.state.worldMemories||{});
 return HERO_BADGES.filter(b=>memories.some(b.match));
}
function renderHeroChronicle(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.hero-chronicle-panel');
 if(!panel){panel=document.createElement('section');panel.className='hero-chronicle-panel';const style=document.createElement('style');style.textContent=`.hero-chronicle-panel{margin:14px 0;padding:14px;border-radius:16px;background:linear-gradient(180deg,rgba(25,27,34,.98),rgba(9,10,14,.99));border:1px solid rgba(145,165,210,.28);box-shadow:0 10px 28px rgba(0,0,0,.24)}.hero-chronicle-panel h3{margin:0 0 4px}.hero-chronicle-sub{font-size:10px;opacity:.62;margin-bottom:11px}.hero-badges{display:flex;gap:7px;overflow:auto;padding:2px 0 10px}.hero-badge{min-width:105px;padding:9px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.hero-badge span{font-size:22px}.hero-badge b{display:block;font-size:9px;margin-top:4px}.hero-badge small{display:block;font-size:7px;opacity:.55;margin-top:2px}.hero-timeline{display:grid;gap:7px}.hero-entry{position:relative;padding:9px 10px 9px 34px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.055)}.hero-entry:before{content:'';position:absolute;left:14px;top:14px;width:8px;height:8px;border-radius:50%;background:rgba(145,165,210,.8);box-shadow:0 0 0 4px rgba(145,165,210,.08)}.hero-entry b{font-size:10px}.hero-entry small{display:block;font-size:8px;opacity:.55;margin-top:2px}.hero-entry p{margin:4px 0 0;font-size:9px;opacity:.7}.hero-entry.echo{border-color:rgba(172,125,210,.16)}.hero-entry.echo:before{background:rgba(172,125,210,.85)}`;document.head.appendChild(style)}
 const s=Store.state;const memories=Object.values(s.worldMemories||{}).map(x=>({...x,type:'memory'}));const echoes=Object.entries(s.worldEchoes||{}).map(([key,x])=>({...x,type:'echo',chapter:Number(key.split(':')[0])||1,id:key}));const entries=[...memories,...echoes].sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,10);const badges=heroBadges();
 panel.innerHTML=`<h3>📖 Хроника героя</h3><div class="hero-chronicle-sub">Твои поступки становятся частью истории Territory.</div>${badges.length?`<div class="hero-badges">${badges.map(b=>`<div class="hero-badge"><span>${b.icon}</span><b>${b.title}</b><small>${b.text}</small></div>`).join('')}</div>`:''}${entries.length?`<div class="hero-timeline">${entries.map(e=>`<article class="hero-entry ${e.type==='echo'?'echo':''}"><b>${e.type==='echo'?'🔮 '+(WORLD_ECHOES.find(x=>x.id===e.id)?.title||'Отголосок'):(e.title||'Решение')}</b><small>Глава ${e.chapter||1}</small><p>${e.type==='echo'?'След прошлого вернулся и был принят героем.':(e.text||'')}</p></article>`).join('')}</div>`:`<div class="hero-chronicle-sub">Первая глава ещё не оставила следов. История начнётся с твоего первого решения.</div>`}`;
}

function renderWorldMemories(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.world-memory-panel');
 if(!panel){panel=document.createElement('section');panel.className='world-memory-panel';const style=document.createElement('style');style.textContent=`.world-memory-panel{margin:14px 0;padding:14px;border-radius:16px;background:linear-gradient(180deg,rgba(35,27,18,.98),rgba(11,10,9,.98));border:1px solid rgba(216,177,96,.24);box-shadow:0 10px 28px rgba(0,0,0,.22)}.world-memory-panel h3{margin:0 0 4px}.world-memory-sub{font-size:10px;opacity:.6;margin-bottom:10px}.world-memory-list{display:grid;gap:6px}.world-memory{display:grid;grid-template-columns:30px 1fr;gap:8px;align-items:center;padding:8px;border-radius:10px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}.world-memory span{font-size:22px;text-align:center}.world-memory b{font-size:10px}.world-memory small{display:block;font-size:8px;opacity:.58;margin-top:2px}`;document.head.appendChild(style)}
 const s=Store.state;const entries=Object.values(s.worldMemories||{}).sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,6);
 panel.innerHTML=`<h3>🧠 Память мира</h3><div class="world-memory-sub">Мир запоминает решения героя — и люди тоже.</div>${entries.length?`<div class="world-memory-list">${entries.map(m=>`<article class="world-memory"><span>${m.icon||'📖'}</span><div><b>${m.title||'Воспоминание'}</b><small>${m.text||''} · Глава ${m.chapter||1}</small></div></article>`).join('')}</div>`:`<div class="world-memory-sub">Пока здесь пусто. Первое решение оставит след.</div>`}`;
}
function renderWorldLocations(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.world-locations-panel');if(!panel){panel=document.createElement('section');panel.className='world-locations-panel';const style=document.createElement('style');style.textContent=`.world-locations-panel{margin:14px 0;padding:14px;border-radius:16px;background:linear-gradient(180deg,rgba(24,31,29,.98),rgba(8,12,11,.98));border:1px solid rgba(123,190,133,.28);box-shadow:0 10px 28px rgba(0,0,0,.24)}.world-locations-panel h3{margin:0 0 4px}.world-locations-sub{font-size:10px;opacity:.62;margin-bottom:11px}.world-location-list{display:grid;gap:8px}.world-location{padding:10px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.world-location.done{opacity:.6;border-color:rgba(123,190,133,.3)}.wl-head{display:flex;gap:8px;align-items:center}.wl-head span{font-size:25px}.wl-head b{font-size:12px}.wl-text{margin:5px 0 8px;font-size:9px;opacity:.68}.wl-foot{display:flex;justify-content:space-between;align-items:center;gap:8px}.wl-foot small{font-size:9px;opacity:.7}.wl-foot button{border:0;border-radius:8px;padding:7px 10px;background:rgba(123,190,133,.16);color:inherit;font-weight:800;font-size:9px}.wl-foot button:disabled{opacity:.45}`;document.head.appendChild(style)}
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1);panel.innerHTML=`<h3>✨ Особые места</h3><div class="world-locations-sub">Открытые места дают уникальное действие один раз за главу.</div><div class="world-location-list">${Object.entries(WORLD_LOCATIONS).map(([id,l])=>{const open=worldUnlock(l.unlock),done=locationDone(ch,id),c=l.cost||{};return `<article class="world-location ${done?'done':''}"><div class="wl-head"><span>${open?l.icon:'🔒'}</span><b>${open?l.title:'Место закрыто'}</b></div><div class="wl-text">${open?l.desc:'Сначала выполни связанный квест персонажа.'}</div><div class="wl-foot"><small>${open?(done?'✓ Использовано в этой главе':`Цена: ${locationCostText(c)} · Награда: ${locationRewardText(l.reward)}`):'🔒 Требуется открыть место'}</small><button data-world-location="${id}" ${!open||done?'disabled':''}>${done?'✓ Использовано':l.action}</button></div></article>`}).join('')}</div>`;
 panel.querySelectorAll('[data-world-location]').forEach(b=>b.onclick=()=>openWorldLocation(b.dataset.worldLocation));
}

function renderWorldUnlocks(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.world-unlocks-panel');
 if(!panel){panel=document.createElement('section');panel.className='world-unlocks-panel';const style=document.createElement('style');style.textContent=`.world-unlocks-panel{margin:14px 0;padding:14px;border-radius:16px;background:linear-gradient(180deg,rgba(28,31,27,.98),rgba(9,12,10,.98));border:1px solid rgba(122,177,112,.28);box-shadow:0 10px 28px rgba(0,0,0,.22)}.world-unlocks-panel h3{margin:0 0 4px}.world-unlocks-sub{font-size:10px;opacity:.62;margin-bottom:11px}.world-unlocks-list{display:grid;gap:7px}.world-unlock{display:grid;grid-template-columns:34px 1fr auto;gap:8px;align-items:center;padding:9px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.world-unlock.open{border-color:rgba(122,177,112,.35)}.world-unlock .wu-icon{font-size:23px;text-align:center}.world-unlock b{font-size:11px}.world-unlock p{margin:2px 0 0;font-size:9px;opacity:.62}.world-unlock small{font-size:9px;opacity:.68}@media(max-width:520px){.world-unlock{grid-template-columns:30px 1fr}.world-unlock small{grid-column:2}}`;document.head.appendChild(style)}
 const s=Store.state;panel.innerHTML=`<h3>🗺️ Открытые места</h3><div class="world-unlocks-sub">Поступки героя постепенно меняют карту мира.</div><div class="world-unlocks-list">${Object.entries(WORLD_UNLOCKS).map(([id,u])=>{const open=worldUnlock(id);return `<article class="world-unlock ${open?'open':''}"><div class="wu-icon">${open?u.icon:'🔒'}</div><div><b>${open?u.title:'Скрытое место'}</b><p>${open?u.text:'Выполни личный квест персонажа, чтобы открыть это место.'}</p></div><small>${open?'✓ Открыто':'🔒 '+(NPCS.find(n=>n.id===u.npc)?.name||'Персонаж')}</small></article>`}).join('')}</div>`;
}

function renderNPCQuests(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.npc-quests-panel');
 if(!panel){panel=document.createElement('section');panel.className='npc-quests-panel';host.appendChild(panel);const style=document.createElement('style');style.textContent=`.npc-quests-panel{margin:14px 0;padding:14px;border-radius:16px;background:linear-gradient(180deg,rgba(21,28,33,.98),rgba(9,12,15,.98));border:1px solid rgba(102,174,194,.25);box-shadow:0 10px 28px rgba(0,0,0,.22)}.npc-quests-panel h3{margin:0 0 4px}.npcq-sub{font-size:10px;opacity:.62;margin-bottom:10px}.npcq-list{display:grid;gap:8px}.npcq-card{display:grid;grid-template-columns:34px 1fr auto;gap:8px;align-items:center;padding:10px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.npcq-card.locked{opacity:.48}.npcq-card.done{border-color:rgba(102,174,194,.38)}.npcq-icon{font-size:24px;text-align:center}.npcq-card b{font-size:11px}.npcq-card p{margin:2px 0;font-size:9px;opacity:.64}.npcq-card small{font-size:9px;opacity:.72}.npcq-card button{border:0;border-radius:8px;padding:7px 9px;background:rgba(102,174,194,.16);color:inherit;font-weight:800;font-size:9px}.npcq-card button:disabled{opacity:.42;background:rgba(255,255,255,.05)}@media(max-width:520px){.npcq-card{grid-template-columns:30px 1fr}.npcq-card button{grid-column:2;justify-self:start}}`;document.head.appendChild(style)}
 const s=Store.state;
 panel.innerHTML=`<h3>📜 Квесты персонажей</h3><div class="npcq-sub">Доверие открывает личные поручения. Выполненные квесты дают награды один раз.</div><div class="npcq-list">${NPC_QUESTS.map(q=>{const p=npcQuestProgress(q,s),npc=NPCS.find(n=>n.id===q.npc);return `<article class="npcq-card ${p.unlocked?'':'locked'} ${p.done?'done':''}"><div class="npcq-icon">${q.icon}</div><div><b>${q.title}</b><p>${npc?.name||'Персонаж'} · ${p.unlocked?q.text:'🔒 Нужен уровень доверия '+q.tier}</p><small>${p.unlocked?`${p.cur}/${q.need} · ${p.claimed?'✓ Получено':npcRewardText(q.reward)}`:'Повышай отношения с персонажем'}</small></div><button data-npc-quest="${q.id}" ${!p.done||p.claimed?'disabled':''}>${p.claimed?'✓ Получено':p.done?'🎁 Забрать':'Продолжить'}</button></article>`}).join('')}</div>`;
 panel.querySelectorAll('[data-npc-quest]').forEach(b=>b.onclick=()=>claimNpcQuest(b.dataset.npcQuest));
}


const TERRITORY_FINALE={
 title:'Последний рубеж',
 paths:{
  unite:{icon:'🤝',title:'Клятва трёх',text:'Бьёрн, Астрид и Эйнар встают рядом. Не один герой ведёт Territory вперёд — они впервые действуют как единое целое.',reward:{coins:4200,gems:30,materials:25,xp:420}},
  forge:{icon:'🔥',title:'Сердце стали',text:'Старый горн вспыхивает в последний раз. Сила Бьёрна становится символом защиты всего поселения.',reward:{coins:5000,gems:24,materials:35,xp:400}},
  rune:{icon:'🗿',title:'Дорога за камнем',text:'Древние руны открывают путь за пределы известной земли. Эйнар читает знак, а Астрид первой видит дорогу.',reward:{coins:3600,gems:42,materials:18,xp:460}}
 }
};
function finaleReady(){
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),c=s.worldConvergence||{};
 if(!c.claimed||!c.path||s.worldFinale?.claimed)return false;
 if(ch<=Number(c.chapter||0))return false;
 const branch=Object.entries(s.worldBranchEvents||{}).some(([k,v])=>v&&v.path===c.path&&Number(v.chapter)>Number(c.chapter||0));
 const frontier=Object.entries(s.worldPathFrontiers||{}).some(([k,v])=>v&&v.path===c.path&&Number(v.chapter)>Number(c.chapter||0));
 const after=Object.entries(s.worldFrontierAftermath||{}).some(([k,v])=>v&&Number(v.chapter)>=ch);
 return branch&&frontier&&after;
}
function finaleEndingKey(s){
 const path=s.worldConvergence?.path||'unite';
 const entries=Object.values(s.worldPathFrontiers||{}).filter(v=>v&&v.path===path).sort((a,b)=>(Number(b.chapter)||0)-(Number(a.chapter)||0));
 const frontier=entries[0]?.choice||'';
 if(path==='unite')return frontier==='trust'?'unite_trust':'unite_courage';
 if(path==='forge')return frontier==='shield'?'forge_guardian':'forge_flame';
 return frontier==='cross'?'rune_crossing':'rune_keeper';
}
const TERRITORY_FINALE_ENDINGS={
 unite_trust:{icon:'🤝',title:'Союз, которому доверяют',text:'Герои выбирают не самого сильного, а самого надёжного. Territory получает новый совет, где каждый голос имеет значение.',reward:{coins:1800,gems:12,xp:180}},
 unite_courage:{icon:'🕯️',title:'Союз в дороге',text:'Трое отправляются вместе. Их сила не в одинаковых взглядах, а в том, что никто не остаётся один.',reward:{coins:2200,gems:8,xp:190}},
 forge_guardian:{icon:'🛡️',title:'Хранитель огня',text:'Последний удар молота создаёт щит, который становится символом новой эпохи защиты Territory.',reward:{coins:2400,gems:10,materials:8,xp:210}},
 forge_flame:{icon:'⚔️',title:'Клинок рассвета',text:'Сталь выходит из горна раскалённой. Бьёрн передаёт клинок герою — не как оружие завоевателя, а как обещание защищать.',reward:{coins:2800,gems:8,materials:6,xp:220}},
 rune_crossing:{icon:'🌌',title:'За гранью камня',text:'Руны открывают дорогу. Астрид идёт первой, Эйнар читает знаки, а Territory получает горизонт, которого ещё нет на карте.',reward:{coins:1900,gems:18,xp:240}},
 rune_keeper:{icon:'🗿',title:'Новый хранитель',text:'Герой принимает знание древнего пути. Эйнар впервые понимает: тайна не исчезнет — теперь её будут хранить вместе.',reward:{coins:1700,gems:22,materials:5,xp:250}}
};
function openTerritoryFinale(){
 const s=Store.state,ch=Math.max(1,Number(s.currentChapter)||1),path=s.worldConvergence?.path;
 if(s.worldFinale?.claimed){const e=TERRITORY_FINALE_ENDINGS[s.worldFinale.ending];modal('🏆 Финал Territory',`<div class="finale-scene"><div class="finale-art">${e?.icon||'🌍'}</div><h3>${e?.title||'История завершена'}</h3><p>Эта глава уже записана в хронике героя.</p></div>`);return;}
 if(!finaleReady()){modal('🌌 Последний рубеж',`<p>Финал ещё не открыт.</p><p>Нужно пройти общую историю, её последствие, новую границу и её отголосок в следующей главе.</p>`);return;}
 const ending=finaleEndingKey(s),e=TERRITORY_FINALE_ENDINGS[ending],base=TERRITORY_FINALE.paths[path]||TERRITORY_FINALE.paths.unite;
 modal('🌌 Последний рубеж',`<div class="finale-scene"><div class="finale-art">${base.icon} ${e.icon}</div><div class="finale-mark">ФИНАЛ · ТЕРРИТОРИЯ</div><h3>${e.title}</h3><p>${e.text}</p><div class="finale-reward">Награда: ${npcRewardText(e.reward)}</div><button data-claim-territory-finale>🏆 Завершить большую историю</button></div>`);
 const b=document.querySelector('[data-claim-territory-finale]');if(b)b.onclick=()=>{
   const r=e.reward||{};s.worldFinale={claimed:true,chapter:ch,path,ending,at:Date.now()};s.coins=(Number(s.coins)||0)+(r.coins||0);s.gems=(Number(s.gems)||0)+(r.gems||0);s.forge=s.forge||{materials:0,selectedId:null,successes:0};s.forge.materials+=(r.materials||0);Store.addXp?.(r.xp||0);Store.saveNow();roadmap();modal('🏆 История Territory завершена',`<div class="finale-scene"><div class="finale-art">${e.icon}</div><h3>${e.title}</h3><p>${e.text}</p><p style="opacity:.65">Твой путь, решения и отношения навсегда записаны в хронике героя.</p><div class="finale-reward">${npcRewardText(e.reward)}</div></div>`);
 };
}
function renderTerritoryFinale(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.finale-panel');
 if(!panel){panel=document.createElement('section');panel.className='finale-panel';const st=document.createElement('style');st.textContent=`.finale-panel{margin:18px 0;padding:16px;border-radius:20px;background:radial-gradient(circle at 50% 0,rgba(202,159,72,.24),rgba(18,14,10,.99) 58%);border:1px solid rgba(235,197,111,.4);box-shadow:0 16px 42px rgba(0,0,0,.34)}.finale-panel h3{margin:0 0 4px;font-size:16px}.finale-sub{font-size:10px;opacity:.64;margin-bottom:11px}.finale-card{padding:12px;border-radius:14px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08)}.finale-card.ready{border-color:rgba(235,197,111,.55);box-shadow:inset 0 0 28px rgba(235,197,111,.06)}.finale-card.done{opacity:.72}.finale-icons{text-align:center;font-size:32px;letter-spacing:5px;margin-bottom:7px}.finale-card p{font-size:10px;line-height:1.45;opacity:.7}.finale-card button{width:100%;border:0;border-radius:10px;padding:10px;background:linear-gradient(180deg,rgba(235,197,111,.25),rgba(145,102,32,.2));color:inherit;font-weight:900}.finale-scene{text-align:center}.finale-art{font-size:58px;letter-spacing:4px;filter:drop-shadow(0 10px 18px rgba(0,0,0,.5));animation:finaleFloat 3s ease-in-out infinite}.finale-mark{font-size:8px;letter-spacing:1.8px;opacity:.45;margin-top:4px}.finale-scene h3{font-size:17px;margin:9px 0}.finale-scene p{font-size:11px;line-height:1.55}.finale-reward{margin:11px 0;padding:10px;border-radius:10px;background:rgba(235,197,111,.11);font-size:10px}.finale-scene button{width:100%;border:0;border-radius:10px;padding:11px;background:rgba(235,197,111,.22);color:inherit;font-weight:900}@keyframes finaleFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-5px) scale(1.03)}}`;document.head.appendChild(st)}
 const s=Store.state,ready=finaleReady(),done=Boolean(s.worldFinale?.claimed),path=s.worldConvergence?.path,ending=done?TERRITORY_FINALE_ENDINGS[s.worldFinale.ending]:null;
 panel.innerHTML=`<h3>🏆 Финал Territory</h3><div class="finale-sub">Большая история собирает вместе все решения героя.</div><div class="finale-card ${done?'done':ready?'ready':''}"><div class="finale-icons">⚒️ 🏹 🗿</div><b>${done?(ending?.title||'История завершена'):ready?'Последний рубеж открыт':'Финальная глава ещё впереди'}</b><p>${done?'Твой финал записан в хронике.':ready?'Все последствия общего пути сошлись. Теперь Territory готова показать, к чему привели решения героя.':`Выбранный путь: ${TERRITORY_CONVERGENCE.paths[path]?.title||'не выбран'}. Продолжай историю, чтобы открыть финал.`}</p><button data-open-finale ${!ready||done?'disabled':''}>${done?'✓ Финал пройден':ready?'🏆 Открыть финал':'🔒 Закрыто'}</button></div>`;
 const b=panel.querySelector('[data-open-finale]');if(b)b.onclick=openTerritoryFinale;
}

function getEconomyFlowProfile(){
 const daily=DAILY_MISSIONS.reduce((a,m)=>{const r=m.reward||{};a.coins+=Number(r.coins)||0;a.gems+=Number(r.gems)||0;a.materials+=Number(r.materials)||0;a.xp+=Number(r.xp)||0;return a},{coins:0,gems:0,materials:0,xp:0});
 const weekly=WEEKLY_MISSIONS.reduce((a,m)=>{const r=m.reward||{};a.coins+=Number(r.coins)||0;a.gems+=Number(r.gems)||0;a.materials+=Number(r.materials)||0;a.xp+=Number(r.xp)||0;return a},{coins:0,gems:0,materials:0,xp:0});
 return {daily,weekly,weeklyPerDay:{coins:Math.floor(weekly.coins/7),gems:Math.round(weekly.gems/7),materials:Math.round(weekly.materials/7),xp:Math.round(weekly.xp/7)},totalWeekly:{coins:daily.coins*7+weekly.coins,gems:daily.gems*7+weekly.gems,materials:daily.materials*7+weekly.materials,xp:daily.xp*7+weekly.xp}};
}
function renderEconomyFlow(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.economy-flow-panel');
 if(!panel){panel=document.createElement('section');panel.className='economy-flow-panel';const st=document.createElement('style');st.textContent=`.economy-flow-panel{margin:14px 0;padding:14px;border-radius:18px;background:linear-gradient(180deg,rgba(24,25,20,.99),rgba(10,11,9,.99));border:1px solid rgba(210,184,104,.24);box-shadow:0 10px 28px rgba(0,0,0,.22)}.economy-flow-panel h3{margin:0 0 4px;font-size:14px}.economy-flow-sub{font-size:10px;opacity:.62;line-height:1.4;margin-bottom:11px}.economy-flow-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.economy-flow-card{padding:9px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.economy-flow-card b{display:block;font-size:10px}.economy-flow-card span{display:block;margin-top:3px;font-size:9px;opacity:.7;line-height:1.35}.economy-flow-note{margin-top:9px;padding:8px 9px;border-radius:10px;background:rgba(220,184,104,.06);font-size:9px;opacity:.72;line-height:1.45}@media(max-width:420px){.economy-flow-grid{grid-template-columns:1fr}}`;document.head.appendChild(st)}
 const f=getEconomyFlowProfile();const card=(icon,title,text)=>`<div class="economy-flow-card"><b>${icon} ${title}</b><span>${text}</span></div>`;
 panel.innerHTML=`<h3>📊 Поток экономики</h3><div class="economy-flow-sub">Это ориентир по гарантированным наградам ежедневных и недельных заданий, если игрок выполняет их полностью. Это не обещание фактического дохода за день.</div><div class="economy-flow-grid">${card('🪙','Монеты',`в неделю: +${f.totalWeekly.coins.toLocaleString('ru-RU')} · в среднем +${(f.totalWeekly.coins/7).toFixed(0)}/день`)}${card('💎','Премиум',`в неделю: +${f.totalWeekly.gems} · в среднем +${(f.totalWeekly.gems/7).toFixed(1)}/день`)}${card('🔩','Материалы',`в неделю: +${f.totalWeekly.materials} · в среднем +${(f.totalWeekly.materials/7).toFixed(1)}/день`)}${card('✨','XP из заданий',`в неделю: +${f.totalWeekly.xp} · основная прокачка всё равно идёт через игру`)}</div><div class="economy-flow-note">⚖️ Принцип баланса: бесплатный игрок должен стабильно двигаться вперёд; донат может сокращать время ожидания или давать удобство, но не должен превращать основную прогрессию в обязательную покупку.</div>`;
}

function getEconomyBalanceModel(){
 const s=Store.state||{};
 const flow=getEconomyFlowProfile();
 const dailyCoins=Math.max(0,flow.daily.coins+flow.weekly.coins/7);
 const dailyMats=Math.max(0,flow.daily.materials+flow.weekly.materials/7);
 const dailyGems=Math.max(0,flow.daily.gems+flow.weekly.gems/7);
 const lv=Math.max(1,Number(s.level)||1);
 const sample=(level)=>{
   const rank=3; // rare item: useful middle-of-the-road reference point
   const coin=Math.floor(35*level*(1+rank*.35));
   const mat=Math.max(1,Math.ceil(level/2));
   return {level,coin,mat};
 };
 return {dailyCoins,dailyMats,dailyGems,current:sample(lv),mid:sample(25),late:sample(50),end:sample(100)};
}
function renderEconomyBalance(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.economy-balance-panel');
 if(!panel){panel=document.createElement('section');panel.className='economy-balance-panel';const st=document.createElement('style');st.textContent=`.economy-balance-panel{margin:14px 0;padding:14px;border-radius:18px;background:linear-gradient(180deg,rgba(24,20,17,.99),rgba(10,10,9,.99));border:1px solid rgba(220,184,104,.25);box-shadow:0 10px 28px rgba(0,0,0,.22)}.economy-balance-panel h3{margin:0 0 4px;font-size:14px}.economy-balance-sub{font-size:10px;opacity:.62;line-height:1.45;margin-bottom:10px}.economy-balance-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.economy-balance-card{padding:9px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.economy-balance-card b{display:block;font-size:10px}.economy-balance-card span{display:block;margin-top:4px;font-size:9px;opacity:.7;line-height:1.4}.economy-balance-note{margin-top:9px;padding:9px;border-radius:10px;background:rgba(220,184,104,.06);font-size:9px;opacity:.74;line-height:1.45}@media(max-width:520px){.economy-balance-grid{grid-template-columns:1fr 1fr}}@media(max-width:360px){.economy-balance-grid{grid-template-columns:1fr}}`;document.head.appendChild(st)}
 const f=getEconomyBalanceModel();
 const card=(icon,title,text)=>`<div class="economy-balance-card"><b>${icon} ${title}</b><span>${text}</span></div>`;
 const dayCoins=Math.round(f.dailyCoins),dayMats=f.dailyMats.toFixed(1),dayGems=f.dailyGems.toFixed(1);
 panel.innerHTML=`<h3>⚖️ Баланс доходов и расходов</h3><div class="economy-balance-sub">Расчёт показывает ориентир по гарантированным заданиям и базовой стоимости редкого предмета в кузнице. Реальный доход выше/ниже в зависимости от PvE, событий, сюжета и активности игрока.</div><div class="economy-balance-grid">${card('🪙','Доход / день',`≈ ${dayCoins.toLocaleString('ru-RU')} монет · ≈ ${dayMats} материалов · ≈ ${dayGems} 💎 из гарантированных заданий`)}${card('🔨','Сейчас',`Редкий предмет Lv.${f.current.level}: ≈ ${f.current.coin.toLocaleString('ru-RU')} 🪙 + ${f.current.mat} 🔩 за базовое улучшение`)}${card('⚒️','Lv.25',`≈ ${f.mid.coin.toLocaleString('ru-RU')} 🪙 + ${f.mid.mat} 🔩 за базовое улучшение`)}${card('🔥','Lv.50',`≈ ${f.late.coin.toLocaleString('ru-RU')} 🪙 + ${f.late.mat} 🔩 за базовое улучшение`)}${card('👑','Lv.100',`≈ ${f.end.coin.toLocaleString('ru-RU')} 🪙 + ${f.end.mat} 🔩 за базовое улучшение`)}${card('🧭','Наша цель','Первые уровни — быстрый рост. Середина — выбор и билд. Дальний путь — редкие улучшения и долгие цели, а не бесконечный гринд.')}</div><div class="economy-balance-note">💎 Донат должен экономить время и давать удобство. Он не должен становиться единственным разумным способом поддерживать развитие. Баланс будем проверять на реальных игровых сессиях и метриках, а не только по формулам.</div>`;
}

function renderEconomyHealth(){
 const host=$('#roadmap');if(!host)return;let panel=host.querySelector('.economy-health-panel');
 if(!panel){panel=document.createElement('section');panel.className='economy-health-panel';const st=document.createElement('style');st.textContent=`.economy-health-panel{margin:14px 0;padding:14px;border-radius:18px;background:linear-gradient(180deg,rgba(20,24,20,.98),rgba(9,11,9,.98));border:1px solid rgba(118,190,130,.2);box-shadow:0 10px 28px rgba(0,0,0,.22)}.economy-health-panel h3{margin:0 0 5px;font-size:14px}.economy-health-sub{font-size:10px;opacity:.62;margin-bottom:10px}.economy-health-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.economy-health-item{padding:9px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.economy-health-item b{display:block;font-size:10px}.economy-health-item span{display:block;margin-top:3px;font-size:9px;opacity:.65;line-height:1.35}@media(max-width:420px){.economy-health-grid{grid-template-columns:1fr}}`;document.head.appendChild(st)}
 const s=Store.state,e=Store.getEconomyProfile(s.level),coins=Math.max(0,Number(s.coins)||0),mats=Math.max(0,Number(s.forge?.materials)||0),gems=Math.max(0,Number(s.gems)||0),stones=Math.max(0,Number(s.battleStones)||0);
 const card=(icon,title,text)=>`<div class="economy-health-item"><b>${icon} ${title}</b><span>${text}</span></div>`;
 panel.innerHTML=`<h3>⚖️ Здоровье экономики</h3><div class="economy-health-sub">Прогресс ускоряется в начале, затем постепенно становится глубже. Цель — долгий путь без искусственного гринда.</div><div class="economy-health-grid">${card('⭐','Следующий уровень',`нужно ${e.xpNext.toLocaleString('ru-RU')} XP · ${e.band}`)}${card('🪙','Монеты',`${coins.toLocaleString('ru-RU')} сейчас · кузница дорожает вместе с развитием`)}${card('🔩','Материалы',`${mats} в запасе · главный ресурс кузницы`)}${card('💎','Премиум',`${gems} игровых камней · донатный баланс отделён от прогрессии`)}${card('⚔️','PvE-ритм',`${stones}/${e.dailyBattleCap} Battle Stones доступно сегодня`)}${card('🧭','Этап',`${e.band} · уровень ${e.level}`)}</div>`;
}

function renderProgressionHealth(){
 const host=$('#roadmap');if(!host)return;
 let panel=host.querySelector('.progression-health-panel');
 if(!panel){panel=document.createElement('section');panel.className='progression-health-panel';const st=document.createElement('style');st.textContent=`.progression-health-panel{margin:14px 0;padding:14px;border-radius:18px;background:linear-gradient(180deg,rgba(22,20,18,.98),rgba(10,10,9,.98));border:1px solid rgba(220,184,104,.2);box-shadow:0 10px 28px rgba(0,0,0,.22)}.progression-health-panel h3{margin:0 0 5px;font-size:14px}.progression-health-sub{font-size:10px;opacity:.62;margin-bottom:10px}.progression-health-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.progression-health-item{padding:9px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.progression-health-item b{display:block;font-size:10px}.progression-health-item span{display:block;margin-top:3px;font-size:9px;opacity:.65;line-height:1.35}@media(max-width:420px){.progression-health-grid{grid-template-columns:1fr}}`;document.head.appendChild(st)}
 const s=Store.state,lv=Math.max(1,Number(s.level)||1),xp=Math.max(0,Number(s.xp)||0),next=Math.max(1,Number(s.xpNext)||100),chap=Math.max(1,Number(s.currentChapter)||1),wins=Math.max(0,Number(s.pve?.wins)||0),loot=Math.max(0,Number(s.lootFound)||0),forge=Math.max(0,Number(s.forge?.successes)||0);
 const daily=s.daily||{},weekly=s.weekly||{};
 const card=(icon,title,text)=>`<div class="progression-health-item"><b>${icon} ${title}</b><span>${text}</span></div>`;
 panel.innerHTML=`<h3>🧭 Пульс прогрессии</h3><div class="progression-health-sub">Короткий ориентир: что уже растёт и какой следующий горизонт у героя.</div><div class="progression-health-grid">${card('⭐','Уровень',`Lv. ${lv} · ${xp}/${next} XP до следующего уровня`)}${card('🗺️','Мир',`Глава ${chap} · ${Number(s.chapterProgress)||0}% текущей главы`)}${card('⚔️','Боевая история',`${wins} обычных побед · ${Number(s.pve?.bossDefeated)||0} поверженных боссов`)}${card('🎁','Коллекция',`${loot} найденных предметов · ${forge} успешных улучшений`)}${card('☀️','Сегодня',`${Number(daily.wins)||0} побед · ${Number(daily.loot)||0} добычи · ${Number(daily.forge)||0} улучшений`)}${card('📅','Неделя',`${Number(weekly.wins)||0} побед · ${Number(weekly.loot)||0} добычи · ${Number(weekly.chapters)||0} глав`)}</div>`;
}

const LONG_HORIZONS=[
 {id:'h5',icon:'🌲',title:'Первые земли',text:'Дойти до главы 5 и закрепить базовый игровой цикл.',type:'chapter',need:5},
 {id:'h10',icon:'⚒️',title:'Мастерство',text:'Глава 10 открывает уже заметный долгий горизонт развития.',type:'chapter',need:10},
 {id:'h25',icon:'🏔️',title:'Дальний путь',text:'Глава 25 — серьёзная отметка для постоянного героя.',type:'chapter',need:25},
 {id:'h50',icon:'👑',title:'Ветеран Territory',text:'Глава 50 — долгосрочная цель мира.',type:'chapter',need:50},
 {id:'h100',icon:'🌌',title:'Сто глав',text:'Большой рубеж сюжетного путешествия.',type:'chapter',need:100},
 {id:'h240',icon:'🏆',title:'Предел карты',text:'Глава 240 — текущий верхний горизонт кампании.',type:'chapter',need:240},
 {id:'l10',icon:'⭐',title:'Опытный герой',text:'Достичь 10 уровня.',type:'level',need:10},
 {id:'l25',icon:'🔥',title:'Закалённый герой',text:'Достичь 25 уровня.',type:'level',need:25},
 {id:'l50',icon:'⚔️',title:'Мастер боя',text:'Достичь 50 уровня.',type:'level',need:50},
 {id:'w100',icon:'⚔️',title:'Сотня побед',text:'Одержать 100 обычных PvE-побед.',type:'wins',need:100},
 {id:'b25',icon:'👹',title:'Охотник на боссов',text:'Победить 25 боссов.',type:'bosses',need:25},
 {id:'f50',icon:'🔨',title:'Великий кузнец',text:'Сделать 50 успешных улучшений.',type:'forge',need:50}
];
function longHorizonValue(s,type){
 if(type==='chapter')return Math.max(1,Number(s.currentChapter)||1);
 if(type==='level')return Math.max(1,Number(s.level)||1);
 if(type==='wins')return Math.max(0,Number(s.pve?.wins)||0);
 if(type==='bosses')return Math.max(0,Number(s.pve?.bossDefeated)||0);
 if(type==='forge')return Math.max(0,Number(s.forge?.successes)||0);
 return 0;
}
function renderLongTermHorizons(){
 const host=$('#roadmap');if(!host)return;
 let panel=host.querySelector('.long-horizons-panel');
 if(!panel){panel=document.createElement('section');panel.className='long-horizons-panel';const st=document.createElement('style');st.textContent=`.long-horizons-panel{margin:14px 0 20px;padding:14px;border-radius:18px;background:radial-gradient(circle at 50% 0,rgba(70,90,140,.16),rgba(10,11,15,.99) 62%);border:1px solid rgba(130,150,205,.24);box-shadow:0 12px 30px rgba(0,0,0,.24)}.long-horizons-panel h3{margin:0 0 4px;font-size:14px}.long-horizons-sub{font-size:10px;opacity:.62;margin-bottom:11px}.long-horizons-list{display:grid;gap:7px}.long-horizon{display:grid;grid-template-columns:31px 1fr auto;gap:8px;align-items:center;padding:9px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}.long-horizon.done{border-color:rgba(130,150,205,.38);opacity:.72}.long-horizon.next{border-color:rgba(220,184,104,.42);box-shadow:inset 0 0 16px rgba(220,184,104,.035)}.long-horizon-icon{text-align:center;font-size:21px}.long-horizon b{font-size:10px}.long-horizon p{margin:2px 0 0;font-size:8px;opacity:.6;line-height:1.35}.long-horizon-value{text-align:right;font-size:8px;opacity:.68;white-space:nowrap}.long-horizon-value strong{display:block;font-size:10px;opacity:.9}@media(max-width:420px){.long-horizon{grid-template-columns:28px 1fr}.long-horizon-value{grid-column:2;text-align:left;margin-top:-2px}}`;document.head.appendChild(st)}
 const s=Store.state;const rows=LONG_HORIZONS.map(h=>{const v=longHorizonValue(s,h.type),done=v>=h.need;return {h,v,done}});const next=rows.find(x=>!x.done);
 const visible=rows.filter(x=>x.done||x===next).slice(0,7);
 panel.innerHTML=`<h3>🧭 Длинный горизонт</h3><div class="long-horizons-sub">Не обязательные задания, а ориентиры для героя. Ближайшая цель подсвечена — остальные откроются по мере пути.</div><div class="long-horizons-list">${visible.map(x=>`<article class="long-horizon ${x.done?'done':''} ${next===x?'next':''}"><div class="long-horizon-icon">${x.h.icon}</div><div><b>${x.h.title}</b><p>${x.h.text}</p></div><div class="long-horizon-value"><strong>${x.done?'✓':x.v+' / '+x.h.need}</strong>${x.done?'достигнуто':''}</div></article>`).join('')}</div>`;
}

function roadmap(){
 const s=Store.state,n=$('#roadNodes');if(!n)return;n.innerHTML='';
 for(let i=1;i<=4;i++){const b=document.createElement('button');b.className='node '+(i<s.chapterStage?'done ':'')+(i===Math.min(4,s.chapterStage)?'current':'');b.textContent=i;b.onclick=()=>{s.chapterStage=i;Store.saveNow();roadmap()};n.appendChild(b)}
 $('#roadChapter').textContent='ГЛАВА '+s.currentChapter;$('#stageTitle').textContent=s.currentChapter+'-'+Math.min(4,s.chapterStage);$('#stageProgress').textContent=s.chapterProgress+'%';
 $('#roadBoss').style.display=s.chapterBossUnlocked?'block':'none';renderDailyMissions();renderWeekly();renderProgressionHealth();renderEconomyHealth();renderEconomyFlow();renderEconomyBalance();renderLongTermHorizons();renderStoryChain();renderWorldEvents();renderDonationShop();renderNPCs();renderNPCQuests();renderNpcStoryAftermath();renderNpcPersonalEndings();renderTerritoryConvergence();renderWorldUnlocks();renderWorldLocations();renderProgressionPulse();renderWorldMemories();
 renderHeroChronicle();renderWorldEchoes();renderAchievements(); renderTerritoryBranch();renderTerritoryFrontier();renderTerritoryFrontierAftermath();renderTerritoryFinale();
}
const inv=[['⚔️','Топор','Оружие'],['🪖','Шлем','Броня'],['🛡️','Доспех','Броня'],['🎗️','Пояс','Аксессуар'],['🥾','Сапоги','Аксессуар'],['💍','Кольцо','Аксессуар'],['🔮','Амулет','Аксессуар'],['🧪','Эликсир HP','Предмет']];
function cards(id,arr){const el=$(id);if(!el)return;el.innerHTML=arr.map((x,i)=>`<button class="card" data-item="${i}"><div>${x[0]}</div><b>${x[1]}</b><span>${x[2]}</span></button>`).join('');$$('#'+id+' .card').forEach(b=>b.onclick=()=>modal('Предмет',`<p>${arr[+b.dataset.item][1]}</p>`))}
function ensureEquipmentUi(){
 const host=$('#inventory');if(!host||host.dataset.equipmentUi==='1')return;
 host.dataset.equipmentUi='1';
 const style=document.createElement('style');style.textContent=`
 #inventory .loot-inventory-panel{margin:12px 0;padding:12px;border-radius:14px;background:rgba(25,22,20,.96);border:1px solid rgba(220,184,104,.22)} #inventory .loot-inventory-panel h3{margin:0 0 8px;font-size:14px} #inventory .loot-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px} #inventory .loot-item{display:grid;grid-template-columns:28px 1fr;grid-template-rows:auto auto;gap:1px 6px;text-align:left;padding:7px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.035);color:inherit} #inventory .loot-item span{grid-row:1/3;font-size:20px} #inventory .loot-item b{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #inventory .loot-item small{font-size:9px;opacity:.65}
#inventory .set-bonus-panel{margin:12px 0;padding:12px;border-radius:14px;background:linear-gradient(180deg,rgba(31,24,17,.96),rgba(14,12,10,.96));border:1px solid rgba(220,184,104,.2)}#inventory .set-bonus-panel h3{margin:0 0 8px;font-size:14px}.set-line{padding:8px 0;border-top:1px solid rgba(255,255,255,.06)}.set-line:first-of-type{border-top:0}.set-line div{display:flex;justify-content:space-between;gap:8px}.set-line span{opacity:.55;font-size:10px}.set-line p{margin:4px 0 0;font-size:10px;opacity:.8}.set-empty{margin:0;opacity:.6;font-size:11px}
#inventory .equipment-panel{margin:12px 0 18px;padding:12px;border-radius:14px;background:linear-gradient(180deg,rgba(25,22,20,.96),rgba(12,11,10,.96));border:1px solid rgba(220,184,104,.22);box-shadow:0 8px 24px rgba(0,0,0,.2)}
 #inventory .equipment-panel h3{margin:0 0 8px;font-size:14px;letter-spacing:.04em;text-transform:uppercase}
 #inventory .equipment-summary{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px;font-size:11px;opacity:.82}
 #inventory .equipment-summary span{padding:5px 8px;border-radius:8px;background:rgba(255,255,255,.05)}
 #inventory .equipment-slots{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
 #inventory .equipment-slot{min-width:0;padding:7px 3px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.035);color:inherit;cursor:pointer;text-align:center}
 #inventory .equipment-slot.filled{border-color:rgba(220,184,104,.42);box-shadow:0 0 10px rgba(220,184,104,.08)}
 #inventory .equipment-slot .eq-icon{display:block;font-size:20px;line-height:24px}.equipment-slot small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:9px;opacity:.72;margin-top:2px}
 @media(max-width:520px){#inventory .equipment-slots{grid-template-columns:repeat(4,1fr)}#inventory .equipment-summary{font-size:10px}}
 `;document.head.appendChild(style);
 const panel=document.createElement('section');panel.className='equipment-panel';panel.innerHTML='<h3>Экипировка героя</h3><div class="equipment-summary" id="equipmentSummary"></div><div class="equipment-slots" id="equipmentSlots"></div>';
 const grid=host.querySelector('#inventoryGrid');host.insertBefore(panel,grid||null);
}
function itemStat(item,keys){if(!item||typeof item!=='object')return 0;for(const k of keys){const n=Number(item[k]);if(Number.isFinite(n)&&n)return n}return 0}
function itemRarity(item){const raw=String(item?.rarity||item?.quality||item?.tier||'common').toLowerCase();if(/legend|легенд/.test(raw))return 'легендарный';if(/epic|эпик/.test(raw))return 'эпический';if(/rare|редк/.test(raw))return 'редкий';if(/uncommon|необыч/.test(raw))return 'необычный';return 'обычный'}
function itemName(item,i){return typeof item==='string'?item:(item?.name||item?.title||`Слот ${i+1}`)}
function showEquipmentItem(item,i){
 if(!item)return modal('Слот пуст',`<p>Слот ${i+1} пока не занят.</p><p>Когда предмет появится, его характеристики будут автоматически учитываться в PvE.</p>`);
 const name=escapeHtml(itemName(item,i)), rarity=itemRarity(item), level=Number(item.level)||1;
 const atk=itemStat(item,['strength','attack','damage','atk']),def=itemStat(item,['defense','def','armor','guard']),agi=itemStat(item,['agility','agi','speed']),hp=itemStat(item,['maxHp','hp','health']);
 const slotMap={weapon:0,helmet:1,armor:2,belt:3,boots:4,ring:5,amulet:6};const slot=slotMap[item.type||item.slot];
 const arenaActive=slot!=null&&String(Store.state.arena?.gear?.[slot]||'')===String(item.id);
 modal('Экипировка',`<div><h3 style="margin:0 0 4px">${name}</h3><p style="margin:0 0 8px;opacity:.7">${rarity} · Lv. ${level} · слот ${i+1}</p><p>⚔ Атака: <b>+${atk}</b></p><p>🛡 Защита: <b>+${def}</b></p><p>⚡ Ловкость: <b>+${agi}</b></p><p>❤️ Максимум HP: <b>+${hp}</b></p><p style="opacity:.65;font-size:.9em">Один и тот же предмет можно сохранить в PvE и в Arena-пресете — дубликат не создаётся.</p><div style="display:grid;gap:7px;margin-top:12px">${slot!=null?`<button type="button" id="modalArenaGear" style="width:100%;padding:10px;border:0;border-radius:10px;background:rgba(220,184,104,.18);color:inherit;font-weight:900">${arenaActive?'✓ В Arena · снять из слота':'⚔️ В Arena'}</button>`:''}</div></div>`);
 const b=document.querySelector('#modalArenaGear');if(b)b.onclick=()=>{if(arenaActive)Store.clearArenaGearSlot(slot);else Store.setArenaGearSlot(slot,item.id);renderLootInventory();renderEquipmentPanel();showEquipmentItem(item,i)};
}
function renderEquipmentPanel(){
 ensureEquipmentUi();const s=Store.state,eq=Array.isArray(s.equipment)?s.equipment.slice(0,7):Array(7).fill(null);while(eq.length<7)eq.push(null);
 const names=['Оружие','Шлем','Доспех','Пояс','Сапоги','Кольцо','Амулет'],icons=['🪓','🪖','🛡️','🎗️','🥾','💍','🔮'];
 let atk=0,def=0,agi=0,hp=0;eq.forEach(x=>{atk+=itemStat(x,['strength','attack','damage','atk']);def+=itemStat(x,['defense','def','armor','guard']);agi+=itemStat(x,['agility','agi','speed']);hp+=itemStat(x,['maxHp','hp','health'])});
 const sum=$('#equipmentSummary');if(sum)sum.innerHTML=`<span>⚔ +${atk}</span><span>🛡 +${def}</span><span>⚡ +${agi}</span><span>❤️ +${hp}</span>`;
 const slots=$('#equipmentSlots');if(!slots)return;slots.innerHTML=eq.map((item,i)=>`<button class="equipment-slot ${item?'filled':''}" data-eq="${i}"><span class="eq-icon">${escapeHtml(item?.icon||item?.emoji||icons[i])}</span><small>${escapeHtml(item?itemName(item,i):names[i])}</small></button>`).join('');slots.querySelectorAll('[data-eq]').forEach(b=>b.onclick=()=>showEquipmentItem(eq[Number(b.dataset.eq)],Number(b.dataset.eq)));
}
function renderLootInventory(){
 const host=$('#inventory');if(!host)return;let panel=host.querySelector('.loot-inventory-panel');if(!panel){panel=document.createElement('section');panel.className='loot-inventory-panel';panel.innerHTML='<h3>🎁 Добыча PvE</h3><div class="loot-items"></div>';const grid=host.querySelector('#inventoryGrid');host.insertBefore(panel,grid||null)}
 const items=Array.isArray(Store.state.inventoryItems)?Store.state.inventoryItems:[];const list=panel.querySelector('.loot-items');if(!items.length){list.innerHTML='<span style="opacity:.65;font-size:12px">Пока нет добычи. Побеждай врагов, чтобы получать предметы.</span>';return}
 list.innerHTML=items.slice(0,12).map((x,i)=>`<button class="loot-item" data-loot-index="${i}"><span>${escapeHtml(x.icon||x.emoji||'🎁')}</span><b>${escapeHtml(itemName(x,i))}</b><small>${escapeHtml(itemRarity(x))} · Lv. ${Number(x.level)||1} · +${Number(x.enhance)||0}${Store.state.arena?.gear?.includes?.(x.id)?' · ⚔️ Arena':''}</small></button>`).join('');list.querySelectorAll('[data-loot-index]').forEach(b=>b.onclick=()=>{const item=items[Number(b.dataset.lootIndex)];showEquipmentItem(item,Number(b.dataset.lootIndex));openForgeItem(item?.id||null)});
}
function itemSetInfo(item){
 const id=String(item?.setId||'').toLowerCase();
 const names={tide:'Морской дозор',gold:'Золотой страж',blackflag:'Чёрный флаг',sacred:'Священные врата',warchief:'Вождь племени'};
 return {id,name:item?.setName||names[id]||''};
}
function equipmentSetSummary(){
 const eq=Array.isArray(Store.state.equipment)?Store.state.equipment:[];const map={};
 eq.forEach(it=>{const z=itemSetInfo(it);if(!z.id)return;map[z.id]=map[z.id]||{id:z.id,name:z.name,count:0};map[z.id].count++});
 return Object.values(map).sort((a,b)=>b.count-a.count);
}
function setBonusText(id,count){
 const data={tide:[[2,'⚡ +4 ловкость'],[4,'⚔ +10 атака'],[6,'💧 +8% лечение']],gold:[[2,'🛡 +6 защита'],[4,'❤️ +80 Max HP'],[6,'🛡 +8% снижение урона']],blackflag:[[2,'⚔ +7 атака'],[4,'⚡ +7 ловкость'],[6,'💥 +8% крит']],sacred:[[2,'🛡 +8 защита'],[4,'⚔ +12 атака'],[6,'❤️ +120 Max HP']],warchief:[[2,'⚔ +15 атака'],[4,'🛡 +15 защита'],[6,'👑 +12% крит']]}[id]||[];
 return data.filter(x=>count>=x[0]).map(x=>x[1]);
}
function renderSetBonuses(){
 const host=$('#inventory');if(!host)return;let panel=host.querySelector('.set-bonus-panel');if(!panel){panel=document.createElement('section');panel.className='set-bonus-panel';host.insertBefore(panel,host.querySelector('.equipment-panel')||host.firstChild)}
 const sets=equipmentSetSummary();panel.innerHTML='<h3>👑 Комплекты</h3>'+(sets.length?sets.map(x=>{const active=setBonusText(x.id,x.count);return `<div class="set-line"><div><b>${escapeHtml(x.name)}</b><span>${x.count}/6 предметов</span></div><p>${active.length?active.map(escapeHtml).join(' · '):'Собери 2 предмета, чтобы открыть бонус'}</p></div>`}).join(''):'<p class="set-empty">Надень предметы одного комплекта, чтобы открыть бонусы.</p>');
}
function forgeRarityRank(item){const r=String(item?.rarity||'common').toLowerCase();return r==='legendary'?5:r==='epic'?4:r==='rare'?3:r==='uncommon'?2:1}
function forgeRarityName(item){const r=String(item?.rarity||'common').toLowerCase();return ({legendary:'легендарный',epic:'эпический',rare:'редкий',uncommon:'необычный',common:'обычный'})[r]||'обычный'}
function forgeStatScale(item){const lvl=Math.max(1,Number(item?.level)||1),rank=forgeRarityRank(item);return Math.max(1,Math.floor(lvl*(1+rank*.12)))}
function forgeUpgrade(item){
 if(!item)return;const s=Store.state;const level=Math.max(1,Number(item.level)||1),rank=forgeRarityRank(item),enh=Math.max(0,Number(item.enhance)||0);
 const econ=Store.getEconomyProfile?.(level)||{forgeCostMultiplier:1};const coinCost=Math.floor(35*level*(1+rank*.35)*(1+enh*.18)*Number(econ.forgeCostMultiplier||1));const matCost=Math.max(1,Math.ceil((level+enh)*Number(econ.forgeCostMultiplier||1)/2));
 if((Number(s.coins)||0)<coinCost){modal('Кузница','<p>Недостаточно монет.</p><p>Нужно: 🪙 '+coinCost.toLocaleString('ru-RU')+'</p>');return}
 if((Number(s.forge?.materials)||0)<matCost){modal('Кузница','<p>Недостаточно материалов.</p><p>Нужно: 🔩 '+matCost+'</p>');return}
 s.coins-=coinCost;s.forge.materials-=matCost;
 const baseChance=enh<3?1:Math.max(.35,1-(enh-2)*.12);const pity=Math.min(.18,Number(s.forge?.failStreak||0)*.06);const chance=Math.min(.95,baseChance+pity);const ok=Math.random()<chance;
 if(ok){item.enhance=enh+1;item.level=level+1;const gain=forgeStatScale(item);if(item.attack)item.attack+=Math.max(1,Math.floor(gain*.45));if(item.defense)item.defense+=Math.max(1,Math.floor(gain*.4));if(item.agility)item.agility+=Math.max(1,Math.floor(gain*.18));if(item.maxHp)item.maxHp+=Math.max(2,gain*2);s.forge.successes=(Number(s.forge.successes)||0)+1;s.forge.failStreak=0;dailyTick('forge');save();renderLootInventory();renderEquipmentPanel();paintGlobal();openForgeItem(item.id);modal('Кузница','<p>🔥 Улучшение успешно!</p><p><b>+'+(item.enhance||1)+'</b> · Lv. '+item.level+'</p><p>Шанс: '+Math.round(chance*100)+'%</p>')}else{s.forge.failStreak=(Number(s.forge.failStreak)||0)+1;save();renderLootInventory();openForgeItem(item.id);modal('Кузница','<p>⚒ Улучшение не удалось.</p><p>Предмет не уничтожен и его уровень сохранён.</p><p>Шанс: '+Math.round(chance*100)+'%</p>')}
}
function forgeSalvage(item){
 if(!item)return;const s=Store.state;const rank=forgeRarityRank(item);const mats=Math.max(1,rank+Math.floor((Number(item.level)||1)/3));const coins=Math.max(5,rank*8+Math.floor((Number(item.level)||1)*2));
 s.forge.materials=(Number(s.forge?.materials)||0)+mats;s.coins=(Number(s.coins)||0)+coins;s.inventoryItems=(s.inventoryItems||[]).filter(x=>x?.id!==item.id);if(Array.isArray(s.arena?.gear))s.arena.gear=s.arena.gear.map(id=>String(id)===String(item.id)?null:id);if(s.forge.selectedId===item.id)s.forge.selectedId=null;Store.saveNow();renderLootInventory();renderEquipmentPanel();paintGlobal();openForgeItem(null);
}
function openForgeItem(id){
 const s=Store.state;const item=(s.inventoryItems||[]).find(x=>x?.id===id)||null;s.forge.selectedId=item?.id||null;const host=$('#inventory');if(!host)return;
 let panel=host.querySelector('.forge-panel');if(!panel){panel=document.createElement('section');panel.className='forge-panel';host.insertBefore(panel,host.querySelector('.equipment-panel')||host.firstChild)}
 const mats=Number(s.forge?.materials)||0;
 if(!item){panel.innerHTML=`<h3>🔨 Кузница</h3><p class="forge-empty">Выбери предмет из добычи ниже. Здесь можно улучшить его или разобрать на материалы.</p><div class="forge-materials">🔩 Материалы: <b>${mats}</b></div>`;return}
 const level=Math.max(1,Number(item.level)||1),rank=forgeRarityRank(item),enh=Math.max(0,Number(item.enhance)||0),coinCost=Math.floor(35*level*(1+rank*.35)*(1+enh*.18)),matCost=Math.max(1,Math.ceil((level+enh)/2));
 const stat=(keys)=>itemStat(item,keys);panel.innerHTML=`<h3>🔨 Кузница</h3><div class="forge-selected"><span class="forge-icon">${escapeHtml(item.icon||item.emoji||'🎁')}</span><div><b>${escapeHtml(itemName(item,0))}</b><small>${forgeRarityName(item)} · Lv. ${level} · +${Number(item.enhance)||0}</small></div></div><div class="forge-stats"><span>⚔ +${stat(['attack','strength','damage','atk'])}</span><span>🛡 +${stat(['defense','def','armor','guard'])}</span><span>⚡ +${stat(['agility','agi','speed'])}</span><span>❤️ +${stat(['maxHp','hp','health'])}</span></div><div class="forge-cost">Следующий уровень: 🪙 ${coinCost.toLocaleString('ru-RU')} · 🔩 ${matCost} · материалов: ${mats}</div><div class="forge-actions"><button data-forge-upgrade>⬆ Улучшить</button><button data-forge-salvage>♻ Разобрать</button></div>`;
 panel.querySelector('[data-forge-upgrade]').onclick=()=>forgeUpgrade(item);panel.querySelector('[data-forge-salvage]').onclick=()=>forgeSalvage(item);
}
function ensureForgeUi(){
 const host=$('#inventory');if(!host||host.dataset.forgeUi==='1')return;host.dataset.forgeUi='1';const style=document.createElement('style');style.textContent=`#inventory .forge-panel{margin:12px 0;padding:13px;border-radius:14px;background:linear-gradient(180deg,rgba(35,27,18,.98),rgba(16,13,10,.98));border:1px solid rgba(220,184,104,.28);box-shadow:0 8px 24px rgba(0,0,0,.2)}#inventory .forge-panel h3{margin:0 0 8px}#inventory .forge-empty{margin:0 0 8px;opacity:.68;font-size:12px}.forge-materials{font-size:12px}.forge-selected{display:flex;gap:10px;align-items:center}.forge-icon{font-size:30px}.forge-selected small{display:block;opacity:.65;margin-top:2px}.forge-stats{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.forge-stats span{padding:5px 7px;border-radius:8px;background:rgba(255,255,255,.05);font-size:10px}.forge-cost{font-size:11px;opacity:.75;margin-bottom:9px}.forge-actions{display:flex;gap:7px}.forge-actions button{flex:1;border:0;border-radius:9px;padding:9px;font-weight:700;background:rgba(255,255,255,.08);color:inherit}.forge-actions button:first-child{background:rgba(220,184,104,.18);border:1px solid rgba(220,184,104,.3)}@media(max-width:520px){.forge-actions button{font-size:11px}}`;document.head.appendChild(style);openForgeItem(Store.state.forge?.selectedId||null);
}
function inventory(){
 ensureForgeUi();
 renderLootInventory();
 const groups={Оружие:inv.slice(0,1),Броня:inv.slice(1,3),Аксессуары:inv.slice(3,7),Предметы:inv.slice(7)};
 const tabs=$$('#inventory .tabs button');
 tabs.forEach((b,i)=>b.onclick=()=>{tabs.forEach(x=>x.classList.remove('active'));b.classList.add('active');cards('#inventoryGrid',groups[b.textContent.trim()]||inv)});
 cards('#inventoryGrid',groups[tabs.find(x=>x.classList.contains('active'))?.textContent.trim()||'Оружие']||inv);
}
function shop(){
 const items=[['🧪','Зелье HP','Восстановление'],['🔵','Энергия','Восстановление'],['🔴','Атака','Бафф'],['🟡','Защита','Бафф'],['🟣','Адреналин','Возрождение'],['💠','Ускорение','Бой']];
 const groups={Эликсиры:items.slice(0,2),Оружие:items.slice(2,3),Броня:items.slice(3,4),Боевые:items.slice(4)};
 const tabs=$$('#shop .tabs button');
 tabs.forEach(b=>b.onclick=()=>{tabs.forEach(x=>x.classList.remove('active'));b.classList.add('active');cards('#shopGrid',groups[b.textContent.trim()]||items)});
 cards('#shopGrid',groups[tabs.find(x=>x.classList.contains('active'))?.textContent.trim()||'Эликсиры']||items);
 $$('[data-coins]').forEach(e=>e.textContent=Math.floor(Store.state.coins).toLocaleString('ru-RU'))
}
function games(){const b=$('#board');if(!b)return;b.innerHTML='';for(let i=0;i<25;i++){const c=document.createElement('button');c.className='cell '+(i===Store.state.pos?'active':'');c.textContent=i+1;c.onclick=()=>{Store.state.pos=i;Store.saveNow();games()};b.appendChild(c)}$$('[data-dice]').forEach(x=>x.textContent=Store.state.dice)}
$('#roll').onclick=()=>{if(!Store.state.dice)return modal('Кубики','<p>Кубики закончились.</p>');Store.state.dice--;Store.state.pos=(Store.state.pos+1+Math.floor(Math.random()*6))%25;Store.saveNow();games();$('#rollLog').textContent='Позиция '+(Store.state.pos+1)};
$('#followersBtn').onclick=()=>modal('Последователи','<p>Лиабро — Крит</p><p>Тералель — Защита</p><p>Король-коров — Лечение</p><p>Морт — Уклонение</p><p>Каменное Лицо — Контроль</p>');
$$('[data-home]').forEach(b=>b.onclick=()=>show('home'));$$('[data-roadmap]').forEach(b=>b.onclick=()=>show('map'));
$('#roadBattle').onclick=()=>window.PvEFlow?.startRunner?.() || window.HomeRebuild?.startRunner?.(false);$('#roadBoss').onclick=()=>window.PvEFlow?.openBoss?.() || window.HomeRebuild?.openBoss?.();
function paintGlobal(){
 const s=Store.state,p=s.profile||{};$('#heroName').textContent=p.displayName||'Игрок';$('#heroLevel').textContent='Lv. '+s.level+' · VIP '+(p.vip||0);$('#heroHp').textContent=Math.floor(s.hp).toLocaleString('ru-RU');$$('[data-coins]').forEach(e=>e.textContent=Math.floor(s.coins).toLocaleString('ru-RU'));
 const pct=s.chapterProgress;const qp=$('#questProgress');if(qp)qp.textContent=pct+'%';const qb=$('#questBar');if(qb)qb.style.width=pct+'%';
}
window.addEventListener('territory:state-changed',()=>{paintGlobal();if(document.body.dataset.screen==='inventory'){renderLootInventory();renderEquipmentPanel();renderSetBonuses()}});
inventory();shop();games();paintGlobal();roadmap();
})();