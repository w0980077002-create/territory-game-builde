import { useState } from 'react';
import { Check, CircleHelp, ScrollText, Sparkles, X } from 'lucide-react';
import catalog from '@/game/config/territory-rune-skill-book-v1.json';
import './runeSummonPreview.css';

/** Artwork cropped from the original approved TERRITORY rune UI concept.
 * One lightweight WebP atlas instead of 15 separate image requests.
 * Each rarity receives a matching colour, while individual runes vary by symbol.
 */
export function RuneGemIllustration({tier,runeId='default',className=''}:{tier:RuneTier;runeId?:string;className?:string}) {
 const hash=[...runeId].reduce((acc,ch)=>(acc*31+ch.charCodeAt(0))>>>0,7);
 const options:Record<RuneTier,number[]>={
   legendary:[0], yellow:[1], purple:[2,3,4,5], blue:[6,7,8,9,10,11,12,13,14],
 };
 const slots=options[tier],index=slots[hash%slots.length];
 return <span aria-hidden="true" className={'rsim-art-sprite '+className}
   style={{
     backgroundImage:'url('+import.meta.env.BASE_URL+'runes/rune-rewards-art.webp)',
     backgroundSize:'500% 300%',
     backgroundPosition:(index%5)*25+'% '+Math.floor(index/5)*50+'%',
   }}/>;
}


export type RuneTier = 'blue' | 'purple' | 'yellow' | 'legendary';
export const RUNE_CAP: Record<RuneTier, number> = { blue:20, purple:40, yellow:60, legendary:300 };
const TIERS: RuneTier[] = ['blue','purple','yellow','legendary'];
export const RUNE_TIER_NAMES: Record<RuneTier,{ru:string;en:string}> = {
  blue:{ru:'Синяя',en:'Blue'},purple:{ru:'Фиолетовая',en:'Purple'},
  yellow:{ru:'Жёлтая',en:'Yellow'},legendary:{ru:'Легендарная',en:'Legendary'},
};
const items = catalog.groups.flatMap(group=>group.skills.flatMap(skill=>
  skill.runes.map(rune=>({id:rune.id,nameRu:rune.nameRu,nameEn:rune.nameEn,skillId:skill.id}))));
export type RunePreviewDrop = { id:string; kind:'points'|'legendary'; tier:RuneTier; count:number };
export type RuneDemoState = {
  summons:number; pity:number; scrolls:number; points:Record<string,number>;
  rank:Record<string,RuneTier>; level:Record<string,number>;
  legendCopies:Record<string,number>;
  result:RunePreviewDrop[]; lastQuantity:number;
};
export function createRuneDemoState():RuneDemoState {
  const first=items[0]?.id ?? 'shield_wall_r1';
  // Fixtures in an ISOLATED VISUAL TEST. These are never loaded from real accounts.
  return {summons:0,pity:0,scrolls:1250,points:{[first]:2170},rank:{[first]:'yellow'},
    level:{[first]:60},legendCopies:{},result:[],lastQuantity:0};
}
function randomFloat():number {
  if(typeof crypto!=='undefined'&&crypto.getRandomValues) {
    const buf=new Uint32Array(1);crypto.getRandomValues(buf);return buf[0]/4294967296;
  }
  return Math.random();
}
const tierIndex=(tier:RuneTier)=>TIERS.indexOf(tier);
const randomItem=(rng:()=>number)=>items[Math.min(items.length-1,Math.floor(rng()*items.length))];
function maxTier(a:RuneTier,b:RuneTier):RuneTier {return TIERS[Math.max(tierIndex(a),tierIndex(b))];}

/** Demonstration only. Official drop weights and price formula await approval.
 * The rule "legendary on each 100th pull" is intentional and testable.
 * Never execute this in place of server-side account rewards.
 */
export function summonRuneDemo(state:RuneDemoState,quantity:10|100,rng:()=>number=randomFloat):RuneDemoState {
 if(state.scrolls<quantity) return state;
 const points={...state.points},rank={...state.rank},legendCopies={...state.legendCopies};
 const drops=new Map<string,RunePreviewDrop>();
 let pity=state.pity;
 for(let i=0;i<quantity;i++){
   pity++;
   const item=randomItem(rng);
   if(pity>=100){
     const key='legendary:'+item.id;
     legendCopies[item.id]=(legendCopies[item.id]??0)+1;
     rank[item.id]='legendary';
     drops.set(key,{id:item.id,tier:'legendary',kind:'legendary',count:(drops.get(key)?.count??0)+1});
     pity=0;
   }else{
     const x=rng();
     const tier:RuneTier=x<.68?'blue':x<.93?'purple':'yellow';
     const value=10; // Demo-only: illustrative value, not production drop odds.
     const key='points:'+item.id+':'+tier;
     points[item.id]=(points[item.id]??0)+value;
     drops.set(key,{id:item.id,tier,kind:'points',count:(drops.get(key)?.count??0)+value});
   }
 }
 const result=[...drops.values()].sort((a,b)=>tierIndex(b.tier)-tierIndex(a.tier)||b.count-a.count);
 return {...state,scrolls:state.scrolls-quantity,summons:state.summons+quantity,
   points,rank,legendCopies,pity,result,lastQuantity:quantity};
}
export function upgradeRuneDemo(state:RuneDemoState,runeId:string):RuneDemoState {
 const level=state.level[runeId]??0,cap=RUNE_CAP[state.rank[runeId]??'blue'];
 const cost=100; // Demo only. Server-side level costs require approval.
 if(level>=cap||level>=300||(state.points[runeId]??0)<cost||state.scrolls<1)return state;
 return {...state,level:{...state.level,[runeId]:level+1},
   points:{...state.points,[runeId]:(state.points[runeId]??0)-cost},
   scrolls:state.scrolls-1};
}
function label(id:string,en:boolean):string {
 const r=items.find(item=>item.id===id);
 return r?(en?r.nameEn:r.nameRu):id;
}
export function RuneTierStrip({language}:{language:'ru'|'en'}) {
 const en=language==='en';
 return <div className="rsim-tiers" aria-label={en?'Rune rarity and level caps':'Редкость и пределы развития рун'}>
   {TIERS.map(tier=><div key={tier} className={'rsim-tier rsim-tier--'+tier}>
      <RuneGemIllustration tier={tier} runeId={tier}/><b>{en?RUNE_TIER_NAMES[tier].en:RUNE_TIER_NAMES[tier].ru}</b>
      <span>{en?'Maximum level':'Макс. уровень'} <strong>{RUNE_CAP[tier]}</strong></span>
   </div>)}
 </div>;
}
type PreviewProps={language:'ru'|'en';state:RuneDemoState;quantity:10|100;
 setQuantity:(n:10|100)=>void;onSummon:(n:10|100)=>void;onClose:()=>void;
 onResultClose:()=>void;onChooseRune?:(skillId:string,runeId:string)=>void};
export function RuneSummonPreview({language,state,quantity,setQuantity,onSummon,onClose,onResultClose,onChooseRune}:PreviewProps) {
 const en=language==='en',hasResult=state.result.length>0;
 const showName=(id:string)=>label(id,en);
 const [showInfo,setShowInfo]=useState(false);
 return <div className="rsim-overlay" onMouseDown={e=>{if(e.currentTarget===e.target){if(hasResult)onResultClose();else onClose();}}}>
   <section className="rsim-popup" role="dialog" aria-modal="true" aria-labelledby="rsim-title">
    <div className="rsim-header"><b id="rsim-title">{hasResult?(en?'SUMMON RESULTS ×'+state.lastQuantity:'РЕЗУЛЬТАТ ПРИЗЫВА ×'+state.lastQuantity):(en?'RUNE SUMMON':'ПРИЗЫВ РУН')}</b>
      <button type="button" onClick={hasResult?onResultClose:onClose} aria-label={en?'Close':'Закрыть'}><X size={18}/></button></div>
    {hasResult?<div className="rsim-result">
      <p className="rsim-result-label">{en?'Rewards grouped by rune. ×N means level-up points.':'Награды сгруппированы по рунам. ×N — очки прокачки.'}</p>
      <div className="rsim-result-grid">
       {state.result.map(drop=><button key={drop.kind+':'+drop.id+':'+drop.tier}
         className={'rsim-drop rsim-drop--'+drop.tier} onClick={()=>onChooseRune?.(items.find(item=>item.id===drop.id)?.skillId??'',drop.id)}>
         <span className="rsim-drop-icon"><RuneGemIllustration tier={drop.tier} runeId={drop.id}/></span>
         <span className="rsim-drop-name">{showName(drop.id)}</span>
         <strong>×{drop.count}</strong>
         <small>{drop.kind==='legendary'?(en?'Legendary rune':'Легендарная руна'):(en?'Level-up points':'Очки развития')}</small>
       </button>)}
      </div>
      <button type="button" className="rsim-collect" onClick={onResultClose}><Check size={17}/>{en?'COLLECT':'ЗАБРАТЬ'}</button>
      <p className="rsim-demotag">{en?'DEMO · No real account changes':'ТЕСТ · Не начисляется на игровой аккаунт'}</p>
     </div>:<>
      <div className="rsim-altar rsim-altar--painted"
        style={{backgroundImage:'url('+import.meta.env.BASE_URL+'runes/magic-altar-art.webp)'}}>
        <span className="rsim-altar-caption">{en?'Runic altar':'Магический алтарь'}</span>
      </div>
      <div className="rsim-pity"><div className="rsim-pity-top">
       <span>{en?'Guaranteed random legendary every 100 summons':'Гарантированная случайная легендарная каждые 100 призывов'}</span>
       <button type="button" aria-label={en?'How it works':'Правила призыва'} onClick={()=>setShowInfo(!showInfo)}><CircleHelp size={15}/></button>
      </div><div className="rsim-meter"><div style={{width:state.pity+'%'}}/><strong>{state.pity}/100</strong></div>
      {showInfo&&<p>{en?'Duplicates are possible. Other rewards are rune-specific level-up points.':'Повторы возможны. Остальные награды — очки прокачки конкретных рун.'}</p>}</div>
      <div className="rsim-summon-actions">
       {([10,100] as const).map(n=><button type="button" key={n} className={'rsim-summon-btn '+(quantity===n?'rsim-summon-btn--on':'')} aria-pressed={quantity===n} onClick={()=>{setQuantity(n);onSummon(n);}} disabled={state.scrolls<n}>
        <b>{en?'SUMMON':'ПРИЗЫВ'} ×{n}</b><span><ScrollText size={16}/>{n} {en?'scrolls':'свитков'}</span>
       </button>)}
      </div>
      <p className="rsim-inventory"><ScrollText size={16}/>{en?'Test scrolls':'Тестовые свитки'}: <strong>{state.scrolls}</strong> · {en?'Total summons':'Всего призывов'}: {state.summons}</p>
      <div className="rsim-demo-note">{en?'Interactive isolated demo. Odds, scroll prices and rewards will be verified before going live.':'Интерактивный тест без сервера. Шансы, стоимость свитков и выдачу утвердим перед запуском.'}</div>
      <RuneTierStrip language={language}/>
     </>}
   </section>
 </div>;
}
export function RuneUpgradeDemo({language,state,runeId,onUpgrade}:{language:'ru'|'en';state:RuneDemoState;runeId:string;onUpgrade:()=>void}) {
 const en=language==='en',tier=state.rank[runeId]??'blue',cap=RUNE_CAP[tier],level=state.level[runeId]??0,pts=state.points[runeId]??0;
 const blocked=level>=cap,canUpgrade=!blocked&&pts>=100&&state.scrolls>0;
 return <div className="rsim-upgrade-details">
   <div className="rsim-progress-heading"><strong>{en?'RUNE LEVEL':'УРОВЕНЬ РУНЫ'}: {level}/{cap}</strong><span className={'rsim-chip rsim-chip--'+tier}>{en?RUNE_TIER_NAMES[tier].en:RUNE_TIER_NAMES[tier].ru}</span></div>
   <div className="rsim-level-meter"><span style={{width:Math.min(100,level/cap*100)+'%'}}/></div>
   <p className="rsim-level-resource"><Sparkles size={14}/> {pts}/100 {en?'level points':'очков'} · <ScrollText size={14}/> {state.scrolls} {en?'scrolls':'свитков'}</p>
   {blocked&&level<300&&<div className="rsim-level-lock">{en?'Level cap reached. Obtain a matching higher-rarity rune to continue.':'Достигнут предел редкости. Получи руну нужного вида следующей редкости, чтобы продолжить.'}</div>}
   <div className="rsim-upgrade-buttons"><button type="button" disabled={!canUpgrade} onClick={onUpgrade}>{en?'UPGRADE':'УЛУЧШИТЬ'}</button>
    <small>{en?'Preview price: 100 points + 1 scroll. Not final balance.':'Тестовая цена: 100 очков + 1 свиток. Не окончательный баланс.'}</small></div>
   <RuneTierStrip language={language}/>
 </div>;
}