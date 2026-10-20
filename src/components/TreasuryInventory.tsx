import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/game/i18n';
import { acknowledgeFortune, playFortune, recoverFortune, fortuneLabel, type FortuneAction, type FortuneStatus } from '@/game/fortune';
import { FortuneDialog } from './FortuneDialog';
import './fortune.css';
export function TreasuryInventory({userId}:{userId:string}){
 const {language}=useLanguage(),en=language==='en';
 const [state,setState]=useState<FortuneStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[opening,setOpening]=useState(false);
 const locked=useRef(false),timer=useRef<ReturnType<typeof setTimeout>>();
 const recover=async()=>{
  if(locked.current)return;locked.current=true;setBusy(true);
  try{setState(await recoverFortune(userId));setError('');}catch{setError(en?'Recover before opening another chest. Restart if your save changed on another device.':'Восстанови результат перед открытием сундука. Если сохранение изменилось на другом устройстве — перезапусти игру.');}
  finally{locked.current=false;setBusy(false);}
 };
 useEffect(()=>{void recover();return ()=>clearTimeout(timer.current);},[userId]);
 const open=async(kind:FortuneAction)=>{
  if(locked.current||state?.receipt||error)return;locked.current=true;setBusy(true);
  try{
   setState(await playFortune(userId,kind));setOpening(true);
   timer.current=setTimeout(()=>setOpening(false),window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:1600);
  }catch{setError(en?'Connection interrupted. Recover the existing operation.':'Связь прервана. Восстанови существующую операцию.');}
  finally{locked.current=false;setBusy(false);}
 };
 const close=async()=>{
  if(locked.current||!state?.receipt)return;locked.current=true;setBusy(true);
  try{setState(await acknowledgeFortune(userId,state.receipt.id));setError('');}catch{setError(en?'Retry confirmation.':'Повтори подтверждение.');}
  finally{locked.current=false;setBusy(false);}
 };
 return <section className="fortune-treasury" data-testid="treasury-inventory">
  <h2>✦ {en?'Your treasure':'Твои сокровища'} ✦</h2>
  <p>{en?'Open earned chests here — no ticket required. The rune challenge below is preserved.':'Открывай выигранные сундуки здесь — без билета. Испытание рун находится ниже.'}</p>
  <div className="fortune-chests">{([
   ['common','common-chest',en?'Common':'Обычный',state?.common],['rare','rare-chest',en?'Rare':'Редкий',state?.rare],['golden','golden-key',en?'Golden key':'Золотой ключ',state?.golden_key],
  ] as const).map(([kind,icon,label,count])=><button key={kind} disabled={busy||!!state?.receipt||!count||!!error} onClick={()=>void open(kind)}><img src={import.meta.env.BASE_URL+`fortune/${icon}.svg`} alt=""/><strong>{count??'—'}</strong><small>{label}</small><small>{en?'Open · free':'Открыть · бесплатно'}</small></button>)}</div>
  {error&&<p role="alert">{error}</p>}<button className="fortune-skip" disabled={busy} onClick={()=>void recover()}>{busy?(en?'Loading…':'Загрузка…'):(en?'Refresh / recover':'Обновить / восстановить')}</button>
  {state?.receipt&&<FortuneDialog title={opening?(en?'TREASURY OPENS…':'СОКРОВИЩНИЦА ОТКРЫВАЕТСЯ…'):(en?'YOUR REWARD':'ТВОЯ НАГРАДА')} onClose={()=>{if(!opening)void close();}}>
   <div className={`fortune-chest-reveal ${opening?'is-opening':''} ${state.receipt.action==='golden'?'is-golden':''}`} aria-hidden="true">{opening?'✦':'✨'}<img src={import.meta.env.BASE_URL+`fortune/${state.receipt.action==='golden'?'golden':state.receipt.action==='rare'?'rare':'common'}-chest.svg`} alt=""/></div>
   {!opening&&<h3>{state.receipt.refunded?(en?'Level 100 · ticket returned':'Уровень 100 · билет возвращён'):fortuneLabel(state.receipt,en)}</h3>}
   <p>{en?'Server-confirmed. Already credited.':'Подтверждено сервером. Уже зачислено.'}</p>{error&&<p role="alert">{error}</p>}
  </FortuneDialog>}
 </section>;
}
