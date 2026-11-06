import { useEffect, useRef, useState } from 'react';
import { CAVE_ITEMS } from './CavePreview';
import './umbraGear.css';

type Item = (typeof CAVE_ITEMS)[number];
type Filter = 'all' | Item['category'];
type SlotState = 'sample' | 'empty' | 'locked';
type Slot = readonly [ru: string, en: string, sample: number | null, state: SlotState];

// The names without a visible reference are deliberately provisional. Nothing here
// is an equipment instance, a database ID or a main-equipment position.
const slots: readonly Slot[] = [
  ['Шлем', 'Helmet', 15, 'sample'],
  ['Амулет', 'Amulet', 0, 'sample'],
  ['Оружие', 'Weapon', 1, 'sample'],
  ['Нагрудник', 'Chest armor', 10, 'sample'],
  ['Перчатки', 'Gloves', 6, 'sample'],
  ['Кольцо', 'Ring', 8, 'sample'],
  ['Поножи', 'Greaves', 12, 'sample'],
  ['Сапоги', 'Boots', 2, 'sample'],
  ['Щит', 'Shield', 9, 'sample'],
  ['Пояс (раб.)', 'Belt (provisional)', null, 'empty'],
  ['Позиция 11', 'Position 11', null, 'locked'],
  ['Позиция 12', 'Position 12', null, 'locked'],
];

const baseArt = import.meta.env.BASE_URL + 'assets/territory/cave-loot/2026-11-06/';
const woodArt = import.meta.env.BASE_URL + 'assets/territory/ui/shop/shop-wood-planks.webp';
const image = (item: Item) => baseArt + item.file;

type Detail = { kind: 'slot'; index: number } | { kind: 'item'; item: Item } | { kind: 'info'; topic: number };

export function UmbraGear({ en, hero, clearedDepth, onBack }: {
  en: boolean; hero: string; clearedDepth: number; onBack: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<Detail | null>(null);
  const storageRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (detail) closeRef.current?.focus();
    else previousFocus.current?.focus();
  }, [detail]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Backspace') return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      if (detail) setDetail(null);
      else onBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detail, onBack]);

  const openDetail = (next: Detail) => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDetail(next);
  };
  const labels = {
    all: en ? 'All' : 'Все',
    gear: en ? 'Gear' : 'Вещи',
    gems: en ? 'Gems' : 'Камни',
    materials: en ? 'Materials' : 'Материалы',
  };
  const shown = CAVE_ITEMS.filter(item => filter === 'all' || item.category === filter);
  const selectedSlot = detail?.kind === 'slot' ? slots[detail.index] : null;
  const selectedItem = detail?.kind === 'item' ? detail.item :
    selectedSlot && selectedSlot[2] !== null ? CAVE_ITEMS[selectedSlot[2]] : null;
  const actions = en ? ['Guide', 'Dismantle', 'Enhance all'] : ['Справочник', 'Разобрать', 'Усилить в один клик'];
  const info = en ? [
    'The Dark Energy reference screen contains 12 additional positions and its own storage. Slot labels and unlock rules are preliminary. The ordinary hero equipment is unchanged.',
    'Dismantling will be available only after real Dark Gear inventory is implemented and confirmed. This preview cannot destroy an item or grant materials.',
    'Bulk enhancement is planned for the additional Dark Gear set only. This preview cannot spend currency or change equipment levels.',
  ] : [
    'В образце «Тёмной энергии» — 12 дополнительных позиций и отдельный склад. Названия и условия открытия уточняются. Обычная экипировка героя не изменяется.',
    'Разбор появится после утверждения настоящего тёмного инвентаря. Сейчас нельзя уничтожить предмет или получить материалы.',
    'Массовое усиление относится только к дополнительному тёмному набору. Сейчас уровни вещей и валюты не меняются.',
  ];

  const renderSlot = (slot: Slot, index: number) => {
    const sample = slot[2] === null ? null : CAVE_ITEMS[slot[2]];
    return <button key={index} className={'umbra-slot umbra-slot--' + slot[3]} type="button"
      data-testid="umbra-slot" onClick={() => openDetail({ kind: 'slot', index })}
      aria-label={(en ? slot[1] : slot[0]) + ' · ' + (en ? 'additional gear position' : 'дополнительная позиция')}>
      <span className="umbra-slot-icon">{sample ?
        <img src={image(sample)} alt="" loading="lazy" /> :
        <span aria-hidden="true" className="umbra-slot-symbol">{slot[3] === 'locked' ? '◇' : '+'}</span>}</span>
      <span className="umbra-slot-state">{slot[3] === 'sample' ? (en ? 'Sample' : 'Образец') :
        slot[3] === 'empty' ? (en ? 'Empty' : 'Пусто') : (en ? 'Locked' : 'Закрыто')}</span>
    </button>;
  };

  return <div className="umbra-screen" data-testid="umbra-screen"
    style={{ backgroundImage: `linear-gradient(180deg, rgba(16,9,17,.88), rgba(31,13,21,.91)), url("${woodArt}")` }}>
    <header className="umbra-header">
      <button type="button" onClick={onBack} aria-label={en ? 'Back to cave' : 'Назад в пещеру'} className="umbra-nav-back">‹</button>
      <div className="umbra-heading">
        <h3>{en ? 'Additional Dark Gear' : 'Дополнительное тёмное снаряжение'}</h3>
        <span>{en ? 'Separate from your main equipment' : 'Отдельно от основной экипировки'}</span>
      </div>
      <button type="button" className="umbra-storage-jump" onClick={() => storageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
        {en ? 'Storage ↓' : 'Склад ↓'}
      </button>
    </header>

    <div className="umbra-scene" aria-label={en ? 'Twelve additional equipment slots' : '12 дополнительных слотов'}>
      <div className="umbra-slots">{slots.slice(0, 6).map((slot, i) => renderSlot(slot, i))}</div>
      <div className="umbra-hero">
        <div className="umbra-hero-halo" aria-hidden="true" />
        <img src={hero} alt={en ? 'Your hero' : 'Твой герой'} draggable={false} />
        <span className="umbra-hero-caption">{en ? '12 dark positions' : '12 тёмных позиций'}</span>
      </div>
      <div className="umbra-slots">{slots.slice(6).map((slot, i) => renderSlot(slot, i + 6))}</div>
    </div>
    <p className="umbra-scene-caption">{en
      ? 'Preview only · All gear shown here is a sample, not equipped or saved'
      : 'Предпросмотр · это образцы, ничего не надето и не сохраняется'}</p>

    <section className="umbra-storage" aria-label={en ? 'Dark storage' : 'Тёмный склад'} ref={storageRef}>
      <div className="umbra-storage-title">
        <div><h3>{en ? 'Dark storage' : 'Тёмный склад'}</h3><span>{en ? 'Loot examples · not owned' : 'Образцы добычи · ещё не получены'}</span></div>
        <strong aria-label={en ? '16 catalog samples' : '16 образцов каталога'}>16</strong>
      </div>
      <div className="umbra-actions">
        {actions.map((label, topic) => <button type="button" key={label} onClick={() => openDetail({ kind: 'info', topic })}>{label}</button>)}
      </div>
      <div className="umbra-filters" aria-label={en ? 'Filter samples by category' : 'Фильтр образцов по категории'}>
        {(['all', 'gear', 'gems', 'materials'] as const).map(f => <button key={f} type="button"
          aria-pressed={filter === f} onClick={() => setFilter(f)}>{labels[f]}</button>)}
      </div>
      <p className="umbra-result-count">{en ? 'Samples' : 'Образцы'}: {shown.length} · {en ? 'No items granted' : 'Выдачи нет'}</p>
      <div className="umbra-items">
        {shown.map(item => <button type="button" key={item.id} data-testid="umbra-item"
          onClick={() => openDetail({ kind: 'item', item })}>
          <img src={image(item)} alt="" loading="lazy" />
          <span>{en ? item.en : item.ru}</span>
        </button>)}
      </div>
      <p className="umbra-storage-footnote">{en
        ? 'Gear, gems and materials are separate item categories. This gallery does not change your hero or cave progress.'
        : 'Экипировка, самоцветы и материалы — разные категории. Галерея не меняет героя и прогресс Пещеры.'}</p>
    </section>

    {detail && <div className="umbra-overlay" role="dialog" aria-modal="true"
      aria-label={en ? 'Dark Gear details' : 'Сведения о тёмном снаряжении'}
      onClick={() => setDetail(null)}>
      <div className="umbra-dialog" onClick={event => event.stopPropagation()}>
        <button type="button" ref={closeRef} className="umbra-close"
          onClick={() => setDetail(null)} aria-label={en ? 'Close' : 'Закрыть'}>×</button>
        {selectedSlot && <>
          <p className="umbra-dialog-kicker">{en ? 'Additional position' : 'Дополнительная позиция'} {detail.kind === 'slot' ? detail.index + 1 : ''} / 12</p>
          <h3>{en ? selectedSlot[1] : selectedSlot[0]}</h3>
          <p>{selectedSlot[3] === 'sample'
            ? (en ? 'This is an illustration, not worn gear.' : 'Здесь показана иллюстрация, вещь не надета.')
            : selectedSlot[3] === 'empty' ? (en ? 'Empty example position.' : 'Пример пустой позиции.')
            : (en ? 'Locked example position.' : 'Пример закрытой позиции.')}</p>
          <p>{en ? 'Slot names and opening conditions are provisional.' : 'Названия позиций и условия открытия ещё уточняются.'}</p>
        </>}
        {selectedItem && <>
          <img className="umbra-detail-art" src={image(selectedItem)} alt={en ? selectedItem.en : selectedItem.ru} />
          <h3>{en ? selectedItem.en : selectedItem.ru}</h3>
          <p>{en ? 'Category' : 'Категория'}: {labels[selectedItem.category]} · {en ? selectedItem.typeEn : selectedItem.typeRu}</p>
          <p>{selectedItem.category === 'gear'
            ? (en ? 'Additional Dark Gear; the main hero set is never replaced.' : 'Дополнительная тёмная экипировка. Основной комплект героя не заменяется.')
            : selectedItem.category === 'gems'
              ? (en ? 'A gem belongs to a separate enhancement system, not a Dark Gear slot.' : 'Самоцвет относится к отдельной системе усиления, а не к слоту тёмной экипировки.')
              : (en ? 'A crafting material, not wearable gear.' : 'Материал, не предмет экипировки.')}</p>
          <p>{en ? 'Reference milestone: floor ' : 'Ориентир этапа: этаж '}{selectedItem.floor} · {clearedDepth >= selectedItem.floor
            ? (en ? 'threshold reached (preview only)' : 'порог достигнут (только пример)')
            : (en ? 'upcoming (preview only)' : 'ещё впереди (только пример)')}</p>
          <p className="umbra-dialog-hint">{en ? 'Not obtained, not equipped; no resources spent.' : 'Не получено, не надето; ресурсы не тратятся.'}</p>
        </>}
        {detail.kind === 'info' && <>
          <p className="umbra-dialog-kicker">{en ? 'Function guide' : 'Описание функции'}</p>
          <h3>{actions[detail.topic]}</h3>
          <p>{info[detail.topic]}</p>
        </>}
        <button type="button" className="umbra-back" onClick={() => setDetail(null)}>{en ? 'Back' : 'Назад'}</button>
      </div>
    </div>}
  </div>;
}
