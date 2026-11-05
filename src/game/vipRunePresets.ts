import { supabase } from './supabase';
import runeCatalog from './config/territory-independent-rune-slots-v1.json';
import { parseRuneServerStatus, runeSlotCatalog } from './builds/runeSlotsV1';

const ENABLED = import.meta.env?.VITE_VIP_RUNE_PRESETS_ENABLED === 'true';
const definitions=runeSlotCatalog(runeCatalog);
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
type Slot = 1 | 2;
type Pending = {version:1;slot:Slot;revision:number;operation:string};
const active=new Map<string,Promise<boolean>>();
const key = (userId:string)=>'territory:vip-rune-preset:v1:'+userId;
export type VipRunePresetStatus = {vip:number;presets:{slot:Slot;slots:{slotId:string;runeId:string|null}[]}[]};
function validSlot(x:unknown):x is Slot{return x===1||x===2;}
function parseStored(raw:string|null):Pending|null {
 if(!raw)return null;
 let p:Pending;
 try{p=JSON.parse(raw) as Pending;}catch{throw Error('vip_rune_corrupt_pending');}
 if(p.version!==1||!validSlot(p.slot)||!Number.isSafeInteger(p.revision)
   ||p.revision<0||!UUID.test(p.operation))throw Error('vip_rune_corrupt_pending');
 return p;
}
function readPending(userId:string):Pending|null {
 return parseStored(window.localStorage.getItem(key(userId)));
}
export function vipRunePresetsEnabled():boolean{return ENABLED;}
export function pendingVipRunePresetSlot(userId:string):Slot|null {
 if(!ENABLED)return null;
 try{return readPending(userId)?.slot??null;}catch{return null;}
}
export function hasPendingVipRunePreset(userId:string):boolean{
 if(!ENABLED)return false;
 try{return readPending(userId)!==null;}catch{return true;}
}
async function owner():Promise<string>{
 const {data,error}=await supabase.auth.getUser();
 if(error||!data.user?.id||!UUID.test(data.user.id))throw Error('vip_rune_auth_required');
 return data.user.id;
}
function checkSlots(raw:unknown):{slotId:string;runeId:string|null}[]{
 if(!Array.isArray(raw)||raw.length!==15)throw Error('vip_rune_preset_status_invalid');
 return raw.map((entry,index)=>{
   const definition=definitions[index];
   if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('vip_rune_preset_status_invalid');
   const obj=entry as Record<string,unknown>;
   if(Object.keys(obj).length!==2||obj.slotId!==definition.slotId
     ||!(obj.runeId===null||
       (typeof obj.runeId==='string' && definition.options.includes(obj.runeId))))
       throw Error('vip_rune_preset_status_invalid');
   return {slotId:definition.slotId,runeId:obj.runeId as string|null};
 });
}
export function parseVipRunePresetStatus(raw:unknown):VipRunePresetStatus{
 if(!raw||typeof raw!=='object')throw Error('vip_rune_preset_status_invalid');
 const data=raw as Record<string,unknown>;
 if(!Number.isInteger(data.vip)||Number(data.vip)<0||Number(data.vip)>10
   ||!Array.isArray(data.presets)||data.presets.length>2)throw Error('vip_rune_preset_status_invalid');
 const seen=new Set<Slot>();
 return {vip:Number(data.vip),presets:data.presets.map((p:unknown)=>{
   if(!p||typeof p!=='object')throw Error('vip_rune_preset_status_invalid');
   const row=p as Record<string,unknown>;
   if(!validSlot(row.slot)||seen.has(row.slot))throw Error('vip_rune_preset_status_invalid');
   seen.add(row.slot);
   return {slot:row.slot,slots:checkSlots(row.slots)};
 })};
}
export async function fetchVipRunePresets():Promise<VipRunePresetStatus>{
 if(!ENABLED)throw Error('vip_rune_not_enabled');
 await owner();
 const {data,error}=await supabase.rpc('territory_vip_rune_presets_status_v1');
 if(error)throw Error('vip_rune_status_unavailable');
 return parseVipRunePresetStatus(data);
}
export async function saveVipRunePreset(slot:Slot,revision:number):Promise<void>{
 if(!ENABLED||!validSlot(slot)||!Number.isSafeInteger(revision)||revision<0)
   throw Error('vip_rune_invalid_request');
 const userId=await owner();
 if(hasPendingVipRunePreset(userId))throw Error('vip_rune_recovery_required');
 const {data,error}=await supabase.rpc('territory_vip_rune_preset_save_v1',{
  p_slot:slot,p_revision:revision,
 });
 if(error||data?.success!==true||data?.preset_no!==slot||data?.revision!==revision
   ||!Array.isArray(data.slots))throw Error('vip_rune_save_unconfirmed');
 checkSlots(data.slots);
}
export function applyVipRunePreset(slot:Slot,revision:number):Promise<boolean>{
 if(!ENABLED||!validSlot(slot)||!Number.isSafeInteger(revision)||revision<0)
   return Promise.reject(Error('vip_rune_invalid_request'));
 const job=(async()=>{
   const userId=await owner();
   const existing=active.get(userId);
   if(existing)return existing;
   const task=(async()=>{
     let pending=readPending(userId);
     if(pending&&pending.slot!==slot)throw Error('vip_rune_recovery_required');
     if(!pending){
       pending={version:1,slot,revision,operation:crypto.randomUUID()};
       const raw=JSON.stringify(pending);
       window.localStorage.setItem(key(userId),raw);
       if(window.localStorage.getItem(key(userId))!==raw)
         throw Error('vip_rune_storage_unavailable');
     }
     try{
       const {data,error}=await supabase.rpc('territory_vip_rune_preset_apply_v1',{
         p_slot:pending.slot,p_revision:pending.revision,p_operation:pending.operation,
       });
       if(error)throw error;
       if(!data||data.schema!=='territory-rune-slots/1'
         ||data.operationId!==pending.operation
         ||!Number.isSafeInteger(data.revision)||data.revision<pending.revision
         ||(data.alreadyApplied!==true&&data.revision!==pending.revision+1))
         throw Error('vip_rune_invalid_receipt');
       checkSlots(data.slots);
       // Authenticated fresh ledger read verifies all equipped runes still belong
       // to this hero. We never apply unverified client rune effects.
       const {data:confirmed,error:readError}=await supabase.rpc('territory_runes_status_v1');
       if(readError)throw readError;
       const verified=parseRuneServerStatus(confirmed,definitions);
       if(verified.revision<data.revision)throw Error('vip_rune_stale_receipt');
       if(window.localStorage.getItem(key(userId))!==JSON.stringify(pending))
         throw Error('vip_rune_pending_changed');
       window.localStorage.removeItem(key(userId));
       return true;
     }catch(error){
       if(error&&typeof error==='object'&&'code'in error
         &&(error as {code?:unknown}).code==='P0001'){
         // PostgreSQL rejected and rolled back; only then can this UUID be retired.
         if(window.localStorage.getItem(key(userId))===JSON.stringify(pending))
           window.localStorage.removeItem(key(userId));
       }
       throw error;
     }
   })();
   active.set(userId,task);
   void task.finally(()=>{if(active.get(userId)===task)active.delete(userId);}).catch(()=>{});
   return task;
 })();
 return job;
}
