import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/game/store';
import { useLanguage, localizeText } from '@/game/i18n';
import { useGame, useArena } from '@/game/actions';
import { BELT_STACK, beltContext, canBelt, putInBelt, takeFromBelt } from '@/game/belt';
import { ItemArt } from './ui/ItemArt';
import { IosGamePortal } from './ui/Modal';
import { BeltCells } from './ui/BeltCells';
import { GearShowcase } from './GearShowcase';
import { FollowersPanel } from './FollowersPanel';
import { rarityColor, rarityGlow } from '@/game/ui';
import { elixirExpiryTime, elixirTimeLeftLabel, forgeMaterialTimeLeftLabel, isPerishableItem } from '@/game/elixirExpiry';
import type { InventoryItem } from '@/game/types';
import { fetchStage8Items, fetchStage8Status, mirrorStage8State } from '@/game/stage8CraftApi';
import { supabase } from '@/game/supabase';
import { recoverStage8ItemAction } from '@/game/stage8ItemApi';
import { Package, X, ArrowDownUp, UsersRound, Hammer, Pickaxe, MapPinned } from 'lucide-react';

/** Equipment, consumables/belt and companions share the inventory route.
 * The follower model is unchanged: training and PvE selection stay in the global store. */
export function InventoryScreen({ initialTab = 'items', userId, onForge, onProfessions, onMap }: {
  initialTab?: 'items' | 'equipment';
  userId: string;
  onForge?: (equipmentId?: string) => void;
  onProfessions?: () => void;
  onMap?: () => void;
}) {
  const { t, language } = useLanguage();
  const state = useStore(useGame);
  const arena = useStore(useArena);
  const [tab, setTab] = useState<'items' | 'equipment' | 'followers'>(initialTab);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [beltNote, setBeltNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inventoryContentRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    let active=true;
    void (async()=>{
      await recoverStage8ItemAction();
      const status=await fetchStage8Status();
      if (!status.enabled) return;
      const owned=await fetchStage8Items();
      const {data:{user:current}}=await supabase.auth.getUser();
      if(active && current?.id===userId) useGame.set(latest=>mirrorStage8State(latest,owned));
    })().catch(()=>{if(active) setBeltNote('Не удалось сверить серверные предметы. Открой инвентарь повторно для восстановления.');});
    return ()=>{active=false;};
  },[userId]);

  useEffect(() => {
    if (tab !== 'items') return;
    const tick = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    const refresh = () => setNow(Date.now());
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [tab]);

  const consumables = state.inventory.filter(item=>item.type!=='material' && isPerishableItem(item))
    .sort((a, b) => elixirExpiryTime(a) - elixirExpiryTime(b));
  const materials = state.inventory.filter((i) => i.type === 'material');
  const earliestOnBelt = state.belt.filter((item): item is InventoryItem => !!item && isPerishableItem(item))
    .sort((a, b) => elixirExpiryTime(a) - elixirExpiryTime(b))[0];

  const switchTab = (to: 'items' | 'equipment' | 'followers') => {
    // The content scrolls independently; the bottom tabs stay within reach.
    inventoryContentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
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
    <div className="flex h-full min-h-0 flex-col gap-2 animate-fade-in">
      {beltNote && <p role="status" className="text-xs text-amber-300">{beltNote}</p>}
      {(onForge || onProfessions || onMap) && <div className="grid shrink-0 grid-cols-3 gap-1.5" aria-label={language === 'en' ? 'Workshop navigation' : 'Мастерская'}>
        {onForge && <button type="button" onClick={() => onForge()} className="min-h-9 rounded-lg border border-orange-400/30 bg-orange-500/15 px-1 text-[11px] font-bold text-orange-100"><Hammer className="mr-1 inline h-3.5 w-3.5"/>{language === 'en' ? 'Forge' : 'Кузница'}</button>}
        {onProfessions && <button type="button" onClick={onProfessions} className="min-h-9 rounded-lg border border-amber-400/30 bg-amber-500/15 px-1 text-[11px] font-bold text-amber-100"><Pickaxe className="mr-1 inline h-3.5 w-3.5"/>{language === 'en' ? 'Craft' : 'Профессии'}</button>}
        {onMap && <button type="button" onClick={onMap} className="min-h-9 rounded-lg border border-sky-400/30 bg-sky-500/15 px-1 text-[11px] font-bold text-sky-100"><MapPinned className="mr-1 inline h-3.5 w-3.5"/>{language === 'en' ? 'Gather' : 'Добыча'}</button>}
      </div>}
      <div ref={inventoryContentRef} id="inventory-current-section" role="tabpanel" className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide pb-2">
      {tab === 'equipment' ? (
        <div data-testid="equipment-responsive-layout" className="flex min-h-full w-full min-w-0 flex-col">
          {/* Center short inventories on tall phones; auto margins collapse for long inventories. */}
          <div className="my-auto w-full min-w-0 pt-3 pb-4">
            <GearShowcase userId={userId} onForge={onForge}/>
          </div>
        </div>
      ) : tab === 'items' ? (
        <>
          {consumables.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">{t('consumables')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {consumables.map((item) => <ItemCard key={item.id} item={item} now={now} onClick={() => setSelected(item)}/>)}
              </div>
            </div>
          )}
          {(materials.length > 0 || state.forgeMaterials > 0) && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-2 px-1">{t('materials')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {materials.map((item) => <ItemCard key={item.id} item={item} now={now} onClick={() => setSelected(item)}/>)}
                {state.forgeMaterials > 0 && (
                  <div className="card flex flex-col items-center p-3 border border-amber-500/30" aria-label={language === 'en' ? 'Forge materials' : 'Материалы кузницы'}>
                    <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-lg bg-black/30 shadow-[0_0_12px_rgba(245,158,11,0.18)]">
                      <img src={import.meta.env.BASE_URL + 'forge-material.webp'} alt="" className="h-12 w-12 object-contain drop-shadow-[0_3px_4px_rgba(0,0,0,0.7)]" loading="lazy" draggable={false} />
                    </div>
                    <p className="w-full truncate text-center text-xs font-medium text-amber-200">{language === 'en' ? 'Forge materials' : 'Материалы кузницы'}</p>
                    <span className="mt-0.5 text-xs text-gray-500">x{state.forgeMaterials}</span>
                    <span className="mt-1 text-[10px] leading-tight text-amber-300">⏳ {forgeMaterialTimeLeftLabel(state, language, now)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
          {consumables.length === 0 && materials.length === 0 && state.forgeMaterials === 0 && (
            <div className="card text-center py-8 text-gray-500">
              <Package className="w-12 h-12 mx-auto mb-2 opacity-30"/>
              <p>{t('inventoryEmpty')}</p>
            </div>
          )}
        </>
      ) : (
        <FollowersPanel />
      )}
      </div>

      {/* Keep the consumable belt visible and reachable while items are scrolled. */}
      {tab === 'items' && (
        <section
          data-testid="inventory-pinned-belt"
          aria-label={t('belt')}
          className="shrink-0 rounded-2xl border border-amber-500/30 bg-[#171c29]/95 px-2.5 py-2 shadow-[0_-4px_18px_rgba(0,0,0,0.4)]"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-amber-100">{t('belt')}</h3>
              {earliestOnBelt && <span className="text-[10px] font-semibold text-amber-300 tabular-nums">⏳ {elixirTimeLeftLabel(earliestOnBelt, language, now)}</span>}
            </div>
            <span className="text-right text-[10px] leading-tight text-gray-400">{t('tapSlotToUnequip')}</span>
          </div>
          <BeltCells
            belt={state.belt}
            ctx={beltContext(state, arena.wins)}
            onTap={(i, open) => open && useGame.set((current) => takeFromBelt(current, i))}
          />
        </section>
      )}

      {/* Always visible directly above the game's main navigation. */}
      <div className="z-20 grid shrink-0 grid-cols-3 gap-1.5 rounded-2xl border border-violet-500/40 bg-[#170f25] p-1.5 shadow-[0_-4px_18px_rgba(0,0,0,0.45)]"
        role="tablist" aria-label={language === 'en' ? 'Inventory sections' : 'Разделы инвентаря'}>
        <button type="button" role="tab" aria-selected={tab === 'equipment'} aria-controls="inventory-current-section"
          className={'flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg px-1 py-1 text-[10px] font-bold leading-tight transition-colors sm:text-xs ' + (tab === 'equipment'
            ? 'border border-amber-400/60 bg-gradient-to-b from-amber-500/30 to-amber-900/30 text-amber-100 shadow-[0_0_10px_rgba(245,158,11,.15)]'
            : 'border border-transparent text-violet-200/75')}
          onClick={() => switchTab('equipment')}>
          <ArrowDownUp className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />{language === 'en' ? 'Equipment' : 'Снаряжение'}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'items'} aria-controls="inventory-current-section"
          className={'flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg px-1 py-1 text-[10px] font-bold leading-tight transition-colors sm:text-xs ' + (tab === 'items'
            ? 'border border-amber-400/60 bg-gradient-to-b from-amber-500/30 to-amber-900/30 text-amber-100 shadow-[0_0_10px_rgba(245,158,11,.15)]'
            : 'border border-transparent text-violet-200/75')}
          onClick={() => switchTab('items')}>
          <Package className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />{language === 'en' ? 'Items' : 'Предметы'}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'followers'} aria-controls="inventory-current-section"
          className={'flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg px-1 py-1 text-[10px] font-bold leading-tight transition-colors sm:text-xs ' + (tab === 'followers'
            ? 'border border-amber-400/60 bg-gradient-to-b from-amber-500/30 to-amber-900/30 text-amber-100 shadow-[0_0_10px_rgba(245,158,11,.15)]'
            : 'border border-transparent text-violet-200/75')}
          onClick={() => switchTab('followers')}>
          <UsersRound className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />{language === 'en' ? 'Companions' : 'Спутники'}
        </button>
      </div>

      {tab === 'items' && selected && (
        <IosGamePortal>
        <div className="inventory-item-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
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
            {isPerishableItem(selected) && (
              <p className={`mb-3 text-xs font-semibold ${elixirExpiryTime(selected) - now < 24 * 60 * 60 * 1000 ? 'text-red-300' : 'text-amber-300'}`}>
                ⏳ {language === 'en' ? 'Shelf life' : 'Срок годности'}: {elixirTimeLeftLabel(selected, language, now)}
                <span className="block pt-1 font-normal text-gray-400">{language === 'en'
                  ? '7 days from receipt. The earliest expiry goes on the belt first.'
                  : '7 суток с получения. На пояс сначала идёт самый ранний срок.'}</span>
              </p>
            )}
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
        </IosGamePortal>
      )}
    </div>
  );
}

function ItemCard({ item, now, onClick }: { item: InventoryItem; now: number; onClick: () => void }) {
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
      {isPerishableItem(item) && <span className={`mt-1 text-[10px] leading-tight ${elixirExpiryTime(item) - now <= 24 * 60 * 60 * 1000 ? 'text-red-300' : 'text-amber-300'}`}>
        ⏳ {elixirTimeLeftLabel(item, language, now)}
      </span>}
    </button>
  );
}
