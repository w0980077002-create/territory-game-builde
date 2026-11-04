/** TERRITORY founder-era VIP catalogue. USD amounts are target cumulative spend
 * bands, NOT a payment quote, purchase API or a means to mint entitlements.
 * Only server-confirmed purchases may count toward them.
 */
export const VIP_SPEND_THRESHOLDS_USD = [0, 1, 10, 50, 150, 350, 750, 1500, 3000, 5000, 10000] as const;
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
    perkRu:'Ежедневный VIP-сундук и знак отличия', perkEn:'Daily VIP chest and insignia' },
  { level:2, usd:10, goldXpBonusPercent:4, nameRu:'Воин', nameEn:'Warrior',
    perkRu:'Удобство инвентаря и рамка профиля', perkEn:'Inventory convenience and profile border' },
  { level:3, usd:50, goldXpBonusPercent:6, nameRu:'Рыцарь', nameEn:'Knight',
    perkRu:'Умный пояс и дополнительная сборка рун', perkEn:'Smart belt and extra rune loadout' },
  { level:4, usd:150, goldXpBonusPercent:8, nameRu:'Барон', nameEn:'Baron',
    perkRu:'Улучшенные еженедельные материалы кузницы', perkEn:'Enhanced weekly forge materials' },
  { level:5, usd:350, goldXpBonusPercent:10, nameRu:'Граф', nameEn:'Count',
    perkRu:'Аура героя, улучшенный сундук и особый облик', perkEn:'Hero aura, upgraded chest and special skin' },
  { level:6, usd:750, goldXpBonusPercent:12, nameRu:'Герцог', nameEn:'Duke',
    perkRu:'Дополнительные PvE-ресурсы и оформление лагеря', perkEn:'Extra PvE supplies and camp decoration' },
  { level:7, usd:1500, goldXpBonusPercent:14, nameRu:'Властелин', nameEn:'Overlord',
    perkRu:'Облик спутника и ежемесячный коллекционный подарок', perkEn:'Companion skin and monthly collectible' },
  { level:8, usd:3000, goldXpBonusPercent:16, nameRu:'Король', nameEn:'King',
    perkRu:'Королевский титул и личный герб из коллекции', perkEn:'Royal title and selected personal crest' },
  { level:9, usd:5000, goldXpBonusPercent:18, nameRu:'Император', nameEn:'Emperor',
    perkRu:'Императорский стиль и анимация появления', perkEn:'Imperial styling and entry animation' },
  { level:10, usd:10000, goldXpBonusPercent:20, nameRu:'Легенда TERRITORY', nameEn:'TERRITORY Legend',
    perkRu:'Легендарная корона, трон и почётное место в истории', perkEn:'Legendary crown, throne and honors' },
] as const;

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
