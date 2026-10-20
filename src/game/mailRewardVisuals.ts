/** Visual-only mapping of all rewards that the owner can attach to in-game mail.
 * Amounts mirror applyGrantPayload in live.ts; nothing here changes payout logic.
 */
export interface MailRewardPayload {
  gold?: number;
  gems?: number;
  redGems?: number;
  stones?: number;
  forgeMaterials?: number;
  items?: Record<string, number>;
}

export interface MailRewardVisual {
  key: string;
  name: string;
  nameEn: string;
  amount: number;
  image: string;
}

export const MAIL_ITEM_VISUALS: Record<string, { name: string; nameEn: string; image: string }> = {
  shop_potion_hp: { name: 'Зелье здоровья', nameEn: 'Health potion', image: 'potion-hp.webp' },
  shop_potion_hp_large: { name: 'Большое зелье здоровья', nameEn: 'Large health potion', image: 'potion-hp-large.webp' },
  shop_elixir_atk: { name: 'Эликсир силы', nameEn: 'Attack elixir', image: 'elixir-attack.webp' },
  shop_elixir_def: { name: 'Эликсир защиты', nameEn: 'Defense elixir', image: 'elixir-defense.webp' },
  shop_elixir_crit: { name: 'Эликсир крита', nameEn: 'Critical hit elixir', image: 'elixir-crit.webp' },
  shop_arena_time: { name: 'Зелье времени', nameEn: 'Time potion', image: 'potion-time.webp' },
  shop_arena_adrenaline: { name: 'Адреналин', nameEn: 'Adrenaline', image: 'potion-adrenaline.webp' },
};

/** Positive whole numbers only. Server-generated grants use integer quantities. */
const positive = (n: number | undefined): number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 0;

export function mailRewardVisuals(p: MailRewardPayload): MailRewardVisual[] {
  const items = p.items ?? {};
  const stones = positive(p.stones) + positive(items.shop_stone_5) * 5;
  const currencies: MailRewardVisual[] = [
    { key: 'gold', name: 'Монеты', nameEn: 'Coins', amount: positive(p.gold), image: 'gold-coin.webp' },
    { key: 'gems', name: 'Синие алмазы', nameEn: 'Blue gems', amount: positive(p.gems), image: 'blue-gem.webp' },
    { key: 'redGems', name: 'Красные алмазы', nameEn: 'Red gems', amount: positive(p.redGems), image: 'red-gem.webp' },
    { key: 'stones', name: 'Боевые камни', nameEn: 'Battle stones', amount: stones, image: 'battle-stone.webp' },
    { key: 'forgeMaterials', name: 'Материалы кузницы', nameEn: 'Forge materials', amount: positive(p.forgeMaterials), image: 'forge-material.webp' },
  ];

  const itemRewards = Object.entries(MAIL_ITEM_VISUALS).map(([key, art]) => ({
    key, name: art.name, nameEn: art.nameEn, image: art.image, amount: positive(items[key]),
  }));

  // If a future mail contains a new item key, preserve its visible quantity
  // instead of silently hiding it. The server still controls allowed item IDs.
  const unknown = Object.entries(items)
    .filter(([key, qty]) => key !== 'shop_stone_5' && !(key in MAIL_ITEM_VISUALS) && positive(qty) > 0)
    .map(([key, qty]) => ({ key, name: key, nameEn: key, image: 'ic-mail.webp', amount: positive(qty) }));

  return [...currencies, ...itemRewards, ...unknown].filter((reward) => reward.amount > 0);
}
