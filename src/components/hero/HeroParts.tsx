import { useState } from 'react';
import { Heart, Shield, Sword, Star, Flame } from 'lucide-react';
import { EQUIPMENT_SLOTS } from '@/game/engine';
import { SLOT_ART } from '@/game/art';
import { rarityColor } from '@/game/ui';
import type { Equipment } from '@/game/types';

export interface GearView {
  name: string;
  rarity: string;
  level: number;
  attack?: number;
  defense?: number;
  hp?: number;
  critChance?: number;
}

export type GearMap = Partial<Record<Equipment['slot'], GearView>>;

export interface StatView {
  attack: number;
  defense: number;
  maxHp: number;
  critChance: number;
  critDamage?: number;
}

export function gearStatLine(g: GearView) {
  return [
    g.attack ? `+${g.attack} сила` : '',
    g.defense ? `+${g.defense} стойкость` : '',
    g.hp ? `+${g.hp} HP` : '',
    g.critChance ? `+${g.critChance}% крит` : '',
  ].filter(Boolean).join(' · ');
}

export function StatGrid({ stats }: { stats: StatView }) {
  const rows = [
    { label: 'Сила', value: stats.attack, icon: Sword, tone: 'text-orange-300' },
    { label: 'Стойкость', value: stats.defense, icon: Shield, tone: 'text-sky-300' },
    { label: 'Здоровье', value: stats.maxHp, icon: Heart, tone: 'text-red-300' },
    { label: 'Шанс крита', value: `${stats.critChance}%`, icon: Star, tone: 'text-yellow-300' },
    ...(stats.critDamage !== undefined ? [{ label: 'Сила крита', value: `+${stats.critDamage}%`, icon: Flame, tone: 'text-amber-300' }] : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2.5 rounded-xl bg-black/30 border border-white/5 px-3 h-12">
          <r.icon className={`w-4 h-4 shrink-0 ${r.tone}`} />
          <div className="min-w-0">
            <p className="text-[10px] text-gray-500 leading-tight">{r.label}</p>
            <p className="text-sm font-bold text-white tabular-nums leading-tight">{r.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Slot({ slot, gear, active, onTap }: { slot: Equipment['slot']; gear?: GearView; active: boolean; onTap: () => void }) {
  const color = gear ? rarityColor(gear.rarity) : undefined;
  return (
    <button
      onClick={onTap}
      className={`relative w-14 h-14 rounded-xl border flex items-center justify-center transition-all active:scale-90 ${gear ? 'bg-gradient-to-b from-[#2b2a24] to-[#100f0c]' : 'bg-black/50 border-white/10'} ${active ? 'ring-2 ring-amber-300/70' : ''}`}
      style={color ? { borderColor: `${color}cc`, boxShadow: `inset 0 0 12px ${color}40` } : undefined}
    >
      <img src={SLOT_ART[slot]} alt="" className={`w-11 h-11 object-contain ${gear ? 'drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]' : 'opacity-20 grayscale'}`} />
      {gear && <span className="absolute bottom-0 inset-x-0 text-[9px] font-bold text-center text-white bg-black/55 rounded-b-xl">{gear.level}</span>}
    </button>
  );
}

export function PaperDoll({ gear, followerUnlocked }: { gear: GearMap; followerUnlocked: boolean }) {
  const [picked, setPicked] = useState<Equipment['slot'] | null>(null);
  const left = EQUIPMENT_SLOTS.slice(0, 3);
  const right = EQUIPMENT_SLOTS.slice(3, 6);
  const bottom = EQUIPMENT_SLOTS[6];
  const tap = (s: Equipment['slot']) => setPicked((p) => (p === s ? null : s));
  const g = picked ? gear[picked] : undefined;
  const slotName = EQUIPMENT_SLOTS.find((s) => s.id === picked)?.name;

  return (
    <div className="rounded-2xl border border-amber-500/15 bg-gradient-to-b from-[#1a1d25] to-[#0f1115] p-3">
      <div className="grid grid-cols-[56px_1fr_56px] gap-2 items-center">
        <div className="flex flex-col gap-2">{left.map((s) => <Slot key={s.id} slot={s.id} gear={gear[s.id]} active={picked === s.id} onTap={() => tap(s.id)} />)}</div>
        <div className="relative h-[188px]">
          <div className="absolute inset-x-2 bottom-1 h-6 rounded-[50%] bg-black/60 blur-md" />
          {followerUnlocked && (
            <img src="/follower-shield.webp" alt="" className="absolute left-0 bottom-1 h-[62%] object-contain opacity-90" />
          )}
          <img src="/hero-viking.webp" alt="" className="absolute right-0 bottom-0 h-full w-[85%] object-contain object-bottom animate-idle" />
        </div>
        <div className="flex flex-col gap-2">{right.map((s) => <Slot key={s.id} slot={s.id} gear={gear[s.id]} active={picked === s.id} onTap={() => tap(s.id)} />)}</div>
      </div>
      <div className="flex justify-center mt-2">
        <Slot slot={bottom.id} gear={gear[bottom.id]} active={picked === bottom.id} onTap={() => tap(bottom.id)} />
      </div>
      <p className="text-[11px] text-center mt-2 min-h-[16px] px-2">
        {picked ? (
          g ? (
            <span className="animate-fade-in">
              <span className="font-semibold" style={{ color: rarityColor(g.rarity) }}>{g.name}</span>
              <span className="text-gray-400"> · ур. {g.level}{gearStatLine(g) ? ` · ${gearStatLine(g)}` : ''}</span>
            </span>
          ) : (
            <span className="text-gray-500">{slotName}: пусто</span>
          )
        ) : (
          <span className="text-gray-500">Нажми на ячейку, чтобы увидеть предмет</span>
        )}
      </p>
    </div>
  );
}
