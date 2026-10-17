import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Clock3,KeyRound,RefreshCw,ShieldAlert} from 'lucide-react';
import {adminCall} from '@/admin/api';
import {Panel,Loading,Empty,ErrorLine,fmtDate,inputCls,type Confirm} from '@/admin/ui';
interface Audit {
 id:number;action:string;details:Record<string,unknown>;created_at:string;
}
const NAMES:Record<string,string>={
 login:'Вход администратора',ban:'Бан игрока',unban:'Разбан',
 adjust:'Ресурсы игроку',mail:'Рассылка',set_setting:'Настройки игры',
 reset_bots:'Сброс ботов',hall_grant:'Билеты игрового зала',
 cancel_pending:'Отмена выдачи',link_telegram:'Привязка Telegram',
 password_changed:'Смена пароля',
 warn:'Ручное предупреждение игроку',mail_scheduled:'Запланирована рассылка',
 mail_schedule_cancelled:'Отмена запланированной рассылки',
 mail_scheduled_sent:'Автоматическая отправка письма',
};
const describe=(v:Audit)=>{
 const d=v.details??{};
 if(v.action==='hall_grant')return [
  typeof d.amount==='number'?(d.amount>0?'+':'')+d.amount+' 🎟️':'',
  typeof d.scope==='string'?d.scope:'',
  typeof d.affected==='number'?'Игроков: '+d.affected:'',
  typeof d.reason==='string'?d.reason:''
 ].filter(Boolean).join(' · ');
 if(v.action==='adjust'||v.action==='cancel_pending')return typeof d.playerId==='string'?'Игрок: '+d.playerId.slice(0,8)+'…':'';
 if(v.action==='set_setting')return typeof d.key==='string'?d.key+' → '+String(d.value):'';
 if(v.action==='mail')return typeof d.recipients==='number'?'Получателей: '+d.recipients:'';
 if(v.action==='password_changed')return 'Все прежние сессии завершены';
 return typeof d.playerId==='string'?'Игрок: '+d.playerId.slice(0,8)+'…':'';
};
export function AuditAdminTab({confirm,onLogout}:{confirm:Confirm;onLogout:()=>void}){
 const [rows,setRows]=useState<Audit[]|null>(null),[error,setError]=useState<string|null>(null);
 const [old,setOld]=useState(''),[next,setNext]=useState(''),[again,setAgain]=useState('');
 const [message,setMessage]=useState('');
 const refresh=useCallback(async()=>{
  try{
   const r=await adminCall<{rows:Audit[]}>('audit_recent');
   setRows(r.rows);setError(null);
  }catch(e){setError((e as Error).message);}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 const submit=(e:FormEvent)=>{
  e.preventDefault();setError(null);setMessage('');
  if(next.length<14||!/[A-Za-zА-Яа-я]/u.test(next)||!/[0-9]/.test(next))
   return setError('Новый пароль: минимум 14 символов, буквы и цифры.');
  if(next!==again)return setError('Повтор пароля не совпадает.');
  if(!old)return setError('Введи нынешний пароль.');
  confirm('Сменить пароль админки? Сразу после смены придётся войти с новым паролем на всех устройствах.',
    async()=>{
      await adminCall('change_password',{oldPassword:old,newPassword:next});
      setOld('');setNext('');setAgain('');setMessage('Пароль изменён. Войди заново.');
      onLogout();
      return 'Пароль изменён. Прежние сессии недействительны.';
    });
 };
 return <div className="space-y-4">
  <Panel title="Безопасность администратора" icon={<ShieldAlert size={17}/>}>
   <p className="text-xs text-amber-300 rounded-xl p-3 border border-amber-500/30 bg-amber-950/20">
    Старый пароль админки ранее находился в исходном коде. Обязательно замени его здесь на новый, уникальный. Пароль теперь хранится только в виде защищённого хеша на сервере.
   </p>
   <form onSubmit={submit} className="space-y-3 mt-3">
    <label className="block text-xs text-slate-400">Текущий пароль
     <input className={inputCls+' mt-1'} type="password" autoComplete="current-password" value={old}
      onChange={e=>setOld(e.target.value)}/>
    </label>
    <label className="block text-xs text-slate-400">Новый пароль (от 14 символов)
     <input className={inputCls+' mt-1'} type="password" autoComplete="new-password" value={next}
      onChange={e=>setNext(e.target.value)} maxLength={128}/>
    </label>
    <label className="block text-xs text-slate-400">Повтори новый пароль
     <input className={inputCls+' mt-1'} type="password" autoComplete="new-password" value={again}
      onChange={e=>setAgain(e.target.value)} maxLength={128}/>
    </label>
    <button type="submit" className="rounded-xl w-full bg-sky-600 hover:bg-sky-500 h-12 font-bold text-white flex items-center justify-center gap-2">
     <KeyRound size={18}/> Сменить пароль и завершить старые сессии
    </button>
    {message&&<p role="status" className="text-emerald-300 text-xs">{message}</p>}
   </form>
  </Panel>
  <Panel title="Журнал последних действий" icon={<Clock3 size={17}/>} right={
    <button type="button" onClick={()=>void refresh()} aria-label="Обновить журнал"><RefreshCw size={16}/></button>
  }>
   <p className="text-[11px] text-slate-400 mb-3">Последние 100 действий: выдачи, рассылки, блокировки и изменения настроек.</p>
   {rows===null?!error&&<Loading/>:rows.length===0?<Empty text="Действий пока нет."/>:
    <div className="space-y-2">{rows.map(row=><div key={row.id}
      className="rounded-xl bg-slate-950/65 border border-slate-800 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
       <strong className="text-xs text-slate-100">{NAMES[row.action]??row.action}</strong>
       <span className="text-[10px] text-slate-400 whitespace-nowrap">{fmtDate(row.created_at)}</span>
      </div>
      {describe(row)&&<p className="text-xs text-slate-400 mt-1 break-words">{describe(row)}</p>}
    </div>)}</div>}
  </Panel>
  <ErrorLine text={error}/>
 </div>;
}
