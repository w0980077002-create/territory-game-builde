import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, MapPinned, Pause, Play, RotateCcw, Shield, Sparkles, Swords, Users, X } from 'lucide-react';
import { WoodenPlaque } from '@/components/ui/WoodenPlaque';
import {
  BRANCHES, DEFAULT_SKILLS, IDLE_PASSIVES, IDLE_RUNES, IDLE_SKILLS,
  availableRunesForSkill, findIdleSkill,
  type CombatVfx, type IdleSkillContent, type SkillBranch,
} from '@/game/idleContent/catalog';
import { createIdleCombat, advanceIdleCombat } from '@/game/idleEngine';
import { createPreviewCatalog, createPreviewInput, createPreviewLoadout } from '@/game/idleContent/toEngine';
import { CAMPAIGN_CHAPTERS, getPreviewStage } from '@/game/idleContent/campaign';
import { COMPANION_ROSTER, DEFAULT_COMPANIONS, HERO_APPEARANCES } from '@/game/idleContent/companions';
import { PREVIEW_EQUIPMENT_SLOTS, autoEquipPreviewLoot, rollPreviewLoot, type PreviewLootItem } from '@/game/idleContent/loot';
import './idleCombatPreview.css';

const ASSETS = import.meta.env.BASE_URL + 'assets/territory/';
type CombatPose = 'idle' | 'attack' | 'block' | 'dodge' | 'hit' | 'death';
type FollowerPose = 'idle' | 'attack' | 'cast';
type Panel = 'skills' | 'runes' | 'passives' | 'companions' | 'inventory' | 'adventure' | null;
type BattleVisual = { id: string; vfx: CombatVfx; skill: string; number?: number; critical: boolean;
  target: 'hero' | 'enemy'; defense?: 'block' | 'dodge'; healing?: boolean };
type SlashVisual = { id: string; target: 'hero' | 'enemy'; hitIndex: number };
type LootVisual = { id: string; icons: string[] };
type BattleView = { stage: number; heroHp: number; foeHp: number; energy: number; victories: number; phase: string };
const PREVIEW_CATALOG = createPreviewCatalog();
const COMPANION_BY_ID = new Map(COMPANION_ROSTER.map(companion => [companion.id, companion]));
const SKILL_BY_ID = new Map(IDLE_SKILLS.map(skill => [skill.id, skill]));
const RUNE_BY_ID = new Map(IDLE_RUNES.map(rune => [rune.id, rune]));
const STATUS_SYMBOLS: Record<string, string> = { burn: '🔥', slow: '❄', mitigation: '🛡', crit: '✹', precision: '✧' };
const INITIAL_RUNES: Record<string, string[]> = {
  double_cleave: ['wolf_fang', 'seers_mark'], forge_heat: ['fire_ember'],
  ice_shackles: ['glacial_edge'], berserker_fury: ['wolf_fang'], thunder_wrath: ['storm_core'],
};
const INITIAL_VIEW: BattleView = { stage: 1, heroHp: 100, foeHp: 100, energy: 80, victories: 0, phase: 'approach' };
const INITIAL_COMBAT = createIdleCombat(createPreviewInput(PREVIEW_CATALOG, createPreviewLoadout(DEFAULT_SKILLS, INITIAL_RUNES)));

const chooseRune = (slots: ReadonlyArray<string>, runeId: string) => {
  if (slots.includes(runeId)) return slots.filter((id) => id !== runeId);
  return [...slots.slice(-1), runeId];
};

export function IdleCombatPreview() {
  const [selected, setSelected] = useState<Record<SkillBranch, string>>({ ...DEFAULT_SKILLS });
  const [runeSlots, setRuneSlots] = useState<Record<string, string[]>>(INITIAL_RUNES);
  const [selectedCompanions, setSelectedCompanions] = useState<string[]>([...DEFAULT_COMPANIONS]);
  const [selectedHero, setSelectedHero] = useState<string>(HERO_APPEARANCES[0].id);
  const [panel, setPanel] = useState<Panel>(null);
  const [detailId, setDetailId] = useState('double_cleave');
  const [auto, setAuto] = useState(true);
  const [pose, setPose] = useState<CombatPose>('idle');
  const [foePose, setFoePose] = useState<CombatPose>('idle');
  const [visual, setVisual] = useState<BattleVisual | null>(null);
  const [slash, setSlash] = useState<SlashVisual | null>(null);
  const [comboStep, setComboStep] = useState(0);
  const [loot, setLoot] = useState<LootVisual | null>(null);
  const [followerPose, setFollowerPose] = useState<Record<string, FollowerPose>>({});
  const [gearItems, setGearItems] = useState<Array<PreviewLootItem | null>>(() => Array(8).fill(null));
  const [bagItems, setBagItems] = useState<PreviewLootItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [maxUnlockedStage, setMaxUnlockedStage] = useState(1);
  const [demoXp, setDemoXp] = useState(0);
  const [chapterSelect, setChapterSelect] = useState(1);
  const [activeStatuses, setActiveStatuses] = useState<{ hero: string[]; enemy: string[] }>({ hero: [], enemy: [] });
  const [battle, setBattle] = useState<BattleView>(INITIAL_VIEW);
  const loadout = useMemo(() => createPreviewLoadout(selected, runeSlots), [selected, runeSlots]);
  const combatRef = useRef(INITIAL_COMBAT);
  const victoriesRef = useRef(0);
  const lastTickRef = useRef(0);
  const lastViewRef = useRef(0);
  const clearMoveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLootRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followerTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const gearRef = useRef<Array<PreviewLootItem | null>>(Array(8).fill(null));
  const bagRef = useRef<PreviewLootItem[]>([]);
  const statusSignatureRef = useRef('');

  const activeSkills = useMemo(() => BRANCHES.map((branch) => findIdleSkill(selected[branch.id])).filter((skill): skill is IdleSkillContent => !!skill), [selected]);
  const detail = findIdleSkill(detailId) ?? activeSkills[0];
  const encounter = useMemo(() => getPreviewStage(battle.stage), [battle.stage]);
  const isBoss = encounter.boss;
  const heroName = HERO_APPEARANCES.find(hero => hero.id === selectedHero)?.name ?? 'Воин севера';
  const heroArt = `${ASSETS}characters/heroes/${selectedHero}/`;
  const enemyArt = `${ASSETS}characters/${encounter.enemyArt}/`;
  const selectedItem = bagItems.find(item => item.id === selectedItemId)
    ?? gearItems.find(item => item?.id === selectedItemId) ?? null;
  const selectedSlotIndex = selectedItem ? PREVIEW_EQUIPMENT_SLOTS.findIndex(slot => slot.id === selectedItem.slotId) : -1;
  const comparedItem = selectedSlotIndex >= 0 ? gearItems[selectedSlotIndex] : null;

  useEffect(() => {
    // Decode upcoming sprites before the next boss/attack to avoid mobile loading stutter.
    const nextEnemy = getPreviewStage(battle.stage + 1);
    const assets = [
      ...['idle', 'attack', 'hit', 'block', 'dodge', 'death'].map(pose => `${heroArt}${pose}.webp`),
      ...['idle', 'attack', 'hit', 'block', 'dodge', 'death'].map(pose => `${enemyArt}${pose}.webp`),
      ...selectedCompanions.flatMap(id => ['idle', 'attack'].map(pose => `${ASSETS}characters/followers/${id}/${pose}.webp`)),
      `${ASSETS}characters/${nextEnemy.enemyArt}/idle.webp`,
      `${ASSETS}characters/${nextEnemy.enemyArt}/attack.webp`,
    ];
    for (const src of assets) { const img = new Image(); img.src = src; }
  }, [battle.stage, heroArt, enemyArt, selectedCompanions]);

  const resetBattle = (startAtStage = 1, clearLabSession = false) => {
    combatRef.current = createIdleCombat(createPreviewInput(PREVIEW_CATALOG, loadout, selectedCompanions, startAtStage));
    victoriesRef.current = 0;
    setBattle({ ...INITIAL_VIEW, stage: startAtStage });
    setVisual(null);
    setSlash(null);
    setComboStep(0);
    setLoot(null);
    setFollowerPose({});
    for (const timer of Object.values(followerTimersRef.current)) clearTimeout(timer);
    followerTimersRef.current = {};
    if (clearLabSession) {
      gearRef.current = Array(8).fill(null);
      bagRef.current = [];
      setGearItems([...gearRef.current]);
      setBagItems([]);
      setSelectedItemId(null);
      setMaxUnlockedStage(1);
      setDemoXp(0);
    }
    setActiveStatuses({ hero: [], enemy: [] });
    statusSignatureRef.current = '';
    if (clearLootRef.current) clearTimeout(clearLootRef.current);
    setPose('idle');
    setFoePose('idle');
  };

  // Changing the equipped skills or rune sockets changes the simulation itself.
  useEffect(() => {
    combatRef.current = createIdleCombat(createPreviewInput(PREVIEW_CATALOG, loadout, selectedCompanions));
    victoriesRef.current = 0;
    setBattle({ ...INITIAL_VIEW });
    setVisual(null);
    setSlash(null);
    setComboStep(0);
    setLoot(null);
    setFollowerPose({});
    setActiveStatuses({ hero: [], enemy: [] });
    statusSignatureRef.current = '';
    for (const timer of Object.values(followerTimersRef.current)) clearTimeout(timer);
    followerTimersRef.current = {};
    if (clearLootRef.current) clearTimeout(clearLootRef.current);
    setPose('idle');
    setFoePose('idle');
  }, [loadout, selectedCompanions]);

  useEffect(() => {
    if (!auto) return;
    lastTickRef.current = performance.now();
    lastViewRef.current = 0;
    const tick = () => {
      const now = performance.now();
      if (document.visibilityState === 'hidden') { lastTickRef.current = now; return; }
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
      const nextFollowers: Record<string, FollowerPose> = {};
      const criticalContacts = new Set(frame.events.filter((event) => event.type === 'critical').map((event) => event.contactId));
      const blockedContacts = new Set(frame.events.filter((event) => event.type === 'block').map((event) => event.contactId));
      const dodgedContacts = new Set(frame.events.filter((event) => event.type === 'dodge').map((event) => event.contactId));

      for (const event of frame.events) {
        if (event.type === 'stage_clear') {
          victoriesRef.current += 1;
          setMaxUnlockedStage(current => Math.min(100, Math.max(current, event.stage + 1)));
          setDemoXp(current => current + 30 + event.stage * 5);
        }
        if (event.type === 'loot_visual') {
          const drops = rollPreviewLoot(event.stage);
          const nextGear = autoEquipPreviewLoot(gearRef.current, bagRef.current, drops);
          gearRef.current = nextGear.equipped;
          bagRef.current = nextGear.inventory;
          setGearItems([...nextGear.equipped]);
          setBagItems([...nextGear.inventory]);
          setSelectedItemId(drops[0]?.id ?? null);
          lootVisual = { id: event.id, icons: drops.map(item => item.icon) };
        }
        if (event.type === 'death') {
          if (event.target === 'enemy') nextFoePose = 'death';
          else if (event.target === 'hero') nextPose = 'death';
        }
        if (event.type === 'spawn' && event.actor === 'enemy') nextFoePose = 'idle';
        if (event.type === 'companion_start' && event.companionId) {
          nextFollowers[event.companionId] = (COMPANION_BY_ID.get(event.companionId)?.attack ?? 0) > 0 ? 'attack' : 'cast';
        }
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
          if (event.source === 'attack' || event.source === 'companion') {
            nextSlash = { id: event.id, target: event.target ?? 'enemy', hitIndex: event.hitIndex ?? 1 };
            if (event.actor === 'hero' && (event.hitIndex ?? 1) > 1) {
              nextPose = 'attack';
              nextComboStep = event.hitIndex ?? 1;
            }
          }
          const skill = event.skillId ? SKILL_BY_ID.get(event.skillId) : undefined;
          const rune = event.runeId ? RUNE_BY_ID.get(event.runeId) : undefined;
          const companion = event.companionId ? COMPANION_BY_ID.get(event.companionId) : undefined;
          const boss = event.actor === 'enemy' ? getPreviewStage(event.stage) : undefined;
          effectVisual = {
            id: event.id, vfx: (event.vfxKey as CombatVfx) || rune?.vfx || skill?.vfx || 'steel',
            skill: rune ? `Руна: ${rune.name}` : skill?.name || companion?.name
              || (boss?.ability?.id === event.skillId ? `Приём: ${boss?.enemyName ?? 'босса'}` : 'Удар'),
            number: event.value === undefined ? 0 : Math.round(event.value),
            critical: !!event.contactId && criticalContacts.has(event.contactId),
            target: event.target ?? 'enemy', defense,
          };
        }
        if (event.type === 'rune_proc') {
          const rune = event.runeId ? RUNE_BY_ID.get(event.runeId) : undefined;
          if (rune) effectVisual = { id: event.id, vfx: rune.vfx, skill: `Руна: ${rune.name}`,
            critical: false, target: event.target ?? 'enemy' };
        }
        if (event.type === 'heal') {
          const companion = event.skillId?.startsWith('companion:')
            ? COMPANION_BY_ID.get(event.skillId.slice('companion:'.length)) : undefined;
          effectVisual = { id: event.id, vfx: 'heal', skill: companion?.name ?? 'Исцеление',
            number: Math.round(event.value ?? 0), critical: false, target: event.target ?? 'hero', healing: true };
        }
        if (event.type === 'status_apply' && event.skillId?.startsWith('companion:') && !effectVisual?.healing) {
          const companion = COMPANION_BY_ID.get(event.skillId.slice('companion:'.length));
          if (companion) effectVisual = { id: event.id, vfx: (companion.vfxKey as CombatVfx) || 'heal',
            skill: companion.name, critical: false, target: event.target ?? 'hero' };
        }
      }
      const s = frame.state;
      const statusKinds = {
        hero: [...new Set(s.statuses.filter(status => status.target === 'hero').map(status => status.type))].sort(),
        enemy: [...new Set(s.statuses.filter(status => status.target === 'enemy').map(status => status.type))].sort(),
      };
      const signature = JSON.stringify(statusKinds);
      if (signature !== statusSignatureRef.current) {
        statusSignatureRef.current = signature;
        setActiveStatuses(statusKinds);
      }
      const finished = ['victory', 'defeat', 'timeout', 'invalid'].includes(s.phase);
      if (now - lastViewRef.current >= 125 || frame.events.length > 0 || finished) {
        lastViewRef.current = now;
        setBattle({ stage: s.stage, heroHp: Math.round(100 * s.hero.hp / s.hero.stats.maxHp),
          foeHp: Math.round(100 * s.enemy.hp / s.enemy.stats.maxHp),
          energy: s.hero.stats.maxEnergy ? Math.round(100 * s.hero.energy / s.hero.stats.maxEnergy) : 0,
          victories: victoriesRef.current, phase: s.phase });
      }
      if (finished) setAuto(false);
      if (nextPose) setPose(nextPose);
      if (nextFoePose) setFoePose(nextFoePose);
      if (effectVisual) setVisual(effectVisual);
      if (nextSlash) setSlash(nextSlash);
      if (nextComboStep > 0) setComboStep(nextComboStep);
      if (Object.keys(nextFollowers).length) {
        setFollowerPose(current => ({ ...current, ...nextFollowers }));
        for (const id of Object.keys(nextFollowers)) {
          if (followerTimersRef.current[id]) clearTimeout(followerTimersRef.current[id]);
          followerTimersRef.current[id] = setTimeout(() => {
            setFollowerPose(current => ({ ...current, [id]: 'idle' }));
            delete followerTimersRef.current[id];
          }, 690);
        }
      }
      if (lootVisual) {
        setLoot(lootVisual);
        if (clearLootRef.current) clearTimeout(clearLootRef.current);
        clearLootRef.current = setTimeout(() => setLoot(null), 1350);
      }
      if (nextPose || nextFoePose || effectVisual || nextSlash || Object.keys(nextFollowers).length) {
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
    for (const timer of Object.values(followerTimersRef.current)) clearTimeout(timer);
  }, []);

  const showDetail = (id: string) => { setDetailId(id); setPanel('runes'); };
  const equip = (branch: SkillBranch, id: string) => {
    setSelected((current) => ({ ...current, [branch]: id }));
    setDetailId(id);
  };
  const equipPreviewItem = (item: PreviewLootItem) => {
    const slotIndex = PREVIEW_EQUIPMENT_SLOTS.findIndex(slot => slot.id === item.slotId);
    if (slotIndex < 0) return;
    const former = gearRef.current[slotIndex];
    gearRef.current = [...gearRef.current];
    gearRef.current[slotIndex] = item;
    bagRef.current = bagRef.current.filter(candidate => candidate.id !== item.id);
    if (former && former.id !== item.id) bagRef.current = [former, ...bagRef.current];
    setGearItems([...gearRef.current]);
    setBagItems([...bagRef.current]);
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
            <span className="territory-idle-chapter__line">Глава {encounter.chapter} · {encounter.chapterName} · {encounter.stageInChapter}/20</span>
            <strong>Этап {battle.stage} {isBoss ? encounter.elite ? '· ЭЛИТА' : '· БОСС' : '· Битва'}</strong>
            <div className="territory-idle-chapter__ticks" aria-hidden="true">{Array.from({ length: 5 }, (_, index) =>
              <i key={index} className={index <= (battle.stage - 1) % 5 ? 'territory-idle-chapter__tick--lit' : ''} />)}</div>
          </div>
        </header>

        <section className={`territory-idle-battlefield ${visual?.critical ? 'territory-idle-battlefield--critical' : ''}`} style={{ backgroundImage: `url(${ASSETS}scenes/arena-viking.webp)` }} aria-label="Боевой показ">
          <div className="territory-idle-vignette" />
          <div className="territory-idle-name territory-idle-name--hero"><b>{heroName}</b><span>ур. 25 · демонстрация</span></div>
          <div className={`territory-idle-name territory-idle-name--foe ${isBoss ? 'territory-idle-name--boss' : ''}`}>
            <b>{encounter.enemyName}</b><span>{Math.round(battle.foeHp)}% HP</span></div>
          <div className="territory-idle-status-icons territory-idle-status-icons--hero" aria-label="Эффекты героя">
            {activeStatuses.hero.map(type => <span key={type} className={`territory-idle-status-icon--${type}`}>{STATUS_SYMBOLS[type]}</span>)}
          </div>
          <div className="territory-idle-status-icons territory-idle-status-icons--enemy" aria-label="Эффекты врага">
            {activeStatuses.enemy.map(type => <span key={type} className={`territory-idle-status-icon--${type}`}>{STATUS_SYMBOLS[type]}</span>)}
          </div>
          {selectedCompanions.map((id, index) => {
            const companion = COMPANION_BY_ID.get(id);
            const companionArt = `${ASSETS}characters/followers/${id}/`;
            const followerAction = followerPose[id] ?? 'idle';
            return <div key={id} className={`territory-idle-follower territory-idle-follower--slot-${index} territory-idle-follower--${followerAction}`}
              title={companion?.name}>
              <img src={`${companionArt}${followerAction === 'idle' ? 'idle' : 'attack'}.webp`}
                alt={companion?.name ?? 'Спутник'} draggable={false} />
            </div>;
          })}
          <div className={`territory-idle-hero territory-idle-pose--${pose} territory-idle-combo--${comboStep}`}>
            <img src={heroArt + pose + '.webp'} alt={heroName} draggable={false} />
          </div>
          <div className={`territory-idle-foe territory-idle-foe--${foePose} ${isBoss ? 'territory-idle-foe--boss' : ''}`}>
            <img src={enemyArt + foePose + '.webp'} alt={encounter.enemyName} draggable={false} />
          </div>
          {slash && <div key={slash.id} className={`territory-idle-slash territory-idle-slash--${slash.target} territory-idle-slash--${slash.hitIndex}`} aria-hidden="true"><i /><i /></div>}
          {loot && <div key={loot.id} className="territory-idle-loot-burst" aria-label="Визуальная демонстрация добычи без выдачи предметов">
            {loot.icons.map((icon, index) => <img key={`${index}-${icon}`} className={`territory-idle-loot-burst__item territory-idle-loot-burst__item--${index + 1}`}
              src={`${ASSETS}ui/equipment-cartoon/${icon}.webp`} alt="" />)}
          </div>}
          {visual && <div key={visual.id} className={`territory-idle-impact territory-idle-impact--${visual.vfx} ${visual.target === 'hero' ? 'territory-idle-impact--hero' : ''}`}>
            <span className="territory-idle-impact__magic" aria-hidden="true"><i /><i /><i /></span>
            <span className="territory-idle-impact__burst" aria-hidden="true">{visual.vfx === 'ice' ? '✳' : visual.vfx === 'lightning' ? 'ϟ' : visual.vfx === 'fire' ? '✹' : '✦'}</span>
            <strong>{visual.healing ? `+${visual.number ?? 0}` : visual.defense === 'dodge' ? 'УКЛОН!' : visual.defense === 'block' ? 'БЛОК!' : visual.number === undefined ? 'РУНА!' : visual.number === 0 ? '0' : `${visual.critical ? 'КРИТ! ' : '−'}${visual.number}`}</strong>
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
          {PREVIEW_EQUIPMENT_SLOTS.map((slot, idx) => (
            <button className={`territory-idle-gear__slot territory-idle-gear__slot--${idx % 3} ${gearItems[idx] ? `territory-idle-gear__slot--${gearItems[idx]?.rarity}` : 'territory-idle-gear__slot--empty'}`}
              key={slot.id} onClick={() => { setSelectedItemId(gearItems[idx]?.id ?? null); setPanel('inventory'); }} title={slot.name}>
              <img src={`${ASSETS}ui/equipment-cartoon/${gearItems[idx]?.icon ?? slot.icon}.webp`} alt={slot.name} />
              <small>{gearItems[idx] ? `ур. ${gearItems[idx]?.level}` : '+'}</small>
            </button>
          ))}
        </section>

        <nav className="territory-idle-actions" aria-label="Разделы предпросмотра">
          <button onClick={() => setPanel('skills')}><Swords size={20} /><span>Навыки</span></button>
          <button onClick={() => setPanel('runes')}><Sparkles size={20} /><span>Руны</span></button>
          <button className="territory-idle-actions__focus" onClick={() => { setChapterSelect(encounter.chapter); setPanel('adventure'); }}>
            <MapPinned size={23} /><span>Приключение</span></button>
          <button onClick={() => setPanel('passives')}><Shield size={20} /><span>Пассивные</span></button>
          <button onClick={() => setPanel('companions')}><Users size={20} /><span>Спутники</span></button>
        </nav>

        {panel && <div className="territory-idle-panel-scrim" onClick={() => setPanel(null)}>
          <section className="territory-idle-panel" onClick={(event) => event.stopPropagation()} aria-label="Настройки боевой сборки">
            <header className="territory-idle-panel__top">
              <button className="territory-idle-panel__back" onClick={() => setPanel(null)} aria-label="Закрыть"><ChevronLeft size={24} /></button>
              <h2>{panel === 'skills' ? 'Боевые навыки' : panel === 'runes' ? 'Руны навыков' : panel === 'companions' ? 'Герой и спутники' : panel === 'inventory' ? 'Экипировка и добыча' : panel === 'adventure' ? 'Приключение' : 'Пассивные навыки'}</h2>
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
              {panel === 'companions' && <>
                <p className="territory-idle-panel__hint">Четыре облика героя. Экипировка для всех общая. Выбранные спутники действуют самостоятельно в бою — наносят урон или накладывают реальные эффекты.</p>
                <h3>Выбери героя</h3>
                <div className="territory-idle-ally-grid territory-idle-ally-grid--heroes">{HERO_APPEARANCES.map(hero => <button
                  key={hero.id} onClick={() => setSelectedHero(hero.id)}
                  className={`territory-idle-ally-card ${selectedHero === hero.id ? 'territory-idle-ally-card--selected' : ''}`}>
                  <img src={`${ASSETS}characters/heroes/${hero.id}/idle.webp`} alt="" />
                  <b>{hero.name}</b><small>{selectedHero === hero.id ? '✓ Выбран' : 'Выбрать'}</small>
                </button>)}</div>
                <h3>Пять спутников</h3>
                <div className="territory-idle-ally-grid">{COMPANION_ROSTER.map(companion => {
                  const enabled = selectedCompanions.includes(companion.id);
                  return <button key={companion.id}
                    onClick={() => setSelectedCompanions(current => current.includes(companion.id)
                      ? current.filter(id => id !== companion.id) : [...current, companion.id])}
                    className={`territory-idle-ally-card ${enabled ? 'territory-idle-ally-card--selected' : ''}`}>
                    <img src={`${ASSETS}characters/followers/${companion.id}/idle.webp`} alt="" />
                    <b>{companion.name}</b><small>{enabled ? '✓ В бою' : '+ Добавить'}</small>
                    <span>{companion.description}</span>
                  </button>;
                })}</div>
                <p className="territory-idle-panel__hint">Изменение состава перезапускает только тренировочный бой. Прогресс и предметы игроков не затрагиваются.</p>
              </>}
              {panel === 'inventory' && <>
                <p className="territory-idle-panel__hint">После победы экипировка падает на поле и автоматически заполняет свободные ячейки. Дубликаты попадают в сумку. Это локальная демонстрация без настоящих наград и начислений характеристик.</p>
                <div className="territory-idle-item-compare">
                  <div className="territory-idle-item-compare__box"><small>НАДЕТО</small>
                    {comparedItem ? <><img src={`${ASSETS}ui/equipment-cartoon/${comparedItem.icon}.webp`} alt="" />
                      <b>{comparedItem.name}</b><span>Сила {comparedItem.power} · ур. {comparedItem.level}</span></>
                      : <strong>Пустая ячейка</strong>}
                  </div>
                  <div className="territory-idle-item-compare__box"><small>ВЫБРАНО</small>
                    {selectedItem ? <><img src={`${ASSETS}ui/equipment-cartoon/${selectedItem.icon}.webp`} alt="" />
                      <b>{selectedItem.name}</b><span>Сила {selectedItem.power} · ур. {selectedItem.level}</span></>
                      : <strong>Выбери предмет ниже</strong>}
                  </div>
                </div>
                {selectedItem && bagItems.some(item => item.id === selectedItem.id) && <button
                  className="territory-idle-passive-link" onClick={() => equipPreviewItem(selectedItem)}>Надеть выбранный предмет <span>⚔</span></button>}
                <h3>Сумка · {bagItems.length}</h3>
                {bagItems.length === 0 ? <p className="territory-idle-panel__hint">Пока пусто. Побеждай противников — предметы появятся здесь, если подходящая ячейка экипировки уже занята.</p> :
                  <div className="territory-idle-bag-grid">{bagItems.map(item => <button key={item.id}
                    onClick={() => setSelectedItemId(item.id)}
                    className={`territory-idle-bag-item territory-idle-bag-item--${item.rarity} ${selectedItemId === item.id ? 'territory-idle-bag-item--selected' : ''}`}>
                    <img src={`${ASSETS}ui/equipment-cartoon/${item.icon}.webp`} alt="" />
                    <b>{item.name}</b><small>ур. {item.level} · сила {item.power}</small>
                  </button>)}</div>}
              </>}
              {panel === 'adventure' && <>
                <p className="territory-idle-panel__hint">Пять глав по двадцать этапов, отдельные элитные противники и боссы. Открытие этапов и опыт действуют только в этой демонстрации, без записи игрового прогресса.</p>
                <div className="territory-idle-map-stats"><span>Открыто: {maxUnlockedStage}/100</span><span>Опыт демонстрации: {demoXp}</span></div>
                <div className="territory-idle-chapter-tabs">{CAMPAIGN_CHAPTERS.map((name, index) => <button
                  key={name} className={chapterSelect === index + 1 ? 'territory-idle-chapter-tabs__active' : ''}
                  onClick={() => setChapterSelect(index + 1)}>{index + 1}</button>)}</div>
                <h3>{CAMPAIGN_CHAPTERS[chapterSelect - 1]}</h3>
                <div className="territory-idle-stage-grid">{Array.from({ length: 20 }, (_, index) => {
                  const stage = (chapterSelect - 1) * 20 + index + 1;
                  const available = stage <= maxUnlockedStage;
                  const boss = getPreviewStage(stage);
                  return <button key={stage} disabled={!available}
                    className={`${boss.boss ? 'territory-idle-stage-grid__boss' : ''} ${battle.stage === stage ? 'territory-idle-stage-grid__current' : ''}`}
                    title={boss.enemyName}
                    onClick={() => { resetBattle(stage); setAuto(true); setPanel(null); }}>
                    <span>{available ? boss.boss ? '♛' : '⚔' : '🔒'}</span><b>{stage}</b>
                  </button>;
                })}</div>
                <button className="territory-idle-passive-link" onClick={() => { resetBattle(1, true); setAuto(true); setPanel(null); }}>
                  <RotateCcw size={16} /> Перезапустить только лабораторию <span>↻</span></button>
              </>}
            </div>
          </section>
        </div>}
      </div>
    </div>
  );
}
