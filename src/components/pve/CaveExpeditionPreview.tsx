import { useEffect, useRef, useState } from 'react';
import { BIOMES, CREATURES, PORTALS } from '../../game/cavePreviewWorld/catalog';
import { choosePortal, createWorld, MAX_HP, SKILLS, skill, start, update, type Skill, type World } from '../../game/cavePreviewWorld/engine';
import { loadImages, render, type Images } from './cavePreview/renderer';
import './cavePreview/expedition.css';

const defaultUrl = (path: string) => import.meta.env.BASE_URL + path;
const LABELS: Record<string, string> = { ENTER: 'Входим в разлом…', RUN_RIGHT: 'Отряд движется вправо', WAVE_SPAWN: 'Враги идут справа!', APPROACH: 'Сближение', FIGHT: 'Бой', CLEAR: 'Путь свободен', PORTAL_CHOICE: 'Выберите свой путь', PORTAL_ENTER: 'Идём к выбранному порталу', NEXT_ROOM: 'Между мирами…', BOSS: 'Собор пробуждён' };
const skillNames: Record<Skill, { name: string; icon: string }> = { cleave: { name: 'Раскол', icon: '⚔' }, ward: { name: 'Заслон', icon: '⛨' }, heal: { name: 'Источник', icon: '✚' } };
interface Props { assetUrl?: (path: string) => string; onExit?: () => void; /** Offline browser fixture only. */ onWorld?: (world: World) => void }
/** Standalone DEMO: no game store, persistence, network API or server receipts. */
export function CaveExpeditionPreview({ assetUrl = defaultUrl, onExit, onWorld }: Props) {
  const world = useRef(createWorld());
  const canvas = useRef<HTMLCanvasElement>(null);
  const art = useRef<Images | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => structuredClone(world.current));
  const [help, setHelp] = useState(false);
  useEffect(() => {
    let mounted = true;
    loadImages(assetUrl).then(images => { if (mounted) { art.current = images; setReady(true); } }).catch(e => { if (mounted) setError(String(e)); });
    return () => { mounted = false; };
  }, [assetUrl]);
  useEffect(() => {
    if (!ready) return;
    const w = world.current; onWorld?.(w);
    let frame = 0, last = 0, hudAt = 0;
    const visibility = () => { last = 0; };
    document.addEventListener('visibilitychange', visibility);
    const loop = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0; last = now;
      if (!document.hidden) {
        update(w, dt);
        const node = canvas.current;
        if (node && art.current) {
          const box = node.getBoundingClientRect(); const ratio = Math.min(devicePixelRatio || 1, 2);
          const width = Math.round(box.width * ratio), height = Math.round(box.height * ratio);
          if (node.width !== width || node.height !== height) { node.width = width; node.height = height; }
          const context = node.getContext('2d');
          if (context) { context.setTransform(node.width / 430, 0, 0, node.width / 430, 0, 0); render(context, w, art.current, node.height * 430 / node.width); }
        }
        if (now - hudAt > 100) { setView(structuredClone(w)); hudAt = now; }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); };
  }, [ready, onWorld]);
  function refresh() { setView(structuredClone(world.current)); }
  function begin() { start(world.current); setHelp(false); refresh(); }
  function exit() { Object.assign(world.current, createWorld()); refresh(); onExit?.(); }
  function act(key: Skill) { skill(world.current, key); refresh(); }
  const boss = view.enemies.find(e => e.species === 'boss' && e.hp > 0);
  const ended = view.phase === 'VICTORY' || view.phase === 'DEFEAT';
  const playing = view.phase !== 'LOBBY' && !ended;
  return <main className="cx-demo" style={{ '--cx-wood': `url("${assetUrl('assets/territory/ui/wooden-plaque.webp')}")`, '--cx-color': BIOMES[view.biome].color } as React.CSSProperties}>
    <header className="cx-header"><button aria-label="Вернуться ко входу" onClick={exit}>‹</button><div><strong>TERRITORY</strong><span>Тёмная пещера</span></div><b className="cx-demo-tag">DEMO</b><button aria-label="Как играть" onClick={() => setHelp(!help)}>?</button></header>
    <div className="cx-safety">ДЕМОНСТРАЦИЯ · без списаний и настоящих наград</div>
    <section className="cx-progress" aria-label="Прогресс экспедиции"><div className="cx-room-pips">{[0, 1, 2].map(i => <span key={i} className={i <= view.room ? 'active' : ''}>{i === 2 ? '♜' : i + 1}</span>)}</div><div><strong>{BIOMES[view.biome].name}</strong><small>{view.phase === 'LOBBY' ? 'Тестовый этаж · 3 комнаты' : `Комната ${view.room + 1}/3 · ${Math.floor(view.time / 60)}:${String(Math.floor(view.time % 60)).padStart(2, '0')} · побеждено ${view.kills}`}</small></div>{playing && <button className="cx-pause" onClick={() => { world.current.paused = !world.current.paused; refresh(); }} aria-label={view.paused ? 'Возобновить' : 'Пауза'}>{view.paused ? '▶' : 'Ⅱ'}</button>}</section>
    <div className="cx-stage" data-phase={view.phase}>
      <canvas ref={canvas} role="img" aria-label="Отряд бежит вправо по пещере; враги наступают справа" />
      {playing && <div className="cx-stage-status"><span>{LABELS[view.phase]}</span><span>{view.enemies.some(e => e.hp > 0) ? `Враги: ${view.enemies.filter(e => e.hp > 0).length}` : view.phase === 'PORTAL_CHOICE' ? 'Два пути' : `Волна ${Math.min(2, view.wave + 1)}/2`}</span></div>}
      {boss && <div className="cx-boss"><strong>♜ {CREATURES.boss.name}</strong><div><i style={{ width: `${100 * boss.hp / boss.maxHp}%` }} /></div><small>{boss.hp} / {boss.maxHp}</small></div>}
      {(!ready || error) && <div className="cx-overlay"><strong>{error ? 'Не удалось открыть пещеру' : 'Пробуждаем пещеру…'}</strong>{error && <><p>{error}</p><button onClick={() => location.reload()}>Повторить загрузку</button></>}</div>}
      {view.phase === 'LOBBY' && ready && <div className="cx-lobby"><span className="cx-eyebrow">ЭКСПЕДИЦИЯ ТЁМНОЙ ЭНЕРГИИ</span><h1>За гранью света</h1><p>Отряд, два выбора пути<br />и сердце древнего Собора.</p><button className="cx-primary" onClick={begin}>Играть DEMO <span>→</span></button><small>Викинг · Северный воин · Лесная целительница</small></div>}
      {view.phase === 'PORTAL_CHOICE' && <div className="cx-portals" aria-label="Выбор портала">{PORTALS[view.room].map((p, i) => <button key={p.biome} onClick={() => { choosePortal(world.current, i); refresh(); }} style={{ '--portal': BIOMES[p.biome].color } as React.CSSProperties}><b>{p.symbol} {p.title}</b><small>{p.hint}</small><span>Войти →</span></button>)}</div>}
      {view.paused && playing && <div className="cx-overlay"><strong>Привал</strong><button className="cx-primary" onClick={() => { world.current.paused = false; refresh(); }}>Продолжить путь</button></div>}
      {help && <div className="cx-overlay cx-help"><h2>Путь в глубину</h2><p>Отряд бежит и наносит базовые удары сам. «Раскол» бьёт ближайшую группу, «Заслон» защищает от удара, «Источник» восстанавливает здоровье.</p><p>Умения требуют энергии. Авто применяет их за вас. После зачистки сами выберите один из двух порталов.</p><button onClick={() => setHelp(false)}>Понятно</button></div>}
      {ended && <div className={`cx-result ${view.phase === 'VICTORY' ? 'cx-victory' : ''}`}><span className="cx-result-emblem">{view.phase === 'VICTORY' ? '♛' : '⛨'}</span><span className="cx-eyebrow">{view.phase === 'VICTORY' ? 'VICTORY' : 'ПУТЬ ПРЕРВАН'}</span><h1>{view.phase === 'VICTORY' ? 'Бездна отступила' : 'Новый шанс ждёт'}</h1><p>{view.route.map(b => BIOMES[b].name).join(' → ')}</p>{view.phase === 'VICTORY' && <div className="cx-loot">{['01-shadow-amulet', '02-void-axe', '04-azure-crystal'].map((p, i) => <div key={p}><img src={assetUrl(`assets/territory/cave-loot/2026-11-06/${p}.webp`)} alt={['Амулет', 'Секира', 'Кристалл'][i]} /><span>ТЕСТ</span></div>)}</div>}<small>{view.phase === 'VICTORY' ? 'Тестовые трофеи · не добавляются в инвентарь' : 'Демонстрационные ресурсы восстановятся'}</small><button className="cx-primary" onClick={begin}>Повторить забег ↻</button><button onClick={exit}>К входному порталу</button></div>}
    </div>
    <footer className="cx-controls"><div className="cx-bars"><div><span>♥ {view.hp}/{MAX_HP}</span><div className="cx-meter"><i style={{ width: `${100 * view.hp / MAX_HP}%` }} /></div></div><div><span>✦ Энергия {Math.floor(view.energy)}/100</span><div className="cx-meter cx-energy"><i style={{ width: `${view.energy}%` }} /></div></div></div><div className="cx-actions">{(Object.keys(SKILLS) as Skill[]).map(key => { const cd = Math.max(0, Math.ceil(view.cooldown[key] - view.time)); return <button key={key} aria-label={skillNames[key].name} disabled={!playing || view.paused || !['APPROACH', 'FIGHT', 'BOSS'].includes(view.phase) || cd > 0 || view.energy < SKILLS[key].cost} onClick={() => act(key)}><b>{skillNames[key].icon}</b><span>{skillNames[key].name}</span><small>{cd ? `${cd} с` : `✦ ${SKILLS[key].cost}`}</small></button>; })}<button className={view.auto ? 'cx-auto active' : 'cx-auto'} onClick={() => { world.current.auto = !world.current.auto; refresh(); }} aria-pressed={view.auto}><b>↻</b><span>Авто</span><small>{view.auto ? 'ВКЛ' : 'ВЫКЛ'}</small></button></div></footer>
    <nav className="cx-nav"><span>ТЁМНАЯ ПЕЩЕРА</span><button onClick={exit}>⌂ Вход</button><span>ТЕСТОВЫЙ ЗАБЕГ</span></nav>
  </main>;
}
