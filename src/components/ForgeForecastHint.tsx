import { useState } from 'react';
import { ChevronDown, ChevronUp, Coins, Info, Wrench } from 'lucide-react';
import { forecastForgeUpgrade } from '@/game/forgeForecast';
import './forgeForecastHint.css';

/** Exact current forge costs/rates; statistical cost preview only. */
export function ForgeForecastHint({ itemLevel, heroLevel, language }: {
  itemLevel: number;
  heroLevel: number;
  language: 'ru' | 'en';
}) {
  const [expanded, setExpanded] = useState(false);
  const en = language === 'en';
  const next = forecastForgeUpgrade(itemLevel, heroLevel);
  if (!next) return null;
  const three = forecastForgeUpgrade(itemLevel, heroLevel, 3);
  const value = (n: number) => n.toLocaleString(en ? 'en-US' : 'ru-RU', { maximumFractionDigits: 0 });
  const attempts = (n: number) => n.toLocaleString(en ? 'en-US' : 'ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return <section className="forge-forecast-hint" data-testid="forge-budget-forecast">
    <button type="button" aria-expanded={expanded} className="forge-forecast-hint__toggle"
      onClick={() => setExpanded(open => !open)}>
      <Info size={14} aria-hidden="true"/>
      <span>{en ? 'How much might the upgrade cost?' : 'Сколько примерно уйдёт на улучшение?'}</span>
      {expanded ? <ChevronUp size={15} aria-hidden="true"/> : <ChevronDown size={15} aria-hidden="true"/>}
    </button>
    {expanded && <>
      <div className="forge-forecast-hint__rows">
        {[next, ...(three && three.levels > 1 ? [three] : [])].map(forecast =>
          <div key={forecast.levels} className="forge-forecast-hint__row">
            <strong>{en ? 'Up to level' : 'До уровня'} {forecast.toLevel}</strong>
            <span>{en ? 'Average attempts' : 'В среднем попыток'}: {attempts(forecast.expectedAttempts)}</span>
            <div><span><Coins size={13} aria-hidden="true"/>≈{value(forecast.expectedGold)}</span>
              <span><Wrench size={13} aria-hidden="true"/>≈{value(forecast.expectedMaterials)}</span></div>
          </div>)}
      </div>
      <p>{en
        ? 'Statistical average, not a guarantee. Every failed attempt still uses the listed gold and materials. Prices and success rates are unchanged.'
        : 'Это средний статистический расход, не гарантия. При неудаче монеты и материалы всё равно списываются. Шанс и цены не изменены.'}</p>
    </>}
  </section>;
}
