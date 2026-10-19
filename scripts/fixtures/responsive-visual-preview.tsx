// Offline visual fixture: mount REAL production screens, not hand-drawn mockups.
// No auth or database writes; generated only by scripts/build-responsive-visual-preview.mjs.
import {createRoot} from 'react-dom/client';
import {LanguageProvider, useLanguage} from '@/game/i18n';
import {createInitialGame} from '@/game/engine';
import {useGame} from '@/game/actions';
import {HomeScreen} from '@/components/HomeScreen';
import {InventoryScreen} from '@/components/InventoryScreen';
import {ForgeScreen} from '@/components/ForgeScreen';
import {ProfileScreen} from '@/components/ProfileScreen';
import {ShopScreen} from '@/components/ShopScreen';
import {MapScreen} from '@/components/MapScreen';
import {QuestsScreen} from '@/components/QuestsScreen';
import {GamesScreen} from '@/components/GamesScreen';
import type {AuthUser} from '@/game/auth';
import type {Equipment,InventoryItem} from '@/game/types';
import {useEffect} from 'react';

const params=new URLSearchParams(location.search);
const screen=params.get('screen')??'city';
const ios=params.get('platform')==='ios';
const language=params.get('language')==='en'?'en':'ru';
const sheet=Math.min(innerHeight,Number(params.get('sheet'))||innerHeight);
document.documentElement.classList.add('territory-telegram-webapp');
document.documentElement.classList.toggle('territory-ios-webapp',ios);
document.documentElement.style.setProperty('--territory-viewport-height',sheet+'px');
document.documentElement.style.setProperty('--territory-top-inset','0px');
document.documentElement.style.setProperty('--territory-bottom-inset','0px');

// Render fixtures must never communicate with production.
window.fetch=async()=>new Response(JSON.stringify({message:'Offline UI preview: no remote requests'}),{status:503,headers:{'Content-Type':'application/json'}});
const sword:Equipment={id:'visual-qa-sword',slot:'weapon',name:'Северный клинок искателя',icon:'⚔️',rarity:'epic',attack:38,defense:5,hp:12,critChance:3,level:3};
const helmet:Equipment={id:'visual-qa-helmet',slot:'helmet',name:'Шлем ярла',icon:'⛑️',rarity:'rare',attack:2,defense:16,hp:35,level:2};
const bag:InventoryItem={id:'visual-qa-bag',name:'Клинок небесного воителя',icon:'⚔️',type:'equipment',rarity:'legendary',qty:1,description:'Тестовый предмет только для проверки интерфейса',equipment:{...sword,id:'visual-qa-bag',name:'Клинок небесного воителя',level:4,rarity:'legendary'}};
const game=createInitialGame();
useGame.set({...game,player:{...game.player,name:'ДлинныйНикГероя_2026',level:25,gold:125430,gems:1050,redGems:77,equipped:{weapon:sword,helmet}},forgeMaterials:600,inventory:[...game.inventory,bag]});
const user:AuthUser={id:'11111111-1111-4111-8111-111111111111',telegramId:12345678,displayName:'Тестовый герой',photoUrl:null};

function Fixture(){
 const {setLanguage}=useLanguage();
 useEffect(()=>setLanguage(language),[setLanguage]);
 const screens:Record<string,JSX.Element>={
  city:<HomeScreen user={user} saveStatus="saved" questAlerts={{count:0,ready:0,newCount:0} as never} onOpen={()=>{}} onBattle={()=>{}} onInventory={()=>{}} notify={()=>{}}/>,
  equipment:<InventoryScreen initialTab="equipment" userId={user.id}/>,
  items:<InventoryScreen initialTab="items" userId={user.id}/>,
  forge:<ForgeScreen/>,
  profile:<ProfileScreen user={user}/>,
  shop:<ShopScreen/>,
  map:<MapScreen/>,
  quests:<QuestsScreen userId={user.id} onSocialStatusChange={()=>{}}/>,
  games:<GamesScreen userId={user.id} onPlay={()=>{}}/>,
 };
 return <div data-testid="offline-qa" data-screen={screen} className="territory-shell relative mx-auto flex w-full max-w-md flex-col overflow-hidden" style={{height:'var(--territory-viewport-height, 100dvh)',background:'var(--color-bg)'}}>
  <main data-testid="qa-main" className={'territory-screen min-h-0 min-w-0 flex-1 '+(screen==='city'?'territory-city-screen overflow-y-auto overflow-x-hidden':screen==='equipment'||screen==='items'?'overflow-hidden px-3 pt-3 pb-1':'overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide px-3 py-3')}>
   <div data-screen-root="true" className={screen==='city'||screen==='equipment'||screen==='items'?'h-full min-h-0':''}>{screens[screen]??screens.city}</div>
  </main>
  <nav data-testid="qa-nav" className="territory-nav z-30 shrink-0 border-t border-amber-500/25 bg-[#10141c] px-1 py-1">
   <div className="flex h-[60px] items-end gap-0.5">
    {['Город','Инвентарь','Герой','Бой','Карта','Игры','Клан'].map(label=><button type="button" key={label} className="nav-btn" aria-label={label}>
     <span className="text-lg">◆</span><span className="territory-nav-label text-[9px] font-bold">{label}</span>
    </button>)}
   </div>
  </nav>
 </div>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture/></LanguageProvider>);
