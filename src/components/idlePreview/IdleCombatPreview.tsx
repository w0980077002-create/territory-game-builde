import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, Pause, Play, RotateCcw, Shield, Sparkles, Swords, X } from 'lucide-react';
import { WoodenPlaque } from '@/components/ui/WoodenPlaque';
import {
  BRANCHES, DEFAULT_SKILLS, IDLE_PASSIVES, IDLE_RUNES, IDLE_SKILLS,
  availableRunesForSkill, findIdleSkill,
  type CombatVfx, type IdleSkillContent, type SkillBranch,
} from '@/game/idleContent/catalog';
import { createIdleCombat, advanceIdleCombat } from '@/game/idleEngine';
import { createPreviewCatalog, createPreviewInput, createPreviewLoadout } from '@/game/idleContent/toEngine';
import './idleCombatPreview.css';

const ASSETS = import.meta.env.BASE_URL + 'assets/territory/';
const HERO = ASSETS + 'characters/heroes/male_viking/';
const FOE = ASSETS + 'characters/enemies/goblin/';
const ALLY = ASSETS + 'characters/followers/loyal_shield/';

type CombatPose = 'idle' | 'attack' | 'block' | 'dodge' | 'hit' | 'death';
type Panel = 'skills' | 'runes' | 'passives' | null;
type BattleVisual = { id: string; vfx: CombatVfx; skill: string; number?: number; critical: boolean;
  target: 'hero' | 'enemy'; defense?: 'block' | 'dodge' };
type SlashVisual = { id: string; target: 'hero' | 'enemy'; hitIndex: number };
type LootVisual = { id: string; icons: string[] };
type BattleView = { stage: number; heroHp: number; foeHp: number; energy: number; victories: number; phase: string };
const PREVIEW_CATALOG = createPreviewCatalog();
const INITIAL_RUNES: Record<string, string[]> = {
  double_cleave: ['wolf_fang', 'seers_mark'], forge_heat: ['fire_ember'],
  ice_shackles: ['glacial_edge'], berserker_fury: ['wolf_fang'], thunder_wrath: ['storm_core'],
};
const INITIAL_VIEW: BattleView = { stage: 1, heroHp: 100, foeHp: 100, energy: 80, victories: 0, phase: 'approach' };
const INITIAL_COMBAT = createIdleCombat(createPreviewInput(PREVIEW_CATALOG, createPreviewLoadout(DEFAULT_SKILLS, INITIAL_RUNES)));

const GEAR = [
  ['weapon', 'Меч'], ['helmet', 'Шлем'], ['armor', 'Доспех'], ['shield', 'Щит'],
  ['boots', 'Сапоги'], ['ring', 'Кольцо'], ['amulet', 'Амулет'], ['weapon', 'Запасное оружие'],
] as const;

const chooseRune = (slots: ReadonlyArray<string>, runeId: string) => {
  if (slots.includes(runeId)) return slots.filter((id) => id !== runeId);
  return [...slots.slice(-1), runeId];
};

export function IdleCombatPreview() {
  const [selected, setSelected] = useState<Record<SkillBranch, string>>({ ...DEFAULT_SKILLS });
  const [runeSlots, setRuneSlots] = useState<Record<string, string[]>>(INITIAL_RUNES);
  const [panel, setPanel] = useState<Panel>(null);
  const [detailId, setDetailId] = useState('double_cleave');
  const [auto, setAuto] = useState(true);
  const [pose, setPose] = useState<CombatPose>('idle');
  const [foePose, setFoePose] = useState<CombatPose>('idle');
  const [visual, setVisual] = useState<BattleVisual | null>(null);
  const [slash, setSlash] = useState<SlashVisual | null>(null);
  const [comboStep, setComboStep] = useState(0);
  const [loot, setLoot] = useState<LootVisual | null>(null);
  const [battle, setBattle] = useState<BattleView>(INITIAL_VIEW);
  const loadout = useMemo(() => createPreviewLoadout(selected, runeSlots), [selected, runeSlots]);
  const combatRef = useRef(INITIAL_COMBAT);
  const victoriesRef = useRef(0);
  const lastTickRef = useRef(0);
  const clearMoveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLootRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSkills = useMemo(() => BRANCHES.map((branch) => findIdleSkill(selected[branch.id])).filter((skill): skill is IdleSkillContent => !!skill), [selected]);
  const detail = findIdleSkill(detailId) ?? activeSkills[0];
  const isBoss = battle.stage % 5 === 0;

  const resetBattle = () => {
    combatRef.current = createIdleCombat(createPreviewInput(PREVIEW_CATALOG, loadout));
    victoriesRef.current = 0;
    setBattle({ ...INITIAL_VIEW });
    setVisual(null);
    setSlash(null);
    setComboStep(0);
    setLoot(null);
    if (clearLootRef.current) clearTimeout(clearLootRef.current);
    setPose('idle');
    setFoePose('idle');
  };

  // Changing the equipped skills or rune sockets changes the simulation itself.
  useEffect(() => {
    combatRef.current = createIdleCombat(createPreviewInput(PREVIEW_CATALOG, loadout));
    victoriesRef.current = 0;
    setBattle({ ...INITIAL_VIEW });
    setVisual(null);
    setSlash(null);
    setComboStep(0);
    setLoot(null);
    if (clearLootRef.current) clearTimeout(clearLootRef.current);
    setPose('idle');
    setFoePose('idle');
  }, [loadout]);

  useEffect(() => {
    if (!auto) return;
    lastTickRef.current = performance.now();
    const tick = () => {
      const now = performance.now();
      const elapsed = Math.min(160, Math.max(20, now - lastTickRef.current));
      lastTickRef.current = now;
      const frame = advanceIdleCombat(combatRef.current, elapsed);
      combatRef.current = frame.state;
      let nextPose: CombatPose | null = null;
      let nextFoePose: CombatPose | null = null;
      let effectVisual: BattleVisual | null = null;
      let nextSlash: SlashVisual | null = null;
      let nextComboStep = 0;
      let lootVisual: LootVisual | null = null;
      const criticalContacts = new Set(frame.events.filter((event) => event.type === 'critical').map((event) => event.contactId));
      const blockedContacts = new Set(frame.events.filter((event) => event.type === 'block').map((event) => event.contactId));
      const dodgedContacts = new Set(frame.events.filter((event) => event.type === 'dodge').map((event) => event.contactId));
      const skills = new Map(IDLE_SKILLS.map((skill) => [skill.id, skill]));
      const runes = new Map(IDLE_RUNES.map((rune) => [rune.id, rune]));

      for (const event of frame.events) {
        if (event.type === 'stage_clear') victoriesRef.current += 1;
        if (event.type === 'loot_visual') {
          const gearIndex = event.stage % GEAR.length;
          lootVisual = { id: event.id, icons: [GEAR[gearIndex][0], GEAR[(gearIndex + 3) % GEAR.length][0], GEAR[(gearIndex + 5) % GEAR.length][0]] };
        }
        if (event.type === 'death') {
          if (event.target === 'enemy') nextFoePose = 'death';
          else if (event.target === 'hero') nextPose = 'death';
        }
        if (event.type === 'spawn' && event.actor === 'enemy') nextFoePose = 'idle';
        if (event.type === 'attack_start') {
          if (event.actor === 'hero') nextPose = 'attack';
          else nextFoePose = 'attack';
        }
        if (event.type === 'block' || event.type === 'dodge') {
          if (event.actor === 'hero') nextPose = event.type;
          else nextFoePose = event.type;
        }
        if (event.type === 'impact') {
          const defense = dodgedContacts.has(event.contactId) ? 'dodge' : blockedContacts.has(event.contactId) ? 'block' : undefined;
          if (event.target === 'enemy') nextFoePose = defense ?? 'hit';
          else if (event.target === 'hero') nextPose = defense ?? 'hit';
          if (event.source === 'attack') {
            nextSlash = { id: event.id, target: event.target ?? 'enemy', hitIndex: event.hitIndex ?? 1 };
            if (event.actor === 'hero' && (event.hitIndex ?? 1) > 1) {
              nextPose = 'attack';
              nextComboStep = event.hitIndex ?? 1;
            }
          }
          const skill = event.skillId ? skills.get(event.skillId) : undefined;
          const rune = event.runeId ? runes.get(event.runeId) : undefined;
          effectVisual = {
            id: event.id, vfx: (event.vfxKey as CombatVfx) || rune?.vfx || skill?.vfx || 'steel',
            skill: rune ? `Руна: ${rune.name}` : skill?.name || 'Удар',
            number: event.value === undefined ? 0 : Math.round(event.value),
            critical: !!event.contactId && criticalContacts.has(event.contactId),
            target: event.target ?? 'enemy', defense,
          };
        }
        if (event.type === 'rune_proc') {
          const rune = event.runeId ? runes.get(event.runeId) : undefined;
          if (rune) effectVisual = { id: event.id, vfx: rune.vfx, skill: `Руна: ${rune.name}`,
            critical: false, target: event.target ?? 'enemy' };
        }
      }
      const s = frame.state;
      setBattle({ stage: s.stage, heroHp: Math.round(100 * s.hero.hp / s.hero.stats.maxHp),
        foeHp: Math.round(100 * s.enemy.hp / s.enemy.stats.maxHp),
        energy: s.hero.stats.maxEnergy ? Math.round(100 * s.hero.energy / s.hero.stats.maxEnergy) : 0,
        victories: victoriesRef.current, phase: s.phase });
      if (['victory', 'defeat', 'timeout', 'invalid'].includes(s.phase)) setAuto(false);
      if (nextPose) setPose(nextPose);
      if (nextFoePose) setFoePose(nextFoePose);
      if (effectVisual) setVisual(effectVisual);
      if (nextSlash) setSlash(nextSlash);
      if (nextComboStep > 0) setComboStep(nextComboStep);
      if (lootVisual) {
        setLoot(lootVisual);
        if (clearLootRef.current) clearTimeout(clearLootRef.current);
        clearLootRef.current = setTimeout(() => setLoot(null), 1350);
      }
      if (nextPose || nextFoePose || effectVisual || nextSlash) {
        if (clearMoveRef.current) clearTimeout(clearMoveRef.current);
        clearMoveRef.current = setTimeout(() => {
          setPose(combatRef.current.phase === 'defeat' ? 'death' : 'idle');
          setFoePose(combatRef.current.phase === 'victory' ? 'death' : 'idle');
          setVisual(null); setSlash(null); setComboStep(0);
        }, 720);
      }
    };
    const interval = setInterval(tick, 80);
    return () => {
      clearInterval(interval);
      if (clearMoveRef.current) clearTimeout(clearMoveRef.current);
    };
  }, [auto]);

  useEffect(() => () => {
    if (clearLootRef.current) clearTimeout(clearLootRef.current);
  }, []);

  const showDetail = (id: string) => { setDetailId(id); setPanel('runes'); };
  const equip = (branch: SkillBranch, id: string) => {
    setSelected((current) => ({ ...current, [branch]: id }));
    setDetailId(id);
  };

  return (
    <div className="territory-idle-surround">
      <div className="territory-idle-shell" aria-label="Демонстрация новой боевой системы TERRITORY">
        <header className="territory-idle-heading">
          <div className="territory-idle-heading__title">
            <WoodenPlaque variant="logo">TERRITORY</WoodenPlaque>
            <span className="territory-idle-preview-flag">ЖИВОЙ БОЙ • ПРЕВЬЮ • без наград</span>
          </div>
          <div className="territory-idle-chapter">
            <span className="territory-idle-chapter__line">Глава I · Земли северян</span>
            <strong>Этап {battle.stage} {isBoss ? '· БОСС' : '· Лесной дозор'}</strong>
            <div className="territory-idle-chapter__ticks" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          </div>
        </header>

        <section className={`territory-idle-battlefield ${visual?.critical ? 'territory-idle-battlefield--critical' : ''}`} style={{ backgroundImage: `url(${ASSETS}scenes/arena-viking.webp)` }} aria-label="Боевой показ">
          <div className="territory-idle-vignette" />
          <div className="territory-idle-name territory-idle-name--hero"><b>Викинг</b><span>ур. 25</span></div>
          <div className="territory-idle-name territory-idle-name--foe"><b>{isBoss ? 'Вождь гоблинов' : 'Гоблин-налётчик'}</b><span>{Math.round(battle.foeHp)}% HP</span></div>
          <div className="territory-idle-follower">
            <img src={ALLY + 'idle.webp'} alt="Спутник, ожидающий своей способности" />
          </div>
          <div className={`territory-idle-hero territory-idle-pose--${pose} territory-idle-combo--${comboStep}`}>
            <img src={HERO + pose + '.webp'} alt="Наш викинг" draggable={false} />
          </div>
          <div className={`territory-idle-foe territory-idle-foe--${foePose} ${isBoss ? 'territory-idle-foe--boss' : ''}`}>
            <img src={FOE + foePose + '.webp'} alt={isBoss ? 'Вождь гоблинов' : 'Противник'} draggable={false} />
          </div>
          {slash && <div key={slash.id} className={`territory-idle-slash territory-idle-slash--${slash.target} territory-idle-slash--${slash.hitIndex}`} aria-hidden="true"><i /><i /></div>}
          {loot && <div key={loot.id} className="territory-idle-loot-burst" aria-label="Визуальная демонстрация добычи без выдачи предметов">
            {loot.icons.map((icon, index) => <img key={`${index}-${icon}`} className={`territory-idle-loot-burst__item territory-idle-loot-burst__item--${index + 1}`}
              src={`${ASSETS}ui/equipment-cartoon/${icon}.webp`} alt="" />)}
          </div>}
          {visual && <div key={visual.id} className={`territory-idle-impact territory-idle-impact--${visual.vfx} ${visual.target === 'hero' ? 'territory-idle-impact--hero' : ''}`}>
            <span className="territory-idle-impact__magic" aria-hidden="true"><i /><i /><i /></span>
            <span className="territory-idle-impact__burst" aria-hidden="true">{visual.vfx === 'ice' ? '✳' : visual.vfx === 'lightning' ? 'ϟ' : visual.vfx === 'fire' ? '✹' : '✦'}</span>
            <strong>{visual.defense === 'dodge' ? 'УКЛОН!' : visual.defense === 'block' ? 'БЛОК!' : visual.number === undefined ? 'РУНА!' : visual.number === 0 ? '0' : `${visual.critical ? 'КРИТ! ' : '−'}${visual.number}`}</strong>
          </div>}
          {visual && <div key={'name' + visual.id} className="territory-idle-skill-callout">{visual.skill}</div>}
          <div className="territory-idle-ground-shade" />
        </section>

        <section className="territory-idle-hud" aria-label="Состояние героя">
          <div className="territory-idle-orb territory-idle-orb--life"><span>♥</span><b>{battle.heroHp}%</b></div>
          <div className="territory-idle-hud__center">
            <span>{battle.phase === 'defeat' ? '☠ ПОРАЖЕНИЕ' : battle.phase === 'victory' ? '🏆 ПОБЕДА' : `⚔ ПОБЕД ${battle.victories}`}</span>
            <div className="territory-idle-healthtrack"><span style={{ width: `${battle.heroHp}%` }} /></div>
            <button onClick={() => {
              if (['victory', 'defeat', 'timeout', 'invalid'].includes(battle.phase)) { resetBattle(); setAuto(true); }
              else setAuto((value) => !value);
            }} aria-label={auto ? 'Приостановить показ' : 'Продолжить показ'}>
              {auto ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}{auto ? 'АВТО' : battle.phase === 'victory' || battle.phase === 'defeat' ? 'ПОВТОР' : 'ПАУЗА'}
            </button>
          </div>
          <div className="territory-idle-orb territory-idle-orb--energy"><span>✦</span><b>{battle.energy}%</b></div>
        </section>

        <section className="territory-idle-gear" aria-label="Экипировка героя">
          {GEAR.map(([gear, label], idx) => (
            <button className={`territory-idle-gear__slot territory-idle-gear__slot--${idx % 3}`} key={idx} onClick={() => setPanel('skills')} title={label}>
              <img src={`${ASSETS}ui/equipment-cartoon/${gear}.webp`} alt={label} />
              <small>ур. {14 + idx}</small>
            </button>
          ))}
        </section>

        <nav className="territory-idle-actions" aria-label="Разделы предпросмотра">
          <button onClick={() => setPanel('skills')}><Swords size={20} /><span>Навыки</span></button>
          <button onClick={() => setPanel('runes')}><Sparkles size={20} /><span>Руны</span></button>
          <button className="territory-idle-actions__focus" onClick={resetBattle}><RotateCcw size={23} /><span>Сначала</span></button>
          <button onClick={() => setPanel('passives')}><Shield size={20} /><span>Пассивные</span></button>
          <button onClick={() => setPanel('skills')}><ChevronDown size={20} /><span>Сборка</span></button>
        </nav>

        {panel && <div className="territory-idle-panel-scrim" onClick={() => setPanel(null)}>
          <section className="territory-idle-panel" onClick={(event) => event.stopPropagation()} aria-label="Настройки боевой сборки">
            <header className="territory-idle-panel__top">
              <button className="territory-idle-panel__back" onClick={() => setPanel(null)} aria-label="Закрыть"><ChevronLeft size={24} /></button>
              <h2>{panel === 'skills' ? 'Боевые навыки' : panel === 'runes' ? 'Руны навыков' : 'Пассивные навыки'}</h2>
              <button className="territory-idle-panel__close" onClick={() => setPanel(null)} aria-label="Закрыть"><X size={21} /></button>
            </header>
            <div className="territory-idle-panel__scroll">
              {panel === 'skills' && <>
                <p className="territory-idle-panel__hint">Выбери одно умение в каждой из пяти веток. Нажми на выбранное повторно, чтобы открыть его руны.</p>
                {BRANCHES.map((branch) => <div className="territory-idle-skill-row" key={branch.id}>
                  <div className="territory-idle-skill-row__label"><b>{branch.title}</b><small>{branch.short}</small></div>
                  <div className="territory-idle-skill-row__cards">{IDLE_SKILLS.filter((skill) => skill.branch === branch.id).map((skill) => <button
                    key={skill.id}
                    onClick={() => { if (selected[branch.id] === skill.id) showDetail(skill.id); else equip(branch.id, skill.id); }}
                    className={`territory-idle-skill-card ${selected[branch.id] === skill.id ? 'territory-idle-skill-card--equipped' : ''}`}
                    style={{ '--skill-hue': skill.hue } as React.CSSProperties}
                    aria-label={`${skill.name}, ${selected[branch.id] === skill.id ? 'экипирован' : 'выбрать'}`}>
                    <span className="territory-idle-skill-card__symbol">{skill.symbol}</span>
                    <small>{skill.name}</small>
                    {selected[branch.id] === skill.id && <i>✓</i>}
                  </button>)}</div>
                </div>)}
                <button className="territory-idle-passive-link" onClick={() => setPanel('passives')}>Три пассивных способности <span>→</span></button>
              </>}
              {panel === 'runes' && detail && <>
                <div className="territory-idle-current-skill"><span>{detail.symbol}</span><div><b>{detail.name}</b><p>{detail.description}</p><small>Перезарядка {detail.cooldownSeconds} с · энергия {detail.energyCost}</small></div></div>
                <h3>Две руны этого навыка</h3>
                <div className="territory-idle-sockets">{[0, 1].map((idx) => {
                  const rune = IDLE_RUNES.find((item) => item.id === runeSlots[detail.id]?.[idx]);
                  return <div className="territory-idle-socket" key={idx}><span>{rune?.symbol ?? '+'}</span><b>{rune?.name ?? 'Свободный слот'}</b></div>;
                })}</div>
                <p className="territory-idle-panel__hint">Руны меняют свойства именно выбранного навыка. Пока это визуальный тест без сохранения и начислений.</p>
                <div className="territory-idle-rune-list">{availableRunesForSkill(detail).map((rune) => <button key={rune.id}
                  className={`territory-idle-rune-line ${(runeSlots[detail.id] ?? []).includes(rune.id) ? 'territory-idle-rune-line--selected' : ''}`}
                  onClick={() => setRuneSlots((current) => ({ ...current, [detail.id]: chooseRune(current[detail.id] ?? [], rune.id) }))}>
                  <span style={{ color: rune.accent }}>{rune.symbol}</span><div><b>{rune.name}</b><small>{rune.detail}</small></div>
                  <strong>{(runeSlots[detail.id] ?? []).includes(rune.id) ? '✓' : '+'}</strong>
                </button>)}</div>
                <button className="territory-idle-passive-link" onClick={() => setPanel('skills')}>Выбрать другой навык <span>→</span></button>
              </>}
              {panel === 'passives' && <><p className="territory-idle-panel__hint">Три независимых усиления боевой сборки. Все три представлены в демонстрации.</p>
                <div className="territory-idle-passive-list">{IDLE_PASSIVES.map((passive) => <div className="territory-idle-passive-card" key={passive.id}>
                  <span style={{ color: passive.accent }}>{passive.symbol}</span><div><b>{passive.name}</b><small>{passive.description}</small></div><i>✓</i>
                </div>)}</div>
                <button className="territory-idle-passive-link" onClick={() => setPanel('skills')}>Перейти к активным навыкам <span>→</span></button>
              </>}
            </div>
          </section>
        </div>}
      </div>
    </div>
  );
}
