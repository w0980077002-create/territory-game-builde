import { useEffect, useState, useCallback } from 'react';
import { useStore } from '@/game/store';
import { useLanguage, localizeText } from '@/game/i18n';
import { useGame, buyItem, DAILY_STONE_LIMIT, stonesRemainingToday, maxStoneQty } from '@/game/actions';
import { captureGameEvent } from '@/game/analytics';
import {acceptMasterLicenseReceipt} from '@/game/cloud';
import {supabase} from '@/game/supabase';
import { generateShopItems } from '@/game/engine';
import { MAX_SHOP_PURCHASE_QTY } from '@/game/purchaseGuard';
import { calendarDayKey } from '@/game/weeklyQuests';
import { utcMidnight } from '@/game/seasonCalendar';
import { rarityColor } from '@/game/ui';
import { CheckCircle2, Sword, Shield, Heart, Star, Minus, Plus, Clock, Crown, Sparkles, LockKeyhole, X } from 'lucide-react';
import type { GameState, ShopItem } from '@/game/types';
import { ItemArt } from './ui/ItemArt';
import { Currency, formatAmount } from './ui/Currency';
import { IosGamePortal, Modal } from './ui/Modal';
import { useLive, SHOP_SALE_FACTOR } from '@/game/live';
import { fetchShopStatus, purchaseServerStones, readPendingShop, keepPendingShop, type ShopStatus, type PendingShop } from '@/game/shopApi';
import {
  MASTER_LICENSE_ART, MASTER_LICENSE_PRICE_RED,
  fetchMasterLicenseShopStatus, buyMasterLicense,
  readMasterLicensePending, keepMasterLicensePending,
  type MasterLicenseShopStatus,
} from '@/game/masterLicenseShopApi';

const discount = (price: number | undefined) => (price ? Math.max(1, Math.ceil(price * SHOP_SALE_FACTOR)) : price);

type Tab = 'potions' | 'equipment' | 'resources';

const TABS: { id: Tab; labelKey: string }[] = [
  { id: 'potions', labelKey: 'potions' },
  { id: 'equipment', labelKey: 'equipment' },
  { id: 'resources', labelKey: 'resources' },
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

function resultText(item: ShopItem, qty: number, language: 'ru' | 'en') {
  if (item.type === 'stone') return language === 'en' ? `+${(item.amount ?? 1) * qty} battle stones` : `+${(item.amount ?? 1) * qty} боевых камней`;
  if (item.type === 'gem_pack') return language === 'en' ? `+${(item.amount ?? 0) * qty} blue crystals` : `+${(item.amount ?? 0) * qty} синих кристаллов`;
  if (item.type === 'material') return language === 'en' ? `+${qty} forge material(s)` : `+${qty} материал(ов) для кузницы`;
  if (item.type === 'equipment') return language === 'en' ? `Gear added to inventory (${qty})` : `Предметы добавлены в инвентарь (${qty})`;
  return language === 'en' ? `Added to inventory: ${qty}` : `Добавлено в инвентарь: ${qty}`;
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
  const now = Date.now();
  const [year, month, day] = calendarDayKey(now).split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return Math.max(0, utcMidnight(tomorrow) - now);
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function ShopScreen({ initialTab = 'potions', onInventory }: { initialTab?: Tab; onInventory?: () => void }) {
  const { t, language } = useLanguage();
  const state = useStore(useGame);
  const { shopSale } = useStore(useLive);
  const [shopStatus, setShopStatus] = useState<ShopStatus | null>(null);
  const [shopCheck, setShopCheck] = useState<'checking'|'ready'|'error'>('checking');
  const [pendingShop, setPendingShop] = useState<PendingShop | null>(null);
  const [buying, setBuying] = useState(false);
  const [purchaseError, setPurchaseError] = useState('');
  const [licenseStatus,setLicenseStatus] = useState<MasterLicenseShopStatus|null>(null);
  const [licenseError,setLicenseError] = useState('');
  const [licenseOpen,setLicenseOpen] = useState(false);
  const [licenseBusy,setLicenseBusy] = useState(false);
  const [licensePending,setLicensePending] = useState<string|null>(null);
  const [licenseNotice,setLicenseNotice] = useState('');
  useEffect(()=>{
    let mounted=true;
    void Promise.all([fetchMasterLicenseShopStatus(),readMasterLicensePending()])
      .then(async ([status,pending])=>{
        if(status.owned && pending){await keepMasterLicensePending(null);pending=null;}
        if(mounted){setLicenseStatus(status);setLicensePending(pending);}
      }).catch(()=>{if(mounted)setLicenseError(language==='en'?'License server unavailable.':'Сервер лицензий временно недоступен.');});
    return ()=>{mounted=false;};
  },[]);
  useEffect(() => {
    let mounted = true;
    void fetchShopStatus().then(async (status) => {
      const pending = status?.enabled ? await readPendingShop() : null;
      if (mounted) {setShopStatus(status);setPendingShop(pending);setShopCheck('ready');}
    }).catch(() => {if(mounted)setShopCheck('error');});
    return () => {mounted=false;};
  }, []);
  // After midnight fetch the authoritative quota; the browser never grants purchases.
  useEffect(() => {
    let previous = calendarDayKey();
    const timer = window.setInterval(() => {
      const current = calendarDayKey();
      if (current === previous) return;
      previous = current;
      void fetchShopStatus().then(fresh => {
        if (fresh?.enabled) { setShopStatus(fresh); setShopCheck('ready'); }
      }).catch(() => { /* Wait for the next authoritative status. */ });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const allItems = generateShopItems(state.currentChapter).map((i) => {
    if (shopStatus?.enabled && i.type === 'stone') return {...i, priceGems:i.id==='shop_stone_1'?2:8, priceGold:0};
    return shopSale ? { ...i, priceGold: discount(i.priceGold) ?? 0, priceGems: discount(i.priceGems) } : i;
  });
  const [tab, setTab] = useState<Tab>(initialTab);
  const [picked, setPicked] = useState<ShopItem | null>(null);
  const [result, setResult] = useState<{ item: ShopItem; text: string } | null>(null);
  const items = allItems.filter((i) => inTab(i, tab));
  const firstGearResult = !!onInventory && result?.item.type === 'equipment' && state.player.level < 5
    && !Object.values(state.player.equipped).some(Boolean);

  useEffect(() => {
    if (!result || firstGearResult) return;
    const t = setTimeout(() => setResult(null), 2600);
    return () => clearTimeout(t);
  }, [result, firstGearResult]);

  const buy = async (item: ShopItem, qty: number) => {
    if (buying || pendingShop) return;
    setBuying(true);
    setPurchaseError('');
    try {
      // Never choose the unverified local purchase path if the server cannot be reached.
      const server = await fetchShopStatus();
      if (server?.enabled) {
        setShopStatus(server);
        if (item.type !== 'stone' || (item.id !== 'shop_stone_1' && item.id !== 'shop_stone_5')) {
          setPurchaseError(language==='en'?'This item needs a verified server shop.':'Этот товар пока нельзя купить через защищённый сервер.');return;
        }
        const pending: PendingShop = {itemId:item.id,quantity:qty,operationId:crypto.randomUUID()};
        await keepPendingShop(pending);
        setPendingShop(pending);
        await finishServerPurchase(pending,item);
        return;
      }
      // Historical local shop stays functional before the server cutover.
      const liveState = useGame.get();
      const liveSale = useLive.get().shopSale;
      const current = generateShopItems(liveState.currentChapter).find((i) => i.id === item.id);
      if (!current) { setPicked(null); return; }
      const upToDate = liveSale
        ? { ...current, priceGold: discount(current.priceGold) ?? 0, priceGems: discount(current.priceGems) }
        : current;
      const next = buyItem(liveState, upToDate, qty);
      if (!next) return;
      useGame.set(next);
      captureGameEvent('territory_shop_purchase', { screen: 'shop', outcome: 'success' });
      setPicked(null);
      setResult({ item: upToDate, text: resultText(upToDate, qty, language) });
    } catch {
      setPurchaseError(language === 'en' ? 'Could not verify the purchase. Do not repeat with a new transaction.' : 'Сервер не подтвердил покупку. Не повторяйте её новым платежом.');
    } finally {setBuying(false);}
  };

  const finishServerPurchase = async (pending: PendingShop, item?: ShopItem) => {
    const receipt = await purchaseServerStones(pending);
    const status = await fetchShopStatus();
    if (!status?.enabled) throw new Error('shop_disabled');
    // Server wallet, not a client-provided price or timestamp, determines result.
    // Do not mirror until both receipt and authoritative status are confirmed.
    if (status.gems !== receipt.gemsAfter || status.stones !== receipt.stonesAfter) throw new Error('shop_wallet_changed');
    const current = useGame.get();
    useGame.set({ ...current, player:{ ...current.player,gems:status.gems },battleStones:status.stones,
      dailyStonesBought:status.boughtToday,dailyStonesDate:calendarDayKey() });
    setShopStatus(status);
    await keepPendingShop(null);
    captureGameEvent('territory_shop_purchase', { screen: 'shop', outcome: 'success' });
    setPendingShop(null);
    setPicked(null);
    const display = item ?? generateShopItems(current.currentChapter).find(i=>i.id===pending.itemId);
    if (display) setResult({item:display,text:resultText(display,pending.quantity,language)});
  };

  const retryServerPurchase = async () => {
    if (!pendingShop || buying) return;
    setBuying(true);setPurchaseError('');
    try {await finishServerPurchase(pendingShop);}
    catch {setPurchaseError(language==='en'?'Still unconfirmed; retry the pending operation later.':'Операция ещё не подтверждена. Повторите тот же запрос позже.');}
    finally {setBuying(false);}
  };

  const finishLicensePurchase = async(operationId:string)=>{
    const receipt=await buyMasterLicense(operationId);
    const current=await fetchMasterLicenseShopStatus();
    if(!current.owned || current.redBalance!==receipt.redBalance)
      throw new Error('master_license_status_not_confirmed');
    const {data:{user},error}=await supabase.auth.getUser();
    if(error||!user?.id)throw new Error('master_license_login_required');
    // Adopt the exact save revision: queued old saves cannot restore 50 gems.
    const verifiedState=acceptMasterLicenseReceipt(user.id,receipt);
    useGame.set(verifiedState);
    setLicenseStatus(current);
    await keepMasterLicensePending(null);
    setLicensePending(null);
    setLicenseOpen(false);
    setLicenseNotice(language==='en'?'Master License purchased permanently!':'👑 Лицензия мастера куплена навсегда!');
    captureGameEvent('territory_shop_purchase',{screen:'shop',outcome:'success'});
  };
  const purchaseLicense = async()=>{
    if(licenseBusy || !licenseStatus?.verifiedTelegram || !licenseStatus.hasProfession
      || licenseStatus.owned || licenseStatus.redBalance<MASTER_LICENSE_PRICE_RED)return;
    setLicenseBusy(true);setLicenseError('');
    try{
      const operationId=licensePending??crypto.randomUUID();
      if(!licensePending){await keepMasterLicensePending(operationId);setLicensePending(operationId);}
      await finishLicensePurchase(operationId);
    }catch(error){
      const message=error instanceof Error?error.message:'';
      setLicenseError(message.includes('license_insufficient_red_gems')
        ?(language==='en'?'Not enough red gems.':'Не хватает красных алмазов.')
        :(language==='en'?'Purchase unconfirmed. Retry the saved transaction.':'Покупка не подтверждена. Повтори сохранённую операцию без нового списания.'));
    }finally{setLicenseBusy(false);}
  };
  const retryLicense=async()=>{
    if(!licensePending||licenseBusy)return;
    setLicenseBusy(true);setLicenseError('');
    try{await finishLicensePurchase(licensePending);}
    catch{setLicenseError(language==='en'?'Still unconfirmed; retry the same transaction.':'Пока не подтверждено — повтори ту же операцию.');}
    finally{setLicenseBusy(false);}
  };

  return (
    <div className="space-y-3 animate-fade-in pb-2">
      <div className="relative rounded-2xl overflow-hidden border border-amber-500/20 p-4">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-900/40 via-[#16130d] to-[#0f1115]" />
        <div className="relative flex items-center gap-3">
          <img src="/ic-shop.webp" alt="" className="w-12 h-12 object-contain" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-amber-100">{t('shop')}</h2>
            <p className="text-xs text-gray-400">{t('shopDescription')}</p>
          </div>
          {shopSale && !shopStatus?.enabled && (
            <span className="shrink-0 rounded-lg bg-gradient-to-b from-red-500 to-rose-700 px-2 py-1 text-xs font-bold text-white shadow-[0_0_12px_rgba(244,63,94,0.6)] animate-pulse">-20%</span>
          )}
        </div>
        <div className="relative flex flex-wrap gap-2 mt-3">
          {([['gold', state.player.gold], ['gems', shopStatus?.enabled ? shopStatus.gems : state.player.gems], ['redGems',licenseStatus?.redBalance??state.player.redGems], ['stones', shopStatus?.enabled ? shopStatus.stones : state.battleStones]] as const).map(([k, v]) => (
            <span key={k} className="hud-chip pl-1.5"><Currency kind={k} value={formatAmount(v)} size={16} className="text-xs text-white" /></span>
          ))}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-amber-300/60 bg-gradient-to-br from-[#423017] via-[#24192a] to-[#131c2f] p-3 shadow-[0_0_25px_rgba(245,158,11,0.12)]">
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-amber-400/15 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-[94px] w-[94px] shrink-0 items-center justify-center rounded-2xl border border-amber-400/30 bg-black/30">
            <img src={MASTER_LICENSE_ART} loading="lazy" alt={language==='en'?'Master License':'Лицензия мастера'} className="h-[88px] w-[88px] object-contain drop-shadow-[0_3px_12px_rgba(251,191,36,0.3)]" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/40 bg-amber-300/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-200"><Sparkles className="h-3 w-3" /> {language==='en'?'Legendary':'Легендарное'}</span>
            <p className="flex items-center gap-1.5 text-sm font-extrabold text-amber-100"><Crown className="h-4 w-4 text-amber-300" />{language==='en'?'Master License':'Лицензия мастера'}</p>
            <p className="text-[11px] leading-snug text-slate-300">{language==='en'?'Permanent access to level 300 recipes.':'Навсегда открывает рецепты 300-го уровня.'}</p>
            <div className="inline-flex items-center gap-1 rounded-lg bg-rose-950/40 px-2 py-1 text-sm font-black text-rose-100">
              {licenseStatus?.owned?<span className="text-emerald-300">✓ {language==='en'?'Owned forever':'Куплено навсегда'}</span>:<Currency kind="redGems" value={MASTER_LICENSE_PRICE_RED} size={18}/>}
            </div>
          </div>
        </div>
        <button type="button" onClick={()=>setLicenseOpen(true)} disabled={!licenseStatus||licenseBusy||licenseStatus.owned||!!licensePending}
          className="relative mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-yellow-200/50 bg-gradient-to-b from-yellow-300 via-amber-400 to-amber-600 text-sm font-black text-[#32200b] shadow-[0_3px_0_#9a5816] transition active:translate-y-0.5 disabled:opacity-60">
          {licenseStatus?.owned?<><CheckCircle2 className="h-4 w-4"/>{language==='en'?'Purchased':'Уже куплена'}</>
            :<><Crown className="h-4 w-4"/>{language==='en'?'Buy permanent license':'Купить навсегда'}</>}
        </button>
        {!licenseStatus && !licenseError&&<p className="mt-2 text-center text-[11px] text-amber-200">{language==='en'?'Checking the shop server…':'Проверяем сервер лавки…'}</p>}
        {licensePending&&<button disabled={licenseBusy} onClick={()=>{void retryLicense();}} className="mt-2 w-full rounded-lg border border-sky-400/40 bg-sky-500/10 p-2 text-xs font-bold text-sky-200 disabled:opacity-40">{language==='en'?'Retry saved license purchase':'Повторить сохранённую покупку без двойного списания'}</button>}
        {licenseError&&<p role="alert" className="mt-2 rounded-lg bg-red-950/50 p-2 text-xs text-red-200">{licenseError}</p>}
        {licenseNotice&&<p role="status" className="mt-2 rounded-lg bg-emerald-950/50 p-2 text-xs text-emerald-200">{licenseNotice}</p>}
      </div>

      <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-black/30 border border-white/10">
        {TABS.map((tabItem) => (
          <button
            key={tabItem.id}
            onClick={() => setTab(tabItem.id)}
            className={`h-9 rounded-xl text-xs font-semibold transition-all ${tab === tabItem.id ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-black' : 'text-gray-400'}`}
          >
            {t(tabItem.labelKey)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const color = rarityColor(item.rarity);
          const ok = shopCheck === 'ready' && !buying && !pendingShop && (shopStatus?.enabled ? (item.type==='stone' && shopStatus.gems >= (item.priceGems??0) && (25-shopStatus.boughtToday)>=(item.amount??1)) : (canAfford(state, item) && (item.type !== 'stone' || stonesRemainingToday(state) >= (item.amount ?? 1))));
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
              <p className="text-xs font-semibold leading-tight line-clamp-2 min-h-[30px]" style={{ color }}>{localizeText(item.name, language)}</p>
              {(item.type === 'elixir' || item.type === 'potion' || item.type === 'arena' || item.id === 'shop_forge_material') && <p className="text-[10px] text-amber-300">⏳ {language === 'en' ? '7-day shelf life' : 'Срок 7 суток'}</p>}
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

      {purchaseError && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-200">{purchaseError}</p>}
      {shopCheck==='error' && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-200">{language==='en'?'Shop server unavailable. Purchases paused.':'Сервер магазина недоступен. Покупки остановлены.'}</p>}
      {pendingShop && <button className="w-full rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm font-bold text-amber-200 disabled:opacity-50" onClick={()=>{void retryServerPurchase();}} disabled={buying}>{language==='en'?'Retry pending purchase (same transaction)':'Повторить неподтверждённую покупку (тот же запрос)'}</button>}
      {picked && (
        <Modal title={picked.name} onClose={() => setPicked(null)}>
          <PurchaseSheet item={picked} state={shopStatus?.enabled ? {...state, player:{...state.player,gems:shopStatus.gems},battleStones:shopStatus.stones,dailyStonesBought:shopStatus.boughtToday,dailyStonesDate:calendarDayKey()} : state} onBuy={(qty) => {void buy(picked, qty);}} />
        </Modal>
      )}

      {licenseOpen&&licenseStatus&&<Modal title={language==='en'?'Master License':'Лицензия мастера'} onClose={()=>{if(!licenseBusy)setLicenseOpen(false);}}>
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-36 w-36 items-center justify-center rounded-2xl border border-amber-400/25 bg-gradient-to-b from-amber-900/30 to-slate-900/60"><img src={MASTER_LICENSE_ART} alt="" className="h-32 w-32 object-contain" /></div>
          <p className="font-bold text-amber-100">{language==='en'?'Lifetime Master License':'Постоянная лицензия мастера'}</p>
          <p className="text-xs leading-relaxed text-slate-300">{language==='en'?'Unlocks exclusive recipes at profession level 300. One purchase per hero, no expiry.':'Открывает эксклюзивные рецепты на 300-м уровне профессии. Одна покупка на героя, без срока годности.'}</p>
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 p-3 text-xs"><span className="text-slate-300">{language==='en'?'Price':'Цена'}</span><Currency kind="redGems" value={MASTER_LICENSE_PRICE_RED} size={20}/></div>
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 p-3 text-xs"><span className="text-slate-300">{language==='en'?'Your red gems (server)':'Твои красные алмазы (сервер)'}</span><Currency kind="redGems" value={licenseStatus.redBalance} size={20}/></div>
          <button disabled={licenseBusy||!licenseStatus.verifiedTelegram||!licenseStatus.hasProfession||licenseStatus.owned||licenseStatus.redBalance<MASTER_LICENSE_PRICE_RED||!!licensePending}
            onClick={()=>{void purchaseLicense();}} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-yellow-300 to-amber-600 text-sm font-black text-[#30200d] disabled:opacity-40">
            {licenseBusy?language==='en'?'Confirming…':'Подтверждаем…':!licenseStatus.verifiedTelegram?<><LockKeyhole className="h-4 w-4"/>{language==='en'?'Telegram login required':'Нужен вход Telegram'}</>:!licenseStatus.hasProfession?language==='en'?'Choose profession first':'Сначала открой профессию':licenseStatus.redBalance<MASTER_LICENSE_PRICE_RED?language==='en'?'Not enough red gems':'Не хватает красных алмазов':language==='en'?'Buy for 50 red gems':'Купить за 50 красных алмазов'}
          </button>
        </div>
      </Modal>}

      {result && (
        <IosGamePortal>
        <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 w-[calc(100%-32px)] max-w-sm rounded-2xl border border-emerald-400/40 bg-[#0f1f1a]/95 backdrop-blur-md px-3 py-2.5 flex items-center gap-3 shadow-2xl animate-sheet-up">
          <ItemArt item={result.item} size={36} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-200 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> {t('purchased')}</p>
            <p className="text-xs text-gray-300 truncate">{result.text}</p>
            {firstGearResult && <button type="button" onClick={onInventory} className="mt-2 min-h-10 rounded-lg border border-emerald-300/60 bg-emerald-700 px-3 text-xs font-bold text-white">
              {language === 'en' ? 'Equip in inventory' : 'Надеть в инвентаре'}
            </button>}
          </div>
          {firstGearResult && <button type="button" onClick={() => setResult(null)} aria-label={language === 'en' ? 'Close' : 'Закрыть'} className="self-start rounded-lg p-2 text-emerald-100"><X size={18}/></button>}
        </div>
        </IosGamePortal>
      )}
    </div>
  );
}

function PurchaseSheet({ item, state, onBuy }: { item: ShopItem; state: GameState; onBuy: (qty: number) => void }) {
  const { t, language } = useLanguage();
  const isStone = item.type === 'stone';
  const stonePerUnit = isStone ? (item.amount ?? 1) : 0;
  const stonesLeft = isStone ? stonesRemainingToday(state) : 0;
  const stonesBought = isStone ? DAILY_STONE_LIMIT - stonesLeft : 0;

  const priceEach = item.priceGems ?? item.priceGold ?? 0;
  const balance = item.priceGems ? state.player.gems : state.player.gold;
  const maxByBalance = priceEach > 0 ? Math.floor(balance / priceEach) : 1;
  const maxByStoneLimit = isStone ? maxStoneQty(state, item) : Infinity;
  const maxQty = Math.max(1, Math.min(MAX_SHOP_PURCHASE_QTY, maxByBalance, maxByStoneLimit));

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
          <p className="text-sm text-gray-300 mt-1 leading-relaxed">{localizeText(item.description, language)}</p>
          {(item.type === 'elixir' || item.type === 'potion' || item.type === 'arena' || item.id === 'shop_forge_material') && <p className="mt-1 text-xs text-amber-300">⏳ {language === 'en' ? 'Expires 7 days after purchase' : 'Срок годности — 7 суток после покупки'}</p>}
        </div>
      </div>
      {item.equipment && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {item.equipment.attack ? <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 h-8 text-orange-300"><Sword className="w-3.5 h-3.5" />{language === 'en' ? 'Attack' : 'Атака'} +{item.equipment.attack}</span> : null}
          {item.equipment.defense ? <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 h-8 text-sky-300"><Shield className="w-3.5 h-3.5" />{language === 'en' ? 'Defense' : 'Защита'} +{item.equipment.defense}</span> : null}
          {item.equipment.hp ? <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 h-8 text-red-300"><Heart className="w-3.5 h-3.5" />{language === 'en' ? 'Health' : 'Здоровье'} +{item.equipment.hp}</span> : null}
          {item.equipment.critChance ? <span className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 h-8 text-yellow-300"><Star className="w-3.5 h-3.5" />{language === 'en' ? 'Crit' : 'Крит'} +{item.equipment.critChance}%</span> : null}
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl bg-black/30 border border-white/10 px-3 h-11 text-sm">
        <span className="text-gray-400">{t('perItem')}</span>
        <span className="text-white"><Price item={item} size={18} /></span>
      </div>
      <p className="text-xs text-gray-500 -mt-2 px-1">{t('youHave')}: {balance}</p>

      {isStone && (
        <div className="space-y-2 rounded-xl bg-black/30 border border-amber-500/20 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">{t('dailyAvailable')}</span>
            <span className="font-bold text-amber-200">{stonesLeft}/{DAILY_STONE_LIMIT} шт</span>
          </div>
          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-300"
              style={{ width: `${(stonesLeft / DAILY_STONE_LIMIT) * 100}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs pt-0.5">
            <span className="text-gray-400 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {t('refreshIn')}</span>
            <span className="font-bold tabular-nums text-gray-200">{formatDuration(countdownMs)}</span>
          </div>
        </div>
      )}

      {maxQty >= 1 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{t('quantity')}{isStone ? ` (${language === 'en' ? `${stonePerUnit} each` : `по ${stonePerUnit} шт`})` : ''}</span>
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
            <span className="text-gray-400">{t('total')}</span>
            <span className="text-amber-100 font-bold">
              <Currency kind={item.priceGems ? 'gems' : 'gold'} value={totalCost} size={16} />
              {isStone && <span className="text-gray-400 ml-2">· {totalStones} {t('stones')}</span>}
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-gray-500 px-1">
            <button onClick={() => setQty(1)} className="hover:text-amber-300 transition-colors">1</button>
            <button onClick={() => setQty(clamp(Math.floor(maxQty / 4)))} className="hover:text-amber-300 transition-colors">¼</button>
            <button onClick={() => setQty(clamp(Math.floor(maxQty / 2)))} className="hover:text-amber-300 transition-colors">½</button>
            <button onClick={() => setQty(maxQty)} className="hover:text-amber-300 transition-colors">{t('max')} ({maxQty})</button>
          </div>
        </div>
      ) : isStone ? (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-3 text-center text-xs text-red-300">
          {t('stonesLimitGone')}
        </div>
      ) : null}

      <button
        disabled={!ok}
        onClick={() => onBuy(qtyClamped)}
        className="w-full h-12 rounded-2xl bg-gradient-to-b from-amber-400 to-amber-600 text-black font-bold active:scale-[0.98] transition-transform disabled:opacity-40 disabled:bg-none disabled:bg-white/10 disabled:text-gray-400"
      >
        {ok ? `${language === 'en' ? 'Buy' : 'Купить'} x${qtyClamped}` : isStone ? t('limitReached') : t('notEnoughFunds')}
      </button>
    </div>
  );
}
