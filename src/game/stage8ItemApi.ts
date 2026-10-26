import { supabase } from './supabase';
import { useGame } from './actions';
import { acceptStage8ItemReceipt, loadCloudSave, saveCloudSave } from './cloud';
import { fetchStage8Items, mirrorStage8State } from './stage8CraftApi';

export type Stage8ItemAction = 'equip'|'unequip'|'upgrade'|'recycle'|'discard'|'consume';
const KEY='territory_stage8_item_action_v1:';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let locked=false;
export const isStage8Item = (id: string|undefined): boolean => !!id && id.startsWith('stage8_');

/** Durable, account-scoped replay. An uncertain response never gets a new UUID. */
export async function stage8ItemAction(itemId:string,action:Stage8ItemAction):Promise<{upgraded:boolean;effect?:unknown;consumedItemId?:string}> {
  if(locked) throw new Error('stage8_action_busy');
  locked=true;
  try {
    const {data:{user},error}=await supabase.auth.getUser();
    if(error || !user) throw new Error('stage8_not_authenticated');
    const account=user.id;
    const item=itemId.replace(/^equipped_/,'').replace(/^stage8_/,'');
    if(!UUID.test(item)) throw new Error('stage8_invalid_item');
    const key=KEY+account;
    let pending:{item:string;action:Stage8ItemAction;operation:string};
    const raw=localStorage.getItem(key);
    if(raw) {
      pending=JSON.parse(raw);
      if(!UUID.test(pending.operation)||pending.item!==item||pending.action!==action)
        throw new Error('stage8_pending_action_exists');
    } else {
      const snapshot=useGame.get();
      if(!await saveCloudSave(account,snapshot)||useGame.get()!==snapshot) throw new Error('stage8_save_changed');
      pending={item,action,operation:crypto.randomUUID()};
      localStorage.setItem(key,JSON.stringify(pending));
    }
    const {data:{user:beforeRequest}}=await supabase.auth.getUser();
    if(beforeRequest?.id!==account) throw new Error('stage8_account_changed');
    const response=await supabase.rpc('territory_profession_stage8_item_action',{
      p_item:pending.item,p_action:pending.action,p_operation:pending.operation,
    });
    const {data:{user:current}}=await supabase.auth.getUser();
    if(current?.id!==account) throw new Error('stage8_account_changed');
    // SQL exceptions roll the whole transaction back; only these definite
    // rejections can safely release the marker. Transport failures retain it.
    if(response.error && ['P0001','42501','28000','22023'].includes(response.error.code ?? '')) {
      localStorage.removeItem(key);
      throw new Error('stage8_action_rejected');
    }
    const receipt=response.data;
    if(response.error||!receipt||receipt.success!==true||receipt.action!==action||receipt.item_id!==item)
      throw new Error('stage8_action_unconfirmed');
    // Replays may contain an earlier revision: load the latest canonical state.
    try {acceptStage8ItemReceipt(account,receipt);}
    catch { /* A replay can predate this device's last confirmed revision. */ }
    const state=(await loadCloudSave(account,useGame.get().player.name)).state;
    const owned=await fetchStage8Items();
    const {data:{user:finalUser}}=await supabase.auth.getUser();
    if(finalUser?.id!==account) throw new Error('stage8_account_changed');
    useGame.set(mirrorStage8State(state,owned));
    localStorage.removeItem(key);
    return {upgraded:receipt.upgraded===true,effect:receipt.effect,consumedItemId:receipt.consumed_item_id};
  } finally {locked=false;}
}

/** Recover even if a confirmed recycle/consume no longer has a visible item button. */
export async function recoverStage8ItemAction(): Promise<void> {
  const {data:{user},error}=await supabase.auth.getUser();
  if(error || !user) throw new Error('stage8_not_authenticated');
  const raw=localStorage.getItem(KEY+user.id);
  if(!raw) return;
  const pending=JSON.parse(raw);
  if(!UUID.test(pending.item) || !UUID.test(pending.operation)
    || !['equip','unequip','upgrade','recycle','discard','consume'].includes(pending.action))
    throw new Error('stage8_pending_corrupt');
  await stage8ItemAction(`stage8_${pending.item}`,pending.action);
}
