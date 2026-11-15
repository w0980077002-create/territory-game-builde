import { POTIONS, potionBlock, type World } from '@/game/cavePreviewWorld/engine';

export const TEST_GEAR = [
  ['helmet', 'Шлем', 'Helmet'], ['amulet', 'Амулет', 'Amulet'], ['armor', 'Броня', 'Armor'],
  ['weapon', 'Оружие', 'Weapon'], ['shield', 'Щит', 'Shield'], ['ring', 'Кольцо', 'Ring'], ['boots', 'Сапоги', 'Boots'],
] as const;
export const TEST_NAV = [
  ['city', 'Город', 'City', 'nav-city.webp'], ['inventory', 'Инвентарь', 'Inventory', 'nav-inventory.webp'],
  ['hero', 'Герой', 'Hero', 'nav-hero-crown.webp'], ['battle', 'Бой', 'Battle', 'nav-battle.webp'],
  ['map', 'Карта', 'Map', 'nav-map-parchment.webp'], ['games', 'Игры', 'Games', 'nav-games.webp'], ['clan', 'Клан', 'Clan', 'nav-clan.webp'],
] as const;
export function PlaytestGear({ assetUrl, en, onInspect }: { assetUrl: (p: string) => string; en: boolean; onInspect: (i: number) => void }) {
  return <div className="cx-gear" aria-label={en ? 'Seven ordinary equipment slots' : '7 обычных слотов экипировки'}>
    {TEST_GEAR.map(([id, ru, english], i) => <button key={id} type="button" aria-label={en ? english : ru} onClick={() => onInspect(i)}>
      <img src={assetUrl(`assets/territory/ui/equipment/${id}.webp`)} alt=""/><small>{en ? 'Lv.6' : 'Ур.6'}</small>
    </button>)}
  </div>;
}
export function PlaytestBelt({ world, en, assetUrl, onDrink }: { world: World; en: boolean; assetUrl: (p: string) => string; onDrink: (slot: number) => void }) {
  return <div className="cx-belt" aria-label={en ? 'Seven potion slots' : '7 ячеек пояса'}>
    {POTIONS.map((p, i) => <button key={p.id} type="button" onClick={() => onDrink(i)}
      aria-label={`${en ? p.en : p.ru} · ${world.belt[i]}/5`} title={en ? p.effectEn : p.effectRu}
      disabled={potionBlock(world, i) !== null} style={{ '--potion': p.color } as React.CSSProperties}>
      <img src={assetUrl(`assets/territory/cave/playtest/potion-${p.id}.svg`)} alt=""/>
      <b>{world.belt[i]}</b>
    </button>)}
  </div>;
}
export function PlaytestNav({ en, assetUrl, active, onNavigate }: { en: boolean; assetUrl: (p: string) => string; active: string; onNavigate: (id: string) => void }) {
  return <nav className="cx-native-nav" aria-label={en ? 'TERRITORY navigation · test' : 'Навигация TERRITORY · тест'}>
    {TEST_NAV.map(([id, ru, english, art]) => <button key={id} type="button" aria-current={active === id ? 'page' : undefined}
      aria-label={en ? english : ru} onClick={() => onNavigate(id)}><img src={assetUrl(art)} alt=""/><span>{en ? english : ru}</span></button>)}
  </nav>;
}
