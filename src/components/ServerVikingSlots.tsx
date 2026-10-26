import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Crown, Loader2, Play, Shield, Sparkles, Ticket, Trophy } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { autoClaimHallGold } from '@/game/gameHall';
import { fetchSlotsStatus, keepPendingSlots, readPendingSlots, SlotsRejected, submitSlotsAction, type PendingSlots, type SlotsAction, type SlotsStatus } from '@/game/slotsApi';
import { reelSpinTrail, SLOT_BET_CHOICES, SLOT_ICONS, SLOT_LINE_CHOICES, SLOT_PAYTABLE, type SlotGrid, type SlotSymbol } from '@/game/vikingSlots';
import './vikingSlots.css';
const root = import.meta.env.BASE_URL;
const START_GRID: SlotGrid = Array.from({length:5},()=>['gold','gem','sword'] as SlotSymbol[]);

/** Missing/disabled reviewed installation keeps the explicitly labelled existing demo. */
export function SlotsGate({userId,onBack,demo}:{userId:string;onBack:()=>void;demo:ReactNode}) {
  const { language } = useLanguage(); const en = language==='en';
  const [status,setStatus] = useState<SlotsStatus|null|undefined>();
  const [error,setError] = useState('');
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    let active=true;
    setError('');
    void fetchSlotsStatus().then((value)=>{
      if (!active) return;
      // Never bury an uncertain real transaction behind a demo fallback.
      if (!value?.enabled && readPendingSlots(userId)) throw new Error('slots_pending_installation');
      setStatus(value);
    }).catch(()=>{if(active)setError(en?'Cannot verify the slot server. Retry to recover your round.':'Не удалось проверить сервер автомата. Повтори для восстановления раунда.');});
    return ()=>{active=false;};
  },[userId,attempt,en]);
  if (error) return <div className="vslot space-y-3"><button onClick={onBack}>{en?'Back':'Назад'}</button><p role="alert">{error}</p><button className="vslot-main w-full" onClick={()=>setAttempt(n=>n+1)}>{en?'Retry':'Повторить'}</button></div>;
  if (status===undefined) return <div className="vslot p-4"><Loader2 className="inline animate-spin"/> {en?'Restoring slot…':'Восстанавливаем автомат…'}</div>;
  if (!status?.enabled) return <>{demo}</>;
  return <ServerVikingSlots key={userId} userId={userId} onBack={onBack} initial={status}/>;
}

function ServerVikingSlots({userId,onBack,initial}:{userId:string;onBack:()=>void;initial:SlotsStatus}) {
  const { language } = useLanguage(); const en=language==='en';
  const [status,setStatus]=useState(initial);
  const [pending,setPending]=useState<PendingSlots|null>(null);
  const [recovered,setRecovered]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [help,setHelp]=useState(false);
  const [lines,setLines]=useState(initial.state.lines || 9);
  const [bet,setBet]=useState(initial.state.bet || 1);
  const [auto,setAuto]=useState(0);
  const [tracks,setTracks]=useState<SlotGrid|null>(null);
  const [animation,setAnimation]=useState(0);
  const [lineIndex,setLineIndex]=useState(0);
  const lock=useRef(false);
  const animationTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const alive=useRef(true);
  const state=status.state;
  const field=state.outcome?.grid || START_GRID;
  const winnings=state.outcome?.lines || [];
  const visibleLine=winnings.length ? winnings[lineIndex%winnings.length] : null;
  useEffect(()=>{
    alive.current=true;
    try {setPending(readPendingSlots(userId));setRecovered(true);}
    catch {setError(en?'Saved operation cannot be read. Trading locked.':'Не удалось прочитать сохранённую операцию. Игра заблокирована.');}
    return ()=>{alive.current=false;if(animationTimer.current)clearTimeout(animationTimer.current);};
  },[userId]);
  useEffect(()=>{
    if (winnings.length<2 || tracks) return;
    const timer=setInterval(()=>setLineIndex(i=>i+1),1400);
    return ()=>clearInterval(timer);
  },[winnings.length,tracks]);

  const settleHall=async(amount:number)=>{
    if (!amount) return;
    try {
      const gold=await autoClaimHallGold(userId,amount);
      if (alive.current && gold>0) setNotice(en?`+${gold} gold credited to your hero!`:`+${gold} золота зачислено персонажу!`);
    } catch {if(alive.current)setNotice(en?'Prize saved on the server. Return to the hall to complete the credit.':'Приз сохранён на сервере. Вернись в зал для зачисления.');}
  };
  useEffect(()=>{void settleHall(initial.hallPending);},[]);

  const command=async(request:SlotsAction,retry?:PendingSlots)=>{
    if (lock.current || !recovered || tracks || (pending&&!retry)) return;
    lock.current=true;setBusy(true);setError('');
    const operation=retry || {id:crypto.randomUUID(),expected:state.revision,request};
    let committed=false;
    try {
      // Failure to persist prevents the RPC entirely.
      keepPendingSlots(userId,operation);setPending(operation);
      const receipt=await submitSlotsAction(operation);
      committed=true;
      const next=retry ? (await fetchSlotsStatus()) || receipt : receipt;
      if(!next.enabled)throw new Error('slots_unconfirmed');
      if (!alive.current) return;
      setStatus(next);setLineIndex(0);
      if(request.action==='risk')setNotice(next.state.riskWon ? (en?'Prize doubled!':'Приз удвоен!') : (en?'Risk lost. The prize was forfeited.':'Риск проигран. Приз сгорел.'));
      if(request.action==='super')setNotice((en?'Super treasure: +':'Суперсокровище: +')+(next.state.superAward||0)+' 🪙');
      if (!retry && request.action==='spin' && next.state.outcome) {
        const outcome=next.state.outcome;
        setTracks(field.map((column,i)=>[...column,...reelSpinTrail(i,outcome.stops?.[i] || 0,12),...outcome.grid[i]]));
        setAnimation(n=>n+1);
        animationTimer.current=setTimeout(()=>{if(alive.current)setTracks(null);},2400);
        if(next.state.phase==='bonus' || next.state.phase==='superbonus')setAuto(0);
      }
      keepPendingSlots(userId,null);setPending(null);
      if(next.hallPending>0)await settleHall(next.hallPending);
    } catch(cause) {
      if (!alive.current) return;
      setAuto(0);
      if(cause instanceof SlotsRejected) {
        try {keepPendingSlots(userId,null);setPending(null);}catch{/* Keep the same safe replay marker. */}
        setError(cause.message.includes('slots_no_tickets') ? (en?'Not enough tickets.':'Недостаточно билетов.') : cause.message.includes('slots_claim_hall_first') ? (en?'Return to the hall to credit the saved gold, then collect the remainder.':'Вернись в зал для зачисления золота, затем забери остаток.') : (en?'Action rejected. Refresh the server state.':'Действие отклонено. Обнови состояние сервера.'));
      } else setError(committed ? (en?'Action confirmed; recovery marker could not be cleared. Retry safely.':'Действие подтверждено, но отметка восстановления не удалена. Безопасно повтори.') : (en?'Result unconfirmed. Retry the saved operation.':'Результат не подтверждён. Повтори сохранённую операцию.'));
    } finally {lock.current=false;if(alive.current)setBusy(false);}
  };
  useEffect(()=>{
    if(!auto || busy || tracks || pending || !recovered || help) return;
    if(!['ready','decision'].includes(state.phase)){setAuto(0);return;}
    if(state.phase==='ready' && status.tickets<lines*bet){setAuto(0);return;}
    const timer=setTimeout(()=>{
      if(state.phase==='decision')void command({action:'collect'});
      else {setAuto(n=>Math.max(0,n-1));void command({action:'spin',lines,bet});}
    },600);
    return ()=>clearTimeout(timer);
  },[auto,busy,tracks,pending,recovered,help,state.phase,status.tickets,lines,bet]);
  const disabled=busy || !!pending || !recovered || !!tracks;
  const refresh=async()=>{
    if(lock.current)return;
    lock.current=true;setBusy(true);
    try {const fresh=await fetchSlotsStatus();if(!fresh?.enabled)throw new Error();setStatus(fresh);setError('');await settleHall(fresh.hallPending);}
    catch {setError(en?'Server refresh failed. Your round is saved.':'Ошибка обновления. Раунд сохранён на сервере.');}
    finally {lock.current=false;setBusy(false);}
  };
  return <div className="vslot" data-testid="viking-slots-server">
    <div className="vslot-heading"><button className="vslot-icon-button" onClick={onBack} aria-label={en?'Back':'Назад'}><ArrowLeft size={18}/></button><div><span className="vslot-eyebrow">TERRITORY · {en?'GAME HALL':'ИГРОВОЙ ЗАЛ'}</span><h1>{en?'VIKING TREASURES':'СОКРОВИЩА ВИКИНГОВ'}</h1></div><button className="vslot-icon-button" onClick={()=>setHelp(v=>!v)} aria-label={en?'Paytable':'Таблица выплат'}><BookOpen size={18}/></button></div>
    <div className="vslot-preview-label"><Shield size={12}/>{en?'SERVER-VERIFIED TICKETS AND PRIZES':'БИЛЕТЫ И ПРИЗЫ ПОДТВЕРЖДАЕТ СЕРВЕР'}</div>
    <div className="vslot-art"><img src={root+'assets/territory/characters/heroes/female_warrior/idle.webp'} alt=""/><div><Crown size={25}/><strong>{en?'FATE OF THE NORTH':'УДАЧА СЕВЕРА'}</strong><span>{en?'Treasures, runes and legendary heroes':'Сокровища, руны и герои легенд'}</span></div><img src={root+'assets/territory/characters/bosses/northern_jarl/idle.webp'} alt=""/></div>
    <div className="vslot-stats"><div><small>{en?'TICKETS':'БИЛЕТЫ'}</small><strong>{status.tickets.toLocaleString()}</strong></div><div><small>{en?'STAKE':'СТАВКА'}</small><strong>{lines*bet} 🎟️</strong></div><div><small>{en?'PRIZE':'ПРИЗ'}</small><strong className="vslot-gold">{state.pending.toLocaleString()} 🪙</strong></div></div>
    <div className="vslot-board"><div className="vslot-line-marker">{Array.from({length:state.lines||lines},(_,i)=><span key={i}>{i+1}</span>)}</div><div className="vslot-reels" aria-label={en?'Five reels, three symbols each':'Пять барабанов по три символа'}>
      {field.map((reel,r)=><div className="vslot-reel-window" key={r}><div key={tracks?`${animation}-${r}`:`rest-${r}`} className={'vslot-reel-track '+(tracks?'vslot-reel-track--rolling':'')} style={tracks?{animationDelay:r*100+'ms',animationDuration:950+r*220+'ms'}:undefined}>
        {(tracks?.[r] || reel).map((sym,row)=><div key={row} className={'vslot-symbol '+(!tracks&&visibleLine?.positions.some(([c,l])=>c===r&&l===row)?'vslot-symbol--win':'')}><img src={root+SLOT_ICONS[sym].image} alt={SLOT_ICONS[sym][en?'en':'ru']} draggable={false}/>{sym==='wild'&&<b>WILD</b>}{sym==='hero'&&<b>BONUS</b>}</div>)}
      </div></div>)}
      {visibleLine&&!tracks&&<svg className="vslot-win-path" viewBox="0 0 500 300" preserveAspectRatio="none" aria-hidden="true"><polyline points={visibleLine.positions.map(([c,r])=>`${c*100+50},${r*100+50}`).join(' ')} stroke="#ffde55" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>}
    </div><span className="vslot-board-caption">{tracks?(en?'SPINNING…':'ВРАЩЕНИЕ…'):`${state.lines||lines} ${en?'ACTIVE LINES':'АКТИВНЫХ ЛИНИЙ'}`}</span></div>
    {visibleLine&&!tracks&&<div className="vslot-winning-lines"><Sparkles size={15}/>{en?'Line':'Линия'} {visibleLine.number} · +{visibleLine.payout} 🪙 ({lineIndex%winnings.length+1}/{winnings.length})</div>}
    {notice&&<p className="vslot-notice" role="status">{notice}</p>}
    {error&&<p className="vslot-notice" role="alert">{error}</p>}
    {pending&&<button className="vslot-main w-full" disabled={busy||!!tracks} onClick={()=>void command(pending.request,pending)}>{en?'SAFELY RETRY SAVED ACTION':'БЕЗОПАСНО ПОВТОРИТЬ ДЕЙСТВИЕ'}</button>}
    {!tracks&&['bonus','superbonus','risk'].includes(state.phase)&&<div className="vslot-adventure-backdrop"><section className="vslot-adventure" role="dialog" aria-modal="true" aria-label={en?'Bonus challenge':'Бонусная игра'}><div className="vslot-adventure-title"><Crown size={24}/>
      <h2>{state.phase==='bonus'?(en?'RUNE TREASURY':'РУННАЯ СОКРОВИЩНИЦА'):state.phase==='superbonus'?(en?'SUPER TREASURE':'СУПЕРСОКРОВИЩЕ'):(en?'CHOOSE YOUR FATE':'ИСПЫТАНИЕ УДАЧИ')}</h2></div>
      <p className="vslot-adventure-instruction">{state.phase==='bonus'?(en?`Picks left: ${state.picksLeft} · Shields: ${state.shields}`:`Попыток: ${state.picksLeft} · Щитов: ${state.shields}`):state.phase==='risk'?(en?'Two winning cards out of four. A loss forfeits the unclaimed prize.':'Две выигрышные карты из четырёх. Проигрыш сжигает незабранный приз.'):(en?'Choose one of three sealed chests.':'Выбери один из трёх закрытых сундуков.')}</p>
      <div className={'vslot-adventure-tiles '+(state.phase==='superbonus'?'vslot-adventure-tiles--three':state.phase==='risk'?'vslot-adventure-tiles--four':'')}>{Array.from({length:state.phase==='bonus'?5:state.phase==='superbonus'?3:4},(_,i)=>{
        const revealed=state.phase==='bonus'?state.revealed?.[i]:null;
        return <button className={'vslot-adventure-tile '+(revealed?'vslot-adventure-tile--chosen vslot-adventure-tile--revealed':'')} key={i} disabled={disabled || (state.phase==='bonus'&&state.opened.includes(i))} onClick={()=>void command({action:state.phase==='bonus'?'bonus':state.phase==='superbonus'?'super':'risk',choice:i})} aria-label={(en?'Choose ':'Выбрать ')+(i+1)}>
          <span className="vslot-adventure-glyph">{revealed?(revealed.kind==='treasure'?'💰':revealed.kind==='shield'?'🛡️':'☠️'):<img src={root+'slots/'+(state.phase==='bonus'?'rune-sealed.svg':state.phase==='superbonus'?'chest-sealed.svg':'card-sealed.svg')} alt="" className="h-full w-full object-contain"/>}</span><span>{revealed?(revealed.kind==='treasure'?' +'+revealed.payout:revealed.kind==='shield'?(en?'SHIELD':'ЩИТ'):(en?'TRAP':'ЛОВУШКА')):i+1}</span>
        </button>;
      })}</div>
      <div className="vslot-adventure-totals"><span>{en?'Prize':'Приз'}<b>{state.pending}</b></span>{state.phase==='bonus'&&<><span>{en?'Moves':'Ходы'}<b>{state.picksLeft}</b></span><span>{en?'Shields':'Щиты'}<b>{state.shields}</b></span></>}</div>
      {error&&<p className="vslot-adventure-feedback" role="alert">{error}</p>}
      {pending&&<button className="vslot-adventure-cta" disabled={busy} onClick={()=>void command(pending.request,pending)}>{en?'RETRY SAVED ACTION':'ПОВТОРИТЬ СОХРАНЁННОЕ ДЕЙСТВИЕ'}</button>}
      {state.phase==='bonus'&&state.pending>0&&<button className="vslot-secondary w-full" disabled={disabled} onClick={()=>void command({action:'collect'})}>{en?'Finish and collect':'Завершить и забрать'} {state.pending}</button>}
      <button className="vslot-adventure-subtle" onClick={onBack}>{en?'Return to hall · round is saved':'Вернуться в зал · раунд сохранён'}</button>
    </section></div>}
    <div className="vslot-controls">
      <div className="vslot-selection"><label>{en?'ACTIVE LINES':'ЛИНИИ'}</label><div>{SLOT_LINE_CHOICES.map(n=><button key={n} className={lines===n?'selected':''} disabled={disabled||state.phase!=='ready'||auto>0} onClick={()=>setLines(n)}>{n}</button>)}</div></div>
      <div className="vslot-selection"><label>{en?'TICKETS PER LINE':'БИЛЕТОВ НА ЛИНИЮ'}</label><div>{SLOT_BET_CHOICES.map(n=><button key={n} className={bet===n?'selected':''} disabled={disabled||state.phase!=='ready'||auto>0} onClick={()=>setBet(n)}>{n}</button>)}</div></div>
      {state.phase==='decision'?<div className="vslot-action-bar"><button className="vslot-main" disabled={disabled} onClick={()=>void command({action:'collect'})}><Trophy size={18}/>{en?'COLLECT':'ЗАБРАТЬ'} {state.pending}</button><button className="vslot-secondary" disabled={disabled||state.riskSteps>=5||auto>0} onClick={()=>{setAuto(0);void command({action:'risk_start'});}}><Sparkles size={18}/>{en?'RISK ×2':'РИСК ×2'}</button></div>:<div className="vslot-action-bar"><button className="vslot-main" disabled={disabled||state.phase!=='ready'||status.tickets<lines*bet||auto>0} onClick={()=>void command({action:'spin',lines,bet})}>{busy?<Loader2 className="animate-spin" size={18}/>:<Play size={18}/>} {en?'SPIN':'КРУТИТЬ'}</button><button className="vslot-secondary" disabled={!tracks} onClick={()=>{if(animationTimer.current)clearTimeout(animationTimer.current);setTracks(null);}}>{en?'SKIP':'ПРОПУСТИТЬ'}</button></div>}
      <div className="vslot-bottom-actions"><button disabled={!auto&&(disabled||!['ready','decision'].includes(state.phase))} onClick={()=>setAuto(n=>n?0:10)}>{auto?(en?'STOP AUTO ':'СТОП АВТО ')+auto:(en?'AUTO ×10':'АВТО ×10')}</button><button disabled={busy} onClick={()=>{setAuto(0);void refresh();}}>{en?'REFRESH':'ОБНОВИТЬ'}</button></div>
    </div>
    <p className="vslot-disclaimer"><Ticket size={14}/>{en?'Each spin spends the displayed ticket stake. Gold prizes are saved on the server. No cash payouts.':'Прокрутка списывает указанную ставку в билетах. Призы в золоте сохраняются на сервере. Денежных выплат нет.'}</p>
    {help&&<div className="vslot-help-backdrop" role="dialog" aria-modal="true" aria-label={en?'Rules':'Правила'}><div className="vslot-help"><h2>{en?'PAYTABLE AND RULES':'ТАБЛИЦА ВЫПЛАТ И ПРАВИЛА'}</h2><p>{en?'Match 3–5 symbols from either edge. One best win per active line. WILD substitutes; 3+ heroes start a bonus. Four heroes grant a shield.':'Собери 3–5 символов от любого края. Одна лучшая выплата на активную линию. WILD заменяет символы; 3+ героя открывают бонус. Четыре героя дают щит.'}</p><table><thead><tr><th>{en?'Symbol':'Символ'}</th><th>×3</th><th>×4</th><th>×5</th></tr></thead><tbody>{Object.entries(SLOT_PAYTABLE).map(([sym,pays])=><tr key={sym}><td>{SLOT_ICONS[sym as SlotSymbol][en?'en':'ru']}</td>{pays?.map((n,i)=><td key={i}>{n}×</td>)}</tr>)}</tbody></table><p>{en?'Payouts are in gold, multiplied by tickets per line. Bonus: three treasures (1×, 2×, 3× total stake), a shield and a trap. Complete all five picks to unlock a 3×/5×/9× super chest. Risk doubles or forfeits the unclaimed prize, up to five times.':'Выплаты в золоте умножаются на билеты на линию. Бонус: три сокровища (1×, 2×, 3× полной ставки), щит и ловушка. Пройди пять попыток для суперсундука 3×/5×/9×. Риск удваивает или сжигает незабранный приз, не более пяти раз.'}</p><button onClick={()=>setHelp(false)}>{en?'CLOSE':'ЗАКРЫТЬ'}</button></div></div>}
  </div>;
}
