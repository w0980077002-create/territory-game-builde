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
    perkRu:'Ежедневный VIP-сундук, знак отличия и рамка', perkEn:'Daily VIP chest, insignia and frame' },
  { level:2, usd:10, goldXpBonusPercent:4, nameRu:'Воин', nameEn:'Warrior',
    perkRu:'Еженедельный VIP-сундук, удобство склада и рамка', perkEn:'Weekly VIP chest, inventory convenience and frame' },
  { level:3, usd:100, goldXpBonusPercent:6, nameRu:'Рыцарь', nameEn:'Knight',
    perkRu:'Автопополнение пояса, пресет рун и улучшенные VIP-награды', perkEn:'Auto-refill belt, rune preset and upgraded VIP rewards' },
  { level:4, usd:300, goldXpBonusPercent:8, nameRu:'Барон', nameEn:'Baron',
    perkRu:'Пресет экипировки, рамка Барона и усиленные недельные награды', perkEn:'Equipment preset, Baron frame and stronger weekly rewards' },
  { level:5, usd:500, goldXpBonusPercent:10, nameRu:'Граф', nameEn:'Count',
    perkRu:'Аура героя, титул Граф, облик и улучшенные VIP-награды', perkEn:'Hero aura, Count title, skin and upgraded VIP rewards' },
  { level:6, usd:1000, goldXpBonusPercent:12, nameRu:'Герцог', nameEn:'Duke',
    perkRu:'Дополнительные пресеты, усиленные недельные награды и косметика лагеря', perkEn:'Extra presets, stronger weekly rewards and camp cosmetics' },
  { level:7, usd:3000, goldXpBonusPercent:14, nameRu:'Властелин', nameEn:'Overlord',
    perkRu:'Облик спутника, уникальный титул и эффект появления', perkEn:'Companion skin, unique title and entrance effect' },
  { level:8, usd:5000, goldXpBonusPercent:16, nameRu:'Король', nameEn:'King',
    perkRu:'Королевская рамка, корона, выбор герба и усиленные недельные награды', perkEn:'Royal frame, crown, crest selection and stronger weekly rewards' },
  { level:9, usd:8000, goldXpBonusPercent:18, nameRu:'Император', nameEn:'Emperor',
    perkRu:'Императорское оформление, эффект появления и лучшие VIP-награды', perkEn:'Imperial styling, entrance effect and premium VIP rewards' },
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
