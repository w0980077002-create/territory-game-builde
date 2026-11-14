import { useEffect, useRef, useState } from 'react';
import type { CombatAppearance } from '@/game/appearance';
import type { IdleCombatEvent, IdleCombatState } from '@/game/idleEngine/types';
import type { CaveFloor } from '@/game/cave/floors';
import { sprite } from '../cavePreview/renderer';
import './liveBattle.css';

type Props = {
  sessionId: string; state: IdleCombatState; events: IdleCombatEvent[]; floor: CaveFloor;
  hero: CombatAppearance; enemy: CombatAppearance; follower?: string;
  heroName: string; enemyName: string; en: boolean; frozen: boolean;
};
type VisualEvent = { event: IdleCombatEvent; born: number };
const root = import.meta.env.BASE_URL + 'assets/territory/';
const hp = (state: IdleCombatState, side: 'hero' | 'enemy') => {
  const stats = state.actors[side].stats;
  return Math.max(0, Math.min(1, stats.hp / Math.max(1, stats.maxHp)));
};

/** Presentation of authenticated receipts. No simulation, RNG, rewards, saves,
 * damage prediction, or game-state writes live in this component. */
export function CaveBattleScene(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const clock = useRef(0);
  const queue = useRef<IdleCombatEvent[]>([]);
  const effects = useRef<VisualEvent[]>([]);
  const seen = useRef(new Set<string>());
  const previousSession = useRef('');
  const nextAt = useRef(0);
  const wakeDraw = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (previousSession.current === props.sessionId) return;
    previousSession.current = props.sessionId;
    seen.current.clear(); queue.current = []; effects.current = []; clock.current = 0; nextAt.current = 0;
  }, [props.sessionId]);
  useEffect(() => {
    for (const event of props.events) {
      if (seen.current.has(event.id)) continue;
      seen.current.add(event.id);
      if (['impact', 'critical', 'block', 'dodge', 'heal', 'rune_proc', 'phase_change'].includes(event.type)) queue.current.push(event);
    }
    // Only recent effects are relevant after a long reconnect. All receipts
    // still remain in the server log; this bounds presentation memory.
    queue.current = queue.current.slice(-12);
  }, [props.events, props.sessionId]);
  useEffect(() => { wakeDraw.current?.(); }, [props.frozen, props.state, props.events]);

  useEffect(() => {
    let disposed = false, frame = 0;
    const images = new Map<string, HTMLImageElement>();
    const paths = [...new Set([
      root + 'cave-expedition/chambers.webp', root + 'cave-expedition/crystal-chamber.webp',
      root + 'cave/scene/foreground.svg',
      ...Object.values(props.hero), ...Object.values(props.enemy), props.follower,
    ].filter((path): path is string => !!path))];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const load = (path: string) => new Promise<void>(resolve => {
      const img = new Image(); img.onload = () => { images.set(path, img); resolve(); };
      img.onerror = () => { if (!disposed) setFailed(true); resolve(); }; img.src = path;
    });
    setLoaded(false); setFailed(false);
    let last = 0;
    const draw = (now: number) => {
      if (disposed) return;
      const el = canvas.current, c = el?.getContext('2d');
      if (!el || !c) return;
      const p = latest.current;
      const active = !p.frozen && document.visibilityState === 'visible';
      const delta = last && active ? Math.min(.05, (now - last) / 1000) : 0;
      last = now; clock.current += delta;
      const t = clock.current, width = 430, height = Math.max(160, Math.round(el.clientHeight / Math.max(1, el.clientWidth) * 430)), ground = height * .87;
      const actorScale = Math.min(1.2, height / 310);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (el.width !== width * dpr || el.height !== height * dpr) { el.width = width * dpr; el.height = height * dpr; }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, width, height);
      // Five original chambers from the existing expedition library, using
      // the actual authoritative floor, never a second playable world.
      const crystal = p.floor.depth.id === 1;
      const backdrop = images.get(root + 'cave-expedition/' + (crystal ? 'crystal-chamber.webp' : 'chambers.webp'));
      const approaching = p.state.atMs < (p.state.input.rules.approachMs ?? 0);
      const travel = reduced.matches ? 1 : Math.min(1, t / 1.3);
      const camera = (1 - Math.cos(travel * Math.PI / 2)) * 65;
      c.fillStyle = '#0b0a12'; c.fillRect(0, 0, width, height);
      if (backdrop) {
        const panel = p.floor.depth.id - 2, sw = crystal ? backdrop.width : backdrop.width / 2, sh = crystal ? backdrop.height : backdrop.height / 2;
        const scale = Math.max(530 / sw, (height + 70) / sh);
        c.drawImage(backdrop, crystal ? 0 : panel % 2 * sw, crystal ? 0 : Math.floor(panel / 2) * sh,
          sw, sh, -35 - camera * .22, height - sh * scale, sw * scale, sh * scale);
      }
      const shade = c.createLinearGradient(0, 0, 0, height);
      shade.addColorStop(0, '#080713c9'); shade.addColorStop(.35, '#08071300'); shade.addColorStop(1, '#08071360');
      c.fillStyle = shade; c.fillRect(0, 0, width, height);
      // Separate far dust and near ground planes move at different speeds.
      for (let i = 0; i < (reduced.matches ? 6 : 22); i++) {
        const x = ((i * 61 - camera * .35 + (reduced.matches ? 0 : Math.sin(t * .4 + i) * 12)) % 450 + 450) % 450;
        c.globalAlpha = .16 + (Math.sin(t + i) + 1) * .12; c.fillStyle = p.floor.depth.hue;
        c.beginPath(); c.arc(x, 55 + i * 31 % Math.max(1, height - 60), i % 3 === 0 ? 2 : 1, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;
      if (active && queue.current.length && t >= nextAt.current) {
        const event = queue.current.shift()!;
        effects.current.push({ event, born: t });
        nextAt.current = t + .22;
      }
      effects.current = effects.current.filter(effect => t - effect.born < .8);
      const heroX = 156 - (1 - travel) * 65, enemyX = 335 + (1 - travel) * 45;
      const recent = (side: 'hero' | 'enemy') => [...effects.current].reverse().find(({ event }) => event.actor === side || event.target === side);
      const paint = (url: string | undefined, x: number, y: number, size: number, flip = false, lean = 0) => {
        const img = url ? images.get(url) : undefined;
        if (!img) return;
        c.fillStyle = '#0007'; c.beginPath(); c.ellipse(x, y + 2, size * .23, 6, 0, 0, Math.PI * 2); c.fill();
        c.save(); c.translate(x, y); c.scale(flip ? -1 : 1, 1); c.rotate(lean);
        sprite(c, img, 0, 0, img.width, img.height, 0, 0, size, size); c.restore();
      };
      // Companions walk with the hero. Do not invent attacks or healing for
      // companions whose abilities are not represented in the server receipt.
      paint(p.follower, heroX - 83, ground - 25 + (active && !reduced.matches ? Math.sin(t * 2) * 2 : 0), 103 * actorScale);
      for (const side of ['hero', 'enemy'] as const) {
        const event = recent(side), age = event ? t - event.born : 1;
        const frames = side === 'hero' ? p.hero : p.enemy;
        const isTarget = event?.event.target === side;
        const attacking = !!event && event.event.actor === side && !['heal', 'phase_change'].includes(event.event.type);
        const pose = hp(p.state, side) === 0 ? 'death' : age < .5 && event
          ? isTarget ? event.event.type === 'dodge' ? 'dodge' : event.event.type === 'block' ? 'block' : 'hit'
            : attacking ? 'attack' : 'idle' : 'idle';
        const lunge = !reduced.matches && attacking ? Math.sin(Math.min(1, age / .5) * Math.PI) * 24 : 0;
        const recoil = !reduced.matches && isTarget ? Math.max(0, 1 - age / .4) * 8 : 0;
        const walk = !reduced.matches && (travel < 1 || approaching) ? Math.sin(t * 12) * .025 : 0;
        const size = actorScale * (side === 'hero' ? 167 : p.floor.kind === 'boss' ? 199 : p.floor.kind === 'elite' ? 166 : 147);
        paint(frames[pose] ?? frames.idle, side === 'hero' ? heroX + lunge - recoil : enemyX - lunge + recoil,
          ground + (pose === 'idle' && !reduced.matches ? Math.sin(t * 2.2) * 1.6 : 0), size, side === 'enemy', walk);
      }
      const front = images.get(root + 'cave/scene/foreground.svg');
      if (front) { c.globalAlpha = .48; c.drawImage(front, -camera * .14, 0, width + 20, height); c.globalAlpha = 1; }
      for (const { event, born } of effects.current) {
        const age = t - born, x = event.target === 'hero' ? heroX : enemyX;
        c.save(); c.globalAlpha = Math.max(0, 1 - age / .8);
        const healing = event.type === 'heal', ward = ['block', 'dodge', 'rune_proc', 'phase_change'].includes(event.type);
        c.strokeStyle = healing ? '#a6efc1' : ward ? '#a9dcff' : '#ffe8ae';
        c.shadowColor = c.strokeStyle; c.shadowBlur = reduced.matches ? 0 : 8;
        if (!reduced.matches && !ward) {
          c.lineWidth = 3 * (1 - age);
          for (let ray = 0; ray < 7; ray++) {
            const angle = ray * .9; c.beginPath(); c.moveTo(x, ground - 65 * actorScale);
            c.lineTo(x + Math.cos(angle) * (10 + age * 48), ground - 65 * actorScale + Math.sin(angle) * (10 + age * 48)); c.stroke();
          }
        }
        c.font = `bold ${event.type === 'critical' ? 23 : 17}px system-ui`; c.textAlign = 'center'; c.fillStyle = c.strokeStyle;
        const label = event.type === 'dodge' ? (p.en ? 'EVADE' : 'УКЛОН') : event.type === 'block' ? (p.en ? 'BLOCK' : 'БЛОК')
          : event.type === 'rune_proc' ? (p.en ? 'RUNE' : 'РУНА') : event.type === 'phase_change' ? (p.en ? 'PHASE' : 'ФАЗА')
            : (healing ? '+' : '−') + Math.floor(event.value ?? 0);
        c.fillText(label, x, ground - 125 * actorScale - age * 35); c.restore();
      }
      // Skip continuous rendering in background; resume without wall-clock catchup.
      if (active) frame = requestAnimationFrame(draw);
    };
    const wake = () => { if (!disposed && document.visibilityState === 'visible') { cancelAnimationFrame(frame); last = 0; frame = requestAnimationFrame(draw); } };
    document.addEventListener('visibilitychange', wake);
    void Promise.all(paths.map(load)).then(() => { if (!disposed) { wakeDraw.current = wake; setLoaded(true); frame = requestAnimationFrame(draw); } });
    return () => { disposed = true; wakeDraw.current = null; cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', wake); };
  }, [props.hero, props.enemy, props.follower, props.sessionId]);

  return <div className="cv-live-scene" data-testid="dark-cave-arena" data-frozen={props.frozen}>
    <canvas ref={canvas} data-testid="dark-cave-battle-background" role="img"
      aria-label={`${props.heroName} / ${props.enemyName}`} />
    {!loaded && <p className="cv-scene-status" role="status">{props.en ? 'Entering the depths…' : 'Входим в глубины…'}</p>}
    {failed && <p className="cv-scene-status" role="status">{props.en ? 'Some artwork could not load. Battle controls remain available.' : 'Часть изображений не загрузилась. Управление боем доступно.'}</p>}
    <div className="cv-arena-hud" data-testid="dark-cave-hud">
      {(['hero', 'enemy'] as const).map(side => <div key={side} className="cv-hp">
        <p className="cv-hp-name"><span className="truncate">{side === 'hero' ? props.heroName : props.enemyName}</span></p>
        <div className={'cv-hp-bar ' + (side === 'hero' ? 'cv-hp-bar--hero' : 'cv-hp-bar--foe')}><div style={{ width: hp(props.state, side) * 100 + '%' }} /></div>
        <p className="cv-hp-num">{Math.ceil(props.state.actors[side].stats.hp)}/{Math.ceil(props.state.actors[side].stats.maxHp)} HP</p>
      </div>)}
    </div>
    {props.frozen && <span className="cv-scene-paused">{props.en ? 'Paused' : 'Пауза'}</span>}
    <span className="cv-scene-depth">{props.floor.kind === 'boss' ? '♛ ' : ''}{props.en ? props.floor.depth.en : props.floor.depth.ru}</span>
  </div>;
}
