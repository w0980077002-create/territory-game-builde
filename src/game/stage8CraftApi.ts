/**
 * Stage8 server-only profession bridge. This module has NO local craft/XP path.
 * It is loaded only by the off-by-default staging screen. Do not enable the
 * client gate until the versioned SQL RPCs and old-save migration are verified.
 */
import { supabase } from './supabase';
import blueprint from '../../supabase/staged/territory_profession_stage8_catalog.json';
import { receiptDisplayItem } from './craftApi';
import type { InventoryItem, ProfessionId } from './types';

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
    type: 'equipment' | 'potion' | 'elixir';
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
    const perishable=recipe.output.type==='potion' || recipe.output.type==='elixir';
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
    const perishable=recipe.output.type==='potion'||recipe.output.type==='elixir';
    if (perishable !== (typeof row.expires_at==='string' && Number.isFinite(Date.parse(row.expires_at))))
      throw new Error('stage8_inventory_expiry_invalid');
    if (!perishable && row.expires_at!==null) throw new Error('stage8_inventory_expiry_invalid');
    return {itemId:row.item_id,recipeId:row.recipe_id,output:row.item_output,expiresAt:row.expires_at as string|null};
  });
}

export function mirrorStage8Items(items: InventoryItem[],owned: readonly Stage8OwnedItem[]): InventoryItem[] {
  const byId = new Map<string, InventoryItem>();
  for (const item of items) if (!item.id.startsWith('stage8_')) byId.set(item.id,item);
  for (const item of owned) {
    const copy=receiptDisplayItem({itemId:item.itemId,recipeId:item.recipeId,output:item.output,
      masteryLevel:1,masteryXp:0});
    const id=`stage8_${item.itemId}`;
    copy.id=id;
    if (copy.equipment) copy.equipment.id=id;
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
export async function readStage8Pending(): Promise<Stage8PendingOperation|null> {
  if (typeof sessionStorage==='undefined') return null;
  const userId=await signedInId();
  try {
    const raw=sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const value:unknown=JSON.parse(raw);
    if (!obj(value) || value.userId!==userId || !STAGE8_RECIPES.some((r)=>r.id===value.recipeId) || !uuid(value.operationId)) return null;
    return {recipeId:value.recipeId as string,operationId:value.operationId};
  }catch{return null;}
}
export async function setStage8Pending(value: Stage8PendingOperation|null): Promise<void> {
  if (typeof sessionStorage==='undefined') throw new Error('stage8_storage_unavailable');
  const userId=await signedInId();
  if (value) {
    if (!STAGE8_RECIPES.some((r)=>r.id===value.recipeId)||!uuid(value.operationId)) throw new Error('stage8_invalid_pending');
    sessionStorage.setItem(PENDING_KEY,JSON.stringify({userId,...value}));
  }else {
    const current=await readStage8Pending();
    if (current) sessionStorage.removeItem(PENDING_KEY);
  }
}

/** Preserve the same UUID if an ambiguous network failure interrupts gem spending. */
export async function readStage8PurchasePending(): Promise<Stage8PurchaseOperation|null> {
  if (typeof sessionStorage==='undefined') return null;
  const userId=await signedInId();
  try {
    const raw=sessionStorage.getItem(PURCHASE_PENDING_KEY);
    if (!raw) return null;
    const value:unknown=JSON.parse(raw);
    if (!obj(value) || value.userId!==userId || !knownProfession(value.profession) || !uuid(value.operationId)) return null;
    return {profession:value.profession,operationId:value.operationId};
  }catch{return null;}
}
export async function setStage8PurchasePending(value: Stage8PurchaseOperation|null): Promise<void> {
  if (typeof sessionStorage==='undefined') throw new Error('stage8_storage_unavailable');
  const userId=await signedInId();
  if (value) {
    if (!knownProfession(value.profession)||!uuid(value.operationId)) throw new Error('stage8_invalid_purchase_pending');
    sessionStorage.setItem(PURCHASE_PENDING_KEY,JSON.stringify({userId,...value}));
  }else {
    const current=await readStage8PurchasePending();
    if (current) sessionStorage.removeItem(PURCHASE_PENDING_KEY);
  }
}
