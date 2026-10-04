(function(){
'use strict';
function esc(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const STYLES={crit:['💥','Критический удар'],dodge:['💨','Уворот'],tank:['🛡️','Танк'],resilience:['🧱','Стойкость']};
function publicChar(d){
 const c=d?.character||{};
 const skin=c.activeUnique==='unique-dikaya'?'assets/skins/unique-dikaya.png':
   (c.skin&&/^((male|female)-[1-5])$/.test(c.skin)?`assets/skins/${c.skin}.svg`:'assets/ui/profile.png');
 return {c,skin};
}
function patchPublic(data){
 const root=document.querySelector('.tp-public');
 if(!root)return;
 const d=data||{}, {c,skin}=publicChar(d);
 const eq=Array.isArray(d.equipment)?d.equipment.slice(0,7):[];
 while(eq.length<7)eq.push(null);
 const icons=['🪖','📿','🧥','🛡️','🥾','⚔️','💍'];
 root.querySelector('.tp-character')?.setAttribute('src',d.skinImage||skin);
 root.querySelectorAll('.tp-eq-slot').forEach((slot,i)=>{
   const it=eq[i], icon=it?.icon&&/^(https?:|assets\/)/.test(String(it.icon))?String(it.icon):null;
   slot.innerHTML=icon?`<img src="${esc(icon)}" alt="">`:`<span class="tp-eq-emoji">${esc(it?.icon||icons[i])}</span><em>${it?.level?`+${esc(it.level)}`:''}</em>`;
 });
 const vals=['strength','agility','intuition','resilience','constitution'];
 root.querySelectorAll('.tp-attrs .tp-attr strong').forEach((el,i)=>el.textContent=Number(c[vals[i]])||0);
 const sp=STYLES[c.specialization]||['⚔️','—'];
 const spec=root.querySelector('.tp-special strong'); if(spec)spec.textContent=sp[0]+' '+sp[1];
 const level=Math.max(1,Number(d.level)||Number(d.profile?.level)||1);
 const hp=Number(d.maxHp||d.max_hp||100)+Number(c.constitution||0)*12;
 const attack=125+level*2+Number(c.strength||0)*3;
 const defense=98+level+Number(c.resilience||0)*3;
 const crit=8+Number(c.intuition||0)*.55;
 const dodge=5+Number(c.agility||0)*.5;
 const block=3+Number(c.resilience||0)*.35;
 const resistance=4+Number(c.resilience||0)*.4;
 const speed=100+Number(c.agility||0)*.7;
 const stats=[Math.round(hp),Math.round(attack),Number(d.maxEnergy||100),Math.round(defense),crit.toFixed(1)+'%',Math.round(150+Number(c.intuition||0)*1.2)+'%',dodge.toFixed(1)+'%',block.toFixed(1)+'%',resistance.toFixed(1)+'%',Math.round(speed)];
 root.querySelectorAll('.tp-stat-grid .tp-stat b').forEach((el,i)=>{if(stats[i]!==undefined)el.textContent=stats[i]});
 const wins=Number(d.arena?.wins)||0,bosses=Number(d.pve?.bossDefeated)||0,pve=Number(d.pve?.wins)||0;
 const ach=root.querySelectorAll('.tp-ach strong'); if(ach[0])ach[0].textContent=wins;if(ach[1])ach[1].textContent=bosses;if(ach[2])ach[2].textContent=pve;
 const f=c.follower||d.follower||{name:'Белый тигр',level:1,icon:'🐯',hp:100,attack:25,defense:18};
 const fol=root.querySelector('.tp-follower'); if(fol)fol.innerHTML=`<div style="font-size:46px;text-align:center">${esc(f.icon||'🐯')}</div><div><b>${esc(f.name||'Последователь')}</b><small>Уровень ${Number(f.level)||1}</small></div><div class="tp-mini-stats">❤️ <b>${Number(f.hp)||0}</b><br>⚔️ <b>${Number(f.attack)||0}</b><br>🛡️ <b>${Number(f.defense)||0}</b></div>`;
}
const wait=fn=>setTimeout(fn,0);
function install(){
 const api=window.TerritoryProfile;
 if(!api||api.__publicFixInstalled)return;
 const original=api.openPublic;
 if(typeof original!=='function')return;
 api.openPublic=function(data){const r=original(data);wait(()=>patchPublic(data));return r};
 api.__publicFixInstalled=true;
 window.TerritoryPublicProfile={patch:patchPublic};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
