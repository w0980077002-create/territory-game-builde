import { useMemo, useState, type CSSProperties } from 'react';
import { Clock3, FlaskConical, Info, Package, Search, X } from 'lucide-react';
import type { GameState, InventoryItem } from '@/game/types';
import { localizeText } from '@/game/i18n';
import { rarityColor } from '@/game/ui';
import { elixirExpiryTime, elixirTimeLeftLabel, forgeMaterialTimeLeftLabel, isPerishableItem } from '@/game/elixirExpiry';
import { ItemArt } from './ui/ItemArt';
import { IosGamePortal } from './ui/Modal';
import './compactWarehouse.css';

type WarehouseFilter = 'all' | 'consumables' | 'materials';
interface Props {
  consumables: InventoryItem[];
  materials: InventoryItem[];
  forgeMaterials: GameState['forgeMaterials'];
  forgeMaterialBatches: GameState['forgeMaterialBatches'];
  now: number;
  language: 'ru' | 'en';
  onItemSelect: (item: InventoryItem) => void;
}

const formatQuantity = (quantity: number) => quantity.toLocaleString('ru-RU');

function WarehouseItem({ item, language, now, onSelect }: {
  item: InventoryItem;
  language: 'ru' | 'en';
  now: number;
  onSelect: (item: InventoryItem) => void;
}) {
  const name = localizeText(item.name, language);
  const perishable = isPerishableItem(item);
  const urgent = perishable && elixirExpiryTime(item) - now <= 24 * 60 * 60 * 1000;
  const style = { '--warehouse-rarity': rarityColor(item.rarity) } as CSSProperties;
  return <button
    type="button"
    className={'warehouse-tile' + (urgent ? ' warehouse-tile--urgent' : '')}
    style={style}
    title={name}
    aria-label={`${name}. ${language === 'en' ? 'Quantity' : 'Количество'}: ${item.qty}${perishable ? '. ' + elixirTimeLeftLabel(item, language, now) : ''}`}
    onClick={() => onSelect(item)}
  >
    <span className="warehouse-tile__art">
      <ItemArt item={item} size={49}/>
      {item.qty > 1 && <span className="warehouse-tile__count">×{formatQuantity(item.qty)}</span>}
    </span>
    <span className="warehouse-tile__name">{name}</span>
    {perishable && <span className="warehouse-tile__expiry">
      <Clock3 size={10} aria-hidden="true"/>{elixirTimeLeftLabel(item, language, now)}
    </span>}
  </button>;
}

/** Display only: preserves every original inventory batch, identifier and expiry. */
export function CompactWarehouse({ consumables, materials, forgeMaterials, forgeMaterialBatches, now, language, onItemSelect }: Props) {
  const en = language === 'en';
  const [filter, setFilter] = useState<WarehouseFilter>('all');
  const [search, setSearch] = useState('');
  const [forgeInfoOpen, setForgeInfoOpen] = useState(false);
  const groups = useMemo(() => {
    const q = search.trim().toLocaleLowerCase(language === 'en' ? 'en' : 'ru');
    const matches = (item: InventoryItem) =>
      !q || localizeText(item.name, language).toLocaleLowerCase(language === 'en' ? 'en' : 'ru').includes(q) ||
      localizeText(item.description, language).toLocaleLowerCase(language === 'en' ? 'en' : 'ru').includes(q);
    return {
      consumables: (filter === 'materials' ? [] : consumables).filter(matches),
      materials: (filter === 'consumables' ? [] : materials).filter(matches),
      forge: filter !== 'consumables' && forgeMaterials > 0 &&
        (!q || (en ? 'forge materials' : 'материалы кузницы').includes(q)),
    };
  }, [consumables, materials, forgeMaterials, filter, search, language, en]);
  const count = groups.consumables.length + groups.materials.length + Number(groups.forge);

  const forgeState = { forgeMaterials, forgeMaterialBatches } as GameState;
  const forgeTimer = forgeMaterialTimeLeftLabel(forgeState, language, now);

  return <section className="compact-warehouse" data-testid="compact-warehouse" aria-label={en ? 'Warehouse' : 'Склад'}>
    <div className="compact-warehouse__sign" style={{
      backgroundImage: `linear-gradient(110deg, rgba(65,31,10,.4), rgba(55,23,12,.5)), url("${import.meta.env.BASE_URL}assets/territory/ui/wooden-plaque.webp")`,
    }}>
      <Package size={21} aria-hidden="true" />
      <div className="min-w-0">
        <h2>{en ? 'WAREHOUSE' : 'СКЛАД'}</h2>
        <p>{en ? 'Your potions and crafting materials' : 'Зелья, эликсиры и материалы'}</p>
      </div>
      <strong>{count}</strong>
    </div>
    <div className="compact-warehouse__toolbar">
      <label className="compact-warehouse__search">
        <Search size={16} aria-hidden="true"/>
        <span className="sr-only">{en ? 'Search items' : 'Поиск предметов'}</span>
        <input type="search" value={search} maxLength={100} autoComplete="off"
          onChange={event => setSearch(event.target.value)}
          placeholder={en ? 'Find an item…' : 'Найти предмет…'}/>
      </label>
      <div className="compact-warehouse__filters" role="group" aria-label={en ? 'Item categories' : 'Категории предметов'}>
        {([
          ['all', en ? 'All' : 'Все', Package],
          ['consumables', en ? 'Potions' : 'Эликсиры', FlaskConical],
          ['materials', en ? 'Materials' : 'Материалы', Info],
        ] as const).map(([id, label, Icon]) =>
          <button key={id} type="button" aria-pressed={filter === id}
            className={filter === id ? 'compact-warehouse__filter compact-warehouse__filter--active' : 'compact-warehouse__filter'}
            onClick={() => setFilter(id)}><Icon size={13} aria-hidden="true"/>{label}</button>)}
      </div>
    </div>
    {groups.consumables.length > 0 && <div className="compact-warehouse__group">
      <h3><FlaskConical size={14} aria-hidden="true"/>{en ? 'Consumables' : 'Расходники'}<span>{groups.consumables.length}</span></h3>
      <div className="compact-warehouse__grid">{groups.consumables.map(item =>
        <WarehouseItem key={item.id} item={item} language={language} now={now} onSelect={onItemSelect}/>)}</div>
    </div>}
    {(groups.materials.length > 0 || groups.forge) && <div className="compact-warehouse__group">
      <h3><Package size={14} aria-hidden="true"/>{en ? 'Materials' : 'Материалы'}<span>{groups.materials.length + Number(groups.forge)}</span></h3>
      <div className="compact-warehouse__grid">
        {groups.materials.map(item => <WarehouseItem key={item.id} item={item} language={language} now={now} onSelect={onItemSelect}/>)}
        {groups.forge && <button type="button" className="warehouse-tile warehouse-tile--forge"
            aria-label={`${en ? 'Forge materials' : 'Материалы кузницы'}. ${forgeMaterials}. ${forgeTimer}`}
            onClick={() => setForgeInfoOpen(true)}>
          <span className="warehouse-tile__art">
            <img src={import.meta.env.BASE_URL + 'forge-material.webp'} alt="" loading="lazy" draggable={false}/>
            <span className="warehouse-tile__count">×{formatQuantity(forgeMaterials)}</span>
          </span>
          <span className="warehouse-tile__name">{en ? 'Forge materials' : 'Материалы кузницы'}</span>
          <span className="warehouse-tile__expiry"><Clock3 size={10} aria-hidden="true"/>{forgeTimer}</span>
        </button>}
      </div>
    </div>}
    {count === 0 && <div className="compact-warehouse__empty">
      <Package size={34} aria-hidden="true"/>
      <p>{search.trim() ? (en ? 'No matching items' : 'Ничего не найдено')
        : (en ? 'No items in this category yet' : 'В этой категории пока нет предметов')}</p>
      {search && <button type="button" onClick={() => setSearch('')}>{en ? 'Clear search' : 'Сбросить поиск'}</button>}
    </div>}
    {forgeInfoOpen && <IosGamePortal>
      <div className="warehouse-info-overlay" onClick={() => setForgeInfoOpen(false)}>
        <section className="warehouse-info-card" role="dialog" aria-modal="true"
          aria-label={en ? 'Forge materials' : 'Материалы кузницы'}
          onClick={event => event.stopPropagation()}>
          <button type="button" className="warehouse-info-card__close"
            aria-label={en ? 'Close' : 'Закрыть'} onClick={() => setForgeInfoOpen(false)}><X size={20}/></button>
          <img src={import.meta.env.BASE_URL + 'forge-material.webp'} alt="" className="warehouse-info-card__art"/>
          <h3>{en ? 'Forge materials' : 'Материалы кузницы'}</h3>
          <p>{en ? 'Used for equipment upgrades at the forge.' : 'Используются для улучшения экипировки в кузнице.'}</p>
          <strong>{en ? 'Quantity' : 'Количество'}: {formatQuantity(forgeMaterials)}</strong>
          <span><Clock3 size={15} aria-hidden="true"/> {en ? 'Shelf life' : 'Срок годности'}: {forgeTimer}</span>
          <button type="button" className="warehouse-info-card__done" onClick={() => setForgeInfoOpen(false)}>
            {en ? 'Close' : 'Закрыть'}
          </button>
        </section>
      </div>
    </IosGamePortal>}
  </section>;
}
