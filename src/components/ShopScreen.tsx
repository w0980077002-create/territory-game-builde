import { useEffect, useState, useCallback } from 'react';
import { useStore } from '@/game/store';
import { useGame, buyItem, DAILY_STONE_LIMIT, stonesRemainingToday, maxStoneQty } from '@/game/actions';
import { generateShopItems } from '@/game/engine';
import { rarityColor } from '@/game/ui';
import { CheckCircle2, Sword, Shield, Heart, Star, Minus, Plus, Clock } from 'lucide-react';
import type { GameState, ShopItem } from '@/game/types';
import { ItemArt } from './ui/ItemArt';
import { Currency, formatAmount } from './ui/Currency';
import { Modal } from './ui/Modal';
import { useLive, SHOP_SALE_FACTOR } from '@/game/live';

const discount = (price: number | undefined) => (price ? Math.max(1, Math.ceil(price * SHOP_SALE_FACTOR)) : price);

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

function canAfford(state: GameState, item: ShopItem, qty: number = 1) {
  const goldCost = (item.priceGold ?? 0) * qty;
  const gemCost = (item.priceGems ?? 0) * qty;
  return (!item.priceGold || state.player.gold >= goldCost) && (!item.priceGems || state.player.gems >= gemCost);
}

function Price({ item, size = 14 }: { item: ShopItem; size?: number }) {
  return item.priceGems
    ? <Currency kind="gems" value={item.priceGems} size={size} />
    : <Currency kind="gold" value={item.priceGold} size={size} />;
}

function resultText(item: ShopItem, qty: number) {
  if (item.type === 'stone') return `+${(item.amount ?? 1) * qty} боевых камней`;
  if (item.type === 'gem_pack') return `+${(item.amount ?? 0) * qty} синих кристаллов`;
  if (item.type === 'material') return `+${qty} материал(ов) для кузницы`;
  if (item.type === 'equipment') return `Предметы добавлены в инвентарь (${qty})`;
  return `Добавлено в инвентарь: ${qty}`;
}

function useMidnightCountdown() {
  const [remaining, setRemaining] = useState(() => msUntilMidnight());
  useEffect(() => {
    const interval = setInterval(() => setRemaining(msUntilMidnight()), 1000);
    return () => clearInterval(interval);
  }, []);
  return remaining;
}

function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function ShopScreen() {
  const state = useStore(useGame);
  const { shopSale } = useStore(useLive);
  const allItems = generateShopItems(state.currentChapter).map((i) =>
    shopSale ? { ...i, priceGold: discount(i.priceGold) ?? 0, priceGems: discount(i.priceGems) } : i,
  );
  const [tab, setTab] = useState<Tab>('potions');
  const [picked, setPicked] = useState<ShopItem | null>(null);
  const [result, setResult] = useState<{ item: ShopItem; text: string } | null>(null);
  const items = allItems.filter((i) => inTab(i, tab));

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 2600);
    return () => clearTimeout(t);
  }, [result]);

  const buy = (item: ShopItem, qty: number) => {
    const next = buyItem(useGame.get(), item, qty);
    if (!next) return;
    useGame.set(next);
    setPicked(null);
    setResult({ item, text: resultText(item, qty) });
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
          {shopSale && (
            <span className="shrink-0 rounded-lg bg-gradient-to-b from-red-500 to-rose-700 px-2 py-1 text-xs font-bold text-white shadow-[0_0_12px_rgba(244,63,94,0.6)] animate-pulse">-20%</span>
          )}
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
          const ok = canAfford(state, item) && (item.type !== 'stone' || stonesRemainingToday(state) >= (item.amount ?? 1));
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
          <PurchaseSheet item={picked} state={state} onBuy={(qty) => buy(picked, qty)} />
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

function PurchaseSheet({ item, state, onBuy }: { item: ShopItem; state: GameState; onBuy: (qty: number) => void }) {
  const isStone = item.type === 'stone';
  const stonePerUnit = isStone ? (item.amount ?? 1) : 0;
  const stonesLeft = isStone ? stonesRemainingToday(state) : 0;
  const stonesBought = isStone ? DAILY_STONE_LIMIT - stonesLeft : 0;

  const priceEach = item.priceGems ?? item.priceGold ?? 0;
  const balance = item.priceGems ? state.player.gems : state.player.gold;
  const maxByBalance = priceEach > 0 ? Math.floor(balance / priceEach) : 1;
  const maxByStoneLimit = isStone ? maxStoneQty(state, item) : Infinity;
  const maxQty = Math.max(1, Math.min(maxByBalance, maxByStoneLimit));

  const countdownMs = useMidnightCountdown();

  const [qty, setQty] = useState(1);
  const qtyClamped = Math.min(qty, maxQty);
  const totalCost = priceEach * qtyClamped;
  const totalStones = stonePerUnit * qtyClamped;
  const ok = maxQty >= 1 && qtyClamped >= 1 && (!isStone || stonesLeft >= totalStones);

  useEffect(() => {
    setQty(1);
  }, [item.id]);

  const clamp = useCallback((v: number) => Math.max(1, Math.min(v, maxQty)), [maxQty]);

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
      {item.equipment && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {item.equipment.attack ? <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 h-8 text-orange-300"><Sword className="w-3.5 h-3.5" /> Атака +{item.equipment.attack}</span> : null}
          {item.equipment.defense ? <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 h-8 text-sky-300"><Shield className="w-3.5 h-3.5" /> Защита +{item.equipment.defense}</span> : null}
          {item.equipment.hp ? <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 h-8 text-red-300"><Heart className="w-3.5 h-3.5" /> Здоровье +{item.equipment.hp}</span> : null}
          {item.equipment.critChance ? <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 h-8 text-yellow-300"><Star className="w-3.5 h-3.5" /> Крит +{item.equipment.critChance}%</span> : null}
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl bg-black/30 border border-white/10 px-3 h-11 text-sm">
        <span className="text-gray-400">Цена за шт.</span>
        <span className="text-white"><Price item={item} size={18} /></span>
      </div>
      <p className="text-xs text-gray-500 -mt-2 px-1">У тебя: {balance}</p>

      {isStone && (
        <div className="space-y-2 rounded-xl bg-black/30 border border-amber-500/20 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Доступно сегодня</span>
            <span className="font-bold text-amber-200">{stonesLeft}/{DAILY_STONE_LIMIT} шт</span>
          </div>
          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-300"
              style={{ width: `${(stonesLeft / DAILY_STONE_LIMIT) * 100}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs pt-0.5">
            <span className="text-gray-400 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Обновление через</span>
            <span className="font-bold tabular-nums text-gray-200">{formatDuration(countdownMs)}</span>
          </div>
        </div>
      )}

      {maxQty >= 1 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Количество{isStone ? ` (по ${stonePerUnit} шт)` : ''}</span>
            <span className="text-amber-200 font-bold">x{qtyClamped}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQty((q) => clamp(q - 1))}
              disabled={qtyClamped <= 1}
              className="w-9 h-9 rounded-xl bg-white/10 text-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-30"
            >
              <Minus className="w-4 h-4" />
            </button>
            <input
              type="range"
              min={1}
              max={maxQty}
              value={qtyClamped}
              onChange={(e) => setQty(clamp(Number(e.target.value)))}
              className="flex-1 accent-amber-500 h-2 cursor-pointer"
            />
            <button
              onClick={() => setQty((q) => clamp(q + 1))}
              disabled={qtyClamped >= maxQty}
              className="w-9 h-9 rounded-xl bg-white/10 text-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-30"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 h-9 text-xs">
            <span className="text-gray-400">Итого</span>
            <span className="text-amber-100 font-bold">
              <Currency kind={item.priceGems ? 'gems' : 'gold'} value={totalCost} size={16} />
              {isStone && <span className="text-gray-400 ml-2">· {totalStones} камней</span>}
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-gray-500 px-1">
            <button onClick={() => setQty(1)} className="hover:text-amber-300 transition-colors">1</button>
            <button onClick={() => setQty(clamp(Math.floor(maxQty / 4)))} className="hover:text-amber-300 transition-colors">¼</button>
            <button onClick={() => setQty(clamp(Math.floor(maxQty / 2)))} className="hover:text-amber-300 transition-colors">½</button>
            <button onClick={() => setQty(maxQty)} className="hover:text-amber-300 transition-colors">Макс ({maxQty})</button>
          </div>
        </div>
      ) : isStone ? (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-3 text-center text-xs text-red-300">
          Дневной лимит боевых камней исчерпан
        </div>
      ) : null}

      <button
        disabled={!ok}
        onClick={() => onBuy(qtyClamped)}
        className="w-full h-12 rounded-2xl bg-gradient-to-b from-amber-400 to-amber-600 text-black font-bold active:scale-[0.98] transition-transform disabled:opacity-40 disabled:bg-none disabled:bg-white/10 disabled:text-gray-400"
      >
        {ok ? `Купить x${qtyClamped}` : isStone ? 'Лимит исчерпан' : 'Не хватает средств'}
      </button>
    </div>
  );
}
