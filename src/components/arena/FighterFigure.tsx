import type { CSSProperties } from 'react';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { useLanguage } from '@/game/i18n';

interface Props {
  src: string;
  combatFrames?: {
    idle: string;
    attack: string;
    block: string;
    dodge?: string;
    hit: string;
    death: string;
  };
  name: string;
  dir: 1 | -1;
  /** Mirror hero-style right-facing art for an opponent. Native-left monsters do not mirror. */
  mirror?: boolean;
  alive: boolean;
  strike: StrikeEvent | null;
  idleSeconds: number;
  className: string;
}

export function FighterFigure({ src, combatFrames, name, dir, mirror = false, alive, strike, idleSeconds, className }: Props) {
  const role = !strike ? null : strike.attacker === name ? 'attacker' : strike.target === name ? 'target' : null;
  const tone = strike?.tone;
  // Three visually distinct swings are derived from the event key.
  // These are cosmetic only and cannot alter the server's strike result.
  const swing = strike ? Math.abs(strike.key) % 3 : 0;
  const motion = role === 'attacker' ? `battle-swing-${swing}`
    : role !== 'target' ? ''
    : tone === 'dodge' ? 'animate-dodge'
    : tone === 'block' ? 'animate-guard'
    : 'animate-recoil';
  const style = { '--dir': dir } as CSSProperties;

  return (
    <div className="absolute inset-0" style={style}>
      <div key={role ? `${strike?.key}-${role}` : 'still'} className={`absolute inset-0 ${motion}`}>
        {/* Mirror the ART separately from the movement transform. Combat labels remain readable. */}
        <div className={`absolute inset-0 ${mirror ? 'battle-mirror-art' : ''}`}>
          <img
            src={!alive ? combatFrames?.death ?? src
              : role === 'attacker' ? combatFrames?.attack ?? src
              : role === 'target' && tone === 'dodge' ? combatFrames?.dodge ?? combatFrames?.idle ?? src
              : role === 'target' && tone === 'block' ? combatFrames?.block ?? src
              : role === 'target' && tone !== 'dodge' ? combatFrames?.hit ?? src
              : combatFrames?.idle ?? src}
            alt={name}
            draggable={false}
            onError={(event) => {
              // On missing art, never retry the same broken URL forever.
              const img = event.currentTarget;
              const candidates = [combatFrames?.idle, src, import.meta.env.BASE_URL + 'enemy-viking.webp'];
              const attempt = Number(img.dataset.artRetry ?? '0');
              if (attempt < candidates.length) {
                img.dataset.artRetry = String(attempt + 1);
                img.src = candidates[attempt] ?? src;
              }
            }}
            className={`${className} motion-reduce:animate-none select-none drop-shadow-[0_8px_10px_rgba(0,0,0,0.8)] transition-[filter,opacity] duration-500 ${
              alive ? 'animate-idle' : 'grayscale opacity-40 translate-y-2'
            }`}
            style={{ animationDuration: `${idleSeconds}s` }}
          />
        </div>
      </div>

      {role === 'target' && strike && <Impact key={strike.key} strike={strike} />}
    </div>
  );
}

function Impact({ strike }: { strike: StrikeEvent }) {
  const { language } = useLanguage();
  const crit = strike.tone === 'crit';
  if (strike.tone === 'dodge') {
    return (
      <>
        <span aria-hidden="true" className="battle-dodge-echo absolute left-[12%] top-[31%] h-[48%] w-[65%] rounded-full border border-cyan-200/50 bg-cyan-300/10 blur-sm pointer-events-none" />
        <span className="absolute left-1/2 top-[22%] z-30 animate-dmg text-base font-black text-cyan-200 whitespace-nowrap [text-shadow:0_2px_6px_rgba(0,0,0,0.9)]">
          {language === 'en' ? 'DODGE!' : 'Уклон!'}
        </span>
      </>
    );
  }
  if (strike.tone === 'block') {
    return (
      <>
        <span className="absolute left-1/2 top-[38%] -ml-9 -mt-9 w-[72px] h-[72px] rounded-full border-2 border-sky-300/90 bg-sky-400/20 shadow-[0_0_24px_rgba(56,189,248,0.7)] animate-shield-pulse pointer-events-none" />
        <span className="absolute left-1/2 top-[22%] z-30 animate-dmg text-base font-black text-sky-200 whitespace-nowrap [text-shadow:0_2px_6px_rgba(0,0,0,0.9)]">
          {language === 'en' ? 'BLOCK' : 'Блок'}
        </span>
      </>
    );
  }
  return (
    <>
      <span
        aria-hidden="true"
        className={`arena-impact-burst absolute left-1/2 top-[40%] h-16 w-16 rounded-full pointer-events-none ${crit ? 'arena-impact-crit' : 'arena-impact-normal'}`}
      />
      <span
        aria-hidden="true"
        className={`battle-sword-arc battle-sword-arc-${Math.abs(strike.key) % 3} absolute left-[-16%] right-[-16%] top-[38%] z-30 pointer-events-none ${crit ? 'battle-sword-arc-crit' : ''}`}
      />
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
        {crit && <span className="block text-[10px] tracking-[0.3em] text-amber-200 text-center">{language === 'en' ? 'CRIT' : 'КРИТ'}</span>}
        −{strike.amount ?? 0}
      </span>
    </>
  );
}
