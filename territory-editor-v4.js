/* Territory Game Universal Editor V3 — integrated overlay */
(()=>{'use strict';
const ROOT='territoryUniversalEditorV3',KEY='territory-editor-v3';
const state=()=>{const t=window.TerritoryStore;if(t?.state){t.state.editor??={buttons:{},custom:[],enabled:true};return t.state.editor}
let s={buttons:{},custom:[],enabled:true};try{s=Object.assign(s,JSON.parse(localStorage.getItem(KEY)||'{}'))}catch{};return s};
const save=()=>{const s=state(),t=window.TerritoryStore;if(t?.state){t.state.editor=s;try{(t.saveNow||t.save||t.saveState)?.call(t,'editor-update')}catch{}}try{localStorage.setItem(KEY,JSON.stringify(s))}catch{}};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=e=>e.getAttribute('aria-label')||e.dataset.action||e.dataset.globalNav||e.dataset.screen||e.textContent.trim().replace(/\s+/g,' ').slice(0,45)||e.id||'Без названия';
const screenOf=e=>e.closest('.screen[id]')?.id||e.closest('[data-screen]')?.dataset.screen||'GLOBAL';
const isEditor=e=>e.closest('#'+ROOT)||e.id==='territoryEditorLauncherV3';
function collect(){
 const s=state(), seen=new Set(), els=[...document.querySelectorAll('button,[role=button],a,[onclick],[data-action],[data-target],[data-global-nav],[data-screen],[data-fj-nav],[data-pve-nav],.hz')];
 els.forEach((e,i)=>{if(isEditor(e))return;let id=e.dataset.teV3Id;if(!id){id=e.id?'dom:'+e.id:(e.dataset.action?'action:'+e.dataset.action+':'+i:'auto:'+screenOf(e)+':'+i);e.dataset.teV3Id=id}
 seen.add(id);s.buttons[id]??={id,label:label(e),screen:screenOf(e),enabled:true,kind:e.classList.contains('hz')?'hitzone':'control',action:{type:'native'},selector:`[data-te-v3-id="${CSS.escape(id)}"]`};
 s.buttons[id].label=label(e);s.buttons[id].screen=screenOf(e);s.buttons[id].kind=e.classList.contains('hz')?'hitzone':'control'});
 save();return [...seen].map(id=>s.buttons[id]);
}
function apply(){const s=state();document.querySelectorAll('[data-te-v3-id]').forEach(e=>{const b=s.buttons[e.dataset.teV3Id];if(!b)return;e.style.pointerEvents=b.enabled===false?'none':'';if(b.enabled===false)e.setAttribute('data-editor-disabled','1');else e.removeAttribute('data-editor-disabled')});removeBottomEditor();renderCustom()}
function removeBottomEditor(){
 const nav=document.getElementById('hardMobileNav');
 if(!nav)return;
 nav.querySelectorAll('button,a,[role=button]').forEach(e=>{const t=(e.textContent||'').trim().toLowerCase();if(t.includes('редактор')||t.includes('editor'))e.style.display='none'});
 document.querySelectorAll('[data-global-nav]').forEach(e=>{const t=(e.textContent||'').trim().toLowerCase();if(t.includes('редактор')||t.includes('editor'))e.style.display='none'});
}
function action(a){a??={type:'native'};if(a.type==='native')return;
 if(a.type==='selector')document.querySelector(a.value)?.click();
 if(a.type==='screen'){const v=a.value||'';const e=document.querySelector(v.startsWith('#')?v:'#'+v);if(e){document.querySelectorAll('.screen.active').forEach(x=>x.classList.remove('active'));e.classList.add('active');document.body.dataset.screen=e.id;document.dispatchEvent(new Event('territory:screen'))}else window.TerritoryNavigation?.navigate?.(v)}
 if(a.type==='event')window.dispatchEvent(new CustomEvent(a.value));
 if(a.type==='url')location.href=a.value;
}
function custom(){document.querySelectorAll('[data-te-v3-custom]').forEach(e=>e.remove());for(const b of state().custom.filter(x=>x.enabled!==false)){const e=document.createElement('button');e.dataset.teV3Custom=b.id;e.className='te-v3-custom';e.textContent=b.label;const r=b.rect||{left:40,top:40,width:20,height:7};Object.assign(e.style,{left:r.left+'%',top:r.top+'%',width:r.width+'%',height:r.height+'%'});e.onclick=()=>action(b.action);document.body.appendChild(e)}}
function build(){
 let r=document.getElementById(ROOT);if(r)return r;
 r=document.createElement('div');r.id=ROOT;r.innerHTML=`<div class="te-v3-bg"></div><section class="te-v3-panel">
 <header><div><b>КОНСТРУКТОР ИГРЫ</b><small>Все кнопки • все разделы • добавление с нуля</small></div><button id="teV3Close">×</button></header>
 <div class="te-v3-search"><input id="teV3Search" placeholder="🔎 Найти кнопку, раздел или действие..."></div>
 <nav><button data-tab="all">ВСЕ</button><button data-tab="home">ГЛАВНЫЙ ЭКРАН</button><button data-tab="sections">РАЗДЕЛЫ</button><button data-tab="create">＋ ДОБАВИТЬ</button><button data-tab="data">ДАННЫЕ</button></nav>
 <main id="teV3Body"></main></section>`;
 document.body.appendChild(r);r.querySelector('#teV3Close').onclick=close;r.querySelector('.te-v3-bg').onclick=close;r.querySelectorAll('[data-tab]').forEach(x=>x.onclick=()=>render(x.dataset.tab));r.querySelector('#teV3Search').oninput=()=>render(document.querySelector('#'+ROOT+' nav button.on')?.dataset.tab||'all');return r}
function render(tab='all'){
 const r=build(),body=r.querySelector('#teV3Body'),s=state();collect();r.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x.dataset.tab===tab));const term=(r.querySelector('#teV3Search').value||'').toLowerCase();
 if(tab==='create'){body.innerHTML=`<div class="te-v3-create"><button class="big" data-new>＋ СОЗДАТЬ НОВУЮ КНОПКУ</button><p>Создаётся независимая кнопка. Ты сам задаёшь название, действие и положение. Её можно выключить в любой момент.</p></div>`+s.custom.map(customCard).join('');bindCreate();return}
 if(tab==='data'){body.innerHTML=`<div class="te-v3-actions"><button data-export>Экспорт</button><button data-import>Импорт</button><button data-reset>Сбросить редактор</button></div><p>Настройки редактора: <code>window.TerritoryStore.state.editor</code></p><textarea readonly>${esc(JSON.stringify(s,null,2))}</textarea>`;bindData();return}
 let arr=collect().filter(b=>{if(tab==='home')return b.screen==='home';if(tab==='sections')return b.screen!=='home';return true}).filter(b=>(b.label+' '+b.id+' '+b.screen).toLowerCase().includes(term));
 const groups={};arr.forEach(b=>(groups[b.screen]??=[]).push(b));
 body.innerHTML=`<div class="te-v3-actions"><button data-refresh>↻ Обновить всё</button><button data-all-on>Включить всё</button><button data-all-off>Выключить всё</button></div>
 <p>Найдено: <b>${arr.length}</b>. Скрытые разделы тоже учитываются — не только то, что сейчас видно на экране.</p>`+
 Object.entries(groups).map(([screen,items])=>`<section class="te-v3-group"><h3>${screen==='GLOBAL'?'ОБЩИЕ ЭЛЕМЕНТЫ':'ЭКРАН: '+esc(screen)} <span>${items.length}</span></h3>${items.map(card).join('')}</section>`).join('');
 bindButtons();
}
function card(b){return `<article class="te-v3-card"><div class="top"><div><b>${esc(b.label)}</b><small>${esc(b.kind)} • ${esc(b.id)}</small></div><label class="switch"><input type=checkbox data-enable="${esc(b.id)}" ${b.enabled!==false?'checked':''}><i></i></label></div>
 <div class="fields"><label>Название<input data-label="${esc(b.id)}" value="${esc(b.label)}"></label>
 <label>Действие<select data-type="${esc(b.id)}">${['native','selector','screen','event','url'].map(t=>`<option ${b.action?.type===t?'selected':''}>${t}</option>`).join('')}</select></label>
 <label class="wide">Значение действия<input data-value="${esc(b.id)}" value="${esc(b.action?.value||'')}" placeholder="selector / #screen / event / URL"></label></div>
 <button data-show="${esc(b.id)}">Показать на экране</button></article>`}
function customCard(b){return `<article class="te-v3-card"><div class=top><div><b>${esc(b.label)}</b><small>НОВАЯ • ${esc(b.id)}</small></div><label class=switch><input type=checkbox data-cen="${b.id}" ${b.enabled!==false?'checked':''}><i></i></label></div><div class=fields><label>Название<input data-clabel="${b.id}" value="${esc(b.label)}"></label><label>Действие<select data-ctype="${b.id}">${['native','selector','screen','event','url'].map(t=>`<option ${b.action?.type===t?'selected':''}>${t}</option>`).join('')}</select></label><label class=wide>Значение<input data-cvalue="${b.id}" value="${esc(b.action?.value||'')}></label></div><div class=coords><label>X<input type=number data-cr="${b.id}" data-k=left value="${b.rect?.left??40}"></label><label>Y<input type=number data-cr="${b.id}" data-k=top value="${b.rect?.top??40}"></label><label>W<input type=number data-cr="${b.id}" data-k=width value="${b.rect?.width??20}"></label><label>H<input type=number data-cr="${b.id}" data-k=height value="${b.rect?.height??7}"></label></div><button data-del="${b.id}">Удалить</button></article>`}
function bindButtons(){const r=build(),s=state();r.querySelectorAll('[data-enable]').forEach(e=>e.onchange=()=>{s.buttons[e.dataset.enable].enabled=e.checked;save();apply()});r.querySelectorAll('[data-label]').forEach(e=>e.onchange=()=>{s.buttons[e.dataset.label].label=e.value;save()});r.querySelectorAll('[data-type]').forEach(e=>e.onchange=()=>{s.buttons[e.dataset.type].action.type=e.value;save()});r.querySelectorAll('[data-value]').forEach(e=>e.onchange=()=>{s.buttons[e.dataset.value].action.value=e.value;save()});r.querySelectorAll('[data-show]').forEach(e=>e.onclick=()=>{const el=document.querySelector(`[data-te-v3-id="${CSS.escape(e.dataset.show)}"]`);close();el?.scrollIntoView({behavior:'smooth',block:'center'});if(el){el.classList.add('te-v3-focus');setTimeout(()=>el.classList.remove('te-v3-focus'),1400)}});r.querySelector('[data-refresh]')?.addEventListener('click',()=>render('all'));r.querySelector('[data-all-on]')?.addEventListener('click',()=>{Object.values(s.buttons).forEach(b=>b.enabled=true);save();apply();render('all')});r.querySelector('[data-all-off]')?.addEventListener('click',()=>{Object.values(s.buttons).forEach(b=>b.enabled=false);save();apply();render('all')})}
function bindCreate(){const r=build(),s=state();r.querySelector('[data-new]').onclick=()=>{s.custom.push({id:'custom-'+Date.now().toString(36),label:'Новая кнопка',enabled:true,rect:{left:40,top:40,width:20,height:7},action:{type:'native'}});save();render('create')};r.querySelectorAll('[data-cen]').forEach(e=>e.onchange=()=>{s.custom.find(x=>x.id===e.dataset.cen).enabled=e.checked;save();custom()});r.querySelectorAll('[data-clabel]').forEach(e=>e.onchange=()=>{s.custom.find(x=>x.id===e.dataset.clabel).label=e.value;save();custom()});r.querySelectorAll('[data-ctype]').forEach(e=>e.onchange=()=>{s.custom.find(x=>x.id===e.dataset.ctype).action.type=e.value;save()});r.querySelectorAll('[data-cvalue]').forEach(e=>e.onchange=()=>{s.custom.find(x=>x.id===e.dataset.cvalue).action.value=e.value;save()});r.querySelectorAll('[data-cr]').forEach(e=>e.onchange=()=>{let b=s.custom.find(x=>x.id===e.dataset.cr);b.rect[e.dataset.k]=Number(e.value);save();custom()});r.querySelectorAll('[data-del]').forEach(e=>e.onclick=()=>{s.custom=s.custom.filter(x=>x.id!==e.dataset.del);save();render('create')})}
function bindData(){const r=build();r.querySelector('[data-export]').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(state(),null,2)],{type:'application/json'}));a.download='territory-editor-v3.json';a.click()};r.querySelector('[data-import]').onclick=()=>{const i=document.createElement('input');i.type='file';i.accept='.json';i.onchange=async()=>{try{Object.assign(state(),JSON.parse(await i.files[0].text()));save();apply();render('data')}catch(e){alert('Ошибка JSON')}};i.click()};r.querySelector('[data-reset]').onclick=()=>{if(confirm('Сбросить настройки редактора?')){try{localStorage.removeItem(KEY)}catch{};if(window.TerritoryStore?.state)delete window.TerritoryStore.state.editor;location.reload()}}}
function open(){collect();apply();build().classList.add('open');render('all')}
function close(){document.getElementById(ROOT)?.classList.remove('open')}
function launcher(){/* V4: no extra button. Existing HOME gear opens the editor. */}
function init(){collect();apply();custom();if(location.hash==='#editor')open();addEventListener('hashchange',()=>location.hash==='#editor'&&open());new MutationObserver(()=>{removeBottomEditor();collect();apply()}).observe(document.body,{childList:true,subtree:true})}
document.readyState==='loading'?addEventListener('DOMContentLoaded',init,{once:true}):init();
window.TerritoryEditorV3={open,close,collect,apply,state};
})();