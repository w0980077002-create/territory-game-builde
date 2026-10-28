import { useEffect, useMemo, useState } from 'react';
import { Check, Crown, Flame, Info, Shield, Snowflake, Sparkles, Swords, Target, Wind, X, Zap } from 'lucide-react';
import catalog from '@/game/config/territory-rune-skill-book-v1.json';
import './runeSkillBook.css';

const ICONS = { crown: Crown, flame: Flame, shield: Shield, snowflake: Snowflake, swords: Swords, target: Target, wind: Wind, zap: Zap };
type GroupId = (typeof catalog.groups)[number]['id'];
type Skill = (typeof catalog.groups)[number]['skills'][number];
export type RuneSkillBookSelection = {
  skillIds: Record<GroupId, string>;
  runeIds: Record<string, string>;
  passiveIds: string[];
};
export const INITIAL_RUNE_BOOK_SELECTION: RuneSkillBookSelection = {
  skillIds: Object.fromEntries(catalog.groups.map(group => [group.id, group.skills[0].id])),
  runeIds: {},
  passiveIds: catalog.passives.slice(0, 3).map(passive => passive.id),
};
function SkillIcon({ icon, tone, small = false }: { icon: string; tone: string; small?: boolean }) {
  const Icon = ICONS[icon as keyof typeof ICONS] ?? Sparkles;
  return <span className={`rune-book__hex rune-book__hex--${tone} ${small ? 'rune-book__hex--small' : ''}`} aria-hidden="true">
    <Icon size={small ? 18 : 24} strokeWidth={2.8}/>
  </span>;
}
function name(item: { nameRu: string; nameEn: string }, en: boolean) { return en ? item.nameEn : item.nameRu; }

export function RuneSkillBook({
  language,
  initialSelection,
  onSelectionChange,
  serverConnected = false,
  available,
}: {
  language: 'ru' | 'en';
  initialSelection?: RuneSkillBookSelection;
  onSelectionChange?: (selection: RuneSkillBookSelection) => void;
  serverConnected?: boolean;
  available?: {skills:Record<string,number>;runes:Record<string,number>;passives:Record<string,number>};
}) {
  const en = language === 'en';
  const [selection, setSelection] = useState<RuneSkillBookSelection>(() => initialSelection ?? INITIAL_RUNE_BOOK_SELECTION);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [passiveExpanded, setPassiveExpanded] = useState(false);
  const activeSkill = useMemo(() => catalog.groups.flatMap(group => group.skills).find(skill => skill.id === activeSkillId), [activeSkillId]);
  const activeGroup = useMemo(() => catalog.groups.find(group => group.skills.some(skill => skill.id === activeSkillId)), [activeSkillId]);
  const setNext = (next: RuneSkillBookSelection) => { setSelection(next); onSelectionChange?.(next); };
  const equipSkill = (skill: Skill, groupId: GroupId) => setNext({ ...selection, skillIds: { ...selection.skillIds, [groupId]: skill.id } });
  const equipRune = (skillId: string, runeId: string) => setNext({ ...selection, runeIds: { ...selection.runeIds, [skillId]: runeId } });
  const togglePassive = (id: string) => {
    const found = selection.passiveIds.includes(id);
    if (!found && selection.passiveIds.length >= 3) return;
    setNext({ ...selection, passiveIds: found ? selection.passiveIds.filter(value => value !== id) : [...selection.passiveIds, id] });
  };
  useEffect(() => {
    if (!activeSkillId) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setActiveSkillId(null); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [activeSkillId]);
  const skillsEquipped = catalog.groups.filter(group => !!selection.skillIds[group.id]).length;
  const runesEquipped = Object.values(selection.runeIds).filter(Boolean).length;
  return <section className="rune-book" data-testid="territory-rune-skill-book">
    <div className="rune-book__heading" style={{ backgroundImage: `linear-gradient(100deg, rgba(54,29,11,.8),rgba(95,48,12,.55)), url("${import.meta.env.BASE_URL}assets/territory/ui/wooden-plaque.webp")` }}>
      <div className="rune-book__crest" aria-hidden="true"><span>ᛟ</span></div>
      <div><h3>{en ? 'RUNES & SKILLS' : 'РУНЫ И НАВЫКИ'}</h3>
        <p>{en ? 'Five stages of Viking power' : 'Пять ступеней силы викинга'}</p></div>
      <Sparkles size={23} aria-hidden="true"/>
    </div>
    <p className="rune-book__preview" role="status"><Info size={15} aria-hidden="true"/>
      {serverConnected ? (en ? 'Runes are verified by the server. Choose unlocked skills.' : 'Руны проверяет сервер. Выбирай открытые навыки.')
        : (en ? 'Visual preview · Choices do not save or affect live fights.' : 'Тестовый просмотр · Выбор не сохраняется и не влияет на бой.')}
    </p>
    <div className="rune-book__rows" aria-label={en ? 'Five skill groups' : 'Пять групп навыков'}>
      {catalog.groups.map(group => <div className="rune-book__row" key={group.id} data-testid={`rune-row-${group.id}`}>
        <div className="rune-book__group"><span className="rune-book__group-symbol" aria-hidden="true">{group.symbol}</span>
          <b>{name(group, en)}</b></div>
        <div className="rune-book__choices">
          {group.skills.map(skill => {
            const picked = selection.skillIds[group.id] === skill.id;
            return <button key={skill.id} type="button" className={`rune-book__skill ${picked ? 'rune-book__skill--equipped' : ''}`}
              aria-label={`${name(skill, en)}. ${picked ? en ? 'Equipped. ' : 'Экипировано. ' : ''}${en ? 'Details' : 'Подробнее'}`}
              aria-pressed={picked} disabled={serverConnected && !(available?.skills[skill.id]??0)} onClick={() => setActiveSkillId(skill.id)}>
              <SkillIcon icon={skill.icon} tone={skill.tone}/>
              {picked && <span className="rune-book__equipped"><Check size={11} strokeWidth={4}/></span>}
              <span className="rune-book__skill-name">{picked ? (en ? 'Equipped' : 'Экипировано') : name(skill, en)}</span>
            </button>;
          })}
        </div>
      </div>)}
    </div>
    <div className="rune-book__passives">
      <h4><span className="rune-book__subtitle-line"/>{en ? 'Passive skills' : 'Пассивные навыки'}<span className="rune-book__subtitle-line"/></h4>
      <div className="rune-book__passive-grid">
        {catalog.passives.filter(passive => passiveExpanded || selection.passiveIds.includes(passive.id)).map(passive => {
          const picked = selection.passiveIds.includes(passive.id);
          return <button type="button" key={passive.id} aria-pressed={picked}
            disabled={(!picked && selection.passiveIds.length >= 3) || (serverConnected && !(available?.passives[passive.id]??0))}
            onClick={() => togglePassive(passive.id)}
            className={`rune-book__passive ${picked ? 'rune-book__passive--equipped' : ''}`}
            title={en ? passive.descriptionEn : passive.descriptionRu}
            aria-label={`${name(passive,en)} · ${picked ? (en?'equipped':'экипировано') : (en?'choose':'выбрать')}`}>
            <SkillIcon icon={passive.icon} tone={passive.tone} small/>
            <span>{name(passive, en)}</span>
            {picked && <Check size={13} aria-hidden="true"/>}
          </button>;
        })}
      </div>
      <button className="rune-book__passive-toggle" type="button" aria-expanded={passiveExpanded} onClick={() => setPassiveExpanded(value => !value)}>{passiveExpanded ? (en ? 'Hide other passives' : 'Скрыть остальные') : (en ? 'Change passives' : 'Выбрать другие пассивные')}</button>
    </div>
    <div className="rune-book__bonuses" aria-label={en ? 'Current equipment summary' : 'Текущая сборка'}>
      <div className="rune-book__bonus-title"><Sparkles size={15}/>{en ? 'YOUR RUNE BUILD' : 'ТВОЯ СБОРКА РУН'}</div>
      <div className="rune-book__bonus-stats"><span>{en ? 'Skills' : 'Навыки'} <b>{skillsEquipped}/5</b></span><span>{en ? 'Runes' : 'Руны'} <b>{runesEquipped}</b></span><span>{en ? 'Passives' : 'Пассивные'} <b>{selection.passiveIds.length}/3</b></span></div>
    </div>
    <p className="rune-book__footer">{en ? 'Tap any skill to view its 3 rune choices and effects.'
      : 'Нажми на шестигранник: выбери навык и одну из трёх рун.'}</p>
    {activeSkill && activeGroup && <div className="rune-book__overlay" onMouseDown={event => {
      if (event.target === event.currentTarget) setActiveSkillId(null);
    }}>
      <section className="rune-book__dialog" role="dialog" aria-modal="true" aria-labelledby="rune-book-dialog-title">
        <div className="rune-book__dialog-top">
          <SkillIcon icon={activeSkill.icon} tone={activeSkill.tone}/>
          <div><span>{name(activeGroup, en)}</span><h4 id="rune-book-dialog-title">{name(activeSkill, en)}</h4></div>
          <button className="rune-book__close" type="button" aria-label={en ? 'Close' : 'Закрыть'}
            onClick={() => setActiveSkillId(null)}><X size={20}/></button>
        </div>
        <p className="rune-book__description">{en ? activeSkill.descriptionEn : activeSkill.descriptionRu}</p>
        <button className="rune-book__equip-btn" type="button"
          aria-pressed={selection.skillIds[activeGroup.id] === activeSkill.id}
          disabled={serverConnected && !(available?.skills[activeSkill.id]??0)} onClick={() => equipSkill(activeSkill, activeGroup.id)}>
          <Check size={16}/>{selection.skillIds[activeGroup.id] === activeSkill.id
            ? en ? 'Equipped' : 'Экипировано'
            : en ? 'Choose this skill' : 'Выбрать навык'}
        </button>
        <h5>{en ? 'Runes for this skill' : 'Руны этого навыка'}</h5>
        <p className="rune-book__rune-hint">{serverConnected ? (en ? 'Choose an unlocked rune. The server checks its true level and compatibility.' : 'Выбери открытую руну. Уровень и совместимость проверяет сервер.') : (en ? 'Choose one visual variant. Exact levels and chances await combat integration.' : 'Выбери одну руну. Реальные уровни и шансы появятся после подключения боевой системы.')}</p>
        <div className="rune-book__rune-list">
          {activeSkill.runes.map((rune, index) => {
            const picked = selection.runeIds[activeSkill.id] === rune.id;
            return <button type="button" key={rune.id}
              className={`rune-book__rune-option ${picked ? 'rune-book__rune-option--selected' : ''}`}
              aria-pressed={picked} disabled={serverConnected && !(available?.runes[rune.id]??0)} onClick={() => equipRune(activeSkill.id, rune.id)}>
              <span className="rune-book__rune-mark" aria-hidden="true">{['ᚠ','ᚱ','ᛃ'][index]}</span>
              <span><b>{name(rune, en)}</b><small>{en ? rune.effectEn : rune.effectRu}</small></span>
              <span className="rune-book__rune-check">{picked ? <Check size={17}/> : '○'}</span>
            </button>;
          })}
        </div>
        <div className="rune-book__dialog-actions">
          <button type="button" onClick={() => setActiveSkillId(null)}>{en ? 'Back to skill book' : 'Назад к навыкам'}</button>
        </div>
      </section>
    </div>}
  </section>;
}
