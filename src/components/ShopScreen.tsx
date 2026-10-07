import { useEffect, useState } from 'react';
import { useStore } from '@/game/store';
import { useGame, buyItem } from '@/game/actions';
import { generateShopItems } from '@/game/engine';
import { rarityColor } from '@/game/ui';
import { CheckCircle2, Sword, Shield, Heart, Star } from 'lucide-react';
import type { GameState, ShopItem } from '@/game/types';
import { ItemArt } from './ui/ItemArt';
import { Currency, formatAmount } from './ui/Currency';
import { Modal } from './ui/Modal';

type Tab = 'potions' | 'equipment' | 'resources';

const TABS: { id: Tab; label: string }[] = [
  { id: 'potions', label: 'Зелья' },
  { id: 'equipment', label: 'Снаряжение' },
  { id: 'resources', label: 'Ресурсы' },
];

const inTab = (item: ShopItem, tab: Tab) =>
  tab === 'equipment' ? item.type === 'equipment'
    : tab === 'resources' ? item.type === 'stone' || item.type === 'gem_pack' || item.type === 'material'
    : item.type === 'potion' || item.type === 'elixir' || item.type === 'arena';

function canAfford(state: GameState, item: ShopItem) {
  return (!item.priceGold || state.player.gold >= item.priceGold) && (!item.priceGems || state.player.gems >= item.priceGems);
}

function Price({ item, size = 14 }: { item: ShopItem; size?: number }) {
  return item.priceGems
    ? <Currency kind="gems" value={item.priceGems} size={size} />
    : <Currency kind="gold" value={item.priceGold} size={size} />;
}

function resultText(item: ShopItem) {
  if (item.type === 'stone') return `+${item.amount ?? 1} боевых камней`;
  if (item.type === 'gem_pack') return `+${item.amount ?? 0} синих кристаллов`;
  if (item.type === 'material') return '+1 материал для кузницы';
  if (item.type === 'equipment') return 'Предмет добавлен в инвентарь';
  return 'Добавлено в инвентарь';
}

export function ShopScreen() {
  const state = useStore(useGame);
  const allItems = generateShopItems(state.currentChapter);
  const [tab, setTab] = useState<Tab>('potions');
  const [picked, setPicked] = useState<ShopItem | null>(null);
  const [result, setResult] = useState<{ item: ShopItem; text: string } | null>(null);
  const items = allItems.filter((i) => inTab(i, tab));

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 2600);
    return () => clearTimeout(t);
  }, [result]);

  const buy = (item: ShopItem) => {
    const next = buyItem(useGame.get(), item);
    if (!next) return;
    useGame.set(next);
    setPicked(null);
    setResult({ item, text: resultText(item) });
  };

  return (
    <div className="space-y-3 animate-fade-in pb-2">
      <div className="relative rounded-2xl overflow-hidden border border-amber-500/20 p-4">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-900/40 via-[#16130d] to-[#0f1115]" />
        <div className="relative flex items-center gap-3">
          <img src="/ic-shop.webp" alt="" className="w-12 h-12 object-contain" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-amber-100">Лавка</h2>
            <p className="text-xs text-gray-400">Зелья, снаряжение и боевые камни</p>
          </div>
        </div>
        <div className="relative flex flex-wrap gap-2 mt-3">
          {([['gold', state.player.gold], ['gems', state.player.gems], ['stones', state.battleStones]] as const).map(([k, v]) => (
            <span key={k} className="hud-chip pl-1.5"><Currency kind={k} value={formatAmount(v)} size={16} className="text-xs text-white" /></span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-black/30 border border-white/10">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`h-9 rounded-xl text-xs font-semibold transition-all ${tab === t.id ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-black' : 'text-gray-400'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const color = rarityColor(item.rarity);
          const ok = canAfford(state, item);
          return (
            <button
              key={item.id}
              onClick={() => setPicked(item)}
              className="relative text-left rounded-2xl border bg-gradient-to-b from-[#1f232d] to-[#12151b] p-2.5 flex flex-col transition-all active:scale-[0.97] hover:brightness-110"
              style={{ borderColor: `${color}55` }}
            >
              <div className="h-20 flex items-center justify-center rounded-xl bg-black/30 mb-2">
                <ItemArt item={item} size={64} />
              </div>
              <p className="text-xs font-semibold leading-tight line-clamp-2 min-h-[30px]" style={{ color }}>{item.name}</p>
              {item.amount && item.type !== 'equipment' && (
                <p className="text-[10px] text-gray-400">x{item.amount}</p>
              )}
              <span className={`mt-1.5 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${ok ? 'bg-amber-500/90 text-black' : 'bg-white/5 text-gray-500'}`}>
                <Price item={item} />
              </span>
            </button>
          );
        })}
      </div>

      {picked && (
        <Modal title={picked.name} onClose={() => setPicked(null)}>
          <PurchaseSheet item={picked} state={state} onBuy={() => buy(picked)} />
        </Modal>
      )}

      {result && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 w-[calc(100%-32px)] max-w-sm rounded-2xl border border-emerald-400/40 bg-[#0f1f1a]/95 backdrop-blur-md px-3 py-2.5 flex items-center gap-3 shadow-2xl animate-sheet-up">
          <ItemArt item={result.item} size={36} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-200 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Куплено</p>
            <p className="text-xs text-gray-300 truncate">{result.text}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function PurchaseSheet({ item, state, onBuy }: { item: ShopItem; state: GameState; onBuy: () => void }) {
  const ok = canAfford(state, item);
  const eq = item.equipment;
  const balance = item.priceGems ? state.player.gems : state.player.gold;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-24 h-24 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center shrink-0">
          <ItemArt item={item} size={80} />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider" style={{ color: rarityColor(item.rarity) }}>{item.rarity}</p>
          <p className="text-sm text-gray-300 mt-1 leading-relaxed">{item.description}</p>
        </div>
      </div>
      {eq && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {eq.attack ? <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 h-8 text-orange-300"><Sword className="w-3.5 h-3.5" /> Атака +{eq.attack}</span> : null}
          {eq.defense ? <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 h-8 text-sky-300"><Shield className="w-3.5 h-3.5" /> Защита +{eq.defense}</span> : null}
          {eq.hp ? <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 h-8 text-red-300"><Heart className="w-3.5 h-3.5" /> Здоровье +{eq.hp}</span> : null}
          {eq.critChance ? <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 h-8 text-yellow-300"><Star className="w-3.5 h-3.5" /> Крит +{eq.critChance}%</span> : null}
        </div>
      )}
      <div className="flex items-center justify-between rounded-xl bg-black/30 border border-white/10 px-3 h-11 text-sm">
        <span className="text-gray-400">Цена</span>
        <span className="text-white"><Price item={item} size={18} /></span>
      </div>
      <p className="text-xs text-gray-500 -mt-2 px-1">У тебя: {balance}</p>
      <button
        disabled={!ok}
        onClick={onBuy}
        className="w-full h-12 rounded-2xl bg-gradient-to-b from-amber-400 to-amber-600 text-black font-bold active:scale-[0.98] transition-transform disabled:opacity-40 disabled:bg-none disabled:bg-white/10 disabled:text-gray-400"
      >
        {ok ? 'Купить' : 'Не хватает средств'}
      </button>
    </div>
  );
}
