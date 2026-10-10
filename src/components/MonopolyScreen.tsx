import { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { Dices, Gift, Ticket, CheckCircle2, ChevronLeft, ArrowRight, Clock } from 'lucide-react';
import { CURRENCY_ART } from '@/game/art';
import { Modal } from './ui/Modal';
import { useLanguage } from '@/game/i18n';

const GRID_N = 8;
const BOARD_SIZE = 4 * (GRID_N - 1);

type CellReward = 'gold' | 'gems' | 'stones' | 'elixir' | 'potion';
type CellType = 'start' | 'reward' | 'mystery';

interface BoardCell {
  index: number;
  type: CellType;
  reward?: CellReward;
  amount?: number;
}

const REWARD_ART: Record<CellReward, string> = {
  gold: CURRENCY_ART.gold,
  gems: CURRENCY_ART.gems,
  stones: CURRENCY_ART.stones,
  elixir: '/elixir-attack.webp',
  potion: '/potion-hp.webp',
};

const REWARD_LABEL: Record<CellReward, string> = {
  gold: 'Монеты',
  gems: 'Алмазы',
  stones: 'Камни',
  elixir: 'Эликсир',
  potion: 'Зелье',
};

function buildBoard(): BoardCell[] {
  const cells: BoardCell[] = [];
  const rewards: CellReward[] = ['gold', 'gems', 'stones', 'elixir', 'potion'];
  const mysteryPositions = new Set([6, 14, 21]);

  for (let i = 0; i < BOARD_SIZE; i++) {
    if (i === 0) {
      cells.push({ index: i, type: 'start' });
    } else if (mysteryPositions.has(i)) {
      cells.push({ index: i, type: 'mystery' });
    } else {
      const reward = rewards[(i + Math.floor(i / 5)) % rewards.length];
      const baseAmount =
        reward === 'gold' ? 50 + i * 8 :
        reward === 'gems' ? 1 + Math.floor(i / 7) :
        reward === 'stones' ? 1 + Math.floor(i / 9) :
        1;
      cells.push({ index: i, type: 'reward', reward, amount: baseAmount });
    }
  }
  return cells;
}

function perimeterPos(idx: number, n: number): { row: number; col: number } {
  const side = n - 1;
  if (idx < side) return { row: 0, col: idx };
  idx -= side;
  if (idx < side) return { row: idx, col: side };
  idx -= side;
  if (idx < side) return { row: side, col: side - idx };
  idx -= side;
  return { row: side - idx, col: 0 };
}

const MILESTONES = [5, 10, 25, 50, 100];
const RESET_HOURS = 72;
const FREE_TICKET_KEY = 'monopoly_free_ticket_claim';
const FREE_TICKET_HOURS = 24;

function msUntilReset(): number {
  const now = new Date();
  const next = new Date(now.getTime() + RESET_HOURS * 3600_000);
  next.setHours(0, 0, 0, 0);
  return next.getTime() - now.getTime();
}

function getFreeTicketClaimTime(): number {
  try {
    const v = localStorage.getItem(FREE_TICKET_KEY);
    return v ? parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
}

function setFreeTicketClaimTime(ts: number) {
  try {
    localStorage.setItem(FREE_TICKET_KEY, String(ts));
  } catch {
    // ignore
  }
}

function msUntilFreeTicket(): number {
  const last = getFreeTicketClaimTime();
  if (!last) return 0;
  return Math.max(0, last + FREE_TICKET_HOURS * 3600_000 - Date.now());
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

type MysteryEvent = 'gift' | 'teleport' | 'guaranteed';
const MYSTERY_EVENTS: MysteryEvent[] = ['gift', 'teleport', 'guaranteed'];

interface LogEntry {
  id: number;
  text: string;
  kind: 'info' | 'reward' | 'mystery';
}

export function MonopolyScreen({ onBack }: { onBack: () => void }) {
  const { language } = useLanguage();
  const rewardLabel = (reward: CellReward) => (language === 'en' ? ({ gold: 'Coins', gems: 'Gems', stones: 'Battle stones', elixir: 'Elixir', potion: 'Potion' } as Record<CellReward, string>)[reward] : REWARD_LABEL[reward]);
  const state = useStore(useGame);
  const board = useRef(buildBoard()).current;

  const [position, setPosition] = useState(0);
  const [laps, setLaps] = useState(0);
  const [tickets, setTickets] = useState(3);
  const [diceValue, setDiceValue] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  const [skipAnimation, setSkipAnimation] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [mysteryModal, setMysteryModal] = useState<MysteryEvent | null>(null);
  const [mysteryResult, setMysteryResult] = useState<string | null>(null);
  const [chooseDice, setChooseDice] = useState(false);
  const [claimedMilestones, setClaimedMilestones] = useState<Set<number>>(new Set());
  const [rewardModal, setRewardModal] = useState<{ icon: string; text: string } | null>(null);
  const [resetMs, setResetMs] = useState(() => msUntilReset());
  const [freeTicketMs, setFreeTicketMs] = useState(() => msUntilFreeTicket());
  const [questModal, setQuestModal] = useState(false);
  const [specialModal, setSpecialModal] = useState(false);
  const [giftModal, setGiftModal] = useState(false);

  const logIdRef = useRef(0);
  const addLog = useCallback((text: string, kind: LogEntry['kind'] = 'info') => {
    const id = ++logIdRef.current;
    setLog((prev) => [{ id, text, kind }, ...prev].slice(0, 1));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setResetMs(msUntilReset());
      setFreeTicketMs(msUntilFreeTicket());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const nextMilestone = MILESTONES.find((m) => !claimedMilestones.has(m) && laps >= m);

  useEffect(() => {
    if (nextMilestone) {
      setClaimedMilestones((prev) => new Set(prev).add(nextMilestone));
      setRewardModal({ icon: '/gem-pack.webp', text: language === 'en' ? `Reward for ${nextMilestone} laps!` : `Награда за ${nextMilestone} кругов!` });
    }
  }, [nextMilestone]);

  const rewardMultiplier = 1 + laps * 0.1;

  const claimReward = (cell: BoardCell, lapBonus: boolean) => {
    if (!cell.reward || !cell.amount) return;
    const mult = lapBonus ? 1 + (laps + 1) * 0.1 : rewardMultiplier;
    const finalAmount = Math.floor(cell.amount * mult);
    addLog(`+${finalAmount} ${rewardLabel(cell.reward)}`, 'reward');
    setRewardModal({ icon: REWARD_ART[cell.reward], text: `+${finalAmount} ${rewardLabel(cell.reward)}` });
  };

  const handleMystery = () => {
    const event = MYSTERY_EVENTS[Math.floor(Math.random() * MYSTERY_EVENTS.length)];
    setMysteryModal(event);

    if (event === 'gift') {
      const gifts: CellReward[] = ['gold', 'gems', 'stones'];
      const gift = gifts[Math.floor(Math.random() * gifts.length)];
      const amounts: Record<string, number> = { gold: 200, gems: 5, stones: 10 };
      const amt = Math.floor(amounts[gift] * rewardMultiplier);
      setMysteryResult(language === 'en' ? `Gift: +${amt} ${rewardLabel(gift)}` : `Подарок: +${amt} ${rewardLabel(gift)}`);
      addLog(language === 'en' ? `Gift: +${amt} ${rewardLabel(gift)}` : `Подарок: +${amt} ${rewardLabel(gift)}`, 'mystery');
    } else if (event === 'teleport') {
      setMysteryResult(language === 'en' ? 'Teleport: move forward 3 spaces!' : 'Телепорт: +3 клетки вперёд!');
      addLog(language === 'en' ? 'Teleport: +3 spaces' : 'Телепорт: +3 клетки', 'mystery');
      const newPos = (position + 3) % BOARD_SIZE;
      setTimeout(() => {
        setPosition(newPos);
        const cell = board[newPos];
        if (cell.type === 'reward') claimReward(cell, false);
      }, 800);
    } else {
      setMysteryResult(language === 'en' ? 'Guaranteed roll: choose a number on your next turn' : 'Гарантированный бросок: выбери число на следующем ходу');
      addLog(language === 'en' ? 'Guaranteed roll activated' : 'Гарантированный бросок активирован', 'mystery');
    }
  };

  const rollDice = () => {
    if (rolling || tickets <= 0) return;
    setRolling(true);
    setTickets((t) => t - 1);
    setDiceValue(null);

    if (skipAnimation) {
      executeRoll();
    } else {
      let ticks = 0;
      const interval = setInterval(() => {
        setDiceValue(1 + Math.floor(Math.random() * 6));
        ticks++;
        if (ticks >= 8) { clearInterval(interval); executeRoll(); }
      }, 80);
    }
  };

  const executeRoll = (forcedValue?: number) => {
    const roll = forcedValue ?? (1 + Math.floor(Math.random() * 6));
    setDiceValue(roll);
    const newPos = (position + roll) % BOARD_SIZE;
    const passedStart = newPos < position || (newPos === position && roll === BOARD_SIZE);

    if (skipAnimation) {
      finalizeMove(newPos, passedStart, roll);
    } else {
      let step = 0;
      const interval = setInterval(() => {
        step++;
        const intermediate = (position + step) % BOARD_SIZE;
        setPosition(intermediate);
        if (step >= roll) {
          clearInterval(interval);
          const passed = intermediate < position || (roll === BOARD_SIZE && intermediate === position);
          finalizeMove(intermediate, passed, roll);
        }
      }, 150);
    }
  };

  const finalizeMove = (newPos: number, passedStart: boolean, roll: number) => {
    addLog(language === 'en' ? `Rolled ${roll} · space ${newPos + 1}` : `Выпало ${roll} · клетка ${newPos + 1}`);
    const cell = board[newPos];

    if (passedStart || newPos === 0) {
      setLaps((l) => l + 1);
      addLog(language === 'en' ? 'Lap completed! +10%' : 'Круг пройдён! +10%', 'reward');
    }

    if (cell.type === 'reward') {
      claimReward(cell, passedStart);
    } else if (cell.type === 'mystery') {
      setTimeout(() => handleMystery(), 300);
    }
    setRolling(false);
  };

  const onDiceClick = () => {
    if (chooseDice) return;
    rollDice();
  };

  const chooseDiceValue = (value: number) => {
    setChooseDice(false);
    setMysteryModal(null);
    setMysteryResult(null);
    setRolling(true);
    setTickets((t) => t - 1);
    if (skipAnimation) {
      finalizeMove((position + value) % BOARD_SIZE, (position + value) >= BOARD_SIZE, value);
      setDiceValue(value);
    } else {
      let step = 0;
      const interval = setInterval(() => {
        step++;
        const intermediate = (position + step) % BOARD_SIZE;
        setPosition(intermediate);
        if (step >= value) {
          clearInterval(interval);
          finalizeMove(intermediate, (position + value) >= BOARD_SIZE, value);
          setDiceValue(value);
        }
      }, 150);
    }
  };

  const claimFreeTicket = () => {
    const now = Date.now();
    setFreeTicketClaimTime(now);
    setFreeTicketMs(FREE_TICKET_HOURS * 3600_000);
    setTickets((t) => t + 1);
    addLog(language === 'en' ? 'Free ticket!' : 'Бесплатный билет!', 'reward');
    setGiftModal(false);
  };

  const cellPct = 100 / GRID_N;

  return (
    <div className="h-full flex flex-col px-2 py-1.5 animate-fade-in overflow-hidden bg-gradient-to-br from-slate-900 via-purple-950 to-indigo-950">
      {/* Row 1: Header + milestone bar + timer */}
      <div className="shrink-0 flex items-center gap-1.5 mb-1">
        <button onClick={onBack} className="h-7 pl-1.5 pr-2 rounded-lg flex items-center gap-0.5 text-[11px] font-semibold text-purple-100 bg-white/10 border border-fuchsia-300/30 active:scale-95 transition-transform shrink-0">
          <ChevronLeft className="w-3.5 h-3.5" /> {language === 'en' ? 'Hall' : 'Зал'}
        </button>
        <div className="shrink-0">
          <h2 className="text-sm font-bold text-white leading-tight drop-shadow-[0_0_6px_rgba(232,121,249,0.8)]">{language === 'en' ? 'Monopoly' : 'Монополия'}</h2>
          <p className="text-[9px] text-purple-200/70 leading-tight">{language === 'en' ? 'Lap' : 'Круг'} {laps}</p>
        </div>

        <div className="flex-1 flex items-center justify-center gap-0.5">
          {MILESTONES.map((m, idx) => {
            const claimed = claimedMilestones.has(m);
            const isNext = !claimed && MILESTONES.slice(0, idx).every((pm) => claimedMilestones.has(pm));
            return (
              <div key={m} className="flex items-center">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold border transition-all ${
                  claimed ? 'bg-emerald-500/30 border-emerald-400/60 text-emerald-200'
                    : isNext ? 'bg-amber-500/20 border-amber-400/40 text-amber-200'
                    : 'bg-white/5 border-white/10 text-gray-600'
                }`}>
                  {claimed ? <CheckCircle2 className="w-3.5 h-3.5" /> : m}
                </div>
                {idx < MILESTONES.length - 1 && <div className={`w-2 h-px ${claimed ? 'bg-emerald-400/40' : 'bg-white/10'}`} />}
              </div>
            );
          })}
        </div>

        <div className="shrink-0 flex items-center gap-1 rounded-lg bg-black/40 border border-white/10 px-1.5 h-7">
          <Clock className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] font-bold tabular-nums text-amber-200">{formatDuration(resetMs)}</span>
        </div>
      </div>

      {/* Flat neon board */}
      <div className="flex-1 min-h-0 relative">
        {board.map((cell, idx) => {
          const { row, col } = perimeterPos(idx, GRID_N);
          const isCurrent = position === idx;
          const tone =
            cell.type === 'start'
              ? 'bg-emerald-500/25 border-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.8),inset_0_0_6px_rgba(52,211,153,0.4)]'
              : cell.type === 'mystery'
                ? 'bg-fuchsia-500/25 border-fuchsia-300 shadow-[0_0_10px_rgba(217,70,239,0.9),inset_0_0_6px_rgba(217,70,239,0.5)]'
                : idx % 2 === 0
                  ? 'bg-cyan-500/10 border-cyan-300/80 shadow-[0_0_7px_rgba(34,211,238,0.7)]'
                  : 'bg-teal-500/10 border-teal-300/80 shadow-[0_0_7px_rgba(45,212,191,0.7)]';
          return (
            <div
              key={idx}
              className="absolute flex items-center justify-center"
              style={{ left: `${col * cellPct}%`, top: `${row * cellPct}%`, width: `${cellPct}%`, height: `${cellPct}%` }}
            >
              <div
                className={`w-[78%] aspect-square max-h-[78%] rounded-lg border flex items-center justify-center transition-all duration-200 ${tone} ${
                  isCurrent ? 'ring-2 ring-amber-300 scale-110 z-10 !shadow-[0_0_14px_rgba(252,211,77,0.95)]' : ''
                }`}
              >
                {cell.type === 'start' && <ArrowRight className="w-3.5 h-3.5 text-emerald-200" />}
                {cell.type === 'mystery' && <span className="text-fuchsia-100 text-sm font-bold drop-shadow-[0_0_4px_rgba(240,171,252,1)]">?</span>}
                {cell.type === 'reward' && cell.reward && (
                  <img src={REWARD_ART[cell.reward]} alt="" className="w-[70%] h-[70%] object-contain" />
                )}
              </div>
            </div>
          );
        })}

        {/* Center: neon dice disc */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-2">
          <button
            onClick={onDiceClick}
            disabled={rolling || tickets <= 0}
            className="relative w-24 h-24 rounded-full flex flex-col items-center justify-center bg-[radial-gradient(circle_at_35%_30%,#f0abfc_0%,#c026d3_35%,#4c1d95_100%)] border-2 border-fuchsia-200/80 shadow-[0_0_24px_rgba(217,70,239,0.85),0_0_48px_rgba(139,92,246,0.5),inset_0_0_14px_rgba(255,255,255,0.35)] active:scale-90 hover:scale-105 transition-transform disabled:opacity-40 disabled:hover:scale-100"
          >
            <span className="absolute inset-1 rounded-full border border-white/30" />
            <Dices className={`w-9 h-9 text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.9)] ${rolling ? 'animate-spin' : ''}`} />
            <span className="text-[11px] font-bold text-white tracking-wide mt-0.5">
              {rolling ? '...' : diceValue ? diceValue : (language === 'en' ? 'Roll' : 'Бросок')}
            </span>
          </button>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full bg-black/40 border border-amber-300/50 px-2.5 h-7 shadow-[0_0_8px_rgba(252,211,77,0.4)]">
              <Ticket className="w-3.5 h-3.5 text-amber-300" />
              <span className="text-xs font-bold text-amber-100 tabular-nums">{tickets}</span>
            </div>
            <label className="flex items-center gap-1 rounded-full bg-black/40 border border-white/15 px-2 h-7 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={skipAnimation}
                onChange={(e) => setSkipAnimation(e.target.checked)}
                className="w-3 h-3 accent-fuchsia-500"
              />
              <span className="text-[10px] text-purple-100">{language === 'en' ? 'Fast' : 'Быстро'}</span>
            </label>
          </div>
          {chooseDice && <p className="text-[10px] font-semibold text-amber-200">{language === 'en' ? 'Choose a number' : 'Выбери число'}</p>}
        </div>

        {/* Right-side mega buttons */}
        <div
          className="absolute z-20 top-1/2 -translate-y-1/2 flex flex-col gap-3"
          style={{ right: `calc(${cellPct}% + 6px)` }}
        >
          <button
            onClick={() => setSpecialModal(true)}
            title={language === 'en' ? 'Special offer' : 'Спецпредложение'}
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl bg-gradient-to-br from-yellow-300 via-orange-500 to-red-600 border-2 border-yellow-200 shadow-[0_0_16px_rgba(249,115,22,0.9)] active:scale-90 hover:scale-110 transition-transform animate-pulse"
          >
            🔥
          </button>
          <button
            onClick={() => setGiftModal(true)}
            title={language === 'en' ? 'Gift' : 'Подарок'}
            className={`relative w-14 h-14 rounded-full flex items-center justify-center text-2xl bg-gradient-to-br from-lime-300 via-emerald-500 to-teal-700 border-2 border-emerald-200 shadow-[0_0_16px_rgba(16,185,129,0.9)] active:scale-90 hover:scale-110 transition-transform ${
              freeTicketMs > 0 ? 'opacity-50 saturate-50' : ''
            }`}
          >
            🎁
            {freeTicketMs <= 0 && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-white" />}
          </button>
          <button
            onClick={() => setQuestModal(true)}
            title={language === 'en' ? 'Quest' : 'Задание'}
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl bg-gradient-to-br from-cyan-200 via-sky-500 to-blue-700 border-2 border-sky-200 shadow-[0_0_16px_rgba(14,165,233,0.9)] active:scale-90 hover:scale-110 transition-transform"
          >
            📜
          </button>
        </div>

        {log[0] && (
          <p className="absolute z-20 left-1/2 -translate-x-1/2 max-w-[60%] truncate text-[10px] text-purple-100/80" style={{ bottom: `calc(${cellPct}% + 6px)` }}>
            {log[0].text}
          </p>
        )}
      </div>

      {/* Reward popup */}
      {rewardModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setRewardModal(null)}>
          <div className="card w-full max-w-xs m-4 text-center animate-pop" onClick={(e) => e.stopPropagation()}>
            <img src={rewardModal.icon} alt="" className="w-16 h-16 mx-auto mb-2 object-contain animate-float" />
            <p className="text-lg font-bold text-emerald-300">{rewardModal.text}</p>
            <button onClick={() => setRewardModal(null)} className="btn-accent w-full mt-4">{language === 'en' ? 'Claim' : 'Забрать'}</button>
          </div>
        </div>
      )}

      {/* Mystery event modal */}
      {mysteryModal && (
        <Modal title={language === 'en' ? 'Random event' : 'Случайное событие'} onClose={() => { setMysteryModal(null); setMysteryResult(null); }}>
          <div className="text-center space-y-4 py-2">
            <div className={`w-20 h-20 mx-auto rounded-2xl flex items-center justify-center ${
              mysteryModal === 'gift' ? 'bg-emerald-500/20' : mysteryModal === 'teleport' ? 'bg-sky-500/20' : 'bg-amber-500/20'
            }`}>
              {mysteryModal === 'gift' ? <Gift className="w-10 h-10 text-emerald-300" /> :
               mysteryModal === 'teleport' ? <ArrowRight className="w-10 h-10 text-sky-300" /> :
               <Dices className="w-10 h-10 text-amber-300" />}
            </div>
            <p className="text-sm text-gray-300 font-medium">{mysteryResult}</p>
            {mysteryModal === 'guaranteed' ? (
              <div className="space-y-3">
                <p className="text-xs text-amber-300">{language === 'en' ? 'Choose a number for your next roll:' : 'Выбери число для следующего броска:'}</p>
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button key={n} onClick={() => chooseDiceValue(n)} className="h-12 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-200 font-bold text-lg active:scale-90 transition-transform hover:bg-amber-500/30">{n}</button>
                  ))}
                </div>
              </div>
            ) : (
              <button onClick={() => { setMysteryModal(null); setMysteryResult(null); }} className="btn-accent w-full">{language === 'en' ? 'Great!' : 'Отлично!'}</button>
            )}
          </div>
        </Modal>
      )}

      {/* Special offer modal */}
      {specialModal && (
        <Modal title={language === 'en' ? 'Special offer' : 'Спецпредложение'} onClose={() => setSpecialModal(false)}>
          <div className="space-y-4 text-center py-2">
            <div className="flex items-center justify-center gap-3">
              <div className="flex flex-col items-center">
                <img src={CURRENCY_ART.redGems} alt="" className="w-12 h-12 object-contain" />
                <span className="text-xs text-red-300 mt-1">{language === 'en' ? 'Red crystal' : 'Красный алмаз'}</span>
              </div>
              <ArrowRight className="w-6 h-6 text-gray-400" />
              <div className="flex flex-col items-center">
                <Ticket className="w-12 h-12 text-amber-400" />
                <span className="text-xs text-amber-300 mt-1">{language === 'en' ? 'Ticket' : 'Билет'}</span>
              </div>
            </div>
            <p className="text-sm text-gray-300">{language === 'en' ? 'Exchange red crystals for tickets. 1 crystal = 1 ticket.' : 'Обменяй красные алмазы на билеты. 1 алмаз = 1 билет.'}</p>
            <div className="flex items-center justify-between rounded-xl bg-black/30 border border-white/10 px-3 h-12">
              <span className="text-xs text-gray-400">{language === 'en' ? 'Red crystals:' : 'Красных алмазов:'}</span>
              <span className="text-sm font-bold text-red-300">{state.player.redGems}</span>
            </div>
            <button
              onClick={() => {
                if (state.player.redGems < 1) return;
                setTickets((t) => t + 1);
                useGame.set({ ...state, player: { ...state.player, redGems: state.player.redGems - 1 } });
                addLog(language === 'en' ? 'Bought 1 ticket' : 'Куплен 1 билет', 'info');
                setSpecialModal(false);
              }}
              disabled={state.player.redGems < 1}
              className="btn-accent w-full"
            >{language === 'en' ? 'Buy 1 ticket' : 'Купить 1 билет'}</button>
          </div>
        </Modal>
      )}

      {/* Free gift modal */}
      {giftModal && (
        <Modal title={language === 'en' ? 'Daily gift' : 'Ежедневный подарок'} onClose={() => setGiftModal(false)}>
          <div className="space-y-4 text-center py-2">
            <Gift className="w-16 h-16 mx-auto text-emerald-300 animate-float" />
            <p className="text-sm text-gray-300">{language === 'en' ? 'Get 1 free ticket every 24 hours!' : 'Получи 1 бесплатный билет каждые 24 часа!'}</p>
            {freeTicketMs > 0 ? (
              <div className="rounded-xl bg-black/30 border border-white/10 px-3 py-3">
                <p className="text-xs text-gray-400">{language === 'en' ? 'Available in' : 'Доступно через'}</p>
                <p className="text-lg font-bold tabular-nums text-amber-200 mt-1">{formatDuration(freeTicketMs)}</p>
              </div>
            ) : (
              <button onClick={claimFreeTicket} className="btn-accent w-full">{language === 'en' ? 'Claim ticket' : 'Забрать билет'}</button>
            )}
          </div>
        </Modal>
      )}

      {/* Quest modal */}
      {questModal && (
        <Modal title={language === 'en' ? 'Ticket quests' : 'Задания для билетов'} onClose={() => setQuestModal(false)}>
          <div className="space-y-3 py-1">
            {[
              { title: language === 'en' ? 'Defeat 3 enemies' : 'Победи 3 врагов', reward: 2, progress: '0/3' },
              { title: language === 'en' ? 'Spend 100 gold' : 'Потрать 100 золота', reward: 1, progress: '0/100' },
              { title: language === 'en' ? 'Play Monopoly 5 times' : 'Сыграй в Монополию 5 раз', reward: 3, progress: '0/5' },
            ].map((q, idx) => (
              <div key={idx} className="rounded-xl bg-black/30 border border-white/10 p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                  <Ticket className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">{q.title}</p>
                  <p className="text-xs text-gray-400">{q.progress}</p>
                </div>
                <span className="text-xs font-bold text-amber-300 shrink-0">+{q.reward}</span>
              </div>
            ))}
            <p className="text-xs text-gray-500 text-center pt-2">{language === 'en' ? 'Complete quests to earn tickets' : 'Выполняй задания для билетов'}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
