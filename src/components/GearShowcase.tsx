import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useStore } from '@/game/store';
import { useGame, equipItem, unequipItem } from '@/game/actions';
import { captureGameEvent } from '@/game/analytics';
import { useLanguage, localizeText } from '@/game/i18n';
import { getAppearanceIcon } from '@/game/appearance';
import { EQUIPMENT_SLOTS } from '@/game/engine';
import { equipmentArt, SLOT_ART } from '@/game/art';
import { rarityColor } from '@/game/ui';
import { GEAR_STATS, gearScore, canSalvageEquipment } from '@/game/gearTools';
import { readForgeRefundQuote, readGearBatchQuote, recycleCloudEquipment, recycleCloudEquipmentBatch, saveCloudSave, type GearBatchQuote } from '@/game/cloud';
import { ItemArt } from './ui/ItemArt';
import { VipEquipmentPresets } from './VipEquipmentPresets';
import type { Equipment, InventoryItem } from '@/game/types';
import { Check, ChevronDown, ChevronUp, Hammer, Info, Layers3, Recycle, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import './GearShowcase.css';

type Slot = Equipment['slot'];
type Selection = { kind: 'worn'; slot: Slot } | { kind: 'bag'; id: string };
type Disposal = 'salvage' | 'discard';
type Sort = 'level' | 'rarity' | 'recent';

const slotNames: Record<Slot, { ru: string; en: string }> = {
  helmet: { ru: 'Шлем', en: 'Helmet' },
  amulet: { ru: 'Амулет', en: 'Amulet' },
  armor: { ru: 'Броня', en: 'Armor' },
  weapon: { ru: 'Оружие', en: 'Weapon' },
  shield: { ru: 'Щит', en: 'Shield' },
  ring: { ru: 'Кольцо', en: 'Ring' },
  boots: { ru: 'Сапоги', en: 'Boots' },
};
const filters: (Slot | 'all')[] = ['all', 'weapon', 'shield', 'armor', 'helmet', 'amulet', 'ring', 'boots'];
const slotPositions: Record<Slot, string> = {
  helmet: 'gear-slot-helmet',
  amulet: 'gear-slot-amulet',
  armor: 'gear-slot-armor',
  weapon: 'gear-slot-weapon',
  shield: 'gear-slot-shield',
  ring: 'gear-slot-ring',
  boots: 'gear-slot-boots',
};
const rarityRank = { common: 0, rare: 1, epic: 2, legendary: 3 };
const rarityLabel = {
  common: { ru: 'Обычный', en: 'Common' },
  rare: { ru: 'Редкий', en: 'Rare' },
  epic: { ru: 'Эпический', en: 'Epic' },
  legendary: { ru: 'Легендарный', en: 'Legendary' },
};

/** A visual signature, never an inventory identity. Every underlying ID stays distinct. */
function equipmentVisualKey(item: InventoryItem): string {
  const eq = item.equipment!;
  return JSON.stringify([
    item.name, item.icon, item.rarity, eq.slot, eq.name, eq.icon, eq.rarity,
    eq.level, eq.attack ?? null, eq.defense ?? null, eq.hp ?? null,
    eq.critChance ?? null, eq.baseLevel ?? null, eq.upgradeCount ?? null,
    eq.baseStats?.attack ?? null, eq.baseStats?.defense ?? null,
    eq.baseStats?.hp ?? null, eq.baseStats?.critChance ?? null,
    eq.adminTestLevel ?? null,
  ]);
}

const eqToItem = (eq: Equipment): InventoryItem => ({
  id: eq.id, type: 'equipment', name: eq.name, icon: eq.icon, rarity: eq.rarity,
  qty: 1, description: '', equipment: eq,
});

function GearPortrait({ equipped, candidate, label, language, isCandidate }: {
  equipped?: Equipment;
  candidate?: Equipment;
  label: string;
  language: 'ru' | 'en';
  isCandidate?: boolean;
}) {
  const eq = isCandidate ? candidate : equipped;
  return (
    <section className={'gear-compare-side ' + (isCandidate ? 'gear-compare-target' : 'gear-compare-worn')}>
      <span className="gear-compare-banner">{label}</span>
      {eq ? (
        <>
          <div className="gear-compare-item">
            <span className="gear-compare-art" style={{ borderColor: rarityColor(eq.rarity) }}>
              <ItemArt item={eqToItem(eq)} size={42} />
            </span>
            <div className="gear-compare-name-wrap">
              <p className="gear-compare-name">{localizeText(eq.name, language)}</p>
              <p className="gear-compare-rarity" style={{ color: rarityColor(eq.rarity) }}>
                {rarityLabel[eq.rarity][language]}
              </p>
              <p className="gear-compare-level">{language === 'en' ? 'Lv.' : 'Ур.'} {eq.level}</p>
            </div>
          </div>
          <div className="gear-simple-stats">
            {GEAR_STATS.map((s) => {
              const value = eq[s.key] ?? 0;
              const delta = value - (equipped?.[s.key] ?? 0);
              return (
                <div key={s.key}>
                  <span>{language === 'en' ? s.en : s.ru}</span>
                  <strong>{value}{s.key === 'critChance' ? '%' : ''}</strong>
                  {isCandidate && <em className={'gear-card-delta ' + (delta > 0 ? 'gear-positive' : delta < 0 ? 'gear-negative' : '')}>
                    {delta > 0 ? '▲+' + delta : delta < 0 ? '▼' + delta : '—'}
                    {s.key === 'critChance' && delta !== 0 ? '%' : ''}
                  </em>}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="gear-empty-compare">
          <ShieldCheck size={27} />
          <span>{language === 'en' ? 'Empty slot' : 'Слот пуст'}</span>
        </div>
      )}
    </section>
  );
}

/** The actual equipment stage uses the player's selected hero art and current slots.
 * This does not fake visually equipped armor onto the existing hero sprite. */
export function GearShowcase({ userId, onForge }: { userId: string; onForge?: (equipmentId: string) => void }) {
  const { language } = useLanguage();
  const state = useStore(useGame);
  const [filter, setFilter] = useState<Slot | 'all'>('all');
  const [sort, setSort] = useState<Sort>('level');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [confirm, setConfirm] = useState<Disposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mustReload, setMustReload] = useState(false);
  const [remainingToday, setRemainingToday] = useState<number | null>(null);
  const [refundQuote, setRefundQuote] = useState<{ itemId: string; spent: number; refund: number } | null>(null);
  const [batchOffer, setBatchOffer] = useState<GearBatchQuote | null>(null);
  const [batchSelected, setBatchSelected] = useState<string[]>([]);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [heroExpanded, setHeroExpanded] = useState(false);
  const [stackSimilar, setStackSimilar] = useState(true);
  const [expandedStacks, setExpandedStacks] = useState<string[]>([]);
  const compareRef = useRef<HTMLElement | null>(null);

  // A spare item should reveal its comparison immediately without a large scroll.
  useEffect(() => {
    if (selection?.kind !== 'bag') return;
    const frame = window.requestAnimationFrame(() => {
      compareRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selection]);

  const equipment = state.inventory.filter((item) => item.type === 'equipment' && !!item.equipment);
  const displayed = equipment.filter((item) => filter === 'all' || item.equipment?.slot === filter);
  displayed.sort((a, b) => {
    if (sort === 'recent') return equipment.indexOf(b) - equipment.indexOf(a);
    if (sort === 'rarity') return rarityRank[b.rarity] - rarityRank[a.rarity] || (b.equipment!.level - a.equipment!.level);
    return (b.equipment!.level - a.equipment!.level) || rarityRank[b.rarity] - rarityRank[a.rarity];
  });
  // Group only visually identical equipment. Tapping a stack exposes every
  // real item; selection, equip, forge, receipts and salvage still use its ID.
  const equipmentGroups: { key: string; items: InventoryItem[] }[] = [];
  const groupIndex = new Map<string, number>();
  for (const item of displayed) {
    const key = stackSimilar ? equipmentVisualKey(item) : item.id;
    const index = groupIndex.get(key);
    if (index === undefined) {
      groupIndex.set(key, equipmentGroups.length);
      equipmentGroups.push({ key, items: [item] });
    } else {
      equipmentGroups[index].items.push(item);
    }
  }
  const chosen = selection?.kind === 'bag' ? equipment.find((item) => item.id === selection.id) : undefined;
  const chosenVisible = chosen && (filter === 'all' || chosen.equipment?.slot === filter);
  // Do not auto-select the first item: keep the bag visible when opening the tab.
  const selectedItem = chosenVisible ? chosen : undefined;
  const selectedWornSlot: Slot | undefined = selection?.kind === 'worn' ? selection.slot : undefined;
  const worn = selectedWornSlot ? state.player.equipped[selectedWornSlot] : selectedItem?.equipment
    ? state.player.equipped[selectedItem.equipment.slot] : undefined;
  const bag = selectedWornSlot ? undefined : selectedItem;
  const canSalvage = !!bag && canSalvageEquipment(bag);
  // A client level/upgradeCount is NOT a refund quote; require a verified server ledger.
  useEffect(() => {
    if (!selectedItem?.id) { setRefundQuote(null); return; }
    let cancelled = false;
    setRefundQuote(null);
    void readForgeRefundQuote(selectedItem.id)
      .then((quote) => { if (!cancelled) setRefundQuote(quote); })
      .catch(() => { if (!cancelled) setRefundQuote(null); });
    return () => { cancelled = true; };
  }, [selectedItem?.id, selectedItem?.equipment?.level]);
  const canRefund = !!bag && refundQuote?.itemId === bag.id && refundQuote.refund > 0;

  const candidate = bag?.equipment;
  const isComparing = !!candidate;
  const miniHero = selection?.kind === 'bag' && !heroExpanded;
  const slotLabel = (slot: Slot) => slotNames[slot][language];

  const chooseBag = (id: string) => {
    if (busy) return;
    setSelection({ kind: 'bag', id }); setHeroExpanded(false); setConfirm(null); setError(null);
  };
  const chooseSlot = (slot: Slot) => {
    if (busy) return;
    setSelection({ kind: 'worn', slot }); setHeroExpanded(true); setConfirm(null); setError(null);
  };

  const equip = () => {
    if (!bag || busy || mustReload) return;
    useGame.set((latest) => {
      const latestItem = latest.inventory.find((i) => i.id === bag.id && i.equipment);
      return latestItem ? equipItem(latest, latestItem) : latest;
    });
    setSelection({ kind: 'worn', slot: bag.equipment!.slot });
    setConfirm(null);
  };
  const unequip = () => {
    if (!selectedWornSlot || !worn || busy || mustReload) return;
    useGame.set((latest) => unequipItem(latest, selectedWornSlot));
    setSelection(null);
  };

  const recycle = async () => {
    if (!bag || !confirm || busy || mustReload) return;
    const id = bag.id;
    const action = confirm;
    const snapshot = useGame.get();
    const current = snapshot.inventory.find((item) => item.id === id && item.type === 'equipment');
    if (!current || (action === 'salvage' && !canSalvageEquipment(current)
      && !(refundQuote?.itemId === current.id && refundQuote.refund > 0))) {
      setError(language === 'en' ? 'Item changed. Choose it again.' : 'Предмет изменился. Выбери его заново.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Existing cloud writer guarantees ordered saves. CAS protects against other tabs.
      const saved = await saveCloudSave(userId, snapshot);
      if (!saved || useGame.get() !== snapshot) throw new Error('stale_inventory_snapshot');
      const receipt = await recycleCloudEquipment(userId, id, action,
        action === 'salvage' && !!(refundQuote?.itemId === id && refundQuote.refund > 0));
      if (useGame.get() !== snapshot) {
        window.location.reload();
        return;
      }
      useGame.set(receipt.state);
      if (action === 'salvage') captureGameEvent('territory_salvage_completed', { outcome: 'success' });
      setRemainingToday(receipt.remainingToday);
      setSelection(null);
      setConfirm(null);
    } catch (cause) {
      const limited = cause instanceof Error && cause.message.includes('recycle_daily_limit_3');
      setError(limited
        ? (language === 'en' ? 'Only 3 forge materials per UTC day. Try tomorrow.' : 'Можно получить только 3 материала в сутки. Попробуй завтра.')
        : (language === 'en' ? 'Could not confirm on server. Reload the game to synchronize.' : 'Сервер не подтвердил операцию. Перезапусти игру для синхронизации.'));
      setMustReload(true);
    } finally {
      setBusy(false);
    }
  };

  const openBatch = async () => {
    if (busy || mustReload) return;
    if (batchOffer) {
      setBatchOffer(null);
      setBatchSelected([]);
      setBatchConfirm(false);
      return;
    }
    const snapshot=useGame.get();
    setBusy(true); setError(null);
    try {
      if (!await saveCloudSave(userId,snapshot) || useGame.get()!==snapshot)
        throw new Error('batch_snapshot_changed');
      const offer=await readGearBatchQuote();
      if (useGame.get()!==snapshot) throw new Error('batch_snapshot_changed');
      setBatchOffer(offer);
      setBatchSelected([]);
      setBatchConfirm(false);
    } catch (cause) {
      const unavailable=cause instanceof Error &&
        ['batch_quote_unavailable','batch_unavailable'].includes(cause.message);
      setError(unavailable
        ? (language==='en'
            ? 'Batch salvage is not available for these items yet. Individual salvage still works.'
            : 'Массовый разбор этих вещей пока недоступен. Обычный разбор продолжает работать.')
        : (language==='en'
            ? 'Inventory changed. Reload to verify it on the server.'
            : 'Инвентарь изменился. Перезапусти игру для синхронизации.'));
      if (!unavailable) setMustReload(true);
    } finally {setBusy(false);}
  };

  const toggleBatchItem = (id: string) => {
    if (busy || batchConfirm || !batchOffer) return;
    if (batchSelected.includes(id)) {
      setBatchSelected(batchSelected.filter((value)=>value!==id));
      return;
    }
    const candidate=batchOffer.eligible.find((e)=>e.itemId===id);
    if (!candidate || batchSelected.length>=10) return;
    const picked=batchOffer.eligible.filter((e)=>batchSelected.includes(e.itemId));
    const baseCount=picked.filter((e)=>e.kind==='base').length;
    if (candidate.kind==='base' && baseCount>=batchOffer.remainingToday) return;
    setBatchSelected([...batchSelected,id]);
  };
  const batchEntries=batchOffer?.eligible.filter((e)=>batchSelected.includes(e.itemId)) ?? [];
  const batchTotal=batchEntries.reduce((sum,e)=>sum+e.awarded,0);
  const runBatch = async () => {
    if (!batchOffer || !batchConfirm || !batchSelected.length || busy || mustReload) return;
    const snapshot=useGame.get();
    const ids=[...batchSelected];
    if (ids.some((id)=>!snapshot.inventory.some((item)=>item.id===id))) {
      setError(language==='en' ? 'Inventory changed. Reload.' : 'Инвентарь изменился. Перезапусти игру.');
      setMustReload(true);
      return;
    }
    setBusy(true); setError(null);
    try {
      if (!await saveCloudSave(userId,snapshot) || useGame.get()!==snapshot)
        throw new Error('batch_snapshot_changed');
      const receipt=await recycleCloudEquipmentBatch(userId,ids);
      if (receipt.awarded!==batchTotal) throw new Error('batch_reward_changed');
      if (useGame.get()!==snapshot) { window.location.reload(); return; }
      useGame.set(receipt.state);
      captureGameEvent('territory_salvage_completed',{outcome:'success'});
      setRemainingToday(receipt.remainingToday);
      setBatchOffer(null);
      setBatchSelected([]);
      setBatchConfirm(false);
      setSelection(null);
    } catch {
      setError(language==='en'
        ? 'Batch was not confirmed. Reload to check items and materials.'
        : 'Разбор не подтверждён. Перезапусти игру для проверки вещей и материалов.');
      setMustReload(true);
    } finally {setBusy(false);}
  };

  return (
    <div className="gear-showcase">
      <div className={'gear-stage' + (miniHero ? ' gear-stage-minimized' : '')}>
        {miniHero ? (
          <div className="gear-mini-bar">
            <img src={getAppearanceIcon(state.appearance)}
              alt={language === 'en' ? 'Your hero' : 'Твой герой'} draggable={false}/>
            <div className="gear-mini-identity">
              <strong>{state.player.name}</strong>
              <span>{language === 'en' ? 'Level ' : 'Уровень '}{state.player.level}</span>
            </div>
            <button type="button" onClick={() => setHeroExpanded(true)} aria-expanded={false}
              className="gear-mini-expand">
              {language === 'en' ? 'Show hero' : 'Показать героя'} <ChevronDown size={16}/>
            </button>
          </div>
        ) : (<>
        <div className="gear-stage-heading">
          <span className="gear-stage-crest">◆</span>
          <div><strong>TERRITORY</strong><span>{language === 'en' ? 'Hero equipment' : 'Снаряжение героя'}</span></div>
          <span className="gear-stage-crest">◆</span>
        </div>
        <div className="gear-stage-ring">
          <div className="gear-stage-halo" aria-hidden="true" />
          <div className="gear-hero-wrap">
            <img className="gear-hero-art" src={getAppearanceIcon(state.appearance)}
              alt={language === 'en' ? 'Your hero' : 'Твой герой'} draggable={false}/>
            <span className="gear-hero-pedestal" aria-hidden="true" />
          </div>
          {EQUIPMENT_SLOTS.map(({ id }) => {
            const eq = state.player.equipped[id];
            return (
              <button type="button" key={id}
                className={'gear-equipped-slot ' + slotPositions[id] + (selectedWornSlot === id ? ' gear-selected-slot' : '')}
                onClick={() => chooseSlot(id)} aria-pressed={selectedWornSlot === id}
                aria-label={(language === 'en' ? 'Equipped ' : 'Надето: ') + slotLabel(id) + (eq ? ' — ' + localizeText(eq.name, language) : '')}>
                <span className="gear-slot-icon" style={{ borderColor: eq ? rarityColor(eq.rarity) : undefined, boxShadow: eq ? '0 0 9px ' + rarityColor(eq.rarity) + '55' : undefined }}>
                  <img src={eq ? equipmentArt(eq) : SLOT_ART[id]} alt="" draggable={false}
                    className={'gear-slot-image ' + (!eq ? 'gear-slot-empty' : '')}/>
                  {eq && <span className="gear-slot-rarity" style={{ background: rarityColor(eq.rarity) }} />}
                </span>
                <span className="gear-slot-label">{slotLabel(id)}</span>
                <span className="gear-slot-level">{eq ? (language === 'en' ? 'Lv.' : 'Ур.') + eq.level : '—'}</span>
              </button>
            );
          })}
        </div>
        <div className="gear-stage-footer">
          <span>{state.player.name}</span>
          <span>{language === 'en' ? 'Level ' : 'Уровень '}{state.player.level}</span>
          {selection?.kind === 'bag' && (
            <button type="button" className="gear-stage-collapse" aria-expanded={true}
              onClick={() => setHeroExpanded(false)}>
              {language === 'en' ? 'Compact' : 'Свернуть'} <ChevronUp size={13}/>
            </button>
          )}
        </div>
        </>)}
      </div>

      <VipEquipmentPresets userId={userId}
        onApplied={() => { setSelection(null); setConfirm(null); setError(null); }}/>
      {selection && <section ref={compareRef} className="gear-compare-panel" aria-live="polite">
        {isComparing ? (
          <>
            <div className="gear-two-cards">
              <GearPortrait equipped={worn} label={language === 'en' ? 'EQUIPPED' : 'НАДЕТО'} language={language}/>
              <GearPortrait equipped={worn} candidate={candidate} label={language === 'en' ? 'SELECTED' : 'ВЫБРАНО'} language={language} isCandidate />
            </div>
            <p className="gear-weight-hint gear-compact-hint">
              {gearScore(candidate) > gearScore(worn)
                ? (language === 'en' ? 'Overall stronger — compare individual stats.' : 'В целом сильнее — сравни каждый бонус.')
                : gearScore(candidate) < gearScore(worn)
                  ? (language === 'en' ? 'Overall weaker — may still suit your build.' : 'В целом слабее — но может подойти под твой стиль.')
                  : (language === 'en' ? 'Same overall rating — compare individual stats.' : 'Общая оценка равна — сравни бонусы.')}
            </p>
            <div className="gear-compare-actions">
              <button type="button" onClick={equip} disabled={busy || mustReload} className="gear-action-equip">
                <Check size={17}/>{language === 'en' ? 'Equip' : 'Надеть'}
              </button>
              {onForge && candidate && <button type="button" disabled={busy || mustReload} onClick={() => onForge(candidate.id)} className="gear-action-salvage">
                <Hammer size={16}/>{language === 'en' ? 'Upgrade' : 'В кузницу'}
              </button>}
              {(canSalvage || canRefund) && (
                <button type="button" className="gear-action-salvage" disabled={busy || mustReload}
                  onClick={() => setConfirm('salvage')}>
                  <Hammer size={16}/>{canRefund
                    ? (language === 'en' ? 'Salvage +' : 'Разобрать +') + refundQuote!.refund
                    : (language === 'en' ? 'Salvage +1' : 'Разобрать +1')}
                </button>
              )}
              {canRefund && <p className="gear-weight-hint" role="status">
                {language === 'en'
                  ? `65% returned from ${refundQuote!.spent} verified forge materials. Item is destroyed.`
                  : `Возврат 65% из ${refundQuote!.spent} подтверждённых материалов кузницы. Вещь уничтожается.`}
              </p>}
              {!(candidate && (candidate.upgradeCount ?? 0) > 0 && !canRefund) ? (
                <button type="button" className="gear-action-discard" disabled={busy || mustReload}
                  onClick={() => setConfirm('discard')}>
                  <Trash2 size={16}/>{language === 'en' ? 'Delete' : 'Удалить'}
                </button>
              ) : (
                <p className="gear-weight-hint" role="status">
                  {language === 'en'
                    ? 'This upgraded item is protected until its material spending can be verified on the server.'
                    : 'Улучшенная вещь защищена от удаления, пока сервер не подтвердит затраты материалов.'}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="gear-worn-details">
            <div className="gear-worn-title">
              <span className="gear-compare-banner">{language === 'en' ? 'EQUIPPED ITEM' : 'НАДЕТО'}</span>
              <span className="gear-worn-slotname">{selectedWornSlot ? slotLabel(selectedWornSlot) : (language === 'en' ? 'Select an item' : 'Выбери предмет')}</span>
            </div>
            {worn ? (
              <>
                <div className="gear-worn-body">
                  <span className="gear-compare-art"><ItemArt item={eqToItem(worn)} size={56}/></span>
                  <div><strong>{localizeText(worn.name, language)}</strong>
                    <p>{rarityLabel[worn.rarity][language]} · {language === 'en' ? 'Lv.' : 'Ур.'} {worn.level}</p>
                  </div>
                </div>
                <div className="gear-worn-stat-grid">
                  {GEAR_STATS.map(s=><div key={s.key}><span>{language === 'en' ? s.en : s.ru}</span>
                    <strong>{worn[s.key] ?? 0}{s.key === 'critChance' ? '%' : ''}</strong></div>)}
                </div>
                <button type="button" className="gear-unequip-button" onClick={unequip}
                  disabled={busy || mustReload}><RotateCcw size={15}/>{language === 'en' ? 'Unequip to bag' : 'Снять в инвентарь'}</button>
                {onForge && <button type="button" className="gear-unequip-button" onClick={() => onForge(worn.id)} disabled={busy || mustReload}>
                  <Hammer size={15}/>{language === 'en' ? 'Upgrade in forge' : 'Улучшить в кузнице'}
                </button>}
              </>
            ) : (
              <div className="gear-no-selection"><Info size={21}/>
                {selectedWornSlot
                  ? (language === 'en' ? 'Slot is empty. Choose equipment below.' : 'Слот пуст. Выбери предмет из инвентаря ниже.')
                  : (language === 'en' ? 'Tap an equipped slot to see its stats.' : 'Нажми на надетый предмет, чтобы посмотреть характеристики.')}
              </div>
            )}
          </div>
        )}

        {confirm && bag && (
          <div className="gear-confirm">
            <div className="gear-confirm-heading"><Info size={17}/><strong>{language === 'en' ? 'Confirm action' : 'Подтверди действие'}</strong>
              <button type="button" onClick={() => setConfirm(null)} disabled={busy} aria-label={language === 'en' ? 'Cancel' : 'Отмена'}><X size={16}/></button>
            </div>
            <p>{confirm === 'salvage'
              ? (canRefund
                  ? (language === 'en' ? `Destroy this equipment forever and refund ${refundQuote!.refund} of ${refundQuote!.spent} verified forge materials (65%)?` : `Уничтожить эту вещь навсегда и вернуть ${refundQuote!.refund} из ${refundQuote!.spent} подтверждённых материалов кузницы (65%)?`)
                  : (language === 'en' ? 'Destroy this unused boss drop for 1 forge material? Maximum 3 per UTC day.' : 'Разобрать эту вещь навсегда за 1 материал кузницы? Не более 3 в сутки.'))
              : (language === 'en' ? 'Delete this spare item forever without any reward?' : 'Навсегда удалить этот запасной предмет без награды?')}</p>
            <div className="gear-confirm-buttons">
              <button type="button" disabled={busy} onClick={() => void recycle()}>
                {busy ? (language === 'en' ? 'Checking…' : 'Проверяем…') : (language === 'en' ? 'Yes, confirm' : 'Да, подтверждаю')}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirm(null)}>{language === 'en' ? 'Cancel' : 'Отмена'}</button>
            </div>
          </div>
        )}
        {error && <div className="gear-recycle-error" role="alert">
          <span>{error}</span>
          {mustReload && <button type="button" onClick={() => window.location.reload()}>
            {language === 'en' ? 'Reload' : 'Перезапустить'}
          </button>}
        </div>}
      </section>}

      <section className="gear-bag" aria-label={language === 'en' ? 'Equipment inventory' : 'Инвентарь экипировки'}>
        {state.player.level < 5 && equipment.length > 0 && !Object.values(state.player.equipped).some(Boolean) && !selection && <p className="mb-2 rounded-lg border border-sky-400/40 bg-sky-950/60 px-3 py-2 text-xs leading-relaxed text-sky-100" role="note">
          {language === 'en' ? 'Tap an item below, compare it, then press Equip.' : 'Нажми на вещь в сумке ниже, сравни её и выбери «Надеть».'}
        </p>}
        <div className="gear-bag-toolbar">
          <button type="button" disabled={busy || mustReload}
            onClick={() => void openBatch()} aria-expanded={!!batchOffer}
            className="gear-bag-salvage">
            <Recycle size={17}/>{batchOffer
              ? (language === 'en' ? 'Close salvage' : 'Закрыть разбор')
              : (language === 'en' ? 'Salvage multiple' : 'Разобрать несколько')}
          </button>
          <div className="gear-bag-count"><strong>{equipment.length}</strong>
            <span>{language === 'en' ? 'items' : 'вещей'}</span>
          </div>
          <div className="gear-bag-sort">
            <label htmlFor="gear-sort">{language === 'en' ? 'Sort' : 'Сортировка'}</label>
            <select id="gear-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="level">{language === 'en' ? 'Level' : 'Уровень'}</option>
              <option value="rarity">{language === 'en' ? 'Rarity' : 'Редкость'}</option>
              <option value="recent">{language === 'en' ? 'Recent' : 'Новые'}</option>
            </select><ChevronDown size={13}/>
          </div>
        </div>
        <div className="gear-stack-toolbar">
          <button type="button" className="gear-stack-toggle"
            aria-pressed={stackSimilar}
            onClick={() => { setStackSimilar(value => !value); setExpandedStacks([]); }}>
            <Layers3 size={16} aria-hidden="true" />
            {stackSimilar
              ? (language === 'en' ? 'Similar gear stacked' : 'Одинаковые вещи в стопках')
              : (language === 'en' ? 'Stack similar gear' : 'Сгруппировать одинаковые')}
          </button>
          <span aria-live="polite">{stackSimilar
            ? (language === 'en' ? `${equipmentGroups.length} groups · ${displayed.length} items` : `${equipmentGroups.length} групп · ${displayed.length} вещей`)
            : (language === 'en' ? `${displayed.length} individual items` : `${displayed.length} отдельных вещей`)}</span>
        </div>
        <div className="gear-filter-strip" role="group" aria-label={language === 'en' ? 'Filter equipment by slot' : 'Фильтр по типу экипировки'}>
          {filters.map((slot) => (
            <button type="button" key={slot} className={'gear-filter-chip ' + (filter === slot ? 'gear-filter-on' : '')}
              aria-pressed={filter === slot}
              onClick={() => { if (busy) return; setFilter(slot); setSelection(null); setConfirm(null); setError(null); }}>
              {slot === 'all' ? (language === 'en' ? 'All' : 'Все') : slotLabel(slot)}
            </button>
          ))}
        </div>
        {batchOffer && <section className="mb-3 rounded-xl border border-amber-500/50 bg-stone-950/75 p-3 text-amber-100" aria-label={language==='en'?'Batch salvage':'Массовый разбор'}>
          <h3 className="text-sm font-bold">{language==='en'?'Select spare items to salvage':'Выбери ненужные вещи для разбора'}</h3>
          <p className="mt-1 text-xs">{language==='en'
            ? 'Only server-verified items. Maximum 10 per batch; common/rare items only.'
            : 'Только вещи, подтверждённые сервером. Не более 10 за раз, обычные и редкие.'}</p>
          {batchOffer.eligible.length===0 ? <p className="mt-2 text-xs">{language==='en'
            ? 'No eligible items. Existing upgraded items without receipts are protected.'
            : 'Пока нет доступных вещей. Старые улучшенные предметы без квитанций защищены.'}</p>
          : <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {batchOffer.eligible.map((entry)=>{
              const matching=equipment.find((item)=>item.id===entry.itemId);
              if (!matching) return null;
              const checked=batchSelected.includes(entry.itemId);
              const baseCount=batchEntries.filter((e)=>e.kind==='base').length;
              const disabled=!checked && (batchSelected.length>=10 ||
                (entry.kind==='base' && baseCount>=batchOffer.remainingToday));
              return <label key={entry.itemId} className={'flex items-center gap-2 rounded-lg border px-2 py-2 text-xs '+(checked?'border-amber-300/70 bg-amber-400/20':'border-white/15 bg-black/20')}>
                <input type="checkbox" checked={checked} disabled={busy || batchConfirm || disabled}
                  onChange={()=>toggleBatchItem(entry.itemId)}
                  aria-label={(language==='en'?'Salvage ':'Разобрать ')+localizeText(matching.name,language)}/>
                <span className="min-w-0 flex-1 truncate">{localizeText(matching.name,language)} · {language==='en'?'Lv.':'Ур.'}{matching.equipment!.level}</span>
                <strong className="shrink-0 text-amber-300">+{entry.awarded} 🔩</strong>
              </label>;
            })}
          </div>}
          <p className="mt-2 text-xs">{language==='en'?'Base salvage remaining today: ':'Бесплатных разборов сегодня осталось: '}{batchOffer.remainingToday}/3</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <strong className="text-sm">{language==='en'?'Total':'Итого'}: {batchSelected.length} · +{batchTotal} 🔩</strong>
            <button type="button" disabled={busy || mustReload || batchSelected.length===0}
              onClick={()=>setBatchConfirm(true)}
              className="rounded-lg border border-amber-400 bg-amber-600/80 px-3 py-2 text-xs font-bold text-white">
              {language==='en'?'Continue':'Продолжить'}
            </button>
          </div>
          {batchConfirm && <div role="group" className="mt-3 rounded-lg border border-red-400/50 bg-black/40 p-3">
            <p className="text-xs font-semibold">{language==='en'
              ? `Destroy ${batchSelected.length} items permanently for ${batchTotal} forge materials?`
              : `Навсегда уничтожить ${batchSelected.length} вещей и получить ${batchTotal} материалов кузницы?`}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={()=>void runBatch()} disabled={busy}
                className="rounded-lg border border-red-400/70 bg-red-900/60 px-3 py-2 text-xs font-bold">
                {language==='en'?'Confirm destruction':'Подтвердить уничтожение'}
              </button>
              <button type="button" onClick={()=>setBatchConfirm(false)} disabled={busy}
                className="rounded-lg border border-white/25 px-3 py-2 text-xs">
                {language==='en'?'Cancel':'Отмена'}
              </button>
            </div>
          </div>}
        </section>}
        {displayed.length ? (
          <div className="gear-bag-grid">
            {equipmentGroups.map(({ key, items }) => {
              const item = items[0];
              const eq = item.equipment!;
              const isStack = items.length > 1;
              const expanded = isStack && expandedStacks.includes(key);
              const selected = isComparing && items.some(copy => copy.id === bag?.id);
              const current = state.player.equipped[eq.slot];
              const comparison = current ? gearScore(eq) - gearScore(current) : 1;
              return (
                <Fragment key={key}>
                  <button type="button"
                    className={'gear-bag-tile ' + (selected ? 'gear-bag-tile-active ' : '') + (isStack ? 'gear-bag-tile--stack' : '')}
                    style={{ '--tile-rarity': rarityColor(item.rarity) } as CSSProperties}
                    onClick={() => {
                      if (isStack) {
                        setExpandedStacks(previous => previous.includes(key)
                          ? previous.filter(entry => entry !== key)
                          : [...previous, key]);
                      } else chooseBag(item.id);
                    }}
                    aria-expanded={isStack ? expanded : undefined}
                    aria-pressed={!isStack ? selected : undefined}
                    aria-label={localizeText(item.name, language) + ', ' + slotLabel(eq.slot) + ', ' +
                      (language === 'en' ? 'level ' : 'уровень ') + eq.level +
                      (isStack ? (language === 'en' ? `, ${items.length} copies, ` : `, ${items.length} шт., `) +
                        (expanded ? (language === 'en' ? 'collapse stack' : 'свернуть стопку') : (language === 'en' ? 'expand stack' : 'развернуть стопку')) : '')}
                  >
                    <span className="gear-bag-art"><ItemArt item={item} size={47}/></span>
                    <span className="gear-bag-level">{language === 'en' ? 'Lv.' : 'Ур.'}{eq.level}</span>
                    <span className={'gear-bag-indicator ' + (comparison > 0 ? 'gear-bag-better' : '')} aria-hidden="true">
                      {slotNames[eq.slot].ru.slice(0, 1)}
                    </span>
                    {isStack && <span className="gear-stack-badge" aria-hidden="true">×{items.length}</span>}
                    {isStack && <span className="gear-stack-chevron" aria-hidden="true">
                      {expanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                    </span>}
                  </button>
                  {expanded && items.map((copy, index) => {
                    const active = isComparing && bag?.id === copy.id;
                    return (
                      <button type="button" key={copy.id}
                        className={'gear-bag-tile gear-bag-tile--copy ' + (active ? 'gear-bag-tile-active' : '')}
                        style={{ '--tile-rarity': rarityColor(copy.rarity) } as CSSProperties}
                        onClick={() => chooseBag(copy.id)}
                        aria-pressed={!!active}
                        aria-label={localizeText(copy.name, language) + ', ' +
                          (language === 'en' ? 'copy ' : 'экземпляр ') + (index + 1) + '/' + items.length +
                          ', ' + (language === 'en' ? 'level ' : 'уровень ') + copy.equipment!.level}>
                        <span className="gear-bag-art"><ItemArt item={copy} size={47}/></span>
                        <span className="gear-bag-level">{language === 'en' ? 'Lv.' : 'Ур.'}{copy.equipment!.level}</span>
                        <span className="gear-stack-copy-number">{index + 1}</span>
                      </button>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        ) : (
          <div className="gear-bag-empty"><Info size={20}/>{language === 'en' ? 'No gear in this category yet.' : 'Пока нет вещей этого типа.'}</div>
        )}
        <div className="gear-bag-footer">
          <span>{language === 'en' ? 'Compare gear, or select up to 10 verified spare items for batch salvage.' : 'Сравни вещи или выбери до 10 подтверждённых предметов для разбора.'}</span>
          <span><Hammer size={12}/>{state.forgeMaterials}
            {remainingToday !== null && <small>{language === 'en' ? ' • ' + remainingToday + '/3 left today' : ' • ' + remainingToday + '/3 сегодня'}</small>}</span>
        </div>
      </section>
    </div>
  );
}
