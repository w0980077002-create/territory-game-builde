import { useMemo, useState } from 'react';
import { Check, Crown, Flame, Shield, Sparkles, Sword, Swords } from 'lucide-react';
import type { PlayerStats } from '@/game/types';
import {
  TRAINING_BUILDS, TRAINING_ENEMIES, TRAINING_ROLES, TRAINING_RUNES, TRAINING_SETS, TRAINING_SKILLS,
  defaultTrainingLoadout, simulateTrainingBattle, trainingBuildPreview,
  type BuildTrainingLoadout, type TrainingResult,
} from '@/game/builds/buildTraining';
import './buildTraining.css';

function enemyForHero(stats: PlayerStats, id: string) {
  const base = TRAINING_ENEMIES.find(e => e.id === id) ?? TRAINING_ENEMIES[0];
  const difficulty = TRAINING_ENEMIES.findIndex(e => e.id === base.id);
  // Exhibition opponents are scaled for visibility, not for real game rewards.
  const hp = Math.max(85, Math.round(stats.attack * (5 + difficulty * 4)));
  const attack = Math.max(5, Math.round(stats.maxHp * (0.055 + difficulty * 0.025) + stats.defense * 0.2));
  const defense = Math.max(2, Math.round(stats.attack * (0.10 + difficulty * 0.07)));
  return { ...base, maxHp: hp, attack, defense };
}

const format = (n: number) => n.toLocaleString('ru-RU');

export function BuildTrainingPanel({ baseStats, language }: { baseStats: PlayerStats; language: 'ru' | 'en' }) {
  const en = language === 'en';
  const [loadout, setLoadout] = useState<BuildTrainingLoadout>(() => defaultTrainingLoadout());
  const [enemyId, setEnemyId] = useState(TRAINING_ENEMIES[0].id);
  const [seed, setSeed] = useState(17);
  const [result, setResult] = useState<TrainingResult | null>(null);
  const preview = useMemo(() => trainingBuildPreview(baseStats, loadout), [baseStats, loadout]);
  const build = TRAINING_BUILDS.find(entry => entry.id === loadout.buildId)!;
  const selectedSkills = build.skillIds.map(id => TRAINING_SKILLS.find(skill => skill.id === id)!);

  const change = (next: BuildTrainingLoadout) => { setLoadout(next); setResult(null); };
  const toggleRune = (runeId: string) => {
    const has = loadout.runeIds.includes(runeId);
    const next = has ? loadout.runeIds.filter(id => id !== runeId) : [...loadout.runeIds.slice(-1), runeId];
    change({ ...loadout, runeIds: next });
  };
  const toggleSupport = (id: string) => {
    const has = loadout.supportRoles.includes(id);
    const next = has ? loadout.supportRoles.filter(role => role !== id) : [...loadout.supportRoles.slice(-1), id];
    change({ ...loadout, supportRoles: next });
  };
  const train = () => {
    const nextSeed = seed + 1;
    setSeed(nextSeed);
    // Keep the opponent fixed while experimenting, so stronger builds really
    // improve the result instead of secretly scaling the opponent too.
    const enemy = enemyForHero(baseStats, enemyId);
    setResult(simulateTrainingBattle(baseStats, loadout, enemy, nextSeed));
  };

  return <div className="territory-build" data-testid="territory-build-training">
    <div className="territory-build__intro">
      <Swords size={20} />
      <p>{en ? 'Practice four combat styles, runes, gear synergies and companions. No gold, energy, gems or rewards are used.'
        : 'Пробуй четыре стиля боя, руны, наборы и спутников. Золото, энергия и алмазы не тратятся, награды не выдаются.'}</p>
    </div>

    <h4>{en ? 'Choose a combat style' : 'Выбери боевой стиль'}</h4>
    <div className="territory-build__classes">
      {TRAINING_BUILDS.map((candidate, index) => {
        const active = candidate.id === loadout.buildId;
        const icons = [<Shield size={19}/>, <Sword size={19}/>, <Sparkles size={19}/>, <Flame size={19}/>];
        return <button type="button" key={candidate.id} aria-pressed={active}
          onClick={() => change({ ...loadout, buildId: candidate.id })}
          className={active ? 'territory-build__choice territory-build__choice--active' : 'territory-build__choice'}>
          {icons[index]}<span>{en ? candidate.nameEn : candidate.nameRu}</span>{active && <Check size={11}/>}
        </button>;
      })}
    </div>

    <div className="territory-build__skills">
      {selectedSkills.map(skill => <div key={skill.id}><span>{skill.slot === 'active' ? en ? 'Active' : 'Умение'
        : skill.slot === 'ultimate' ? en ? 'Ultimate' : 'Мощный приём' : en ? 'Passive' : 'Пассивное'}</span>
        <b>{en ? skill.nameEn : skill.nameRu}</b></div>)}
    </div>

    <h4>{en ? 'Runes (up to two)' : 'Руны (до двух)'}</h4>
    <div className="territory-build__runes">
      {TRAINING_RUNES.map(rune => {
        const selected = loadout.runeIds.includes(rune.id);
        const synergy = selectedSkills.some(skill => skill.tags.some(tag => rune.tags.includes(tag)));
        return <button type="button" key={rune.id} aria-pressed={selected} onClick={() => toggleRune(rune.id)}
          className={selected ? 'territory-build__rune territory-build__rune--selected' : 'territory-build__rune'}>
          <span>ᚱ</span><b>{en ? rune.nameEn : rune.nameRu}</b>{synergy && <small>{en ? 'Synergy' : 'Сочетание'}</small>}
        </button>;
      })}
    </div>

    <h4>{en ? 'Equipment set bonus' : 'Усиление комплекта'}</h4>
    <div className="territory-build__sets">
      <button type="button" aria-pressed={!loadout.setId} onClick={() => change({ ...loadout, setId: null })}>{en ? 'Without set' : 'Без набора'}</button>
      {TRAINING_SETS.map(set => <button type="button" key={set.id} aria-pressed={loadout.setId === set.id}
        onClick={() => change({ ...loadout, setId: set.id })}>{en ? set.nameEn : set.nameRu}</button>)}
    </div>

    <h4>{en ? 'Companions' : 'Спутники'}</h4>
    <div className="territory-build__companions">
      <label>{en ? 'Main' : 'Основной'}
        <select value={loadout.mainRole ?? ''} onChange={event => {
          const nextMain = event.target.value || null;
          change({ ...loadout, mainRole: nextMain, supportRoles: loadout.supportRoles.filter(id => id !== nextMain) });
        }}>
          <option value="">{en ? 'None' : 'Без спутника'}</option>
          {TRAINING_ROLES.map(role => <option key={role.id} value={role.id}>{en ? role.nameEn : role.nameRu}</option>)}
        </select>
      </label>
      <div><span>{en ? 'Support (up to two)' : 'Поддержка (до двух)'}</span>
        <div className="territory-build__supports">{TRAINING_ROLES.map(role => <button key={role.id} type="button"
          disabled={loadout.mainRole === role.id} aria-pressed={loadout.supportRoles.includes(role.id)}
          onClick={() => toggleSupport(role.id)}>{en ? role.nameEn : role.nameRu}</button>)}</div>
      </div>
    </div>

    {preview && <div className="territory-build__stats">
      <span>❤️ {format(preview.maxHp)} HP</span><span>⚔️ {format(preview.attack)}</span>
      <span>🛡️ {format(preview.defense)}</span><span>✦ {format(preview.critChance)}%</span>
    </div>}

    <h4>{en ? 'Training opponent' : 'Тренировочный противник'}</h4>
    <div className="territory-build__enemies">
      {TRAINING_ENEMIES.map(enemy => <button key={enemy.id} type="button" aria-pressed={enemy.id === enemyId}
        onClick={() => { setEnemyId(enemy.id); setResult(null); }}>
        {enemy.isBoss ? <Crown size={14}/> : <Swords size={14}/>}{en ? enemy.nameEn : enemy.nameRu}
      </button>)}
    </div>
    <button type="button" className="territory-build__fight" onClick={train}><Swords size={19}/>
      {en ? 'Start practice battle' : 'Начать тренировочный бой'}</button>

    {result && <section className="territory-build__result" aria-live="polite">
      <div className="territory-build__result-title"><span>{result.victor === 'hero' ? en ? 'VICTORY' : 'ПОБЕДА'
        : result.victor === 'enemy' ? en ? 'DEFEAT' : 'ПОРАЖЕНИЕ' : en ? 'TIME LIMIT' : 'КОНЕЦ РАУНДОВ'}</span>
        <b>{en ? `Phase ${result.reachedPhase}` : `Фаза босса: ${result.reachedPhase}`}</b></div>
      <div className="territory-build__stats"><span>{en ? 'Damage' : 'Урон'}: {format(result.damageDealt)}</span>
        <span>{en ? 'Taken' : 'Получено'}: {format(result.damageTaken)}</span>
        <span>{en ? 'Rounds' : 'Раундов'}: {result.rounds.length}</span></div>
      <ol>{result.rounds.map(round => <li key={round.round}>
        <strong>#{round.round}</strong>
        <span>{round.critical ? '💥' : '⚔️'} −{round.damage} {round.evaded ? '🌀' : round.incoming ? `🩸 −${round.incoming}` : '🛡️'}
          {round.healed ? ` 💚 +${round.healed}` : ''}</span>
        {round.phase > 1 && <em>{en ? 'Boss phase' : 'Фаза'} {round.phase}</em>}
      </li>)}</ol>
      <p>{en ? 'Practice only: no experience, currency, purchases or live battles were changed.'
        : 'Это только тренировка: опыт, валюта, покупки и настоящие бои не изменились.'}</p>
    </section>}
  </div>;
}
