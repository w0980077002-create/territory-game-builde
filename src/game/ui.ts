import { RARITY_COLORS } from './engine';

export function rarityColor(rarity: string): string {
  return RARITY_COLORS[rarity] || '#9ca3af';
}

export function rarityBorder(rarity: string): string {
  const c = rarityColor(rarity);
  return `1px solid ${c}`;
}

export function rarityGlow(rarity: string): string {
  const c = rarityColor(rarity);
  const intensity = { common: 0, rare: 0.2, epic: 0.35, legendary: 0.5 }[rarity] || 0;
  return intensity > 0 ? `0 0 12px ${c}${Math.round(intensity * 255).toString(16).padStart(2, '0')}` : 'none';
}
