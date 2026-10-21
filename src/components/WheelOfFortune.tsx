import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/game/i18n';
import { FORTUNE_PRIZES, acknowledgeFortune, playFortune, recoverFortune, fortuneIndex, fortuneLabel, fortuneError, fortuneRotation, type FortuneReceipt, type FortuneStatus } from '@/game/fortune';
import { FortuneDialog } from './FortuneDialog';
import './fortune.css';
const base=import.meta.env.BASE_URL;
// Presentation order of the original painting, clockwise from its top sector.
// Server order/weights and transaction logic remain unchanged.
const ORIGINAL_SLOT=[11,0,6,8,9,2,3,10,1,5,4,7] as const;
const ORIGINAL_LABELS=[
 [326,445,34,0],[426,419,36,0],[426,859,34,0],[224,750,32,0],
 [226,625,32,0],[644,526,32,0],[642,628,30,0],[231,529,28,0],
 [548,441,28,0],[548,822,30,0],[600,733,28,0],[307,820,23,20],
] as const;
function haptic(kind:'tick'|'win'){
 try{
  const tg=(window as unknown as {Telegram?:{WebApp?:{HapticFeedback?:{selectionChanged:()=>void;notificationOccurred:(s:string)=>void}}}}).Telegram?.WebApp?.HapticFeedback;
  if(kind==='tick')tg?.selectionChanged();else tg?.notificationOccurred('success');
 }catch{/* Older Telegram clients may omit haptics. */}
}
function PrizeArt({prize}:{prize:string;quantity:number}){
 const p=FORTUNE_PRIZES.find(p=>p.prize===prize);
 return p?<img src={base+p.icon} alt=""/>:<span>{prize==='materials'?'⚒️':'✦'}</span>;
}
function Wheel({rotation,spinning,reduced,onDone,en}:{rotation:number;spinning:boolean;reduced:boolean;onDone:()=>void;en:boolean}){
 return <div className={`fortune-wheel-stage ${spinning?'is-spinning':''}`}>
  <svg viewBox="0 0 720 720" className="fortune-wheel" role="img" aria-label={en?'Twelve original illustrated prize sectors and golden lion':'Двенадцать оригинальных призовых секторов и золотой лев'} style={{transform:`rotate(${rotation}deg)`,transitionDuration:reduced||!spinning?'0ms':'5200ms'}} onTransitionEnd={onDone}>
   <image className="fortune-original-wheel" href={base+'fortune/original-wheel.webp'} x="0" y="0" width="720" height="720"/>
   {FORTUNE_PRIZES.map((p,i)=>{
    const [sx,sy,size,tilt]=ORIGINAL_LABELS[i],x=sx-66,y=sy-235;
    return <g key={i} data-fortune-sector={i} data-angle-slot={ORIGINAL_SLOT[i]} data-prize={p.prize} data-quantity={p.quantity}>
     <title>{en?p.en:p.ru}</title>
     {p.prize==='stone'&&<image href={base+p.icon} x="507" y="312" width="82" height="82"/>}
     {/* VIP's original '1 ДЕНЬ' is already correct and is preserved pixel-for-pixel. */}
     {p.prize!=='vip'&&<text x={x} y={y} transform={tilt?`rotate(${tilt} ${x} ${y})`:undefined} textAnchor="middle" fill="#fff9e8" stroke="#211005" strokeWidth="4" paintOrder="stroke" fontFamily="Arial, sans-serif" fontSize={size} fontWeight="900">{p.prize==='level'?(en?'+1 LEVEL':'+1 УРОВЕНЬ'):p.quantity}</text>}
    </g>;
   })}
  </svg>
 </div>;
}
export function WheelOfFortune({userId,onBack}:{userId:string;onBack:()=>void}){
 const {language}=useLanguage(),en=language==='en';
 const [status,setStatus]=useState<FortuneStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [receipt,setReceipt]=useState<FortuneReceipt|null>(null),[reveal,setReveal]=useState(false),[rules,setRules]=useState(false);
 const [rotation,setRotation]=useState(0),[spinning,setSpinning]=useState(false);
 const mounted=useRef(true);
 const lock=useRef(false),timer=useRef<ReturnType<typeof setTimeout>>(),tick=useRef<ReturnType<typeof setInterval>>();
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const done=()=>{clearTimeout(timer.current);clearInterval(tick.current);setSpinning(false);setReveal(true);haptic('win');};
 const show=(data:FortuneStatus,animate:boolean)=>{
  if(!mounted.current)return;
  setStatus(data);setReceipt(data.receipt);
  if(data.receipt){
   const index=fortuneIndex(data.receipt);
   if(index>=0)setRotation(old=>fortuneRotation(old,ORIGINAL_SLOT[index]));
   if(animate&&!reduced){setSpinning(true);timer.current=setTimeout(done,5400);tick.current=setInterval(()=>haptic('tick'),220);}
   else{setReveal(true);haptic('win');}
  }
 };
 const recover=async()=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{show(await recoverFortune(userId),false);}catch{setError(en?'Connection interrupted. Recover the same transaction, or restart the app. No new spin will be sent.':'Связь прервана. Восстанови ту же операцию или перезапусти игру. Новый билет не списывается.');}
  finally{lock.current=false;setBusy(false);}
 };
 useEffect(()=>{mounted.current=true;void recover();return ()=>{mounted.current=false;clearTimeout(timer.current);clearInterval(tick.current);};},[userId]);
 const spin=async()=>{
  if(lock.current||receipt||spinning)return;lock.current=true;setBusy(true);setError('');
  try{show(await playFortune(userId,'spin'),true);}catch(cause){setError(fortuneError(cause,en));}
  finally{lock.current=false;setBusy(false);}
 };
 const close=async()=>{
  if(!receipt||lock.current)return;lock.current=true;setBusy(true);
  try{const next=await acknowledgeFortune(userId,receipt.id);setStatus(next);setReceipt(null);setReveal(false);setError('');}
  catch{setError(en?'Could not confirm receipt. Retry safely.':'Не удалось подтвердить получение. Повтори безопасно.');}
  finally{lock.current=false;setBusy(false);}
 };
 return <div className="fortune-screen" data-testid="wheel-of-fortune" style={{backgroundImage:`url(${base}fortune/original-floor.webp)`}}>
  <div className="fortune-original-scene" style={{backgroundImage:`url(${base}fortune/original-scene.webp)`}}>
   <div className="fortune-toolbar">
    <strong className="fortune-ticket" aria-label={en?'Ticket balance':'Баланс билетов'} style={{backgroundImage:`url(${base}fortune/original-ticket-panel.webp)`}}><span>{status?.tickets.toLocaleString(en?'en-US':'ru-RU')??'—'}</span></strong>
    <button className="fortune-rules" onClick={()=>setRules(true)} style={{backgroundImage:`url(${base}fortune/original-rules-panel.webp)`}}>{en?'Rules':'Правила'}</button>
   </div>
   <button className="fortune-back" aria-label={en?'Back to Game Hall':'В игровой зал'} onClick={onBack} disabled={busy||spinning}>‹</button>
   <header className="fortune-title">
    <img src={base+'fortune/original-title.webp'} width={447} height={235} alt="" aria-hidden="true" draggable={false}/>
    <h1 className="fortune-sr-only">{en?'WHEEL OF FORTUNE':'КОЛЕСО ФОРТУНЫ'}</h1>
   </header>
   <Wheel rotation={rotation} spinning={spinning} reduced={reduced} en={en} onDone={()=>{if(spinning)done();}}/>
   <img className="fortune-pointer" src={base+'fortune/original-pointer.webp'} width={108} height={124} alt="" aria-hidden="true" draggable={false}/>
   <div className="fortune-controls">
    <button className="fortune-button fortune-spin" aria-label={busy?(en?'Connecting':'Связь с сервером'):spinning?(en?'Fortune is spinning':'Фортуна вращается'):(en?'SPIN — 1 TICKET':'КРУТИТЬ — 1 БИЛЕТ')} aria-busy={busy} disabled={busy||spinning||!!receipt||!status||!status.tickets||!!error} onClick={()=>void spin()} style={{backgroundImage:`url(${base}fortune/original-spin-frame.webp)`}}>
     <span className={`fortune-spin__label ${busy||spinning?'fortune-spin__label--busy':''}`}>{busy?(en?'CONNECTING…':'СВЯЗЬ…'):spinning?(en?'SPINNING…':'ВРАЩАЕТСЯ…'):(en?'Spin':'Крутить')}</span>
     <span className="fortune-spin__cost" aria-hidden="true"><img src={base+'fortune/original-ticket.webp'} alt=""/> 1</span>
    </button>
   </div>
  </div>
  {spinning&&<button className="fortune-skip" onClick={done}>{en?'Skip animation':'Пропустить анимацию'}</button>}
  {status?.tickets===0&&<p className="fortune-status">{en?'Collect +2 daily tickets in the Hall.':'Забери +2 ежедневных билета в зале.'}</p>}
  {error&&<p className="fortune-status" role="alert">{error} <button onClick={()=>void recover()} disabled={busy}>{en?'Recover':'Восстановить'}</button></p>}
  <div className="fortune-scene-tail" aria-hidden="true">
   <div className="fortune-scene-tail__reflection" style={{backgroundImage:`url(${base}fortune/original-scene.webp)`}}/>
  </div>
  {rules&&<FortuneDialog title={en?'Rules & exact chances':'Правила и точные шансы'} onClose={()=>setRules(false)}>
   <p>{en?'One spin costs 1 standard ticket. Free and purchased tickets have identical chances. Sectors are illustrated equally; real odds are listed below.':'Одно вращение стоит 1 обычный билет. Бесплатные и купленные билеты имеют одинаковые шансы. Размеры секторов условные; реальные шансы указаны ниже.'}</p>
   <table><tbody>{FORTUNE_PRIZES.map((p,i)=><tr key={i}><td>{en?p.en:p.ru}</td><td>{(p.weight/100).toFixed(2)}%</td></tr>)}</tbody></table>
   <p>{en?'Open common and rare chests in Treasury inventory for free. One Golden Key opens one special golden chest, without a ticket. Health potion heals 50 HP; Strength grants +10 attack for one battle.':'Обычные и редкие сундуки открываются бесплатно в инвентаре Сокровищницы. Один золотой ключ открывает один особый золотой сундук без билета. Зелье восстанавливает 50 HP; эликсир даёт +10 атаки на один бой.'}</p>
   <p>{en?'VIP grants the existing tier-1 benefits for 24 hours from server payout. Further wins extend the remaining duration by 24 hours; permanent VIP is preserved.':'VIP даёт существующие преимущества 1-го ранга на 24 часа с момента начисления сервером. Повторная победа продлевает оставшееся время на 24 часа. Постоянный VIP сохраняется.'}</p>
   <p>{en?'+1 level grants one complete hero level with normal stat gains, keeping current XP (cleared at level 100). Maximum level: 100. If already level 100, this outcome refunds the ticket exactly once. You can spin again at the same base odds.':'+1 уровень — полный уровень героя с обычным повышением характеристик. Текущий опыт сохраняется (на 100-м обнуляется). Максимум: 100. Если герой уже 100-го уровня, при этом исходе билет возвращается ровно один раз. Можно вращать снова с теми же базовыми шансами.'}</p>
   <p>{en?'The server saves and awards your prize before animation. After an interruption, reopen Wheel or Treasury and press Recover. Never start a new transaction to retry an uncertain result.':'Сервер сохраняет и выдаёт приз до анимации. После обрыва связи открой Колесо или Сокровищницу и нажми «Восстановить». Повторяется та же операция, без второго списания и награды.'}</p>
  </FortuneDialog>}
  {reveal&&receipt&&<FortuneDialog title={receipt.refunded?(en?'TICKET RETURNED':'БИЛЕТ ВОЗВРАЩЁН'):receipt.prize==='level'?(en?'LEGENDARY REWARD!':'ЛЕГЕНДАРНАЯ НАГРАДА!'):receipt.prize==='vip'?(en?'INCREDIBLE LUCK!':'НЕВЕРОЯТНАЯ УДАЧА!'):(en?'CONGRATULATIONS!':'ПОЗДРАВЛЯЕМ!')} onClose={()=>void close()}>
   <div className={`fortune-reveal ${['level','vip','golden_key','rare'].includes(receipt.prize)?'fortune-reveal--rare':''}`}><PrizeArt prize={receipt.prize} quantity={receipt.quantity}/><h3>{receipt.refunded?(en?'Hero is already level 100':'Герой уже 100-го уровня'):fortuneLabel(receipt,en)}</h3><p>{receipt.refunded?(en?'No ticket was charged. Spin again.':'Билет не списан. Вращай снова.'):(en?'Already credited by the server':'Уже зачислено сервером')}</p></div>
   {error&&<p role="alert">{error}</p>}{busy&&<p>{en?'Confirming…':'Подтверждение…'}</p>}
  </FortuneDialog>}
 </div>;
}
