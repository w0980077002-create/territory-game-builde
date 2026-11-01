import { useEffect, useState, type CSSProperties } from 'react';
import { SkeletalFighter } from '@/components/combat2d/SkeletalFighter';
import { CombatEffects } from '@/components/combat2d/CombatEffects';
import { getFighterRig, rigAsset } from '@/components/combat2d/fighterRigs';
import { ACTION_MS, CONTACT_MS, RECOVERY_MS, WINDUP_MS } from '@/components/combat2d/fighterAnimations';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { useLanguage } from '@/game/i18n';
import './fighterEffects.css';

type PosePhase = 'windup' | 'action' | 'contact' | 'recovery' | 'finished';
const visualIds = new WeakMap<StrikeEvent, number>();
let nextVisualId = 0;
function visualId(event: StrikeEvent): number {
  let id = visualIds.get(event);
  if (id === undefined) { id = ++nextVisualId; visualIds.set(event, id); }
  return id;
}

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
  const speed = Number.isFinite(combatSpeed) && combatSpeed > 0 ? combatSpeed : 1;
  const artIdentity = combatFrames?.idle ?? src;
  const skeletalReady = !!rig && enabledRig === rig.id && assets?.id === rig.id && assets.ready;
  const [timeline, setTimeline] = useState<{ event: StrikeEvent; src: string; art: string; name: string; phase: PosePhase } | null>(null);
  const event = role && !skeletalReady ? strike : null;
  useEffect(() => {
    if (!event) { setTimeline(null); return; }
    // Presentation only: all phases belong to this already-resolved event.
    const timers = ([[WINDUP_MS, 'action'], [CONTACT_MS, 'contact'], [RECOVERY_MS, 'recovery'], [ACTION_MS, 'finished']] as const)
      .map(([at, phase]) => window.setTimeout(() => setTimeline({ event, src, art: artIdentity, name, phase }), at / speed));
    return () => timers.forEach(window.clearTimeout);
  }, [event, speed, src, artIdentity, name]);
  const phase: PosePhase = event && timeline?.event === event && timeline.src === src && timeline.art === artIdentity && timeline.name === name
    ? timeline.phase : 'windup';
  const performing = !!event && phase !== 'finished';
  useEffect(() => {
    if (!rig || (assets?.id === rig.id && !assets.ready)) setEnabledRig(null);
    else if (assets?.id === rig.id && assets.ready && !role) setEnabledRig(rig.id);
    // A slow asset response must not start a fresh windup halfway through a hit.
    // Activate between strikes; once active, the same hierarchy stays mounted.
  }, [rig, assets, role]);
  const tone = strike?.tone;
  const swing = strike ? Math.abs(strike.key) % 3 : 0;
  const motion = !performing ? (!strike && alive && won ? 'fighter-victory' : '') : role === 'attacker' ? `battle-swing-${swing}`
    : role !== 'target' ? ''
    : tone === 'dodge' ? 'animate-dodge'
    : tone === 'block' ? 'animate-guard'
    : 'animate-recoil';
  const size = Number.isFinite(scale) ? Math.min(1.35, Math.max(0.8, scale)) : 1;
  const lowQuality = typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4;
  const style = {
    '--dir': dir,
    '--fighter-scale': size,
    '--fighter-hit-delay': `${Math.round(CONTACT_MS / speed)}ms`,
    '--fighter-impact-duration': `${Math.round((ACTION_MS - CONTACT_MS) / speed)}ms`,
    '--fighter-motion-duration': `${Math.round(ACTION_MS / speed)}ms`,
    '--fighter-sweep-duration': `${Math.round(440 / speed)}ms`,
    '--fighter-idle-duration': `${idleSeconds}s`,
  } as CSSProperties;

  if (rig && skeletalReady) return (
    <div className="fighter-figure absolute inset-0 pointer-events-none" style={style} data-quality={lowQuality ? 'low' : 'full'}>
      <div className="fighter-figure__size absolute inset-0">
        <div className={className}>
          <SkeletalFighter rig={rig} name={name} dir={dir} alive={alive} won={won} strike={strike} speed={speed} className="absolute inset-0 w-full h-full"
            onAssetError={() => setAssets({ id: rig.id, ready: false })} />
          <CombatEffects strike={strike} role={role} won={won} />
        </div>
      </div>
    </div>
  );

  const idle = combatFrames?.idle ?? src;
  const isAction = performing && (phase === 'action' || phase === 'contact');
  const poseKind = !strike && !alive ? 'death'
    : isAction && role === 'attacker' ? 'attack'
    : isAction && role === 'target' && tone === 'dodge' ? 'dodge'
    : isAction && role === 'target' && tone === 'block' ? 'block'
    : phase === 'contact' && role === 'target' ? 'hit' : 'idle';
  const pose = poseKind === 'idle' ? idle : combatFrames?.[poseKind] ?? idle;

  return (
    <div className="fighter-figure absolute inset-0 pointer-events-none" style={style} data-quality={lowQuality ? 'low' : 'full'}>
      <div key={event ? `${visualId(event)}-${role}` : 'still'} data-pose={poseKind} data-phase={event ? phase : 'idle'} className={`fighter-figure__motion absolute inset-0 ${motion}`}>
        <div className="fighter-figure__size absolute inset-0">
          <div className={`fighter-figure__breath absolute inset-0 ${!performing && alive && !won ? 'fighter-figure__breath--idle' : ''}`}>
            <div className={`absolute inset-0 ${mirror ? 'battle-mirror-art' : ''}`}>
            {role === 'attacker' && isAction && (
              <img src={pose} alt="" aria-hidden="true" draggable={false}
                onError={event => { event.currentTarget.style.visibility = 'hidden'; }}
                className={`${className} fighter-figure__afterimage select-none`} />
            )}
            <SafeFighterArt key={`${pose}|${artIdentity}`} pose={pose} idle={artIdentity} name={name}
              className={`${className} select-none drop-shadow-[0_8px_10px_rgba(0,0,0,0.8)] ${poseKind === 'death' ? 'grayscale opacity-40 translate-y-2' : ''}`} />
            </div>
          </div>
        </div>
        {role === 'attacker' && performing && <>
          <span aria-hidden="true" className={`fighter-figure__sweep fighter-figure__sweep--${swing}`} />
          <span aria-hidden="true" className="fighter-figure__footstep" />
        </>}
      </div>
      {role === 'target' && strike && <Impact key={visualId(strike)} strike={strike} />}
    </div>
  );
}

/** Never substitute another character when an art file is unavailable. */
function SafeFighterArt({ pose, idle, name, className }: { pose: string; idle: string; name: string; className: string }) {
  const { language } = useLanguage();
  const [attempt, setAttempt] = useState(0);
  const candidates = pose === idle ? [idle] : [pose, idle];
  if (attempt >= candidates.length) return <span role="img" aria-label={`${name}: ${language === 'en' ? 'image unavailable' : 'изображение недоступно'}`} data-testid="fighter-art-unavailable"
    className="absolute inset-0 flex items-center justify-center text-2xl text-white/70">?</span>;
  return <img src={candidates[attempt]} alt={name} draggable={false} className={className}
    onError={() => setAttempt(current => current + 1)} />;
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
