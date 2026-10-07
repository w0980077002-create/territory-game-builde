import { Lock } from 'lucide-react';
import { BELT_RULES, type BeltContext } from '@/game/belt';
import { rarityColor } from '@/game/ui';
import type { InventoryItem } from '@/game/types';
import { ItemArt } from './ItemArt';

interface Props {
  belt: (InventoryItem | null)[];
  ctx: BeltContext;
  disabled?: boolean;
  onTap: (index: number, open: boolean) => void;
}

export function BeltCells({ belt, ctx, disabled, onTap }: Props) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {BELT_RULES.map((rule, i) => {
        const open = rule.check(ctx).open;
        const item = open ? belt[i] : null;
        const color = item ? rarityColor(item.rarity) : undefined;
        return (
          <button
            key={i}
            onClick={() => onTap(i, open)}
            aria-label={item ? item.name : open ? `Слот ${i + 1} пуст` : `Слот ${i + 1} закрыт`}
            className={`relative aspect-square rounded-xl border flex items-center justify-center transition-all duration-200 active:scale-90 ${
              !open
                ? 'bg-black/60 border-white/5'
                : item
                  ? 'bg-gradient-to-b from-[#2b2a24] to-[#100f0c]'
                  : 'bg-black/40 border-dashed border-amber-200/15'
            } ${disabled && item ? 'opacity-60' : ''}`}
            style={color ? { borderColor: `${color}bb`, boxShadow: `inset 0 0 10px ${color}33` } : undefined}
          >
            {!open ? (
              <Lock className="w-3.5 h-3.5 text-gray-600" />
            ) : item ? (
              <>
                <ItemArt item={item} size={30} />
                <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white tabular-nums [text-shadow:0_1px_2px_#000]">{item.qty}</span>
              </>
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-100/15" />
            )}
          </button>
        );
      })}
    </div>
  );
}
