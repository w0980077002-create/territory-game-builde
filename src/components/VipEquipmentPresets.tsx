import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import {
  applyVipEquipmentPreset, fetchVipEquipmentPresets, hasPendingVipEquipmentPreset,
  pendingVipEquipmentPresetSlot, saveVipEquipmentPreset, vipEquipmentPresetsEnabled,
  type VipEquipmentPresetStatus,
} from '@/game/vipEquipmentPresets';

type PresetNo = 1 | 2;

/** Real server-owned VIP loadouts. Hidden until the reviewed RPC and WAL
 * reconciliation are deployed, never a cosmetic/demo switch. */
export function VipEquipmentPresets({ userId, onApplied }: {
  userId: string;
  onApplied?: () => void;
}) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [status,setStatus] = useState<VipEquipmentPresetStatus | null>(null);
  const [busy,setBusy] = useState(false);
  const [pending,setPending] = useState(false);
  const [notice,setNotice] = useState('');
  const enabled = vipEquipmentPresetsEnabled();
  const refresh = useCallback(async () => {
    const data=await fetchVipEquipmentPresets(userId);
    setStatus(data);
    setPending(hasPendingVipEquipmentPreset(userId));
  },[userId]);
  useEffect(() => {
    if(!enabled) return;
    let active=true;
    setPending(hasPendingVipEquipmentPreset(userId));
    void fetchVipEquipmentPresets(userId).then(data=>{if(active)setStatus(data);})
      .catch(()=>{if(active)setNotice(en
        ? 'Equipment preset status is temporarily unavailable.'
        : 'Пока не удалось проверить комплекты на сервере.');});
    return ()=>{active=false;};
  },[enabled,userId,en]);

  if(!enabled) return null;

  const act = async (slot:PresetNo, action:'save'|'equip') => {
    if(busy) return;
    setBusy(true);setNotice('');
    try {
      if(action==='save') await saveVipEquipmentPreset(userId,slot);
      else {
        const recovered=await applyVipEquipmentPreset(userId,slot);
        if(recovered) onApplied?.();
      }
      await refresh();
      setNotice(action==='save'
        ? (en?'Equipment preset saved on server.':'Комплект сохранён на сервере.')
        : (en?'Equipment switched and safely saved.':'Снаряжение переключено и сохранено.'));
    } catch(error) {
      const code=error instanceof Error?error.message:'';
      setPending(hasPendingVipEquipmentPreset(userId));
      setNotice(/combat_active/.test(code)
        ? (en?'Finish the active battle before switching equipment.':'Сначала заверши текущий бой.')
        : /gear_missing|invalid_gear/.test(code)
        ? (en?'One or more saved items are no longer owned.':'Одна или несколько вещей больше не принадлежат герою.')
        : (en?'Server confirmation is pending. Recover the same operation; do not equip manually.'
          :'Серверное подтверждение не получено. Восстанови эту операцию, не меняй вещи вручную.'));
    } finally { setBusy(false); }
  };
  const pendingSlot=pendingVipEquipmentPresetSlot(userId);

  return (
    <section className="mx-1 my-2 rounded-xl border border-amber-500/50 bg-gradient-to-r from-[#4e2e20] to-[#211712] p-2 shadow-inner" data-testid="vip-equipment-presets">
      <div className="mb-1.5 flex items-center gap-1.5 text-amber-100">
        <ShieldCheck size={17} className="text-[#f6cc73]" aria-hidden="true"/>
        <strong className="text-xs">{en?'VIP equipment sets':'VIP-комплекты снаряжения'}</strong>
        <span className="ml-auto text-[10px] font-bold text-amber-300">{status?'VIP '+status.vip:''}</span>
      </div>
      {pending && <button type="button" className="mb-1.5 flex min-h-10 w-full items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-600/35 px-2 text-xs font-bold text-amber-100 disabled:opacity-50"
        onClick={()=>{if(pendingSlot)void act(pendingSlot,'equip');}}
        disabled={busy||pendingSlot===null}>
        <RotateCcw size={15}/>{en?'Recover unfinished gear switch':'Восстановить переключение вещей'}
      </button>}
      <div className="grid grid-cols-1 gap-1.5 min-[360px]:grid-cols-2">
        {([1,2] as const).map(slot=>{
          const unlocked=(status?.vip??0)>=(slot===1?4:6);
          const saved=status?.presets.some(x=>x.slot===slot)??false;
          return (
            <div key={slot} className="rounded-lg border border-amber-400/25 bg-black/25 p-1.5">
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="font-semibold text-amber-100">{en?'Set':'Комплект'} {slot}</span>
                <span className="text-amber-300/80">{unlocked
                  ? (saved?(en?'Saved':'Сохранён'):(en?'Empty':'Пусто'))
                  : 'VIP '+(slot===1?4:6)}</span>
              </div>
              <div className="flex gap-1">
                <button type="button" disabled={!unlocked||busy||pending} onClick={()=>void act(slot,'save')}
                  className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-md border border-amber-300/40 bg-amber-700/45 px-1 text-[11px] font-bold text-amber-50 disabled:opacity-40">
                  <Save size={13}/>{en?'Save':'Запомнить'}
                </button>
                <button type="button" disabled={!unlocked||!saved||busy||pending} onClick={()=>void act(slot,'equip')}
                  className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-md border border-amber-300/70 bg-gradient-to-b from-[#f0cb77] to-[#a97532] px-1 text-[11px] font-black text-[#2b180d] disabled:opacity-40">
                  {busy?<Loader2 size={13} className="animate-spin"/>:<Check size={13}/>}
                  {en?'Equip':'Надеть'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {notice && <p role="status" className="mt-1.5 text-[11px] leading-snug text-amber-100" aria-live="polite">{notice}</p>}
    </section>
  );
}
