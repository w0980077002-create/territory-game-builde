const panel=document.getElementById('panel'), title=document.getElementById('panelTitle'), text=document.getElementById('panelText');
const data={home:['Город',''],inventory:['Инвентарь','Здесь будет экипировка и предметы.'],hero:['Герой','Профиль героя, характеристики и последователи.'],arena:['Арена','1×1 · 3×3 · CHAOS.'],shop:['Лавка','Зелья, эликсиры и расходники.']};
function openScreen(s){if(s==='home'){panel.classList.remove('show');return} title.textContent=data[s][0];text.textContent=data[s][1];panel.classList.add('show')}
document.querySelectorAll('[data-screen]').forEach(b=>b.addEventListener('click',()=>openScreen(b.dataset.screen)));
document.getElementById('close').onclick=()=>panel.classList.remove('show');
window.TerritoryStore={state:{name:'Эйнар',vip:5,level:1,coins:45000,gems:4500,energy:125,energyMax:200,hp:6850,hpMax:6850,xp:81431,xpMax:119500},save(){localStorage.setItem('TerritoryStore',JSON.stringify(this.state))}};
