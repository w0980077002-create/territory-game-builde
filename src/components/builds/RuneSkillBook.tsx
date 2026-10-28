import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, Crown, Flame, Info, LockKeyhole, Shield, Sparkles, Swords, Wind, X, Zap } from 'lucide-react';
import catalog from '@/game/config/territory-rune-skill-book-v1.json';
import { RuneArtwork } from './RuneArtwork';
import './runeHall.css';

type GroupId = (typeof catalog.groups)[number]['id'];
type Skill = (typeof catalog.groups)[number]['skills'][number];
export type RuneSkillBookSelection = {
  skillIds: Record<GroupId, string>;
  runeIds: Record<string, string>;
  passiveIds: string[];
};
export const INITIAL_RUNE_BOOK_SELECTION: RuneSkillBookSelection = {
  skillIds: Object.fromEntries(catalog.groups.map(group => [group.id, group.skills[0].id])),
  runeIds: {},
  passiveIds: catalog.passives.slice(0, 3).map(passive => passive.id),
};
function name(item:{nameRu:string;nameEn:string},en:boolean){return en?item.nameEn:item.nameRu;}
const badgeIcon = { base:Swords, core:Flame, control:Wind, awakening:Zap, final:Crown };
function CategoryBadge({groupId}:{groupId:GroupId}) {
  const Icon=badgeIcon[groupId]??Shield;
  return <span className="rhall-category-medal" aria-hidden="true"><Icon size={25} strokeWidth={2.8}/></span>;
}
function Temple() {
  return <div className="rhall-temple-art" aria-hidden="true">
    <span className="rhall-tower rhall-tower--left"/><span className="rhall-tower rhall-tower--right"/>
    <span className="rhall-banner-flag rhall-banner-flag--left">ᛟ</span>
    <span className="rhall-banner-flag rhall-banner-flag--right">ᛉ</span>
    <span className="rhall-flame rhall-flame--left"/><span className="rhall-flame rhall-flame--right"/>
    <svg className="rhall-gem" viewBox="0 0 92 114" fill="none" aria-hidden="true">
      <defs><linearGradient id="rhall-gem-outer" x1="8" y1="2" x2="91" y2="111"><stop stopColor="#fff2ff"/><stop offset=".29" stopColor="#f64aff"/><stop offset=".68" stopColor="#7e16c6"/><stop offset="1" stopColor="#33096d"/></linearGradient>
      <linearGradient id="rhall-gem-facet" x1="45" y1="11" x2="72" y2="98"><stop stopColor="#fddaff"/><stop offset=".4" stopColor="#ce4dff"/><stop offset="1" stopColor="#6821c0"/></linearGradient></defs>
      <path d="M46 3L85 27 85 81 46 110 7 81 7 27Z" fill="#320449" stroke="#fce3fd" strokeWidth="4"/>
      <path d="M46 10L78 30 78 77 46 100 14 77 14 30Z" fill="url(#rhall-gem-outer)" stroke="#ed8aff" strokeWidth="2"/>
      <path d="M46 10V100M14 30L46 48 78 30M14 77L46 48 78 77" stroke="#ffe9ff" strokeOpacity=".66" strokeWidth="2"/>
      <path d="M46 21L66 35 64 68 46 85 27 67 26 35Z" fill="url(#rhall-gem-facet)" stroke="#fff4ff" strokeWidth="2"/>
      <path d="M36 38L49 26 42 48 59 47 39 72 46 50 30 54Z" fill="#fff1ff"/>
    </svg>
  </div>;
}

export function RuneSkillBook({
 language, initialSelection, onSelectionChange, serverConnected=false, available, onBack,
}:{
 language:'ru'|'en';
 initialSelection?:RuneSkillBookSelection;
 onSelectionChange?:(selection:RuneSkillBookSelection)=>void;
 serverConnected?:boolean;
 available?:{skills:Record<string,number>;runes:Record<string,number>;passives:Record<string,number>};
 onBack?:()=>void;
}){
 const en=language==='en';
 const [selection,setSelection]=useState<RuneSkillBookSelection>(()=>initialSelection??INITIAL_RUNE_BOOK_SELECTION);
 const [activeSkillId,setActiveSkillId]=useState<string|null>(null);
 const [showAllPassives,setShowAllPassives]=useState(false);
 const [showHelp,setShowHelp]=useState(false);
 const activeSkill=useMemo(()=>catalog.groups.flatMap(group=>group.skills).find(skill=>skill.id===activeSkillId),[activeSkillId]);
 const activeGroup=useMemo(()=>catalog.groups.find(group=>group.skills.some(skill=>skill.id===activeSkillId)),[activeSkillId]);
 const setNext=(next:RuneSkillBookSelection)=>{setSelection(next);onSelectionChange?.(next);};
 const equipSkill=(skill:Skill,groupId:GroupId)=>setNext({...selection,skillIds:{...selection.skillIds,[groupId]:skill.id}});
 const equipRune=(skillId:string,runeId:string)=>setNext({...selection,runeIds:{...selection.runeIds,[skillId]:runeId}});
 const togglePassive=(id:string)=>{
  const picked=selection.passiveIds.includes(id);
  if(!picked&&selection.passiveIds.length>=3)return;
  setNext({...selection,passiveIds:picked?selection.passiveIds.filter(p=>p!==id):[...selection.passiveIds,id]});
 };
 const selectedSkills=catalog.groups.map(group=>selection.skillIds[group.id]).filter(Boolean);
 const assignedRunes=selectedSkills.filter(id=>!!selection.runeIds[id]).length;
 const passives=showAllPassives?catalog.passives:[
   ...catalog.passives.filter(p=>selection.passiveIds.includes(p.id)),
   ...catalog.passives.filter(p=>!selection.passiveIds.includes(p.id)),
 ].slice(0,3);
 useEffect(()=>{
   if(!activeSkillId&&!showHelp)return;
   const handle=(event:KeyboardEvent)=>{if(event.key==='Escape'){setActiveSkillId(null);setShowHelp(false);}};
   document.addEventListener('keydown',handle);
   return()=>document.removeEventListener('keydown',handle);
 },[activeSkillId,showHelp]);
 return <section className="rhall" data-testid="territory-rune-skill-book">
   <div className="rhall-temple">
    <Temple/>
    <div className="rhall-temple-actions">
     {onBack&&<button type="button" className="rhall-back" onClick={onBack}><ChevronLeft size={17}/>{en?'Map':'К карте'}</button>}
     <button type="button" className="rhall-help" aria-label={en?'About skills and runes':'Справка по рунам'} onClick={()=>setShowHelp(true)}><Info size={20}/></button>
    </div>
    <div className="rhall-heading"><span className="rhall-wood-nail"/><span>{en?'RUNES':'РУНЫ'}</span><span className="rhall-wood-nail"/></div>
   </div>
   <div className="rhall-parchment">
     <div className="rhall-section-label"><span className="rhall-diamond">✦</span><b>{en?'BATTLE SKILLS':'БОЕВЫЕ НАВЫКИ'}</b><span className="rhall-diamond">✦</span></div>
     <div className="rhall-skills">
      {catalog.groups.map(group=><div key={group.id} className="rhall-row" data-testid={'rune-row-'+group.id}>
        <div className="rhall-group"><CategoryBadge groupId={group.id}/><strong>{name(group,en)}</strong></div>
        <div className="rhall-options">
         {group.skills.map(skill=>{
           const equipped=selection.skillIds[group.id]===skill.id;
           const unlocked=!serverConnected||!!available?.skills[skill.id];
           return <button key={skill.id} type="button"
             className={'rhall-skill'+(equipped?' rhall-skill--equipped':'')}
             aria-label={name(skill,en)+(equipped?(en?' equipped':' экипировано'):'')}
             aria-pressed={equipped}
             disabled={!unlocked}
             onClick={()=>setActiveSkillId(skill.id)}>
             <span className="rhall-skill-gem"><RuneArtwork id={skill.id} equipped={equipped}/></span>
             {equipped&&<span className="rhall-equipped">{en?'EQUIPPED':'Экипировано'}</span>}
             {!unlocked&&<LockKeyhole className="rhall-locked" size={14}/>}
           </button>;
         })}
        </div>
      </div>)}
     </div>
     <div className="rhall-passive-title"><span/><b>{en?'PASSIVE RUNES':'ПАССИВНЫЕ РУНЫ'}</b><span/></div>
     <div className="rhall-passive-panel">
       <div className="rhall-passives">
        {passives.map(passive=>{
          const picked=selection.passiveIds.includes(passive.id);
          const unlocked=!serverConnected||!!available?.passives[passive.id];
          return <button type="button" key={passive.id}
            className={'rhall-passive'+(picked?' rhall-passive--on':'')}
            aria-label={name(passive,en)+(picked?(en?' equipped':' экипировано'):'')}
            title={en?passive.descriptionEn:passive.descriptionRu}
            aria-pressed={picked}
            disabled={(!picked&&selection.passiveIds.length>=3)||!unlocked}
            onClick={()=>togglePassive(passive.id)}>
            <RuneArtwork id={passive.id} equipped={picked} passive/>
            <span>{name(passive,en)}</span>
            {picked&&<Check size={15} className="rhall-passive-check"/>}
          </button>;
        })}
       </div>
       <button className="rhall-toggle" type="button" aria-expanded={showAllPassives} onClick={()=>setShowAllPassives(v=>!v)}>
         {showAllPassives?(en?'Show three':'Показать три'):(en?'All passive runes':'Все пассивные руны')}
       </button>
     </div>
     <div className="rhall-bonus">
       <div className="rhall-bonus-heading"><Sparkles size={15}/>{en?'RUNE BUILD':'РУНИЧЕСКАЯ СБОРКА'}</div>
       <div className="rhall-bonus-grid">
         <span>⚔️ {en?'Skills':'Навыки'} <b>{selectedSkills.length}/5</b></span>
         <span>💎 {en?'Runes':'Руны'} <b>{assignedRunes}</b></span>
         <span>❤️ {en?'Passives':'Пассивы'} <b>{selection.passiveIds.length}/3</b></span>
       </div>
       <p>{serverConnected
         ?(en?'Unlocked effects are validated on the server.':'Открытые эффекты проверяются сервером.')
         :(en?'Preview: selections do not yet affect live battles or save.':'Тестовый просмотр: выбор пока не влияет на настоящий бой и не сохраняется.')}</p>
     </div>
     <div className="rhall-bottom-tabs"><span className="rhall-tab rhall-tab--on">{en?'SKILLS':'НАВЫКИ'}</span><span className="rhall-tab rhall-tab--disabled">{en?'MAX LEVEL':'ПИКОВЫЙ УРОВЕНЬ'} <LockKeyhole size={12}/></span></div>
   </div>
   {showHelp&&<div className="rhall-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)setShowHelp(false);}}>
     <section className="rhall-dialog" role="dialog" aria-modal="true" aria-label={en?'About runes':'О рунах'}>
       <button className="rhall-close" type="button" onClick={()=>setShowHelp(false)} aria-label={en?'Close':'Закрыть'}><X size={20}/></button>
       <h3>{en?'HOW THE RUNES WORK':'КАК РАБОТАЮТ РУНЫ'}</h3>
       <p>{en?'Each of the five stages can equip one skill. Tap a skill to inspect its three runes. You can equip up to three passive runes.':'В каждой из пяти ступеней выбирается один навык. Нажми на шестигранник, чтобы открыть три его руны. Дополнительно можно выбрать три пассивные руны.'}</p>
       <p>{en?'Live effects and saving require server confirmation.':'Боевые эффекты и сохранение требуют подтверждения сервера.'}</p>
     </section>
   </div>}
   {activeSkill&&activeGroup&&<div className="rhall-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)setActiveSkillId(null);}}>
     <section className="rhall-dialog" role="dialog" aria-modal="true" aria-labelledby="rhall-dialog-title">
       <button className="rhall-close" type="button" aria-label={en?'Close':'Закрыть'} onClick={()=>setActiveSkillId(null)}><X size={20}/></button>
       <div className="rhall-dialog-icon"><RuneArtwork id={activeSkill.id} equipped={selection.skillIds[activeGroup.id]===activeSkill.id}/></div>
       <span className="rhall-dialog-group">{name(activeGroup,en)}</span>
       <h3 id="rhall-dialog-title">{name(activeSkill,en)}</h3>
       <p>{en?activeSkill.descriptionEn:activeSkill.descriptionRu}</p>
       <button type="button" className="rhall-confirm" aria-pressed={selection.skillIds[activeGroup.id]===activeSkill.id}
         disabled={serverConnected&&!available?.skills[activeSkill.id]}
         onClick={()=>equipSkill(activeSkill,activeGroup.id)}>
         <Check size={16}/>{selection.skillIds[activeGroup.id]===activeSkill.id?(en?'EQUIPPED':'ЭКИПИРОВАНО'):(en?'EQUIP SKILL':'ВЫБРАТЬ НАВЫК')}
       </button>
       <h4>{en?'RUNES FOR THIS SKILL':'РУНЫ ЭТОГО НАВЫКА'}</h4>
       <div className="rhall-rune-options">
         {activeSkill.runes.map((rune,index)=>{
           const picked=selection.runeIds[activeSkill.id]===rune.id;
           const unlocked=!serverConnected||!!available?.runes[rune.id];
           return <button key={rune.id} type="button" className={'rhall-rune-choice'+(picked?' rhall-rune-choice--picked':'')}
             aria-pressed={picked} disabled={!unlocked} onClick={()=>equipRune(activeSkill.id,rune.id)}>
             <span className="rhall-rune-sign">{['ᚠ','ᚱ','ᛟ'][index]}</span>
             <span><strong>{name(rune,en)}</strong><small>{en?rune.effectEn:rune.effectRu}</small></span>
             {picked?<Check size={18}/>:unlocked?<span className="rhall-unpicked">◇</span>:<LockKeyhole size={14}/>}
           </button>;
         })}
       </div>
       <button type="button" className="rhall-dialog-back" onClick={()=>setActiveSkillId(null)}>{en?'Back to skills':'Назад к навыкам'}</button>
     </section>
   </div>}
 </section>;
}
