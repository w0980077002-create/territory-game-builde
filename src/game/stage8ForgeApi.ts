/** Protected Stage8 forge. Local game_state never supplies the success roll. */
import { supabase } from '@/game/supabase';
import { acceptMonopolyClaimReceipt } from '@/game/cloud';
import type { GameState } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_ID = /^stage8_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const PREFIX = 'territory_stage8_forge_pending_v1:';
const object = (value:unknown):value is Record<string,unknown> =>
  !!value && typeof value==='object' && !Array.isArray(value);
const integer = (value:unknown):value is number =>
  Number.isSafeInteger(value) && Number(value)>=0;

export type Stage8ForgeReceipt = {
  /** Recovered a previous result only; no new paid attempt was made. */
  recovered: boolean;
  upgraded: boolean;
  beforeLevel: number;
  afterLevel: number;
  goldCost: number;
  materialCost: number;
  state: GameState;
};

type Pending = { itemId:string; level:number; operationId:string };

async function verifyAccount(userId:string):Promise<void>{
  const {data,error}=await supabase.auth.getUser();
  if(error || data.user?.id!==userId) throw new Error('stage8_forge_account_not_verified');
}
function readPending(userId:string):Pending|null{
  const raw=localStorage.getItem(PREFIX+userId);
  if(!raw)return null;
  let p:unknown;
  try{p=JSON.parse(raw);}catch{throw new Error('stage8_forge_pending_corrupt');}
  if(!object(p)||typeof p.itemId!=='string'||!ITEM_ID.test(p.itemId)
    ||!integer(p.level)||p.level<1||p.level>499
    ||typeof p.operationId!=='string'||!UUID.test(p.operationId))
    throw new Error('stage8_forge_pending_corrupt');
  return p as Pending;
}

/** Resolve stale local pending records without triggering a second paid roll.
 * A different item/level may have been saved already, but our browser lost its
 * receipt after server commit. This API is read-only and scoped to auth.uid().
 */
async function recoverPreviousStage8Forge(
  userId:string,pending:Pending,
):Promise<Stage8ForgeReceipt>{
  const itemMatch=ITEM_ID.exec(pending.itemId);
  if(!itemMatch)throw new Error('stage8_forge_pending_corrupt');
  const {data,error}=await supabase.rpc('territory_stage8_forge_pending_recovery_v1',{
    p_item:itemMatch[1],p_expected_level:pending.level,p_operation:pending.operationId,
  });
  if(error)throw new Error(error.message||'stage8_forge_recovery_unavailable');
  if(!object(data)||data.success!==true||typeof data.found!=='boolean'
    ||data.item_id!==itemMatch[1]||data.expected_level!==pending.level
    ||!integer(data.current_level)||data.current_level<1)
    throw new Error('stage8_forge_recovery_unverified');
  if(data.found){
    const result=data.result;
    if(!object(result)||result.success!==true
      ||result.item_id!==itemMatch[1]||result.level_before!==pending.level
      ||typeof result.upgraded!=='boolean'
      ||result.level_after!==pending.level+(result.upgraded?1:0)
      ||result.cost_gold!==50+pending.level*30
      ||result.cost_materials!==1+Math.floor(pending.level/3))
      throw new Error('stage8_forge_recovery_receipt_mismatch');
  }else if(data.current_level<=pending.level){
    // This operation was never confirmed. Never auto-roll an old item while
    // the user is asking to upgrade something else or a newer local level.
    throw new Error('stage8_forge_previous_operation_unconfirmed');
  }
  const canonical=data.game_state as GameState;
  const gear=[
    ...(Array.isArray(canonical?.inventory)
      ? canonical.inventory.filter((item)=>item.id===pending.itemId).map((item)=>item.equipment)
      : []),
    ...(canonical?.player?.equipped
      ? Object.values(canonical.player.equipped).filter((eq)=>eq?.id===pending.itemId)
      : []),
  ];
  if(gear.length!==1||gear[0]?.level!==data.current_level)
    throw new Error('stage8_forge_recovery_mirror_conflict');
  // acceptMonopolyClaimReceipt updates the shared CAS save revision, so an
  // ordinary autosave cannot restore older materials, gold or gear.
  const state=acceptMonopolyClaimReceipt(userId,data);
  localStorage.removeItem(PREFIX+userId);
  return {recovered:true,upgraded:false,beforeLevel:pending.level,
    afterLevel:data.current_level as number,goldCost:0,materialCost:0,state};
}

/** Enabled only when the authenticated server RPC has actually been installed. */
export async function stage8ForgeAvailable():Promise<boolean>{
  const {data,error}=await supabase.rpc('territory_stage8_forge_ready_v1');
  return !error && data===true;
}

export async function attemptStage8Forge(
  userId:string,itemId:string,expectedLevel:number,
):Promise<Stage8ForgeReceipt>{
  const match=ITEM_ID.exec(itemId);
  if(!match || !integer(expectedLevel)||expectedLevel<1||expectedLevel>499)
    throw new Error('stage8_forge_invalid_item');
  await verifyAccount(userId);
  const pending=readPending(userId);
  // Client may be at level 23 while durable storage still remembers the
  // successfully committed level-22 operation. Read the receipt first.
  // Absolutely no new RNG roll or debit occurs in this recovery branch.
  if(pending && (pending.itemId!==itemId||pending.level!==expectedLevel))
    return recoverPreviousStage8Forge(userId,pending);
  const operationId=pending?.operationId ?? crypto.randomUUID();
  if(!pending) localStorage.setItem(PREFIX+userId,
    JSON.stringify({itemId,level:expectedLevel,operationId} satisfies Pending));
  // All unknown outcomes KEEP the same operation ID; retries cannot double-debit.
  const {data,error}=await supabase.rpc('territory_stage8_forge_v1',{
    p_item:match[1],p_expected_level:expectedLevel,p_operation:operationId,
  });
  if(error){
    // These PostgreSQL rejections occur BEFORE the debit; release their
    // operation marker. Network failures or unknown results remain retriable.
    const rejectedBeforeDebit=new Set([
      'stage8_forge_insufficient_resources','stage8_forge_level_conflict',
      'stage8_forge_item_not_owned','stage8_forge_reconcile_required',
      'stage8_forge_mirror_missing_or_duplicate','stage8_forge_quality_cap_conflict',
      'stage8_forge_bad_registry','stage8_forge_invalid_gear',
      'stage8_forge_bad_request','stage8_forge_save_unavailable',
    ]);
    if(rejectedBeforeDebit.has(error.message))localStorage.removeItem(PREFIX+userId);
    throw new Error(error.message||'stage8_forge_rpc_failed');
  }
  if(!object(data)||data.success!==true||data.item_id!==match[1]
    ||data.level_before!==expectedLevel
    ||typeof data.upgraded!=='boolean'
    ||data.level_after!==expectedLevel+(data.upgraded?1:0)
    ||!integer(data.cost_gold)||!integer(data.cost_materials)
    ||data.cost_gold!==50+expectedLevel*30
    ||data.cost_materials!==1+Math.floor(expectedLevel/3))
    throw new Error('stage8_forge_unverified_receipt');

  // Same server save fence as other atomic RPC rewards, rather than a
  // second client-side save that could reintroduce old inventory or wallets.
  const state=acceptMonopolyClaimReceipt(userId,data);
  localStorage.removeItem(PREFIX+userId);
  return {recovered:data.replayed===true,upgraded:data.upgraded,beforeLevel:expectedLevel,
    afterLevel:data.level_after as number,goldCost:data.cost_gold as number,
    materialCost:data.cost_materials as number,state};
}
