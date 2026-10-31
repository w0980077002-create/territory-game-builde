import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/game/store';
import { useLanguage, localizeText } from '@/game/i18n';
import { useGame, useArena } from '@/game/actions';
import { BELT_RULES, BELT_STACK, beltContext, canBelt, isSlotOpen, putInBelt, takeFromBelt } from '@/game/belt';
import { ItemArt } from './ui/ItemArt';
import { Modal } from './ui/Modal';
import { BeltCells } from './ui/BeltCells';
import { GearShowcase } from './GearShowcase';
import { FollowersPanel } from './FollowersPanel';
import './followersCamp.css'; // Shared pinned companion journey styles, including offline mobile preview.
import { FOLLOWER_TEMPLATES, selectedFollower } from '@/game/followers';
import { getFollowerArt } from '@/game/combatArt';
import { AWAKENING_STONE_ITEM, cowStonesOwned } from '@/game/followers';
import { CompactWarehouse } from './CompactWarehouse';
import { rarityColor } from '@/game/ui';
import { EQUIPMENT_SLOTS, generateChapter } from '@/game/engine';
import { elixirExpiryTime, elixirTimeLeftLabel, isElixirExpired, isPerishableItem } from '@/game/elixirExpiry';
import type { InventoryItem } from '@/game/types';
import { Package, ArrowDownUp, UsersRound, Hammer, Pickaxe, MapPinned, ChevronRight, ShieldCheck, Swords } from 'lucide-react';
import './inventoryPreparation.css';

/** Equipment, consumables/belt and companions share the inventory route.
 * The follower model is unchanged: training and PvE selection stay in the global store. */
export function InventoryScreen({ initialTab = 'items', userId, onForge, onProfessions, onMap, onBattle, onArena, onHero }: {
  initialTab?: 'items' | 'equipment' | 'followers';
  userId: string;
  onForge?: (equipmentId?: string) => void;
  onProfessions?: () => void;
  onMap?: () => void;
  onBattle?: () => void;
  onArena?: () => void;
  onHero?: () => void;
}) {
  const { t, language } = useLanguage();
  const state = useStore(useGame);
  const arena = useStore(useArena);
  const [tab, setTab] = useState<'items' | 'equipment' | 'followers'>(initialTab);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [beltNote, setBeltNote] = useState<string | null>(null);
  const [preparedNotice, setPreparedNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const inventoryContentRef = useRef<HTMLDivElement>(null);
  const chapterNumber = Math.max(1, Math.floor(state.currentChapter || 1));
  const chapter = generateChapter(chapterNumber);
  const chapterWins = Math.max(0, Math.min(chapter.winsNeeded, state.chapterWins || 0));
  const equippedCount = EQUIPMENT_SLOTS.filter(({ id }) => !!state.player.equipped[id]).length;
  const activeCompanion = selectedFollower(state);
  const activeCompanionTemplate = FOLLOWER_TEMPLATES.find(unit => unit.id === activeCompanion?.id);

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

  // Keep inventory sorting stable while the visible expiry clock updates.
  const consumables = useMemo(() => state.inventory.filter(isPerishableItem)
    .sort((a, b) => elixirExpiryTime(a) - elixirExpiryTime(b)), [state.inventory]);
  const materials = useMemo(() => [
    ...state.inventory.filter(item => item.type === 'material' && item.id !== AWAKENING_STONE_ITEM.id),
    { ...AWAKENING_STONE_ITEM, qty: cowStonesOwned(state) },
  ], [state.inventory]);
  const earliestOnBelt = useMemo(() => state.belt.filter((item): item is InventoryItem => !!item && isPerishableItem(item))
    .sort((a, b) => elixirExpiryTime(a) - elixirExpiryTime(b))[0], [state.belt]);
  // Read-only preparation; existing belt inventory and Arena win gates are authoritative.
  const beltCtx = beltContext(state, arena.wins);
  const openBeltSlots = BELT_RULES.filter((_, i) => isSlotOpen(i, beltCtx)).length;
  const beltReady = state.belt.reduce((n, item, i) => n + (item && isSlotOpen(i, beltCtx) && !isElixirExpired(item, now) ? item.qty : 0), 0);
  const spareConsumables = consumables.reduce((n, item) => n + (!isElixirExpired(item, now) ? Math.max(0, item.qty) : 0), 0);

  const switchTab = (to: 'items' | 'equipment' | 'followers') => {
    // The content scrolls independently; the bottom tabs stay within reach.
    inventoryContentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    setTab(to);
    setSelected(null);
    setBeltNote(null);
    setPreparedNotice('');
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
    setPreparedNotice(language === 'en' ? 'Consumable moved to your battle belt.' : 'Расходник перемещён на боевой пояс.');
  };
  const close = () => { setSelected(null); setBeltNote(null); };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 animate-fade-in">
      {(onForge || onProfessions || onMap) && <div className="grid shrink-0 grid-cols-3 gap-1.5" aria-label={language === 'en' ? 'Workshop navigation' : 'Мастерская'}>
        {onForge && <button type="button" onClick={() => onForge()} className="min-h-9 rounded-lg border border-orange-400/30 bg-orange-500/15 px-1 text-[11px] font-bold text-orange-100"><Hammer className="mr-1 inline h-3.5 w-3.5"/>{language === 'en' ? 'Forge' : 'Кузница'}</button>}
        {onProfessions && <button type="button" onClick={onProfessions} className="min-h-9 rounded-lg border border-amber-400/30 bg-amber-500/15 px-1 text-[11px] font-bold text-amber-100"><Pickaxe className="mr-1 inline h-3.5 w-3.5"/>{language === 'en' ? 'Craft' : 'Профессии'}</button>}
        {onMap && <button type="button" onClick={onMap} className="min-h-9 rounded-lg border border-sky-400/30 bg-sky-500/15 px-1 text-[11px] font-bold text-sky-100"><MapPinned className="mr-1 inline h-3.5 w-3.5"/>{language === 'en' ? 'Gather' : 'Добыча'}</button>}
      </div>}
      <div ref={inventoryContentRef} id="inventory-current-section" role="tabpanel" className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide pb-2">
      {tab === 'equipment' ? (
        <div data-testid="equipment-responsive-layout" className="flex min-h-full w-full min-w-0 flex-col">
          {onBattle && <section data-testid="equipment-campaign-return" className="mb-1 flex min-w-0 items-center gap-2 rounded-xl border-2 border-amber-500/70 bg-gradient-to-r from-[#59361e] to-[#261b16] p-2 text-amber-100 shadow-lg">
            <img className="h-16 w-16 shrink-0 object-contain" loading="lazy" draggable={false} alt=""
              src={import.meta.env.BASE_URL + (chapter.boss.art.startsWith('/') ? chapter.boss.art.slice(1) : chapter.boss.art)} />
            <div className="min-w-0 flex-1">
              <strong className="block text-xs font-black leading-tight">{language === 'en' ? 'Ready for the next encounter?' : 'Готов к следующему бою?'}</strong>
              <span className="block text-[11px] leading-tight text-amber-200">{language === 'en' ? 'Chapter' : 'Глава'} {chapterNumber} · {chapterWins}/{chapter.winsNeeded}</span>
              <span className="block text-[10px] text-amber-300">{language === 'en' ? 'Equipped slots' : 'Надето вещей'}: {equippedCount}/7</span>
              <button type="button" onClick={onBattle} className="mt-1 flex min-h-10 w-full items-center justify-center gap-1 rounded-lg border border-amber-200 bg-gradient-to-b from-[#ffe3a1] to-[#bb762c] px-2 text-xs font-black text-[#281508]">
                {language === 'en' ? 'Open adventure' : 'Открыть поход'} <ChevronRight size={16} aria-hidden="true"/>
              </button>
            </div>
          </section>}
          {/* Center short inventories on tall phones; auto margins collapse for long inventories. */}
          <div className="my-auto w-full min-w-0 pt-3 pb-4">
            <GearShowcase userId={userId} onForge={onForge}/>
          </div>
        </div>
      ) : tab === 'items' ? (
        <div className="inventory-preparation-content">
          <section className="inventory-preparation" data-testid="inventory-battle-preparation" aria-label={language === 'en' ? 'Prepare for battle' : 'Подготовка к бою'}>
            <img className="inventory-preparation__art" src={import.meta.env.BASE_URL + 'assets/territory/ui/items/belt.webp'} alt="" loading="lazy" draggable={false}/>
            <div className="inventory-preparation__summary">
              <strong>{language === 'en' ? 'READY FOR BATTLE' : 'ГОТОВ К БОЮ'}</strong>
              <span>{language === 'en' ? 'Belt items' : 'На поясе'}: <b>{beltReady}</b> · {language === 'en' ? 'Open slots' : 'Открыто ячеек'}: <b>{openBeltSlots}/7</b></span>
              <small>{beltReady
                ? (language === 'en' ? 'Your consumables are ready. Choose when to use them in battle.' : 'Расходники готовы. В бою сам выбирай, когда их применять.')
                : spareConsumables
                  ? (language === 'en' ? 'Tap a potion in the warehouse to equip it on the belt.' : 'Нажми на зелье в складе и перенеси его на пояс.')
                  : (language === 'en' ? 'Your belt is empty. You can still fight without potions.' : 'Пояс пуст. Можно сражаться и без зелий.')}</small>
            </div>
            <div className="inventory-preparation__actions">
              {onArena && <button type="button" onClick={onArena} className="inventory-preparation__arena"><Swords size={17}/>{language === 'en' ? 'Arena lobby' : 'На Арену'}<ChevronRight size={15}/></button>}
              {onBattle && <button type="button" onClick={onBattle} className="inventory-preparation__campaign"><ShieldCheck size={17}/>{language === 'en' ? 'Campaign' : 'В Поход'}<ChevronRight size={15}/></button>}
            </div>
            {preparedNotice && <p className="inventory-preparation__notice" role="status">{preparedNotice}</p>}
          </section>
          <CompactWarehouse
            consumables={consumables}
            materials={materials}
            forgeMaterials={state.forgeMaterials}
            forgeMaterialBatches={state.forgeMaterialBatches}
            now={now}
            language={language}
            onItemSelect={setSelected}
            onForge={onForge}
          />
        </div>
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
              <h3 className="text-sm font-bold text-amber-100">{t('belt')} <span data-testid="inventory-belt-status" className="text-xs text-amber-300">· {beltReady} / {openBeltSlots * BELT_STACK}</span></h3>
              {earliestOnBelt && <span className="text-[10px] font-semibold text-amber-300 tabular-nums">⏳ {elixirTimeLeftLabel(earliestOnBelt, language, now)}</span>}
            </div>
            <span className="text-right text-[10px] leading-tight text-gray-400">{t('tapSlotToUnequip')}</span>
          </div>
          <BeltCells
            belt={state.belt}
            ctx={beltCtx}
            onTap={(i, open) => {
              if (!open) return;
              let removed = false;
              useGame.set((current) => {
                if (!current.belt[i]) return current;
                removed = true;
                return takeFromBelt(current, i);
              });
              if (removed) setPreparedNotice(language === 'en' ? 'Consumable returned to the warehouse.' : 'Расходник возвращён на склад.');
            }}
          />
        </section>
      )}

      {tab === 'followers' && (onHero || onBattle) && (
        <section className="companion-journey-bar" data-testid="companion-journey-actions"
          aria-label={language === 'en' ? 'Companion battle journey' : 'Боевой путь со спутником'}>
          <div className="companion-journey-bar__status">
            <img src={activeCompanion ? getFollowerArt(activeCompanion.id)
              : import.meta.env.BASE_URL + 'assets/territory/map/icons/companions-v1.webp'}
              alt="" loading="lazy" draggable={false}/>
            <div>
              <strong>{activeCompanion
                ? (language === 'en' ? (activeCompanionTemplate?.nameEn ?? activeCompanion.name) : activeCompanion.name)
                : (language === 'en' ? 'Companion not unlocked' : 'Спутник ещё не открыт')}</strong>
              <span>{activeCompanion
                ? `${language === 'en' ? 'Level' : 'Уровень'} ${activeCompanion.level} · PvE`
                : (language === 'en' ? 'Unlocks from hero level 3' : 'Открывается с 3 уровня героя')}</span>
            </div>
          </div>
          <div className="companion-journey-bar__buttons">
            {onHero && <button type="button" onClick={onHero}>
              {language === 'en' ? 'Hero' : 'Герой'}
            </button>}
            {onBattle && <button type="button" onClick={onBattle} className="companion-journey-bar__battle">
              {language === 'en' ? 'Open Campaign' : 'Открыть Поход'} <ChevronRight size={15} aria-hidden="true"/>
            </button>}
          </div>
        </section>
      )}

      {/* Always visible directly above the game's main navigation. */}
      <div className="z-20 grid shrink-0 grid-cols-3 gap-1.5 rounded-2xl border border-amber-700/60 bg-[#2d1a11] p-1.5 shadow-[0_-4px_18px_rgba(0,0,0,0.45)]"
        role="tablist" aria-label={language === 'en' ? 'Inventory sections' : 'Разделы инвентаря'}>
        <button type="button" role="tab" aria-selected={tab === 'equipment'} aria-controls="inventory-current-section"
          className="viking-tab flex items-center justify-center gap-1 px-1 py-1 text-[11px] leading-tight transition-colors sm:text-xs"
          onClick={() => switchTab('equipment')}>
          <ArrowDownUp className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />{language === 'en' ? 'Equipment' : 'Снаряжение'}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'items'} aria-controls="inventory-current-section"
          className="viking-tab flex items-center justify-center gap-1 px-1 py-1 text-[11px] leading-tight transition-colors sm:text-xs"
          onClick={() => switchTab('items')}>
          <Package className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />{language === 'en' ? 'Items' : 'Предметы'}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'followers'} aria-controls="inventory-current-section"
          className="viking-tab flex items-center justify-center gap-1 px-1 py-1 text-[11px] leading-tight transition-colors sm:text-xs"
          onClick={() => switchTab('followers')}>
          <UsersRound className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />{language === 'en' ? 'Companions' : 'Спутники'}
        </button>
      </div>

      {tab === 'items' && selected && (
        <Modal title={localizeText(selected.name, language)} onClose={close}>
          <div className="inventory-item-detail">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-16 h-16 rounded-xl bg-black/30 flex items-center justify-center shrink-0"
                style={{ border: '1px solid ' + rarityColor(selected.rarity) }}>
                <ItemArt item={selected} size={52}/>
              </div>
              <p className="text-sm capitalize" style={{ color: rarityColor(selected.rarity) }}>{selected.rarity}</p>
            </div>
            <p className="text-sm text-gray-300 mb-3">{selected.id === AWAKENING_STONE_ITEM.id
              ? (language === 'en'
                ? 'A rare material for the Battle Cow. Its source is not yet confirmed.'
                : 'Редкий материал для Боевой коровы. Источник пока не подтверждён.')
              : localizeText(selected.description, language)}</p>
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
        </Modal>
      )}
    </div>
  );
}

