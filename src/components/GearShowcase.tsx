import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useStore } from '@/game/store';
import { useGame, equipItem, unequipItem } from '@/game/actions';
import { captureGameEvent } from '@/game/analytics';
import { useLanguage, localizeText } from '@/game/i18n';
import { getAppearanceIcon } from '@/game/appearance';
import { EQUIPMENT_SLOTS } from '@/game/engine';
import { equipmentArt, SLOT_ART } from '@/game/art';
import { rarityColor } from '@/game/ui';
import { GEAR_STATS, gearScore, canSalvageEquipment } from '@/game/gearTools';
import { recycleCloudEquipment, saveCloudSave } from '@/game/cloud';
import { ItemArt } from './ui/ItemArt';
import type { Equipment, InventoryItem } from '@/game/types';
import { Check, ChevronDown, ChevronUp, Hammer, Info, Recycle, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';
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
export function GearShowcase({ userId }: { userId: string }) {
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
  const [heroExpanded, setHeroExpanded] = useState(false);
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
  const chosen = selection?.kind === 'bag' ? equipment.find((item) => item.id === selection.id) : undefined;
  const chosenVisible = chosen && (filter === 'all' || chosen.equipment?.slot === filter);
  // Do not auto-select the first item: keep the bag visible when opening the tab.
  const selectedItem = chosenVisible ? chosen : undefined;
  const selectedWornSlot: Slot | undefined = selection?.kind === 'worn' ? selection.slot : undefined;
  const worn = selectedWornSlot ? state.player.equipped[selectedWornSlot] : selectedItem?.equipment
    ? state.player.equipped[selectedItem.equipment.slot] : undefined;
  const bag = selectedWornSlot ? undefined : selectedItem;
  const canSalvage = !!bag && canSalvageEquipment(bag);
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
    if (!current || (action === 'salvage' && !canSalvageEquipment(current))) {
      setError(language === 'en' ? 'Item changed. Choose it again.' : 'Предмет изменился. Выбери его заново.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Existing cloud writer guarantees ordered saves. CAS protects against other tabs.
      const saved = await saveCloudSave(userId, snapshot);
      if (!saved || useGame.get() !== snapshot) throw new Error('stale_inventory_snapshot');
      const receipt = await recycleCloudEquipment(userId, id, action);
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
              {canSalvage && (
                <button type="button" className="gear-action-salvage" disabled={busy || mustReload}
                  onClick={() => setConfirm('salvage')}>
                  <Hammer size={16}/>{language === 'en' ? 'Salvage +1' : 'Разобрать +1'}
                </button>
              )}
              <button type="button" className="gear-action-discard" disabled={busy || mustReload}
                onClick={() => setConfirm('discard')}>
                <Trash2 size={16}/>{language === 'en' ? 'Delete' : 'Удалить'}
              </button>
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
              ? (language === 'en' ? 'Destroy this unused boss drop for 1 forge material? Maximum 3 per UTC day.' : 'Разобрать эту вещь навсегда за 1 материал кузницы? Не более 3 в сутки.')
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
        <div className="gear-bag-toolbar">
          <button type="button" disabled={!bag || !canSalvage || busy || mustReload}
            onClick={() => setConfirm('salvage')} className="gear-bag-salvage">
            <Recycle size={17}/>{language === 'en' ? 'Salvage' : 'Разобрать'}
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
        <div className="gear-filter-strip" role="group" aria-label={language === 'en' ? 'Filter equipment by slot' : 'Фильтр по типу экипировки'}>
          {filters.map((slot) => (
            <button type="button" key={slot} className={'gear-filter-chip ' + (filter === slot ? 'gear-filter-on' : '')}
              aria-pressed={filter === slot}
              onClick={() => { if (busy) return; setFilter(slot); setSelection(null); setConfirm(null); setError(null); }}>
              {slot === 'all' ? (language === 'en' ? 'All' : 'Все') : slotLabel(slot)}
            </button>
          ))}
        </div>
        {displayed.length ? (
          <div className="gear-bag-grid">
            {displayed.map(item => {
              const eq = item.equipment!;
              const selected = isComparing && bag?.id === item.id;
              const current = state.player.equipped[eq.slot];
              const comparison = current ? gearScore(eq) - gearScore(current) : 1;
              return (
                <button type="button" key={item.id}
                  className={'gear-bag-tile ' + (selected ? 'gear-bag-tile-active' : '')}
                  style={{ '--tile-rarity': rarityColor(item.rarity) } as CSSProperties}
                  onClick={() => chooseBag(item.id)}
                  aria-pressed={!!selected}
                  aria-label={localizeText(item.name, language) + ', ' + slotLabel(eq.slot) + ', ' + (language === 'en' ? 'level ' : 'уровень ') + eq.level}>
                  <span className="gear-bag-art"><ItemArt item={item} size={47}/></span>
                  <span className="gear-bag-level">{language === 'en' ? 'Lv.' : 'Ур.'}{eq.level}</span>
                  <span className={'gear-bag-indicator ' + (comparison > 0 ? 'gear-bag-better' : '')} aria-hidden="true">
                    {slotNames[eq.slot].ru.slice(0, 1)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="gear-bag-empty"><Info size={20}/>{language === 'en' ? 'No gear in this category yet.' : 'Пока нет вещей этого типа.'}</div>
        )}
        <div className="gear-bag-footer">
          <span>{language === 'en' ? 'Tap a spare item to compare or salvage it (+1 material, up to 3 daily).' : 'Нажми на запасную вещь: сравни или разбери за +1 материал (до 3 в сутки).'}</span>
          <span><Hammer size={12}/>{state.forgeMaterials}
            {remainingToday !== null && <small>{language === 'en' ? ' • ' + remainingToday + '/3 left today' : ' • ' + remainingToday + '/3 сегодня'}</small>}</span>
        </div>
      </section>
    </div>
  );
}
