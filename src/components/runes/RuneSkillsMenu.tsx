import { useState } from 'react';
import {
  Axe, Check, ChevronRight, CircleHelp, CloudLightning, Crosshair, Flame,
  Heart, HeartHandshake, Megaphone, PawPrint, Shield, ShieldPlus, Skull,
  Snowflake, Sparkles, Swords, Target, Wind, Zap,
  type LucideIcon,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { TRAINING_RUNES } from '@/game/builds/buildTraining';
import './runeSkillsMenu.css';

type Skill = {
  id: string;
  nameRu: string;
  nameEn: string;
  detailRu: string;
  detailEn: string;
  icon: LucideIcon;
  tone: string;
  cooldown: number;
  compatibleRunes: string[];
};

type SkillBranch = { titleRu: string; titleEn: string; mark: string; skills: [Skill, Skill, Skill] };

// An original, Viking-themed presentation of the 5 × 3 skill design.
// Deliberately isolated from GameState, production battle calculations and rewards.
const BRANCHES: SkillBranch[] = [
  {
    titleRu: 'База', titleEn: 'Base', mark: 'ᚠ', skills: [
      { id: 'double_slash', nameRu: 'Двойной рубящий', nameEn: 'Twin Slash', detailRu: 'Два последовательных удара секирой.', detailEn: 'Two consecutive axe strikes.', icon: Swords, tone: 'gold', cooldown: 4, compatibleRunes: ['wolf_fang', 'seers_mark', 'fire_ember'] },
      { id: 'hunters_lunge', nameRu: 'Выпад охотника', nameEn: 'Hunter’s Lunge', detailRu: 'Стремительный точный выпад по противнику.', detailEn: 'A quick, accurate lunge at the enemy.', icon: Crosshair, tone: 'blue', cooldown: 5, compatibleRunes: ['seers_mark', 'wolf_fang', 'glacial_edge'] },
      { id: 'axe_circle', nameRu: 'Круг секиры', nameEn: 'Axe Circle', detailRu: 'Широкий удар вокруг героя.', detailEn: 'A sweeping strike around the hero.', icon: Axe, tone: 'green', cooldown: 7, compatibleRunes: ['fire_ember', 'storm_core', 'wolf_fang'] },
    ],
  },
  {
    titleRu: 'Ядро', titleEn: 'Core', mark: 'ᚢ', skills: [
      { id: 'forge_flame', nameRu: 'Жар кузни', nameEn: 'Forge Heat', detailRu: 'Пламя кузницы обжигает цель.', detailEn: 'Forge flames scorch the target.', icon: Flame, tone: 'ember', cooldown: 9, compatibleRunes: ['fire_ember', 'storm_core', 'seers_mark'] },
      { id: 'storm_spark', nameRu: 'Искра бури', nameEn: 'Storm Spark', detailRu: 'Разряд северной грозы поражает врага.', detailEn: 'A northern storm charge strikes the enemy.', icon: Zap, tone: 'lime', cooldown: 9, compatibleRunes: ['storm_core', 'glacial_edge', 'seers_mark'] },
      { id: 'warband_roar', nameRu: 'Рёв дружины', nameEn: 'Warband Roar', detailRu: 'Боевой клич укрепляет дух героя.', detailEn: 'A war cry strengthens the hero’s resolve.', icon: Megaphone, tone: 'violet', cooldown: 12, compatibleRunes: ['oak_bark', 'wolf_fang', 'storm_core'] },
    ],
  },
  {
    titleRu: 'Контроль', titleEn: 'Control', mark: 'ᚦ', skills: [
      { id: 'frost_chains', nameRu: 'Ледяные оковы', nameEn: 'Frost Chains', detailRu: 'Мороз замедляет движения противника.', detailEn: 'Frost slows the enemy’s movement.', icon: Snowflake, tone: 'blue', cooldown: 11, compatibleRunes: ['glacial_edge', 'storm_core', 'seers_mark'] },
      { id: 'ancestor_shield', nameRu: 'Щит предков', nameEn: 'Ancestor Shield', detailRu: 'Защитная стойка с ответным ударом.', detailEn: 'A guarded stance followed by a counterstrike.', icon: Shield, tone: 'violet', cooldown: 11, compatibleRunes: ['oak_bark', 'glacial_edge', 'wolf_fang'] },
      { id: 'wolf_pounce', nameRu: 'Волчий наскок', nameEn: 'Wolf Pounce', detailRu: 'Резкий наскок сбивает темп врага.', detailEn: 'A sudden pounce disrupts the enemy’s rhythm.', icon: PawPrint, tone: 'gold', cooldown: 10, compatibleRunes: ['wolf_fang', 'seers_mark', 'fire_ember'] },
    ],
  },
  {
    titleRu: 'Пробуждение', titleEn: 'Awakening', mark: 'ᛟ', skills: [
      { id: 'berserker_rage', nameRu: 'Ярость берсерка', nameEn: 'Berserker Fury', detailRu: 'Краткий всплеск силы и скорости.', detailEn: 'A brief surge of power and speed.', icon: Skull, tone: 'ember', cooldown: 18, compatibleRunes: ['wolf_fang', 'fire_ember', 'storm_core'] },
      { id: 'jarl_power', nameRu: 'Сила ярла', nameEn: 'Jarl’s Might', detailRu: 'Стойкость северного предводителя.', detailEn: 'The resilience of a northern leader.', icon: ShieldPlus, tone: 'gold', cooldown: 18, compatibleRunes: ['oak_bark', 'glacial_edge', 'seers_mark'] },
      { id: 'valkyrie_song', nameRu: 'Песнь валькирии', nameEn: 'Valkyrie Song', detailRu: 'Воодушевляющая песнь поддерживает героя.', detailEn: 'An inspiring song supports the hero.', icon: HeartHandshake, tone: 'blue', cooldown: 20, compatibleRunes: ['oak_bark', 'storm_core', 'seers_mark'] },
    ],
  },
  {
    titleRu: 'Финал', titleEn: 'Final', mark: 'ᛉ', skills: [
      { id: 'thunder_wrath', nameRu: 'Гнев грома', nameEn: 'Thunder’s Wrath', detailRu: 'Мощный удар грозовой энергией.', detailEn: 'A powerful blow of storm energy.', icon: CloudLightning, tone: 'lime', cooldown: 28, compatibleRunes: ['storm_core', 'seers_mark', 'wolf_fang'] },
      { id: 'northern_blizzard', nameRu: 'Метель севера', nameEn: 'Northern Blizzard', detailRu: 'Череда ледяных ударов.', detailEn: 'A flurry of icy strikes.', icon: Wind, tone: 'violet', cooldown: 28, compatibleRunes: ['glacial_edge', 'storm_core', 'oak_bark'] },
      { id: 'flaming_axe', nameRu: 'Пылающая секира', nameEn: 'Flaming Axe', detailRu: 'Тяжёлый завершающий удар пламенем.', detailEn: 'A heavy, fiery finishing strike.', icon: Axe, tone: 'ember', cooldown: 30, compatibleRunes: ['fire_ember', 'wolf_fang', 'seers_mark'] },
    ],
  },
];

const PASSIVES = [
  { id: 'northern_blood', nameRu: 'Кровь Севера', nameEn: 'Northern Blood', icon: Heart, tone: 'ember' },
  { id: 'rune_guard', nameRu: 'Рунная защита', nameEn: 'Rune Guard', icon: ShieldPlus, tone: 'blue' },
  { id: 'keen_eye', nameRu: 'Зоркий глаз', nameEn: 'Keen Eye', icon: Target, tone: 'gold' },
] as const;

const DEFAULT_CHOICES = [2, 1, 0, 0, 2];

export function RuneSkillsMenu({ language, onClose, onOpenTraining }: {
  language: 'ru' | 'en';
  onClose: () => void;
  onOpenTraining: () => void;
}) {
  const en = language === 'en';
  const [equipped, setEquipped] = useState<number[]>(DEFAULT_CHOICES);
  const [focusedBranch, setFocusedBranch] = useState(0);
  const [runesBySkill, setRunesBySkill] = useState<Record<string, string[]>>({});
  const [passives, setPassives] = useState<string[]>(PASSIVES.map(passive => passive.id));
  const focused = BRANCHES[focusedBranch].skills[equipped[focusedBranch]];
  const equippedRunes = runesBySkill[focused.id] ?? [];

  const choose = (branch: number, index: number) => {
    setEquipped(previous => previous.map((value, position) => position === branch ? index : value));
    setFocusedBranch(branch);
  };

  const toggleRune = (runeId: string) => {
    setRunesBySkill(previous => {
      const selected = previous[focused.id] ?? [];
      const next = selected.includes(runeId)
        ? selected.filter(id => id !== runeId)
        : selected.length < 2 ? [...selected, runeId] : [...selected.slice(1), runeId];
      return { ...previous, [focused.id]: next };
    });
  };

  return <Modal title={en ? 'Runes & skills' : 'Руны и навыки'} icon={`${import.meta.env.BASE_URL}assets/territory/map/icons/rune-stones-v1.webp`} onClose={onClose}>
    <div className="territory-rune-menu" data-testid="territory-rune-skills-preview">
      <div className="territory-rune-menu__banner">
        <div className="territory-rune-menu__crest" aria-hidden="true"><Sparkles size={31}/><span>ᚱ</span></div>
        <div><strong>{en ? 'Path of northern magic' : 'Путь северной магии'}</strong>
          <small>{en ? 'Choose 1 of 3 skills in each branch' : 'Выбери 1 из 3 навыков в каждой ветви'}</small></div>
      </div>
      <p className="territory-rune-menu__preview-note">
        <CircleHelp size={14}/>
        {en ? 'Preview only. Your choices do not change live battles, stats or saved progress.'
          : 'Предпросмотр. Выбор пока не влияет на реальные бои, характеристики и сохранения.'}
      </p>

      <div className="territory-rune-menu__branches" aria-label={en ? 'Five skill branches' : 'Пять ветвей навыков'}>
        {BRANCHES.map((branch, branchIndex) => <div className="territory-rune-menu__branch" key={branch.titleEn}>
          <div className="territory-rune-menu__branch-label"><span aria-hidden="true">{branch.mark}</span><strong>{en ? branch.titleEn : branch.titleRu}</strong></div>
          {branch.skills.map((skill, index) => {
            const Icon = skill.icon;
            const active = equipped[branchIndex] === index;
            return <button key={skill.id} type="button" aria-pressed={active}
              aria-label={`${en ? skill.nameEn : skill.nameRu}${active ? en ? ', selected' : ', выбрано' : ''}`}
              className={`territory-rune-menu__skill territory-rune-menu__skill--${skill.tone} ${active ? 'territory-rune-menu__skill--equipped' : ''} ${focusedBranch === branchIndex && active ? 'territory-rune-menu__skill--focused' : ''}`}
              onClick={() => choose(branchIndex, index)}>
              <span className="territory-rune-menu__hex"><Icon aria-hidden="true" size={31} strokeWidth={2.3}/><small aria-hidden="true">{index + 1}</small></span>
              <span className="territory-rune-menu__skill-label">{active ? en ? 'Equipped' : 'Выбрано' : ' '}</span>
            </button>;
          })}
        </div>)}
      </div>

      <section className="territory-rune-menu__passives" aria-label={en ? 'Passive skills' : 'Пассивные навыки'}>
        <h3><span>{en ? 'Passive skills' : 'Пассивные навыки'}</span></h3>
        <div className="territory-rune-menu__passive-row">{PASSIVES.map(passive => {
          const Icon = passive.icon;
          const selected = passives.includes(passive.id);
          return <button key={passive.id} type="button" aria-pressed={selected} onClick={() => setPassives(previous => selected ? previous.filter(id => id !== passive.id) : [...previous, passive.id])}
            className={`territory-rune-menu__passive territory-rune-menu__passive--${passive.tone} ${selected ? 'territory-rune-menu__passive--active' : ''}`}>
            <Icon size={27} aria-hidden="true" />
            <span>{en ? passive.nameEn : passive.nameRu}</span>
            {selected && <Check size={12} className="territory-rune-menu__passive-check" aria-hidden="true"/>}
          </button>;
        })}</div>
      </section>

      <div className="territory-rune-menu__bonus">
        <strong>{en ? 'Skill rune bonuses' : 'Бонусы рун навыков'} <span>ᛟ</span></strong>
        <div><span>{en ? 'Attack' : 'Атака'} <b>—</b></span><span>{en ? 'Health' : 'Жизнь'} <b>—</b></span><span>{en ? 'Defense' : 'Защита'} <b>—</b></span></div>
        <small>{en ? 'Values appear after battle-system integration.' : 'Значения появятся после подключения к боевой системе.'}</small>
      </div>

      <section className="territory-rune-menu__details" aria-live="polite">
        <div className="territory-rune-menu__details-heading">
          <div><span>{en ? 'Selected skill' : 'Выбранный навык'}</span><h3>{en ? focused.nameEn : focused.nameRu}</h3></div>
          <span className="territory-rune-menu__cooldown">{en ? 'Cooldown' : 'Откат'} · {focused.cooldown} {en ? 'sec' : 'с'}</span>
        </div>
        <p>{en ? focused.detailEn : focused.detailRu}</p>
        <div className="territory-rune-menu__sockets"><strong>{en ? 'Skill runes · 2 slots' : 'Руны навыка · 2 ячейки'}</strong>
          <div>{[0, 1].map(slot => {
            const rune = TRAINING_RUNES.find(item => item.id === equippedRunes[slot]);
            return <span key={slot} className={rune ? 'territory-rune-menu__socket territory-rune-menu__socket--filled' : 'territory-rune-menu__socket'}>
              <span aria-hidden="true">ᚱ</span>{rune ? en ? rune.nameEn : rune.nameRu : en ? 'Empty' : 'Пусто'}
            </span>;
          })}</div>
        </div>
        <div className="territory-rune-menu__compatible" aria-label={en ? 'Compatible skill runes' : 'Совместимые руны'}>
          {TRAINING_RUNES.filter(rune => focused.compatibleRunes.includes(rune.id)).map(rune => {
            const active = equippedRunes.includes(rune.id);
            return <button type="button" key={rune.id} aria-pressed={active} onClick={() => toggleRune(rune.id)} className={active ? 'territory-rune-menu__rune territory-rune-menu__rune--active' : 'territory-rune-menu__rune'}>
              <span aria-hidden="true">ᚱ</span> {en ? rune.nameEn : rune.nameRu} {active && <Check size={12} aria-hidden="true"/>}
            </button>;
          })}
        </div>
        <p className="territory-rune-menu__disclaimer">{en ? 'These two rune slots are a visual loadout preview, not a purchase or a live upgrade.'
          : 'Две рунические ячейки — просмотр сборки, без покупки и реального улучшения.'}</p>
      </section>

      <button type="button" className="territory-rune-menu__training" onClick={onOpenTraining}>
        <Swords size={17} />{en ? 'Open existing combat training' : 'Открыть тренировку героя'}<ChevronRight size={18}/>
      </button>
    </div>
  </Modal>;
}
