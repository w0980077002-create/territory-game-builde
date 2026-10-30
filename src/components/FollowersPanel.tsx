import { useState } from 'react';
import { Check, Coins, Crown, LockKeyhole, Shield, Sparkles, Swords, Wrench } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { useLanguage } from '@/game/i18n';
import { getFollowerArt } from '@/game/combatArt';
import { WoodenPlaque } from '@/components/ui/WoodenPlaque';
import {
  FOLLOWER_TEMPLATES, followerTrainingCost, MAX_FOLLOWER_LEVEL, MAX_BATTLE_COW_LEVEL,
  cowStonesOwned, cowAwakeningCost, selectedFollower, selectFollower, trainFollower,
} from '@/game/followers';
import './followersCamp.css';

/** Real PvE companions, displayed as a compact selectable roster.
 * No fictitious stars, calls, awakenings or invented companion abilities.
 */
export function FollowersPanel() {
  const { language } = useLanguage();
  const en = language === 'en';
  const state = useStore(useGame);
  const active = selectedFollower(state);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const choose = (id: string) => {
    const result = selectFollower(useGame.get(), id);
    if (result) { useGame.set(result); setNote(en ? 'Companion selected' : 'Спутник выбран'); }
  };

  const train = (id: string) => {
    let succeeded = false;
    useGame.set((current) => {
      const next = trainFollower(current, id);
      succeeded = next !== null;
      return next ?? current;
    });
    const cow = id === 'follower_6';
    setNote(succeeded ? (cow ? (en ? 'Battle Cow level raised with an awakening stone' : 'Уровень Боевой коровы повышен за камень пробуждения') : (en ? 'Training completed' : 'Тренировка завершена'))
      : cow ? (en ? 'Awakening stone required. Defeat milestone bosses to earn one.' : 'Нужен камень пробуждения. Побеждай особых боссов, чтобы получить его.')
        : (en ? 'Not enough materials, gold or hero level' : 'Не хватает золота, материалов или уровня героя'));
  };

  const unlockedCount = FOLLOWER_TEMPLATES.filter(template =>
    state.followers.find(f => f.id === template.id)?.unlocked).length;
  const currentId = selectedId ?? active?.id ?? FOLLOWER_TEMPLATES[0].id;
  const template = FOLLOWER_TEMPLATES.find(f => f.id === currentId) ?? FOLLOWER_TEMPLATES[0];
  const follower = state.followers.find(f => f.id === template.id);
  const unlocked = follower?.unlocked === true;
  const selected = active?.id === follower?.id && unlocked;
  const isCow = template.id === 'follower_6';
  const stoneCount = cowStonesOwned(state);
  const stonePrice = follower ? cowAwakeningCost(follower.level) : 1;
  const maxed = !!follower && (isCow ? follower.level >= MAX_BATTLE_COW_LEVEL : (follower.level >= state.player.level || follower.level >= MAX_FOLLOWER_LEVEL));
  const price = follower ? followerTrainingCost(follower.level) : { gold: 0, materials: 0 };
  const canTrain = unlocked && !maxed && (isCow ? stoneCount >= stonePrice : state.player.gold >= price.gold && state.forgeMaterials >= price.materials);
  const cap = isCow ? MAX_BATTLE_COW_LEVEL : Math.max(1, Math.min(state.player.level, MAX_FOLLOWER_LEVEL));
  const progress = follower ? Math.min(100, Math.round(follower.level / cap * 100)) : 0;
  const nextUnlock = FOLLOWER_TEMPLATES.find(f => !state.followers.find(x => x.id === f.id)?.unlocked);

  return <section className="followers-camp" data-testid="followers-panel" aria-label={en ? 'Companion camp' : 'Лагерь спутников'}>
    <header className="followers-camp__header">
      <div className="followers-camp__crest"><img src={import.meta.env.BASE_URL + 'assets/territory/map/icons/companions-v1.webp'} loading="lazy" alt=""/></div>
      <div className="followers-camp__heading">
        <WoodenPlaque>{en ? 'COMPANIONS' : 'СПУТНИКИ'}</WoodenPlaque>
        <p>{en ? 'Companion camp' : 'Лагерь последователей'}</p>
      </div>
      <div className="followers-camp__count">{unlockedCount}/{FOLLOWER_TEMPLATES.length}</div>
    </header>

    <div className="followers-camp__active">
      {active ? <>
        <div className="followers-camp__active-art">
          <img src={getFollowerArt(active.id)} loading="lazy" alt="" draggable={false}/>
        </div>
        <div className="followers-camp__active-info">
          <span className="followers-camp__eyebrow"><Check size={13}/>{en ? 'ACTIVE IN PvE' : 'АКТИВЕН В PvE'}</span>
          <h3>{en ? (FOLLOWER_TEMPLATES.find(f => f.id === active.id)?.nameEn ?? active.name) : active.name}</h3>
          <p>{en ? 'Level' : 'Уровень'} {active.level} <span>·</span> <Swords size={12}/> {active.attack} <span>·</span> <Shield size={12}/> {active.defense}</p>
          <small>{en ? 'Helps in Campaign and Trials, not in Arena' : 'Помогает в Походе и Испытаниях, не на Арене'}</small>
        </div>
      </> : <div className="followers-camp__locked-start">
        <LockKeyhole size={19}/><span>{en ? 'Your first companion unlocks at hero level 3.' : 'Первый последователь откроется на 3 уровне героя.'}</span>
      </div>}
    </div>

    <div className="followers-camp__roster-title">
      <h4>{en ? 'Your companions' : 'Все последователи'}</h4>
      {nextUnlock && <span>{en ? 'Next unlock' : 'Следующий'}: {en ? 'Lv.' : 'Ур.'} {nextUnlock.unlockLevel}</span>}
    </div>
    <div className="followers-camp__roster" role="group" aria-label={en ? 'Choose companion to inspect' : 'Выбор последователя'}>
      {FOLLOWER_TEMPLATES.map(candidate => {
        const unit = state.followers.find(f => f.id === candidate.id);
        const isActive = active?.id === candidate.id;
        const focus = candidate.id === template.id;
        return <button key={candidate.id} type="button" onClick={() => { setSelectedId(candidate.id); setNote(''); }}
          className={`followers-camp__portrait ${focus ? 'followers-camp__portrait--focus' : ''} ${isActive ? 'followers-camp__portrait--active' : ''}`}
          aria-pressed={focus} aria-label={`${en ? candidate.nameEn : candidate.name} — ${unit?.unlocked ? (en ? 'Level' : 'Уровень') + ' ' + unit.level : (en ? 'Unlocks at level' : 'Откроется на уровне') + ' ' + candidate.unlockLevel}`}>
          <img src={getFollowerArt(candidate.id)} loading="lazy" draggable={false} alt=""
            className={unit?.unlocked ? '' : 'followers-camp__portrait-img--locked'}/>
          {isActive && <span className="followers-camp__portrait-status"><Check size={11}/></span>}
          {!unit?.unlocked && <span className="followers-camp__portrait-status followers-camp__portrait-status--locked"><LockKeyhole size={11}/></span>}
          <b>{en ? candidate.nameEn : candidate.name}</b>
        </button>;
      })}
    </div>

    {follower && <section className="followers-camp__detail" aria-live="polite">
      <div className="followers-camp__detail-top">
        <img src={getFollowerArt(follower.id)} alt="" loading="lazy" draggable={false}/>
        <div>
          <span className="followers-camp__eyebrow"><Sparkles size={12}/>{en ? 'COMPANION DETAILS' : 'ХАРАКТЕРИСТИКИ'}</span>
          <h3>{en ? template.nameEn : template.name}</h3>
          {template.id === 'follower_6' && <span className="followers-camp__legendary"><Sparkles size={12}/>{en ? 'LEGENDARY LOOK' : 'ЛЕГЕНДАРНЫЙ ОБРАЗ'}</span>}
          <p>{en ? template.descriptionEn : template.description}</p>
          <span className={unlocked ? 'followers-camp__availability' : 'followers-camp__availability followers-camp__availability--locked'}>
            {unlocked ? en ? 'Unlocked' : 'Открыт' : `${en ? 'Unlocks at hero level' : 'Откроется на уровне героя'} ${template.unlockLevel}`}
          </span>
        </div>
      </div>

      {unlocked && <>
        {template.role === 'crystal' && <div className="followers-camp__special"><Sparkles size={15}/>{en ? 'Crystal Frenzy: extra strike, light healing each round, slight armor piercing.' : 'Кристальное безумие: дополнительный удар, небольшое лечение каждый раунд и пробивание брони.'}</div>}
        <div className="followers-camp__stats">
          <div><Swords size={16}/><span>{en ? 'Attack' : 'Атака'}</span><b>{follower.attack}</b></div>
          <div><Shield size={16}/><span>{en ? 'Defense' : 'Защита'}</span><b>{follower.defense}</b></div>
          <div><Crown size={16}/><span>{en ? 'Level' : 'Уровень'}</span><b>{follower.level}/{cap}</b></div>
        </div>
        <div className="followers-camp__progress" role="progressbar" aria-label={en ? 'Training level' : 'Уровень развития'} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(follower.level, cap)}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="followers-camp__actions">
          <button type="button" onClick={() => choose(follower.id)} disabled={selected}
            className="followers-camp__choose">
            <Check size={16}/>{selected ? en ? 'Selected' : 'Выбран' : en ? 'Choose' : 'Выбрать'}
          </button>
          <button type="button" onClick={() => train(follower.id)} disabled={!canTrain}
            className="followers-camp__train">
            {isCow ? <Sparkles size={16}/> : <Wrench size={16}/>}{maxed ? en ? 'Level cap' : 'Лимит уровня' : isCow ? (en ? 'Raise level' : 'Повысить уровень') : en ? 'Train' : 'Обучить'}
          </button>
        </div>
        {isCow && <div className="followers-camp__awakening" aria-label={en ? 'Awakening stone' : 'Камень пробуждения'}>
          <img src={import.meta.env.BASE_URL + 'assets/territory/ui/items/awakening-stone.svg'} alt="" loading="lazy" draggable={false}/>
          <div>
            <strong>{en ? 'AWAKENING STONE' : 'КАМЕНЬ ПРОБУЖДЕНИЯ'}</strong>
            <span>{en ? 'Owned' : 'В наличии'}: <b>{stoneCount}</b>{!maxed && <>{' · '}{en ? 'Needed' : 'Нужно'}: {stonePrice}</>}</span>
            <small>{en ? 'The source is not yet confirmed. No gold or gems are needed.' : 'Источник пока не подтверждён. Монеты и алмазы не нужны.'}</small>
          </div>
        </div>}
        {!isCow && !maxed && <div className="followers-camp__cost">
          <span><Coins size={14}/>{price.gold.toLocaleString(en ? 'en-US' : 'ru-RU')}</span>
          <span><img src={import.meta.env.BASE_URL + 'forge-material.webp'} alt="" loading="lazy"/>{price.materials}</span>
          {!canTrain && <small>{en ? 'Not enough materials, gold or hero level' : 'Недостаточно ресурсов или уровня героя'}</small>}
        </div>}
      </>}
    </section>}
    {note && <p role="status" className="followers-camp__note">{note}</p>}
    <p className="followers-camp__footnote">{en
      ? 'Follower bonuses work in PvE only. Arena remains balanced separately.'
      : 'Бонусы спутников действуют только в Походе и Испытаниях, не на Арене.'}</p>
  </section>;
}
