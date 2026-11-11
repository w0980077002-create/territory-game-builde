import { useEffect, useState } from 'react';
import { GOOSE_APPROVED_PREVIEW_IMAGE } from './gooseApprovedPreviewImage';
import {
  createGooseDemo, GOOSE_DEMO_ROLE, GOOSE_DEMO_SKILLS,
  setGooseDemoAuto, stepGooseDemo, useGooseDemoSkill,
  type GooseDemoSkill,
} from '@/game/gooseCompanionDemo';
import './legendaryGooseDemo.css';

const SKILLS: readonly GooseDemoSkill[] = ['hug', 'commotion', 'honk'];

/** Read-only interactive preview. Does not read or write player or server state. */
export function LegendaryGooseDemo({ en }: { en: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [demo, setDemo] = useState(createGooseDemo);
  const [effect, setEffect] = useState<GooseDemoSkill | null>(null);

  useEffect(() => {
    if (!expanded || demo.heroHp === 0 || demo.enemyHp === 0) return;
    const interval = window.setInterval(() => setDemo(current => stepGooseDemo(current, .5)), 500);
    return () => window.clearInterval(interval);
  }, [expanded, demo.heroHp, demo.enemyHp]);

  const trigger = (skill: GooseDemoSkill) => {
    const next = useGooseDemoSkill(demo, skill);
    if (next === demo) return;
    setDemo(next);
    setEffect(skill);
  };

  const reset = () => { setDemo(createGooseDemo()); setEffect(null); };
  const canFight = demo.heroHp > 0 && demo.enemyHp > 0;

  return <section className="legendary-goose" aria-label={en ? 'Legendary Goose-Hugger demo' : 'Легендарный Гусь-Обнимусь: демо'} data-testid="goose-demo">
    <button className="legendary-goose__teaser" type="button" aria-expanded={expanded}
      onClick={() => { setExpanded(open => !open); }}>
      <img src={GOOSE_APPROVED_PREVIEW_IMAGE} alt={en ? 'Goose adventurer, approved artwork preview' : 'Гусь-авиатор, фрагмент утверждённого арта'} />
      <span className="legendary-goose__teaser-text">
        <strong>{en ? GOOSE_DEMO_ROLE.nameEn : GOOSE_DEMO_ROLE.nameRu}</strong>
        <small>{en ? 'LEGENDARY · playable ability preview' : 'ЛЕГЕНДАРНЫЙ · тест способностей'}</small>
      </span>
      <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
    </button>
    {expanded && <div className="legendary-goose__detail">
      <p className="legendary-goose__warning">{en
        ? 'DEMO ONLY: no unlock, no saved progression, no items or currency are used.'
        : 'ТОЛЬКО ДЕМО: спутник не выдаётся, прогресс, предметы и валюта не изменяются.'}</p>
      <div className="legendary-goose__battle" aria-label={en ? 'Demo battle' : 'Тестовый бой'}>
        <div className="legendary-goose__actor">
          <div className={effect ? 'legendary-goose__picture legendary-goose__picture--pulse' : 'legendary-goose__picture'}>
            <img src={GOOSE_APPROVED_PREVIEW_IMAGE} alt="" />
          </div>
          <strong>{en ? 'Goose-Hugger' : 'Гусь-Обнимусь'}</strong>
          <span>{en ? 'Legendary support' : 'Легендарная поддержка'}</span>
        </div>
        <div className="legendary-goose__meters">
          <label>{en ? 'Hero HP' : 'Здоровье героя'} <b>{demo.heroHp}/{demo.heroMaxHp}</b>
            <progress max={demo.heroMaxHp} value={demo.heroHp} /></label>
          <label>{en ? 'Training enemy HP' : 'Здоровье тренировочного врага'} <b>{demo.enemyHp}/{demo.enemyMaxHp}</b>
            <progress max={demo.enemyMaxHp} value={demo.enemyHp} /></label>
          <span className="legendary-goose__status" role="status" aria-live="polite">
            {demo.heroHp === 0 ? en ? 'Defeat: retry' : 'Поражение: повторить'
              : demo.enemyHp === 0 ? en ? 'Training victory!' : 'Учебная победа!'
                : demo.events[0] || (en ? 'Choose an ability' : 'Выбери способность')}
          </span>
        </div>
      </div>
      <div className="legendary-goose__skills">
        {SKILLS.map(key => {
          const remaining = Math.max(0, Math.ceil(demo.nextReady[key] - demo.time));
          return <button key={key} type="button"
            onClick={() => trigger(key)}
            disabled={!canFight || remaining > 0 || (key === 'hug' && demo.shield > 0) || (key === 'honk' && demo.honkUntil > demo.time)}>
            <span aria-hidden="true">{key === 'hug' ? '🪽' : key === 'commotion' ? '⚡' : '📣'}</span>
            <strong>{en ? GOOSE_DEMO_SKILLS[key].labelEn : GOOSE_DEMO_SKILLS[key].labelRu}</strong>
            <small>{remaining > 0 ? remaining + (en ? 's' : ' с') : (en ? 'Ready' : 'Готово')}</small>
          </button>;
        })}
      </div>
      <div className="legendary-goose__toolbar">
        <label><input type="checkbox" checked={demo.auto} onChange={e => setDemo(s => setGooseDemoAuto(s, e.target.checked))} />
          {en ? 'Auto goose abilities' : 'Авто умений гуся'}</label>
        <button type="button" onClick={reset}>{en ? 'Retry demo' : 'Повторить тест'}</button>
      </div>
      <small className="legendary-goose__disclaimer">{en
        ? 'Sample HP and cooldowns are for this isolated demonstration only. The final battle art, balancing and unlock source are not yet implemented.'
        : 'Здоровье и откаты условные — только для демо. Полные боевые анимации, баланс и источник получения пока не подключены.'}</small>
    </div>}
  </section>;
}
