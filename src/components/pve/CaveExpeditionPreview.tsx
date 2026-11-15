import { Sword, Shield, HeartPulse, Wind, Volume2, VolumeX, Pause, Play, ChevronLeft, CircleHelp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BIOMES, PORTALS, type Biome } from '../../game/cavePreviewWorld/catalog';
import { advanceRealtime, choosePortal, collectRune, createWorld, drinkPotion, POTIONS, SKILLS, skill, skillBlock, start, type Skill, type World } from '../../game/cavePreviewWorld/engine';
import { readCheckpoint, saveCheckpoint } from '@/game/cavePreviewWorld/checkpoint';
import { useCaveSandbox } from '@/game/cave/sandboxStore';
import { equippedItems, loadoutTotals, umbraTemplate } from '@/game/cave/umbra';
import { gemTotals } from '@/game/cave/gems';
import { CaveUmbraScreen } from './cave/CaveUmbraScreen';
import { CaveBlessingSlots, CaveElixirShelf } from './cave/CavePanels';
import { CaveGemsScreen } from './cave/CaveGemsScreen';
import { setCavePreviewAssets } from './cave/caveShared';
import { PlaytestBelt, PlaytestGear, PlaytestNav, TEST_GEAR } from './cavePreview/playtestHud';
import { loadImages, render, type Images } from './cavePreview/renderer';
import { CaveAudio } from './cavePreview/audio';
import './cavePreview/expedition.css';

const defaultUrl = (path: string) => import.meta.env.BASE_URL + path;
const EN_BIOMES: Record<Biome, string> = { crystal: 'Crystal rift', spore: 'Sunless garden', ember: 'Amber depths', astral: 'Star crypt', forge: 'Heart of the rift' };
interface Props { assetUrl?: (path: string) => string; onExit?: () => void; language?: string; /** Offline browser fixture only. */ onWorld?: (world: World) => void }
/** Isolated gameplay, local test checkpoint and warehouse. No player APIs. */
export function CaveExpeditionPreview({ assetUrl = defaultUrl, onExit, onWorld, language = 'ru' }: Props) {
  const [saved] = useState(readCheckpoint);
  const world = useRef(saved?.world ?? createWorld()), canvas = useRef<HTMLCanvasElement>(null), art = useRef<Images | null>(null);
  const runId = useRef(saved?.runId ?? crypto.randomUUID());
  const [bank, dispatch] = useCaveSandbox();
  const [panel, setPanel] = useState<string | null>(null), [inventoryTab, setInventoryTab] = useState<'gear' | 'gems'>('gear');
  const panelPause = useRef(false);
  const [inspectGear, setInspectGear] = useState<number | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const [notice, setNotice] = useState('');
  const audio = useRef<CaveAudio>();
  const helpState = useRef({ open: false, wasPaused: false });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [help, setHelp] = useState(false), [muted, setMuted] = useState(false);
  const [view, setView] = useState(() => structuredClone(world.current));
  const en = language === 'en', t = (ru: string, english: string) => en ? english : ru;
  const biomeName = (b: Biome) => en ? EN_BIOMES[b] : BIOMES[b].name;
  const ended = view.phase === 'VICTORY' || view.phase === 'DEFEAT', playing = view.phase !== 'LOBBY' && !ended, focused = playing || ended || panel !== null;
  const names: Record<Skill, string> = { cleave: t('Раскол', 'Cleave'), ward: t('Заслон', 'Ward'), heal: t('Источник', 'Spring'), dodge: t('Уклон', 'Evade') };
  const labels = { cleave: t('Раскол', 'Cleave'), ward: t('Защита', 'Guard'), heal: t('Лечение', 'Heal'), dodge: t('Уклон', 'Evade') };
  const icons = { cleave: Sword, ward: Shield, heal: HeartPulse, dodge: Wind };
  const hints = { cleave: t('По группе', 'Area strike'), ward: t('Снижает урон', 'Reduce damage'), heal: t('Лечение отряда', 'Party healing'), dodge: t('Избежать удара', 'Evade a hit') };
  useEffect(() => {
    if (panel === null && inspectGear === null) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.cv-overlay')) return;
      event.preventDefault();
      if (inspectGear !== null) { setInspectGear(null); world.current.paused = panel !== null || panelPause.current; }
      else { setPanel(null); world.current.paused = panelPause.current; }
      setView(structuredClone(world.current)); saveCheckpoint(world.current, runId.current);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [panel, inspectGear]);
  useEffect(() => {
    let mounted = true;
    setError(''); setReady(false);
    loadImages(assetUrl).then(images => { if (mounted) { art.current = images; setReady(true); } }).catch(() => { if (mounted) setError('art'); });
    return () => { mounted = false; };
  }, [assetUrl, loadAttempt]);
  useEffect(() => { const sound = new CaveAudio(); audio.current = sound; return () => { sound.close(); }; }, []);
  useEffect(() => { world.current.wings = bank.previewWings; }, [bank.previewWings]);
  useEffect(() => { setCavePreviewAssets(assetUrl); return () => setCavePreviewAssets(null); }, [assetUrl]);
  useEffect(() => {
    if (view.phase === 'VICTORY') dispatch({ type: 'loot', floor: 6, boss: true }, 'expedition:' + runId.current);
  }, [view.phase, dispatch]);
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
    let frame = 0, last = 0, hudAt = 0, savedAt = 0;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const visibility = () => {
      last = 0;
      if (document.hidden && !['LOBBY','VICTORY','DEFEAT'].includes(w.phase)) w.paused = true;
      setStorageOk(saveCheckpoint(w, runId.current));
      audio.current?.tick(w);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.cx-panel,.cx-gear-dialog')) return;
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
        advanceRealtime(w, dt); audio.current?.tick(w);
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
        if (now - savedAt > 1000) { setStorageOk(saveCheckpoint(w, runId.current)); savedAt = now; }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { saveCheckpoint(w, runId.current); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('keydown', keyboard); };
  }, [ready, onWorld, en]);
  function refresh() { setView(structuredClone(world.current)); setStorageOk(saveCheckpoint(world.current, runId.current)); }
  function begin() {
    start(world.current); runId.current = crypto.randomUUID();
    const stats = loadoutTotals(equippedItems(bank.items, bank.loadout)), gems = gemTotals(bank.sockets);
    world.current.attackBonus = Math.round((stats.attack ?? 0) + (gems.attack ?? 0));
    world.current.defenseBonus = Math.round((stats.defense ?? 0) + (gems.defense ?? 0));
    world.current.wings = bank.previewWings;
    world.current.honorBonus = bank.playtestHonor * .005;
    world.current.attackBonus += 30 * .005 * bank.playtestHonor;
    world.current.maxHp += Math.round((stats.hp ?? 0) + (gems.hp ?? 0) + 900 * .008 * bank.playtestHonor); world.current.hp = world.current.maxHp;
    helpState.current.open = false; setHelp(false); setPanel(null); setInspectGear(null); setNotice('');
    void audio.current?.unlock().catch(() => setMuted(true)); refresh();
  }
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
  function navigate(id: string) {
    setInspectGear(null);
    if (id === 'battle') { if (panel !== null) world.current.paused = panelPause.current; setPanel(null); refresh(); return; }
    if (panel === null) panelPause.current = world.current.paused;
    world.current.paused = true; setPanel(id); refresh();
  }
  function drink(slot: number) {
    if (drinkPotion(world.current, slot)) setNotice(`${en ? POTIONS[slot].en : POTIONS[slot].ru}: ${en ? POTIONS[slot].effectEn : POTIONS[slot].effectRu}`);
    refresh();
  }
  const boss = view.enemies.find(e => e.species === 'boss' && e.hp > 0);
  const warning = boss && boss.impact > view.time;
  const clock = `${Math.floor(view.time / 60)}:${String(Math.floor(view.time % 60)).padStart(2, '0')}`;
  const content = <main className={`cx-demo ${focused ? 'cx-focus' : ''} ${playing ? 'cx-playing' : ''}`} lang={en ? 'en' : 'ru'} style={{ '--cx-wood': `url("${assetUrl('assets/territory/ui/wooden-plaque.webp')}")`, '--cx-color': BIOMES[view.biome].color } as React.CSSProperties}>
    <header className="cx-header"><button aria-label={t('Вернуться ко входу', 'Return to entrance')} onClick={playing ? pause : exit}><ChevronLeft size={20} /></button><div><strong>{biomeName(view.biome)}</strong><span><em>{t('ТЕСТ', 'TEST')}</em> · {t('Без настоящей добычи', 'No real rewards')}</span></div><button aria-label={t('Звук', 'Sound')} aria-pressed={!muted} onClick={() => { const next = !muted; setMuted(next); audio.current?.mute(next); if (!next) void audio.current?.unlock().catch(() => setMuted(true)); }}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><button aria-label={t('Как играть', 'How to play')} onClick={openHelp}><CircleHelp size={18} /></button><button aria-label={t('Настройки', 'Settings')} onClick={() => navigate('settings')}>⚙</button>{playing && <button onClick={pause} aria-label={t(view.paused ? 'Возобновить' : 'Пауза', view.paused ? 'Resume' : 'Pause')}>{view.paused ? <Play size={18} /> : <Pause size={18} />}</button>}</header>
    <div className="cx-top-vitals" aria-label={t('Состояние героя', 'Hero status')}>        <div className="cx-bars">
          <div><span><HeartPulse size={11} /> {Math.ceil(view.hp)}/{view.maxHp}</span><div className="cx-meter"><i style={{ width: `${100 * view.hp / view.maxHp}%` }} /></div></div>
          <div><span>✦ {Math.floor(view.energy)}/100</span><div className="cx-meter cx-energy"><i style={{ width: `${view.energy}%` }} /></div></div>
        </div>
<span className="cx-level">{t('Ур.6', 'Hero Lv.6')}<progress max={16} value={view.kills}/></span></div>
    {playing && <PlaytestGear assetUrl={assetUrl} en={en} onInspect={i => { panelPause.current = world.current.paused; world.current.paused = true; setInspectGear(i); refresh(); }}/>}
    <div className="cx-stage" data-phase={view.phase}>
      <canvas ref={canvas} role="img" aria-label={t('Отряд движется вправо по пещере', 'The party travels right through the cave')} />
      {playing && <div className="cx-stage-status"><span>{view.room + 1}/3 · {clock}</span><span>{view.phase === 'PORTAL_CHOICE' ? t('Выберите арку', 'Choose an arch') : boss ? t('Собор Бездны', 'Abyss Cathedral') : `${t('Волна', 'Wave')} ${Math.min(2, view.wave + 1)}/2`}</span></div>}
      {boss && <div className="cx-boss"><strong>{t('Собор Бездны', 'Abyss Cathedral')} · {t('Фаза', 'Phase')} {view.bossPhase}/3</strong><div role="meter" aria-label={t('Здоровье босса', 'Boss health')} aria-valuenow={boss.hp} aria-valuemin={0} aria-valuemax={boss.maxHp}><i style={{ width: `${100 * boss.hp / boss.maxHp}%` }} /></div><small>{[t('Пробуждение', 'Awakening'), t('Раскол земли', 'Earth rupture'), t('Ярость Бездны', 'Abyss fury')][view.bossPhase - 1]}</small></div>}
      {warning && <div className={`cx-warning ${boss.heavy ? 'heavy' : ''}`} role="status">{boss.heavy ? [t('⚠ Обвал! Нажмите Заслон', '⚠ Collapse! Use Ward'), t('⚠ Разлом! Нажмите Заслон', '⚠ Rupture! Use Ward'), t('⚠ Дождь осколков! Заслон', '⚠ Shard rain! Use Ward')][view.bossPhase - 1] : t('Удар приближается', 'Incoming strike')}<i style={{ transform: `scaleX(${Math.max(0, (boss.impact - view.time) / (boss.heavy ? 1.45 : .95))})` }} /></div>}
      {(!ready || error) && <div className="cx-overlay"><strong>{error ? t('Не удалось открыть пещеру', 'Could not open the cave') : t('Пробуждаем пещеру…', 'Waking the cave…')}</strong>{error && <button onClick={() => setLoadAttempt(attempt => attempt + 1)}>{t('Повторить загрузку', 'Reload')}</button>}</div>}
      {view.phase === 'LOBBY' && ready && <div className="cx-lobby"><span className="cx-eyebrow">TERRITORY · DEMO</span><h1>{t('За гранью света', 'Beyond the light')}</h1><p>{t('Три комнаты. Две развилки. Один Собор.', 'Three rooms. Two choices. One Cathedral.')}</p><button className="cx-primary" onClick={begin}>{t('Играть DEMO', 'Play DEMO')} →</button><small>{t('Базовые атаки автоматические · навыки за вами', 'Automatic basic attacks · you control skills')}</small></div>}
      {view.phase === 'RUN_RIGHT' && !view.runeCollected && <button className="cx-rune" onClick={() => { collectRune(world.current); refresh(); }} aria-label={t('Собрать искру', 'Collect spark')}><b>✦</b><small>{t('Коснитесь', 'Touch')} · +10 ✦</small></button>}
      {view.phase === 'PORTAL_CHOICE' && <div className="cx-portals" aria-label={t('Выбор портала', 'Portal choice')}>{PORTALS[view.room].map((p, i) => <button key={p.biome} aria-label={biomeName(p.biome)} onClick={() => { if (choosePortal(world.current, i)) refresh(); }} style={{ '--portal': BIOMES[p.biome].color } as React.CSSProperties}><span className="cx-portal-touch" /><b>{biomeName(p.biome)}</b><small>{en ? ['Ranged spores', 'Armoured depths', 'Sails & Cathedral', 'Depths & Cathedral'][view.room * 2 + i] : p.hint}</small></button>)}</div>}
      {view.paused && playing && !help && <div className="cx-overlay"><strong>{t('Привал', 'Rest stop')}</strong><p>{t('Тестовый забег сохранён на этом устройстве.', 'Your test run is saved on this device.')}</p><button className="cx-primary" onClick={pause}>{t('Продолжить путь', 'Continue')}</button><button onClick={begin}>{t('Начать заново', 'Restart')}</button><button onClick={exit}>{t('К входному порталу', 'Back to entrance')}</button></div>}
      {help && <div className="cx-overlay cx-help"><h2>{t('Путь в глубину', 'Into the depths')}</h2><p>{t('Бег и базовые атаки автоматические. Раскол бьёт группу после замаха. Заслон снижает урон на 85%. Уклон позволяет избежать удара, если нажать перед попаданием. Источник лечит героя и живых спутников.', 'Running and basic attacks are automatic. Cleave hits a group after the windup. Ward reduces damage by 85%. Use Evade just before contact to avoid a hit. Spring heals the hero and living companions.')}</p><p>{t('Энергия восстанавливается медленно. Авто навыков применяет способности за вас, сохраняя запас для защиты. Две арки ведут в разные биомы. Перезагрузка восстанавливает тестовый забег на паузе.', 'Energy recovers slowly. Auto skills uses abilities for you and reserves energy for defence. The two arches lead to different biomes. Reload restores this test run paused.')}</p><button onClick={closeHelp}>{t('Понятно', 'Got it')}</button></div>}
      {ended && <div className={`cx-result ${view.phase === 'VICTORY' ? 'cx-victory' : ''}`}><span className="cx-result-emblem">{view.phase === 'VICTORY' ? '♛' : '⛨'}</span><span className="cx-eyebrow">{view.phase === 'VICTORY' ? t('ПОБЕДА', 'VICTORY') : t('ПУТЬ ПРЕРВАН', 'DEFEAT')}</span><h1>{view.phase === 'VICTORY' ? t('Бездна отступила', 'The Abyss retreats') : t('Новый шанс ждёт', 'Another chance awaits')}</h1><p>{view.route.map(biomeName).join(' → ')}</p><p>{clock} · {view.kills} {t('врагов', 'foes')} · {view.blocks} {t('блоков', 'blocks')} · {view.casts} {t('умений', 'skills')}</p>{view.phase === 'VICTORY' && <div className="cx-loot">{bank.lastLoot?.items.map(item => <div key={item.id}><img src={assetUrl(umbraTemplate(item.templateId)!.art)} alt={t('Тестовая добыча', 'Test loot')} /><span>+{item.enhance} · {t('ТЕСТ', 'TEST')}</span></div>)}</div>}<small>{t('Получено в тестовый склад · не имущество игрока', 'Added to test inventory · no real rewards')}</small>{view.phase === 'VICTORY' && <button className="cx-primary" onClick={() => navigate('inventory')}>{t('Открыть добычу', 'Open loot')}</button>}<button className="cx-primary" onClick={begin}>{t('Повторить забег', 'Try again')} ↻</button><button onClick={exit}>{t('К входному порталу', 'Back to entrance')}</button></div>}
    </div>
    {playing && <footer className="cx-controls">
      <div className="cx-control-status">
        <button className="cx-dark-open" onClick={() => navigate('inventory')}>{t('Тёмное снаряжение', 'Dark gear')}</button>
        <button disabled={view.paused} className={view.auto ? 'cx-auto active' : 'cx-auto'} title={t('Автоматически применять умения', 'Use skills automatically')} onClick={() => { world.current.auto = !world.current.auto; refresh(); }} aria-label={t('Авто навыков', 'Auto skills')} aria-pressed={view.auto}>
          <span>{t('Авто', 'Auto')}</span><b>{view.auto ? t('ВКЛ', 'ON') : t('ВЫКЛ', 'OFF')}</b>
        </button>
        <button className="cx-speed" aria-label={t('Скорость', 'Speed')} aria-pressed={view.speed === 2} onClick={() => { world.current.speed = world.current.speed === 1 ? 2 : 1; refresh(); }}>×{view.speed}</button>
        <button className="cx-auto-potions" aria-label={t('Автозелья', 'Auto potions')} aria-pressed={view.autoPotions} onClick={() => { world.current.autoPotions = !world.current.autoPotions; refresh(); }}>
          <span>✚</span><small>{view.autoPotions ? 'ON' : 'OFF'}</small>
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
      <PlaytestBelt world={view} en={en} assetUrl={assetUrl} onDrink={drink}/>
      <div className="cx-objective"><span>♛ {t('Собор Бездны', 'Abyss Cathedral')} · {view.kills}/16</span><span>✦ {t('Тестовая добыча', 'Test loot')}</span></div>
    </footer>}
    {!storageOk && <p className="cx-save-note" role="status">{t('Хранилище недоступно — забег только до закрытия страницы.', 'Storage unavailable — this visit only.')}</p>}
    {notice && playing && <button className="cx-receipt" onClick={() => setNotice('')} aria-label={t('Закрыть уведомление', 'Dismiss notification')}>{notice} ×</button>}
    {inspectGear !== null && <div className="cx-gear-dialog" role="dialog" aria-modal="true" aria-label={t('Обычная экипировка · тест', 'Ordinary gear · test')}>
      <img src={assetUrl(`assets/territory/ui/equipment/${TEST_GEAR[inspectGear][0]}.webp`)} alt=""/>
      <h2>{en ? TEST_GEAR[inspectGear][2] : TEST_GEAR[inspectGear][1]} · {t('Ур.6', 'Lv.6')}</h2>
      <p>{t('Обычный тестовый комплект. Тёмные 12 слотов находятся отдельно в Инвентаре.', 'Ordinary test gear. The 12 dark slots are separate in Inventory.')}</p>
      <button onClick={() => { world.current.paused = panel !== null || panelPause.current; setInspectGear(null); refresh(); }}>{t('Закрыть', 'Close')}</button>
    </div>}
    {panel !== null && <section className="cx-panel" aria-label={t('Тестовый раздел', 'Test section')}>
      <div className="cx-panel-heading"><b>{t('ТЕСТ · пауза', 'TEST · paused')} · HP {Math.ceil(view.hp)} · ✦{Math.floor(view.energy)} · {view.room+1}/3</b><button onClick={() => navigate('battle')}>← {t('В бой', 'To battle')}</button></div>
      {panel === 'blessing' ? <div className="cx-camp cx-blessing-panel"><h1>{t('Благословение Пещеры', 'Cave Blessing')}</h1><CaveBlessingSlots en={en} floor={6}/><CaveElixirShelf en={en}/><p>{t('Эти эликсиры меняют категории тестовой добычи следующей победы. Городское Благословение качества — отдельная система; здесь оно не изменяется.', 'These elixirs affect test loot categories on your next victory. City quality Blessing is separate and remains unchanged.')}</p></div> : panel === 'settings' ? <div className="cx-camp"><h1>{t('Настройки', 'Settings')}</h1>    <div className="cx-utilities"><button onClick={() => navigate('blessing')}>{t('Благословение', 'Blessing')}</button><button onClick={() => navigate('honor')}>{t('Почётные звания', 'Honor ranks')}</button><button onClick={() => navigate('inventory')}>{t('Тёмное снаряжение', 'Dark gear')}</button></div>
<button aria-pressed={!muted} onClick={() => {const next=!muted;setMuted(next);audio.current?.mute(next);if(!next)void audio.current?.unlock().catch(() => setMuted(true));}}>{t('Звук', 'Sound')} · {muted ? 'OFF' : 'ON'}</button><button onClick={() => {world.current.speed=world.current.speed===1?2:1;refresh();}}>{t('Скорость', 'Speed')} ×{view.speed}</button><button aria-pressed={view.autoPotions} onClick={() => {world.current.autoPotions=!world.current.autoPotions;refresh();}}>{t('Автозелья', 'Auto potions')} · {view.autoPotions ? 'ON':'OFF'}</button><p>{t('Сохраняется только тест на этом устройстве.', 'Only the playtest is saved on this device.')}</p></div> : panel === 'honor' ? <div className="cx-camp"><h1>{t('Почётные звания', 'Honor ranks')}</h1><p>{t('Тестовый ранг', 'Test rank')} {bank.playtestHonor} → {bank.playtestHonor+1}</p><p>{t('Атака и защита', 'Attack & defense')}: +{bank.playtestHonor*.5}% → +{(bank.playtestHonor+1)*.5}%<br/>HP: +{bank.playtestHonor*.8}% → +{((bank.playtestHonor+1)*.8).toFixed(1)}%</p><ul className="cx-honor-conditions"><li>{t('Герой', 'Hero')} 6/{bank.playtestHonor ? 10 : 5} {bank.playtestHonor ? '◇' : '✓'}</li><li>{t('Пройденные комнаты', 'Cleared rooms')} {bank.playtestWins ? 3 : 0}/{bank.playtestHonor ? 5 : 3} {bank.playtestWins && !bank.playtestHonor ? '✓':'◇'}</li><li>{t('Благословение качества', 'Quality Blessing')} 0/{bank.playtestHonor ? 1 : 0} {bank.playtestHonor ? '◇':'✓'}</li></ul><p>◆ {bank.playtestBlueDiamonds} {t('тестовых синих алмазов', 'test blue diamonds')}</p><button disabled={bank.playtestHonor>0 || bank.playtestWins===0} onClick={() => {const result=dispatch({type:'claimPlaytestHonor'});if(result.ok)setNotice(t('Ранг получен · +10 тестовых синих алмазов', 'Rank claimed · +10 test blue diamonds'));}}>{bank.playtestHonor ? t('Ранг 1 получен', 'Rank 1 claimed') : t('Получить · +10 синих', 'Claim · +10 blue')}</button><small>{t('Первый тестовый ранг. HP и атака действуют со следующего забега; условия следующих рангов требуют расширения тестовой кампании. Это не звание аккаунта.', 'First test rank. HP and attack apply next run; further ranks require an extended test campaign. This is separate from account titles.')}</small></div> : panel === 'inventory' ? <>
        <div className="cx-inventory-tabs"><button aria-pressed={inventoryTab === 'gear'} onClick={() => setInventoryTab('gear')}>{t('Тёмная энергия', 'Dark energy')}</button><button aria-pressed={inventoryTab === 'gems'} onClick={() => setInventoryTab('gems')}>{t('Самоцветы', 'Gems')}</button></div>
        <div className="cx-inventory-content">{inventoryTab === 'gear'
          ? <CaveUmbraScreen en={en} hero={assetUrl('assets/territory/characters/heroes/male_viking/idle.webp')} onBack={() => navigate('battle')}/>
          : <CaveGemsScreen en={en} onBack={() => navigate('battle')}/>}</div>
      </> : <div className="cx-camp-content">
        <span className="cx-eyebrow">TERRITORY · {t('ТЕСТ', 'TEST')}</span>
        <h1>{panel === 'map' ? t('Путь в бездну', 'Into the abyss') : panel === 'hero' ? t('Герой и снаряжение', 'Hero & equipment') : panel === 'clan' ? t('Клан · походный отряд', 'Clan · expedition party') : panel === 'games' ? t('Итоги экспедиции', 'Expedition record') : t('Привал у входа', 'Entrance camp')}</h1>
        {panel === 'map' ? <><p>{view.route.map(biomeName).join(' → ')}</p><div className="cx-route-map">{['crystal','spore','ember','astral','forge'].map(b => <div key={b} style={{borderColor:BIOMES[b as Biome].color}}><b>{biomeName(b as Biome)}</b><span>{view.route.includes(b as Biome) ? '✓' : '◇'}</span></div>)}</div><p>{t('Выбор двух арок открывается после зачистки комнаты.', 'Two arches open after clearing a room.')}</p></>
        : panel === 'hero' ? <><img className="cx-camp-hero" src={assetUrl('assets/territory/characters/heroes/male_viking/idle.webp')} alt=""/><p>HP {Math.ceil(view.hp)}/{view.maxHp} · {t('Удар', 'Strike')} {30 + view.attackBonus} · {t('Защита', 'Defense')} {view.defenseBonus}</p><PlaytestGear en={en} assetUrl={assetUrl} onInspect={i => setInspectGear(i)}/><p>{t('Тёмные вещи и самоцветы усиливают следующий новый забег.', 'Dark gear and socketed gems strengthen your next new run.')}</p></>
        : panel === 'clan' ? <div className="cx-party-cards">{['northern_warrior','forest_healer'].map((id,i) => <div key={id}><img src={assetUrl(`assets/territory/characters/followers/${id}/idle.webp`)} alt=""/><b>{i ? t('Лесная целительница', 'Forest healer') : t('Северный воин', 'Northern warrior')}</b><p>HP {Math.ceil(view.followerHp[i])}/{i ? 220 : 260}</p><small>{i ? t('Магические снаряды · лечение от Источника', 'Magic projectiles · Spring healing') : t('Ближний бой · поддержка в атаке', 'Melee · attack support')}</small></div>)}</div>
        : <><p>{t('Комната', 'Room')} {view.room+1}/3 · {view.kills}/16 {t('врагов', 'foes')}</p><p>{view.blocks} {t('блоков', 'blocks')} · {view.dodges} {t('уклонений', 'evades')} · {view.casts} {t('умений', 'skills')}</p><p>{t('Тестовые вещи', 'Test items')}: {bank.items.length}</p><p>{t('Новый забег пополняет только тестовый пояс.', 'A new run refills only the test belt.')}</p></>}
        <button className="cx-primary" onClick={() => navigate('battle')}>{t('Продолжить забег', 'Continue run')}</button>
        <button onClick={() => { if (!playing || confirm(t('Начать новый тестовый забег?', 'Start a new test run?'))) begin(); }}>{t('Новый забег', 'New run')}</button>
      </div>}
    </section>}
    <PlaytestNav assetUrl={assetUrl} en={en} active={panel ?? 'battle'} onNavigate={navigate}/>
  </main>;
  return focused ? createPortal(content, document.body) : content;
}
