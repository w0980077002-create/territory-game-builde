/**
 * Stage8 server-only profession bridge. This module has NO local craft/XP path.
 * The owner-enabled screen still requires a verified, enabled server release.
 * Missing server authority never falls back to local crafting.
 */
import { supabase } from './supabase';
import blueprint from '../../supabase/staged/territory_profession_stage8_catalog.json';
import { receiptDisplayItem } from './craftApi';
import type { Equipment, GameState, InventoryItem, ProfessionId } from './types';

export type Stage8Resource = { id: string; qty: number };
export type Stage8Recipe = {
  id: string;
  profession: ProfessionId;
  requiredLevel: number;
  masteryXp: number;
  kind: 'practice' | 'item';
  name?: string;
  ingredients: Stage8Resource[];
  output: null | {
    name: string;
    icon: string;
    type: 'equipment' | 'potion' | 'elixir' | 'material';
    rarity: 'common' | 'rare' | 'epic' | 'legendary';
    description: string;
    equipment?: Record<string, unknown>;
    effect?: Record<string, unknown>;
  };
};
export const STAGE8_CATALOG_VERSION = blueprint.version;
export const STAGE8_DAILY_XP_CAP = blueprint.dailyXpCapKyiv;
export const STAGE8_RECIPES: readonly Stage8Recipe[] = blueprint.recipes as Stage8Recipe[];
const BANDS = blueprint.masteryBands;

export function stage8XpToNext(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1 || level > 300) return 0;
  return level === 300 ? 0 : BANDS.find((b) => level >= b.from && level <= b.to)?.xpToNext ?? 0;
}

export interface Stage8Status {
  enabled: boolean;
  version: string;
  profession: ProfessionId | null;
  masteryLevel: number;
  masteryXp: number;
  dailyXpUsed: number;
  dailyXpCap: number;
  masterLicense: boolean;
  resources: Record<string, number>;
}
export interface Stage8Receipt {
  recipeId: string;
  kind: 'practice' | 'item';
  itemId: string | null;
  itemOutput: Record<string, unknown> | null;
  expiresAt: string | null;
  masteryLevel: number;
  masteryXp: number;
  dailyXpUsed: number;
}
export type Stage8PendingOperation = { recipeId: string; operationId: string };
export type Stage8PurchaseOperation = { profession: ProfessionId; operationId: string };
export interface Stage8PurchaseReceipt {
  profession: ProfessionId;
  gemsAfter: number;
}
export type Stage8OwnedItem = {
  itemId: string;
  recipeId: string;
  output: Record<string, unknown>;
  expiresAt: string | null;
  equippedSlot?: Equipment['slot'] | null;
};

const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const knownProfession = (p: unknown): p is ProfessionId => ['smith','alchemist','artisan','jeweler','engineer'].includes(String(p));

/** Never silently fall back to locally awarded mastery after an RPC error. */
export async function fetchStage8Status(): Promise<Stage8Status> {
  const {data,error} = await supabase.rpc('territory_profession_stage8_status');
  if (error || !obj(data) || typeof data.enabled !== 'boolean') throw new Error('stage8_status_unavailable');
  if (!data.enabled) return {enabled:false,version:'',profession:null,masteryLevel:1,masteryXp:0,dailyXpUsed:0,dailyXpCap:STAGE8_DAILY_XP_CAP,masterLicense:false,resources:{}};
  if (data.version !== STAGE8_CATALOG_VERSION || (data.profession !== null && !knownProfession(data.profession))
      || !int(data.mastery_level,300) || data.mastery_level<1 || !int(data.mastery_xp,100000)
      || !int(data.daily_xp_used,STAGE8_DAILY_XP_CAP) || data.daily_xp_cap!==STAGE8_DAILY_XP_CAP
      || typeof data.master_license!=='boolean' || !obj(data.resources)) throw new Error('stage8_status_mismatch');
  const resources: Record<string,number> = {};
  for (const id of ['gather-ore','gather-herb','gather-wood','gather-hide','gather-crystal']) {
    const qty=data.resources[id] ?? 0;
    if (!int(qty,2147483647)) throw new Error('stage8_invalid_resources');
    resources[id]=qty;
  }
  return {enabled:true,version:data.version,profession:data.profession,masteryLevel:data.mastery_level,
    masteryXp:data.mastery_xp,dailyXpUsed:data.daily_xp_used,dailyXpCap:data.daily_xp_cap,
    masterLicense:data.master_license,resources};
}

/** Server-verified and idempotent; practice receipts MUST mint no item. */
export async function executeStage8(recipeId: string, operationId: string): Promise<Stage8Receipt> {
  const recipe=STAGE8_RECIPES.find((entry)=>entry.id===recipeId);
  if (!recipe || !uuid(operationId)) throw new Error('stage8_invalid_request');
  const {data,error} = await supabase.rpc('territory_profession_stage8_execute',{p_recipe:recipeId,p_operation:operationId});
  if (error || !obj(data) || data.success!==true || data.recipe_id!==recipeId || data.kind!==recipe.kind
      || !int(data.mastery_level,300) || data.mastery_level<1 || !int(data.mastery_xp,100000)
      || !int(data.daily_xp_used,STAGE8_DAILY_XP_CAP)) throw new Error('stage8_receipt_unconfirmed');
  if (recipe.kind==='practice') {
    if (data.item_id!==null || data.item_output!==null || data.expires_at!==null) throw new Error('stage8_unexpected_reward');
  } else {
    if (!uuid(data.item_id) || !obj(data.item_output) || !recipe.output
        || data.item_output.name!==recipe.output.name || data.item_output.type!==recipe.output.type
        || data.item_output.rarity!==recipe.output.rarity) throw new Error('stage8_missing_item');
    const perishable=(recipe.output.type==='potion' || recipe.output.type==='elixir');
    if (perishable !== (typeof data.expires_at==='string' && Number.isFinite(Date.parse(data.expires_at)))) {
      throw new Error('stage8_invalid_expiry');
    }
    if (!perishable && data.expires_at!==null) throw new Error('stage8_invalid_expiry');
  }
  return {recipeId,kind:recipe.kind,itemId:recipe.kind==='item'?data.item_id as string:null,
    itemOutput:recipe.kind==='item'?data.item_output as Record<string,unknown>:null,
    expiresAt:recipe.kind==='item'&&typeof data.expires_at==='string'?data.expires_at:null,
    masteryLevel:data.mastery_level,masteryXp:data.mastery_xp,dailyXpUsed:data.daily_xp_used};
}

/** New-player purchase is a single server transaction; never use the legacy unlock RPC. */
export async function purchaseStage8(profession: ProfessionId, operationId: string): Promise<Stage8PurchaseReceipt> {
  if (!knownProfession(profession) || !uuid(operationId)) throw new Error('stage8_invalid_purchase');
  const {data,error}=await supabase.rpc('territory_profession_stage8_purchase',
    {p_profession:profession,p_operation:operationId});
  if (error || !obj(data) || data.success!==true || data.profession!==profession
      || !int(data.gems_after,2147483647) || data.mastery_level!==1 || data.mastery_xp!==0) {
    throw new Error('stage8_purchase_not_confirmed');
  }
  return {profession,gemsAfter:data.gems_after};
}

/** Restore server-owned items on every device. Legacy game_state is not an ownership ledger. */
export async function fetchStage8Items(): Promise<Stage8OwnedItem[]> {
  const {data,error}=await supabase.rpc('territory_profession_stage8_inventory');
  if (error || !obj(data) || data.success!==true || !Array.isArray(data.items)
      || data.items.length>2000) throw new Error('stage8_inventory_unavailable');
  return data.items.map((row:unknown)=>{
    if (!obj(row) || !uuid(row.item_id) || typeof row.recipe_id!=='string' || !obj(row.item_output))
      throw new Error('stage8_inventory_invalid');
    const recipe=STAGE8_RECIPES.find((entry)=>entry.id===row.recipe_id && entry.kind==='item');
    if (!recipe?.output || row.item_output.name!==recipe.output.name
        || row.item_output.type!==recipe.output.type || row.item_output.rarity!==recipe.output.rarity)
      throw new Error('stage8_inventory_catalog_mismatch');
    if (row.equipped_slot!==undefined && row.equipped_slot!==null
        && (!['helmet','amulet','armor','weapon','shield','ring','boots'].includes(String(row.equipped_slot))
          || recipe.output.type!=='equipment')) throw new Error('stage8_inventory_slot_invalid');
    const perishable=(recipe.output.type==='potion' || recipe.output.type==='elixir');
    if (perishable !== (typeof row.expires_at==='string' && Number.isFinite(Date.parse(row.expires_at))))
      throw new Error('stage8_inventory_expiry_invalid');
    if (!perishable && row.expires_at!==null) throw new Error('stage8_inventory_expiry_invalid');
    return {itemId:row.item_id,recipeId:row.recipe_id,output:row.item_output,expiresAt:row.expires_at as string|null,equippedSlot:row.equipped_slot as Equipment['slot']|null|undefined};
  });
}

export function mirrorStage8Items(items: InventoryItem[],owned: readonly Stage8OwnedItem[],equippedItemIds: ReadonlySet<string> = new Set()): InventoryItem[] {
  const byId = new Map<string, InventoryItem>();
  for (const item of items) if (!item.id.startsWith('stage8_')) byId.set(item.id,item);
  for (const item of owned) {
    const id=`stage8_${item.itemId}`;
    // Server-equipped items never appear in the backpack at the same time.
    if (item.equippedSlot || (item.equippedSlot === undefined && equippedItemIds.has(id))) continue;
    const copy=receiptDisplayItem({itemId:item.itemId,recipeId:item.recipeId,output:item.output,
      masteryLevel:1,masteryXp:0});
    copy.id=id;
    copy.serverItemId=item.itemId;
    if (copy.equipment) {
      copy.equipment.id=id;
      const gear=item.output.equipment;
      if (obj(gear)) {
        // Server forge levels and immutable baselines must survive display conversion.
        for (const key of ['level','baseLevel','upgradeCount','attack','defense','hp','critChance'] as const) {
          const value=gear[key];
          if (typeof value==='number' && Number.isFinite(value) && value>=0)
            (copy.equipment as unknown as Record<string,unknown>)[key]=value;
        }
        if (obj(gear.baseStats)) copy.equipment.baseStats=gear.baseStats;
      }
    }
    if (copy.type==='elixir'||copy.type==='potion') {
      if (!item.expiresAt) throw new Error('stage8_display_expiry_missing');
      copy.expiresAt=item.expiresAt;
    }
    byId.set(id,copy);
  }
  return [...byId.values()];
}

const PENDING_KEY='territory_stage8_pending_operation_v1';
const PURCHASE_PENDING_KEY='territory_stage8_pending_purchase_v1';
async function signedInId(): Promise<string> {
  const {data:{user},error}=await supabase.auth.getUser();
  if (error || !user?.id) throw new Error('stage8_not_authenticated');
  return user.id;
}
/** Durable account-scoped replay marker. Migrate an in-flight older tab once. */
async function readPendingRecord(key: string): Promise<Record<string, unknown> | null> {
  if (typeof localStorage==='undefined') throw new Error('stage8_storage_unavailable');
  const userId=await signedInId();
  const accountKey=`${key}:${userId}`;
  let raw=localStorage.getItem(accountKey);
  if (!raw && typeof sessionStorage!=='undefined') {
    const legacy=sessionStorage.getItem(key);
    if (legacy) {
      let old: unknown;
      try { old=JSON.parse(legacy); } catch { throw new Error('stage8_pending_corrupt'); }
      if (obj(old) && old.userId===userId) {
        localStorage.setItem(accountKey,legacy);
        sessionStorage.removeItem(key);
        raw=legacy;
      }
    }
  }
  if (!raw) return null;
  let value: unknown;
  try { value=JSON.parse(raw); } catch { throw new Error('stage8_pending_corrupt'); }
  if (!obj(value) || value.userId!==userId || !uuid(value.operationId)) throw new Error('stage8_pending_corrupt');
  return value;
}
async function writePendingRecord(key:string,value: Record<string,unknown>|null): Promise<void> {
  if (typeof localStorage==='undefined') throw new Error('stage8_storage_unavailable');
  const userId=await signedInId();
  const accountKey=`${key}:${userId}`;
  if (value) {
    const old=await readPendingRecord(key);
    if (old && (old.operationId!==value.operationId || old.recipeId!==value.recipeId || old.profession!==value.profession))
      throw new Error('stage8_pending_operation_exists');
    localStorage.setItem(accountKey,JSON.stringify({userId,...value}));
  } else localStorage.removeItem(accountKey);
}
export async function readStage8Pending(): Promise<Stage8PendingOperation|null> {
  const value=await readPendingRecord(PENDING_KEY);
  if (!value) return null;
  if (!STAGE8_RECIPES.some((r)=>r.id===value.recipeId)) throw new Error('stage8_pending_corrupt');
  return {recipeId:value.recipeId as string,operationId:value.operationId as string};
}
export async function setStage8Pending(value: Stage8PendingOperation|null): Promise<void> {
  if (value && (!STAGE8_RECIPES.some((r)=>r.id===value.recipeId)||!uuid(value.operationId))) throw new Error('stage8_invalid_pending');
  await writePendingRecord(PENDING_KEY,value);
}

/** Preserve the same UUID across full Telegram restarts and account switches. */
export async function readStage8PurchasePending(): Promise<Stage8PurchaseOperation|null> {
  const value=await readPendingRecord(PURCHASE_PENDING_KEY);
  if (!value) return null;
  if (!knownProfession(value.profession)) throw new Error('stage8_pending_corrupt');
  return {profession:value.profession,operationId:value.operationId as string};
}
export async function setStage8PurchasePending(value: Stage8PurchaseOperation|null): Promise<void> {
  if (value && (!knownProfession(value.profession)||!uuid(value.operationId))) throw new Error('stage8_invalid_purchase_pending');
  await writePendingRecord(PURCHASE_PENDING_KEY,value);
}

/** Reconcile both backpack and worn slots from the ownership ledger. */
export function mirrorStage8State(state: GameState, owned: readonly Stage8OwnedItem[]): GameState {
  const equipped={...state.player.equipped};
  for (const [slot,eq] of Object.entries(equipped)) {
    if (eq?.id.startsWith('stage8_') && (!owned.length || owned.some(item=>item.equippedSlot!==undefined)))
      delete equipped[slot as Equipment['slot']];
  }
  for (const item of owned) {
    if (!item.equippedSlot) continue;
    const display=mirrorStage8Items([], [{...item,equippedSlot:null}])[0];
    if (!display?.equipment || display.equipment.slot!==item.equippedSlot) throw new Error('stage8_equipment_invalid');
    equipped[item.equippedSlot]=display.equipment;
  }
  const available=new Set(owned.map(item=>item.itemId));
  const belt=state.belt.map(item=>item?.serverItemId && !available.has(item.serverItemId)?null:item);
  const held=new Set(belt.flatMap(item=>item?.serverItemId?[`stage8_${item.serverItemId}`]:[]));
  const inventory=mirrorStage8Items(state.inventory,owned,
    new Set(Object.values(equipped).flatMap(eq=>eq?[eq.id]:[]))).filter(item=>!held.has(item.id));
  return {...state,player:{...state.player,equipped},inventory,belt};
}
