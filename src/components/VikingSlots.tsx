import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Crown, FastForward, Play, RotateCcw, Shield, Sparkles, Ticket, Trophy, Volume2, VolumeX, Vibrate } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { hapticImpact } from '@/game/telegram';
import { reelSpinTrail, SLOT_BET_CHOICES, SLOT_ICONS, SLOT_LINE_CHOICES, SLOT_PAYTABLE, spinVikingSlots, type SlotGrid, type SlotOutcome, type SlotSymbol } from '@/game/vikingSlots';
import { prepareBonusTiles, prepareSuperChests, prepareRiskCards, resolveBonusTile, type BonusTile, type SuperChest, type RiskCard } from '@/game/slotAdventure';
import { loadSlotDemo, saveSlotDemo, type SlotDemoState } from '@/game/slotDemoSave';
import './vikingSlots.css';

const root = import.meta.env.BASE_URL;
const INITIAL_BALANCE = 500;
// Each reel travels across twelve actual symbols before landing on three results.
const FILLER_PER_REEL = 12;
const REEL_SPIN_MS = 2320;
type Phase = 'ready' | 'spinning' | 'decision' | 'bonus' | 'bonus-ended' | 'bonus-complete' | 'risk' | 'risk-reveal' | 'superbonus' | 'superbonus-reveal';
const START_GRID: SlotGrid = [
  ['helmet','gem','gold'],['follower','wild','sword'],['boss','hero','gold'],
  ['wolf','gem','helmet'],['sword','gold','follower'],
];

/** Preview-only slot; never submits a wallet transaction or pays real game currency. */
export function VikingSlots({ onBack, userId }: { onBack: () => void; userId: string }) {
  const restored = useMemo(() => loadSlotDemo(userId), [userId]);
  const { language } = useLanguage();
  const en = language === 'en';
  const [balance, setBalance] = useState(restored?.balance ?? INITIAL_BALANCE);
  const [lines, setLines] = useState<(typeof SLOT_LINE_CHOICES)[number]>(restored?.lines ?? 9);
  const [bet, setBet] = useState<(typeof SLOT_BET_CHOICES)[number]>(restored?.bet ?? 1);
  const [field, setField] = useState<SlotGrid>(restored?.field ?? START_GRID);
  const [reelTracks, setReelTracks] = useState<SlotSymbol[][] | null>(null);
  const [spinSerial, setSpinSerial] = useState(0);
  const [phase, setPhase] = useState<Phase>(restored?.phase ?? 'ready');
  const [pending, setPending] = useState(restored?.pending ?? 0);
  const [recent, setRecent] = useState<SlotOutcome | null>(restored?.recent ?? null);
  const [auto, setAuto] = useState(0);
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState('');
  const [bonusLeft, setBonusLeft] = useState(restored?.bonusLeft ?? 5);
  const [bonusShield, setBonusShield] = useState(restored?.bonusShield ?? 0);
  const [bonusLog, setBonusLog] = useState<string[]>([]);
  const [riskSteps, setRiskSteps] = useState(restored?.riskSteps ?? 0);
  const [bonusDeck, setBonusDeck] = useState<BonusTile[]>(restored?.bonusDeck ?? []);
  const [bonusOpened, setBonusOpened] = useState<number[]>(restored?.bonusOpened ?? []);
  const [superDeck, setSuperDeck] = useState<SuperChest[]>(restored?.superDeck ?? []);
  const [superOpened, setSuperOpened] = useState<number | null>(restored?.superOpened ?? null);
  const [riskDeck, setRiskDeck] = useState<RiskCard[]>(restored?.riskDeck ?? []);
  const [riskOpened, setRiskOpened] = useState<number | null>(restored?.riskOpened ?? null);
  const [winningLineIndex, setWinningLineIndex] = useState(0);
  const [soundOn, setSoundOn] = useState(restored?.soundOn ?? false);
  const [hapticsOn, setHapticsOn] = useState(restored?.hapticsOn ?? false);
  const audioRef = useRef<AudioContext | null>(null);
  const openedRef = useRef(new Set<number>(restored?.bonusOpened ?? []));
  const activeSpin = useRef<SlotOutcome | null>(null);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinLock = useRef(false);
  const wager = lines * bet;
  useEffect(() => {
    const snapshot: SlotDemoState = {
      balance,lines,bet,phase,wagerAtSpin:wager,pending,field,recent,
      bonusLeft,bonusShield,bonusDeck,bonusOpened,superDeck,superOpened,
      riskDeck,riskOpened,riskSteps,auto:0,soundOn,hapticsOn,
    };
    saveSlotDemo(userId,snapshot);
  },[userId,balance,lines,bet,phase,wager,pending,field,recent,bonusLeft,bonusShield,
    bonusDeck,bonusOpened,superDeck,superOpened,riskDeck,riskOpened,riskSteps,soundOn,hapticsOn]);

  const visibleLine = recent?.lines[winningLineIndex % (recent?.lines.length || 1)];
  const winningPositions = useMemo(() => new Set(
    (visibleLine?.positions ?? []).map(([r,c]) => r + ':' + c),
  ), [visibleLine]);
  const linePoints = visibleLine
    ? visibleLine.positions.slice().sort((a,b) => a[0]-b[0]).map(([col,row]) => (col*100+50) + ',' + (row*100+50)).join(' ')
    : '';
  useEffect(() => () => {
    if (spinTimer.current) clearTimeout(spinTimer.current);
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) void audio.close().catch(()=>{});
  }, []);
  const playTone = useCallback((hz: number) => {
    if (!soundOn || typeof window.AudioContext !== 'function') return;
    try {
      const audio = audioRef.current ?? new window.AudioContext();
      audioRef.current = audio;
      if (audio.state === 'suspended') void audio.resume().catch(()=>{});
      const note = audio.createOscillator();
      const volume = audio.createGain();
      note.type = 'sine';
      note.frequency.setValueAtTime(hz,audio.currentTime);
      volume.gain.setValueAtTime(0.0001,audio.currentTime);
      volume.gain.exponentialRampToValueAtTime(0.055,audio.currentTime+0.015);
      volume.gain.exponentialRampToValueAtTime(0.0001,audio.currentTime+0.16);
      note.connect(volume); volume.connect(audio.destination);
      note.start(); note.stop(audio.currentTime+0.17);
    } catch { /* Audio is optional; do not interrupt the game. */ }
  },[soundOn]);
  const touchFeedback = useCallback((heavy = false) => {
    if (!hapticsOn) return;
    try { hapticImpact(heavy ? 'medium' : 'light'); } catch { /* unsupported Telegram client */ }
  },[hapticsOn]);
  useEffect(() => {
    if (phase !== 'spinning') return;
    const timers = [0,1,2,3,4].map(i => setTimeout(() => {
      playTone(330 + i*45);
      touchFeedback(false);
    },950 + i*320));
    return () => timers.forEach(clearTimeout);
  },[phase,playTone,touchFeedback,spinSerial]);
  // Reuse decoded assets to prevent empty tiles on the first reel spin.
  useEffect(() => {
    const images = Object.values(SLOT_ICONS).map(({image}) => {
      const img = new Image(); img.src = root + image; return img;
    });
    return () => { images.forEach(img => { img.onload = null; }); };
  }, []);
  useEffect(() => {
    if (!recent || recent.lines.length <= 1 || phase === 'spinning') return;
    const timer = setInterval(() => setWinningLineIndex(v => (v + 1) % recent.lines.length), 1250);
    return () => clearInterval(timer);
  }, [recent,phase]);

  const finishSpin = useCallback(() => {
    const outcome = activeSpin.current;
    activeSpin.current = null;
    spinTimer.current = null;
    spinLock.current = false;
    if (!outcome) return;
    setField(outcome.grid);
    setReelTracks(null);
    playTone(outcome.payout>0 ? 810 : 280);
    if (outcome.payout>0 || outcome.bonusSymbols >= 3) touchFeedback(true);
    setRecent(outcome);
    setPending(outcome.payout);
    setRiskSteps(0);
    setWinningLineIndex(0);
    if (outcome.bonusSymbols >= 3) {
      setAuto(0);
      setBonusLeft(5);
      setBonusShield(outcome.bonusSymbols >= 4 ? 1 : 0);
      setBonusLog([]);
      setBonusOpened([]);
      openedRef.current = new Set();
      // Sealed prizes are assigned to locations BEFORE players pick a rune.
      setBonusDeck(prepareBonusTiles(wager));
      setNotice(en ? 'Hero symbols! Treasure quest unlocked.' : 'Герои на барабанах! Бонусная сокровищница открыта!');
      setPhase('bonus');
    } else if (outcome.payout > 0) {
      setNotice(en ? 'Winning lines: ' + outcome.lines.length : 'Выигрышных линий: ' + outcome.lines.length);
      setPhase('decision');
    } else {
      setNotice(en ? 'No winning combination.' : 'Без выигрыша. Попробуй ещё!');
      setPhase('ready');
    }
  }, [en,wager,playTone,touchFeedback]);

  const spin = useCallback(() => {
    if (phase !== 'ready' || spinLock.current || balance < wager || wager <= 0) return;
    spinLock.current = true;
    playTone(280);
    touchFeedback();
    setBalance(v => v - wager);
    setPending(0);
    setRecent(null);
    setNotice('');
    const outcome = spinVikingSlots(lines, bet);
    activeSpin.current = outcome;
    setReelTracks(field.map((column, index) => [
      ...column,
      ...reelSpinTrail(index,outcome.stops?.[index] ?? 0,FILLER_PER_REEL),
      ...outcome.grid[index],
    ]));
    setSpinSerial(v => v + 1);
    setPhase('spinning');
    // Last reel stops at 2230 ms, then finalize exactly the server-independent demo result.
    spinTimer.current = setTimeout(finishSpin, REEL_SPIN_MS);
  }, [phase,balance,wager,lines,bet,field,finishSpin,playTone,touchFeedback]);
  const skip = () => {
    if (phase !== 'spinning') return;
    if (spinTimer.current) clearTimeout(spinTimer.current);
    finishSpin();
  };
  const take = useCallback(() => {
    if (phase !== 'decision') return;
    setBalance(v => v + pending);
    setPending(0);
    setPhase('ready');
  }, [phase,pending]);
  useEffect(() => {
    if (auto <= 0 || help || !['ready','decision'].includes(phase)) return;
    const timer = setTimeout(() => {
      if (phase === 'decision') take();
      else if (balance >= wager) {
        setAuto(v => Math.max(0,v-1));
        spin();
      } else {
        setAuto(0);
        setNotice(en ? 'Not enough demo coins.' : 'Не хватает демонстрационных монет.');
      }
    },phase === 'decision' ? 550 : 420);
    return () => clearTimeout(timer);
  },[auto,phase,help,balance,wager,spin,take,en]);
  const pickBonus = (choice:number) => {
    if (phase !== 'bonus' || choice < 0 || choice >= bonusDeck.length || openedRef.current.has(choice)) return;
    openedRef.current.add(choice);
    const tile = bonusDeck[choice];
    playTone(tile.kind === 'trap' ? 190 : tile.kind === 'shield' ? 480 : 675);
    touchFeedback(tile.kind === 'treasure');
    const outcome = resolveBonusTile({picksLeft:bonusLeft,shields:bonusShield,total:pending},tile);
    setBonusOpened(v => [...v,choice]);
    setPending(outcome.next.total);
    setBonusShield(outcome.next.shields);
    setBonusLeft(outcome.next.picksLeft);
    const message = tile.kind === 'treasure'
      ? (en ? 'Treasure +' : 'Сокровище +') + outcome.credited
      : tile.kind === 'shield'
        ? (en ? 'Protective shield found!' : 'Найден защитный щит!')
        : outcome.blockedTrap
          ? (en ? 'A shield blocked the trap!' : 'Щит защитил от ловушки!')
          : (en ? 'Trap! The quest ends.' : 'Ловушка! Поход завершён.');
    setBonusLog(v => [...v,message]);
    if (outcome.endedByTrap) {
      setPhase('bonus-ended');
    } else if (outcome.superReady) {
      // This choice is sealed, too: picking another chest changes the payout.
      setSuperDeck(prepareSuperChests(wager));
      setSuperOpened(null);
      setPhase('bonus-complete');
    }
  };
  const finishBonus = () => setPhase(pending > 0 ? 'decision' : 'ready');
  const takeSuper = (choice:number) => {
    if (phase !== 'superbonus' || superOpened !== null || choice < 0 || choice >= superDeck.length) return;
    const prize = superDeck[choice].payout;
    playTone(880);
    touchFeedback(true);
    setSuperOpened(choice);
    setPending(v => v + prize);
    setNotice((en ? 'Super prize: +' : 'Суперприз: +') + prize);
    setPhase('superbonus-reveal');
  };
  const beginRisk = () => {
    if (phase !== 'decision' || pending <= 0 || riskSteps >= 5) return;
    setRiskDeck(prepareRiskCards());
    setRiskOpened(null);
    setAuto(0);
    setPhase('risk');
  };
  const pickRisk = (choice:number) => {
    if (phase !== 'risk' || riskOpened !== null || choice < 0 || choice >= riskDeck.length) return;
    setRiskOpened(choice);
    playTone(riskDeck[choice].wins ? 760 : 180);
    touchFeedback(riskDeck[choice].wins);
    if (riskDeck[choice].wins) {
      setPending(v => v * 2);
      setRiskSteps(v => v + 1);
      setNotice(en ? 'Win! Your demo prize doubles.' : 'Победа! Приз удвоен.');
    } else {
      setPending(0);
      setNotice(en ? 'Wrong card. The demo prize is lost.' : 'Не та карта. Приз потерян.');
    }
    setPhase('risk-reveal');
  };
  const reset = () => {
    if (phase !== 'ready' || auto > 0) return;
    setBalance(INITIAL_BALANCE);setPending(0);setRecent(null);
    setNotice(en ? 'Demo balance restored.' : 'Тестовые монеты восстановлены.');
  };
  return <div className="vslot" data-testid="viking-slots">
    <div className="vslot-heading">
      <button type="button" onClick={onBack} className="vslot-icon-button" aria-label={en?'Back to games':'Назад в игры'}><ArrowLeft size={18}/></button>
      <div><span className="vslot-eyebrow">TERRITORY · {en?'GAME HALL':'ИГРОВОЙ ЗАЛ'}</span><h1>{en?'VIKING TREASURES':'СОКРОВИЩА ВИКИНГОВ'}</h1></div>
      <button type="button" onClick={() => setHelp(v=>!v)} className="vslot-icon-button" aria-label={en?'Paytable':'Таблица выплат'}><BookOpen size={18}/></button>
    </div>
    <div className="vslot-preview-label"><Shield size={12}/>{en?'PLAY-MONEY PREVIEW · NO REAL REWARDS':'ТЕСТОВЫЙ РЕЖИМ · БЕЗ НАСТОЯЩИХ НАГРАД'}</div>
    <div className="vslot-art"><img src={root+'assets/territory/characters/heroes/female_warrior/idle.webp'} alt=""/><div><Crown size={25}/><strong>{en?'FATE OF THE NORTH':'УДАЧА СЕВЕРА'}</strong><span>{en?'Treasures, runes and legendary heroes':'Сокровища, руны и герои легенд'}</span></div><img src={root+'assets/territory/characters/bosses/northern_jarl/idle.webp'} alt=""/></div>
    <div className="vslot-stats">
      <div><small>{en?'PLAY COINS':'ФИШКИ'}</small><strong>{balance.toLocaleString('ru-RU')}</strong></div>
      <div><small>{en?'TOTAL STAKE':'СТАВКА'}</small><strong>{wager}</strong></div>
      <div><small>{en?'UNCLAIMED':'ПРИЗ'}</small><strong className="vslot-gold">{pending.toLocaleString('ru-RU')}</strong></div>
    </div>
    <div className="vslot-board">
      <div className="vslot-line-marker">{[1,2,3,4,5,6,7,8,9].filter(i=>i<=lines).map(i=><span key={i}>{i}</span>)}</div>
      <div className="vslot-reels" aria-label={en ? 'Five animated reels' : 'Пять вращающихся барабанов'}>
        {field.map((reel, r) => {
          const sequence = reelTracks?.[r] ?? reel;
          const animating = phase === 'spinning' && !!reelTracks;
          return <div className="vslot-reel-window" key={r}>
            <div key={animating ? 'spin-' + spinSerial + '-' + r : 'rest-' + r}
              className={'vslot-reel-track ' + (animating ? 'vslot-reel-track--rolling' : '')}
              style={animating ? {
                animationDelay: (r * 100) + 'ms',
                animationDuration: (950 + r * 220) + 'ms',
              } : undefined}>
              {sequence.map((sym, idx) => <div
                className={'vslot-symbol ' + (!animating && winningPositions.has(r+':'+idx) ? 'vslot-symbol--win' : '')}
                key={idx}>
                <img src={root + SLOT_ICONS[sym].image}
                  alt={en ? SLOT_ICONS[sym].en : SLOT_ICONS[sym].ru} draggable={false}/>
                {sym==='wild'&&<b>WILD</b>}{sym==='hero'&&<b>BONUS</b>}
              </div>)}
            </div>
          </div>;
        })}
        {!!visibleLine && phase!=='spinning' && <svg className="vslot-win-path" viewBox="0 0 500 300" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={linePoints} stroke="#ffde55" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          {visibleLine.positions.map(([col,row]) => <circle key={col+'-'+row} cx={col*100+50} cy={row*100+50} r="10" fill="#fff3bd" stroke="#ad51c8" strokeWidth="4"/>)}
        </svg>}
      </div>
      <span className="vslot-board-caption">{phase==='spinning'?(en?'SPINNING…':'ВРАЩЕНИЕ…'):(en ? lines + ' ACTIVE LINES' : lines + ' АКТИВНЫХ ЛИНИЙ')}</span>
    </div>
    {visibleLine && phase!=='spinning' && <div className="vslot-winning-lines" role="status"><Sparkles size={15}/>{en?'Line':'Линия'} {visibleLine.number} · {visibleLine.count} × {SLOT_ICONS[visibleLine.symbol][en?'en':'ru']} · +{visibleLine.payout} <span>({winningLineIndex+1}/{recent?.lines.length})</span></div>}
    {notice&&<p className="vslot-notice" role="status">{notice}</p>}
    {(['bonus','bonus-ended','bonus-complete','superbonus','superbonus-reveal','risk','risk-reveal'] as Phase[]).includes(phase) && (
      <div className="vslot-adventure-backdrop">
        <section className="vslot-adventure" role="dialog" aria-modal="true" aria-label={en?'Bonus challenge':'Бонусная игра'}>
          <div className="vslot-adventure-title">
            <Crown size={24}/>
            <h2>{phase.startsWith('risk') ? (en?'CHOOSE YOUR FATE':'ИСПЫТАНИЕ УДАЧИ')
              : phase.startsWith('superbonus') ? (en?'LEGENDARY CHESTS':'ЛЕГЕНДАРНЫЕ СУНДУКИ')
              : (en?'VIKING TREASURE QUEST':'СОКРОВИЩНИЦА ВИКИНГОВ')}</h2>
            <p>{en?'Preview · play coins only':'Демо · только тестовые фишки'}</p>
          </div>
          {(phase==='bonus'||phase==='bonus-ended'||phase==='bonus-complete') && <>
            <div className="vslot-adventure-totals">
              <span>{en?'Treasure':'Сокровища'} <b>{pending}</b></span>
              <span>{en?'Moves':'Ходы'} <b>{bonusLeft}</b></span>
              <span>{en?'Shields':'Щиты'} <b>{bonusShield}</b></span>
            </div>
            <p className="vslot-adventure-instruction">
              {phase==='bonus' ? (en?'Select a sealed rune. Each hides a different prize, shield or trap.':'Выбери закрытую руну. За каждой — своё сокровище, щит или ловушка.')
                : phase==='bonus-ended' ? (en?'The trap ended the quest. Your revealed prizes are shown below.':'Ловушка завершила поход. Ниже раскрыты награды.')
                : (en?'All runes opened! A legendary chest awaits.':'Все руны открыты! Впереди легендарный сундук.')}
            </p>
            <div className="vslot-adventure-tiles">
              {bonusDeck.map((tile,i) => {
                const chosen = bonusOpened.includes(i);
                const revealed = chosen || phase!=='bonus';
                return <button type="button" key={tile.id}
                  className={'vslot-adventure-tile '+(chosen?'vslot-adventure-tile--chosen ':'')+(revealed?'vslot-adventure-tile--revealed':'')}
                  onClick={()=>pickBonus(i)} disabled={phase!=='bonus'||chosen}
                  aria-label={(en?'Rune ':'Руна ')+(i+1)+(revealed?', '+tile.kind:'')}>
                  <span className="vslot-adventure-glyph">{revealed
                    ? (tile.kind==='trap'?'☠️':tile.kind==='shield'?'🛡️':'💰')
                    : <img src={root+'slots/rune-sealed.svg'} alt=""/>}</span>
                  <span>{revealed ? (tile.kind==='treasure'?'+'+tile.payout:tile.kind==='trap'?(en?'TRAP':'ЛОВУШКА'):(en?'SHIELD':'ЩИТ')) : (i+1)}</span>
                </button>;
              })}
            </div>
            <p className="vslot-adventure-feedback" role="status">{bonusLog[bonusLog.length-1] || (en?'Choose wisely.':'Выбирай внимательно.')}</p>
            {phase==='bonus' && pending>0 && <button type="button" className="vslot-adventure-subtle" onClick={finishBonus}>{en?'Finish quest and collect':'Завершить и забрать'}</button>}
            {phase==='bonus-ended' && <button type="button" className="vslot-adventure-cta" onClick={finishBonus}>{pending>0 ? (en?'COLLECT TREASURE':'ЗАБРАТЬ СОКРОВИЩА') : (en?'TO THE REELS':'К БАРАБАНАМ')}</button>}
            {phase==='bonus-complete' && <button type="button" className="vslot-adventure-cta" onClick={()=>setPhase('superbonus')}>{en?'OPEN THE SUPER BONUS':'ОТКРЫТЬ СУПЕРБОНУС'}</button>}
          </>}
          {(phase==='superbonus'||phase==='superbonus-reveal') && <>
            <p className="vslot-adventure-instruction">{en?'Three different sealed prizes. Choose one chest.':'За сундуками спрятаны три разных приза. Выбери один.'}</p>
            <div className="vslot-adventure-tiles vslot-adventure-tiles--three">
              {superDeck.map((chest,i) => <button type="button" key={chest.id} onClick={()=>takeSuper(i)}
                className={'vslot-adventure-tile '+(superOpened===i?'vslot-adventure-tile--chosen':'')}
                disabled={phase!=='superbonus'} aria-label={(en?'Chest ':'Сундук ')+(i+1)}>
                <span className="vslot-adventure-glyph">{superOpened===null?<img src={root+'slots/chest-sealed.svg'} alt=""/>:'💎'}</span>
                <span>{superOpened===null ? (i+1) : '+'+chest.payout}</span>
              </button>)}
            </div>
            {phase==='superbonus-reveal' && <>
              <p className="vslot-adventure-feedback" role="status">{en?'Your prize was added to the demo balance.':'Приз добавлен к тестовому выигрышу.'}</p>
              <button type="button" className="vslot-adventure-cta" onClick={()=>setPhase('decision')}>{en?'COLLECT YOUR PRIZE':'ЗАБРАТЬ ПРИЗ'}</button>
            </>}
          </>}
          {(phase==='risk'||phase==='risk-reveal') && <>
            <p className="vslot-adventure-instruction">{en?'Two cards double the prize, two make it zero. Pick one.':'Две карты удваивают приз, две обнуляют. Выбери одну.'}</p>
            <div className="vslot-adventure-totals">
              <span>{en?'At stake':'На кону'} <b>{phase==='risk'?pending: (riskDeck[riskOpened??-1]?.wins?pending/2:0)}</b></span>
              <span>{en?'Doubles left':'Удвоений осталось'} <b>{5-riskSteps}</b></span>
            </div>
            <div className="vslot-adventure-tiles vslot-adventure-tiles--four">
              {riskDeck.map((card,i) => <button type="button" key={card.id} onClick={()=>pickRisk(i)}
                disabled={phase!=='risk'}
                className={'vslot-adventure-tile '+(riskOpened===i?'vslot-adventure-tile--chosen':'')}
                aria-label={(en?'Card ':'Карта ')+(i+1)}>
                <span className="vslot-adventure-glyph">{riskOpened===null?<img src={root+'slots/card-sealed.svg'} alt=""/>:card.wins?'👑':'☠️'}</span>
                <span>{riskOpened===null ? (i+1) : (card.wins?'×2':'×0')}</span>
              </button>)}
            </div>
            {phase==='risk-reveal' ? <>
              <p className="vslot-adventure-feedback" role="status">{riskDeck[riskOpened??-1]?.wins ? (en?'You doubled your winnings!':'Выигрыш удвоен!') : (en?'The stake is lost.':'Выигрыш потерян.')}</p>
              <button type="button" className="vslot-adventure-cta" onClick={()=>setPhase(pending>0?'decision':'ready')}>{en?'CONTINUE':'ПРОДОЛЖИТЬ'}</button>
            </> : <button type="button" className="vslot-adventure-subtle" onClick={()=>setPhase('decision')}>{en?'Keep my winnings':'Сохранить выигрыш'}</button>}
          </>}
        </section>
      </div>
    )}
    <div className="vslot-controls">
      <div className="vslot-selection"><label>{en?'ACTIVE LINES':'ЛИНИИ'}</label><div>{SLOT_LINE_CHOICES.map(n=><button className={lines===n?'selected':''} type="button" key={n} onClick={()=>setLines(n)} disabled={phase!=='ready'||auto>0}>{n}</button>)}</div></div>
      <div className="vslot-selection"><label>{en?'STAKE PER LINE':'СТАВКА НА ЛИНИЮ'}</label><div>{SLOT_BET_CHOICES.map(n=><button className={bet===n?'selected':''} type="button" key={n} onClick={()=>setBet(n)} disabled={phase!=='ready'||auto>0}>{n}</button>)}</div></div>
      {phase==='decision'?<div className="vslot-action-bar"><button type="button" className="vslot-main" onClick={take}><Trophy size={19}/>{en?'COLLECT':'ЗАБРАТЬ'} {pending}</button><button type="button" className="vslot-secondary" onClick={beginRisk} disabled={pending<=0||riskSteps>=5}><Sparkles size={16}/>{en?'DOUBLE':'РИСК ×2'}</button></div>:
      <div className="vslot-action-bar"><button type="button" className="vslot-main" onClick={spin} disabled={phase!=='ready'||balance<wager||auto>0}><Play size={18} fill="currentColor"/>{en?'SPIN':'КРУТИТЬ'}</button><button type="button" className="vslot-secondary" onClick={skip} disabled={phase!=='spinning'}><FastForward size={16}/>{en?'SKIP':'ПРОПУСТИТЬ'}</button></div>}
      <div className="vslot-bottom-actions"><button type="button" disabled={auto===0 && phase!=='ready' && phase!=='decision'} onClick={()=>setAuto(v=>v>0?0:10)}>{auto>0?(en?'STOP AUTO (':'СТОП АВТО (')+auto+')':(en?'AUTO ×10':'АВТО ×10')}</button><button type="button" disabled={phase!=='ready'||auto>0} onClick={reset}><RotateCcw size={14}/>{en?'RESET DEMO':'ПОПОЛНИТЬ ДЕМО'}</button></div>
      <div className="vslot-fx-toggles" aria-label={en?'Optional effects':'Необязательные эффекты'}>
        <button type="button" aria-pressed={soundOn} onClick={()=>setSoundOn(v=>!v)}>
          {soundOn?<Volume2 size={15}/>:<VolumeX size={15}/>}
          {en?'Sound':'Звук'}: {soundOn?(en?'on':'вкл'):(en?'off':'выкл')}
        </button>
        <button type="button" aria-pressed={hapticsOn} onClick={()=>setHapticsOn(v=>!v)}>
          <Vibrate size={15}/>
          {en?'Haptics':'Вибрация'}: {hapticsOn?(en?'on':'вкл'):(en?'off':'выкл')}
        </button>
      </div>
    </div>
    <p className="vslot-disclaimer"><Ticket size={14}/>{en?'Demo coins cannot be bought, transferred or cashed out. No player tickets or hero gold are affected.':'Это только тестовые фишки: их нельзя купить, обменять или вывести. Билеты и золото персонажа не меняются.'}</p>
    {help&&<div className="vslot-help-backdrop" role="dialog" aria-modal="true" aria-label={en?'Rules':'Правила'}><div className="vslot-help"><h2>{en?'PAYTABLE AND RULES':'ТАБЛИЦА ВЫПЛАТ И ПРАВИЛА'}</h2><p>{en?'3–5 matching symbols from either edge on an active line. Wild substitutes; 3+ heroes start the bonus.':'Совпадения от 3 до 5 символов от любого края активной линии. WILD заменяет символы; 3+ героя запускают бонус.'}</p><table><thead><tr><th>{en?'Symbol':'Символ'}</th><th>×3</th><th>×4</th><th>×5</th></tr></thead><tbody>{Object.entries(SLOT_PAYTABLE).map(([sym,pays])=><tr key={sym}><td>{en?SLOT_ICONS[sym as keyof typeof SLOT_ICONS].en:SLOT_ICONS[sym as keyof typeof SLOT_ICONS].ru}</td>{pays?.map((p,i)=><td key={i}>{p}×</td>)}</tr>)}</tbody></table><p>{en?'Original preview coefficients; not the Igrosoft paytable. Real prizes are disabled.':'Коэффициенты придуманы для TERRITORY и не копируют таблицу Crazy Monkey. Настоящие награды отключены.'}</p><button type="button" onClick={()=>setHelp(false)}>{en?'CLOSE':'ЗАКРЫТЬ'}</button></div></div>}
  </div>;
}
