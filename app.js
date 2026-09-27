const KEY='territory-game-full-v1';
const defaults={player:{name:'Эйнар',vip:5,level:1,coins:45000,gems:4500,energy:125,hp:6850,xp:81431},zones:[{name:'Арена',x:79,y:44,w:19,h:14,action:'arena'},{name:'Лавка',x:78,y:43,w:20,h:13,action:'shop'}],items:[{name:'Зелье HP',qty:5},{name:'Эликсир энергии',qty:3},{name:'Зелье силы',qty:2}],shop:[{name:'Зелье HP',price:100},{name:'Эликсир энергии',price:250}],followers:[{name:'Лиабро',role:'Crit',level:1},{name:'Тералель',role:'Defense',level:1},{name:'Король-коров',role:'Healing',level:1},{name:'Морт',role:'Evasion',level:1},{name:'Каменное Лицо',role:'Control',level:1}],assets:[]};
let S=JSON.parse(localStorage.getItem(KEY)||'null')||structuredClone(defaults);
function save(){localStorage.setItem(KEY,JSON.stringify(S));renderZones()}
function renderZones(){const z=document.getElementById('zones');z.innerHTML='';S.zones.forEach((a,i)=>{const b=document.createElement('button');b.className='zone';b.style.cssText=`left:${a.x}%;top:${a.y}%;width:${a.w}%;height:${a.h}%;`;b.onclick=()=>openScreen(a.action);z.appendChild(b)})}
const panel=document.getElementById('gamePanel'),title=document.getElementById('panelTitle'),body=document.getElementById('panelBody');
const texts={home:['Город','Главный экран игры.'],inventory:['Инвентарь','Здесь будут реальные предметы из TerritoryStore.state.'],hero:['Герой','Последователи и характеристики.'],arena:['Арена','1×1 · 3×3 · CHAOS'],shop:['Лавка','Зелья, эликсиры и расходники.']};
function openScreen(s){if(s==='home'){panel.classList.remove('show');return}title.textContent=texts[s]?.[0]||s;body.textContent=texts[s]?.[1]||'';panel.classList.add('show')}
document.querySelectorAll('.bottom [data-screen]').forEach(b=>b.onclick=()=>openScreen(b.dataset.screen));
document.getElementById('closePanel').onclick=()=>panel.classList.remove('show');
document.getElementById('editorBtn').onclick=()=>{document.getElementById('editor').classList.remove('hidden');renderEditor('zones')};
document.getElementById('closeEditor').onclick=()=>document.getElementById('editor').classList.add('hidden');
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderEditor(b.dataset.tab)});
function renderEditor(tab){
 const c=document.getElementById('editorContent');
 if(tab==='zones') return zonesEditor(c);
 if(tab==='economy') return economyEditor(c);
 if(tab==='items') return listEditor(c,'items','Предметы','name','qty');
 if(tab==='shop') return listEditor(c,'shop','Лавка','name','price');
 if(tab==='followers') return followersEditor(c);
 if(tab==='assets') return assetsEditor(c);
}
function zonesEditor(c){c.innerHTML=`<div class="card"><h2>Зоны HOME</h2><p class="muted">Добавляй, удаляй и меняй координаты. На игре рамки невидимы.</p><button class="primary" onclick="addZone()">+ Добавить зону</button></div><div class="card">${S.zones.map((z,i)=>`<div class="editorZone"><b>${z.name}</b><div class="grid"><label class="field">Название<input id="zn${i}" value="${z.name}"></label><label class="field">Действие<select id="za${i}"><option>home</option><option>arena</option><option>shop</option><option>inventory</option><option>hero</option></select></label><label class="field">X<input id="zx${i}" type="number" value="${z.x}"></label><label class="field">Y<input id="zy${i}" type="number" value="${z.y}"></label><label class="field">W<input id="zw${i}" type="number" value="${z.w}"></label><label class="field">H<input id="zh${i}" type="number" value="${z.h}"></label></div><button onclick="updateZone(${i})">Сохранить</button> <button class="danger" onclick="deleteZone(${i})">Удалить</button></div>`).join('')}</div>`;S.zones.forEach((z,i)=>document.getElementById('za'+i).value=z.action)}
window.addZone=()=>{S.zones.push({name:'Новая зона',x:35,y:45,w:20,h:10,action:'home'});save();renderEditor('zones')};
window.deleteZone=i=>{S.zones.splice(i,1);save();renderEditor('zones')};
window.updateZone=i=>{let z=S.zones[i];z.name=document.getElementById('zn'+i).value;z.action=document.getElementById('za'+i).value;['x','y','w','h'].forEach(k=>z[k]=+document.getElementById('z'+k+i).value);save();renderEditor('zones')};
function economyEditor(c){let p=S.player;c.innerHTML=`<div class="card"><h2>Экономика</h2><div class="grid">${[['name','Имя'],['vip','VIP'],['level','Уровень'],['coins','Монеты'],['gems','Алмазы'],['energy','Энергия'],['hp','HP'],['xp','XP']].map(([k,n])=>`<label class="field">${n}<input id="e${k}" value="${p[k]}"></label>`).join('')}</div><button class="primary" onclick="saveEconomy()">Сохранить</button></div>`}
window.saveEconomy=()=>{let p=S.player;Object.keys(p).forEach(k=>{let e=document.getElementById('e'+k);if(e)p[k]=(k==='name'?e.value:+e.value)});save();renderEditor('economy')};
function listEditor(c,key,titleName,nameKey,valKey){c.innerHTML=`<div class="card"><h2>${titleName}</h2><button class="primary" onclick="addList('${key}')">+ Добавить</button></div><div class="card">${S[key].map((x,i)=>`<div class="row"><span><b>${x.name}</b><small class="muted"> ${valKey}: ${x[valKey]}</small></span><span><button onclick="editList('${key}',${i})">Изменить</button><button class="danger" onclick="deleteList('${key}',${i})">Удалить</button></span></div>`).join('')}</div>`}
window.addList=(key)=>{S[key].push(key==='shop'?{name:'Новый товар',price:100}:{name:'Новый предмет',qty:1});save();renderEditor(key)};
window.deleteList=(key,i)=>{S[key].splice(i,1);save();renderEditor(key)};
window.editList=(key,i)=>{let x=S[key][i],n=prompt('Название',x.name);if(n===null)return;let v=prompt(key==='shop'?'Цена':'Количество',x[key==='shop'?'price':'qty']);if(v===null)return;x.name=n;x[key==='shop'?'price':'qty']=+v;save();renderEditor(key)};
function followersEditor(c){c.innerHTML=`<div class="card"><h2>Последователи</h2><button class="primary" onclick="addFollower()">+ Добавить</button></div><div class="card">${S.followers.map((x,i)=>`<div class="row"><span><b>${x.name}</b><small class="muted">${x.role} · Lv.${x.level}</small></span><button class="danger" onclick="deleteFollower(${i})">Удалить</button></div>`).join('')}</div>`}
window.addFollower=()=>{S.followers.push({name:'Новый герой',role:'Control',level:1});save();renderEditor('followers')};
window.deleteFollower=i=>{S.followers.splice(i,1);save();renderEditor('followers')};
function assetsEditor(c){c.innerHTML=`<div class="card"><h2>Арт</h2><p class="muted">Добавляй изображения. HOME-арт игры остаётся оригинальным.</p><input id="assetFile" type="file" accept="image/*" multiple onchange="addAssets(this.files)"></div><div class="card">${S.assets.map((a,i)=>`<div class="row"><span>${a.name}</span><button class="danger" onclick="deleteAsset(${i})">Удалить</button></div>`).join('')}</div>`}
window.addAssets=files=>{[...files].forEach(f=>{let r=new FileReader();r.onload=()=>{S.assets.push({name:f.name,data:r.result});save();renderEditor('assets')};r.readAsDataURL(f)})};
window.deleteAsset=i=>{S.assets.splice(i,1);save();renderEditor('assets')};
renderZones();
