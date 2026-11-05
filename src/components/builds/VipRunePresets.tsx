import { useEffect, useState } from 'react';
import { Check, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { supabase } from '@/game/supabase';
import {
  applyVipRunePreset, fetchVipRunePresets, hasPendingVipRunePreset,
  pendingVipRunePresetSlot, saveVipRunePreset, vipRunePresetsEnabled,
  type VipRunePresetStatus,
} from '@/game/vipRunePresets';

type Slot = 1 | 2;

/** No fake action: this control only appears after the protected VIP rune
 * RPCs are deployed. Drafts and in-flight 15-slot saves always take priority. */
export function VipRunePresets({en,revision,dirty,locked,onApplied}:{
  en:boolean;revision:number;dirty:boolean;locked:boolean;onApplied:()=>void;
}) {
  const enabled=vipRunePresetsEnabled();
  const [status,setStatus]=useState<VipRunePresetStatus|null>(null);
  const [userId,setUserId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [pending,setPending]=useState(false);
  useEffect(()=>{
    if(!enabled)return;
    let alive=true;
    void (async()=>{
      const {data,error}=await supabase.auth.getUser();
      if(error||!data.user?.id)throw Error('auth');
      const result=await fetchVipRunePresets();
      if(alive){
        setUserId(data.user.id);
        setStatus(result);
        setPending(hasPendingVipRunePreset(data.user.id));
      }
    })().catch(()=>{if(alive)setNotice(en
      ? 'VIP rune presets are not available right now.'
      : 'Пресеты VIP пока не удалось проверить на сервере.');});
    return()=>{alive=false;};
  },[enabled,en,revision]);

  if(!enabled)return null;
  const pendingSlot=userId?pendingVipRunePresetSlot(userId):null;
  const act=async(slot:Slot,kind:'save'|'apply')=>{
    if(busy||locked||dirty)return;
    setBusy(true);setNotice('');
    try{
      if(kind==='save')await saveVipRunePreset(slot,revision);
      else{
        await applyVipRunePreset(slot,revision);
        onApplied();
      }
      const result=await fetchVipRunePresets();
      setStatus(result);
      if(userId)setPending(hasPendingVipRunePreset(userId));
      setNotice(kind==='save'
        ?(en?'All 15 rune slots saved to this preset.':'Все 15 рун сохранены в пресете.')
        :(en?'Owned rune build restored from the server.':'Сборка подтверждённых рун восстановлена.'));
    }catch(error){
      const message=error instanceof Error?error.message:'';
      if(userId)setPending(hasPendingVipRunePreset(userId));
      setNotice(/combat_active/.test(message)
        ?(en?'Finish the current battle first.':'Сначала заверши бой.')
        :/not_owned/.test(message)
        ?(en?'A saved rune is no longer owned.':'Одна из сохранённых рун больше не принадлежит герою.')
        :(en?'The server did not confirm the operation. Recover the same request.'
          :'Сервер не подтвердил операцию. Восстанови тот же запрос.'));
    }finally{setBusy(false);}
  };
  return <section className="mx-2 my-2 rounded-lg border border-amber-400/50 bg-[#3b2418] p-2 text-amber-100"
    data-testid="vip-rune-presets">
    <header className="mb-1.5 flex items-center gap-1.5">
      <ShieldCheck size={16} className="text-amber-300"/>
      <strong className="text-xs">{en?'VIP rune presets':'VIP-пресеты рун'}</strong>
      <small className="ml-auto text-[10px]">{status?'VIP '+status.vip:''}</small>
    </header>
    {pending&&<button type="button" disabled={busy||locked||pendingSlot===null}
      onClick={()=>{if(pendingSlot)void act(pendingSlot,'apply');}}
      className="mb-1.5 flex min-h-10 w-full items-center justify-center gap-1 rounded-md border border-amber-300/60 bg-amber-800 px-2 text-xs font-bold disabled:opacity-50">
      <RotateCcw size={14}/>{en?'Recover unfinished rune switch':'Восстановить переключение рун'}
    </button>}
    <div className="grid grid-cols-1 gap-1.5 min-[360px]:grid-cols-2">
      {([1,2] as const).map(slot=>{
        const unlocked=(status?.vip??0)>=(slot===1?3:6);
        const saved=status?.presets.find(p=>p.slot===slot);
        const count=saved?.slots.filter(p=>p.runeId!==null).length??0;
        return <div key={slot} className="rounded-md border border-amber-300/20 bg-black/25 p-1.5">
          <div className="mb-1 flex justify-between text-[11px]">
            <span>{en?'Build':'Сборка'} {slot}</span>
            <span className="text-amber-300">{unlocked
              ? saved?count+'/15':(en?'Empty':'Пусто')
              :'VIP '+(slot===1?3:6)}</span>
          </div>
          <div className="flex gap-1">
            <button type="button" disabled={!unlocked||busy||locked||dirty||pending}
              onClick={()=>void act(slot,'save')}
              className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-md border border-amber-400/40 bg-amber-800/60 px-1 text-[11px] font-bold disabled:opacity-40">
              <Save size={13}/>{en?'Save':'Запомнить'}
            </button>
            <button type="button" disabled={!unlocked||!saved||busy||locked||dirty||pending}
              onClick={()=>void act(slot,'apply')}
              className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-md border border-amber-200 bg-gradient-to-b from-[#f4d58f] to-[#b9813a] px-1 text-[11px] font-bold text-[#2b170d] disabled:opacity-40">
              <Check size={13}/>{en?'Equip':'Надеть'}
            </button>
          </div>
        </div>;
      })}
    </div>
    {dirty&&<p className="mt-1 text-[10px] text-amber-200/80">{en
      ?'Save your current draft first.':'Сначала сохрани текущую сборку.'}</p>}
    {notice&&<p className="mt-1 text-[11px]" role="status" aria-live="polite">{notice}</p>}
  </section>;
}
