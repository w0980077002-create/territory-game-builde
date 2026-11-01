import { useState } from 'react';
import { useLanguage } from '@/game/i18n';
import { Lock } from 'lucide-react';
import { BELT_RULES, BELT_WIN_GOALS, type BeltContext } from '@/game/belt';
import { rarityColor } from '@/game/ui';
import type { InventoryItem } from '@/game/types';
import { ItemArt } from './ItemArt';
import { Modal } from './Modal';

interface Props {
  belt: (InventoryItem | null)[];
  ctx: BeltContext;
  disabled?: boolean;
  onTap: (index: number, open: boolean) => void;
}

export function BeltCells({ belt, ctx, disabled, onTap }: Props) {
  const { language } = useLanguage();
  const [lockedSlot, setLockedSlot] = useState<number | null>(null);
  // Read-only: the same confirmed Arena win total that controls each slot.
  const wins = Number.isFinite(ctx.arenaWins) ? Math.max(0, Math.floor(ctx.arenaWins)) : 0;
  const requiredWins = lockedSlot === null ? 0 : BELT_WIN_GOALS[lockedSlot];
  const winsLeft = Math.max(0, requiredWins - wins);
  const format = (value: number) => value.toLocaleString(language === 'en' ? 'en-US' : 'ru-RU');

  return (
    <>
    <div className="grid grid-cols-7 gap-1.5">
      {BELT_RULES.map((rule, i) => {
        const open = rule.check(ctx).open;
        const item = open ? belt[i] : null;
        const color = item ? rarityColor(item.rarity) : undefined;
        return (
          <button
            key={i}
            type="button"
            data-testid={!open ? `belt-locked-slot-${i + 1}` : undefined}
            onClick={() => open ? onTap(i, true) : setLockedSlot(i)}
            title={!open ? (language === 'en' ? `Unlock after ${rule.titleEn}` : `Откроется после: ${rule.title}`) : undefined}
            aria-label={item ? item.name : open ? `${language === 'en' ? 'Slot' : 'Слот'} ${i + 1} ${language === 'en' ? 'empty' : 'пуст'}` : `${language === 'en' ? 'Slot' : 'Слот'} ${i + 1} ${language === 'en' ? 'locked' : 'закрыт'}`}
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
    {lockedSlot !== null && requiredWins > 0 && !BELT_RULES[lockedSlot].check(ctx).open && (
      <Modal
        title={language === 'en' ? `Unlock slot #${lockedSlot + 1}` : `Открытие ячейки №${lockedSlot + 1}`}
        onClose={() => setLockedSlot(null)}
      >
        <div data-testid="belt-slot-unlock-info" className="space-y-3 text-sm text-amber-100">
          <p className="leading-relaxed">
            {language === 'en'
              ? `Win ${format(requiredWins)} Arena battles to unlock this slot.`
              : `Одержи ${format(requiredWins)} побед на Арене, чтобы открыть эту ячейку.`}
          </p>
          <div className="rounded-xl border border-amber-500/30 bg-black/30 p-3">
            <div className="flex items-center justify-between gap-2 font-semibold">
              <span>{language === 'en' ? 'Your Arena wins' : 'Твои победы на Арене'}</span>
              <span className="shrink-0 tabular-nums">{format(Math.min(wins, requiredWins))} / {format(requiredWins)}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/70" aria-hidden="true">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-700 to-amber-300"
                style={{ width: `${Math.min(100, (wins / requiredWins) * 100)}%` }} />
            </div>
            <p data-testid="belt-slot-wins-left" className="mt-2 text-amber-200">
              {language === 'en' ? `${format(winsLeft)} more wins to unlock` : `Осталось побед: ${format(winsLeft)}`}
            </p>
          </div>
          <button type="button" onClick={() => setLockedSlot(null)}
            className="w-full min-h-10 rounded-lg border border-amber-300/60 bg-gradient-to-b from-amber-300 to-amber-600 px-4 font-bold text-amber-950">
            {language === 'en' ? 'Got it' : 'Понятно'}
          </button>
        </div>
      </Modal>
    )}
    </>
  );
}
