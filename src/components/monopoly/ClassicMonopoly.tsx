import { useCallback, useEffect, useRef, useState } from 'react';
import { Art, Dice } from './visuals';
import { useLanguage } from '@/game/i18n';
import { classic, classicError, classicCellPrice, classicBoardPoint, classicColor, type ClassicData } from './classicApi';
import './monopoly.css';

const cells=Array.from({length:28},(_,i)=>i);
const specials:Record<number,[string,string]>={
 0:['СТАРТ','START'],7:['НАЛОГ','TAX'],14:['СУНДУК','CHEST'],21:['ВЕТЕР','WIND'],
};
export function ClassicMonopoly({onBack}:{onBack:()=>void}){
 const {language}=useLanguage(); const en=language==='en';
 const t=(ru:string,english:string)=>en?english:ru;
 const [data,setData]=useState<ClassicData|null>(null),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[animating,setAnimating]=useState(false);
 const [mode,setMode]=useState<'solo'|'online'>('solo'),[maxSeats,setMaxSeats]=useState(4);
 const [code,setCode]=useState(''),[help,setHelp]=useState(false),[message,setMessage]=useState('');
 const guard=useRef(false),live=useRef(true),snapshot=useRef<ClassicData|null>(null);
 const update=useCallback((next:ClassicData)=>{snapshot.current=next;setData(next);},[]);
 const refresh=useCallback(async()=>{
  if(guard.current)return;
  guard.current=true;
  try{
   const existing=snapshot.current,room=existing?.room;
   const turn=room?.state==='playing'?existing?.players?.find(p=>p.seat===room.turn):null;
   const next=await classic(turn?.bot?'bot':'status');
   if(live.current){update(next);setError('');}
  }catch(err){if(live.current)setError(classicError(err,en));}
  finally{guard.current=false;}
 },[en,update]);
 useEffect(()=>{
  live.current=true;void refresh();
  const timer=window.setInterval(()=>{void refresh();},3500);
  return()=>{live.current=false;window.clearInterval(timer);};
 },[refresh]);
 const perform=async(action:string,roomCode:string|null=null,choice:number|null=null)=>{
  if(guard.current)return;guard.current=true;setBusy(true);setError('');setMessage('');
  try{
   const result=await classic(action,roomCode,choice);
   if(!live.current)return;
   update(result);
   if(['solo','create','join'].includes(action))setMessage(t('1 билет списан. Партия сохранена на сервере.','1 ticket spent. Match saved by server.'));
   if(action==='roll'){setAnimating(true);window.setTimeout(()=>{if(live.current)setAnimating(false);},650);}
   if(action==='leave')setMessage(t('Можешь начать новую партию.','You can start a new match.'));
  }catch(err){if(live.current)setError(classicError(err,en));}
  finally{guard.current=false;if(live.current)setBusy(false);}
 };
 const room=data?.room,players=data?.players??[],properties=data?.properties??[];
 const me=players.find(p=>p.mine),current=players.find(p=>p.seat===room?.turn);
 const myTurn=room?.state==='playing'&&!!me&&!me.bankrupt&&room.turn===me.seat;
 const buying=myTurn&&room.phase==='buy',canRoll=myTurn&&room.phase==='roll';
 const pending=room?.landed??0,price=classicCellPrice(pending);
 const ownProperties=properties.filter(p=>p.owner===me?.seat);
 const playerName=(seat:number)=>players.find(p=>p.seat===seat)?.name??'?';
 return <div className="territory-monopoly mono-classic" data-testid="hall-play-monopoly">
  <header className="mono-header">
   <button className="mono-nav-button" aria-label={t('Назад к играм','Back to games')} onClick={onBack}><span className="mono-back-mark"/></button>
   <div><small>TERRITORY</small><h2>{t('Монополия','Monopoly')}</h2></div>
   <button className="mono-nav-button" aria-label={t('Правила','Rules')} onClick={()=>setHelp(true)}>?</button>
  </header>
  <div className="mono-classic-subtitle"><span>🎲 {t('Классика · 28 клеток','Classic · 28 spaces')}</span><strong>🎟 {data?.tickets??'…'}</strong></div>
  {!room&&<section className="mono-classic-lobby">
   <h3>{t('Выбирай соперников','Choose your opponents')}</h3>
   <p>{t('1 билет на целую партию. Монеты игрового поля не затрагивают основной баланс.','1 ticket per full match. Match coins never affect your hero wallet.')}</p>
   <div className="mono-classic-mode">
    <button type="button" className={mode==='solo'?'selected':''} onClick={()=>setMode('solo')}>🤖 {t('Против ботов','Against bots')}</button>
    <button type="button" className={mode==='online'?'selected':''} onClick={()=>setMode('online')}>🌍 {t('С игроками','Online')}</button>
   </div>
   {mode==='online'&&<div className="mono-classic-room-options"><p>{t('Создай комнату и пригласи друзей по коду.','Create a room and invite friends by code.')}</p>
    <div className="mono-classic-seats">{[2,3,4].map(n=><button key={n} type="button" aria-pressed={maxSeats===n} className={maxSeats===n?'selected':''} onClick={()=>setMaxSeats(n)}>{n}</button>)}</div>
   </div>}
   <button type="button" className="mono-cta mono-classic-primary" disabled={!data||busy||data.tickets<1} onClick={()=>void perform(mode==='solo'?'solo':'create',null,mode==='solo'?null:maxSeats)}>
    {mode==='solo'?t('ИГРАТЬ С БОТАМИ · 1 БИЛЕТ','PLAY BOTS · 1 TICKET'):t('СОЗДАТЬ КОМНАТУ · 1 БИЛЕТ','CREATE ROOM · 1 TICKET')}
   </button>
   {mode==='online'&&<div className="mono-classic-join"><label htmlFor="mono-code">{t('Код комнаты друга','Friend’s room code')}</label>
    <div><input id="mono-code" maxLength={6} autoComplete="off" value={code} placeholder="A1B2C3"
     onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-F0-9]/g,''))}/>
    <button type="button" disabled={busy||code.length!==6||!data?.tickets} onClick={()=>void perform('join',code)}>{t('Войти · 1 🎟','Join · 1 🎟')}</button></div>
   </div>}
   {(data?.tickets??0)<1&&<p className="mono-classic-warning">{t('Нет билетов. Забери ежедневные в игровом зале.','No tickets. Collect daily tickets in the Game Hall.')}</p>}
  </section>}
  {room?.state==='lobby'&&<section className="mono-classic-lobby">
   <h3>{t('Комната создана','Room created')}</h3><p>{t('Передай друзьям код комнаты.','Share this room code with friends.')}</p>
   <div className="mono-classic-code"><strong>{room.code}</strong><small>{t('Код из 6 символов','6-character code')}</small></div>
   <p>{t('Игроков','Players')}: <b>{players.length}/{room.seats}</b></p>
   <div className="mono-classic-players">{players.map(p=><div key={p.seat}><i style={{background:classicColor(p.seat)}}/>{p.name}{p.mine?' ★':''}</div>)}</div>
   {room.host?<button className="mono-cta mono-classic-primary" disabled={busy||players.length<2} onClick={()=>void perform('start')}>{t('НАЧАТЬ ПАРТИЮ','START MATCH')}</button>:
    <p className="mono-classic-warning">{t('Ждём начала игры.','Waiting for the host.')}</p>}
   <button className="mono-classic-secondary" disabled={busy} onClick={()=>void perform('leave')}>{t('Выйти · вернуть билет','Leave · refund ticket')}</button>
  </section>}
  {(room?.state==='playing'||room?.state==='finished')&&<>
   <div className="mono-classic-status" aria-live="polite">
    <b>{room.state==='finished'?t('ПАРТИЯ ЗАВЕРШЕНА','MATCH COMPLETE'):myTurn?t('ТВОЙ ХОД','YOUR TURN'):current?.bot?t('ХОД БОТА','BOT TURN'):t('ХОД СОПЕРНИКА','OPPONENT TURN')}</b>
    <span>{room.state==='finished'?t('Итоги ниже','Results below'):current?.name}</span>
    <small>{t('Ход','Turn')} {room.turns+1} · 🎲 {room.last_roll??'—'}</small>
   </div>
   <div className="mono-scene mono-classic-scene" style={{backgroundImage:'url("'+import.meta.env.BASE_URL+'monopoly/lagoon.png")'}}>
    <div className="mono-water-shimmer"/>
    <img className="mono-scene-ship" src={import.meta.env.BASE_URL+'monopoly/ship.webp'} alt={t('Корабль в лагуне','Ship in the lagoon')}/>
    <div className="mono-board mono-classic-board" aria-label={t('Игровое поле из 28 клеток','28-space board')}>
     {cells.map(i=>{
      const loc=classicBoardPoint(i),prop=properties.find(p=>p.cell===i),special=specials[i],basePrice=classicCellPrice(i);
      return <div key={i} className={'mono-cell mono-classic-cell'+(prop?' owned':'')+(i===current?.position?' current':'')}
       style={{left:loc.x+'%',top:loc.y+'%',borderColor:prop?classicColor(prop.owner):undefined}}
       title={special?(en?special[1]:special[0]):t('Цена','Price')+' '+basePrice}
       aria-label={t('Клетка','Space')+' '+i}>
       <Art name={special?i===0?'start':i===14?'chest':'mystery':'tile'} className="mono-cell-base"/>
       <b className="mono-classic-number">{i}</b>
       <small className="mono-classic-cell-price">{special?(en?special[1]:special[0]):basePrice}</small>
       {prop&&<i className="mono-classic-owner" style={{background:classicColor(prop.owner)}}/>}
       {!!prop?.houses&&<span className="mono-classic-houses">{'🏠'.repeat(prop.houses)}</span>}
      </div>;
     })}
     {players.filter(p=>!p.bankrupt).map(p=>{
      const loc=classicBoardPoint(p.position);
      return <span key={p.seat} className={'mono-classic-token'+(p.mine?' mine':'')}
       style={{left:'calc('+loc.x+'% + '+((p.seat%2)*13-6)+'px)',top:'calc('+loc.y+'% + '+(Math.floor(p.seat/2)*14-9)+'px)',
        borderColor:classicColor(p.seat),background:classicColor(p.seat)}}
       title={p.name} aria-label={p.name+': '+t('клетка','space')+' '+p.position}>{p.seat+1}</span>;
     })}
    </div><div className="mono-classic-board-label">{t('Острова и гавани','Islands & Harbors')}</div>
   </div>
   <section className="mono-classic-turn"><p role="status">{room.last_event||t('Бросай кубики и покупай острова!','Roll dice and buy islands!')}</p>
    {room.state==='playing'&&<>
     {buying?<div className="mono-classic-decision"><strong>{t('Купить участок','Buy property')} №{pending} · {price} 🪙</strong>
      <div><button disabled={busy} onClick={()=>void perform('buy')}>{t('КУПИТЬ','BUY')}</button>
      <button disabled={busy} onClick={()=>void perform('pass')}>{t('Пропустить','Skip')}</button></div>
     </div>:<button className="mono-cta mono-classic-roll" disabled={!canRoll||busy||animating}
      onClick={()=>void perform('roll')}><Dice value={((room.last_roll??5)-1)%6+1}/>
      {animating?'🎲':canRoll?t('БРОСИТЬ КУБИКИ','ROLL DICE'):current?.bot?t('БОТ ИГРАЕТ…','BOT PLAYING…'):t('ОЖИДАНИЕ ХОДА','WAITING…')}
     </button>}
     {!!ownProperties.length&&room.turn===me?.seat&&room.phase==='roll'&&<div className="mono-classic-build">
      <h4>{t('Твои участки · строй дома','Your properties · build houses')}</h4>
      <div>{ownProperties.map(p=><button key={p.cell} disabled={busy||p.houses>=3||!canRoll||!me||me.cash<Math.floor(p.price/2)}
       onClick={()=>void perform('build',null,p.cell)}>🏠 #{p.cell} · {p.houses}/3 · {Math.floor(p.price/2)} 🪙</button>)}</div>
     </div>}
    </>}
   </section>
   <section className="mono-classic-standings"><h3>{t('Участники','Players')}</h3>
    <div>{players.map(p=><article key={p.seat} className={(p.mine?'mine ':'')+(p.bankrupt?'out':'')}>
     <i style={{background:classicColor(p.seat)}}/><span><b>{p.name} {p.bot?'🤖':''}</b>
      <small>{t('Клетка','Space')} {p.position} · {t('Участков','Properties')}: {properties.filter(x=>x.owner===p.seat).length}</small></span>
      <strong>{p.bankrupt?t('Банкрот','Out'):(p.cash+' 🪙')}</strong>
     </article>)}</div>
   </section>
   {room.state==='finished'?<section className="mono-classic-result">
    <h3>🏆 {t('Победитель','Winner')}: {playerName(room.winner??0)}</h3>
    <p>{room.winner===me?.seat?t('До 50 золота ожидает в игровом зале.','Up to 50 gold awaits in the Hall.'):t('Следующая партия может сложиться иначе!','Better luck next time!')}</p>
    <button className="mono-cta" disabled={busy} onClick={()=>void perform('leave')}>{t('ЗАВЕРШИТЬ И ИГРАТЬ СНОВА','FINISH & PLAY AGAIN')}</button>
   </section>:<button className="mono-classic-secondary" disabled={busy}
    onClick={()=>{if(window.confirm(t('Сдаться и завершить участие?','Resign and leave this match?')))void perform('resign');}}>{t('Сдаться','Resign')}</button>}
  </>}
  {!data&&!error&&<p className="mono-classic-warning">{t('Загружаем партию…','Loading match…')}</p>}
  {message&&<p className="mono-note" role="status">{message}</p>}
  {error&&<div className="mono-error" role="alert">{error} <button disabled={busy} onClick={()=>void refresh()}>{t('Обновить','Refresh')}</button></div>}
  {help&&<div className="mono-overlay" role="dialog" aria-modal="true" aria-label={t('Правила','Rules')}
   onClick={()=>setHelp(false)}><section className="mono-panel mono-classic-rules" onClick={e=>e.stopPropagation()}>
    <header><Art name="dice"/><h3>{t('Правила Монополии','Monopoly rules')}</h3><button autoFocus className="mono-close" onClick={()=>setHelp(false)} aria-label={t('Закрыть','Close')}>×</button></header>
    <div className="mono-panel-body">
     <p>{t('Поле из 28 клеток. 1 билет открывает партию с 3 ботами или 1–3 друзьями. Каждый начинает с 750 монет игры.','28 spaces. One ticket starts a match with three bots or 1–3 friends. Everyone starts with 750 game coins.')}</p>
     <p>{t('Бросай кубики, покупай свободные острова и получай аренду. Строй до трёх домов на участке, повышая аренду.','Roll dice, buy properties, collect rent. Build up to three houses to increase rent.')}</p>
     <p>{t('За проход через старт +120. Налог, сундук и ветер дают события. Последний оставшийся или самый богатый после 120 ходов побеждает.','Pass START for 120. Tax, chest and wind provide special events. Last standing or richest after 120 turns wins.')}</p>
     <p>{t('Монеты партии НЕ являются золотом героя. Победителю — до 50 золота в игровой зал, дневной лимит 1000.','Match coins are NOT hero gold. Winner receives up to 50 Hall gold, under the 1,000 daily cap.')}</p>
     <button className="mono-cta" onClick={()=>setHelp(false)}>{t('ПОНЯТНО','GOT IT')}</button>
    </div>
   </section></div>}
 </div>;
}
