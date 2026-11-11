import { Sword, Shield, HeartPulse, Wind, Volume2, VolumeX, Pause, Play, ChevronLeft, CircleHelp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BIOMES, PORTALS, type Biome } from '../../game/cavePreviewWorld/catalog';
import { choosePortal, collectRune, createWorld, MAX_HP, SKILLS, skill, skillBlock, start, update, type Skill, type World } from '../../game/cavePreviewWorld/engine';
import { loadImages, render, type Images } from './cavePreview/renderer';
import { CaveAudio } from './cavePreview/audio';
import './cavePreview/expedition.css';

const defaultUrl = (path: string) => import.meta.env.BASE_URL + path;
const EN_BIOMES: Record<Biome, string> = { crystal: 'Crystal rift', spore: 'Sunless garden', ember: 'Amber depths', astral: 'Star crypt', forge: 'Heart of the rift' };
interface Props { assetUrl?: (path: string) => string; onExit?: () => void; language?: string; /** Offline browser fixture only. */ onWorld?: (world: World) => void }
/** Isolated DEMO. Closing or reloading discards only this demonstration. */
export function CaveExpeditionPreview({ assetUrl = defaultUrl, onExit, onWorld, language = 'ru' }: Props) {
  const world = useRef(createWorld()), canvas = useRef<HTMLCanvasElement>(null), art = useRef<Images | null>(null);
  const audio = useRef<CaveAudio>();
  const helpState = useRef({ open: false, wasPaused: false });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [help, setHelp] = useState(false), [muted, setMuted] = useState(false);
  const [view, setView] = useState(() => structuredClone(world.current));
  const en = language === 'en', t = (ru: string, english: string) => en ? english : ru;
  const biomeName = (b: Biome) => en ? EN_BIOMES[b] : BIOMES[b].name;
  const ended = view.phase === 'VICTORY' || view.phase === 'DEFEAT', playing = view.phase !== 'LOBBY' && !ended, focused = playing || ended;
  const names: Record<Skill, string> = { cleave: t('Раскол', 'Cleave'), ward: t('Заслон', 'Ward'), heal: t('Источник', 'Spring'), dodge: t('Уклон', 'Evade') };
  const labels = { cleave: t('Раскол', 'Cleave'), ward: t('Защита', 'Guard'), heal: t('Лечение', 'Heal'), dodge: t('Уклон', 'Evade') };
  const icons = { cleave: Sword, ward: Shield, heal: HeartPulse, dodge: Wind };
  const hints = { cleave: t('По группе', 'Area strike'), ward: t('Снижает урон', 'Reduce damage'), heal: t('Лечение отряда', 'Party healing'), dodge: t('Избежать удара', 'Evade a hit') };
  useEffect(() => {
    let mounted = true;
    setError(''); setReady(false);
    loadImages(assetUrl).then(images => { if (mounted) { art.current = images; setReady(true); } }).catch(() => { if (mounted) setError('art'); });
    return () => { mounted = false; };
  }, [assetUrl, loadAttempt]);
  useEffect(() => { const sound = new CaveAudio(); audio.current = sound; return () => { sound.close(); }; }, []);
  useEffect(() => {
    if (!focused) return;
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const previous = document.activeElement;
    const siblings = [...document.body.children].filter((node): node is HTMLElement => node instanceof HTMLElement && !node.classList.contains('cx-focus')).map(node => ({ node, inert: node.inert }));
    siblings.forEach(({ node }) => { node.inert = true; });
    canvas.current?.closest('main')?.querySelector('button')?.focus();
    return () => { document.body.style.overflow = old; siblings.forEach(({ node, inert }) => { node.inert = inert; }); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [focused]);
  useEffect(() => {
    if (!ready) return;
    const w = world.current; onWorld?.(w);
    let frame = 0, last = 0, hudAt = 0;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const visibility = () => { last = 0; audio.current?.tick(w); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (helpState.current.open) {
        helpState.current.open = false;
        w.paused = helpState.current.wasPaused;
        setHelp(false);
      } else if (!['LOBBY', 'VICTORY', 'DEFEAT'].includes(w.phase)) {
        w.paused = !w.paused;
      } else return;
      event.preventDefault();
      setView(structuredClone(w));
    };
    document.addEventListener('visibilitychange', visibility); document.addEventListener('keydown', keyboard);
    const loop = (now: number) => {
      const dt = last ? (now - last) / 1000 : 0; last = now;
      if (!document.hidden) {
        update(w, dt); audio.current?.tick(w);
        const node = canvas.current;
        if (node && art.current) {
          const box = node.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
          const width = Math.round(box.width * ratio), height = Math.round(box.height * ratio);
          if (width && height) {
            if (node.width !== width || node.height !== height) { node.width = width; node.height = height; }
            const context = node.getContext('2d');
            if (context) { context.setTransform(node.width / 430, 0, 0, node.width / 430, 0, 0); render(context, w, art.current, node.height * 430 / node.width, en, motion.matches); }
          }
        }
        if (now - hudAt > 100) { setView(structuredClone(w)); hudAt = now; }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('keydown', keyboard); };
  }, [ready, onWorld, en]);
  function refresh() { setView(structuredClone(world.current)); }
  function begin() { start(world.current); helpState.current.open = false; setHelp(false); void audio.current?.unlock().catch(() => setMuted(true)); refresh(); }
  function exit() { Object.assign(world.current, createWorld()); helpState.current.open = false; setHelp(false); audio.current?.tick(world.current); refresh(); onExit?.(); }
  function pause() { if (!helpState.current.open) world.current.paused = !world.current.paused; refresh(); }
  function openHelp() {
    if (helpState.current.open) return;
    helpState.current = { open: true, wasPaused: world.current.paused };
    if (playing) world.current.paused = true;
    setHelp(true); refresh();
  }
  function closeHelp() {
    world.current.paused = helpState.current.wasPaused;
    helpState.current.open = false;
    setHelp(false); refresh();
  }
  const boss = view.enemies.find(e => e.species === 'boss' && e.hp > 0);
  const warning = boss && boss.impact > view.time;
  const clock = `${Math.floor(view.time / 60)}:${String(Math.floor(view.time % 60)).padStart(2, '0')}`;
  const content = <main className={`cx-demo ${focused ? 'cx-focus' : ''} ${playing ? 'cx-playing' : ''}`} lang={en ? 'en' : 'ru'} style={{ '--cx-wood': `url("${assetUrl('assets/territory/ui/wooden-plaque.webp')}")`, '--cx-color': BIOMES[view.biome].color } as React.CSSProperties}>
    <header className="cx-header"><button aria-label={t('Вернуться ко входу', 'Return to entrance')} onClick={playing ? pause : exit}><ChevronLeft size={20} /></button><div><strong>{biomeName(view.biome)}</strong><span><em>DEMO</em> · {t('Тёмная пещера', 'Dark cave')}</span></div><button aria-label={t('Звук', 'Sound')} aria-pressed={!muted} onClick={() => { const next = !muted; setMuted(next); audio.current?.mute(next); if (!next) void audio.current?.unlock().catch(() => setMuted(true)); }}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><button aria-label={t('Как играть', 'How to play')} onClick={openHelp}><CircleHelp size={18} /></button>{playing && <button onClick={pause} aria-label={t(view.paused ? 'Возобновить' : 'Пауза', view.paused ? 'Resume' : 'Pause')}>{view.paused ? <Play size={18} /> : <Pause size={18} />}</button>}</header>
    <div className="cx-stage" data-phase={view.phase}>
      <canvas ref={canvas} role="img" aria-label={t('Отряд движется вправо по пещере', 'The party travels right through the cave')} />
      {playing && <div className="cx-stage-status"><span>{view.room + 1}/3 · {clock}</span><span>{view.phase === 'PORTAL_CHOICE' ? t('Выберите арку', 'Choose an arch') : boss ? t('Собор Бездны', 'Abyss Cathedral') : `${t('Волна', 'Wave')} ${Math.min(2, view.wave + 1)}/2`}</span></div>}
      {boss && <div className="cx-boss"><strong>{t('Собор Бездны', 'Abyss Cathedral')} · {t('Фаза', 'Phase')} {view.bossPhase}/3</strong><div role="meter" aria-label={t('Здоровье босса', 'Boss health')} aria-valuenow={boss.hp} aria-valuemin={0} aria-valuemax={boss.maxHp}><i style={{ width: `${100 * boss.hp / boss.maxHp}%` }} /></div><small>{[t('Пробуждение', 'Awakening'), t('Раскол земли', 'Earth rupture'), t('Ярость Бездны', 'Abyss fury')][view.bossPhase - 1]}</small></div>}
      {warning && <div className={`cx-warning ${boss.heavy ? 'heavy' : ''}`} role="status">{boss.heavy ? [t('⚠ Обвал! Нажмите Заслон', '⚠ Collapse! Use Ward'), t('⚠ Разлом! Нажмите Заслон', '⚠ Rupture! Use Ward'), t('⚠ Дождь осколков! Заслон', '⚠ Shard rain! Use Ward')][view.bossPhase - 1] : t('Удар приближается', 'Incoming strike')}<i style={{ transform: `scaleX(${Math.max(0, (boss.impact - view.time) / (boss.heavy ? 1.45 : .95))})` }} /></div>}
      {(!ready || error) && <div className="cx-overlay"><strong>{error ? t('Не удалось открыть пещеру', 'Could not open the cave') : t('Пробуждаем пещеру…', 'Waking the cave…')}</strong>{error && <button onClick={() => setLoadAttempt(attempt => attempt + 1)}>{t('Повторить загрузку', 'Reload')}</button>}</div>}
      {view.phase === 'LOBBY' && ready && <div className="cx-lobby"><span className="cx-eyebrow">TERRITORY · DEMO</span><h1>{t('За гранью света', 'Beyond the light')}</h1><p>{t('Три комнаты. Две развилки. Один Собор.', 'Three rooms. Two choices. One Cathedral.')}</p><button className="cx-primary" onClick={begin}>{t('Играть DEMO', 'Play DEMO')} →</button><small>{t('Базовые атаки автоматические · навыки за вами', 'Automatic basic attacks · you control skills')}</small></div>}
      {view.phase === 'RUN_RIGHT' && !view.runeCollected && <button className="cx-rune" onClick={() => { collectRune(world.current); refresh(); }} aria-label={t('Собрать искру', 'Collect spark')}><b>✦</b><small>{t('Коснитесь', 'Touch')} · +10 ✦</small></button>}
      {view.phase === 'PORTAL_CHOICE' && <div className="cx-portals" aria-label={t('Выбор портала', 'Portal choice')}>{PORTALS[view.room].map((p, i) => <button key={p.biome} aria-label={biomeName(p.biome)} onClick={() => { if (choosePortal(world.current, i)) refresh(); }} style={{ '--portal': BIOMES[p.biome].color } as React.CSSProperties}><span className="cx-portal-touch" /><b>{biomeName(p.biome)}</b><small>{en ? ['Ranged spores', 'Armoured depths', 'Sails & Cathedral', 'Depths & Cathedral'][view.room * 2 + i] : p.hint}</small></button>)}</div>}
      {view.paused && playing && !help && <div className="cx-overlay"><strong>{t('Привал', 'Rest stop')}</strong><p>{t('Демо не сохраняется. Настоящий прогресс в безопасности.', 'Demo runs are not saved. Your real progress is safe.')}</p><button className="cx-primary" onClick={pause}>{t('Продолжить путь', 'Continue')}</button><button onClick={begin}>{t('Начать заново', 'Restart')}</button><button onClick={exit}>{t('К входному порталу', 'Back to entrance')}</button></div>}
      {help && <div className="cx-overlay cx-help"><h2>{t('Путь в глубину', 'Into the depths')}</h2><p>{t('Бег и базовые атаки автоматические. Раскол бьёт группу после замаха. Заслон снижает урон на 85%. Уклон позволяет избежать удара, если нажать перед попаданием. Источник лечит героя и живых спутников.', 'Running and basic attacks are automatic. Cleave hits a group after the windup. Ward reduces damage by 85%. Use Evade just before contact to avoid a hit. Spring heals the hero and living companions.')}</p><p>{t('Энергия восстанавливается медленно. Авто навыков применяет способности за вас, сохраняя запас для защиты. Две арки ведут в разные биомы. Перезагрузка завершает только DEMO.', 'Energy recovers slowly. Auto skills uses abilities for you and reserves energy for defence. The two arches lead to different biomes. Reloading ends only this DEMO.')}</p><button onClick={closeHelp}>{t('Понятно', 'Got it')}</button></div>}
      {ended && <div className={`cx-result ${view.phase === 'VICTORY' ? 'cx-victory' : ''}`}><span className="cx-result-emblem">{view.phase === 'VICTORY' ? '♛' : '⛨'}</span><span className="cx-eyebrow">{view.phase === 'VICTORY' ? t('ПОБЕДА', 'VICTORY') : t('ПУТЬ ПРЕРВАН', 'DEFEAT')}</span><h1>{view.phase === 'VICTORY' ? t('Бездна отступила', 'The Abyss retreats') : t('Новый шанс ждёт', 'Another chance awaits')}</h1><p>{view.route.map(biomeName).join(' → ')}</p><p>{clock} · {view.kills} {t('врагов', 'foes')} · {view.blocks} {t('блоков', 'blocks')} · {view.casts} {t('умений', 'skills')}</p>{view.phase === 'VICTORY' && <div className="cx-loot">{['01-shadow-amulet', '02-void-axe', '04-azure-crystal'].map(p => <div key={p}><img src={assetUrl(`assets/territory/cave-loot/2026-11-06/${p}.webp`)} alt={t('Образец добычи', 'Sample loot')} /><span>{t('ТЕСТ', 'TEST')}</span></div>)}</div>}<small>{t('Превью возможных наград · без выдачи', 'Possible rewards preview · nothing granted')}</small><button className="cx-primary" onClick={begin}>{t('Повторить забег', 'Try again')} ↻</button><button onClick={exit}>{t('К входному порталу', 'Back to entrance')}</button></div>}
    </div>
    {playing && <footer className="cx-controls">
      <div className="cx-control-status">
        <div className="cx-bars">
          <div><span><HeartPulse size={11} /> {view.hp}/{MAX_HP}</span><div className="cx-meter"><i style={{ width: `${100 * view.hp / MAX_HP}%` }} /></div></div>
          <div><span>✦ {Math.floor(view.energy)}/100</span><div className="cx-meter cx-energy"><i style={{ width: `${view.energy}%` }} /></div></div>
        </div>
        <button disabled={view.paused} className={view.auto ? 'cx-auto active' : 'cx-auto'} title={t('Автоматически применять умения', 'Use skills automatically')} onClick={() => { world.current.auto = !world.current.auto; refresh(); }} aria-label={t('Авто навыков', 'Auto skills')} aria-pressed={view.auto}>
          <span>{t('Авто', 'Auto')}</span><b>{view.auto ? t('ВКЛ', 'ON') : t('ВЫКЛ', 'OFF')}</b>
        </button>
      </div>
      <div className="cx-actions">{(Object.keys(SKILLS) as Skill[]).map(key => {
        const cd = Math.max(0, Math.ceil(view.cooldown[key] - view.time)), Icon = icons[key];
        return <button key={key} aria-label={names[key]} title={hints[key]} disabled={skillBlock(view, key) !== null} onClick={() => { skill(world.current, key); refresh(); }}>
          <span className={`cx-skill-icon cx-skill-${key}`}><Icon size={22} strokeWidth={1.8} />{cd > 0 && <b className="cx-cooldown">{cd}</b>}</span>
          <span className="cx-skill-label">{labels[key]}</span>
          <small>{cd ? `${cd}${t(' с', 's')}` : `${SKILLS[key].cost}✦ · ${SKILLS[key].cooldown}${t(' с', 's')}`}</small>
        </button>;
      })}</div>
    </footer>}

  </main>;
  return focused ? createPortal(content, document.body) : content;
}
