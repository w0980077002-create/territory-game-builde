/** Dark Cave HUD: vitals, the 12 dark slots with separate wings, belt, blessing and TERRITORY navigation. */
import { caveElixir, CAVE_ELIXIRS, type CaveElixirId } from '@/game/cave/blessing';
import type { CaveSandbox } from '@/game/cave/sandbox';
import type { CaveDispatch } from '@/game/cave/sandboxStore';
import { UMBRA_SLOTS, UMBRA_TEMPLATES, umbraRank, umbraTemplate, type UmbraSlotId } from '@/game/cave/umbra';
import { POTIONS, potionBlock, type World } from '@/game/cavePreviewWorld/engine';

type Url = (path: string) => string;
export const NAV = [
  ['city', 'Город', 'City', 'nav-city.webp'], ['inventory', 'Инвентарь', 'Inventory', 'nav-inventory.webp'],
  ['hero', 'Герой', 'Hero', 'nav-hero-crown.webp'], ['battle', 'Бой', 'Battle', 'nav-battle.webp'],
  ['map', 'Карта', 'Map', 'nav-map-parchment.webp'], ['games', 'Игры', 'Games', 'nav-games.webp'], ['clan', 'Клан', 'Clan', 'nav-clan.webp'],
] as const;
export const POTION_ART = ['potion-hp-viking.webp', 'potion-hp-large-viking.webp', 'assets/territory/ui/items/potion-mana.webp', 'elixir-defense-viking.webp',
  'assets/territory/ui/items/potion-fire.webp', 'assets/territory/ui/items/potion-green.webp', 'potion-time-viking.webp'];
export const HUD_ART = ['ic-honor.webp', 'ic-blessing.webp', 'ic-settings.webp', 'assets/territory/cave-loot/2026-11-06/15-rune-emblem.webp', ...POTION_ART];
export const WINGS = { astral: ['Звёздные крылья', 'Astral wings'], ember: ['Огненные крылья', 'Ember wings'] } as const;
/** 1 234 567 → 1.23M; keeps the orbs readable at any gear level. */
export const compact = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(Math.ceil(n));
const spaced = (n: number) => String(Math.ceil(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function Orb({ kind, value, max, label }: { kind: 'hp' | 'energy'; value: number; max: number; label: string }) {
  const part = Math.max(0, Math.min(1, value / max));
  return <div className={`cx-orb cx-orb-${kind}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(value)}>
    <i style={{ height: `${part * 100}%` }} />
    <svg viewBox="0 0 24 24" aria-hidden="true">{kind === 'hp'
      ? <path d="M12 20.5C5.5 15.6 3 12.4 3 8.9 3 6.2 5 4.3 7.4 4.3c1.8 0 3.4 1 4.6 2.7 1.2-1.7 2.8-2.7 4.6-2.7C19 4.3 21 6.2 21 8.9c0 3.5-2.5 6.7-9 11.6z" />
      : <path d="M13.6 2.5 5 13.4h5.6l-1.3 8.1L18.9 10h-5.9z" />}</svg>
    <b>{compact(value)}</b>
  </div>;
}

export function Vitals({ view, en, level, onStats }: { view: World; en: boolean; level: number; onStats: () => void }) {
  return <div className="cx-vitals">
    <Orb kind="hp" value={view.hp} max={view.maxHp} label={en ? 'Health' : 'Здоровье'} />
    <div className="cx-xp" aria-label={en ? `Hero level ${level}` : `Уровень героя ${level}`}>
      <span className="cx-lv"><b>{level}</b></span>
      <div className="cx-hpbar"><i style={{ width: `${100 * view.hp / view.maxHp}%` }} /><u style={{ width: `${100 * Math.min(1, (view.rules === 2 ? (view.phase === 'VICTORY' ? 1 : view.stars.length ? (view.stars.length - 1 + Math.min(1, (view.wave / 3))) / 5 : 0) : view.kills / 16))}%` }} />
        <span>{spaced(view.hp)}/{spaced(view.maxHp)}</span></div>
      <button type="button" className="cx-stats" aria-label={en ? 'Hero stats' : 'Характеристики героя'} onClick={onStats}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11h3v9zm5.5 0V5h3v15zM16 20v-6h3v6z" /></svg></button>
    </div>
    <Orb kind="energy" value={view.energy} max={100} label={en ? 'Energy' : 'Энергия'} />
  </div>;
}

/** Twelve dark slots in the approved mosaic and a separate wings tile. Nothing here is the ordinary 7-slot gear. */
export function UmbraMosaic({ bank, en, assetUrl, onOpen }: { bank: CaveSandbox; en: boolean; assetUrl: Url; onOpen: (slot: UmbraSlotId | 'wings') => void }) {
  return <div className="cx-umbra" role="group" aria-label={en ? 'Dark gear: 12 slots and wings' : 'Тёмное снаряжение: 12 слотов и крылья'}>
    {UMBRA_SLOTS.map(slot => {
      const item = bank.items.find(i => i.id === bank.loadout[slot.id]);
      const template = item ? umbraTemplate(item.templateId) : UMBRA_TEMPLATES.find(t => t.slot === slot.id);
      const name = en ? slot.en : slot.ru;
      return <button key={slot.id} type="button" data-slot={slot.id} data-testid="cx-umbra-slot" className={item ? 'cx-tile' : 'cx-tile cx-tile-empty'}
        style={item ? { '--rank': umbraRank(item.rank).color } as React.CSSProperties : undefined}
        aria-label={item ? `${name} · ${en ? 'Lv.' : 'ур.'}${item.level}${item.enhance ? ` +${item.enhance}` : ''}` : `${name} · ${en ? 'empty' : 'пусто'}`} onClick={() => onOpen(slot.id)}>
        {template && <img src={assetUrl(template.art)} alt="" draggable={false} />}
        {item ? <span>{en ? 'Lv.' : 'ур.'}{item.level}{item.enhance > 0 && <em> +{item.enhance}</em>}</span> : <span className="cx-plus">+</span>}
      </button>;
    })}
    <button type="button" data-slot="wings" data-testid="cx-wings-slot" className={bank.previewWings === 'none' ? 'cx-tile cx-tile-wings cx-tile-empty' : 'cx-tile cx-tile-wings'}
      aria-label={bank.previewWings === 'none' ? (en ? 'Wings · empty' : 'Крылья · пусто') : `${en ? 'Wings' : 'Крылья'} · ${WINGS[bank.previewWings][en ? 1 : 0]}`} onClick={() => onOpen('wings')}>
      <img src={assetUrl(`assets/territory/cave/playtest/wings-${bank.previewWings === 'none' ? 'astral' : bank.previewWings}.svg`)} alt="" draggable={false} />
      <span>{bank.previewWings === 'none' ? (en ? 'Wings' : 'Крылья') : WINGS[bank.previewWings][en ? 1 : 0].split(' ')[0]}</span>
    </button>
  </div>;
}

export function Belt({ world, en, assetUrl, onDrink, onAuto }: { world: World; en: boolean; assetUrl: Url; onDrink: (slot: number) => void; onAuto: () => void }) {
  return <div className="cx-belt" role="group" aria-label={en ? 'Seven potion slots' : '7 ячеек пояса'}>
    {POTIONS.map((p, i) => <button key={p.id} type="button" onClick={() => onDrink(i)}
      aria-label={`${en ? p.en : p.ru} · ${world.belt[i]}/5`} title={en ? p.effectEn : p.effectRu}
      disabled={potionBlock(world, i) !== null} style={{ '--potion': p.color } as React.CSSProperties}>
      <img src={assetUrl(POTION_ART[i])} alt="" draggable={false} /><b>{world.belt[i]}</b>
    </button>)}
    <button type="button" className="cx-auto-potions" aria-label={en ? 'Auto potions' : 'Автозелья'} aria-pressed={world.autoPotions} onClick={onAuto}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3h4v3.2l3.4 5.6c1.9 3.2-.3 7.2-4 7.2h-2.8c-3.7 0-5.9-4-4-7.2L10 6.2z" /></svg><small>{en ? 'AUTO' : 'АВТО'}</small>
    </button>
  </div>;
}

export function Nav({ en, assetUrl, active, onNavigate }: { en: boolean; assetUrl: Url; active: string; onNavigate: (id: string) => void }) {
  return <nav className="cx-native-nav" aria-label={en ? 'TERRITORY navigation' : 'Навигация TERRITORY'}>
    {NAV.map(([id, ru, english, art]) => <button key={id} type="button" aria-current={active === id ? 'page' : undefined}
      aria-label={en ? english : ru} onClick={() => onNavigate(id)}><img src={assetUrl(art)} alt="" draggable={false} /><span>{en ? english : ru}</span></button>)}
  </nav>;
}

/** Cave Blessing: three slots and the elixir shelf, on the device-local dark storage. */
export function BlessingPanel({ bank, dispatch, en, assetUrl, onNotice }: { bank: CaveSandbox; dispatch: CaveDispatch; en: boolean; assetUrl: Url; onNotice: (text: string) => void }) {
  const place = (id: CaveElixirId) => {
    const free = bank.blessSlots.findIndex(slot => !slot);
    if (free < 0) return onNotice(en ? 'All three slots are filled' : 'Все три ячейки заняты');
    if (!(bank.elixirs[id] ?? 0)) dispatch({ type: 'takeElixir', elixir: id });
    if (dispatch({ type: 'bless', slot: free, elixir: id }).ok) onNotice(`${en ? caveElixir(id).en : caveElixir(id).ru} · ${en ? caveElixir(id).boostEn : caveElixir(id).boostRu}`);
  };
  return <div className="cx-camp cx-blessing-panel">
    <h1>{en ? 'Cave Blessing' : 'Благословение Пещеры'}</h1>
    <p>{en ? 'Each elixir raises the chance of its loot in the next victory.' : 'Каждый эликсир повышает шанс своей добычи в следующей победе.'}</p>
    <div className="cx-bless-slots">{bank.blessSlots.map((id, index) => <button key={index} type="button" data-testid="cave-blessing-slot" className={id ? 'full' : ''}
      aria-label={`${en ? 'Blessing slot' : 'Ячейка благословения'} ${index + 1}${id ? ': ' + (en ? caveElixir(id).en : caveElixir(id).ru) : en ? ', empty' : ', пусто'}`}
      onClick={() => { if (id) dispatch({ type: 'bless', slot: index, elixir: null }); }}>
      {id ? <><img src={assetUrl(caveElixir(id).art)} alt="" /><small>{en ? caveElixir(id).boostEn : caveElixir(id).boostRu}</small></> : <span>+</span>}</button>)}</div>
    <div className="cx-bless-shelf">{CAVE_ELIXIRS.map(e => <button key={e.id} type="button" data-testid="cave-blessing-pick" onClick={() => place(e.id)}>
      <img src={assetUrl(e.art)} alt="" /><b>{en ? e.en : e.ru}</b><small>{en ? e.boostEn : e.boostRu}</small></button>)}</div>
    <small>{en ? 'Tap an elixir to place it. Tap a filled slot to take it back.' : 'Коснитесь эликсира, чтобы поставить. Коснитесь занятой ячейки, чтобы вынуть.'}</small>
  </div>;
}
