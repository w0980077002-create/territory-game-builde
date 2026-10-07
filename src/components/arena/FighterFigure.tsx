import type { CSSProperties } from 'react';
import type { StrikeEvent } from '@/game/useStrikeQueue';

interface Props {
  src: string;
  name: string;
  dir: 1 | -1;
  alive: boolean;
  strike: StrikeEvent | null;
  idleSeconds: number;
  className: string;
}

export function FighterFigure({ src, name, dir, alive, strike, idleSeconds, className }: Props) {
  const role = !strike ? null : strike.attacker === name ? 'attacker' : strike.target === name ? 'target' : null;
  const tone = strike?.tone;
  const motion = role === 'attacker' ? 'animate-lunge'
    : role !== 'target' ? ''
    : tone === 'dodge' ? 'animate-dodge'
    : tone === 'block' ? 'animate-guard'
    : 'animate-recoil';

  const style = { '--dir': dir } as CSSProperties;

  return (
    <div className="absolute inset-0" style={style}>
      <div key={role ? `${strike?.key}-${role}` : 'still'} className={`absolute inset-0 ${motion}`}>
        <img
          src={src}
          alt={name}
          draggable={false}
          className={`${className} select-none drop-shadow-[0_8px_10px_rgba(0,0,0,0.8)] transition-[filter,opacity] duration-500 ${
            alive ? 'animate-idle' : 'grayscale opacity-40 translate-y-2'
          }`}
          style={{ animationDuration: `${idleSeconds}s` }}
        />
      </div>

      {role === 'target' && strike && <Impact key={strike.key} strike={strike} />}
    </div>
  );
}

function Impact({ strike }: { strike: StrikeEvent }) {
  const crit = strike.tone === 'crit';
  if (strike.tone === 'dodge') {
    return (
      <span className="absolute left-1/2 top-[22%] z-30 animate-dmg text-base font-black text-cyan-200 whitespace-nowrap [text-shadow:0_2px_6px_rgba(0,0,0,0.9)]">
        Уклон!
      </span>
    );
  }
  if (strike.tone === 'block') {
    return (
      <>
        <span className="absolute left-1/2 top-[38%] -ml-9 -mt-9 w-[72px] h-[72px] rounded-full border-2 border-sky-300/90 bg-sky-400/20 shadow-[0_0_24px_rgba(56,189,248,0.7)] animate-shield-pulse pointer-events-none" />
        <span className="absolute left-1/2 top-[22%] z-30 animate-dmg text-base font-black text-sky-200 whitespace-nowrap [text-shadow:0_2px_6px_rgba(0,0,0,0.9)]">
          Блок
        </span>
      </>
    );
  }
  return (
    <>
      <span
        className={`absolute left-[12%] right-[12%] top-[40%] rounded-full pointer-events-none animate-slash ${
          crit
            ? 'h-1.5 bg-gradient-to-r from-transparent via-amber-200 to-transparent shadow-[0_0_18px_rgba(251,191,36,0.95)]'
            : 'h-1 bg-gradient-to-r from-transparent via-white to-transparent shadow-[0_0_14px_rgba(248,113,113,0.95)]'
        }`}
      />
      <span
        className={`absolute left-1/2 top-[18%] z-30 animate-dmg font-black whitespace-nowrap [text-shadow:0_2px_8px_rgba(0,0,0,0.95)] ${
          crit ? 'text-3xl text-amber-300' : 'text-2xl text-red-500'
        }`}
      >
        {crit && <span className="block text-[10px] tracking-[0.3em] text-amber-200 text-center">КРИТ</span>}
        −{strike.amount ?? 0}
      </span>
    </>
  );
}
