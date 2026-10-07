import { useState } from 'react';
import { useStore } from '@/game/store';
import { useGame, useArena, equipItem, unequipItem } from '@/game/actions';
import { EQUIPMENT_SLOTS } from '@/game/engine';
import { BELT_STACK, beltContext, canBelt, putInBelt, takeFromBelt } from '@/game/belt';
import { SLOT_ART } from '@/game/art';
import { ItemArt } from './ui/ItemArt';
import { BeltCells } from './ui/BeltCells';
import { rarityColor, rarityGlow } from '@/game/ui';
import type { InventoryItem } from '@/game/types';
import { Package, Check, X, ArrowDownUp } from 'lucide-react';

export function InventoryScreen({ initialTab = 'items' }: { initialTab?: 'items' | 'equipment' }) {
  const state = useStore(useGame);
  const arena = useStore(useArena);
  const [tab, setTab] = useState<'items' | 'equipment'>(initialTab);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [beltNote, setBeltNote] = useState<string | null>(null);

  const consumables = state.inventory.filter((i) => i.type === 'potion' || i.type === 'elixir' || i.type === 'arena');
  const equipment = state.inventory.filter((i) => i.type === 'equipment');
  const materials = state.inventory.filter((i) => i.type === 'material');

  const toBelt = (item: InventoryItem) => {
    const next = putInBelt(state, item.id, beltContext(state, arena.wins));
    if (!next) {
      setBeltNote('На поясе нет свободного слота');
      return;
    }
    useGame.set(next);
    setSelected(null);
    setBeltNote(null);
  };

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      {/* Tabs */}
      <div className="flex gap-2">
        <button
          className={`flex-1 btn ${tab === 'items' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('items')}
        >
          <Package className="w-4 h-4 inline mr-1" /> Предметы
        </button>
        <button
          className={`flex-1 btn ${tab === 'equipment' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('equipment')}
        >
          <ArrowDownUp className="w-4 h-4 inline mr-1" /> Экипировка
        </button>
      </div>

      {tab === 'items' && (
        <>
          <div className="rounded-2xl border border-amber-500/15 bg-gray-900/70 p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-300">Пояс</h3>
              <span className="text-[11px] text-gray-500">нажми на слот, чтобы снять</span>
            </div>
            <BeltCells
              belt={state.belt}
              ctx={beltContext(state, arena.wins)}
              onTap={(i, open) => open && state.belt[i] && useGame.set(takeFromBelt(state, i))}
            />
          </div>
          {/* Consumables */}
          {consumables.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">Расходники</h3>
              <div className="grid grid-cols-2 gap-2">
                {consumables.map((item) => (
                  <ItemCard key={item.id} item={item} onClick={() => setSelected(item)} />
                ))}
              </div>
            </div>
          )}

          {/* Materials */}
          {materials.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">Материалы</h3>
              <div className="grid grid-cols-2 gap-2">
                {materials.map((item) => (
                  <ItemCard key={item.id} item={item} onClick={() => setSelected(item)} />
                ))}
              </div>
            </div>
          )}

          {consumables.length === 0 && materials.length === 0 && (
            <div className="card text-center py-8 text-gray-500">
              <Package className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>Инвентарь пуст</p>
            </div>
          )}
        </>
      )}

      {tab === 'equipment' && (
        <>
          {/* Equipped slots */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">Надето</h3>
            <div className="space-y-2">
              {EQUIPMENT_SLOTS.map(({ id: slot, name }) => {
                const eq = state.player.equipped[slot];
                return (
                  <div key={slot} className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-lg bg-black/30 flex items-center justify-center shrink-0 border border-white/10"
                      style={eq ? { borderColor: rarityColor(eq.rarity) } : undefined}
                    >
                      <img src={SLOT_ART[slot]} alt="" className={`w-9 h-9 object-contain ${eq ? '' : 'opacity-20 grayscale'}`} />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-gray-500">{name}</p>
                      {eq ? (
                        <p className="text-sm font-medium" style={{ color: rarityColor(eq.rarity) }}>
                          {eq.name}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-600">Пусто</p>
                      )}
                    </div>
                    {eq && (
                      <button
                        className="btn-ghost text-xs px-2 py-1"
                        onClick={() => useGame.set(unequipItem(state, slot))}
                      >
                        Снять
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Equipment in inventory */}
          {equipment.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">В сумке</h3>
              <div className="grid grid-cols-2 gap-2">
                {equipment.map((item) => (
                  <ItemCard key={item.id} item={item} onClick={() => setSelected(item)} />
                ))}
              </div>
            </div>
          ) : (
            <div className="card text-center py-6 text-gray-500">
              <p className="text-sm">Нет экипировки в сумке</p>
              <p className="text-xs mt-1">Побеждай боссов, чтобы получать предметы!</p>
            </div>
          )}
        </>
      )}

      {/* Item detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => { setSelected(null); setBeltNote(null); }}
        >
          <div
            className="card w-full max-w-sm m-2 animate-slide-up"
            style={{ border: `1px solid ${rarityColor(selected.rarity)}`, boxShadow: rarityGlow(selected.rarity) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-3">
              <div
                className="w-16 h-16 rounded-xl bg-black/30 flex items-center justify-center shrink-0"
                style={{ border: `1px solid ${rarityColor(selected.rarity)}` }}
              >
                <ItemArt item={selected} size={52} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-base" style={{ color: rarityColor(selected.rarity) }}>
                  {selected.name}
                </h3>
                <p className="text-xs text-gray-400 capitalize">{selected.rarity} · {selected.type}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-300 mb-3">{selected.description}</p>

            {selected.effect && (
              <div className="text-sm text-teal-400 mb-3">
                Эффект: +{selected.effect.value} {selected.effect.stat}
              </div>
            )}

            {selected.equipment && (
              <div className="space-y-1 mb-3">
                {selected.equipment.attack ? <Stat stat="Атака" value={`+${selected.equipment.attack}`} /> : null}
                {selected.equipment.defense ? <Stat stat="Защита" value={`+${selected.equipment.defense}`} /> : null}
                {selected.equipment.hp ? <Stat stat="Здоровье" value={`+${selected.equipment.hp}`} /> : null}
              </div>
            )}

            {canBelt(selected) && (
              <p className="text-xs text-amber-300/80 mb-3">
                В бою пьётся только с пояса: до {BELT_STACK} шт. в одном слоте.
              </p>
            )}
            {beltNote && <p className="text-xs text-red-400 mb-3">{beltNote}</p>}

            <div className="flex flex-wrap gap-2">
              {selected.type === 'equipment' && selected.equipment && (
                <button
                  className="btn-primary flex-1"
                  onClick={() => {
                    useGame.set(equipItem(state, selected));
                    setSelected(null);
                  }}
                >
                  <Check className="w-4 h-4 inline mr-1" /> Надеть
                </button>
              )}
              {selected.type === 'arena' && (
                <p className="w-full text-xs text-sky-300">Действует только в бою на арене</p>
              )}
              {canBelt(selected) && (
                <button className="btn-ghost flex-1 border border-amber-500/30 text-amber-200" onClick={() => toBelt(selected)}>
                  На пояс
                </button>
              )}
              <button className="btn-ghost" onClick={() => { setSelected(null); setBeltNote(null); }}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, onClick }: { item: InventoryItem; onClick: () => void }) {
  const color = rarityColor(item.rarity);
  return (
    <button
      className="card flex flex-col items-center p-3 transition-all active:scale-95 hover:border-teal-500/30"
      style={{ border: `1px solid ${color}40` }}
      onClick={onClick}
    >
      <div
        className="w-14 h-14 rounded-lg bg-black/30 flex items-center justify-center mb-1"
        style={{ boxShadow: rarityGlow(item.rarity) }}
      >
        <ItemArt item={item} size={48} />
      </div>
      <p className="text-xs font-medium text-center truncate w-full" style={{ color }}>
        {item.name}
      </p>
      {item.qty > 1 && (
        <span className="text-xs text-gray-500 mt-0.5">x{item.qty}</span>
      )}
    </button>
  );
}

function Stat({ stat, value }: { stat: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{stat}</span>
      <span className="text-teal-400 font-medium">{value}</span>
    </div>
  );
}
