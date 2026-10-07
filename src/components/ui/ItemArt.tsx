import { itemArt } from '@/game/art';
import { rarityColor } from '@/game/ui';
import type { InventoryItem, ShopItem } from '@/game/types';

interface Props {
  item: InventoryItem | ShopItem;
  size?: number;
  dim?: boolean;
  className?: string;
}

export function ItemArt({ item, size = 40, dim, className = '' }: Props) {
  const color = rarityColor(item.rarity);
  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-[12%] rounded-full blur-md opacity-60"
        style={{ background: `radial-gradient(circle, ${color}88, transparent 70%)` }}
      />
      <img
        src={itemArt(item)}
        alt={item.name}
        draggable={false}
        loading="lazy"
        className={`relative w-full h-full object-contain select-none drop-shadow-[0_3px_4px_rgba(0,0,0,0.7)] ${dim ? 'opacity-50 grayscale' : ''}`}
      />
    </span>
  );
}
