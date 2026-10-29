import { useState } from 'react';
import { Anchor, Check, ChevronDown, Clock3, Coins, Crown, Gem, LockKeyhole, Package, ScrollText, Shield, ShipWheel, Sparkles, Trash2 } from 'lucide-react';
import { WoodenPlaque } from '@/components/ui/WoodenPlaque';
import './expansionPanels.css';

/** Typed, read-only presentation contracts. These panels do not load/save state
 * or issue prizes until verified server APIs are wired by the owning task.
 * Text is original TERRITORY UI, not a claim of approved prices or game rules.
 */
export interface SummonOption {
  id: string;
  name: string;
  description: string;
  costLabel?: string;
  art: 'companion' | 'runes' | 'chest';
  freeReady?: boolean;
  disabledReason?: string;
}
export interface SummonStatus {
  freeRemaining: number;
  options: SummonOption[];
  notice?: string;
}
export interface DarkEnergyRelic {
  id: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  level: number;
  kind: 'ring' | 'amulet' | 'weapon' | 'armor' | 'other';
  attributes: { name: string; value: string }[];
  equippedSlot?: string;
  canDismantle?: boolean;
}
export interface DarkEnergyStatus {
  slots: { id: string; name: string; itemId: string | null }[];
  inventory: DarkEnergyRelic[];
  materialBalance?: number;
}
export interface SeaShip {
  id: string;
  name: string;
  level?: number;
  destination?: string;
  incomeLabel?: string;
  readyToClaim: boolean;
  arrivalAt?: string;
}
export interface SeaVoyageStatus {
  ships: SeaShip[];
  rankingPosition?: number;
  notice?: string;
}
type Translated = { ru: string; en: string };
const tr = (en: boolean, words: Translated) => en ? words.en : words.ru;
const fixedSummonArt: Record<SummonOption['art'], string> = {
  companion: 'assets/territory/map/icons/companions-v1.webp',
  runes: 'assets/territory/map/icons/rune-stones-v1.webp',
  chest: 'assets/territory/ui/materials/royal-chest.webp',
};
const darkArt: Record<DarkEnergyRelic['kind'], string> = {
  ring: 'assets/territory/ui/equipment-cartoon/ring.webp',
  amulet: 'assets/territory/ui/equipment-cartoon/amulet.webp',
  weapon: 'assets/territory/ui/equipment-cartoon/weapon.webp',
  armor: 'assets/territory/ui/equipment-cartoon/armor.webp',
  other: 'assets/territory/map/icons/rune-stones-v1.webp',
};
const rarityText: Record<DarkEnergyRelic['rarity'], Translated> = {
  common: { ru: 'Обычный', en: 'Common' },
  rare: { ru: 'Редкий', en: 'Rare' },
  epic: { ru: 'Эпический', en: 'Epic' },
  legendary: { ru: 'Легендарный', en: 'Legendary' },
};
function Pending({ en, title }: { en: boolean; title: string }) {
  return <div className="expansion-panel__pending"><LockKeyhole size={27}/>
    <p>{en ? title + ' is not connected to the game server yet.' : 'Режим «' + title + '» ещё не подключён к игровому серверу.'}</p>
    <small>{en ? 'No purchases, rewards or progress have changed.' : 'Покупки, награды и прогресс не изменялись.'}</small>
  </div>;
}
function Head({ title, subtitle, icon }: { title: string; subtitle: string; icon: string }) {
  return <header className="expansion-panel__head">
    <img src={import.meta.env.BASE_URL + icon} alt="" loading="lazy"/>
    <div><WoodenPlaque>{title}</WoodenPlaque><p>{subtitle}</p></div>
  </header>;
}

export function SummoningPanel({ language, status, busy = false, onSummon }: {
  language: 'ru' | 'en';
  status?: SummonStatus | null;
  busy?: boolean;
  onSummon?: (optionId: string) => void;
}) {
  const en = language === 'en';
  return <section className="expansion-panel" data-testid="territory-summon-panel">
    <Head title={en ? 'SUMMONING' : 'ПРИЗЫВ'} subtitle={en ? 'Recruit allies through verified attempts' : 'Призывай союзников за подтверждённые попытки'} icon={fixedSummonArt.companion}/>
    {!status ? <Pending en={en} title={en ? 'Summoning' : 'Призыв'}/> : <>
      <div className="expansion-panel__summary">
        <Sparkles size={18}/><span>{en ? 'Free attempts' : 'Бесплатные попытки'}</span>
        <b>{status.freeRemaining.toLocaleString(en ? 'en-US' : 'ru-RU')}</b>
      </div>
      <div className="expansion-panel__cards">
        {status.options.map(option => {
          const canAttempt = !busy && !!onSummon && !option.disabledReason && (option.freeReady || !!option.costLabel);
          return <article className="expansion-panel__card" key={option.id}>
            <img src={import.meta.env.BASE_URL + fixedSummonArt[option.art]} alt="" loading="lazy"/>
            <div><h3>{option.name}</h3><p>{option.description}</p>
              <span>{option.freeReady ? en ? 'Free attempt ready' : 'Бесплатная попытка готова'
                : option.costLabel ?? option.disabledReason ?? (en ? 'Not yet available' : 'Пока недоступно')}</span></div>
            <button type="button" disabled={!canAttempt} onClick={() => onSummon?.(option.id)}>
              {en ? 'Summon' : 'Призвать'}
            </button>
          </article>;
        })}
      </div>
      {status.notice && <p className="expansion-panel__note" role="status">{status.notice}</p>}
      {!status.options.length && <p className="expansion-panel__empty">{en ? 'No summoning offers are active.' : 'Активных предложений призыва пока нет.'}</p>}
    </>}
  </section>;
}

export function DarkEnergyPanel({ language, status, busy = false, onEquip, onDismantle }: {
  language: 'ru' | 'en';
  status?: DarkEnergyStatus | null;
  busy?: boolean;
  onEquip?: (itemId: string, slotId: string) => void;
  onDismantle?: (itemId: string) => void;
}) {
  const en = language === 'en';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | DarkEnergyRelic['rarity']>('all');
  const [confirmDismantle, setConfirmDismantle] = useState(false);
  const selected = status?.inventory.find(item => item.id === selectedId);
  const slot = status?.slots.find(x => x.id === slotId) ?? status?.slots.find(x => x.itemId === null);
  const available = status?.inventory.filter(item => filter === 'all' || item.rarity === filter) ?? [];

  return <section className="expansion-panel" data-testid="territory-dark-energy-panel">
    <Head title={en ? 'DARK ENERGY' : 'ТЁМНАЯ ЭНЕРГИЯ'} subtitle={en ? 'Relics, slots and dismantling' : 'Реликвии, ячейки и разбор'} icon="assets/territory/map/icons/rune-stones-v1.webp"/>
    {!status ? <Pending en={en} title={en ? 'Dark energy' : 'Тёмная энергия'}/> : <>
      <h3 className="expansion-panel__subhead"><Shield size={16}/>{en ? 'Equipped relics' : 'Снаряжённые реликвии'}</h3>
      <div className="expansion-panel__slots">
        {status.slots.map(slot => {
          const item = status.inventory.find(i => i.id === slot.itemId);
          return <button key={slot.id} type="button" aria-pressed={slot.id === slotId}
            onClick={() => { setSlotId(slot.id); setSelectedId(item?.id ?? null); setConfirmDismantle(false); }}
            className="expansion-panel__slot">
            {item ? <img src={import.meta.env.BASE_URL + darkArt[item.kind]} alt="" loading="lazy"/> : <LockKeyhole size={21} aria-hidden="true"/>}
            <span>{slot.name}</span>
          </button>;
        })}
      </div>
      {typeof status.materialBalance === 'number' && <div className="expansion-panel__summary">
        <Gem size={17}/><span>{en ? 'Energy materials' : 'Материалы энергии'}</span><b>{status.materialBalance.toLocaleString(en ? 'en-US' : 'ru-RU')}</b>
      </div>}
      <h3 className="expansion-panel__subhead"><Package size={16}/>{en ? 'Relic storage' : 'Хранилище реликвий'}</h3>
      <label className="expansion-panel__filter"><span>{en ? 'Filter' : 'Фильтр'}</span>
        <select value={filter} onChange={e => { setFilter(e.target.value as typeof filter); setSelectedId(null); }}>
          <option value="all">{en ? 'All rarities' : 'Любая редкость'}</option>
          {Object.entries(rarityText).map(([key, label]) => <option key={key} value={key}>{tr(en,label)}</option>)}
        </select><ChevronDown size={14}/>
      </label>
      <div className="expansion-panel__relic-grid">
        {available.map(item => <button key={item.id} type="button" aria-pressed={selectedId === item.id}
          className={`expansion-panel__relic expansion-panel__relic--${item.rarity}`}
          onClick={() => { setSelectedId(item.id); setConfirmDismantle(false); }}>
          <img src={import.meta.env.BASE_URL + darkArt[item.kind]} alt="" loading="lazy"/>
          <span>{item.name}</span><b>{en ? 'Lv' : 'Ур'} {item.level}</b>
          {item.equippedSlot && <Check size={13} className="expansion-panel__equipped"/>}
        </button>)}
      </div>
      {!available.length && <p className="expansion-panel__empty">{en ? 'No relics in this category.' : 'В этой категории реликвий пока нет.'}</p>}
      {selected && <div className="expansion-panel__details">
        <h4>{selected.name} <small>{tr(en,rarityText[selected.rarity])}</small></h4>
        {selected.attributes.map((attribute,i)=><p key={i}>{attribute.name}<b>{attribute.value}</b></p>)}
        <div className="expansion-panel__actions">
          <button type="button" disabled={!onEquip || !slot || !!selected.equippedSlot || busy}
            onClick={() => { if(slot)onEquip?.(selected.id,slot.id); }}>
            <Check size={14}/>{en ? 'Equip' : 'Надеть'}
          </button>
          <button type="button" disabled={!onDismantle || !selected.canDismantle || !!selected.equippedSlot || busy}
            onClick={() => setConfirmDismantle(true)}>
            <Trash2 size={14}/>{en ? 'Dismantle' : 'Разобрать'}
          </button>
        </div>
        {confirmDismantle && <div className="expansion-panel__confirm">
          <p>{en ? 'Confirm dismantling this relic? This cannot be undone.' : 'Разобрать реликвию? Действие нельзя отменить.'}</p>
          <div className="expansion-panel__actions">
            <button type="button" onClick={() => setConfirmDismantle(false)}>{en ? 'Cancel' : 'Отмена'}</button>
            <button type="button" disabled={!onDismantle || busy} onClick={() => {onDismantle?.(selected.id);setConfirmDismantle(false);setSelectedId(null);}}>{en ? 'Confirm' : 'Подтвердить'}</button>
          </div>
        </div>}
      </div>}
    </>}
  </section>;
}

export function SeaVoyagePanel({ language, status, busy = false, onClaim, onOpenShips, onOpenRanking }: {
  language: 'ru' | 'en';
  status?: SeaVoyageStatus | null;
  busy?: boolean;
  onClaim?: (shipId: string) => void;
  onOpenShips?: () => void;
  onOpenRanking?: () => void;
}) {
  const en = language === 'en';
  return <section className="expansion-panel" data-testid="territory-sea-voyage-panel">
    <Head title={en ? 'SEA VOYAGES' : 'МОРСКИЕ ПОХОДЫ'} subtitle={en ? 'Your fleet and verified expedition returns' : 'Флот, плавания и подтверждённый доход'} icon="ic-sea.webp"/>
    {!status ? <Pending en={en} title={en ? 'Sea voyages' : 'Морские походы'}/> : <>
      <div className="expansion-panel__sea-actions">
        <button type="button" disabled={!onOpenShips} onClick={onOpenShips}><ShipWheel size={15}/>{en ? 'Shipyard' : 'Верфь'}</button>
        <button type="button" disabled={!onOpenRanking} onClick={onOpenRanking}><Crown size={15}/>{en ? 'Ranking' : 'Рейтинг'}</button>
      </div>
      {status.rankingPosition !== undefined && <div className="expansion-panel__summary"><Crown size={17}/><span>{en ? 'Fleet ranking' : 'Рейтинг флота'}</span><b>№ {status.rankingPosition}</b></div>}
      {status.ships.length ? <div className="expansion-panel__cards">{status.ships.map(ship => <article className="expansion-panel__card expansion-panel__card--sea" key={ship.id}>
        <img src={import.meta.env.BASE_URL + 'monopoly/ship.webp'} alt="" loading="lazy"/>
        <div><h3>{ship.name}</h3>
          {ship.destination && <p><Anchor size={11}/> {ship.destination}</p>}
          {ship.level !== undefined && <p>{en ? 'Level' : 'Уровень'} {ship.level}</p>}
          {ship.incomeLabel && <span><Coins size={12}/> {ship.incomeLabel}</span>}
          {ship.arrivalAt && <small><Clock3 size={11}/> {en ? 'Returns' : 'Возврат'}: {new Date(ship.arrivalAt).toLocaleString(en ? 'en-US' : 'ru-RU')}</small>}
        </div>
        <button type="button" disabled={!ship.readyToClaim || !onClaim || busy}
          onClick={() => onClaim?.(ship.id)}>
          {ship.readyToClaim ? en ? 'Claim' : 'Забрать' : en ? 'At sea' : 'В море'}
        </button>
      </article>)}</div> : <p className="expansion-panel__empty">{en ? 'You do not own ships yet.' : 'У тебя пока нет кораблей.'}</p>}
      {status.notice && <p className="expansion-panel__note" role="status">{status.notice}</p>}
    </>}
    <p className="expansion-panel__footnote"><ScrollText size={13}/>{en
      ? 'A ship returns rewards only after the game server confirms the voyage.'
      : 'Награда за плавание начисляется только после подтверждения сервером игры.'}</p>
  </section>;
}
