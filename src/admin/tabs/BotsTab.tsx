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

  const load=useCallback(async()=>{
    setError(null);
    try {
      const r=await adminCall<{bots:Tester[]}>('bots_list');
      setBots(r.bots);
      if(selected!==null && !draft){
        const b=r.bots.find(item=>item.slot===selected);
        if(b)setDraft(editable(b));
      }
    } catch(e){setError((e as Error).message);}
  },[selected,draft]);

  useEffect(()=>{void load();},[]); // Refresh is explicit; do not overwrite edits mid-form.

  const open=(b:Tester)=>{setSelected(b.slot);setDraft(editable(b));setError(null);};
  const init=()=>confirm('Создать 10 игровых тестеров 61 уровня? Существующих игроков не изменяем.',async()=>{
    setBusy(true);
    try{
      const result=await adminCall<{created:number;total:number}>('bots_seed');
      setSelected(null);setDraft(null);await load();
      return `Тестеры: ${result.total} профилей, новых ${result.created}. Все режимы автозапуска выключены.`;
    }finally{setBusy(false);}
  });
  const save=()=>{
    if(!draft||selected===null)return;
    const bad=NUMBERS.find(({key,min,max})=>{
      const n=Number(draft[key]);
      return !Number.isSafeInteger(n)||n<min||n>max;
    });
    if(bad){setError('Проверь поле «'+bad.label+'».');return;}
    if(draft.name.trim().length<2||draft.name.trim().length>28){
      setError('Имя: от 2 до 28 символов.');return;
    }
    confirm('Сохранить профиль тестера №'+selected+' и настройки активности?',async()=>{
      setBusy(true);
      try{
        await adminCall('bots_update',{slot:selected,patch:draft});
        setDraft(null);setSelected(null);await load();
        return 'Параметры сохранены в общей базе игроков.';
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
      <button type="button" onClick={()=>void load()} className="h-10 px-3 rounded-xl border border-slate-700 text-slate-300" aria-label="Обновить"><RefreshCw className="w-4 h-4"/></button>
    </div>
    <ErrorLine text={error}/>
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
      <button onClick={()=>{setSelected(null);setDraft(null);}} className="flex items-center gap-1 text-sm text-sky-300"><ArrowLeft className="w-4 h-4"/> Все 10 тестеров</button>
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
            <input className={inputCls+' mt-1'} value={draft.name} maxLength={28} onChange={e=>setDraft({...draft,name:e.target.value})}/>
          </label>
          <label className="col-span-2 text-xs text-slate-300">Внешность
            <select className={inputCls+' mt-1'} value={draft.appearance} onChange={e=>setDraft({...draft,appearance:e.target.value as Tester['appearance']})}>
              <option value="m1">Воин I</option><option value="m2">Воин II</option><option value="f1">Воительница I</option><option value="f2">Воительница II</option>
            </select>
          </label>
          {NUMBERS.map(({key,label,min,max})=><label key={key} className="text-xs text-slate-300">{label}
            <input type="number" min={min} max={max} step="1" inputMode="numeric" className={inputCls+' mt-1'}
              value={String(draft[key])} onChange={e=>setDraft({...draft,[key]:Number(e.target.value)})}/>
          </label>)}
        </div>
      </Panel>
      <Panel title="Автоповедение" icon={<Swords className="w-4 h-4"/>}>
        <div className="space-y-3">
          <Switch label="Арена — автоматически" hint="Тестер участвует в серверных боях с настоящим результатом. Начинается только после включения."
            on={draft.autoArena} tone="emerald" onToggle={()=>setDraft({...draft,autoArena:!draft.autoArena})}/>
          <label className="block text-xs text-slate-300">Интервал между запусками, минуты
            <input type="number" min={2} max={1440} className={inputCls+' mt-1'} value={draft.intervalMinutes}
              onChange={e=>setDraft({...draft,intervalMinutes:Number(e.target.value)})}/>
          </label>
          <label className="block text-xs text-slate-300">Режим Арены
            <select className={inputCls+' mt-1'} value={draft.arenaMode} onChange={e=>setDraft({...draft,arenaMode:e.target.value as Tester['arenaMode']})}>
              <option value="duel">Дуэль</option><option value="team">Отряд</option><option value="chaos">Хаос</option>
            </select>
          </label>
          <div className="border-t border-slate-700 pt-3 space-y-2">
            <p className="text-xs text-amber-200">Для Похода, Испытаний и Тёмной пещеры здесь сохраняются параметры, но серверный автоматический бой пока не подключён. Победы за несыгранные бои не начисляются.</p>
            <Switch label="Поход — подготовить автоматизацию" on={draft.autoCampaign} tone="emerald" onToggle={()=>setDraft({...draft,autoCampaign:!draft.autoCampaign})}/>
            <Switch label="Испытания — подготовить автоматизацию" on={draft.autoTrials} tone="emerald" onToggle={()=>setDraft({...draft,autoTrials:!draft.autoTrials})}/>
            <Switch label="Тёмная пещера — подготовить автоматизацию" on={draft.autoCave} tone="emerald" onToggle={()=>setDraft({...draft,autoCave:!draft.autoCave})}/>
          </div>
        </div>
      </Panel>
      <button disabled={busy} onClick={save} className="w-full h-12 bg-emerald-700 hover:bg-emerald-600 rounded-xl font-bold text-white disabled:opacity-50">Сохранить все параметры тестера</button>
      <p className="text-xs text-slate-400 flex items-center gap-1"><Trophy className="w-3 h-3"/> Результаты Арены фиксируются вместе с результатами обычных игроков.</p>
    </div>:null}
  </div>;
}
