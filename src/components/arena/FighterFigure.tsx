import { useEffect, useState, type CSSProperties } from 'react';
import { SkeletalFighter } from '@/components/combat2d/SkeletalFighter';
import { CombatEffects } from '@/components/combat2d/CombatEffects';
import { getFighterRig, rigAsset } from '@/components/combat2d/fighterRigs';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { useLanguage } from '@/game/i18n';
import './fighterEffects.css';

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
  /** Mirror right-facing hero artwork for a left-facing opponent. */
  mirror?: boolean;
  alive: boolean;
  won?: boolean;
  strike: StrikeEvent | null;
  idleSeconds: number;
  combatSpeed?: number;
  /** Enlarge the EXISTING artwork without introducing replacement characters. */
  scale?: number;
  className: string;
}

export function FighterFigure({
  src, combatFrames, name, dir, mirror = false, alive, won = false, strike,
  idleSeconds, combatSpeed = 1, scale = 1, className,
}: Props) {
  const rig = getFighterRig(combatFrames?.idle ?? src);
  const [assets, setAssets] = useState<{ id: string; ready: boolean } | null>(null);
  const [enabledRig, setEnabledRig] = useState<string | null>(null);
  useEffect(() => {
    if (!rig) return;
    let cancelled = false;
    const images = ['head', 'torso', 'arm-right', 'arm-left', 'leg-right', 'leg-left', 'weapon', 'shield'].map(part => {
      const img = new Image();
      img.src = rigAsset(rig, part);
      return img;
    });
    Promise.all(images.map(img => img.decode())).then(() => {
      if (!cancelled) setAssets({ id: rig.id, ready: true });
    }, () => { if (!cancelled) setAssets({ id: rig.id, ready: false }); });
    return () => { cancelled = true; };
  }, [rig]);
  // The existing server/combat queue is the ONLY source for attacks and damage.
  const role = !strike ? null : strike.attacker === name ? 'attacker' : strike.target === name ? 'target' : null;
  useEffect(() => {
    if (!rig || (assets?.id === rig.id && !assets.ready)) setEnabledRig(null);
    else if (assets?.id === rig.id && assets.ready && !role) setEnabledRig(rig.id);
    // A slow asset response must not start a fresh windup halfway through a hit.
    // Activate between strikes; once active, the same hierarchy stays mounted.
  }, [rig, assets, role]);
  const tone = strike?.tone;
  const swing = strike ? Math.abs(strike.key) % 3 : 0;
  const motion = role === 'attacker' ? `battle-swing-${swing}`
    : role !== 'target' ? ''
    : tone === 'dodge' ? 'animate-dodge'
    : tone === 'block' ? 'animate-guard'
    : 'animate-recoil';
  const speed = Number.isFinite(combatSpeed) && combatSpeed > 0 ? combatSpeed : 1;
  const size = Number.isFinite(scale) ? Math.min(1.35, Math.max(0.8, scale)) : 1;
  const style = {
    '--dir': dir,
    '--fighter-scale': size,
    '--fighter-hit-delay': `${Math.round(350 / speed)}ms`,
    '--fighter-impact-duration': `${Math.round(470 / speed)}ms`,
    '--fighter-motion-duration': `${Math.round(810 / speed)}ms`,
    '--fighter-sweep-duration': `${Math.round(440 / speed)}ms`,
    '--fighter-idle-duration': `${idleSeconds}s`,
  } as CSSProperties;

  if (rig && enabledRig === rig.id && assets?.id === rig.id && assets.ready) return (
    <div className="fighter-figure absolute inset-0 pointer-events-none" style={style}>
      <div className="fighter-figure__size absolute inset-0">
        <div className={className}>
          <SkeletalFighter rig={rig} name={name} dir={dir} alive={alive} won={won} strike={strike} speed={speed} className="absolute inset-0 w-full h-full"
            onAssetError={() => setAssets({ id: rig.id, ready: false })} />
          <CombatEffects strike={strike} role={role} won={won} speed={speed} />
        </div>
      </div>
    </div>
  );

  const pose = !alive && !role ? combatFrames?.death ?? src
    : role === 'attacker' ? combatFrames?.attack ?? src
    : role === 'target' && tone === 'dodge' ? combatFrames?.dodge ?? combatFrames?.idle ?? src
    : role === 'target' && tone === 'block' ? combatFrames?.block ?? src
    : role === 'target' ? combatFrames?.hit ?? src
    : combatFrames?.idle ?? src;

  return (
    <div className="fighter-figure absolute inset-0 pointer-events-none" style={style}>
      <div key={role ? `${strike?.key}-${role}` : 'still'} className={`fighter-figure__motion absolute inset-0 ${motion}`}>
        <div className="fighter-figure__size absolute inset-0">
          <div className={`fighter-figure__breath absolute inset-0 ${!role && alive ? 'fighter-figure__breath--idle' : ''}`}>
            <div className={`absolute inset-0 ${mirror ? 'battle-mirror-art' : ''}`}>
            {role === 'attacker' && alive && (
              <img src={pose} alt="" aria-hidden="true" draggable={false}
                className={`${className} fighter-figure__afterimage select-none`} />
            )}
            <img
              src={pose}
              alt={name}
              draggable={false}
              onError={(event) => {
                // Missing poses fall back to the same character's idle art.
                const img = event.currentTarget;
                const candidates = [combatFrames?.idle, src, import.meta.env.BASE_URL + 'assets/territory/characters/heroes/male_viking/idle.webp'];
                const attempt = Number(img.dataset.artRetry ?? '0');
                if (attempt < candidates.length) {
                  img.dataset.artRetry = String(attempt + 1);
                  img.src = candidates[attempt] ?? src;
                }
              }}
              className={`${className} select-none drop-shadow-[0_8px_10px_rgba(0,0,0,0.8)] ${!alive ? 'grayscale opacity-40 translate-y-2' : ''}`}
            />
            </div>
          </div>
        </div>
        {role === 'attacker' && <>
          <span aria-hidden="true" className={`fighter-figure__sweep fighter-figure__sweep--${swing}`} />
          <span aria-hidden="true" className="fighter-figure__footstep" />
        </>}
      </div>
      {role === 'target' && strike && <Impact key={strike.key} strike={strike} />}
    </div>
  );
}

function Impact({ strike }: { strike: StrikeEvent }) {
  const { language } = useLanguage();
  const crit = strike.tone === 'crit';
  const label = strike.tone === 'dodge' ? (language === 'en' ? 'DODGE!' : 'УКЛОН!')
    : strike.tone === 'block' ? (language === 'en' ? 'BLOCK!' : 'БЛОК!') : null;

  return (
    <div className={`fighter-impact fighter-impact--${strike.tone}`} aria-hidden="true">
      {strike.tone === 'dodge'
        ? <span className="fighter-impact__trail" />
        : strike.tone === 'block'
          ? <span className="fighter-impact__shield" />
          : <>
            <span className="fighter-impact__flash" />
            <span className="fighter-impact__arc" />
            <span className="fighter-impact__spark" />
            <span className="fighter-impact__shock" />
          </>}
      {(label || strike.amount !== null) && (
        <span className="fighter-impact__label">
          {crit && <small>{language === 'en' ? 'CRIT!' : 'КРИТ!'}</small>}
          {label ?? `−${strike.amount}`}
        </span>
      )}
    </div>
  );
}
