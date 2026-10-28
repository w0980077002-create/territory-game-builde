import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, Pause, Play, RotateCcw, Shield, Sparkles, Swords, X } from 'lucide-react';
import { WoodenPlaque } from '@/components/ui/WoodenPlaque';
import {
  BRANCHES, DEFAULT_SKILLS, IDLE_PASSIVES, IDLE_RUNES, IDLE_SKILLS,
  availableRunesForSkill, findIdleSkill,
  type CombatVfx, type IdleSkillContent, type SkillBranch,
} from '@/game/idleContent/catalog';
import './idleCombatPreview.css';

const ASSETS = import.meta.env.BASE_URL + 'assets/territory/';
const HERO = ASSETS + 'characters/heroes/male_viking/';
const FOE = ASSETS + 'characters/enemies/goblin/';
const ALLY = ASSETS + 'characters/followers/loyal_shield/';
const BOSS = ASSETS + 'characters/bosses/dark_priest/';

type CombatPose = 'idle' | 'attack' | 'block' | 'dodge' | 'hit';
type Panel = 'skills' | 'runes' | 'passives' | null;
type BattleVisual = { id: number; vfx: CombatVfx; skill: string; number: number; critical: boolean };

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
  const [runeSlots, setRuneSlots] = useState<Record<string, string[]>>({
    double_cleave: ['wolf_fang', 'seers_mark'], forge_heat: ['fire_ember'],
    ice_shackles: ['glacial_edge'], berserker_fury: ['wolf_fang'], thunder_wrath: ['storm_core'],
  });
  const [panel, setPanel] = useState<Panel>(null);
  const [detailId, setDetailId] = useState('double_cleave');
  const [auto, setAuto] = useState(true);
  const [pose, setPose] = useState<CombatPose>('idle');
  const [foePose, setFoePose] = useState<CombatPose>('idle');
  const [visual, setVisual] = useState<BattleVisual | null>(null);
  const [battle, setBattle] = useState({ stage: 1, heroHp: 100, foeHp: 100, energy: 80, victories: 0 });
  const battleRef = useRef(battle);
  const nextMoveRef = useRef(0);
  const clearMoveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSkills = useMemo(() => BRANCHES.map((branch) => findIdleSkill(selected[branch.id])).filter((skill): skill is IdleSkillContent => !!skill), [selected]);
  const detail = findIdleSkill(detailId) ?? activeSkills[0];
  const isBoss = battle.stage % 5 === 0;

  useEffect(() => {
    if (!auto) return;
    const tick = () => {
      const move = nextMoveRef.current++;
      const skill = activeSkills[move % activeSkills.length];
      if (!skill) return;
      const next = { ...battleRef.current };
      const critical = move % 4 === 3;
      const damage = 24 + (move % 3) * 7 + (critical ? 22 : 0);
      const blocks = move % 7 === 6;
      const dodges = move % 11 === 9;
      next.energy = Math.max(12, Math.min(100, next.energy + 11 - Math.round(skill.energyCost / 3)));
      next.heroHp = Math.max(28, next.heroHp - (move % 5 === 4 ? 9 : 0));
      next.foeHp = Math.max(0, next.foeHp - damage);

      setPose(blocks ? 'block' : dodges ? 'dodge' : 'attack');
      setFoePose(blocks ? 'attack' : 'hit');
      const selectedRune = (runeSlots[skill.id] ?? [])[0];
      const rune = IDLE_RUNES.find((item) => item.id === selectedRune);
      setVisual({ id: move, vfx: rune?.vfx ?? skill.vfx, skill: skill.name, number: damage, critical });

      if (next.foeHp <= 0) {
        next.victories += 1;
        next.stage += 1;
        next.foeHp = 100 + (next.stage - 1) * 15;
        next.heroHp = Math.min(100, next.heroHp + 6);
      }
      battleRef.current = next;
      setBattle(next);
      if (clearMoveRef.current) clearTimeout(clearMoveRef.current);
      clearMoveRef.current = setTimeout(() => {
        setPose('idle');
        setFoePose('idle');
        setVisual(null);
      }, 780);
    };
    const interval = setInterval(tick, 1950);
    return () => {
      clearInterval(interval);
      if (clearMoveRef.current) clearTimeout(clearMoveRef.current);
    };
  }, [activeSkills, auto, runeSlots]);

  const resetBattle = () => {
    const initial = { stage: 1, heroHp: 100, foeHp: 100, energy: 80, victories: 0 };
    battleRef.current = initial;
    nextMoveRef.current = 0;
    setBattle(initial);
    setVisual(null);
    setPose('idle');
    setFoePose('idle');
  };

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
            <span className="territory-idle-preview-flag">ПРЕВЬЮ • без наград</span>
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
          <div className="territory-idle-name territory-idle-name--foe"><b>{isBoss ? 'Тёмный жрец' : 'Гоблин-налётчик'}</b><span>{Math.round(battle.foeHp)} HP</span></div>
          <div className={`territory-idle-follower ${pose === 'attack' ? 'territory-idle-follower--attack' : ''}`}>
            <img src={ALLY + (pose === 'attack' ? 'attack.webp' : 'idle.webp')} alt="Спутник" />
          </div>
          <div className={`territory-idle-hero territory-idle-pose--${pose}`}>
            <img src={HERO + pose + '.webp'} alt="Наш викинг" draggable={false} />
          </div>
          <div className={`territory-idle-foe territory-idle-foe--${foePose}`}>
            <img src={(isBoss ? BOSS : FOE) + foePose + '.webp'} alt="Противник" draggable={false} />
          </div>
          {visual && <div key={visual.id} className={`territory-idle-impact territory-idle-impact--${visual.vfx}`}>
            <span className="territory-idle-impact__magic" aria-hidden="true"><i /><i /><i /></span>
            <span className="territory-idle-impact__burst" aria-hidden="true">{visual.vfx === 'ice' ? '✳' : visual.vfx === 'lightning' ? 'ϟ' : visual.vfx === 'fire' ? '✹' : '✦'}</span>
            <strong>{visual.critical ? 'КРИТ! ' : '−'}{visual.number}</strong>
          </div>}
          {visual && <div key={'name' + visual.id} className="territory-idle-skill-callout">{visual.skill}</div>}
          <div className="territory-idle-ground-shade" />
        </section>

        <section className="territory-idle-hud" aria-label="Состояние героя">
          <div className="territory-idle-orb territory-idle-orb--life"><span>♥</span><b>{battle.heroHp}%</b></div>
          <div className="territory-idle-hud__center">
            <span>⚔ ПОБЕД {battle.victories}</span>
            <div className="territory-idle-healthtrack"><span style={{ width: `${battle.heroHp}%` }} /></div>
            <button onClick={() => setAuto((value) => !value)} aria-label={auto ? 'Приостановить показ' : 'Продолжить показ'}>
              {auto ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}{auto ? 'АВТО' : 'ПАУЗА'}
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
