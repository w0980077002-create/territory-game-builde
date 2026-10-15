import { supabase } from './supabase';

/** Server shop bridge; disabled while the legacy client can write currency. */
export type ShopStatus = { enabled: boolean; gems: number; stones: number; boughtToday: number; stoneDay: string };
export type ShopReceipt = { gemsAfter: number; stonesAfter: number; boughtToday: number; stoneDay: string };
export type ShopRequest = { itemId: 'shop_stone_1' | 'shop_stone_5'; quantity: number; operationId: string };
const record = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const valid = (n: unknown, max = 2147483647): n is number => Number.isSafeInteger(n) && (n as number)>=0 && (n as number)<=max;
const uuid = (v: unknown): v is string => typeof v==='string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const day = (v:unknown): v is string => typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export async function fetchShopStatus(): Promise<ShopStatus | null> {
  const {data,error} = await supabase.rpc('territory_shop_status_v1');
  if (error) {
    if(error.code==='PGRST202'||error.code==='42883'||/could not find the function|function.*does not exist/i.test(error.message))return null;
    throw new Error('shop_status_unavailable');
  }
  if(!record(data)||typeof data.enabled!=='boolean')throw new Error('invalid_shop_status');
  if(!data.enabled)return {enabled:false,gems:0,stones:0,boughtToday:0,stoneDay:''};
  if(!valid(data.gems)||!valid(data.stones)||!valid(data.bought_today,25)||!day(data.stone_day))throw new Error('invalid_shop_wallet');
  return {enabled:true,gems:data.gems,stones:data.stones,boughtToday:data.bought_today,stoneDay:data.stone_day};
}
export async function purchaseServerStones(request:ShopRequest):Promise<ShopReceipt>{
  if(!['shop_stone_1','shop_stone_5'].includes(request.itemId)||!valid(request.quantity,25)||request.quantity<1||!uuid(request.operationId)) throw new Error('invalid_shop_operation');
  const {data,error}=await supabase.rpc('territory_shop_buy_stones_v1',{
    p_item_id:request.itemId,p_quantity:request.quantity,p_operation:request.operationId,
  });
  if(error)throw new Error('shop_transaction_unavailable');
  if(!record(data)||data.success!==true||data.item_id!==request.itemId||data.quantity!==request.quantity||!valid(data.gems_after)||!valid(data.stones_after)||!valid(data.stone_bought,25)||!day(data.stone_day))throw new Error('invalid_shop_receipt');
  return {gemsAfter:data.gems_after,stonesAfter:data.stones_after,boughtToday:data.stone_bought,stoneDay:data.stone_day};
}
export type PendingShop = ShopRequest;
const KEY='territory_pending_server_shop_v1';
export async function readPendingShop():Promise<PendingShop|null>{
  if(typeof sessionStorage==='undefined')return null;
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user?.id)return null;
  try{
    const raw=sessionStorage.getItem(KEY);
    const v:unknown=raw?JSON.parse(raw):null;
    if(!record(v)||v.userId!==user.id||!['shop_stone_1','shop_stone_5'].includes(String(v.itemId))||!valid(v.quantity,25)||v.quantity<1||!uuid(v.operationId))return null;
    return {itemId:v.itemId as PendingShop['itemId'],quantity:v.quantity,operationId:v.operationId};
  }catch{return null;}
}
export async function keepPendingShop(pending:PendingShop|null):Promise<void>{
  if(typeof sessionStorage==='undefined')throw new Error('storage_unavailable');
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user?.id)throw new Error('session_unavailable');
  if(pending){
    if(!uuid(pending.operationId)||!valid(pending.quantity,25)||!['shop_stone_1','shop_stone_5'].includes(pending.itemId))throw new Error('invalid_request');
    sessionStorage.setItem(KEY,JSON.stringify({...pending,userId:user.id}));
  }else if(await readPendingShop())sessionStorage.removeItem(KEY);
}
