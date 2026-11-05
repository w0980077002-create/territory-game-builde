import { useCallback, useEffect, useRef, useState } from 'react';
import { Crown, RefreshCw } from 'lucide-react';
import { adminCall } from '@/admin/api';
import { ErrorLine, Panel, inputCls, type Confirm } from '@/admin/ui';

type VipGrant = { id:string; campaign:string; kind:'gift'|'temporary'; level:number; expiresAt:string|null; reason:string; createdAt:string; revoked:boolean; revokedReason:string|null };
type VipStatus = { playerId:string; entitlement:{vip:number;permanent_vip:number;paid_vip:number;gift_vip:number;temporary_vip:number;paid_spend_cents:number|string};grants:VipGrant[];confirmedPaymentCount:number };
type AdminOperation = {action:'vip_grant'|'vip_revoke';playerId:string;requestId:string;campaignKey?:string;grantId?:string;kind?:string;level?:number;expiresAt?:string|null;reason:string};

/** Controls are hidden until owner-reviewed service RPC and admin Edge are
 * deployed together. Four pre-existing tester VIP5 grants are never reissued. */
const ENABLED=import.meta.env?.VITE_VIP_ADMIN_ENABLED==='true';

export function PlayerVip({playerId,playerName,confirm}:{playerId:string;playerName:string;confirm:Confirm}) {
  const [status,setStatus]=useState<VipStatus|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [kind,setKind]=useState<'gift'|'temporary'>('gift');
  const [level,setLevel]=useState('5');
  const [reason,setReason]=useState('Благодарность за помощь развитию игры');
  const [campaign,setCampaign]=useState('');
  const [expires,setExpires]=useState('');
  const request=useRef<AdminOperation|null>(null);
  const refresh=useCallback(async()=>{
    if(!ENABLED)return;
    setBusy(true);setError(null);
    try{
      const result=await adminCall<VipStatus>('vip_player',{playerId});
      if(result.playerId!==playerId||!Array.isArray(result.grants))
        throw Error('Неверный ответ VIP-сервера');
      setStatus(result);
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  },[playerId]);
  useEffect(()=>{void refresh();},[refresh]);
  if(!ENABLED)return null;
  const start=()=>{
    const tier=Number(level);
    const key=campaign.trim();
    const msg=reason.trim();
    const expiry=kind==='temporary'&&Number.isFinite(Date.parse(expires))?new Date(expires).toISOString():null;
    if(!Number.isInteger(tier)||tier<1||tier>10||!/^[a-zA-Z0-9:_.-]{3,120}$/.test(key)
      ||msg.length<4||msg.length>500||(kind==='temporary'&&!Number.isFinite(Date.parse(expires)))) {
      setError('Укажи уровень 1–10, уникальный ключ, причину и срок временного VIP.');return;
    }
    const same=request.current?.action==='vip_grant'&&request.current.kind===kind
      &&request.current.level===tier&&request.current.campaignKey===key
      &&request.current.reason===msg&&request.current.expiresAt===expiry;
    if(request.current&&!same){
      setError('Есть неподтверждённая операция. Сначала повтори её без изменения полей.');return;
    }
    const op=request.current??{action:'vip_grant' as const,playerId,requestId:crypto.randomUUID(),campaignKey:key,kind,level:tier,expiresAt:expiry,reason:msg};
    request.current=op;
    confirm('Подтвердить '+(kind==='gift'?'постоянный':'временный')+' VIP'+tier+' игроку '+playerName+'? Это не покупка и не начисляет донат.',async()=>{
      const receipt=await adminCall<{success:boolean;operationId:string}>('vip_grant',op);
      if(!receipt.success||receipt.operationId!==op.requestId)throw Error('VIP операция не подтверждена');
      request.current=null;await refresh();
      return 'VIP '+tier+' подтверждён сервером, операция записана в журнал';
    });
  };
  const revoke=(g:VipGrant)=>{
    const note='Отзыв промо: '+g.campaign;
    const matching=request.current?.action==='vip_revoke'&&request.current.grantId===g.id;
    if(request.current&&!matching){setError('Сначала заверши неподтверждённую операцию.');return;}
    const op=request.current??{action:'vip_revoke' as const,playerId,requestId:crypto.randomUUID(),grantId:g.id,reason:note};
    request.current=op;
    confirm('Отозвать только подарок '+g.campaign+'? Оплаченный и legacy VIP останутся нетронутыми.',async()=>{
      const receipt=await adminCall<{success:boolean;operationId:string}>('vip_revoke',op);
      if(!receipt.success||receipt.operationId!==op.requestId)throw Error('Отзыв VIP не подтверждён');
      request.current=null;await refresh();
      return 'Подарочный VIP отозван, история сохранена';
    });
  };
  const ent=status?.entitlement;
  return <Panel title="VIP · подарки и покупки" icon={<Crown className="w-4 h-4 text-amber-300"/>}
    right={<button type="button" aria-label="Обновить VIP" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={17}/></button>}>
    <ErrorLine text={error}/>
    {ent&&<div className="mb-3 grid grid-cols-2 gap-1.5 text-xs">
      <span>Действующий: <b className="text-amber-300">VIP {ent.vip}</b></span>
      <span>Постоянный: VIP {ent.permanent_vip}</span>
      <span>Оплаченный: VIP {ent.paid_vip}</span><span>Подарочный: VIP {ent.gift_vip}</span>
      <span>Временный: VIP {ent.temporary_vip}</span>
      <span>Подтверждено: {Number(ent.paid_spend_cents||0)/100} USD</span>
      <span className="col-span-2 text-slate-400">Подтверждённых покупок: {status?.confirmedPaymentCount??0}. Подарки не считаются оплатой.</span>
    </div>}
    <div className="space-y-2">
      <label className="block text-xs text-slate-300">Уровень VIP
        <input className={inputCls} type="number" min={1} max={10} value={level} onChange={e=>setLevel(e.target.value)}/>
      </label>
      <label className="block text-xs text-slate-300">Тип
        <select className={inputCls} value={kind} onChange={e=>setKind(e.target.value as 'gift'|'temporary')}>
          <option value="gift">Постоянный подарок</option><option value="temporary">Временный подарок</option>
        </select>
      </label>
      {kind==='temporary'&&<label className="block text-xs text-slate-300">Действует до
        <input className={inputCls} type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)}/>
      </label>}
      <label className="block text-xs text-slate-300">Уникальный ключ подарка
        <input className={inputCls} value={campaign} maxLength={120}
          placeholder="tester-2026-nickname" onChange={e=>setCampaign(e.target.value)}/>
      </label>
      <label className="block text-xs text-slate-300">Причина
        <input className={inputCls} value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/>
      </label>
      <button type="button" disabled={busy||!status} onClick={start}
        className="min-h-11 w-full rounded-lg border border-amber-500/40 bg-amber-800/60 px-3 text-xs font-bold disabled:opacity-40">Подтвердить подарок VIP</button>
    </div>
    {!!status?.grants.length&&<div className="mt-3 space-y-1">
      <strong className="text-xs text-slate-300">Подарки и история</strong>
      {status.grants.map(g=><div key={g.id} className="flex items-center gap-2 rounded-lg border border-slate-700 px-2 py-1.5 text-xs">
        <span className="min-w-0 flex-1 break-words">
          <b className="text-amber-200">VIP {g.level}</b> · {g.campaign}
          <small className="block text-slate-400">{g.kind==='temporary'?'до '+g.expiresAt:'Постоянный'} · {g.revoked?'Отозван':'Активный'}</small>
        </span>
        {!g.revoked&&<button type="button" className="min-h-9 rounded-md border border-red-500/40 px-2 text-red-300"
          onClick={()=>revoke(g)}>Отозвать</button>}
      </div>)}
    </div>}
  </Panel>;
}
