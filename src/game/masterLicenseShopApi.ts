import {supabase} from './supabase';
import type {GameState} from './types';
import {getSaveToken} from './cloudInt';

/** A separate, server-owned red-gem snapshot protects this permanent unlock. */
export const MASTER_LICENSE_PRICE_RED = 50;
export const MASTER_LICENSE_ART = '/master-craftsman-license.webp';

export type MasterLicenseShopStatus = {
  enabled: boolean;
  owned: boolean;
  hasProfession: boolean;
  verifiedTelegram: boolean;
  redBalance: number;
};
export type MasterLicenseBuyReceipt = {
  operationId: string;
  redBalance: number;
  gameState: GameState;
  updatedAt: string;
  gold: number;
  gems: number;
};
const record = (value:unknown):value is Record<string,unknown> =>
  !!value && typeof value==='object' && !Array.isArray(value);
const nonNegative = (value:unknown):value is number =>
  Number.isSafeInteger(value) && (value as number)>=0 && (value as number)<=2147483647;
const uuid = (value:unknown):value is string =>
  typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function fetchMasterLicenseShopStatus():Promise<MasterLicenseShopStatus> {
  const {data,error}=await supabase.rpc('territory_master_license_shop_status_v1');
  if (error || !record(data) || data.enabled!==true || data.price!==MASTER_LICENSE_PRICE_RED
    || !nonNegative(data.red_balance) || typeof data.owned!=='boolean'
    || typeof data.has_profession!=='boolean' || typeof data.verified_telegram!=='boolean')
    throw new Error('master_license_status_unavailable');
  return {enabled:true,owned:data.owned,redBalance:data.red_balance,
    hasProfession:data.has_profession,verifiedTelegram:data.verified_telegram};
}

export async function buyMasterLicense(operationId:string):Promise<MasterLicenseBuyReceipt> {
  if (!uuid(operationId)) throw new Error('master_license_invalid_operation');
  const {data:{user},error:authError}=await supabase.auth.getUser();
  const expected=user?.id?getSaveToken(user.id):undefined;
  if(authError || !user?.id || !expected)throw new Error('master_license_reload_required');
  const {data,error}=await supabase.rpc('territory_master_license_shop_buy_v1',
    {p_operation:operationId,p_expected:expected});
  if (error) throw new Error(`master_license_purchase_denied:${error.message}`);
  if (!record(data) || data.success!==true || data.owned!==true
    || data.operation_id!==operationId || data.price!==MASTER_LICENSE_PRICE_RED
    || !nonNegative(data.red_balance) || !record(data.game_state)
    || !nonNegative(data.wallet_gold) || !nonNegative(data.wallet_gems)
    || typeof data.updated_at!=='string' || !Number.isFinite(Date.parse(data.updated_at)))
    throw new Error('master_license_receipt_invalid');
  return {operationId,redBalance:data.red_balance,gameState:data.game_state as unknown as GameState,
    updatedAt:data.updated_at,gold:data.wallet_gold,gems:data.wallet_gems};
}

const PENDING_KEY='territory_master_license_pending_v1';
export async function readMasterLicensePending():Promise<string|null> {
  if (typeof sessionStorage==='undefined')return null;
  const {data:{user},error}=await supabase.auth.getUser();
  if (error || !user?.id)return null;
  try {
    const raw=sessionStorage.getItem(PENDING_KEY);
    const entry:unknown=raw?JSON.parse(raw):null;
    if (!record(entry)||entry.userId!==user.id||!uuid(entry.operationId))return null;
    return entry.operationId;
  } catch {return null;}
}
export async function keepMasterLicensePending(operationId:string|null):Promise<void> {
  if (typeof sessionStorage==='undefined')throw new Error('master_license_storage_unavailable');
  const {data:{user},error}=await supabase.auth.getUser();
  if (error || !user?.id)throw new Error('master_license_login_required');
  if (operationId) {
    if (!uuid(operationId))throw new Error('master_license_invalid_operation');
    sessionStorage.setItem(PENDING_KEY,JSON.stringify({userId:user.id,operationId}));
  } else if (await readMasterLicensePending()) sessionStorage.removeItem(PENDING_KEY);
}
