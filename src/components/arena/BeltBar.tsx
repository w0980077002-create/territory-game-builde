import { useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { BELT_RULES, BELT_STACK, type BeltContext } from '@/game/belt';
import { rarityColor } from '@/game/ui';
import type { InventoryItem } from '@/game/types';
import { useLanguage, localizeText } from '@/game/i18n';
import { ItemArt } from '@/components/ui/ItemArt';

interface Props {
  belt: (InventoryItem | null)[];
  ctx: BeltContext;
  actionLabel: string;
  /** Show all seven slots at once on a narrow Telegram arena screen. */
  compact?: boolean;
  disabled?: boolean;
  busyIndex?: number | null;
  onAction: (index: number) => void;
}

export function BeltBar({ belt, ctx, actionLabel, compact = false, disabled, busyIndex, onAction }: Props) {
  const { language } = useLanguage();
  const [info, setInfo] = useState<number | null>(null);
  const shown = info !== null ? { rule: BELT_RULES[info], check: BELT_RULES[info].check(ctx), item: belt[info] } : null;

  return (
    <div>
      <div className={compact ? "grid grid-cols-7 gap-1 min-w-0 px-0.5 py-0.5" : "flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-0.5 py-0.5 touch-pan-x"}>
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
              className={`relative flex flex-col items-center justify-center border transition-all duration-200 active:scale-90 ${compact ? 'min-w-0 w-full h-11 rounded-lg' : 'snap-start shrink-0 w-[58px] h-[62px] rounded-xl'} ${
                !open ? 'bg-black/50 border-white/5' : item ? 'bg-gradient-to-b from-white/10 to-black/50' : 'bg-black/30 border-dashed border-white/15'
              } ${info === i ? 'ring-2 ring-amber-300/60' : ''}`}
              style={color ? { borderColor: `${color}cc`, boxShadow: `0 0 12px ${color}40` } : undefined}
            >
              {!open ? (
                <span className="flex flex-col items-center text-gray-500">
                  <Lock className={compact ? 'h-3.5 w-3.5' : 'w-4 h-4'} />
                  <span className={compact ? 'text-[8px] font-semibold' : 'text-[9px] font-semibold mt-0.5'}>{i + 1}</span>
                </span>
              ) : busy ? (
                <Loader2 className="w-5 h-5 animate-spin text-amber-200" />
              ) : item ? (
                <>
                  <ItemArt item={item} size={compact ? 22 : 33} dim={!!disabled} />
                  <span className={compact ? "absolute bottom-0 right-0 rounded bg-black/85 px-0.5 text-[9px] font-black text-white tabular-nums leading-none" : "text-[10px] font-bold text-white tabular-nums leading-tight mt-0.5"}>x{item.qty}</span>
                  {!compact && <span className="text-[8px] text-gray-400 leading-none truncate w-full px-1 text-center">{item.name}</span>}
                </>
              ) : (
                <span className="text-[9px] text-gray-500">{language === 'en' ? 'empty' : 'пусто'}</span>
              )}
            </button>
          );
        })}
      </div>
      {(shown || !compact) && <p className="text-[11px] mt-1.5 px-1 min-h-[16px] text-gray-400">
        {shown ? (
          shown.check.open ? (
            shown.item ? (
              <span><span className="text-white font-semibold">{localizeText(shown.item.name, language)}</span> · {localizeText(shown.item.description, language)}</span>
            ) : (
              <span>{language === 'en' ? `Slot ${info! + 1} is free — move a potion here from inventory (up to ${BELT_STACK})` : `Слот ${info! + 1} свободен — положи сюда зелье из сумки (до ${BELT_STACK} шт.)`}</span>
            )
          ) : (
            <span className="animate-fade-in">
              <span className="text-amber-300 font-semibold">{language === 'en' ? `Slot ${info! + 1}: ${shown.rule.titleEn}` : `Слот ${info! + 1}: ${shown.rule.title}`}</span>
              <span> · {language === 'en' ? shown.check.progressEn : shown.check.progress}</span>
            </span>
          )
        ) : (
          <span>{actionLabel}</span>
        )}
      </p>}
    </div>
  );
}
