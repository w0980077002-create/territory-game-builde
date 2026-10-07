import { useState } from 'react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { rarityColor, rarityGlow } from '@/game/ui';
import { Hammer, ArrowUp, X } from 'lucide-react';
import { hapticNotify } from '@/game/telegram';
import { SLOT_ART } from '@/game/art';
import { ItemArt } from './ui/ItemArt';
import type { Equipment, InventoryItem } from '@/game/types';

const UPGRADE_COST = (level: number) => ({
  gold: 50 + level * 30,
  materials: 1 + Math.floor(level / 3),
});

export function ForgeScreen() {
  const state = useStore(useGame);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const equipment = state.inventory.filter((i) => i.type === 'equipment' && i.equipment);
  const equippedList = Object.values(state.player.equipped).filter(Boolean) as Equipment[];

  const tryUpgrade = (item: InventoryItem) => {
    if (!item.equipment) return;
    const eq = item.equipment;
    const cost = UPGRADE_COST(eq.level);

    if (state.player.gold < cost.gold) {
      setError('Недостаточно золота');
      hapticNotify('error');
      setTimeout(() => setError(null), 2000);
      return;
    }
    if (state.forgeMaterials < cost.materials) {
      setError('Недостаточно материалов кузницы');
      hapticNotify('error');
      setTimeout(() => setError(null), 2000);
      return;
    }

    setUpgrading(true);
    setError(null);

    setTimeout(() => {
      // 80% success rate, decreases with level
      const successRate = Math.max(0.5, 0.9 - eq.level * 0.05);
      const isSuccess = Math.random() < successRate;

      if (isSuccess) {
        const upgradedEq: Equipment = {
          ...eq,
          level: eq.level + 1,
          attack: eq.attack ? eq.attack + Math.ceil(eq.attack * 0.15) : undefined,
          defense: eq.defense ? eq.defense + Math.ceil(eq.defense * 0.15) : undefined,
          hp: eq.hp ? eq.hp + Math.ceil(eq.hp * 0.15) : undefined,
        };

        const isEquipped = item.id.startsWith('equipped_');
        const newInventory = isEquipped ? state.inventory : state.inventory.map((i) =>
          i.id === item.id
            ? {
                ...i,
                equipment: upgradedEq,
                description: `Уровень ${upgradedEq.level} · ${upgradedEq.rarity}`,
              }
            : i,
        );
        const equipped = isEquipped
          ? { ...state.player.equipped, [upgradedEq.slot]: upgradedEq }
          : state.player.equipped;

        useGame.set({
          ...state,
          player: {
            ...state.player,
            gold: state.player.gold - cost.gold,
            equipped,
          },
          forgeMaterials: state.forgeMaterials - cost.materials,
          inventory: newInventory,
        });

        setSelected(null);
        setSuccess(true);
        hapticNotify('success');
        setTimeout(() => setSuccess(false), 2000);
      } else {
        useGame.set({
          ...state,
          player: {
            ...state.player,
            gold: state.player.gold - cost.gold,
          },
          forgeMaterials: state.forgeMaterials - cost.materials,
        });
        setError('Неудача! Предмет не улучшился, но материалы потрачены.');
        hapticNotify('error');
        setTimeout(() => setError(null), 3000);
      }

      setUpgrading(false);
    }, 1200);
  };

  const allEquipment = [
    ...equippedList.map((eq) => ({
      id: `equipped_${eq.id}`,
      name: eq.name,
      icon: eq.icon,
      type: 'equipment' as const,
      rarity: eq.rarity,
      qty: 1,
      description: `Надето · Уровень ${eq.level} · ${eq.rarity}`,
      equipment: eq,
    })),
    ...equipment,
  ];

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      <div className="card text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Hammer className="w-6 h-6 text-orange-400" />
          <h2 className="text-xl font-bold text-white">Кузница</h2>
        </div>
        <p className="text-sm text-gray-400">Улучшай экипировку за золото и материалы</p>
        <div className="flex justify-center gap-4 mt-3 text-sm">
          <span className="text-amber-400">🪙 {state.player.gold}</span>
          <span className="text-orange-400">🔩 {state.forgeMaterials}</span>
        </div>
      </div>

      {error && (
        <div className="card text-center text-red-400 text-sm animate-pop">
          {error}
        </div>
      )}

      {success && (
        <div className="card text-center text-teal-400 text-sm animate-pop">
          Улучшение успешно! Предмет стал сильнее!
        </div>
      )}

      {/* Equipped items */}
      {equippedList.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">Надетая экипировка</h3>
          <div className="grid grid-cols-2 gap-2">
            {equippedList.map((eq) => (
              <button
                key={eq.id}
                className="card flex flex-col items-center p-3 transition-all active:scale-95 hover:border-orange-500/30"
                style={{ border: `1px solid ${rarityColor(eq.rarity)}40` }}
                onClick={() => setSelected({
                  id: `equipped_${eq.id}`,
                  name: eq.name,
                  icon: eq.icon,
                  type: 'equipment',
                  rarity: eq.rarity,
                  qty: 1,
                  description: `Надето · Уровень ${eq.level}`,
                  equipment: eq,
                })}
              >
                <div className="w-12 h-12 rounded-lg bg-black/30 flex items-center justify-center text-2xl mb-1"
                  style={{ boxShadow: rarityGlow(eq.rarity) }}
                >
                  <img src={SLOT_ART[eq.slot]} alt="" className="w-11 h-11 object-contain drop-shadow-[0_3px_4px_rgba(0,0,0,0.7)]" />
                </div>
                <p className="text-xs font-medium truncate w-full text-center" style={{ color: rarityColor(eq.rarity) }}>
                  {eq.name}
                </p>
                <p className="text-xs text-gray-500">Ур. {eq.level}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Inventory equipment */}
      {equipment.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">В сумке</h3>
          <div className="grid grid-cols-2 gap-2">
            {equipment.map((item) => (
              <button
                key={item.id}
                className="card flex flex-col items-center p-3 transition-all active:scale-95 hover:border-orange-500/30"
                style={{ border: `1px solid ${rarityColor(item.rarity)}40` }}
                onClick={() => setSelected(item)}
              >
                <div className="w-12 h-12 rounded-lg bg-black/30 flex items-center justify-center text-2xl mb-1"
                  style={{ boxShadow: rarityGlow(item.rarity) }}
                >
                  <ItemArt item={item} size={44} />
                </div>
                <p className="text-xs font-medium truncate w-full text-center" style={{ color: rarityColor(item.rarity) }}>
                  {item.name}
                </p>
                <p className="text-xs text-gray-500">Ур. {item.equipment?.level || 1}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {allEquipment.length === 0 && (
        <div className="card text-center py-8 text-gray-500">
          <Hammer className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Нет экипировки для улучшения</p>
          <p className="text-xs mt-1">Побеждай боссов, чтобы получить предметы!</p>
        </div>
      )}

      {/* Upgrade modal */}
      {selected && selected.equipment && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setSelected(null)}
        >
          <div
            className="card w-full max-w-sm m-2 animate-slide-up"
            style={{ border: `1px solid ${rarityColor(selected.rarity)}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div
                className="w-14 h-14 rounded-xl bg-black/30 flex items-center justify-center text-3xl shrink-0"
                style={{ border: `1px solid ${rarityColor(selected.rarity)}` }}
              >
                <ItemArt item={selected} size={48} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-base" style={{ color: rarityColor(selected.rarity) }}>
                  {selected.name}
                </h3>
                <p className="text-xs text-gray-400">Уровень {selected.equipment.level} · {selected.rarity}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current stats */}
            <div className="space-y-1 mb-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Сейчас</p>
              {selected.equipment.attack ? <StatRow label="Атака" value={selected.equipment.attack} /> : null}
              {selected.equipment.defense ? <StatRow label="Защита" value={selected.equipment.defense} /> : null}
              {selected.equipment.hp ? <StatRow label="Здоровье" value={selected.equipment.hp} /> : null}
            </div>

            {/* Upgrade cost */}
            <div className="bg-black/20 rounded-lg p-3 mb-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Стоимость улучшения</p>
              <div className="flex justify-between text-sm">
                <span className="text-amber-400">🪙 {UPGRADE_COST(selected.equipment.level).gold}</span>
                <span className="text-orange-400">🔩 {UPGRADE_COST(selected.equipment.level).materials}</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Шанс успеха: {Math.round(Math.max(50, 90 - selected.equipment.level * 5))}%
              </p>
            </div>

            <button
              className="btn-accent w-full"
              onClick={() => tryUpgrade(selected)}
              disabled={upgrading}
            >
              {upgrading ? 'Кузнец работает...' : (
                <><ArrowUp className="w-4 h-4 inline mr-1" /> Улучшить</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
}
