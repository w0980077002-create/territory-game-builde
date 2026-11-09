import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Bot, RefreshCw, ShieldCheck, Swords, Trophy, Users } from 'lucide-react';
import { adminCall } from '@/admin/api';
import { ErrorLine, Loading, Panel, Switch, inputCls, type Confirm } from '@/admin/ui';

interface Tester {
  slot: number; playerId: string; name: string; appearance: 'm1'|'m2'|'f1'|'f2';
  level: number; attack: number; defense: number; hp: number; crit: number; vip: number;
  gold: number; gems: number; energy: number; forgeMaterials: number; arenaRating: number;
  arenaWins: number; arenaLosses: number; totalBattlesWon: number; bossesDefeated: number;
  chapter: number; chapterWins: number; arenaStarts: number;
  autoArena: boolean; autoCampaign: boolean; autoTrials: boolean; autoCave: boolean;
  arenaMode: 'duel'|'team'|'chaos'; intervalMinutes: number;
  lastArenaAt: string | null;
  lastEvent: { activity: string; result: string; at: string } | null;
}
type Editable = Pick<Tester,'name'|'appearance'|'level'|'attack'|'defense'|'hp'|'crit'|'vip'|
  'gold'|'gems'|'energy'|'forgeMaterials'|'arenaRating'|'autoArena'|'autoCampaign'|'autoTrials'|
  'autoCave'|'arenaMode'|'intervalMinutes'>;

const NUMBERS: Array<{key:keyof Editable;label:string;min:number;max:number}> = [
  {key:'level',label:'Уровень',min:1,max:100},
  {key:'attack',label:'Атака',min:1,max:2000000},
  {key:'defense',label:'Защита',min:0,max:2000000},
  {key:'hp',label:'Здоровье',min:1,max:2000000},
  {key:'crit',label:'Крит, %',min:0,max:75},
  {key:'vip',label:'VIP',min:0,max:10},
  {key:'arenaRating',label:'Рейтинг Арены',min:100,max:100000},
  {key:'gold',label:'Золото',min:0,max:2147483647},
  {key:'gems',label:'Синие алмазы',min:0,max:2147483647},
  {key:'energy',label:'Энергия',min:0,max:10000},
  {key:'forgeMaterials',label:'Материалы кузницы',min:0,max:2147483647},
];
const editable = (b:Tester):Editable => ({
  name:b.name,appearance:b.appearance,level:b.level,attack:b.attack,defense:b.defense,
  hp:b.hp,crit:b.crit,vip:b.vip,gold:b.gold,gems:b.gems,energy:b.energy,
  forgeMaterials:b.forgeMaterials,arenaRating:b.arenaRating,autoArena:b.autoArena,
  autoCampaign:b.autoCampaign,autoTrials:b.autoTrials,autoCave:b.autoCave,
  arenaMode:b.arenaMode,intervalMinutes:b.intervalMinutes,
});
const format=(v:number)=>new Intl.NumberFormat('ru-RU').format(v);

export function BotsTab({confirm}:{confirm:Confirm}) {
  const [bots,setBots]=useState<Tester[]|null>(null);
  const [selected,setSelected]=useState<number|null>(null);
  const [draft,setDraft]=useState<Editable|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [dirty,setDirty]=useState<Array<keyof Editable>>([]);
  const [notice,setNotice]=useState<string|null>(null);

  const load=useCallback(async()=>{
    setError(null);
    try {
      let r=await adminCall<{bots:Tester[]}>('bots_list');
      if(r.bots.length<10){
        // The owner has already authorized ten testers: bootstrap on first visit,
        // without requiring any technical steps or altering existing accounts.
        try {
          await adminCall('bots_seed');
          r=await adminCall<{bots:Tester[]}>('bots_list');
        } catch(e) {
          setError('Автоматическое создание тестеров не завершено: '+(e as Error).message);
          r=await adminCall<{bots:Tester[]}>('bots_list');
        }
      }
      setBots(r.bots);
      return r.bots;
    } catch(e){setError((e as Error).message);return null;}
  },[]);

  useEffect(()=>{void load();},[load]);

  const open=(b:Tester)=>{
    setSelected(b.slot);setDraft(editable(b));setDirty([]);setError(null);setNotice(null);
  };
  const changeDraft=<K extends keyof Editable>(key:K,value:Editable[K])=>{
    setDraft(d=>d?{...d,[key]:value}:d);
    setDirty(keys=>keys.includes(key)?keys:[...keys,key]);
    setNotice(null);
  };
  // Each auto setting is saved to the server immediately and independently.
  // It must never resend stale currency, rating or other character fields.
  const saveSetting=async <K extends keyof Editable>(key:K,value:Editable[K])=>{
    if(selected===null||busy)return;
    const slot=selected;
    const previous=bots?.find(b=>b.slot===slot);
    if(!previous)return;
    if(key==='intervalMinutes'&&(!Number.isSafeInteger(Number(value))||
      Number(value)<2||Number(value)>1440)){
      setError('Интервал должен быть от 2 до 1440 минут.');return;
    }
    setBusy(true);setError(null);setNotice(null);
    try {
      await adminCall('bots_update',{slot,patch:{[key]:value}});
      const result=await adminCall<{bots:Tester[]}>('bots_list');
      const confirmed=result.bots.find(b=>b.slot===slot);
      if(!confirmed||confirmed[key]!==value){
        throw new Error('Сервер не подтвердил сохранение настройки.');
      }
      setBots(result.bots);
      setDraft(prev=>prev?{...prev,[key]:value}:prev);
      setDirty(keys=>keys.filter(k=>k!==key));
      setNotice('Настройка сохранена на сервере.');
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  };
  const init=()=>confirm('Создать 10 игровых тестеров 61 уровня? Существующих игроков не изменяем.',async()=>{
    setBusy(true);
    try{
      const result=await adminCall<{created:number;total:number}>('bots_seed');
      setSelected(null);setDraft(null);setDirty([]);await load();
      return `Тестеры: ${result.total} профилей, новых ${result.created}. Все режимы автозапуска выключены.`;
    }finally{setBusy(false);}
  });
  const save=()=>{
    if(!draft||selected===null||busy)return;
    const keys=[...dirty];
    if(!keys.length){setNotice('Все изменения уже сохранены.');return;}
    const bad=NUMBERS.find(({key,min,max})=>{
      if(!keys.includes(key))return false;
      const n=Number(draft[key]);
      return !Number.isSafeInteger(n)||n<min||n>max;
    });
    if(bad){setError('Проверь поле «'+bad.label+'».');return;}
    if(keys.includes('name')&&(draft.name.trim().length<2||draft.name.trim().length>28)){
      setError('Имя: от 2 до 28 символов.');return;
    }
    const slot=selected;
    const patch=Object.fromEntries(keys.map(k=>[k,draft[k]]));
    confirm('Сохранить изменённые параметры тестера №'+slot+'?',async()=>{
      setBusy(true);
      try{
        await adminCall('bots_update',{slot,patch});
        const result=await adminCall<{bots:Tester[]}>('bots_list');
        const saved=result.bots.find(b=>b.slot===slot);
        if(!saved)throw new Error('Профиль тестера недоступен после сохранения.');
        for(const key of keys){
          if(saved[key]!==draft[key]&&key!=='arenaRating'){
            throw new Error('Сервер не подтвердил изменение «'+key+'».');
          }
        }
        setBots(result.bots);setDirty([]);setDraft(null);setSelected(null);setError(null);
        setNotice('Изменённые поля сохранены. Остальные параметры не перезаписывались.');
        return 'Параметры сохранены. Общая статистика и настройки других режимов не перезаписывались.';
      }finally{setBusy(false);}
    });
  };
  if(bots===null)return error?<ErrorLine text={error}/>:<Loading/>;
  const current=bots.find(b=>b.slot===selected);
  return <div className="space-y-4" data-testid="owner-test-bots">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2"><Bot className="w-5 h-5 text-sky-300"/> Тестеры TERRITORY</h2>
        <p className="text-xs text-slate-400 mt-1">10 управляемых игровых профилей · общая статистика и Арена</p>
      </div>
      <button type="button" disabled={busy} onClick={async()=>{
        if(dirty.length){setError('Сначала сохрани изменённые поля персонажа.');return;}
        const fresh=await load();
        if(fresh&&selected!==null){
          const bot=fresh.find(b=>b.slot===selected);
          if(bot)setDraft(editable(bot));
        }
      }} className="h-10 px-3 rounded-xl border border-slate-700 text-slate-300 disabled:opacity-50" aria-label="Обновить"><RefreshCw className="w-4 h-4"/></button>
    </div>
    <ErrorLine text={error}/>
    {notice&&<p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200" role="status">{notice}</p>}
    {bots.length<10&&<Panel title="Создание тестеров" icon={<Users className="w-4 h-4"/>}>
      <p className="text-xs text-slate-300 mb-3">Каждый тестер получит собственный игровой аккаунт 61 уровня в общей базе игроков. Неизменённые реальные аккаунты останутся на месте. Все автопереходы изначально выключены.</p>
      <button disabled={busy} onClick={init} className="w-full h-11 rounded-xl bg-sky-700 text-white font-semibold disabled:opacity-50">Создать недостающих тестеров ({10-bots.length})</button>
    </Panel>}
    {selected===null?<div className="space-y-2">
      {bots.map(b=><button key={b.slot} type="button" onClick={()=>open(b)} className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 flex items-center gap-3 text-left hover:border-sky-500/60">
        <span className="w-10 h-10 rounded-full bg-gradient-to-b from-amber-800 to-slate-800 flex items-center justify-center text-amber-200 font-bold">{b.slot}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-white truncate">{b.name}</span>
          <span className="text-[11px] text-slate-400">Ур. {b.level} · {format(b.arenaWins)} побед / {format(b.arenaLosses)} поражений</span>
        </span>
        <span className={`text-[11px] font-semibold ${b.autoArena?'text-emerald-300':'text-slate-500'}`}>{b.autoArena?'Арена: авто':'Отключён'}</span>
      </button>)}
      {bots.length===0&&<p className="text-sm text-slate-400">Тестеры ещё не созданы.</p>}
    </div>:current&&draft?<div className="space-y-4">
      <button disabled={busy} onClick={()=>{
        if(dirty.length){setError('Есть несохранённые изменения персонажа. Нажми «Сохранить изменённые параметры».');return;}
        setSelected(null);setDraft(null);setNotice(null);
      }} className="flex items-center gap-1 text-sm text-sky-300 disabled:opacity-50"><ArrowLeft className="w-4 h-4"/> Все 10 тестеров</button>
      <Panel title={'Профиль №'+current.slot} icon={<ShieldCheck className="w-4 h-4"/>}>
        <div className="grid grid-cols-2 gap-2 text-center">
          {[['Побед на Арене',current.arenaWins],['Поражений на Арене',current.arenaLosses],
            ['Побед PvE',current.totalBattlesWon],['Боссов побеждено',current.bossesDefeated],
            ['Глава Похода',current.chapter],['Бои в Походе',current.chapterWins]
          ].map(([label,value])=><div key={String(label)} className="p-2 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="text-lg font-bold text-white">{format(Number(value))}</div>
            <div className="text-[11px] text-slate-400">{label}</div>
          </div>)}
        </div>
        <p className="text-xs text-slate-400 mt-3">ID: <code className="break-all">{current.playerId}</code></p>
        <p className="text-xs text-slate-400 mt-1">Профиль учитывается в общей статистике и рейтинге игроков. Это не отдельный декоративный NPC.</p>
      </Panel>
      <Panel title="Персонаж и ресурсы" icon={<Users className="w-4 h-4"/>}>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-xs text-slate-300">Имя
            <input className={inputCls+' mt-1'} value={draft.name} maxLength={28} onChange={e=>changeDraft('name',e.target.value)}/>
          </label>
          <label className="col-span-2 text-xs text-slate-300">Внешность
            <select className={inputCls+' mt-1'} value={draft.appearance} disabled={busy} onChange={e=>{void saveSetting('appearance',e.target.value as Tester['appearance']);}}>
              <option value="m1">Воин I</option><option value="m2">Воин II</option><option value="f1">Воительница I</option><option value="f2">Воительница II</option>
            </select>
          </label>
          {NUMBERS.map(({key,label,min,max})=><label key={key} className="text-xs text-slate-300">{label}
            <input type="number" min={min} max={max} step="1" inputMode="numeric" className={inputCls+' mt-1'}
              value={String(draft[key])} onChange={e=>changeDraft(key,Number(e.target.value))}/>
          </label>)}
        </div>
      </Panel>
      <Panel title="Автоповедение" icon={<Swords className="w-4 h-4"/>}>
        <p className="text-xs text-emerald-200 mb-3">Переключатели и режим сохраняются сразу на сервере. Интервал сохраняется после ввода.</p>
        <div className="space-y-3">
          <Switch label="Арена — автоматически" hint="Тестер участвует в серверных боях с настоящим результатом. Начинается только после включения."
            on={draft.autoArena} tone="emerald" onToggle={()=>{void saveSetting('autoArena',!draft.autoArena);}}/>
          <label className="block text-xs text-slate-300">Интервал между запусками, минуты
            <input type="number" min={2} max={1440} className={inputCls+' mt-1'} value={draft.intervalMinutes} disabled={busy}
              onChange={e=>changeDraft('intervalMinutes',Number(e.target.value))}
              onBlur={()=>{if(dirty.includes('intervalMinutes'))void saveSetting('intervalMinutes',draft.intervalMinutes);}}/>
          </label>
          <label className="block text-xs text-slate-300">Режим Арены
            <select className={inputCls+' mt-1'} value={draft.arenaMode} disabled={busy} onChange={e=>{void saveSetting('arenaMode',e.target.value as Tester['arenaMode']);}}>
              <option value="duel">Дуэль</option><option value="team">Отряд</option><option value="chaos">Хаос</option>
            </select>
          </label>
          <div className="border-t border-slate-700 pt-3 space-y-2">
            <p className="text-xs text-amber-200">Для Похода, Испытаний и Тёмной пещеры здесь сохраняются параметры, но серверный автоматический бой пока не подключён. Победы за несыгранные бои не начисляются.</p>
            <Switch label="Поход — подготовить автоматизацию" hint="Параметр сохраняется, реальный запуск PvE пока не подключён." on={draft.autoCampaign} tone="emerald" onToggle={()=>{void saveSetting('autoCampaign',!draft.autoCampaign);}}/>
            <Switch label="Испытания — подготовить автоматизацию" hint="Параметр сохраняется, реальные испытания пока не запускаются." on={draft.autoTrials} tone="emerald" onToggle={()=>{void saveSetting('autoTrials',!draft.autoTrials);}}/>
            <Switch label="Тёмная пещера — подготовить автоматизацию" hint="Параметр сохраняется, реальные этажи пока не проходятся." on={draft.autoCave} tone="emerald" onToggle={()=>{void saveSetting('autoCave',!draft.autoCave);}}/>
          </div>
        </div>
      </Panel>
      {dirty.length>0&&<p className="text-xs text-amber-200" role="status">
        Несохранённые поля персонажа: {dirty.length}. Кнопка ниже сохранит только их, не затронув рейтинг и другие настройки.
      </p>}
      <button disabled={busy||dirty.length===0} onClick={save} className="w-full h-12 bg-emerald-700 hover:bg-emerald-600 rounded-xl font-bold text-white disabled:opacity-50">
        {busy?'Сохранение…':'Сохранить изменённые параметры'}
      </button>
      <p className="text-xs text-slate-400 flex items-center gap-1"><Trophy className="w-3 h-3"/> Результаты Арены фиксируются вместе с результатами обычных игроков.</p>
    </div>:null}
  </div>;
}
