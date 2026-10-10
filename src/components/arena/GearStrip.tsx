import { useState } from 'react';
import { EQUIPMENT_SLOTS } from '@/game/engine';
import { rarityColor } from '@/game/ui';
import type { Equipment, GameState } from '@/game/types';
import { useLanguage, localizeText } from '@/game/i18n';

function statLine(eq: Equipment, language: 'ru' | 'en') {
  return [
    eq.attack ? `+${eq.attack} ${language === 'en' ? 'atk' : 'атк'}` : '',
    eq.defense ? `+${eq.defense} ${language === 'en' ? 'def' : 'защ'}` : '',
    eq.hp ? `+${eq.hp} HP` : '',
    eq.critChance ? `+${eq.critChance}% ${language === 'en' ? 'crit' : 'крит'}` : '',
  ].filter(Boolean).join(' · ');
}

export function GearStrip({ equipped }: { equipped: GameState['player']['equipped'] }) {
  const { language } = useLanguage();
  const [picked, setPicked] = useState<Equipment['slot'] | null>(null);
  const slot = EQUIPMENT_SLOTS.find((s) => s.id === picked);
  const eq = picked ? equipped[picked] : undefined;

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-0.5 py-0.5 touch-pan-x">
        {EQUIPMENT_SLOTS.map((s) => {
          const item = equipped[s.id];
          const color = item ? rarityColor(item.rarity) : undefined;
          const on = picked === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setPicked(on ? null : s.id)}
              className={`snap-start shrink-0 w-[58px] h-[58px] rounded-xl flex flex-col items-center justify-center gap-0.5 border transition-all duration-200 active:scale-95 ${
                item ? 'bg-gradient-to-b from-white/[0.07] to-black/40' : 'bg-black/30 border-dashed'
              } ${on ? 'ring-2 ring-amber-300/70' : ''}`}
              style={{ borderColor: color ? `${color}aa` : 'rgba(255,255,255,0.12)', boxShadow: color ? `inset 0 0 12px ${color}33` : undefined }}
            >
              <span className={`text-xl leading-none ${item ? '' : 'opacity-25 grayscale'}`}>{item ? item.icon : s.icon}</span>
              <span className="text-[9px] text-gray-400 leading-none">{language === 'en' ? ({ helmet: 'Head', amulet: 'Amulet', armor: 'Armor', weapon: 'Weapon', shield: 'Shield', ring: 'Ring', boots: 'Boots' } as Record<string, string>)[s.id] || s.name : s.name}</span>
            </button>
          );
        })}
      </div>
      {slot && (
        <p className="text-[11px] mt-1.5 px-1 animate-fade-in">
          {eq ? (
            <>
              <span className="font-semibold" style={{ color: rarityColor(eq.rarity) }}>{localizeText(eq.name, language)}</span>
              <span className="text-gray-400"> · {language === 'en' ? 'Lv.' : 'ур.'} {eq.level}{statLine(eq, language) ? ` · ${statLine(eq, language)}` : ''}</span>
            </>
          ) : (
            <span className="text-gray-500">{language === 'en' ? 'Empty — check the Shop or Forge' : `${slot.name}: пусто — загляни в магазин или кузницу`}</span>
          )}
        </p>
      )}
    </div>
  );
}
