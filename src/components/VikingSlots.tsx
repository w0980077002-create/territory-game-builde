import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Crown, FastForward, Play, RotateCcw, Shield, Sparkles, Ticket, Trophy } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { fairDemoInt, SLOT_BET_CHOICES, SLOT_ICONS, SLOT_LINE_CHOICES, SLOT_PAYTABLE, spinVikingSlots, type SlotGrid, type SlotOutcome } from '@/game/vikingSlots';
import './vikingSlots.css';

const root = import.meta.env.BASE_URL;
const INITIAL_BALANCE = 500;
type Phase = 'ready' | 'spinning' | 'decision' | 'bonus' | 'risk' | 'superbonus';
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
  const activeSpin = useRef<SlotOutcome | null>(null);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinLock = useRef(false);
  const wager = lines * bet;
  const winningPositions = useMemo(() => new Set(
    (recent?.lines ?? []).flatMap(line => line.positions.map(([r,c]) => r + ':' + c)),
  ), [recent]);
  useEffect(() => () => { if (spinTimer.current) clearTimeout(spinTimer.current); }, []);

  const finishSpin = useCallback(() => {
    const outcome = activeSpin.current;
    activeSpin.current = null;
    spinTimer.current = null;
    spinLock.current = false;
    if (!outcome) return;
    setField(outcome.grid);
    setRecent(outcome);
    setPending(outcome.payout);
    setRiskSteps(0);
    if (outcome.bonusSymbols >= 3) {
      setAuto(0);
      setBonusLeft(Math.max(2,5-(outcome.bonusSymbols-3)));
      setBonusShield(outcome.bonusSymbols >= 4 ? 1 : 0);
      setBonusLog([]);
      setNotice(en ? 'Hero symbols! Treasure quest unlocked.' : 'Герои на барабанах! Бонусная сокровищница открыта!');
      setPhase('bonus');
    } else if (outcome.payout > 0) {
      setNotice(en ? 'Winning lines: ' + outcome.lines.length : 'Выигрышных линий: ' + outcome.lines.length);
      setPhase('decision');
    } else {
      setNotice(en ? 'No winning combination.' : 'Без выигрыша. Попробуй ещё!');
      setPhase('ready');
    }
  }, [en]);

  const spin = useCallback(() => {
    if (phase !== 'ready' || spinLock.current || balance < wager || wager <= 0) return;
    spinLock.current = true;
    setBalance(v => v - wager);
    setPending(0);
    setRecent(null);
    setNotice('');
    activeSpin.current = spinVikingSlots(lines, bet);
    setPhase('spinning');
    spinTimer.current = setTimeout(finishSpin,1150);
  }, [phase,balance,wager,lines,bet,finishSpin]);
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
    if (phase !== 'bonus' || choice < 0 || choice > 4) return;
    const roll = fairDemoInt(10);
    if (roll < 2 && bonusShield === 0) {
      setBonusLog(v => [...v,en ? 'A trap ends the adventure.' : 'Ловушка! Поход завершён.']);
      setNotice(en ? 'Trap! Collect your treasure.' : 'Ловушка! Забирай собранные сокровища.');
      setPhase(pending > 0 ? 'decision' : 'ready');
      return;
    }
    if (roll < 2 && bonusShield > 0) {
      setBonusShield(v => v-1);
      setBonusLog(v => [...v,en ? 'Shield blocked a trap!' : 'Щит защитил от ловушки!']);
    } else if (roll === 2) {
      setBonusShield(v => v+1);
      setBonusLog(v => [...v,en ? 'A protective rune!' : 'Найдена защитная руна!']);
    } else {
      const prize = wager * (2 + fairDemoInt(7));
      setPending(v => v+prize);
      setBonusLog(v => [...v,(en ? 'Treasure +' : 'Сокровище +') + prize]);
    }
    if (bonusLeft <= 1) {
      setPhase('superbonus');
      setNotice(en ? 'All seals broken! Choose a super prize.' : 'Все печати сняты! Выбери суперприз.');
    } else setBonusLeft(v => v-1);
  };
  const takeSuper = (choice:number) => {
    if (phase !== 'superbonus' || choice < 0 || choice > 2) return;
    const prize = wager * (10 + fairDemoInt(21));
    setPending(v => v+prize);
    setNotice((en ? 'Super prize: +' : 'Суперприз: +') + prize);
    setPhase('decision');
  };
  const pickRisk = (choice:number) => {
    if (phase !== 'risk' || choice < 0 || choice > 3) return;
    if (fairDemoInt(2) === 0) {
      setPending(v => v*2);
      setRiskSteps(v => v+1);
      setNotice(en ? 'Success! Prize doubled.' : 'Повезло! Приз удвоен!');
      setPhase('decision');
    } else {
      setPending(0);
      setNotice(en ? 'The risk did not pay off.' : 'Риск не оправдался. Выигрыш потерян.');
      setPhase('ready');
    }
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
    <div className="vslot-preview-label"><Shield size={14}/>{en?'PLAY-MONEY PREVIEW · NO REAL REWARDS':'ТЕСТОВЫЙ РЕЖИМ · БЕЗ НАСТОЯЩИХ НАГРАД'}</div>
    <div className="vslot-art"><img src={root+'hero-viking.webp'} alt=""/><div><Crown size={25}/><strong>{en?'FATE OF THE NORTH':'УДАЧА СЕВЕРА'}</strong><span>{en?'Treasures, runes and legendary heroes':'Сокровища, руны и герои легенд'}</span></div><img src={root+'enemy-boss.webp'} alt=""/></div>
    <div className="vslot-stats">
      <div><small>{en?'PLAY COINS':'ИГРОВЫЕ МОНЕТЫ'}</small><strong>{balance.toLocaleString('ru-RU')}</strong></div>
      <div><small>{en?'TOTAL STAKE':'ОБЩАЯ СТАВКА'}</small><strong>{wager}</strong></div>
      <div><small>{en?'UNCLAIMED':'ВЫИГРЫШ'}</small><strong className="vslot-gold">{pending.toLocaleString('ru-RU')}</strong></div>
    </div>
    <div className="vslot-board">
      <div className="vslot-line-marker">{[1,2,3,4,5,6,7,8,9].filter(i=>i<=lines).map(i=><span key={i}>{i}</span>)}</div>
      <div className="vslot-reels">
        {field.map((reel,r)=><div className={'vslot-reel '+(phase==='spinning'?'vslot-reel--moving':'')} key={r}>
          {reel.map((sym,c)=><div className={'vslot-symbol '+(winningPositions.has(r+':'+c)?'vslot-symbol--win':'')} key={c}>
            <img src={root+SLOT_ICONS[sym].image} alt={en?SLOT_ICONS[sym].en:SLOT_ICONS[sym].ru} draggable={false}/>
            {sym==='wild'&&<b>WILD</b>}{sym==='hero'&&<b>BONUS</b>}
          </div>)}
        </div>)}
      </div>
      <span className="vslot-board-caption">{phase==='spinning'?(en?'SPINNING…':'ВРАЩЕНИЕ…'):(en?'9 WINNING LINES · BOTH DIRECTIONS':'9 ЛИНИЙ · В ОБЕ СТОРОНЫ')}</span>
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
      <div className="vslot-bottom-actions"><button type="button" disabled={phase!=='ready'&&phase!=='decision'} onClick={()=>setAuto(v=>v>0?0:10)}>{auto>0?(en?'STOP AUTO (':'СТОП АВТО (')+auto+')':(en?'AUTO ×10':'АВТО ×10')}</button><button type="button" disabled={phase!=='ready'||auto>0} onClick={reset}><RotateCcw size={14}/>{en?'RESET DEMO':'ПОПОЛНИТЬ ДЕМО'}</button></div>
    </div>
    <p className="vslot-disclaimer"><Ticket size={14}/>{en?'Demo coins cannot be bought, transferred or cashed out. No player tickets or hero gold are affected.':'Это только тестовые фишки: их нельзя купить, обменять или вывести. Билеты и золото персонажа не меняются.'}</p>
    {help&&<div className="vslot-help-backdrop" role="dialog" aria-modal="true" aria-label={en?'Rules':'Правила'}><div className="vslot-help"><h2>{en?'PAYTABLE AND RULES':'ТАБЛИЦА ВЫПЛАТ И ПРАВИЛА'}</h2><p>{en?'3–5 matching symbols from either edge on an active line. Wild substitutes; 3+ heroes start the bonus.':'Совпадения от 3 до 5 символов от любого края активной линии. WILD заменяет символы; 3+ героя запускают бонус.'}</p><table><thead><tr><th>{en?'Symbol':'Символ'}</th><th>×3</th><th>×4</th><th>×5</th></tr></thead><tbody>{Object.entries(SLOT_PAYTABLE).map(([sym,pays])=><tr key={sym}><td>{en?SLOT_ICONS[sym as keyof typeof SLOT_ICONS].en:SLOT_ICONS[sym as keyof typeof SLOT_ICONS].ru}</td>{pays?.map((p,i)=><td key={i}>{p}×</td>)}</tr>)}</tbody></table><p>{en?'Original preview coefficients; not the Igrosoft paytable. Real prizes are disabled.':'Коэффициенты придуманы для TERRITORY и не копируют таблицу Crazy Monkey. Настоящие награды отключены.'}</p><button type="button" onClick={()=>setHelp(false)}>{en?'CLOSE':'ЗАКРЫТЬ'}</button></div></div>}
  </div>;
}
