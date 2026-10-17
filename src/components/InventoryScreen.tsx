import { useState } from 'react';
import { useStore } from '@/game/store';
import { useLanguage, localizeText } from '@/game/i18n';
import { useGame, useArena, equipItem, unequipItem } from '@/game/actions';
import { BELT_STACK, beltContext, canBelt, putInBelt, takeFromBelt } from '@/game/belt';
import { ItemArt } from './ui/ItemArt';
import { BeltCells } from './ui/BeltCells';
import { rarityColor, rarityGlow } from '@/game/ui';
import type { Equipment, InventoryItem } from '@/game/types';
import { GEAR_STATS, gearScore, canSalvageEquipment } from '@/game/gearTools';
import { GearShowcase } from './GearShowcase';
import { saveCloudSave, recycleCloudEquipment } from '@/game/cloud';
import { Package, Check, X, ArrowDownUp, Recycle, Trash2, AlertTriangle } from 'lucide-react';

export function InventoryScreen({ initialTab = 'items', userId }: { initialTab?: 'items' | 'equipment'; userId: string }) {
  const { t, language } = useLanguage();
  const state = useStore(useGame);
  const arena = useStore(useArena);
  const [tab, setTab] = useState<'items' | 'equipment'>(initialTab);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [beltNote, setBeltNote] = useState<string | null>(null);
  const [confirmRecycle, setConfirmRecycle] = useState<'discard' | 'salvage' | null>(null);
  const [recycleBusy, setRecycleBusy] = useState(false);
  const [recycleError, setRecycleError] = useState<string | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [remainingToday, setRemainingToday] = useState<number | null>(null);

  const consumables = state.inventory.filter((i) => i.type === 'potion' || i.type === 'elixir' || i.type === 'arena');
  const materials = state.inventory.filter((i) => i.type === 'material');

  const toBelt = (item: InventoryItem) => {
    const next = putInBelt(state, item.id, beltContext(state, arena.wins));
    if (!next) {
      setBeltNote(t('noFreeBeltSlot'));
      return;
    }
    useGame.set(next);
    setSelected(null);
    setBeltNote(null);
  };

  const closeItem = () => {
    if (recycleBusy) return;
    setSelected(null); setBeltNote(null); setConfirmRecycle(null); setRecycleError(null);
  };

  const recycle = async () => {
    if (!selected?.equipment || !confirmRecycle || recycleBusy || reloadRequired) return;
    const itemId = selected.id;
    const action = confirmRecycle;
    const snapshot = useGame.get();
    const current = snapshot.inventory.find((item) => item.id === itemId);
    if (!current || current.type !== 'equipment' || (action === 'salvage' && !canSalvageEquipment(current))) {
      setRecycleError(language === 'en' ? 'The item changed. Reopen inventory.' : 'Предмет изменился. Открой инвентарь заново.');
      return;
    }
    setRecycleBusy(true);
    setRecycleError(null);
    try {
      // Flush all pending changes first; the RPC checks the exact server revision.
      const saved = await saveCloudSave(userId, snapshot);
      if (!saved || useGame.get() !== snapshot) throw new Error('recycle_reload_required');
      const receipt = await recycleCloudEquipment(userId, itemId, action);
      if (useGame.get() !== snapshot) {
        window.location.reload(); // preserve server-authoritative receipt on rare concurrent UI writes
        return;
      }
      useGame.set(receipt.state);
      setRemainingToday(receipt.remainingToday);
      setSelected(null);
      setConfirmRecycle(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const capped = message.includes('recycle_daily_limit_3');
      setRecycleError(capped
        ? (language === 'en' ? 'Daily salvage limit: 3 materials. Come back after 00:00 UTC.' : 'Лимит разбора: 3 материала в сутки. Сброс в 00:00 UTC.')
        : (language === 'en' ? 'Server could not confirm the action. Reload to sync your inventory.' : 'Сервер не подтвердил действие. Обнови игру, чтобы синхронизировать инвентарь.'));
      setReloadRequired(true);
    } finally { setRecycleBusy(false); }
  };

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      {/* Tabs */}
      <div className="flex gap-2">
        <button
          className={`flex-1 btn ${tab === 'items' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('items')}
        >
          <Package className="w-4 h-4 inline mr-1" />{language === 'en' ? 'Items' : 'Предметы'}
        </button>
        <button
          className={`flex-1 btn ${tab === 'equipment' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('equipment')}
        >
          <ArrowDownUp className="w-4 h-4 inline mr-1" /> {language === 'en' ? 'Gear' : 'Экипировка'}
        </button>
      </div>

      {tab === 'items' && (
        <>
          <div className="rounded-2xl border border-amber-500/15 bg-gray-900/70 p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-300">{t('belt')}</h3>
              <span className="text-[11px] text-gray-500">{t('tapSlotToUnequip')}</span>
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
              <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">{t('consumables')}</h3>
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
              <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">{t('materials')}</h3>
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
              <p>{t('inventoryEmpty')}</p>
            </div>
          )}
        </>
      )}

      {tab === 'equipment' && <GearShowcase userId={userId} />}

      {/* Item detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={closeItem}
        >
          <div
            className="card w-full max-w-sm m-2 animate-slide-up max-h-[88dvh] overflow-y-auto overscroll-contain"
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
                  {localizeText(selected.name, language)}
                </h3>
                <p className="text-xs text-gray-400 capitalize">{selected.rarity} · {(language === 'en' ? ({ potion: 'Potion', elixir: 'Elixir', arena: 'Arena item', material: 'Material', equipment: 'Gear' } as Record<string, string>)[selected.type] : ({ potion: 'Зелье', elixir: 'Эликсир', arena: 'Арена', material: 'Материал', equipment: 'Экипировка' } as Record<string, string>)[selected.type])}</p>
              </div>
              <button onClick={closeItem} disabled={recycleBusy} className="text-gray-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-300 mb-3">{localizeText(selected.description, language)}</p>

            {selected.effect && (
              <div className="text-sm text-teal-400 mb-3">
                {language === 'en' ? 'Effect' : 'Эффект'}: +{selected.effect.value} {localizeText(selected.effect.stat, language)}
              </div>
            )}

            {selected.equipment && (
              <GearComparison spare={selected.equipment} worn={state.player.equipped[selected.equipment.slot]} language={language} />
            )}

            {canBelt(selected) && (
              <p className="text-xs text-amber-300/80 mb-3">
                {language === 'en' ? `Use consumables in battle from the belt only: up to ${BELT_STACK} per slot.` : `В бою пьётся только с пояса: до ${BELT_STACK} шт. в одном слоте.`}
              </p>
            )}
            {beltNote && <p className="text-xs text-red-400 mb-3">{beltNote}</p>}

            <div className="flex flex-wrap gap-2">
              {selected.type === 'equipment' && selected.equipment && (
                <button
                  disabled={recycleBusy || reloadRequired}
                  className="btn-primary flex-1"
                  onClick={() => {
                    const currentState = useGame.get();
                    const currentItem = currentState.inventory.find((item) => item.id === selected.id);
                    if (currentItem) useGame.set(equipItem(currentState, currentItem));
                    closeItem();
                  }}
                >
                  <Check className="w-4 h-4 inline mr-1" /> {language === 'en' ? 'Equip' : 'Надеть'}
                </button>
              )}
              {selected.type === 'arena' && (
                <p className="w-full text-xs text-sky-300">{t('arenaOnlyEffect')}</p>
              )}
              {canBelt(selected) && (
                <button className="btn-ghost flex-1 border border-amber-500/30 text-amber-200" onClick={() => toBelt(selected)}>
                  {language === 'en' ? 'To belt' : 'На пояс'}
                </button>
              )}
              <button className="btn-ghost" disabled={recycleBusy} onClick={closeItem}>
                {language === 'en' ? 'Close' : 'Закрыть'}
              </button>
            </div>
            {selected.type === 'equipment' && selected.equipment && (
              <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                <p className="text-xs text-gray-400">
                  {language === 'en'
                    ? 'Recycling only works on spare gear. Equipped items cannot be discarded.'
                    : 'Удалять и разбирать можно только вещи из сумки. Надетое снаряжение защищено.'}
                </p>
                <div className="flex gap-2">
                  {canSalvageEquipment(selected) && (
                    <button className="btn-ghost flex-1 border border-orange-500/40 text-orange-200 text-xs py-2"
                      disabled={recycleBusy || reloadRequired} onClick={() => setConfirmRecycle('salvage')}>
                      <Recycle className="w-4 h-4 inline mr-1" />
                      {language === 'en' ? 'Salvage +1 🔩' : 'Разобрать +1 🔩'}
                    </button>
                  )}
                  <button className="btn-ghost flex-1 border border-red-500/30 text-red-300 text-xs py-2"
                    disabled={recycleBusy || reloadRequired} onClick={() => setConfirmRecycle('discard')}>
                    <Trash2 className="w-4 h-4 inline mr-1" />
                    {language === 'en' ? 'Discard' : 'Удалить'}
                  </button>
                </div>
                {canSalvageEquipment(selected) && (
                  <p className="text-[11px] text-gray-500">
                    {language === 'en'
                      ? `Unforged boss loot only · max 3 materials/UTC day${remainingToday !== null ? ` · ${remainingToday} left` : ''}`
                      : `Только трофеи без улучшений · максимум 3 материала/сутки${remainingToday !== null ? ` · осталось ${remainingToday}` : ''}`}
                  </p>
                )}
                {confirmRecycle && !reloadRequired && (
                  <div className="rounded-xl bg-amber-950/35 border border-amber-500/35 p-3 space-y-2">
                    <p className="text-xs text-amber-200 flex gap-2 items-start">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      {confirmRecycle === 'salvage'
                        ? (language === 'en' ? 'Consume this item permanently and receive 1 forge material?' : 'Навсегда разобрать эту вещь и получить 1 материал кузницы?')
                        : (language === 'en' ? 'Permanently delete this item without a reward? This cannot be undone.' : 'Навсегда удалить эту вещь без награды? Действие нельзя отменить.')}
                    </p>
                    <div className="flex gap-2">
                      <button className="btn-primary flex-1 text-xs" disabled={recycleBusy} onClick={() => void recycle()}>
                        {recycleBusy ? (language === 'en' ? 'Confirming…' : 'Проверяем…') : (language === 'en' ? 'Confirm' : 'Подтвердить')}
                      </button>
                      <button className="btn-ghost text-xs" disabled={recycleBusy} onClick={() => setConfirmRecycle(null)}>
                        {language === 'en' ? 'Cancel' : 'Отмена'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {recycleError && (
              <div className="mt-3 text-xs text-rose-300 border border-rose-500/30 rounded-lg p-2">
                <p>{recycleError}</p>
                {reloadRequired && <button className="btn-primary mt-2 text-xs" onClick={() => window.location.reload()}>
                  {language === 'en' ? 'Reload game' : 'Перезапустить игру'}
                </button>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, onClick, worn }: { item: InventoryItem; onClick: () => void; worn?: Equipment }) {
  const { language } = useLanguage();
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
        {localizeText(item.name, language)}
      </p>
      {item.qty > 1 && (
        <span className="text-xs text-gray-500 mt-0.5">x{item.qty}</span>
      )}
      {item.equipment && (
        <div className="text-[10px] text-gray-400 mt-1 leading-snug">
          {language === 'en' ? 'Level' : 'Ур.'} {item.equipment.level}
          {worn && <p className={gearScore(item.equipment) > gearScore(worn) ? 'text-emerald-400' : 'text-gray-500'}>
            {gearScore(item.equipment) > gearScore(worn)
              ? (language === 'en' ? '↑ Better overall' : '↑ В целом сильнее')
              : (language === 'en' ? 'Compare stats' : 'Сравнить')}
          </p>}
        </div>
      )}
    </button>
  );
}

function GearComparison({ spare, worn, language }: {
  spare: Equipment; worn?: Equipment; language: 'ru' | 'en';
}) {
  const diff = gearScore(spare) - gearScore(worn);
  return (
    <div className="rounded-xl border border-sky-500/25 bg-slate-950/65 p-3 mb-3 space-y-2">
      <div className="flex justify-between items-start gap-3 text-xs">
        <div>
          <p className="text-gray-500">{language === 'en' ? 'Equipped' : 'Надето'}</p>
          <p className="font-semibold text-gray-200">
            {worn ? localizeText(worn.name, language) : (language === 'en' ? 'Empty slot' : 'Пустой слот')}
          </p>
          {worn && <span className="text-gray-500">{language === 'en' ? 'Lv.' : 'Ур.'} {worn.level}</span>}
        </div>
        <div className="text-right">
          <p className="text-gray-500">{language === 'en' ? 'In your bag' : 'В сумке'}</p>
          <p className="font-semibold" style={{ color: rarityColor(spare.rarity) }}>{localizeText(spare.name, language)}</p>
          <span className="text-gray-400">{language === 'en' ? 'Lv.' : 'Ур.'} {spare.level}</span>
        </div>
      </div>
      <div className="space-y-1 border-t border-white/10 pt-2">
        {GEAR_STATS.map(({ key, ru, en, icon }) => {
          const oldVal = worn?.[key] ?? 0;
          const newVal = spare[key] ?? 0;
          const delta = newVal - oldVal;
          return (
            <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2 items-center text-[11px]">
              <span className="text-gray-400 truncate">{icon} {language === 'en' ? en : ru}</span>
              <span className="text-gray-400 tabular-nums">{oldVal}{key === 'critChance' ? '%' : ''}</span>
              <span className="text-gray-600">→</span>
              <span className={`font-semibold tabular-nums text-right min-w-14 ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-gray-200'}`}>
                {newVal}{key === 'critChance' ? '%' : ''} <span className="opacity-80">{delta > 0 ? `(+${delta})` : delta < 0 ? `(${delta})` : ''}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className={`text-xs font-semibold ${!worn || diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-amber-400' : 'text-gray-400'}`}>
        {!worn
          ? (language === 'en' ? 'Empty slot — can equip' : 'Слот пуст — можно надеть')
          : diff > 0 ? (language === 'en' ? 'Higher weighted stats' : 'По сумме характеристик лучше')
          : diff < 0 ? (language === 'en' ? 'Lower weighted stats' : 'По сумме характеристик слабее')
          : (language === 'en' ? 'Same weighted total' : 'Суммарная оценка одинаковая')}
      </p>
      <p className="text-[10px] text-gray-500">{language === 'en'
        ? 'Stats are shown side-by-side. Choose based on your build; critical chance and survivability matter.'
        : 'Показаны реальные бонусы. Выбирай под свой стиль: крит и выживаемость тоже важны.'}</p>
    </div>
  );
}

