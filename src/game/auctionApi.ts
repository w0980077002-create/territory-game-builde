import { supabase } from './supabase';

/** These are server-confirmed, VERIFIED crafted items only, never client inventory. */
export interface AuctionItem {
  item_id: string;
  item: { name?: string; icon?: string; rarity?: string; description?: string };
}
export interface AuctionLot extends AuctionItem {
  id: string;
  seller_id: string;
  seller: string;
  price_gold: number;
  created_at: string;
}
export interface AuctionOwnLot extends AuctionItem {
  id: string;
  price_gold: number;
  status: 'open';
  created_at: string;
}
export interface AuctionHistory extends AuctionItem {
  id: string; price_gold: number; fee_gold: number | null;
  status: 'sold' | 'cancelled'; role: 'buyer' | 'seller'; closed_at: string;
}
export interface AuctionFilters { search?: string; rarity?: string; sort?: 'newest' | 'price_asc' | 'price_desc' }
export interface AuctionOverview {
  enabled: boolean;
  lots: AuctionLot[];
  mine: AuctionOwnLot[];
  items: AuctionItem[];
  myGold: number | null;
  history: AuctionHistory[];
}

const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const uuid = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);
const price = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 2147483647;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const safeItem = (value: unknown): AuctionItem['item'] => {
  if (!record(value)) return {};
  return {
    name: typeof value.name === 'string' ? value.name.slice(0, 100) : undefined,
    icon: typeof value.icon === 'string' ? value.icon.slice(0, 8) : undefined,
    rarity: typeof value.rarity === 'string' ? value.rarity.slice(0, 30) : undefined,
    description: typeof value.description === 'string' ? value.description.slice(0, 300) : undefined,
  };
};

/**
 * Release the Telegram UI if PostgREST stalls. A timed-out trade remains
 * ambiguous and must be retried with the SAME persisted operation UUID.
 */
export function withAuctionDeadline<T>(request: PromiseLike<T>, timeoutMs = 12_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('auction_request_timeout')), timeoutMs);
    request.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Null means the function has not been installed (current live STAGE4). */
export async function fetchAuctionOverview(filters: AuctionFilters = {}): Promise<AuctionOverview | null> {
  const { data, error } = await withAuctionDeadline(supabase.rpc('territory_auction_overview_v1', { p_limit: 50, p_search: (filters.search || '').slice(0, 100), p_rarity: filters.rarity || '', p_sort: filters.sort || 'newest' }));
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || /function.*does not exist|could not find the function/i.test(error.message)) return null;
    throw new Error('auction_unavailable');
  }
  if (!record(data) || data.enabled !== true) return { enabled: false, lots: [], mine: [], items: [], myGold: null, history: [] };
  const lots: AuctionLot[] = Array.isArray(data.lots) ? data.lots.filter((lot): lot is Record<string, unknown> =>
    record(lot) && uuid(lot.id) && uuid(lot.seller_id) && uuid(lot.item_id) && price(lot.price_gold)
  ).map((lot) => ({
    id: lot.id as string, seller_id: lot.seller_id as string, item_id: lot.item_id as string,
    seller: typeof lot.seller === 'string' ? lot.seller.slice(0, 64) : '',
    item: safeItem(lot.item), price_gold: lot.price_gold as number,
    created_at: typeof lot.created_at === 'string' ? lot.created_at : '',
  })) : [];
  const mine: AuctionOwnLot[] = Array.isArray(data.mine) ? data.mine.filter((lot): lot is Record<string, unknown> =>
    record(lot) && uuid(lot.id) && uuid(lot.item_id) && price(lot.price_gold) && lot.status === 'open'
  ).map((lot) => ({
    id: lot.id as string, item_id: lot.item_id as string, item: safeItem(lot.item),
    price_gold: lot.price_gold as number, status: 'open',
    created_at: typeof lot.created_at === 'string' ? lot.created_at : '',
  })) : [];
  const items: AuctionItem[] = Array.isArray(data.items) ? data.items.filter((it): it is Record<string, unknown> =>
    record(it) && uuid(it.item_id)
  ).map((it) => ({ item_id: it.item_id as string, item: safeItem(it.item) })) : [];
  const history: AuctionHistory[] = Array.isArray(data.history) ? data.history.filter((h): h is Record<string, unknown> =>
    record(h) && uuid(h.id) && uuid(h.item_id) && price(h.price_gold) &&
    ['sold','cancelled'].includes(String(h.status)) && ['buyer','seller'].includes(String(h.role)) &&
    typeof h.closed_at === 'string' && (h.fee_gold === null || (Number.isSafeInteger(h.fee_gold) && (h.fee_gold as number) >= 0))
  ).map((h) => ({ id: h.id as string, item_id: h.item_id as string, item: safeItem(h.item),
    price_gold: h.price_gold as number, fee_gold: h.fee_gold as number | null,
    status: h.status as AuctionHistory['status'], role: h.role as AuctionHistory['role'], closed_at: h.closed_at as string })) : [];
  return { enabled: true, lots, mine, items, history,
    myGold: Number.isSafeInteger(data.my_gold) && (data.my_gold as number) >= 0 ? data.my_gold as number : null };
}

export type AuctionAction =
  | { action: 'list'; itemId: string; priceGold: number }
  | { action: 'buy' | 'cancel'; listingId: string };

/** Idempotency UUID must be retained and reused after a timeout/ambiguous error. */
export async function submitAuctionAction(action: AuctionAction, operationId: string): Promise<void> {
  if (!uuid(operationId)) throw new Error('invalid_operation_id');
  const args = action.action === 'list'
    ? { p_action: 'list', p_operation: operationId, p_item: action.itemId, p_price: action.priceGold }
    : { p_action: action.action, p_operation: operationId, p_listing: action.listingId };
  if (action.action === 'list' && (!uuid(action.itemId) || !price(action.priceGold))) throw new Error('invalid_listing');
  if (action.action !== 'list' && !uuid(action.listingId)) throw new Error('invalid_listing');
  const { data, error } = await withAuctionDeadline(supabase.rpc('territory_auction_trade_v1', args), 15_000);
  if (error) throw new AuctionTradeError(error.message || 'trade_failed', error.code === 'P0001' || error.code === '42501');
  if (!record(data) || data.success !== true || data.action !== action.action) throw new Error('trade_unconfirmed');
}

/** Only an explicit SQL rejection confirms that no transaction committed. */
export class AuctionTradeError extends Error {
  constructor(message: string, readonly rejected: boolean) { super(message); }
}
export type PendingAuction = { action: AuctionAction; id: string };
const PENDING_KEY = 'territory_pending_auction_v1_';
const validPending = (p: unknown): p is PendingAuction => record(p) && uuid(p.id) && record(p.action) &&
  (p.action.action === 'list' ? uuid(p.action.itemId) && price(p.action.priceGold) :
    ['buy','cancel'].includes(String(p.action.action)) && uuid(p.action.listingId));
/** Persist before sending. Account-scoped replay hints never authorize a reward. */
export async function readPendingAuction(): Promise<PendingAuction | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) throw new Error('session_unavailable');
  if (typeof localStorage === 'undefined') throw new Error('idempotency_storage_unavailable');
  const raw = localStorage.getItem(PENDING_KEY + user.id);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!validPending(value)) throw new Error('invalid_pending_operation');
  return value;
}
export async function keepPendingAuction(pending: PendingAuction | null): Promise<void> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) throw new Error('session_unavailable');
  if (typeof localStorage === 'undefined') throw new Error('idempotency_storage_unavailable');
  if (pending && !validPending(pending)) throw new Error('invalid_operation');
  if (pending) localStorage.setItem(PENDING_KEY + user.id, JSON.stringify(pending));
  else localStorage.removeItem(PENDING_KEY + user.id);
}
