/** TERRITORY founder-era VIP catalogue. USD amounts are target cumulative spend
 * bands, NOT a payment quote, purchase API or a means to mint entitlements.
 * Only server-confirmed purchases may count toward them.
 */
export const VIP_SPEND_THRESHOLDS_USD = [0, 1, 10, 100, 300, 500, 1000, 3000, 5000, 8000, 10000] as const;
export const VIP_MAX_LEVEL = 10;
export const VIP_AUTO_BELT_LEVEL = 3;
export const VIP_AURA_LEVEL = 5;

export interface VipTier {
  level: number;
  usd: number;
  goldXpBonusPercent: number;
  nameRu: string;
  nameEn: string;
  perkRu: string;
  perkEn: string;
}
export const VIP_TIERS: readonly VipTier[] = [
  { level:0, usd:0, goldXpBonusPercent:0, nameRu:'Герой', nameEn:'Hero',
    perkRu:'Все основные приключения доступны без VIP', perkEn:'Core adventures are free for everyone' },
  { level:1, usd:1, goldXpBonusPercent:2, nameRu:'Новичок', nameEn:'Initiate',
    perkRu:'Ежедневный VIP-сундук I, знак отличия и рамка', perkEn:'Daily VIP chest I, insignia and frame' },
  { level:2, usd:10, goldXpBonusPercent:4, nameRu:'Воин', nameEn:'Warrior',
    perkRu:'Недельный сундук I, удобство склада и рамка', perkEn:'Weekly chest I, inventory convenience and frame' },
  { level:3, usd:100, goldXpBonusPercent:6, nameRu:'Рыцарь', nameEn:'Knight',
    perkRu:'Автопополнение пояса, пресет рун и сундук II', perkEn:'Auto-refill belt, rune preset and daily chest II' },
  { level:4, usd:300, goldXpBonusPercent:8, nameRu:'Барон', nameEn:'Baron',
    perkRu:'Пресет экипировки, рамка Барона и недельный сундук II', perkEn:'Equipment preset, Baron frame and weekly chest II' },
  { level:5, usd:500, goldXpBonusPercent:10, nameRu:'Граф', nameEn:'Count',
    perkRu:'Аура героя, титул Граф, облик и сундук III', perkEn:'Hero aura, Count title, skin and daily chest III' },
  { level:6, usd:1000, goldXpBonusPercent:12, nameRu:'Герцог', nameEn:'Duke',
    perkRu:'Дополнительные пресеты, недельный сундук III и косметика лагеря', perkEn:'Extra presets, weekly chest III and camp cosmetics' },
  { level:7, usd:3000, goldXpBonusPercent:14, nameRu:'Властелин', nameEn:'Overlord',
    perkRu:'Облик спутника, уникальный титул и эффект появления', perkEn:'Companion skin, unique title and entrance effect' },
  { level:8, usd:5000, goldXpBonusPercent:16, nameRu:'Король', nameEn:'King',
    perkRu:'Королевская рамка, корона, выбор герба и недельный сундук IV', perkEn:'Royal frame, crown, crest selection and weekly chest IV' },
  { level:9, usd:8000, goldXpBonusPercent:18, nameRu:'Император', nameEn:'Emperor',
    perkRu:'Императорское оформление, эффект появления и сундуки V', perkEn:'Imperial styling, entrance effect and chests V' },
  { level:10, usd:10000, goldXpBonusPercent:20, nameRu:'Легенда TERRITORY', nameEn:'TERRITORY Legend',
    perkRu:'Легендарная корона, трон, герб и Зал основателей по согласию', perkEn:'Legendary crown, throne, crest and optional Founders Hall' },
] as const;

/** Use only the server-derived account snapshot to decide client VIP perks.
 * A previewed VIP tier never unlocks an actual benefit.
 */
export function activeVipForBenefits(
  account: { vip?: number; permanentVip?: number; vipRemaining?: number; vipCheckedAt?: number },
  nowMs: number,
): number {
  const safe = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const permanent = safe(account.permanentVip);
  const left = Math.max(0, safe(account.vipRemaining) - Math.max(0, nowMs - safe(account.vipCheckedAt)));
  return Math.min(VIP_MAX_LEVEL, Math.max(permanent, left > 0 ? safe(account.vip) : 0));
}

export function vipTierForPaidSpend(cumulativeUsd: number): number {
  if (!Number.isFinite(cumulativeUsd) || cumulativeUsd <= 0) return 0;
  let level = 0;
  for (let i = 1; i <= VIP_MAX_LEVEL; i++) {
    if (cumulativeUsd < VIP_SPEND_THRESHOLDS_USD[i]) break;
    level = i;
  }
  return level;
}
export function vipTier(level: number): VipTier {
  const safe = Number.isFinite(level) ? Math.max(0, Math.min(10, Math.floor(level))) : 0;
  return VIP_TIERS[safe];
}
export function vipNextThreshold(level: number): number | null {
  return level >= VIP_MAX_LEVEL ? null : VIP_SPEND_THRESHOLDS_USD[Math.max(1, Math.floor(level) + 1)];
}
