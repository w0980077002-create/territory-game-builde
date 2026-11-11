import { supabase } from './supabase';
import type { InventoryItem } from './types';
import { RESOURCE_DEFINITIONS } from './professions';
import { prepareNewEquipment } from './equipmentBalance';

/** Stage6 bridge: the old client-only craft path remains for older servers.
 * When craft_enabled is true, only a server receipt can create a verified item.
 * Never trust client-produced mastery, rewards, or crafting costs for auctions.
 */
export interface CraftStatus {
  enabled: boolean;
  profession: string | null;
  masteryLevel: number;
  masteryXp: number;
  resources: Record<string, number>;
}
export interface CraftReceipt {
  itemId: string;
  recipeId: string;
  output: Record<string, unknown>;
  masteryLevel: number;
  masteryXp: number;
}
const record = (o: unknown): o is Record<string, unknown> => o !== null && typeof o === 'object' && !Array.isArray(o);
const safeNum = (n: unknown, high = 2147483647): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= high;
const uuidRx = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const uuid = (value: unknown): value is string => typeof value === 'string' && uuidRx.test(value);

/** Returns null only if RPC isn't installed. All other errors are fail-closed. */
export async function fetchCraftStatus(): Promise<CraftStatus | null> {
  const { data, error } = await supabase.rpc('territory_craft_status_v1');
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|function.*does not exist/i.test(error.message)) return null;
    throw new Error('craft_status_unavailable');
  }
  if (!record(data) || typeof data.enabled !== 'boolean') throw new Error('invalid_craft_status');
  if (!data.enabled) return { enabled: false, profession: null, masteryLevel: 1, masteryXp: 0, resources: {} };
  if (data.profession !== null && typeof data.profession !== 'string') throw new Error('invalid_profession');
  if (!safeNum(data.mastery_level, 300) || data.mastery_level < 1 || !safeNum(data.mastery_xp, 100000)) throw new Error('invalid_mastery');
  if (!record(data.resources)) throw new Error('invalid_resources');
  const resources: Record<string, number> = {};
  for (const r of RESOURCE_DEFINITIONS) {
    const qty = data.resources[r.id] ?? 0;
    if (!safeNum(qty)) throw new Error('invalid_resource_balance');
    resources[r.id] = qty;
  }
  return { enabled: true, profession: data.profession, masteryLevel: data.mastery_level, masteryXp: data.mastery_xp, resources };
}

/** Operation ID MUST be reused after ambiguous network errors. */
export async function submitVerifiedCraft(recipeId: string, operationId: string): Promise<CraftReceipt> {
  if (!/^[a-z0-9_]{1,90}$/.test(recipeId) || !uuid(operationId)) throw new Error('invalid_request');
  const { data, error } = await supabase.rpc('territory_craft_v1', { p_recipe: recipeId, p_operation: operationId });
  if (error) throw new Error('craft_server_unavailable');
  if (!record(data) || data.success !== true || !uuid(data.item_id) || data.recipe_id !== recipeId || !record(data.item_output)
      || !safeNum(data.mastery_level, 300) || data.mastery_level < 1 || !safeNum(data.mastery_xp, 100000)) {
    throw new Error('invalid_craft_receipt');
  }
  return { itemId: data.item_id, recipeId, output: data.item_output, masteryLevel: data.mastery_level, masteryXp: data.mastery_xp };
}

/** A display copy of a server item, never a transferable ownership record. */
export function receiptDisplayItem(receipt: CraftReceipt): InventoryItem {
  const item = receipt.output;
  if (typeof item.name !== 'string' || item.name.length > 100 || typeof item.icon !== 'string' || item.icon.length > 20
      || !['material','potion','elixir','equipment'].includes(String(item.type))
      || !['common','rare','epic','legendary'].includes(String(item.rarity))) throw new Error('invalid_craft_item');
  const kind = item.type as InventoryItem['type'];
  const rarity = item.rarity as InventoryItem['rarity'];
  const display: InventoryItem = {
    id: `craft_${receipt.itemId}`, name: item.name, icon: item.icon,
    type: kind, rarity, qty: 1, description: typeof item.description === 'string' ? item.description.slice(0, 300) : '',
  };
  if (kind === 'equipment') {
    if (!record(item.equipment) || !['helmet','amulet','armor','weapon','shield','ring','boots'].includes(String(item.equipment.slot))) throw new Error('invalid_equipment');
    const e = item.equipment;
    const stat = (key: string): number => safeNum(e[key], 100000) ? e[key] as number : 0;
    const level = safeNum(e.level, 10000) && e.level > 0 ? e.level : 1;
    display.equipment = prepareNewEquipment({
      id: display.id, name: display.name, icon: display.icon,
      slot: e.slot as NonNullable<InventoryItem['equipment']>['slot'], rarity, level,
      attack: stat('attack'), defense: stat('defense'), hp: stat('hp'), critChance: stat('critChance'),
    });
  } else if (record(item.effect) && ['attack','defense','hp','maxHp','critChance','critDamage'].includes(String(item.effect.stat))) {
    const e = item.effect;
    if (safeNum(e.value, 10000)) display.effect = {stat: e.stat as NonNullable<InventoryItem['effect']>['stat'], value: e.value as number,
      duration: e.duration === 'battle' ? 'battle' : 'instant'};
  }
  return display;
}

/** Mirror exact server resource counts while preserving every unrelated item. */
export function mirrorCraftResources(items: InventoryItem[], resources: Record<string,number>): InventoryItem[] {
  const ids = new Set<string>(RESOURCE_DEFINITIONS.map((r) => r.id));
  const untouched = items.filter((item) => !ids.has(item.id));
  for (const r of RESOURCE_DEFINITIONS) {
    const qty = resources[r.id];
    if (!safeNum(qty)) throw new Error('invalid_resource_balance');
    if (qty > 0) untouched.push({ id:r.id,name:r.name,icon:r.icon,type:'material',rarity:r.rarity,qty,description:'Server-verified resource' });
  }
  return untouched;
}

export type PendingCraft = { recipeId: string; operationId: string };
const KEY = 'territory_pending_server_craft_v1';
/** A client-side replay hint only. The real idempotency lives in PostgreSQL. */
export async function readPendingCraft(): Promise<PendingCraft | null> {
  if (typeof sessionStorage === 'undefined') return null;
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.userId !== user.id || typeof value.recipeId !== 'string' || !/^[a-z0-9_]{1,90}$/.test(value.recipeId) || !uuid(value.operationId)) return null;
    return {recipeId:value.recipeId,operationId:value.operationId};
  } catch {return null;}
}
export async function keepPendingCraft(pending: PendingCraft | null): Promise<void> {
  if (typeof sessionStorage === 'undefined') throw new Error('idempotency_storage_unavailable');
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id) throw new Error('session_unavailable');
  if (pending && (!/^[a-z0-9_]{1,90}$/.test(pending.recipeId) || !uuid(pending.operationId))) throw new Error('invalid_operation');
  if (pending) sessionStorage.setItem(KEY,JSON.stringify({userId:user.id,...pending}));
  else {
    const old = await readPendingCraft();
    if (old) sessionStorage.removeItem(KEY);
  }
}
