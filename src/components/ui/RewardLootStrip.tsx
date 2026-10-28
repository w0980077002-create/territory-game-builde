import { Gift } from 'lucide-react';
import type { Reward } from '@/game/progression';
import './rewardLootStrip.css';

type RewardKey = keyof Reward;
type AwardInfo = { key: RewardKey; value: number; image: string; ru: string; en: string };
const REWARD_TYPES: Omit<AwardInfo, 'value'>[] = [
  { key: 'gold', image: 'gold-coin.webp', ru: 'Монеты', en: 'Coins' },
  { key: 'gems', image: 'blue-gem.webp', ru: 'Синие алмазы', en: 'Blue gems' },
  { key: 'redGems', image: 'red-gem.webp', ru: 'Красные алмазы', en: 'Red gems' },
  { key: 'stones', image: 'battle-stone.webp', ru: 'Боевые камни', en: 'Battle stones' },
  { key: 'largeHealthPotions', image: 'potion-hp-large-viking.webp', ru: 'Большое зелье здоровья', en: 'Large health potion' },
];

/** Visual-only: reads existing prize amounts, never issues grants or creates new rewards. */
export function RewardLootStrip({ reward, language, mini = false }: {
  reward: Reward;
  language: 'ru' | 'en';
  mini?: boolean;
}) {
  const awards: AwardInfo[] = REWARD_TYPES.flatMap(type => {
    const value = reward[type.key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? [{ ...type, value }] : [];
  });
  const en = language === 'en';
  const formatter = new Intl.NumberFormat(en ? 'en-US' : 'ru-RU');
  const fullDescription = awards.map(award => `${en ? award.en : award.ru}: ${formatter.format(award.value)}`).join('; ');
  if (!awards.length) return <span className="reward-loot reward-loot--empty"><Gift size={17} aria-hidden="true"/></span>;

  // Mini calendar cells show the first two actual prize pictures, not invented emoji placeholders.
  // The full reward remains available in its day title and accessible name.
  const shown = mini ? awards.slice(0, 2) : awards;
  return <span className={mini ? 'reward-loot reward-loot--mini' : 'reward-loot'} role="img" aria-label={fullDescription}
    title={fullDescription}>
    {shown.map((award, index) => <span key={award.key} className="reward-loot__award"
      style={mini ? { zIndex: shown.length - index } : undefined}>
      <img src={import.meta.env.BASE_URL + award.image} alt="" draggable={false} loading="lazy" decoding="async" />
      <b>×{formatter.format(award.value)}</b>
    </span>)}
    {mini && awards.length > shown.length && <span className="reward-loot__more">+{awards.length - shown.length}</span>}
  </span>;
}
