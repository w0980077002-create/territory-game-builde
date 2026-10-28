import { supabase } from './supabase';
import { AuctionTradeError, withAuctionDeadline } from './auctionApi';

/** T9–T12 contract for ChatGPT-owned screens. Amounts use persisted currency keys. */
export type AuctionCurrency = 'gold' | 'gems' | 'redGems';
export type AuctionSource = 'stage3' | 'stage8' | 'resource';
export type AuctionResourceId = 'gather-ore' | 'gather-wood' | 'gather-hide' | 'gather-herb' | 'gather-crystal';
export type AuctionCategory = 'equipment' | 'resource' | 'material' | 'potion' | 'elixir';
export interface AuctionCompletionItem {
  item_id: string;
  source: AuctionSource;
  item: { name?: string; customName?: string; makerId?: string; makerName?: string; type?: AuctionCategory; rarity?: string; icon?: string; description?: string; resourceId?: AuctionResourceId; qty?: number };
  expires_at: string | null;
}
export interface AuctionCompletionLot extends AuctionCompletionItem {
  id: string; seller_id?: string; seller?: string; price: number; currency: AuctionCurrency;
  created_at: string; expires_at: string; status?: 'open';
}
export interface AuctionCompletionHistory {
  id: string; item_id: string; item: AuctionCompletionItem['item']; price: number; fee: number | null;
  currency: AuctionCurrency; status: 'sold' | 'cancelled' | 'expired'; role: 'buyer' | 'seller'; closed_at: string;
}
export interface AuctionCompletionOverview {
  enabled: boolean; lots: AuctionCompletionLot[]; mine: AuctionCompletionLot[]; items: AuctionCompletionItem[];
  history: AuctionCompletionHistory[]; wallets: Record<AuctionCurrency, number | null>; resources: Partial<Record<AuctionResourceId, number>>;
}
export interface AuctionCompletionFilters {
  search?: string; rarity?: 'common' | 'rare' | 'epic' | 'legendary'; sort?: 'newest' | 'price_asc' | 'price_desc' | 'expires_first';
  currency?: AuctionCurrency; category?: AuctionCategory;
}
export type AuctionCompletionAction =
  | ({ action: 'list'; price: number; currency: AuctionCurrency; durationSeconds: number } & ({ itemId: string; source: 'stage3' | 'stage8' } | { source: 'resource'; resourceId: AuctionResourceId; quantity: number }))
  | { action: 'buy' | 'cancel'; listingId: string };
export interface AuctionCompletionReceipt {
  success: true; action: AuctionCompletionAction['action']; listing_id: string;
  outcome?: 'sold' | 'cancelled' | 'expired'; currency?: AuctionCurrency; price?: number; fee?: number; buyer_balance?: number;
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const rec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const amount = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 2147483647;
const currency = (v: unknown): v is AuctionCurrency => ['gold', 'gems', 'redGems'].includes(String(v));
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const source = (v: unknown): v is AuctionSource => v === 'stage3' || v === 'stage8' || v === 'resource';
const resource = (v: unknown): v is AuctionResourceId => ['gather-ore', 'gather-wood', 'gather-hide', 'gather-herb', 'gather-crystal'].includes(String(v));
function item(v: unknown): AuctionCompletionItem['item'] {
  if (!rec(v)) throw new Error('auction_response_invalid');
  const result: AuctionCompletionItem['item'] = {};
  for (const key of ['name', 'customName', 'makerName', 'rarity', 'icon', 'description'] as const) {
    if (typeof v[key] === 'string') result[key] = v[key].slice(0, key === 'description' ? 300 : 100);
  }
  if (resource(v.resourceId)) result.resourceId = v.resourceId;
  if (amount(v.qty) && v.qty > 0) result.qty = v.qty;
  if (uuid(v.makerId)) result.makerId = v.makerId;
  if (['equipment', 'resource', 'material', 'potion', 'elixir'].includes(String(v.type))) result.type = v.type as AuctionCategory;
  return result;
}
function parseLot(v: unknown): AuctionCompletionLot {
  if (!rec(v) || !uuid(v.id) || !uuid(v.item_id) || !source(v.source) || !currency(v.currency) || !amount(v.price) || v.price === 0 || !date(v.expires_at) || !date(v.created_at)) throw new Error('auction_response_invalid');
  return { id: v.id, item_id: v.item_id, source: v.source, item: item(v.item), price: v.price, currency: v.currency,
    created_at: v.created_at, expires_at: v.expires_at, seller_id: uuid(v.seller_id) ? v.seller_id : undefined,
    seller: typeof v.seller === 'string' ? v.seller.slice(0, 64) : undefined, status: v.status === 'open' ? 'open' : undefined };
}
export async function fetchAuctionCompletion(filters: AuctionCompletionFilters = {}): Promise<AuctionCompletionOverview | null> {
  const { data, error } = await withAuctionDeadline(supabase.rpc('territory_auction_overview_v2', {
    p_limit: 50, p_search: (filters.search || '').slice(0, 100), p_rarity: filters.rarity || '', p_sort: filters.sort || 'newest', p_currency: filters.currency || '', p_category: filters.category || '',
  }));
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return null;
    throw new Error('auction_unavailable');
  }
  const empty: AuctionCompletionOverview = { enabled: false, lots: [], mine: [], items: [], history: [], wallets: { gold: null, gems: null, redGems: null }, resources: {} };
  if (!rec(data) || typeof data.enabled !== 'boolean') throw new Error('auction_response_invalid');
  if (!data.enabled) return empty;
  if (![data.lots, data.mine, data.items, data.history].every(Array.isArray)) throw new Error('auction_response_invalid');
  const items = (data.items as unknown[]).map((v): AuctionCompletionItem => {
    if (!rec(v) || !uuid(v.item_id) || !source(v.source) || (v.expires_at !== null && !date(v.expires_at))) throw new Error('auction_response_invalid');
    return { item_id: v.item_id, source: v.source, item: item(v.item), expires_at: v.expires_at as string | null };
  });
  const history = (data.history as unknown[]).map((v): AuctionCompletionHistory => {
    if (!rec(v) || !uuid(v.id) || !uuid(v.item_id) || !currency(v.currency) || !amount(v.price) || v.price === 0 || !(v.fee === null || amount(v.fee)) || !date(v.closed_at) || !['sold', 'cancelled', 'expired'].includes(String(v.status)) || !['buyer', 'seller'].includes(String(v.role))) throw new Error('auction_response_invalid');
    return { id: v.id, item_id: v.item_id, item: item(v.item), price: v.price, fee: v.fee as number | null, currency: v.currency, closed_at: v.closed_at, status: v.status as AuctionCompletionHistory['status'], role: v.role as AuctionCompletionHistory['role'] };
  });
  const wallets = { ...empty.wallets };
  if (rec(data.wallets)) for (const key of ['gold', 'gems', 'redGems'] as const) wallets[key] = amount(data.wallets[key]) ? data.wallets[key] as number : null;
  const resources: Partial<Record<AuctionResourceId, number>> = {};
  if (rec(data.resources)) for (const [id, qty] of Object.entries(data.resources)) {
    if (!resource(id) || !amount(qty)) throw new Error('auction_response_invalid');
    resources[id] = qty;
  }
  return { enabled: true, resources, lots: (data.lots as unknown[]).map(parseLot), mine: (data.mine as unknown[]).map(parseLot), items, history, wallets };
}
export function validAuctionCompletionAction(v: unknown): v is AuctionCompletionAction {
  if (!rec(v)) return false;
  return v.action === 'list' ? (v.source === 'resource' ? resource(v.resourceId) && amount(v.quantity) && v.quantity > 0 : uuid(v.itemId) && (v.source === 'stage3' || v.source === 'stage8')) && amount(v.price) && v.price > 0 && currency(v.currency) && (v.currency === 'gold' || v.price % 10 === 0) && Number.isInteger(v.durationSeconds) && Number(v.durationSeconds) >= 1 && Number(v.durationSeconds) <= 86400 : ['buy', 'cancel'].includes(String(v.action)) && uuid(v.listingId);
}
/** Persist the operation before sending; an unconfirmed result must reuse this UUID. */
export async function submitAuctionCompletion(action: AuctionCompletionAction, operationId: string): Promise<AuctionCompletionReceipt> {
  if (!uuid(operationId) || !validAuctionCompletionAction(action)) throw new Error('invalid_auction_operation');
  const args = action.action === 'list'
    ? action.source === 'resource' ? { p_operation: operationId, p_resource: action.resourceId, p_quantity: action.quantity, p_price: action.price, p_currency: action.currency, p_duration_seconds: action.durationSeconds } : { p_action: action.action, p_operation: operationId, p_item: action.itemId, p_source: action.source, p_price: action.price, p_currency: action.currency, p_duration_seconds: action.durationSeconds }
    : { p_action: action.action, p_operation: operationId, p_listing: action.listingId };
  const { data, error } = await withAuctionDeadline(supabase.rpc(action.action === 'list' && action.source === 'resource' ? 'territory_auction_list_resources_v1' : 'territory_auction_trade_v2', args), 15_000);
  if (error) throw new AuctionTradeError(error.message || 'trade_failed', error.code === 'P0001' || error.code === '42501');
  if (!rec(data) || data.success !== true || data.action !== action.action || !uuid(data.listing_id)) throw new Error('trade_unconfirmed');
  return data as unknown as AuctionCompletionReceipt;
}
export async function nameAuctionItem(operationId: string, itemId: string, itemSource: Exclude<AuctionSource, 'resource'>, name: string): Promise<void> {
  if (!uuid(operationId) || !uuid(itemId) || !source(itemSource) || typeof name !== 'string' || name.trim().length < 1 || [...name.trim()].length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('invalid_name');
  const { data, error } = await withAuctionDeadline(supabase.rpc('territory_auction_name_item_v1', { p_operation: operationId, p_item: itemId, p_source: itemSource, p_name: name.trim() }), 15_000);
  if (error) throw new AuctionTradeError(error.message || 'name_failed', error.code === 'P0001' || error.code === '42501');
  if (!rec(data) || data.success !== true || data.item_id !== itemId || data.custom_name !== name.trim()) throw new Error('name_unconfirmed');
}
export interface PendingAuctionCompletion { id: string; action: AuctionCompletionAction }
const pendingKey = 'territory_pending_auction_completion_v1_';
async function pendingStorageKey(): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) throw new Error('session_unavailable');
  if (typeof localStorage === 'undefined') throw new Error('idempotency_storage_unavailable');
  return pendingKey + user.id;
}
export async function readPendingAuctionCompletion(): Promise<PendingAuctionCompletion | null> {
  const key = await pendingStorageKey();
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!rec(value) || !uuid(value.id) || !validAuctionCompletionAction(value.action)) throw new Error('invalid_pending_operation');
  return value as unknown as PendingAuctionCompletion;
}
export async function keepPendingAuctionCompletion(pending: PendingAuctionCompletion | null): Promise<void> {
  const key = await pendingStorageKey();
  if (pending && (!uuid(pending.id) || !validAuctionCompletionAction(pending.action))) throw new Error('invalid_pending_operation');
  if (pending) localStorage.setItem(key, JSON.stringify(pending));
  else localStorage.removeItem(key);
}
/** Compare only genuinely comparable items. This reports ratios and never rewrites balance. */
export function compareWorkshopEquipment(
  crafted: { slot: string; level: number; rarity: string; attack?: number; defense?: number; hp?: number },
  loot: { slot: string; level: number; rarity: string; attack?: number; defense?: number; hp?: number },
): { comparable: boolean; ratios: Partial<Record<'attack' | 'defense' | 'hp', number>> } {
  const result = { comparable: crafted.slot === loot.slot && crafted.level === loot.level && crafted.rarity === loot.rarity, ratios: {} as Partial<Record<'attack' | 'defense' | 'hp', number>> };
  if (!result.comparable) return result;
  for (const key of ['attack', 'defense', 'hp'] as const) {
    const left = crafted[key], right = loot[key];
    if (typeof left === 'number' && Number.isFinite(left) && left >= 0 && typeof right === 'number' && Number.isFinite(right) && right > 0) result.ratios[key] = left / right;
  }
  return result;
}
