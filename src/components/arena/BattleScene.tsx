import { Shield, Sword, Loader2, Check, Lock, RotateCcw, Skull, Bot, Hourglass } from 'lucide-react';
import { ZONES, type ArenaFighter, type Zone } from '@/game/arenaApi';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { FighterFigure } from './FighterFigure';

interface Props {
  me: ArenaFighter;
  enemy: ArenaFighter | null;
  followerName: string;
  active: boolean;
  moved: boolean;
  auto: boolean;
  autoLocked: boolean;
  autoMinVip: number;
  attack: Zone | null;
  blocks: Zone[];
  busy: boolean;
  movedCount: number;
  aliveCount: number;
  strike: StrikeEvent | null;
  canRepeat: boolean;
  onAttack: (z: Zone) => void;
  onToggleBlock: (z: Zone) => void;
  onStrike: () => void;
  onRepeat: () => void;
  onToggleAuto: () => void;
}

function Plate({ fighter, side }: { fighter: ArenaFighter; side: 'ally' | 'enemy' }) {
  const pct = Math.max(0, (fighter.hp / fighter.maxHp) * 100);
  const low = pct <= 30;
  return (
    <div className="w-full rounded-lg bg-black/55 backdrop-blur-sm px-2 py-1 border border-white/10">
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[11px] font-semibold truncate ${side === 'ally' ? 'text-teal-200' : 'text-red-200'}`}>{fighter.name}</span>
        <span className="text-[10px] text-gray-300 shrink-0">{fighter.level} ур.</span>
      </div>
      <div className="h-1.5 rounded-full bg-black/60 overflow-hidden mt-0.5">
        <div
          className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${
            low ? 'from-red-500 to-orange-400' : side === 'ally' ? 'from-emerald-500 to-teal-300' : 'from-red-600 to-red-400'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-gray-200 tabular-nums text-right leading-tight mt-0.5">{fighter.hp}/{fighter.maxHp}</p>
    </div>
  );
}

function ZoneButton({ label, sub, selected, tone, disabled, onClick }: {
  label: string; sub?: string; selected: boolean; tone: 'def' | 'atk'; disabled: boolean; onClick: () => void;
}) {
  const on = tone === 'def'
    ? 'bg-sky-500/35 border-sky-300 text-white shadow-[0_0_14px_rgba(56,189,248,0.45)]'
    : 'bg-red-500/35 border-red-300 text-white shadow-[0_0_14px_rgba(248,113,113,0.45)]';
  const Icon = tone === 'def' ? Shield : Sword;
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`relative w-full h-12 rounded-xl border flex flex-col items-center justify-center transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${
        selected ? on : 'bg-black/55 border-white/15 text-gray-200 hover:border-white/40 backdrop-blur-sm'
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${selected ? '' : tone === 'def' ? 'text-sky-300' : 'text-red-300'}`} />
      <span className="text-[10px] font-semibold leading-tight mt-0.5">{label}</span>
      {sub && <span className="text-[8px] leading-none text-gray-300">{sub}</span>}
    </button>
  );
}

export function BattleScene(props: Props) {
  const {
    me, enemy, followerName, active, moved, auto, autoLocked, autoMinVip, attack, blocks, busy,
    movedCount, aliveCount, strike, canRepeat, onAttack, onToggleBlock, onStrike, onRepeat, onToggleAuto,
  } = props;
  const alive = me.hp > 0;
  const controls = active && alive && !moved && !auto;
  const ready = controls && !!attack && blocks.length === 2 && !!enemy && enemy.hp > 0;

  const status = !active ? null
    : !alive ? { icon: Skull, text: 'Ты пал', tone: 'text-gray-200' }
    : auto ? { icon: Bot, text: 'Автобой', tone: 'text-amber-200' }
    : moved ? { icon: Hourglass, text: `Ждём ${movedCount}/${aliveCount}`, tone: 'text-emerald-200' }
    : null;

  const hint = !controls ? '' : !enemy ? 'Выбери цель' : blocks.length < 2
    ? `Защита: выбери ещё ${2 - blocks.length}` : !attack ? 'Выбери зону удара' : `Удар по ${enemy.name}`;

  return (
    <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-xl shadow-black/40">
      <img src="/arena-bg.webp" alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/85" />

      <div className="relative grid grid-cols-[56px_1fr_56px] gap-2 p-2 pt-3">
        <div className="flex flex-col gap-1.5 pt-6">
          <p className="text-[9px] uppercase tracking-wider text-sky-200 text-center font-semibold">Защита {blocks.length}/2</p>
          {ZONES.map((z) => (
            <ZoneButton key={z.id} label={z.label} tone="def" selected={blocks.includes(z.id)} disabled={!controls} onClick={() => onToggleBlock(z.id)} />
          ))}
        </div>

        <div className="relative grid grid-cols-2 gap-1 min-h-[260px]">
          {status && (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 px-2.5 py-1 rounded-full bg-black/70 border border-white/10 flex items-center gap-1 animate-fade-in">
              <status.icon className={`w-3 h-3 ${status.tone}`} />
              <span className={`text-[10px] font-semibold whitespace-nowrap ${status.tone}`}>{status.text}</span>
            </div>
          )}

          <div className="flex flex-col min-w-0">
            <Plate fighter={me} side="ally" />
            <div className="relative flex-1 mt-1">
              <img
                src="/follower-shield.webp"
                alt={followerName}
                title={followerName}
                draggable={false}
                className={`absolute -left-3 bottom-1 h-[58%] w-auto max-w-none object-contain select-none drop-shadow-[0_6px_8px_rgba(0,0,0,0.7)] ${alive ? 'opacity-90 animate-idle' : 'grayscale opacity-40'}`}
                style={{ animationDuration: '3.7s', animationDelay: '-1.2s' }}
              />
              <FighterFigure
                src="/hero-viking.webp"
                name={me.name}
                dir={1}
                alive={alive}
                strike={strike}
                idleSeconds={3.1}
                className="absolute right-0 bottom-0 h-[88%] w-[86%] object-contain object-right-bottom"
              />
            </div>
          </div>

          <div className="flex flex-col min-w-0">
            {enemy ? (
              <>
                <Plate fighter={enemy} side="enemy" />
                <div className="relative flex-1 mt-1">
                  <FighterFigure
                    key={enemy.id}
                    src="/enemy-viking.webp"
                    name={enemy.name}
                    dir={-1}
                    alive={enemy.hp > 0}
                    strike={strike}
                    idleSeconds={2.8}
                    className="absolute left-0 bottom-0 h-[88%] w-[92%] object-contain object-left-bottom"
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[11px] text-gray-300">Противников нет</div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 pt-6">
          <p className="text-[9px] uppercase tracking-wider text-red-200 text-center font-semibold">Удар</p>
          {ZONES.map((z) => (
            <ZoneButton
              key={z.id}
              label={z.label}
              sub={z.mult !== 1 ? `×${z.mult}` : undefined}
              tone="atk"
              selected={attack === z.id}
              disabled={!controls}
              onClick={() => onAttack(z.id)}
            />
          ))}
        </div>
      </div>

      {active && alive && (
        <div className="relative px-2 pb-2">
          <p className="text-[11px] text-gray-200 text-center h-4 mb-1 truncate">{hint}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleAuto}
              disabled={busy || (autoLocked && !auto)}
              title={autoLocked ? `Автобой доступен с VIP ${autoMinVip}` : 'Сервер будет бить за тебя'}
              className="shrink-0 flex items-center gap-1.5 h-11 px-2 rounded-xl bg-black/55 border border-white/15 backdrop-blur-sm transition-colors hover:border-amber-300/50 disabled:opacity-50"
            >
              <span className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${auto ? 'bg-amber-400 border-amber-400' : 'border-white/40'}`}>
                {auto && <Check className="w-3 h-3 text-black" strokeWidth={3} />}
              </span>
              <span className="text-[10px] font-semibold text-gray-100 leading-tight text-left">
                Авто<br />бой
              </span>
              {autoLocked && <Lock className="w-3 h-3 text-amber-300" />}
            </button>

            <button
              disabled={!ready || busy}
              onClick={onStrike}
              className={`flex-1 h-11 rounded-xl font-black tracking-[0.2em] text-base flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 bg-gradient-to-b from-red-500 to-red-700 text-white border border-red-300/40 ${
                ready && !busy ? 'animate-strike-ready' : ''
              }`}
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sword className="w-5 h-5" />} УДАР
            </button>

            <button
              onClick={onRepeat}
              disabled={!controls || !canRepeat}
              title="Повторить прошлый выбор зон"
              className="shrink-0 w-11 h-11 rounded-xl bg-black/55 border border-white/15 flex items-center justify-center text-gray-100 transition-colors hover:border-white/40 disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
