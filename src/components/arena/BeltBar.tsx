import { useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { BELT_RULES, BELT_STACK, type BeltContext } from '@/game/belt';
import { rarityColor } from '@/game/ui';
import type { InventoryItem } from '@/game/types';

interface Props {
  belt: (InventoryItem | null)[];
  ctx: BeltContext;
  actionLabel: string;
  disabled?: boolean;
  busyIndex?: number | null;
  onAction: (index: number) => void;
}

export function BeltBar({ belt, ctx, actionLabel, disabled, busyIndex, onAction }: Props) {
  const [info, setInfo] = useState<number | null>(null);
  const shown = info !== null ? { rule: BELT_RULES[info], check: BELT_RULES[info].check(ctx), item: belt[info] } : null;

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-0.5 py-0.5 touch-pan-x">
        {BELT_RULES.map((rule, i) => {
          const open = rule.check(ctx).open;
          const item = open ? belt[i] : null;
          const color = item ? rarityColor(item.rarity) : undefined;
          const busy = busyIndex === i;
          return (
            <button
              key={i}
              disabled={busy}
              onClick={() => {
                if (open && item && !disabled) {
                  setInfo(null);
                  onAction(i);
                } else {
                  setInfo(info === i ? null : i);
                }
              }}
              className={`relative snap-start shrink-0 w-[58px] h-[62px] rounded-xl flex flex-col items-center justify-center border transition-all duration-200 active:scale-90 ${
                !open ? 'bg-black/50 border-white/5' : item ? 'bg-gradient-to-b from-white/10 to-black/50' : 'bg-black/30 border-dashed border-white/15'
              } ${info === i ? 'ring-2 ring-amber-300/60' : ''}`}
              style={color ? { borderColor: `${color}cc`, boxShadow: `0 0 12px ${color}40` } : undefined}
            >
              {!open ? (
                <span className="flex flex-col items-center text-gray-500">
                  <Lock className="w-4 h-4" />
                  <span className="text-[9px] font-semibold mt-0.5">{i + 1}</span>
                </span>
              ) : busy ? (
                <Loader2 className="w-5 h-5 animate-spin text-amber-200" />
              ) : item ? (
                <>
                  <span className={`text-xl leading-none ${disabled ? 'opacity-50' : ''}`}>{item.icon}</span>
                  <span className="text-[10px] font-bold text-white tabular-nums leading-tight mt-0.5">x{item.qty}</span>
                  <span className="text-[8px] text-gray-400 leading-none truncate w-full px-1 text-center">{item.name}</span>
                </>
              ) : (
                <span className="text-[9px] text-gray-500">пусто</span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] mt-1.5 px-1 min-h-[16px] text-gray-400">
        {shown ? (
          shown.check.open ? (
            shown.item ? (
              <span><span className="text-white font-semibold">{shown.item.name}</span> · {shown.item.description}</span>
            ) : (
              <span>Слот {info! + 1} свободен — положи сюда зелье из сумки (до {BELT_STACK} шт.)</span>
            )
          ) : (
            <span className="animate-fade-in">
              <span className="text-amber-300 font-semibold">Слот {info! + 1}: {shown.rule.title}</span>
              <span> · {shown.check.progress}</span>
            </span>
          )
        ) : (
          <span>{actionLabel}</span>
        )}
      </p>
    </div>
  );
}
