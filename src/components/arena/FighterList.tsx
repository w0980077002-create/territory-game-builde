import { Skull, Check, Crosshair, Syringe, LogOut, ChevronDown } from 'lucide-react';
import type { ArenaFighter } from '@/game/arenaApi';

interface Props {
  title: string;
  accent: 'ally' | 'enemy';
  fighters: ArenaFighter[];
  meId: string;
  active: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onRevive?: (id: string) => void;
  open: boolean;
  onToggle: () => void;
}

export function FighterList({ title, accent, fighters, meId, active, selectedId, onSelect, onRevive, open, onToggle }: Props) {
  const alive = fighters.filter((f) => f.hp > 0).length;
  const sorted = [...fighters].sort((a, b) => Number(b.hp > 0) - Number(a.hp > 0));
  const ally = accent === 'ally';
  const barTone = ally ? 'bg-teal-400' : 'bg-red-500';

  return (
    <div className={`rounded-xl border bg-gray-900/70 overflow-hidden ${ally ? 'border-teal-500/20' : 'border-red-500/20'}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-2.5 h-8 text-left transition-colors hover:bg-white/[0.03]">
        <span className={`text-[10px] font-semibold uppercase tracking-wide truncate shrink-0 max-w-[45%] ${ally ? 'text-teal-300' : 'text-red-300'}`}>{title}</span>
        <span className="flex-1 flex gap-0.5 min-w-0">
          {!open && sorted.slice(0, 20).map((f) => (
            <span key={f.id} className="flex-1 h-1 rounded-full bg-black/50 overflow-hidden max-w-[28px]">
              <span className={`block h-full ${barTone} transition-all duration-500`} style={{ width: `${Math.max(0, (f.hp / f.maxHp) * 100)}%` }} />
            </span>
          ))}
        </span>
        <span className="text-[10px] text-gray-500 tabular-nums shrink-0">{alive}/{fighters.length}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className={`px-1.5 pb-1.5 space-y-0.5 animate-fade-in ${fighters.length > 6 ? 'max-h-44 overflow-y-auto scrollbar-hide' : ''}`}>
          {sorted.map((f) => {
            const dead = f.hp <= 0;
            const isMe = f.id === meId;
            const selectable = !!onSelect && !dead;
            const selected = selectedId === f.id;
            const pct = Math.max(0, (f.hp / f.maxHp) * 100);
            return (
              <div
                key={f.id}
                role={selectable ? 'button' : undefined}
                onClick={selectable ? () => onSelect!(f.id) : undefined}
                className={`flex items-center gap-1.5 rounded-lg px-1.5 h-7 border transition-all ${
                  selected ? 'border-red-400/80 bg-red-500/10' : isMe ? 'border-teal-500/30 bg-teal-500/5' : 'border-transparent bg-black/20'
                } ${selectable ? 'cursor-pointer hover:border-red-400/50' : ''} ${dead ? 'opacity-50' : ''}`}
              >
                <span className="w-5 h-5 rounded bg-black/40 flex items-center justify-center shrink-0">
                  {dead ? (f.left ? <LogOut className="w-3 h-3 text-gray-500" /> : <Skull className="w-3 h-3 text-gray-400" />) :
                    selected ? <Crosshair className="w-3 h-3 text-red-400" /> :
                    <span className="text-[9px] font-bold text-gray-300">{f.level}</span>}
                </span>
                <span className={`text-[11px] font-semibold truncate w-[34%] ${isMe ? 'text-teal-300' : 'text-white'}`}>
                  {f.name}{isMe && <span className="text-teal-400 font-normal"> (ты)</span>}
                </span>
                <span className="flex-1 h-1 rounded-full bg-black/50 overflow-hidden">
                  <span className={`block h-full ${barTone} transition-all duration-300`} style={{ width: `${pct}%` }} />
                </span>
                <span className="text-[9px] text-gray-400 tabular-nums shrink-0 w-[46px] text-right">{f.hp}/{f.maxHp}</span>
                {f.kills > 0 && <span className="text-[9px] text-amber-400 shrink-0 flex items-center"><Skull className="w-2.5 h-2.5" />{f.kills}</span>}
                {active && !dead && f.moved && <Check className="w-3 h-3 text-emerald-400 shrink-0" aria-label="Ход сделан" />}
                {onRevive && dead && !f.left && !isMe && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRevive(f.id); }}
                    className="shrink-0 text-[10px] font-semibold px-1.5 h-5 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 flex items-center gap-0.5 transition-colors"
                  >
                    <Syringe className="w-2.5 h-2.5" /> Оживить
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
