/** Protected Stage8 forge. Local game_state never supplies the success roll. */
import { supabase } from '@/game/supabase';
import { acceptMonopolyClaimReceipt } from '@/game/cloud';
import { fetchStage8Items } from '@/game/stage8CraftApi';
import { isPreviouslyCommittedStage8Upgrade } from './stage8ForgeRecovery';
import type { GameState } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_ID = /^stage8_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const PREFIX = 'territory_stage8_forge_pending_v1:';
const object = (value:unknown):value is Record<string,unknown> =>
  !!value && typeof value==='object' && !Array.isArray(value);
const integer = (value:unknown):value is number =>
  Number.isSafeInteger(value) && Number(value)>=0;

export type Stage8ForgeReceipt = {
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

/**
 * Self-heal the exact deadlock observed after a confirmed upgrade: an old
 * localStorage UUID survives a server save acknowledgement, then prevents the
 * next level (e.g. 22 -> 23, next tap 23 -> 24).
 *
 * We NEVER delete markers merely because they are old, because a failed roll
 * still spends resources and must be replayed with the same operation UUID.
 * Only an authenticated, server-owned item whose canonical level has
 * advanced beyond the pending level proves that marker is obsolete.
 */
export async function recoverCompletedStage8Forge(userId: string): Promise<boolean> {
  await verifyAccount(userId);
  const pending = readPending(userId);
  if (!pending) return false;
  const owned = await fetchStage8Items();
  if (!isPreviouslyCommittedStage8Upgrade(pending, owned)) return false;
  const latest = readPending(userId);
  if (!latest || latest.operationId !== pending.operationId
      || latest.itemId !== pending.itemId || latest.level !== pending.level) return false;
  localStorage.removeItem(PREFIX + userId);
  return true;
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
  let pending=readPending(userId);
  if(pending && (pending.itemId!==itemId || pending.level!==expectedLevel)){
    if(await recoverCompletedStage8Forge(userId)){
      // Recovery itself is READ-ONLY; never quietly initiate another paid roll.
      // A second explicit tap may initiate the next server-authoritative roll.
      throw new Error('stage8_forge_previous_operation_recovered');
    }
    throw new Error('stage8_forge_other_operation_pending');
  }
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
      'stage8_forge_bad_registry','stage8_forge_partial_registry','stage8_forge_invalid_gear',
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
  return {upgraded:data.upgraded,beforeLevel:expectedLevel,
    afterLevel:data.level_after as number,goldCost:data.cost_gold as number,
    materialCost:data.cost_materials as number,state};
}
