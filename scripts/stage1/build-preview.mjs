// Actual production screens with isolated offline UI fixtures, never live accounts.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const fixture = `
const summary={id:'clan1',name:'Северные волки',tag:'WOLF',emblem:1,color1:'#eab308',color2:'#1e293b',level:4,rating:1400,season_medal:1,join_mode:'apply',min_level:15,description:'Вместе побеждаем боссов и строим сильный клан.',members:2,capacity:20,online:2};
const member={player_id:'review',display_name:'Рагнар',role:'leader',level:30,power:250,contributed_gold:1000,contributed_points:10,online:true};
const game={player:{name:'Рагнар',gold:5000,gems:100,redGems:60,level:30},inventory:[],forgeMaterials:5};
export const useGame={get:()=>game,set:()=>{},subscribe:()=>()=>{}};
export function unblockSave(){}; export const validEconomySnapshot=()=>true;
window.__uiCalls=[]; let joined=new URLSearchParams(location.search).get('member')==='1',applied=false;
let messages=[{id:1,author_id:'review',author_name:'Рагнар',author_role:'leader',kind:'chat',body:'Собираемся на кланового босса!',created_at:new Date().toISOString()}];
let applications=[{player_id:'applicant',name:'Бьёрн',level:22}];
const call=(name,args)=>{window.__uiCalls.push({name,args});return {ok:true}};
export const CLAN_CREATION_RED_GEMS_COST=30;
export async function fetchClanDirectory(query=''){call('directory',query);return {my_clan_id:joined?'clan1':null,my_invites:joined?[]:[{...summary,id:1,clan_id:'clan1'}],my_applications:applied?['clan1']:[],clans:query&&!summary.name.toLowerCase().includes(query.toLowerCase())?[]:[summary]};}
export async function fetchClanState(){return {clan:{...summary,xp:60,xp_needed:100,treasury_gold:12000,treasury_points:400,leader_id:'review'},my_role:'leader',members:[member,{...member,player_id:'friend',display_name:'Эйрик',role:'member'}],applications,buildings:{hall:{lvl:2},forge:{lvl:1},library:{lvl:1}},events:[],chat:messages,boss:{boss_no:2,hp:8000,max_hp:10000,expires_at:new Date(Date.now()+3600000).toISOString()},my_boss_damage:1200,boss_attacks_left:4,boss_claimed:false,pending_boss_rewards:[],quests:[{id:'cq_boss_dmg',progress:1200,target:5000,claimed:false,member:1200,member_req:100}],treasury_log:[],war:null,my_war_strikes_today:0,season:null};}
export async function fetchClanRankings(){call('rankings');return {season:null,clans:[summary],history:[]};}
export async function clanApply(id){applied=true;return call('apply',id);}
export async function clanCancelApplication(id){applied=false;return call('cancel_application',id);}
export async function clanAcceptInvite(id){joined=true;return call('accept_invite',id);}
export async function clanDeclineInvite(id){return call('decline_invite',id);}
export async function clanAcceptApp(id){applications=[];return call('accept_app',id);}
export async function clanRejectApp(id){applications=[];return call('reject_app',id);}
export async function clanInviteCandidates(query){call('invite_candidates',query);return [{id:'candidate',display_name:'Харальд',level:28}];}
export async function clanInvitePlayer(id){return call('invite_player',id);}
export async function clanChatSend(id,body){messages=[...messages,{...messages[0],id:2,body}];return call('chat_send',body);}
export async function clanLeave(){joined=false;return call('leave');}
export async function createClan(){joined=true;return {state:game,updated_at:new Date().toISOString(),gold:5000,gems:100,clan_id:'clan1'};}
${['contributeClan','claimClanBoss','claimClanQuest','clanKick','clanSetRole','clanTransfer','clanChatMute','clanBuildingUpgrade','clanBuildingCollect','clanBossAttack','clanBossSync','clanWarSignup','clanWarStrike'].map(name=>`export async function ${name}(...args){return call('${name}',args);}`).join('\n')}
const item={name:'Секира северного ярла',icon:'🪓',rarity:'epic'};
export async function fetchAuctionOverview(filters={}){call('auction_overview',filters);return {enabled:true,lots:[{id:'lot1',seller_id:'seller',seller:'Эйрик',item_id:'item1',item,price_gold:3000,created_at:new Date().toISOString()}],mine:[{id:'lot2',item_id:'item2',item:{...item,name:'Клинок дозорного'},price_gold:1500,status:'open',created_at:new Date().toISOString()}],items:[{item_id:'item3',item:{name:'Амулет ворона',icon:'💎',rarity:'rare'}}],myGold:5000,history:[{id:'history1',item_id:'item4',item,price_gold:1000,fee_gold:100,status:'sold',role:'seller',closed_at:new Date().toISOString()}]};}
export class AuctionTradeError extends Error{}
export async function submitAuctionAction(action,id){call('auction_trade',{action,id});return {success:true};}
export async function readPendingAuction(){return null;} export async function keepPendingAuction(){}
const channel={on(){return channel},subscribe(fn){fn('SUBSCRIBED');return channel},async send(){return 'ok'}};
export const supabase={channel:()=>channel,removeChannel:async()=>{}};
export async function fetchSeasonStatus(){const now=Date.now();const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const get=k=>Number(parts.find(p=>p.type===k).value);const sunday=new Date(Date.UTC(get('year'),get('month')-1,get('day')));sunday.setUTCDate(sunday.getUTCDate()-sunday.getUTCDay());return {enabled:true,server_now:new Date(now).toISOString(),week:sunday.toISOString().slice(0,10),ends_at:new Date(now+86400000).toISOString(),my_points:25,my_rank:1,leaders:[{player_id:'review',display_name:'Рагнар',points:25,rank:1},{player_id:'friend',display_name:'Эйрик',points:19,rank:2}],prizes:[{gold:3000,gems:90},{gold:2000,gems:65},{gold:1500,gems:45},{gold:1000,gems:30},{gold:1000,gems:30},...Array.from({length:5},()=>({gold:500,gems:15}))],history:[{player_id:'friend',display_name:'Эйрик',points:80,rank:1,week:'2026-10-18',reward:{gold:3000,gems:90}}]};}
`;
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{ClanScreen}from'./src/components/ClanScreen';import{AuctionScreen}from'./src/components/AuctionScreen';import{SeasonScreen}from'./src/components/SeasonScreen';import{LanguageProvider}from'./src/game/i18n';const screen=new URLSearchParams(location.search).get('screen');createRoot(document.getElementById('root')).render(<LanguageProvider><div className="territory-shell max-w-md mx-auto min-h-screen"><main className="territory-screen px-3 py-3">{screen==='auction'?<AuctionScreen/>:screen==='season'?<SeasonScreen user={{id:'review'}}/>:<ClanScreen userId="review" notify={text=>{window.__notice=text;}}/>}</main></div></LanguageProvider>);`;
const out=await build({stdin:{contents:entry,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/stage1-ui',format:'iife',jsx:'automatic',minify:true,alias:{'@':resolve('src')},define:{'import.meta.env.BASE_URL':JSON.stringify('/'),'import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-stage1',setup(b){b.onResolve({filter:/\/game\/(clanApi|auctionApi|seasonApi|actions|cloudInt|economyInvariant|supabase)$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js'}));}}]});
const css=(await postcss([tailwindcss(),autoprefixer()]).process(readFileSync('src/index.css','utf8'),{from:'src/index.css'})).css + '\n' + readFileSync('src/components/ui/vikingScreenSkin.css','utf8');
writeFileSync('/tmp/territory-stage1-preview.html',`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#080d22}${css}</style><div id="root"></div><script>${out.outputFiles.find(f=>f.path.endsWith('.js')).text.replace(/<\/script/gi,'<\\/script')}</script></html>`);
console.log('Stage1 offline production-component fixture: /tmp/territory-stage1-preview.html');
