import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Crown, FastForward, Play, RotateCcw, Shield, Sparkles, Ticket, Trophy } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { fairDemoInt, SLOT_BET_CHOICES, SLOT_ICONS, SLOT_LINE_CHOICES, SLOT_PAYTABLE, spinVikingSlots, type SlotGrid, type SlotOutcome, type SlotSymbol } from '@/game/vikingSlots';
import { prepareBonusTiles, prepareSuperChests, prepareRiskCards, resolveBonusTile, type BonusTile, type SuperChest, type RiskCard } from '@/game/slotAdventure';
import './vikingSlots.css';

const root = import.meta.env.BASE_URL;
const INITIAL_BALANCE = 500;
// Each reel travels across twelve actual symbols before landing on three results.
const FILLER_PER_REEL = 12;
const REEL_SPIN_MS = 2320;
const REEL_SYMBOLS = Object.keys(SLOT_ICONS) as SlotSymbol[];
type Phase = 'ready' | 'spinning' | 'decision' | 'bonus' | 'bonus-ended' | 'bonus-complete' | 'risk' | 'risk-reveal' | 'superbonus' | 'superbonus-reveal';
const START_GRID: SlotGrid = [
  ['helmet','gem','gold'],['follower','wild','sword'],['boss','hero','gold'],
  ['wolf','gem','helmet'],['sword','gold','follower'],
];

/** Preview-only slot; never submits a wallet transaction or pays real game currency. */
export function VikingSlots({ onBack }: { onBack: () => void }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [balance, setBalance] = useState(INITIAL_BALANCE);
  const [lines, setLines] = useState<(typeof SLOT_LINE_CHOICES)[number]>(9);
  const [bet, setBet] = useState<(typeof SLOT_BET_CHOICES)[number]>(1);
  const [field, setField] = useState<SlotGrid>(START_GRID);
  const [reelTracks, setReelTracks] = useState<SlotSymbol[][] | null>(null);
  const [spinSerial, setSpinSerial] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [pending, setPending] = useState(0);
  const [recent, setRecent] = useState<SlotOutcome | null>(null);
  const [auto, setAuto] = useState(0);
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState('');
  const [bonusLeft, setBonusLeft] = useState(5);
  const [bonusShield, setBonusShield] = useState(0);
  const [bonusLog, setBonusLog] = useState<string[]>([]);
  const [riskSteps, setRiskSteps] = useState(0);
  const [bonusDeck, setBonusDeck] = useState<BonusTile[]>([]);
  const [bonusOpened, setBonusOpened] = useState<number[]>([]);
  const [superDeck, setSuperDeck] = useState<SuperChest[]>([]);
  const [superOpened, setSuperOpened] = useState<number | null>(null);
  const [riskDeck, setRiskDeck] = useState<RiskCard[]>([]);
  const [riskOpened, setRiskOpened] = useState<number | null>(null);
  const [winningLineIndex, setWinningLineIndex] = useState(0);
  const openedRef = useRef(new Set<number>());
  const activeSpin = useRef<SlotOutcome | null>(null);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinLock = useRef(false);
  const wager = lines * bet;
  const visibleLine = recent?.lines[winningLineIndex % (recent?.lines.length || 1)];
  const winningPositions = useMemo(() => new Set(
    (visibleLine?.positions ?? []).map(([r,c]) => r + ':' + c),
  ), [visibleLine]);
  const linePoints = visibleLine
    ? visibleLine.positions.slice().sort((a,b) => a[0]-b[0]).map(([col,row]) => (col*100+50) + ',' + (row*100+50)).join(' ')
    : '';
  useEffect(() => () => { if (spinTimer.current) clearTimeout(spinTimer.current); }, []);
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
  }, [en,wager]);

  const spin = useCallback(() => {
    if (phase !== 'ready' || spinLock.current || balance < wager || wager <= 0) return;
    spinLock.current = true;
    setBalance(v => v - wager);
    setPending(0);
    setRecent(null);
    setNotice('');
    const outcome = spinVikingSlots(lines, bet);
    activeSpin.current = outcome;
    setReelTracks(field.map((column, index) => [
      ...column,
      ...Array.from({length: FILLER_PER_REEL}, () => REEL_SYMBOLS[fairDemoInt(REEL_SYMBOLS.length)]),
      ...outcome.grid[index],
    ]));
    setSpinSerial(v => v + 1);
    setPhase('spinning');
    // Last reel stops at 2230 ms, then finalize exactly the server-independent demo result.
    spinTimer.current = setTimeout(finishSpin, REEL_SPIN_MS);
  }, [phase,balance,wager,lines,bet,field,finishSpin]);
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
      </div>
      <span className="vslot-board-caption">{phase==='spinning'?(en?'SPINNING…':'ВРАЩЕНИЕ…'):(en ? lines + ' ACTIVE LINES' : lines + ' АКТИВНЫХ ЛИНИЙ')}</span>
    </div>
    {recent && recent.lines.length>0 && phase!=='spinning'&&<div className="vslot-winning-lines"><Sparkles size={15}/>{en?'Winning lines':'Выигрышные линии'}: {recent.lines.map(l=>l.number+' (×'+l.payout+')').join(' · ')}</div>}
    {notice&&<p className="vslot-notice" role="status">{notice}</p>}
    {phase==='bonus'&&<div className="vslot-challenge"><h2>⚔️ {en?'TREASURE QUEST':'ПОХОД ЗА СОКРОВИЩАМИ'}</h2><p>{en?'Choose a rune. Beware traps!':'Выбери руну. Берегись ловушек!'}</p><p>{en?'Seals left':'Осталось печатей'}: <strong>{bonusLeft}</strong> · {en?'Shields':'Щиты'}: <strong>{bonusShield}</strong></p><div className="vslot-choice-row">{[0,1,2,3,4].map(i=><button type="button" key={i} onClick={()=>pickBonus(i)} aria-label={(en?'Rune ':'Руна ')+(i+1)}>ᛟ</button>)}</div><small>{bonusLog[bonusLog.length-1]}</small></div>}
    {phase==='superbonus'&&<div className="vslot-challenge"><h2>🏆 {en?'SUPER BONUS':'СУПЕРБОНУС'}</h2><p>{en?'Choose a legendary chest.':'Выбери легендарный сундук.'}</p><div className="vslot-choice-row">{[0,1,2].map(i=><button type="button" key={i} onClick={()=>takeSuper(i)} aria-label={(en?'Chest ':'Сундук ')+(i+1)}>🎁</button>)}</div></div>}
    {phase==='risk'&&<div className="vslot-challenge"><h2>🃏 {en?'DOUBLE OR LOSE':'УДВОИТЬ ИЛИ ПОТЕРЯТЬ'}</h2><p>{en?'Pick a card: 50% chance to double.':'Выбери карту: шанс удвоения — 50%. При неудаче выигрыш сгорит.'}</p><div className="vslot-choice-row">{[0,1,2,3].map(i=><button type="button" key={i} onClick={()=>pickRisk(i)} aria-label={(en?'Card ':'Карта ')+(i+1)}>♠</button>)}</div><button type="button" className="vslot-subtle" onClick={()=>setPhase('decision')}>{en?'Return without risking':'Вернуться без риска'}</button></div>}
    <div className="vslot-controls">
      <div className="vslot-selection"><label>{en?'ACTIVE LINES':'ЛИНИИ'}</label><div>{SLOT_LINE_CHOICES.map(n=><button className={lines===n?'selected':''} type="button" key={n} onClick={()=>setLines(n)} disabled={phase!=='ready'||auto>0}>{n}</button>)}</div></div>
      <div className="vslot-selection"><label>{en?'STAKE PER LINE':'СТАВКА НА ЛИНИЮ'}</label><div>{SLOT_BET_CHOICES.map(n=><button className={bet===n?'selected':''} type="button" key={n} onClick={()=>setBet(n)} disabled={phase!=='ready'||auto>0}>{n}</button>)}</div></div>
      {phase==='decision'?<div className="vslot-action-bar"><button type="button" className="vslot-main" onClick={take}><Trophy size={19}/>{en?'COLLECT':'ЗАБРАТЬ'} {pending}</button><button type="button" className="vslot-secondary" onClick={()=>{if(pending>0 && riskSteps<5){setAuto(0);setPhase('risk');}}} disabled={pending<=0||riskSteps>=5}><Sparkles size={16}/>{en?'DOUBLE':'РИСК ×2'}</button></div>:
      <div className="vslot-action-bar"><button type="button" className="vslot-main" onClick={spin} disabled={phase!=='ready'||balance<wager||auto>0}><Play size={18} fill="currentColor"/>{en?'SPIN':'КРУТИТЬ'}</button><button type="button" className="vslot-secondary" onClick={skip} disabled={phase!=='spinning'}><FastForward size={16}/>{en?'SKIP':'ПРОПУСТИТЬ'}</button></div>}
      <div className="vslot-bottom-actions"><button type="button" disabled={auto===0 && phase!=='ready' && phase!=='decision'} onClick={()=>setAuto(v=>v>0?0:10)}>{auto>0?(en?'STOP AUTO (':'СТОП АВТО (')+auto+')':(en?'AUTO ×10':'АВТО ×10')}</button><button type="button" disabled={phase!=='ready'||auto>0} onClick={reset}><RotateCcw size={14}/>{en?'RESET DEMO':'ПОПОЛНИТЬ ДЕМО'}</button></div>
    </div>
    <p className="vslot-disclaimer"><Ticket size={14}/>{en?'Demo coins cannot be bought, transferred or cashed out. No player tickets or hero gold are affected.':'Это только тестовые фишки: их нельзя купить, обменять или вывести. Билеты и золото персонажа не меняются.'}</p>
    {help&&<div className="vslot-help-backdrop" role="dialog" aria-modal="true" aria-label={en?'Rules':'Правила'}><div className="vslot-help"><h2>{en?'PAYTABLE AND RULES':'ТАБЛИЦА ВЫПЛАТ И ПРАВИЛА'}</h2><p>{en?'3–5 matching symbols from either edge on an active line. Wild substitutes; 3+ heroes start the bonus.':'Совпадения от 3 до 5 символов от любого края активной линии. WILD заменяет символы; 3+ героя запускают бонус.'}</p><table><thead><tr><th>{en?'Symbol':'Символ'}</th><th>×3</th><th>×4</th><th>×5</th></tr></thead><tbody>{Object.entries(SLOT_PAYTABLE).map(([sym,pays])=><tr key={sym}><td>{en?SLOT_ICONS[sym as keyof typeof SLOT_ICONS].en:SLOT_ICONS[sym as keyof typeof SLOT_ICONS].ru}</td>{pays?.map((p,i)=><td key={i}>{p}×</td>)}</tr>)}</tbody></table><p>{en?'Original preview coefficients; not the Igrosoft paytable. Real prizes are disabled.':'Коэффициенты придуманы для TERRITORY и не копируют таблицу Crazy Monkey. Настоящие награды отключены.'}</p><button type="button" onClick={()=>setHelp(false)}>{en?'CLOSE':'ЗАКРЫТЬ'}</button></div></div>}
  </div>;
}
