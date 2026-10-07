import { EQUIPMENT_SLOTS } from '@/game/engine';
import { SLOT_ART } from '@/game/art';
import { rarityColor } from '@/game/ui';
import type { Equipment, GameState } from '@/game/types';

interface Props {
  equipped: GameState['player']['equipped'];
  onTap: (slot: Equipment['slot']) => void;
}

export function EquipCells({ equipped, onTap }: Props) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {EQUIPMENT_SLOTS.map((s) => {
        const eq = equipped[s.id];
        const color = eq ? rarityColor(eq.rarity) : undefined;
        return (
          <button
            key={s.id}
            onClick={() => onTap(s.id)}
            aria-label={eq ? eq.name : `${s.name}: пусто`}
            className={`relative aspect-square rounded-xl border flex items-center justify-center overflow-hidden transition-all duration-200 active:scale-90 ${
              eq ? 'bg-gradient-to-b from-[#2b2a24] to-[#100f0c]' : 'bg-black/45 border-white/10'
            }`}
            style={color ? { borderColor: `${color}cc`, boxShadow: `inset 0 0 12px ${color}40, 0 0 8px ${color}30` } : undefined}
          >
            <img
              src={SLOT_ART[s.id]}
              alt=""
              draggable={false}
              className={`w-[78%] h-[78%] object-contain select-none ${eq ? 'drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]' : 'opacity-[0.18] grayscale'}`}
            />
            {eq && (
              <span className="absolute bottom-0 inset-x-0 text-[9px] font-bold text-center leading-tight text-white bg-black/55 tabular-nums">
                {eq.level}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
