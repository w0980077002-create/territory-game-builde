(function(){
'use strict';
const SERVER='https://territory-sdolars-server.w0660077702.workers.dev';
function initData(){return window.Telegram?.WebApp?.initData||''}
function available(){return !!initData()}
async function request(path,method='GET',body){const d=initData();if(!d)throw new Error('Telegram authentication required');const opt={method,headers:{'content-type':'application/json','x-telegram-init-data':d}};if(method!=='GET')opt.body=JSON.stringify(body||{});const r=await fetch(SERVER+path,opt);const x=await r.json().catch(()=>({error:'Invalid server response'}));if(!r.ok||x?.error)throw new Error(x.error||'Server error');return x}
async function start(chapter,stage,boss){return request('/api/pve/start','POST',{chapter,stage,boss})}
async function action(session_id,nonce,action){return request('/api/pve/action','POST',{session_id,nonce,action})}
async function complete(session_id){return request('/api/pve/complete','POST',{session_id})}
async function sync(){if(!available())return null;const x=await request('/api/player');const state=x.state||{};if(window.TerritoryStore){Object.assign(window.TerritoryStore.state,state);const p=x.player?.player||x.player;if(p){window.TerritoryStore.state.profile=Object.assign({},window.TerritoryStore.state.profile,{displayName:p.first_name||p.username||window.TerritoryStore.state.profile.displayName,photoUrl:p.photo_url||'' ,vip:Number(p.vip)||0});if(p.level)window.TerritoryStore.state.level=Number(p.level);if(p.coins!==undefined)window.TerritoryStore.state.coins=Number(p.coins)||0;if(p.gems!==undefined)window.TerritoryStore.state.gems=Number(p.gems)||0;}}window.TerritoryStore.saveNow?.();window.dispatchEvent(new CustomEvent('territory:telegram-synced'));return x}
window.TerritoryServer={SERVER,available,start,action,complete,sync};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>sync().catch(()=>{}),120),{once:true});else setTimeout(()=>sync().catch(()=>{}),120);
})();
