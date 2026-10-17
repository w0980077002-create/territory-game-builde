import { useState } from 'react';
import { useStore } from '@/game/store';
import { useLanguage, localizeText } from '@/game/i18n';
import { useGame, useArena } from '@/game/actions';
import { BELT_STACK, beltContext, canBelt, putInBelt, takeFromBelt } from '@/game/belt';
import { ItemArt } from './ui/ItemArt';
import { BeltCells } from './ui/BeltCells';
import { GearShowcase } from './GearShowcase';
import { rarityColor, rarityGlow } from '@/game/ui';
import type { InventoryItem } from '@/game/types';
import { Package, X, ArrowDownUp } from 'lucide-react';

/** Two tabs share the existing inventory. Equipment uses the hero stage;
 * consumables keep their battle belt and original use flow unchanged. */
export function InventoryScreen({ initialTab = 'items', userId }: {
  initialTab?: 'items' | 'equipment';
  userId: string;
}) {
  const { t, language } = useLanguage();
  const state = useStore(useGame);
  const arena = useStore(useArena);
  const [tab, setTab] = useState<'items' | 'equipment'>(initialTab);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [beltNote, setBeltNote] = useState<string | null>(null);

  const consumables = state.inventory.filter((i) => i.type === 'potion' || i.type === 'elixir' || i.type === 'arena');
  const materials = state.inventory.filter((i) => i.type === 'material');

  const switchTab = (to: 'items' | 'equipment') => {
    setTab(to);
    setSelected(null);
    setBeltNote(null);
  };
  const toBelt = (item: InventoryItem) => {
    const latest = useGame.get();
    const next = putInBelt(latest, item.id, beltContext(latest, useArena.get().wins));
    if (!next) {
      setBeltNote(t('noFreeBeltSlot'));
      return;
    }
    useGame.set(next);
    setSelected(null);
    setBeltNote(null);
  };
  const close = () => { setSelected(null); setBeltNote(null); };

  return (
    <div className="space-y-2 animate-fade-in pb-2">
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-violet-500/30 bg-[#170f25] p-1.5">
        <button type="button" aria-pressed={tab === 'equipment'}
          className={'rounded-lg py-2 text-xs font-bold transition-all ' + (tab === 'equipment'
            ? 'border border-amber-400/60 bg-gradient-to-b from-amber-500/30 to-amber-900/30 text-amber-100 shadow-[0_0_10px_rgba(245,158,11,.15)]'
            : 'border border-transparent text-violet-200/70')}
          onClick={() => switchTab('equipment')}>
          <ArrowDownUp className="w-4 h-4 inline mr-1"/>{language === 'en' ? 'Equipment' : 'Снаряжение'}
        </button>
        <button type="button" aria-pressed={tab === 'items'}
          className={'rounded-lg py-2 text-xs font-bold transition-all ' + (tab === 'items'
            ? 'border border-amber-400/60 bg-gradient-to-b from-amber-500/30 to-amber-900/30 text-amber-100 shadow-[0_0_10px_rgba(245,158,11,.15)]'
            : 'border border-transparent text-violet-200/70')}
          onClick={() => switchTab('items')}>
          <Package className="w-4 h-4 inline mr-1"/>{language === 'en' ? 'Items / Belt' : 'Предметы / пояс'}
        </button>
      </div>

      {tab === 'equipment' ? (
        <GearShowcase userId={userId}/>
      ) : (
        <>
          <div className="rounded-2xl border border-amber-500/15 bg-gray-900/70 p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-300">{t('belt')}</h3>
              <span className="text-[11px] text-gray-500">{t('tapSlotToUnequip')}</span>
            </div>
            <BeltCells
              belt={state.belt}
              ctx={beltContext(state, arena.wins)}
              onTap={(i, open) => open && useGame.set((current) => takeFromBelt(current, i))}
            />
          </div>
          {consumables.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">{t('consumables')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {consumables.map((item) => <ItemCard key={item.id} item={item} onClick={() => setSelected(item)}/>)}
              </div>
            </div>
          )}
          {materials.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">{t('materials')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {materials.map((item) => <ItemCard key={item.id} item={item} onClick={() => setSelected(item)}/>)}
              </div>
            </div>
          )}
          {consumables.length === 0 && materials.length === 0 && (
            <div className="card text-center py-8 text-gray-500">
              <Package className="w-12 h-12 mx-auto mb-2 opacity-30"/>
              <p>{t('inventoryEmpty')}</p>
            </div>
          )}
        </>
      )}

      {tab === 'items' && selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={close}>
          <div className="card w-full max-w-sm m-2 animate-slide-up max-h-[88dvh] overflow-y-auto overscroll-contain"
            style={{ border: '1px solid ' + rarityColor(selected.rarity), boxShadow: rarityGlow(selected.rarity) }}
            onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3 mb-3">
              <div className="w-16 h-16 rounded-xl bg-black/30 flex items-center justify-center shrink-0"
                style={{ border: '1px solid ' + rarityColor(selected.rarity) }}>
                <ItemArt item={selected} size={52}/>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-base" style={{ color: rarityColor(selected.rarity) }}>
                  {localizeText(selected.name, language)}
                </h3>
                <p className="text-xs text-gray-400 capitalize">{selected.rarity}</p>
              </div>
              <button type="button" aria-label={language === 'en' ? 'Close' : 'Закрыть'}
                onClick={close} className="text-gray-500 hover:text-white"><X className="w-5 h-5"/></button>
            </div>
            <p className="text-sm text-gray-300 mb-3">{localizeText(selected.description, language)}</p>
            {selected.effect && (
              <div className="text-sm text-teal-400 mb-3">
                {language === 'en' ? 'Effect' : 'Эффект'}: +{selected.effect.value} {localizeText(selected.effect.stat, language)}
              </div>
            )}
            {canBelt(selected) && (
              <p className="text-xs text-amber-300/80 mb-3">
                {language === 'en'
                  ? 'Use consumables in battle from the belt only: up to ' + BELT_STACK + ' per slot.'
                  : 'В бою пьётся только с пояса: до ' + BELT_STACK + ' шт. в одном слоте.'}
              </p>
            )}
            {beltNote && <p className="text-xs text-red-400 mb-3">{beltNote}</p>}
            {selected.type === 'arena' && <p className="w-full text-xs text-sky-300 mb-2">{t('arenaOnlyEffect')}</p>}
            <div className="flex flex-wrap gap-2">
              {canBelt(selected) && (
                <button className="btn-ghost flex-1 border border-amber-500/30 text-amber-200" onClick={() => toBelt(selected)}>
                  {language === 'en' ? 'To belt' : 'На пояс'}
                </button>
              )}
              <button className="btn-ghost flex-1" onClick={close}>{language === 'en' ? 'Close' : 'Закрыть'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, onClick }: { item: InventoryItem; onClick: () => void }) {
  const { language } = useLanguage();
  const color = rarityColor(item.rarity);
  return (
    <button type="button"
      className="card flex flex-col items-center p-3 transition-all active:scale-95 hover:border-teal-500/30"
      style={{ border: '1px solid ' + color + '40' }} onClick={onClick}>
      <div className="w-14 h-14 rounded-lg bg-black/30 flex items-center justify-center mb-1"
        style={{ boxShadow: rarityGlow(item.rarity) }}>
        <ItemArt item={item} size={48}/>
      </div>
      <p className="text-xs font-medium text-center truncate w-full" style={{ color }}>
        {localizeText(item.name, language)}
      </p>
      {item.qty > 1 && <span className="text-xs text-gray-500 mt-0.5">x{item.qty}</span>}
    </button>
  );
}
