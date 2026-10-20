import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/game/i18n';
import { FORTUNE_PRIZES, acknowledgeFortune, playFortune, recoverFortune, fortuneIndex, fortuneLabel, fortuneError, fortuneRotation, type FortuneReceipt, type FortuneStatus } from '@/game/fortune';
import { FortuneDialog } from './FortuneDialog';
import './fortune.css';
const base=import.meta.env.BASE_URL;
const colors=['#ab3114','#034f99','#2744ad','#086288','#8c1555','#632394','#107964','#62459d','#0e4d98','#a8790d','#7b185f','#187d72'];
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
function Wheel({rotation,spinning,reduced,onDone}:{rotation:number;spinning:boolean;reduced:boolean;onDone:()=>void}){
 const xy=(a:number,r:number)=>[200+Math.cos(a*Math.PI/180)*r,200+Math.sin(a*Math.PI/180)*r];
 return <div className={`fortune-wheel-stage ${spinning?'is-spinning':''}`}>
  <div className="fortune-pointer" aria-hidden="true">◆</div>
  <svg viewBox="0 0 400 400" className="fortune-wheel" role="img" aria-label="TERRITORY" style={{transform:`rotate(${rotation}deg)`,transitionDuration:reduced||!spinning?'0ms':'5200ms'}} onTransitionEnd={onDone}>
   <defs><radialGradient id="fortune-metal"><stop stopColor="#fff7b7"/><stop offset=".4" stopColor="#c88919"/><stop offset=".7" stopColor="#ffe985"/><stop offset="1" stopColor="#6a310b"/></radialGradient></defs>
   <circle cx="200" cy="200" r="197" fill="url(#fortune-metal)" stroke="#fff0a5" strokeWidth="2"/>
   {FORTUNE_PRIZES.map((p,i)=>{
    const a=xy(i*30-105,182),b=xy(i*30-75,182),c=xy(i*30-90,137),t=xy(i*30-90,100),gem=xy(i*30-105,190);
    return <g key={i}>
     <path d={`M200 200 L${a.join(' ')} A182 182 0 0 1 ${b.join(' ')} Z`} fill={colors[i]} stroke="#eac464" strokeWidth="2"/>
     <image href={base+p.icon} x={c[0]-21} y={c[1]-21} width="42" height="42"/>
     <text x={t[0]} y={t[1]+5} textAnchor="middle" fill="#fff6c6" stroke="#100c23" strokeWidth="3" paintOrder="stroke" fontSize="16" fontWeight="900">{p.prize==='vip'?'24h':p.prize==='level'?'+1':p.quantity}</text>
     <path d={`M${gem[0]} ${gem[1]-5} l5 5 -5 5 -5 -5 Z`} fill={i%2?'#d946ef':'#38bdf8'} stroke="#fff2a6"/>
    </g>;
   })}
   <circle cx="200" cy="200" r="53" fill="url(#fortune-metal)" stroke="#fff2b1" strokeWidth="3"/>
   <circle cx="200" cy="200" r="44" fill="#172b59" stroke="#d7a64a" strokeWidth="3"/>
   <text x="200" y="217" textAnchor="middle" fontSize="48">⚜</text>
   <circle cx="200" cy="200" r="184" fill="none" stroke="#ffd879" strokeWidth="3"/>
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
 return <div className="fortune-screen" data-testid="wheel-of-fortune" style={{backgroundImage:`linear-gradient(180deg,#110d2866,#100d2b33 35%,#090e27 88%),url(${base}hall-art/fortune-chamber.webp)`}}>
  <div className="fortune-toolbar"><button onClick={onBack} disabled={busy||spinning}>← {en?'Hall':'В зал'}</button><strong>🎟 {status?.tickets??'—'}</strong><button onClick={()=>setRules(true)}>{en?'Rules':'Правила'} ?</button></div>
  <header className="fortune-title"><span>✦ TERRITORY ✦</span><h1>{en?'WHEEL OF FORTUNE':'КОЛЕСО ФОРТУНЫ'}</h1><p>{en?'A treasure awaits your hero':'Сокровища ждут своего героя'}</p></header>
  <Wheel rotation={rotation} spinning={spinning} reduced={reduced} onDone={()=>{if(spinning)done();}}/>
  <div className="fortune-controls">
   <button className="fortune-button fortune-spin" disabled={busy||spinning||!!receipt||!status||!status.tickets||!!error} onClick={()=>void spin()}>{busy?(en?'CONNECTING…':'СВЯЗЬ С СЕРВЕРОМ…'):spinning?(en?'FORTUNE IS SPINNING…':'ФОРТУНА ВРАЩАЕТСЯ…'):(en?'SPIN — 1 TICKET':'КРУТИТЬ — 1 БИЛЕТ')}</button>
   {spinning&&<button className="fortune-skip" onClick={done}>{en?'Skip animation':'Пропустить анимацию'}</button>}
   {status?.tickets===0&&<p>{en?'Collect +2 daily tickets in the Hall.':'Забери +2 ежедневных билета в зале.'}</p>}
   {error&&<p role="alert">{error} <button onClick={()=>void recover()} disabled={busy}>{en?'Recover':'Восстановить'}</button></p>}
   {status?.vip_until&&<p>{en?'Temporary VIP until':'Временный VIP до'} {new Date(status.vip_until).toLocaleString(en?'en-GB':'ru-RU')} ({Date.parse(status.vip_until)>Date.parse(status.server_now)?en?'active':'активен':en?'expired':'истёк'})</p>}
  </div>
  <section className="fortune-prizes"><h2>{en?'Possible prizes':'Возможные награды'}</h2><div>{FORTUNE_PRIZES.map((p,i)=><article key={i}><PrizeArt prize={p.prize} quantity={p.quantity}/><small>{en?p.en:p.ru}</small></article>)}</div></section>
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
