import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/game/supabase';
import {requestCombat,pendingCombatCommand} from '@/game/combatV1/api';
import type {IdleCatalog,IdleLoadout,IdleOwnership} from '@/game/idleEngine/types';
import visual from '@/game/config/territory-rune-skill-book-v1.json';
import {RuneSkillBook,type RuneSkillBookSelection} from './RuneSkillBook';
type Status={enabled:true;revision:number;catalog:IdleCatalog;ownership:IdleOwnership;loadout:IdleLoadout};
function isRecord(x:unknown):x is Record<string,unknown>{return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function verified(x:unknown):x is Status{
 if(!isRecord(x)||x.enabled!==true||!Number.isSafeInteger(x.revision)||!isRecord(x.catalog)||!isRecord(x.ownership)||!isRecord(x.loadout))return false;
 const c=x.catalog as Record<string,unknown>,o=x.ownership as Record<string,unknown>,l=x.loadout as Record<string,unknown>;
 if(!Array.isArray(c.skills)||!Array.isArray(c.runes)||!Array.isArray(c.passives)||!isRecord(o.skills)||!isRecord(o.runes)||!isRecord(o.passives)||!Array.isArray(l.skills)||!Array.isArray(l.passives))return false;
 const skills=new Set(c.skills.filter(isRecord).map(s=>s.id)), runes=new Set(c.runes.filter(isRecord).map(s=>s.id)),passives=new Set(c.passives.filter(isRecord).map(s=>s.id));
 return visual.groups.every(g=>g.skills.every(s=>skills.has(s.id)&&s.runes.every(r=>runes.has(r.id))))&&visual.passives.every(p=>passives.has(p.id));
}
function selections(status:Status):RuneSkillBookSelection{
 const active=Object.fromEntries(visual.groups.map(group=>[group.id,status.loadout.skills.find(skill=>status.catalog.skills.some(x=>x.id===skill.skillId&&x.category===group.id))?.skillId??'']));
 const runes=Object.fromEntries(status.loadout.skills.flatMap(s=>s.runes.length?[[s.skillId,s.runes[0].runeId]]:[]));
 return {skillIds:active,runeIds:runes,passiveIds:status.loadout.passives.map(x=>x.passiveId)};
}
function compose(status:Status,choice:RuneSkillBookSelection):IdleLoadout{
 return{
  skills:visual.groups.flatMap(g=>{
    const id=choice.skillIds[g.id], level=status.ownership.skills[id]??0;
    const entry=status.catalog.skills.find(s=>s.id===id&&s.category===g.id);
    if(!entry||level<1)return[];
    const rune=choice.runeIds[id],runeLevel=status.ownership.runes[rune]??0;
    const compatible=status.catalog.runes.find(r=>r.id===rune&&r.compatibleSkillIds.includes(id));
    return[{skillId:id,level,runes:compatible&&runeLevel>0?[{runeId:rune,level:runeLevel}]:[]}];
  }),
  passives:choice.passiveIds.flatMap(id=>{
    const level=status.ownership.passives[id]??0;
    return level>0&&status.catalog.passives.some(p=>p.id===id)?[{passiveId:id,level}]:[];
  }),
 };
}
export function ServerRuneBook({language}:{language:'ru'|'en'}){
 const en=language==='en';const alive=useRef(true),saving=useRef(false);
 const [status,setStatus]=useState<Status|null>(null),[notice,setNotice]=useState(''),[version,setVersion]=useState(0);
 useEffect(()=>{
  alive.current=true;
  void(async()=>{
    try{
      const {data,error}=await supabase.rpc('territory_combat_loadout_status_v1');
      if(alive.current&& !error&&verified(data))setStatus(data);
    }catch{/* Non-deployed/disabled RPC leaves the visual preview intact. */}
  })();
  return()=>{alive.current=false;};
 },[version]);
 const handle=async(choice:RuneSkillBookSelection)=>{
  if(!status||saving.current)return;
  saving.current=true;setNotice(en?'Saving with server…':'Сохранение на сервере…');
  try{
    const old=await pendingCombatCommand();
    if(old&&old.action!=='loadout')throw new Error('previous_combat_pending');
    const command=old??{action:'loadout' as const,operationId:crypto.randomUUID(),revision:status.revision,loadout:compose(status,choice)};
    await requestCombat(command);
    if(alive.current){setNotice(en?'Build saved by server.':'Сборка подтверждена сервером.');setVersion(v=>v+1);}
  }catch{
    if(alive.current){setNotice(en?'Could not confirm. Previous saved build remains on server.':'Нет подтверждения. На сервере остаётся прежняя сборка.');setVersion(v=>v+1);}
  }finally{saving.current=false;}
 };
 return <>
  {status&&<p role="status" className="mb-2 rounded-lg border border-amber-500/35 bg-amber-900/30 p-2 text-[11px] text-amber-100">
    {en?'Server-verified runes. Changes need server confirmation. Combat migration is separate.':'Руны проверены сервером. Выбор сохраняется только после подтверждения. Перенос самой боёвки выполняется отдельно.'}
  </p>}
  <RuneSkillBook key={status?String(status.revision)+'/'+version:'preview'} language={language}
    initialSelection={status?selections(status):undefined}
    onSelectionChange={status?(handle):undefined}
    serverConnected={!!status}
    available={status?{skills:status.ownership.skills,runes:status.ownership.runes,passives:status.ownership.passives}:undefined}/>
  {notice&&<p className="mt-2 rounded-lg border border-amber-400/40 bg-slate-800 p-2 text-xs text-amber-100" role="status">{notice}</p>}
 </>;
}
