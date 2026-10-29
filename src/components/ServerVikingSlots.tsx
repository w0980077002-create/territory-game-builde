import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Coins, Crown, FastForward, Loader2, Minus, Play, Plus, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { useGame } from '@/game/actions';
import { acceptMonopolyClaimReceipt, saveCloudSave, saveTokens } from '@/game/cloud';
import { fetchSlotsStatus, keepPendingSlots, readPendingSlots, SlotsRejected, submitSlotsAction, withSlotsDeadline, type PendingSlots, type SlotsAction, type SlotsStatus } from '@/game/slotsApi';
import { reelSpinTrail, SLOT_COIN_BET_CHOICES, SLOT_ICONS, SLOT_LINE_CHOICES, SLOT_PAYTABLE, type SlotGrid, type SlotSymbol } from '@/game/vikingSlots';
import './vikingSlots.css';
const root = import.meta.env.BASE_URL;
const START_GRID: SlotGrid = Array.from({length:5},()=>['gold','gem','sword'] as SlotSymbol[]);
// Each mobile reel keeps its starting three symbols, six travelling symbols,
// and the three server-confirmed landing symbols (9 instead of 18 images).
const LIVE_REEL_TRAIL = 3;
const LIVE_REEL_END_MS = 1_600;
const adjacentChoice = (choices: readonly number[], current: number, offset: number) =>
  choices[Math.max(0, Math.min(choices.length - 1, choices.indexOf(current) + offset))];

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
  const [bet,setBet]=useState(initial.state.bet || 5);
  const [auto,setAuto]=useState(0);
  const [tracks,setTracks]=useState<SlotGrid|null>(null);
  const [spinWaiting,setSpinWaiting]=useState(false);
  const [animation,setAnimation]=useState(0);
  const [lineIndex,setLineIndex]=useState(0);
  const lock=useRef(false);
  const animationTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const alive=useRef(true);
  const state=status.state;
  const field=state.outcome?.grid || START_GRID;
  const winnings=state.outcome?.lines || [];
  const visibleLine=winnings.length ? winnings[lineIndex%winnings.length] : null;
  const stakesLocked=busy || !!pending || !recovered || !!tracks || state.phase!=='ready' || auto>0;
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

  const command=async(request:SlotsAction,retry?:PendingSlots)=>{
    if (lock.current || !recovered || tracks || (pending&&!retry)) return;
    lock.current=true;setBusy(true);setError('');
    if (request.action==='spin') {setNotice('');setSpinWaiting(true);}
    const operation=retry || {id:crypto.randomUUID(),expected:state.revision,request};
    let committed=false;
    try {
      // Flush local game actions before changing the real hero wallet.
      if (!retry && (request.action==='spin' || request.action==='collect')) {
        const snapshot=useGame.get();
        // A stalled pre-save has NOT sent a wager. Fail promptly and allow a
        // normal retry; it is not the uncertain-RPC case that needs UUID replay.
        const saved=await withSlotsDeadline(saveCloudSave(userId,snapshot),8_000)
          .catch(cause=>{if(cause instanceof Error && cause.message==='slots_request_timeout')throw new SlotsRejected('slots_save_slow');throw cause;});
        if (!saved || useGame.get()!==snapshot)
          throw new SlotsRejected('slots_reload_required');
      }
      // Failure to persist prevents the RPC entirely.
      keepPendingSlots(userId,operation);setPending(operation);
      const receipt=await submitSlotsAction(operation);
      committed=true;
      if (receipt.success) {
        const installed=saveTokens.get(userId);
        // A replayed old receipt must not overwrite a newer cloud snapshot.
        if (!installed || !receipt.updated_at || Date.parse(receipt.updated_at)>=Date.parse(installed))
          acceptMonopolyClaimReceipt(userId,receipt);
      }
      const next=retry ? (await fetchSlotsStatus()) || receipt : receipt;
      if(!next.enabled)throw new Error('slots_unconfirmed');
      if (!alive.current) return;
      setStatus(next);setLineIndex(0);
      if(request.action==='risk')setNotice(next.state.riskWon ? (en?'Prize doubled!':'Приз удвоен!') : (en?'Risk lost. The prize was forfeited.':'Риск проигран. Приз сгорел.'));
      if(request.action==='super')setNotice((en?'Super treasure: +':'Суперсокровище: +')+(next.state.superAward||0)+' 🪙');
      if (!retry && request.action==='spin' && next.state.outcome) {
        const outcome=next.state.outcome;
        setTracks(field.map((column,i)=>[...column,...reelSpinTrail(i,outcome.stops?.[i] || 0,LIVE_REEL_TRAIL),...outcome.grid[i]]));
        setAnimation(n=>n+1);
        animationTimer.current=setTimeout(()=>{if(alive.current)setTracks(null);},LIVE_REEL_END_MS);
        if(next.state.phase==='bonus' || next.state.phase==='superbonus')setAuto(0);
      }
      keepPendingSlots(userId,null);setPending(null);
      if (request.action==='collect' && receipt.collected>0)
        setNotice(en?`+${receipt.collected} gold credited to your hero!`:`+${receipt.collected} золота зачислено персонажу!`);
    } catch(cause) {
      if (!alive.current) return;
      setAuto(0);
      if(cause instanceof SlotsRejected) {
        try {keepPendingSlots(userId,null);setPending(null);}catch{/* Keep the same safe replay marker. */}
        setError(cause.message.includes('slots_no_gold') ? (en?'Not enough gold.':'Недостаточно монет.') : cause.message.includes('slots_save_slow') ? (en?'Save is slow. No gold was staked. Please retry.':'Сохранение отвечает медленно. Ставка не списана. Повтори.') : cause.message.includes('slots_reload_required') ? (en?'Reload the game to synchronize your coins.':'Перезапусти игру для синхронизации монет.') : (en?'Action rejected. Refresh the server state.':'Действие отклонено. Обнови состояние сервера.'));
      } else setError(committed ? (en?'Action confirmed; recovery marker could not be cleared. Retry safely.':'Действие подтверждено, но отметка восстановления не удалена. Безопасно повтори.') : (en?'Result unconfirmed. Retry the saved operation.':'Результат не подтверждён. Повтори сохранённую операцию.'));
    } finally {lock.current=false;if(alive.current){setSpinWaiting(false);setBusy(false);}}
  };
  useEffect(()=>{
    if(!auto || busy || tracks || pending || !recovered || help) return;
    if(!['ready','decision'].includes(state.phase)){setAuto(0);return;}
    if(state.phase==='ready' && status.coins<lines*bet){setAuto(0);return;}
    const timer=setTimeout(()=>{
      if(state.phase==='decision')void command({action:'collect'});
      else {setAuto(n=>Math.max(0,n-1));void command({action:'spin',lines,bet});}
    },600);
    return ()=>clearTimeout(timer);
  },[auto,busy,tracks,pending,recovered,help,state.phase,status.coins,lines,bet]);
  const disabled=busy || !!pending || !recovered || !!tracks;
  const refresh=async()=>{
    if(lock.current)return;
    lock.current=true;setBusy(true);
    try {const fresh=await fetchSlotsStatus();if(!fresh?.enabled)throw new Error();setStatus(fresh);setError('');}
    catch {setError(en?'Server refresh failed. Your round is saved.':'Ошибка обновления. Раунд сохранён на сервере.');}
    finally {lock.current=false;setBusy(false);}
  };
  return <div className="vslot vslot-live" data-testid="viking-slots-server">
    <div className="vslot-heading"><button className="vslot-icon-button" onClick={onBack} aria-label={en?'Back':'Назад'}><ArrowLeft size={19}/></button><span className="vslot-heading-label">TERRITORY <span>✦</span> {en?'SLOT HALL':'ЗАЛ АВТОМАТОВ'}</span><button className="vslot-icon-button" onClick={()=>setHelp(v=>!v)} aria-label={en?'Paytable':'Таблица выплат'}><BookOpen size={19}/></button></div>
    <div className="vslot-marquee" style={{backgroundImage:`url('${root}slots/viking-casino-marquee.webp')`}}><div className="vslot-marquee-content"><Crown size={17}/><h1>{en?<>VIKING<br/>TREASURES</>:<>СОКРОВИЩА<br/>ВИКИНГОВ</>}</h1><span>{en?'FATE OF THE NORTH':'УДАЧА СЕВЕРА'}</span></div></div>
    <div className="vslot-stats"><div><small>{en?'CREDIT':'БАЛАНС'}</small><strong>{status.coins.toLocaleString()} <span className="vslot-coin" aria-hidden="true"/></strong></div><div><small>{en?'TOTAL BET':'СТАВКА'}</small><strong>{(lines*bet).toLocaleString()} <span className="vslot-coin" aria-hidden="true"/></strong></div><div className={state.pending>0?'vslot-stats--prize':''}><small>{en?'WIN':'ВЫИГРЫШ'}</small><strong className="vslot-gold">{state.pending.toLocaleString()} <span className="vslot-coin" aria-hidden="true"/></strong></div></div>
    <div className={'vslot-board '+(visibleLine&&!tracks?'vslot-board--winning':'')}><div className="vslot-line-marker" aria-hidden="true">{Array.from({length:state.lines||lines},(_,i)=><span key={i}>{i+1}</span>)}</div><div className={'vslot-reels '+(spinWaiting?'vslot-reels--confirming':'')} aria-label={en?'Five reels, three symbols each':'Пять барабанов по три символа'}>
      {field.map((reel,r)=><div className="vslot-reel-window" key={r}><div key={tracks?`${animation}-${r}`:`rest-${r}`} className={'vslot-reel-track '+(tracks?'vslot-reel-track--rolling vslot-reel-track--quick':'')} style={tracks?{animationDelay:r*60+'ms',animationDuration:680+r*145+'ms'}:undefined}>
        {(tracks?.[r] || reel).map((sym,row)=><div key={row} className={'vslot-symbol '+(!tracks&&visibleLine?.positions.some(([c,l])=>c===r&&l===row)?'vslot-symbol--win':'')}><img src={root+SLOT_ICONS[sym].image} alt={SLOT_ICONS[sym][en?'en':'ru']} draggable={false}/>{sym==='wild'&&<b>WILD</b>}{sym==='hero'&&<b>BONUS</b>}</div>)}
      </div></div>)}
      {visibleLine&&!tracks&&<svg className="vslot-win-path" viewBox="0 0 500 300" preserveAspectRatio="none" aria-hidden="true"><polyline points={visibleLine.positions.map(([c,r])=>`${c*100+50},${r*100+50}`).join(' ')} stroke="#ffde55" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>}
    </div><span className="vslot-board-caption" role="status">{spinWaiting?(en?'CONFIRMING WAGER…':'ПОДТВЕРЖДАЕМ СТАВКУ…'):tracks?(en?'SPINNING…':'ВРАЩЕНИЕ…'):`${state.lines||lines} ${en?'ACTIVE LINES':'АКТИВНЫХ ЛИНИЙ'}`}</span></div>
    <div className={'vslot-result '+(visibleLine&&!tracks?'vslot-result--win':'')} role="status">{visibleLine&&!tracks?<><Sparkles size={17}/><strong>{en?'WIN':'ПОБЕДА'} +{visibleLine.payout.toLocaleString()}</strong><span>{en?'Line':'Линия'} {visibleLine.number} · {lineIndex%winnings.length+1}/{winnings.length}</span></>:<><Sparkles size={14}/><span>{spinWaiting?(en?'WAGER IN PROGRESS':'СТАВКА ПОДТВЕРЖДАЕТСЯ'):tracks?(en?'GOOD LUCK!':'УДАЧИ!'):state.outcome?(en?'NEXT SPIN AWAITS':'СЛЕДУЮЩАЯ УДАЧА ЖДЁТ'):en?'SPIN TO WIN':'КРУТИ И ПОБЕЖДАЙ'}</span></>}</div>
    {notice&&<p className="vslot-notice" role="status">{notice}</p>}
    {error&&<p className="vslot-notice" role="alert">{error}</p>}
    {pending&&!busy&&<div className="vslot-recovery"><p>{en?'Connection interrupted. Your round is protected.':'Связь прервалась. Раунд сохранён.'}</p><button className="vslot-main w-full" disabled={!!tracks} onClick={()=>void command(pending.request,pending)}>{en?'RESTORE ROUND':'ВОССТАНОВИТЬ РАУНД'}</button></div>}
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
      <div className="vslot-bet-console">
        <div className="vslot-bet-control"><label>{en?'PAYLINES':'ЛИНИИ'}</label><div className="vslot-bet-stepper"><button aria-label={en?'Fewer lines':'Меньше линий'} disabled={stakesLocked||lines===SLOT_LINE_CHOICES[0]} onClick={()=>setLines(adjacentChoice(SLOT_LINE_CHOICES,lines,-1))}><Minus size={17}/></button><strong>{lines}</strong><button aria-label={en?'More lines':'Больше линий'} disabled={stakesLocked||lines===SLOT_LINE_CHOICES[SLOT_LINE_CHOICES.length-1]} onClick={()=>setLines(adjacentChoice(SLOT_LINE_CHOICES,lines,1))}><Plus size={17}/></button></div></div>
        <div className="vslot-bet-control"><label>{en?'GOLD PER LINE':'МОНЕТ / ЛИНИЮ'}</label><div className="vslot-bet-stepper"><button aria-label={en?'Lower gold per line':'Меньше монет на линию'} disabled={stakesLocked||bet===SLOT_COIN_BET_CHOICES[0]} onClick={()=>setBet(adjacentChoice(SLOT_COIN_BET_CHOICES,bet,-1))}><Minus size={17}/></button><strong>{bet}</strong><button aria-label={en?'Higher gold per line':'Больше монет на линию'} disabled={stakesLocked||bet===SLOT_COIN_BET_CHOICES[SLOT_COIN_BET_CHOICES.length-1]} onClick={()=>setBet(adjacentChoice(SLOT_COIN_BET_CHOICES,bet,1))}><Plus size={17}/></button></div></div>
      </div>
      <div className="vslot-machine-deck">
        <div className="vslot-deck-tools">
          <button className={'vslot-deck-tool vslot-deck-tool--auto '+(auto?'vslot-deck-tool--active':'')} aria-label={auto?(en?'STOP AUTO':'СТОП АВТО'):(en?'AUTO ×10':'АВТО ×10')} disabled={!auto&&(disabled||!['ready','decision'].includes(state.phase))} onClick={()=>setAuto(n=>n?0:10)}><Sparkles size={17}/><span>{auto?(en?'STOP':'СТОП'):(en?'AUTO':'АВТО')}<small>×{auto||10}</small></span></button>
          {state.phase==='decision'&&!tracks?<button className="vslot-deck-tool vslot-deck-tool--risk" aria-label={en?'RISK ×2':'РИСК ×2'} disabled={disabled||state.riskSteps>=5||auto>0} onClick={()=>{setAuto(0);void command({action:'risk_start'});}}><Sparkles size={17}/><span>{en?'RISK':'РИСК'}<small>×2</small></span></button>:tracks?<button className="vslot-deck-tool vslot-deck-tool--utility" aria-label={en?'SKIP':'ПРОПУСТИТЬ'} onClick={()=>{if(animationTimer.current)clearTimeout(animationTimer.current);setTracks(null);}}><FastForward size={19}/><span>{en?'SKIP':'ПРОПУСК'}</span></button>:<button className="vslot-deck-tool vslot-deck-tool--utility" aria-label={en?'REFRESH':'ОБНОВИТЬ'} disabled={busy} onClick={()=>{setAuto(0);void refresh();}}><RotateCcw size={18}/><span>{en?'SYNC':'ОБНОВИТЬ'}</span></button>}
        </div>
        {state.phase==='decision'&&!tracks?<button className="vslot-spin-key vslot-spin-key--collect" aria-label={(en?'COLLECT ':'ЗАБРАТЬ ')+state.pending} disabled={disabled} onClick={()=>void command({action:'collect'})}><Trophy size={24}/><span>{en?'COLLECT':'ЗАБРАТЬ'}</span><small>{state.pending.toLocaleString()}</small></button>:<button className="vslot-spin-key" aria-label={en?'SPIN':'КРУТИТЬ'} disabled={disabled||state.phase!=='ready'||status.coins<lines*bet||auto>0} onClick={()=>void command({action:'spin',lines,bet})}>{busy?<Loader2 className="animate-spin" size={24}/>:<Play size={24} fill="currentColor"/>}<span>{en?'SPIN':'КРУТИТЬ'}</span></button>}
      </div>
    </div>
    <p className="vslot-disclaimer"><Coins size={14}/>{en?'Each spin spends hero gold. Gold prizes are credited to the same wallet when collected. No cash payouts.':'Каждая прокрутка списывает монеты героя. Выигрыш зачисляется туда же после нажатия «Забрать». Денежных выплат нет.'}</p>
    {help&&<div className="vslot-help-backdrop" role="dialog" aria-modal="true" aria-label={en?'Rules':'Правила'}><div className="vslot-help"><h2>{en?'PAYTABLE AND RULES':'ТАБЛИЦА ВЫПЛАТ И ПРАВИЛА'}</h2><p>{en?'Match 3–5 symbols from either edge. One best win per active line. WILD substitutes; 3+ heroes start a bonus. Four heroes grant a shield.':'Собери 3–5 символов от любого края. Одна лучшая выплата на активную линию. WILD заменяет символы; 3+ героя открывают бонус. Четыре героя дают щит.'}</p><table><thead><tr><th>{en?'Symbol':'Символ'}</th><th>×3</th><th>×4</th><th>×5</th></tr></thead><tbody>{Object.entries(SLOT_PAYTABLE).map(([sym,pays])=><tr key={sym}><td>{SLOT_ICONS[sym as SlotSymbol][en?'en':'ru']}</td>{pays?.map((n,i)=><td key={i}>{n}×</td>)}</tr>)}</tbody></table><p>{en?'Payouts multiply the gold staked per line. Bonus: three treasures (1×, 2×, 3× total stake), a shield and a trap. Complete all five picks to unlock a 3×/5×/9× super chest. Risk doubles or forfeits the unclaimed prize, up to five times.':'Выплаты умножаются на ставку монет на линию. Бонус: три сокровища (1×, 2×, 3× полной ставки), щит и ловушка. Пройди пять попыток для суперсундука 3×/5×/9×. Риск удваивает или сжигает незабранный приз, не более пяти раз.'}</p><button onClick={()=>setHelp(false)}>{en?'CLOSE':'ЗАКРЫТЬ'}</button></div></div>}
  </div>;
}
