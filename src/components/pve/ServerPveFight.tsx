import { useCallback, useEffect, useRef, useState } from 'react';
import { Flag, Loader2, Shield, Swords, Zap } from 'lucide-react';
import type { Enemy } from '@/game/types';
import type { IdleCombatEvent, IdleCombatState } from '@/game/idleEngine/types';
import { requestCombat, pendingCombatCommand } from '@/game/combatV1/api';
import type { CombatCommand } from '@/game/combatV1/service';
import { useGame } from '@/game/actions';
import { useStore } from '@/game/store';
import { useLanguage } from '@/game/i18n';
import { getCombatAppearance } from '@/game/appearance';
import { resolveCombatArtUrl, getEnemyCombatFrames } from '@/game/combatArt';
import type { StrikeEvent } from '@/game/useStrikeQueue';
import { FighterFigure } from '@/components/arena/FighterFigure';
import type { FightKind } from './PveFight';

interface Props {
  enemy: Enemy; kind: FightKind; encounterId: string;
  sessionId: string | null; onExit: () => void; onNext?: () => void;
}
interface Receipt {
  success: true; session_id: string; revision: number;
  state: IdleCombatState; events?: IdleCombatEvent[]; rewards_claimed: boolean;
}
function validReceipt(value: Record<string, unknown>): value is Record<string, unknown> & Receipt {
  if (value.success !== true || typeof value.session_id !== 'string'
    || !Number.isSafeInteger(value.revision) || typeof value.rewards_claimed !== 'boolean') return false;
  const state = value.state as IdleCombatState | undefined;
  return !!state && state.version === 1 && !!state.actors?.hero?.stats && !!state.actors?.enemy?.stats
    && ['fighting','hero_won','enemy_won','draw'].includes(state.status);
}
function Health({value,max,label}:{value:number;max:number;label:string}){
  const pct=max>0?Math.max(0,Math.min(100,100*value/max)):0;
  return <div className="rounded-lg border border-white/15 bg-black/60 p-2 min-w-0">
    <b className="block text-xs text-amber-100 truncate">{label}</b>
    <div className="h-2 rounded-full bg-red-950 mt-1 overflow-hidden">
      <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-300" style={{width:`${pct}%`}}/>
    </div>
    <small className="block text-right tabular-nums text-white/80">{Math.ceil(value)}/{Math.ceil(max)}</small>
  </div>;
}
/**
 * Real server-operated combat surface. Server is sole authority for HP, moves,
 * rune effects and outcomes. This route must remain gated until an atomic
 * wallet/XP/quest settlement exists; receipts do NOT grant client rewards.
 */
export function ServerPveFight({enemy,kind,encounterId,sessionId,onExit,onNext}:Props){
  const {language}=useLanguage();
  const en=language==='en';
  const game=useStore(useGame);
  const [receipt,setReceipt]=useState<Receipt|null>(null);
  const [log,setLog]=useState<string[]>([]);
  const [fault,setFault]=useState('');
  const [busy,setBusy]=useState(true);
  const [strike,setStrike]=useState<StrikeEvent|null>(null);
  const running=useRef(false),alive=useRef(true),strikeKey=useRef(0);

  const apply=useCallback((result:Record<string,unknown>)=>{
    if(!validReceipt(result))throw Error('combat_invalid_server_receipt');
    if(!alive.current)return;
    setReceipt(result);
    const events=Array.isArray(result.events)?result.events:[];
    if(events.length){
      setLog(old=>[...old,...events.slice(-14).map(event=>{
        const name=event.actor==='hero'?(en?'Hero':'Герой'):enemy.name;
        return `${name}: ${event.type.replace(/_/g,' ')}${event.skillId?' · '+event.skillId:''}${event.runeId?' · '+event.runeId:''}${typeof event.value==='number'?' −'+Math.floor(event.value):''}`;
      })].slice(-16));
      const animation=[...events].reverse().find(event=>['impact','critical','block','dodge'].includes(event.type));
      if(animation){
        const attacker=animation.actor==='hero'?game.player.name:enemy.name;
        const target=animation.target==='hero'?game.player.name:enemy.name;
        setStrike({key:++strikeKey.current,attacker,target,tone:animation.type==='critical'?'crit':animation.type==='block'?'block':animation.type==='dodge'?'dodge':'hit',amount:typeof animation.value==='number'?Math.floor(animation.value):null});
      }
    }
  },[enemy.name,en,game.player.name]);

  const send=useCallback(async(command:CombatCommand)=>{
    if(running.current)return;
    running.current=true;setBusy(true);setFault('');
    try{
      const pending=await pendingCombatCommand();
      if(pending && pending.action==='loadout')throw Error('combat_pending_loadout');
      const authoritative=pending??command;
      const result=await requestCombat(authoritative);
      apply(result);
    }catch{
      if(alive.current)setFault(en?'Server move not confirmed. Retry safely; no local rewards were granted.'
        :'Сервер не подтвердил ход. Можно безопасно повторить: награды локально не выдавались.');
    }finally{running.current=false;if(alive.current)setBusy(false);}
  },[apply,en]);

  useEffect(()=>{
    alive.current=true;
    void(async()=>{
      try{
        const pending=await pendingCombatCommand();
        if(pending&&pending.action==='loadout')throw Error('combat_pending_loadout');
        const command:CombatCommand=pending??(sessionId?
          {action:'resume',sessionId}:{action:'start',operationId:crypto.randomUUID(),encounterId,control:game.settings.auto?'auto':'manual'});
        const result=await requestCombat(command);
        apply(result);
      }catch{
        if(alive.current)setFault(en?'Battle server is unavailable. Return to map and retry.'
          :'Боевой сервер недоступен. Вернись на карту и попробуй снова.');
      }finally{if(alive.current)setBusy(false);}
    })();
    return()=>{alive.current=false;};
  // Route identity is fixed for the lifetime of the mounted battle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[encounterId,sessionId]);

  const tick=useCallback((skillId?:string)=>{
    if(!receipt||receipt.state.status!=='fighting'||busy||running.current)return;
    void send({action:'advance',operationId:crypto.randomUUID(),sessionId:receipt.session_id,
      revision:receipt.revision,...(skillId?{skillId}:{})});
  },[busy,receipt,send]);
  useEffect(()=>{
    if(!receipt||receipt.state.status!=='fighting'||busy)return;
    const timer=window.setInterval(()=>tick(),1500);
    return()=>window.clearInterval(timer);
  },[busy,receipt?.session_id,receipt?.revision,receipt?.state.status,tick]);
  useEffect(()=>{
    if(!strike)return;
    const timer=window.setTimeout(()=>setStrike(null),800);
    return()=>window.clearTimeout(timer);
  },[strike]);

  const state=receipt?.state;
  const hero=state?.actors.hero,foe=state?.actors.enemy;
  const canContinue=!!receipt?.rewards_claimed;
  return <div className="space-y-2 animate-fade-in" data-testid="territory-server-pve-battle">
    <div className="flex items-center gap-2 h-10">
      <button type="button" onClick={onExit} className="h-9 rounded-xl border border-white/15 bg-white/10 px-3 text-xs text-white flex items-center gap-1">
        <Flag size={13}/>{en?'Map':'К карте'}</button>
      <div className="flex-1 text-center min-w-0">
        <p className="text-xs uppercase text-amber-200">{kind==='trial'?(en?'Trial':'Испытание'):(en?'Campaign':'Поход')}</p>
        <b className="block text-sm text-white truncate">{enemy.name}</b>
      </div>
      <span className="text-[10px] rounded-md border border-emerald-500/40 bg-emerald-950/80 p-1 text-emerald-200">{en?'SERVER':'СЕРВЕР'}</span>
    </div>
    <div className="relative overflow-hidden rounded-2xl border border-amber-700/35 bg-[#111f32] min-h-[295px]">
      <img className="absolute inset-0 h-full w-full object-cover opacity-85" alt=""
        src={import.meta.env.BASE_URL+(kind==='trial'?'map-chamber.webp':'assets/territory/scenes/arena-viking.webp')}/>
      <div className="relative grid grid-cols-2 gap-3 p-3 min-h-[295px]">
        <div className="flex flex-col min-w-0">
          <Health label={game.player.name} value={hero?.stats.hp??0} max={hero?.stats.maxHp??1}/>
          <div className="relative flex-1 mt-1">
            <FighterFigure src={import.meta.env.BASE_URL+'assets/territory/characters/heroes/male_viking/idle.webp'}
              combatFrames={getCombatAppearance(game.appearance)} name={game.player.name} dir={1} alive={(hero?.stats.hp??0)>0}
              strike={strike} idleSeconds={3.1} className="absolute right-0 bottom-0 h-[96%] w-full object-contain object-right-bottom"/>
          </div>
        </div>
        <div className="flex flex-col min-w-0">
          <Health label={enemy.name} value={foe?.stats.hp??0} max={foe?.stats.maxHp??1}/>
          <div className="relative flex-1 mt-1">
            <FighterFigure src={resolveCombatArtUrl(enemy.art)} combatFrames={getEnemyCombatFrames(enemy.art)}
              name={enemy.name} dir={-1} alive={(foe?.stats.hp??0)>0} strike={strike}
              idleSeconds={2.8} className="absolute left-0 bottom-0 h-[83%] w-full object-contain object-left-bottom"/>
          </div>
        </div>
      </div>
    </div>
    {hero && state && <div className="rounded-lg border border-white/15 bg-slate-900/90 p-2">
      <div className="flex gap-2 items-center text-xs text-cyan-200 mb-2">
        <Zap size={14}/> {en?'Energy':'Энергия'}: {Math.floor(hero.energy)}/{state.input.rules.maxEnergy}
        <span className="ml-auto text-amber-200">{state.input.control==='auto'?(en?'Auto':'Авто'):(en?'Manual':'Ручной')}</span>
      </div>
      {state.input.control==='manual'&&<div className="grid grid-cols-3 gap-1.5">
        {hero.loadout.skills.map(slot=>{
          const def=state.input.catalog.skills.find(s=>s.id===slot.skillId);
          const rank=def?.levels[slot.level-1];
          const ready=!!rank&&hero.energy>=rank.energyCost&&(hero.cooldowns[slot.skillId]??0)<=state.atMs;
          return <button type="button" key={slot.skillId} disabled={!ready||busy||state.status!=='fighting'}
            onClick={()=>tick(slot.skillId)} className="min-h-12 rounded-lg border border-cyan-400/40 bg-cyan-900/40 px-1 text-[10px] font-semibold text-cyan-100 disabled:opacity-40">
            <Swords size={15} className="mx-auto mb-1"/>{slot.skillId.replace(/_/g,' ')}
          </button>;
        })}
      </div>}
      {state.input.control==='auto'&&state.status==='fighting'&&<p className="text-center text-xs text-cyan-200">
        <Loader2 size={13} className="inline animate-spin mr-1"/>{en?'Server runs equipped skills and runes automatically.':'Сервер сам применяет выбранные навыки и руны.'}</p>}
    </div>}
    {busy&&!receipt&&<p className="text-center text-xs text-amber-200"><Loader2 className="inline animate-spin" size={14}/> {en?'Connecting battle…':'Подключаем бой…'}</p>}
    {!!fault&&<div className="rounded-lg border border-red-400/40 bg-red-950/50 p-2 text-xs text-red-100" role="alert">{fault}
      <button type="button" className="block mt-2 rounded bg-amber-600 px-3 py-1.5" onClick={()=>tick()} disabled={busy||!receipt}>
        {en?'Retry saved move':'Повторить ход'}</button></div>}
    {state&&state.status!=='fighting'&&<div className="rounded-xl bg-slate-900 p-3 text-center text-amber-100">
      <Shield className="mx-auto mb-1" size={20}/>
      <b>{state.status==='hero_won'?(en?'Victory':'Победа'):(en?'Battle ended':'Бой окончен')}</b>
      <p className="text-xs text-slate-200 mt-1">{canContinue?(en?'Result and rewards verified by server.':'Результат и награды подтверждены сервером.')
        :(en?'Awaiting atomic server reward confirmation. No local gold or XP was granted.':'Ожидается серверное подтверждение награды. Монеты и опыт локально не начислялись.')}</p>
      <div className="flex gap-2 mt-2">
        <button type="button" className="flex-1 rounded-lg bg-slate-700 p-2" onClick={onExit}>{en?'Map':'К карте'}</button>
        {canContinue&&onNext&&<button type="button" className="flex-1 rounded-lg bg-amber-600 p-2" onClick={onNext}>{en?'Next battle':'Следующий бой'}</button>}
      </div>
    </div>}
    {!!log.length&&<div className="rounded-lg border border-white/10 bg-black/40 p-2 text-[10px] text-gray-200 max-h-28 overflow-auto">
      {log.slice(-8).map((entry,i)=><p key={i} className="mb-0.5">{entry}</p>)}
    </div>}
  </div>;
}
