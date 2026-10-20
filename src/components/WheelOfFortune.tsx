import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/game/i18n';
import { FORTUNE_PRIZES, acknowledgeFortune, playFortune, recoverFortune, fortuneIndex, fortuneLabel, fortuneError, fortuneRotation, type FortuneReceipt, type FortuneStatus } from '@/game/fortune';
import { FortuneDialog } from './FortuneDialog';
import './fortune.css';
const base=import.meta.env.BASE_URL;
const colors=['#c92b14','#0861d0','#5520ba','#046ac3','#b01583','#5820bf','#08795c','#0e47b3','#0d9766','#253fbd','#b92332','#087d4a'];
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
 const xy=(a:number,r:number)=>[200+Math.cos(a*Math.PI/180)*r,200+Math.sin(a*Math.PI/180)*r];
 return <div className={`fortune-wheel-stage ${spinning?'is-spinning':''}`}>
  <img className="fortune-pointer" src={base+'fortune/approved-pointer.svg'} alt="" aria-hidden="true" draggable={false}/>
  <svg viewBox="0 0 400 400" className="fortune-wheel" role="img" aria-label={en?'Twelve prize sectors and golden lion medallion':'Двенадцать призовых секторов и золотой медальон льва'} style={{transform:`rotate(${rotation}deg)`,transitionDuration:reduced||!spinning?'0ms':'5200ms'}} onTransitionEnd={onDone}>
   <defs>
    <radialGradient id="fortune-sector-light" cx="50%" cy="50%" r="60%"><stop offset=".25" stopColor="#05082e" stopOpacity=".55"/><stop offset=".7" stopColor="#fff" stopOpacity="0"/><stop offset="1" stopColor="#030428" stopOpacity=".65"/></radialGradient>
    <linearGradient id="fortune-divider" x2="1" y2="1"><stop stopColor="#7e3c07"/><stop offset=".45" stopColor="#fff0a0"/><stop offset=".7" stopColor="#ffc52f"/><stop offset="1" stopColor="#8b3e03"/></linearGradient>
   </defs>
   <circle cx="200" cy="200" r="188" fill="#d99b22"/>
   {FORTUNE_PRIZES.map((p,i)=>{
    const a=xy(i*30-105,179),b=xy(i*30-75,179),c=xy(i*30-90,135),t=xy(i*30-90,103);
    const path=`M200 200 L${a.join(' ')} A179 179 0 0 1 ${b.join(' ')} Z`;
    return <g key={i} data-fortune-sector={i} data-prize={p.prize} data-quantity={p.quantity}>
     <path d={path} fill={colors[i]} stroke="url(#fortune-divider)" strokeWidth="3.5"/>
     <path d={path} fill="url(#fortune-sector-light)"/>
     <path d={`M${xy(i*30-101,167).join(' ')} A167 167 0 0 1 ${xy(i*30-79,167).join(' ')}`} fill="none" stroke="#fff1b4" strokeOpacity=".5" strokeWidth="1"/>
     <image href={base+p.icon} x={c[0]-23} y={c[1]-23} width="46" height="46"/>
     <text x={t[0]} y={t[1]+6} textAnchor="middle" fill="#fff8dc" stroke="#1c0b14" strokeWidth="3.5" paintOrder="stroke" fontSize={p.prize==='vip'?13:17} fontWeight="900">{p.prize==='vip'?(en?'1 DAY':'1 ДЕНЬ'):p.prize==='level'?'+1':p.quantity}</text>
    </g>;
   })}
   {/* This transparent illustrated layer contains only the carved rim and lion.
       Sector art and amounts above remain real, individually mapped SVG nodes. */}
   <image className="fortune-wheel-frame" href={base+'fortune/approved-wheel.webp'} x="0" y="0" width="400" height="400"/>
  </svg>
  <div className="fortune-wheel-aura" aria-hidden="true"/>
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
   if(index>=0)setRotation(old=>fortuneRotation(old,index));
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
 return <div className="fortune-screen" data-testid="wheel-of-fortune" style={{backgroundImage:`url(${base}fortune/approved-chamber.webp)`}}>
  <div className="fortune-toolbar">
   <strong className="fortune-ticket" aria-label={en?'Ticket balance':'Баланс билетов'}><img src={base+'fortune/ticket.svg'} alt=""/>{status?.tickets.toLocaleString(en?'en-US':'ru-RU')??'—'}</strong>
   <button className="fortune-rules" onClick={()=>setRules(true)}><span aria-hidden="true">?</span>{en?'Rules':'Правила'}</button>
  </div>
  <header className="fortune-title">
   <img src={base+(en?'fortune/approved-title-en.webp':'fortune/approved-title.webp')} width={896} height={450} alt="" aria-hidden="true" draggable={false}/>
   <h1 className="fortune-sr-only">{en?<>WHEEL OF<br/>FORTUNE</>:'КОЛЕСО ФОРТУНЫ'}</h1>
  </header>
  <Wheel rotation={rotation} spinning={spinning} reduced={reduced} en={en} onDone={()=>{if(spinning)done();}}/>
  <div className="fortune-controls">
   <button className="fortune-button fortune-spin" aria-label={busy?(en?'Connecting':'Связь с сервером'):spinning?(en?'Fortune is spinning':'Фортуна вращается'):(en?'SPIN — 1 TICKET':'КРУТИТЬ — 1 БИЛЕТ')} aria-busy={busy} disabled={busy||spinning||!!receipt||!status||!status.tickets||!!error} onClick={()=>void spin()} style={{backgroundImage:`url(${base}fortune/approved-spin-frame.webp)`}}>
    <span className={`fortune-spin__label ${busy||spinning?'fortune-spin__label--busy':''}`}>{busy?(en?'CONNECTING…':'СВЯЗЬ С СЕРВЕРОМ…'):spinning?(en?'SPINNING…':'ВРАЩАЕТСЯ…'):(en?'Spin':'Крутить')}</span>
    <span className="fortune-spin__cost" aria-hidden="true"><img src={base+'fortune/ticket.svg'} alt=""/> 1</span>
   </button>
   {spinning&&<button className="fortune-skip" onClick={done}>{en?'Skip animation':'Пропустить анимацию'}</button>}
   {status?.tickets===0&&<p>{en?'Collect +2 daily tickets in the Hall.':'Забери +2 ежедневных билета в зале.'}</p>}
   {error&&<p role="alert">{error} <button onClick={()=>void recover()} disabled={busy}>{en?'Recover':'Восстановить'}</button></p>}
   {status?.vip_until&&<p>{en?'Temporary VIP until':'Временный VIP до'} {new Date(status.vip_until).toLocaleString(en?'en-GB':'ru-RU')} ({Date.parse(status.vip_until)>Date.parse(status.server_now)?en?'active':'активен':en?'expired':'истёк'})</p>}
  </div>
  <section className="fortune-prizes" aria-label={en?'Possible prizes':'Возможные награды'}><h2>{en?'Possible prizes':'Возможные награды'}</h2><div tabIndex={0} role="region" aria-label={en?'Scroll through twelve prizes':'Прокрути список двенадцати наград'}>{FORTUNE_PRIZES.map((p,i)=><article key={i} title={en?p.en:p.ru}><PrizeArt prize={p.prize} quantity={p.quantity}/><small>{en?p.en:p.ru}</small></article>)}</div></section>
  <button className="fortune-back" onClick={onBack} disabled={busy||spinning}>‹ {en?'Game Hall':'В игровой зал'}</button>
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
