import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Bot, RefreshCw, ShieldCheck, Swords, Trophy, Users, Hammer } from 'lucide-react';
import { adminCall } from '@/admin/api';
import { ErrorLine, Loading, Panel, Switch, inputCls, type Confirm } from '@/admin/ui';

type GearSlot = 'weapon'|'armor'|'helmet'|'boots'|'shield'|'ring'|'amulet';
interface TesterGear {
  id:string; slot:GearSlot; name:string; icon:string; rarity:string; level:number;
  attack?:number; defense?:number; hp?:number; critChance?:number;
}
const GEAR_SLOTS: Array<{slot:GearSlot; label:string; choices: Array<{id:string;name:string}>}> = [
  {slot:'weapon',label:'Оружие',choices:[{id:'shop_weapon_knight_eq',name:'Клинок рыцаря'},{id:'shop_weapon_warrior_eq',name:'Меч воина'}]},
  {slot:'armor',label:'Броня',choices:[{id:'shop_armor_plate_eq',name:'Латные доспехи'},{id:'shop_armor_leather_eq',name:'Кожаная броня'}]},
  {slot:'helmet',label:'Шлем',choices:[{id:'shop_helmet_iron_eq',name:'Железный шлем'}]},
  {slot:'shield',label:'Щит',choices:[{id:'shop_shield_oak_eq',name:'Дубовый щит'}]},
  {slot:'boots',label:'Обувь',choices:[{id:'shop_boots_swift_eq',name:'Сапоги скорости'}]},
  {slot:'ring',label:'Кольцо',choices:[{id:'shop_ring_power_eq',name:'Кольцо силы'}]},
  {slot:'amulet',label:'Амулет',choices:[{id:'shop_amulet_raven_eq',name:'Амулет ворона'}]},
];
const defaultTemplates = ():Record<GearSlot,string>=>Object.fromEntries(GEAR_SLOTS.map(g=>[g.slot,g.choices[0].id])) as Record<GearSlot,string>;
const equipmentCount = (bot:Tester)=>GEAR_SLOTS.filter(g=>!!bot.equipped?.[g.slot]).length;
const statsText = (g:TesterGear)=>[
 g.attack?'+ '+g.attack+' атака':'',
 g.defense?'+ '+g.defense+' защита':'',
 g.hp?'+ '+g.hp+' HP':'',
 g.critChance?'+ '+g.critChance+'% крит':'',
].filter(Boolean).join(' · ');
interface Tester {
  equipped:Partial<Record<GearSlot,TesterGear>>;
  totalAttack:number; totalDefense:number; totalHp:number; totalCrit:number;
  slot: number; playerId: string; name: string; appearance: 'm1'|'m2'|'f1'|'f2';
  level: number; attack: number; defense: number; hp: number; crit: number; vip: number;
  gold: number; gems: number; energy: number; forgeMaterials: number; arenaRating: number;
  arenaWins: number; arenaLosses: number; totalBattlesWon: number; bossesDefeated: number;
  chapter: number; chapterWins: number; arenaStarts: number;
  autoArena: boolean; autoCampaign: boolean; autoTrials: boolean; autoCave: boolean;
  autoMortarion: boolean;
  arenaMode: 'duel'|'team'|'chaos'; intervalMinutes: number;
  lastArenaAt: string | null;
  lastEvent: { activity: string; result: string; at: string } | null;
}
type Editable = Pick<Tester,'name'|'appearance'|'level'|'attack'|'defense'|'hp'|'crit'|'vip'|
  'gold'|'gems'|'energy'|'forgeMaterials'|'arenaRating'|'autoArena'|'autoCampaign'|'autoTrials'|
  'autoCave'|'arenaMode'|'intervalMinutes'>;

const NUMBERS: Array<{key:keyof Editable;label:string;min:number;max:number}> = [
  {key:'level',label:'Уровень',min:1,max:100},
  {key:'attack',label:'Атака (без экипировки)',min:1,max:2000000},
  {key:'defense',label:'Защита (без экипировки)',min:0,max:2000000},
  {key:'hp',label:'Здоровье (без экипировки)',min:1,max:2000000},
  {key:'crit',label:'Крит без экипировки, %',min:0,max:75},
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
  const [winsInput,setWinsInput]=useState('0');
  const [gearLevels,setGearLevels]=useState<Partial<Record<GearSlot,number>>>({});
  const [gearTemplates,setGearTemplates]=useState<Record<GearSlot,string>>(defaultTemplates());

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
    setWinsInput(String(b.arenaWins));
    setGearLevels(Object.fromEntries(GEAR_SLOTS.map(g=>[g.slot,b.equipped?.[g.slot]?.level??b.level])));
    setGearTemplates(Object.fromEntries(GEAR_SLOTS.map(g=>{
      const current=b.equipped?.[g.slot]?.id;
      const choice=g.choices.find(t=>current?.endsWith('_'+t.id))??g.choices[0];
      return [g.slot,choice.id];
    })) as Record<GearSlot,string>);
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
  // Independent server-backed toggle: no stale currencies, saved stats, or
  // unrelated auto-mode settings are ever posted back to the server.
  const toggleMortarion=async()=>{
    if(selected===null||busy)return;
    const current=bots?.find(b=>b.slot===selected);
    if(!current)return;
    const next=!current.autoMortarion;
    setBusy(true);setError(null);setNotice(null);
    try{
      await adminCall('bots_mortarion_auto',{slot:selected,enabled:next});
      const fresh=await adminCall<{bots:Tester[]}>('bots_list');
      const confirmed=fresh.bots.find(b=>b.slot===selected);
      if(!confirmed||confirmed.autoMortarion!==next){
        throw new Error('Сервер не подтвердил настройку автоучастия Мортариона.');
      }
      setBots(fresh.bots);
      setNotice(next
        ? 'Автоучастие Мортариона включено. Удары идут по серверному лимиту 5 в час с паузой 60 секунд.'
        : 'Автоучастие Мортариона выключено. Новых автоматических ударов не будет.');
    }catch(e){
      setError((e as Error).message);
      // Leave the current UI state unchanged if the owner action was not confirmed.
    }finally{setBusy(false);}
  };
  const gearAction=async(operation:'equip'|'unequip'|'relevel',gearSlot:GearSlot)=>{
    if(selected===null||busy)return;
    if(dirty.length){setError('Сначала сохрани изменённые параметры персонажа.');return;}
    const current=bots?.find(b=>b.slot===selected);
    if(!current)return;
    const level=gearLevels[gearSlot]??current.level;
    if(operation!=='unequip'&&(!Number.isSafeInteger(level)||level<1||level>current.level)){
      setError('Уровень предмета должен быть от 1 до уровня персонажа.');return;
    }
    setBusy(true);setError(null);setNotice(null);
    try{
      await adminCall('bots_gear',{
        slot:selected,operation,gearSlot,
        template:operation==='equip'?gearTemplates[gearSlot]:null,
        level:operation==='unequip'?null:level,
      });
      const result=await adminCall<{bots:Tester[]}>('bots_list');
      const updated=result.bots.find(b=>b.slot===selected);
      if(!updated)throw new Error('Нет подтверждения от сервера.');
      setBots(result.bots);setDraft(editable(updated));
      setGearLevels(v=>({...v,[gearSlot]:updated.equipped?.[gearSlot]?.level??updated.level}));
      setNotice('Экипировка сохранена. Боевые характеристики пересчитаны на сервере.');
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  };
  const equipMissing=()=>confirm('Выдать всем 10 тестерам недостающую экипировку по их уровню? Уже надетые предметы не изменятся.',async()=>{
    setBusy(true);
    try{
      const reply=await adminCall<{testers:number;equipped:number}>('bots_gear_seed');
      const result=await adminCall<{bots:Tester[]}>('bots_list');
      setBots(result.bots);
      return 'Проверено 10 тестеров, выдано недостающих предметов: '+reply.equipped;
    }finally{setBusy(false);}
  });
  const applyWins=async(mode:'delta'|'set',value:number):Promise<string>=>{
    if(selected===null||busy)throw new Error('Операция уже выполняется.');
    if(dirty.length){
      const message='Сначала сохрани изменённые поля персонажа.';
      setError(message);throw new Error(message);
    }
    const current=bots?.find(b=>b.slot===selected);
    if(!current)throw new Error('Тестер не найден.');
    setBusy(true);setError(null);setNotice(null);
    try{
      const response=await adminCall<{result:{slot:number;before:number;after:number;delta:number}}>(
        'bots_wins',{slot:selected,mode,value,expectedWins:mode==='set'?current.arenaWins:null}
      );
      const result=await adminCall<{bots:Tester[]}>('bots_list');
      const updated=result.bots.find(b=>b.slot===selected);
      if(!updated)throw new Error('Тестер не найден после сохранения.');
      setBots(result.bots);
      // The Arena can complete a new real match between the write and read-back.
      setWinsInput(String(updated.arenaWins));
      const note='Сохранено: '+format(response.result.before)+' → '+format(response.result.after)+
        '. Сейчас в общем рейтинге: '+format(updated.arenaWins)+' побед. Топ-50 обновлён.';
      setNotice(note);
      return note;
    }catch(e){
      setError((e as Error).message);
      if((e as {code?:string}).code==='bots_wins_changed'){
        const updated=await load();
        const tester=updated?.find(b=>b.slot===selected);
        if(tester)setWinsInput(String(tester.arenaWins));
      }
      setError((e as Error).message);
      throw e;
    }finally{setBusy(false);}
  };
  const adjustWins=(delta:-10|-1|1|10)=>{
    void applyWins('delta',delta).catch(()=>{});
  };
  const setExactWins=()=>{
    if(!draft||selected===null||busy)return;
    if(!/^\d+$/.test(winsInput)||!Number.isSafeInteger(Number(winsInput))||
      Number(winsInput)>1000000){
      setError('Укажи целое число побед от 0 до 1 000 000.');return;
    }
    const value=Number(winsInput);
    const current=bots?.find(b=>b.slot===selected);
    if(!current)return;
    if(value===current.arenaWins){setNotice('Это число уже сохранено.');return;}
    confirm('Установить тестеру №'+selected+' '+format(value)+' общих побед Арены вместо '+
      format(current.arenaWins)+'? Эта корректировка отразится в текущем Топ-50 Арены.',
      ()=>applyWins('set',value));
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
          if(bot){setDraft(editable(bot));setWinsInput(String(bot.arenaWins));}
        }
      }} className="h-10 px-3 rounded-xl border border-slate-700 text-slate-300 disabled:opacity-50" aria-label="Обновить"><RefreshCw className="w-4 h-4"/></button>
    </div>
    <ErrorLine text={error}/>
    {notice&&<p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200" role="status">{notice}</p>}
    <button type="button" disabled={busy} onClick={equipMissing} className="w-full rounded-xl border border-amber-700/50 bg-amber-900/20 p-3 text-sm font-semibold text-amber-200 disabled:opacity-40">
      <Hammer className="w-4 h-4 inline mr-2"/>Экипировать недостающие слоты у 10 тестеров
    </button>
    {bots.length<10&&<Panel title="Создание тестеров" icon={<Users className="w-4 h-4"/>}>
      <p className="text-xs text-slate-300 mb-3">Каждый тестер получит собственный игровой аккаунт 61 уровня в общей базе игроков. Неизменённые реальные аккаунты останутся на месте. Все автопереходы изначально выключены.</p>
      <button disabled={busy} onClick={init} className="w-full h-11 rounded-xl bg-sky-700 text-white font-semibold disabled:opacity-50">Создать недостающих тестеров ({10-bots.length})</button>
    </Panel>}
    {selected===null?<div className="space-y-2">
      {bots.map(b=><button key={b.slot} type="button" onClick={()=>open(b)} className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 flex items-center gap-3 text-left hover:border-sky-500/60">
        <span className="w-10 h-10 rounded-full bg-gradient-to-b from-amber-800 to-slate-800 flex items-center justify-center text-amber-200 font-bold">{b.slot}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-white truncate">{b.name}</span>
          <span className="text-[11px] text-slate-400">Ур. {b.level} · экипировка {equipmentCount(b)}/7 · {format(b.arenaWins)} побед / {format(b.arenaLosses)} поражений</span>
        </span>
        <span className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[11px] font-semibold ${b.autoArena?'text-emerald-300':'text-slate-500'}`}>{b.autoArena?'Арена: авто':'Арена: выкл'}</span>
          <span className={`text-[11px] font-semibold ${b.autoMortarion?'text-amber-300':'text-slate-500'}`}>{b.autoMortarion?'Мортарион: авто':'Мортарион: выкл'}</span>
        </span>
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
      <Panel title="Победы Арены — ручное управление" icon={<Trophy className="w-4 h-4"/>}>
        <p className="text-xs text-slate-400 mb-3">
          Изменяет общие победы тестера и количество побед в текущем Топ-50 Арены.
          Ручные победы учитываются в рейтинге, но не становятся реальными боями
          и не влияют на выдачу сезонных наград. Поражения и боевой рейтинг не меняются.
        </p>
        <div className="rounded-xl border border-sky-700/40 bg-sky-950/30 px-3 py-3 flex items-center justify-between mb-3">
          <span className="text-xs text-slate-300">Всего побед</span>
          <span className="text-2xl font-bold text-amber-200">{format(current.arenaWins)}</span>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([-10,-1,1,10] as const).map(delta=><button
            key={delta} type="button"
            disabled={busy||dirty.length>0||current.arenaWins+delta<0||current.arenaWins+delta>1000000}
            onClick={()=>adjustWins(delta)}
            className="h-11 rounded-xl border border-amber-600/50 bg-slate-800 text-sm font-bold text-amber-200 disabled:opacity-30"
          >{delta>0?'+':''}{delta}</button>)}
        </div>
        <label className="block text-xs text-slate-300">Установить точное количество побед
          <input type="number" inputMode="numeric" min={0} max={1000000}
            disabled={busy||dirty.length>0}
            className={inputCls+' mt-1'} value={winsInput}
            onChange={e=>setWinsInput(e.target.value)}/>
        </label>
        <button type="button" disabled={busy||dirty.length>0}
          onClick={setExactWins}
          className="w-full h-11 mt-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-semibold disabled:opacity-40">
          {busy?'Сохранение…':'Сохранить количество побед'}
        </button>
      </Panel>
      <Panel title={'Экипировка · '+equipmentCount(current)+'/7'} icon={<Hammer className="w-4 h-4"/>}>
        <p className="text-xs text-slate-400 mb-3">Обычное игровое снаряжение. Можно надеть, снять или изменить уровень предмета до уровня героя. Бонусы входят в настоящие бои и не меняют баланс соперников Арены.</p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {[
            ['Атака',current.totalAttack],['Защита',current.totalDefense],
            ['Здоровье',current.totalHp],['Крит',current.totalCrit+'%']
          ].map(([name,value])=><div key={name} className="rounded-xl bg-slate-950/50 border border-amber-800/30 p-2 text-center">
            <div className="text-[11px] text-slate-400">{name} со снаряжением</div>
            <div className="text-base font-bold text-amber-200">{value}</div>
          </div>)}
        </div>
        <div className="space-y-3">
          {GEAR_SLOTS.map(entry=>{
            const g=current.equipped?.[entry.slot];
            return <div key={entry.slot} className="rounded-xl border border-slate-700 bg-slate-950/70 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl w-9 text-center">{g?.icon??'◇'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-100">{entry.label}: {g?.name??'пусто'}</div>
                  <div className="text-[11px] text-slate-400">{g?'Уровень '+g.level+' · '+(g.rarity==='rare'?'редкое':g.rarity==='common'?'обычное':g.rarity):'Нет экипировки'}</div>
                </div>
              </div>
              {g&&<p className="text-xs text-emerald-200">{statsText(g)}</p>}
              {entry.choices.length>1&&<label className="block text-[11px] text-slate-400">Модель
                <select disabled={busy||dirty.length>0} className={inputCls+' mt-1'} value={gearTemplates[entry.slot]} onChange={e=>setGearTemplates(v=>({...v,[entry.slot]:e.target.value}))}>
                  {entry.choices.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>}
              <label className="block text-[11px] text-slate-400">Уровень предмета
                <input type="number" min={1} max={current.level} disabled={busy||dirty.length>0} className={inputCls+' mt-1'} value={gearLevels[entry.slot]??current.level}
                  onChange={e=>setGearLevels(v=>({...v,[entry.slot]:Number(e.target.value)}))}/>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy||dirty.length>0} onClick={()=>void gearAction('equip',entry.slot)}
                  className="flex-1 min-w-[88px] rounded-lg bg-amber-800/80 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{g?'Заменить':'Надеть'}</button>
                {g&&<button type="button" disabled={busy||dirty.length>0} onClick={()=>void gearAction('relevel',entry.slot)}
                  className="flex-1 min-w-[88px] rounded-lg border border-amber-700/60 bg-slate-800 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-40">Изменить уровень</button>}
                {g&&<button type="button" disabled={busy||dirty.length>0} onClick={()=>void gearAction('unequip',entry.slot)}
                  className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 disabled:opacity-40">Снять</button>}
              </div>
            </div>;
          })}
        </div>
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
          <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-2 space-y-2" data-testid="mortarion-auto-participation">
            <Switch label="Мортарион — автоучастие" hint="Только этот тестер наносит настоящие удары мировому боссу: не более 5 в час, с паузой 60 секунд. Начинает только после твоего включения."
              on={current.autoMortarion} tone="amber" onToggle={()=>{void toggleMortarion();}}/>
            <p className="px-1 text-[11px] text-slate-400" role="status">
              {current.autoMortarion
                ? 'Включено · серверная автоматика работает до выключения или окончания события.'
                : 'Выключено · автоудары по Мортариону не выполняются.'}
            </p>
          </div>
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
