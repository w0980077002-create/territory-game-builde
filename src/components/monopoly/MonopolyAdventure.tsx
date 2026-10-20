import { useEffect, useRef, useState } from 'react';
import { DailyShareCard } from '@/game/DailyShareCard';
import { calendarDayKey } from '@/game/weeklyQuests';
import { IosGamePortal } from '@/components/ui/Modal';
import {Art,Dice,type ArtName} from './visuals';
import { useLanguage } from '@/game/i18n';
import { autoClaimHallGold, hallError } from '@/game/gameHall';
import { monopoly, boardPoint, cellGold, cellPrize, bundlePrize, prizeLabels, claimMonopolyRewards, type Prize, type MonopolyData, type MonopolyQuestion } from './api';
import './monopoly.css';
const milestones=[5,10,15,20,25];
const faces=[1,2,3,4,5,6];
type Panel='rewards'|'gifts'|'quests'|'offers'|'help'|'jackpot'|null;
const eventCopy:Record<string,[string,string,string,string]>={
 gift:['Сокровище лагуны','Ещё 25 золота к награде клетки!','Lagoon treasure','25 extra gold added to the cell prize!'],
 teleport:['Портал прилива','Перемещение ещё на 3 клетки вперёд.','Tidal portal','Move another 3 spaces forward.'],
 double:['Шаг по облакам','Следующий бросок переместит героя вдвое дальше.','Cloud step','Your next roll moves the hero twice as far.'],
 lucky:['Руна удачи','Выбери число на кубике для следующего хода.','Lucky rune','Choose the dice value on your next turn.'],
};
function Prizes({prize,en}:{prize?:Prize;en:boolean}){
 return <div className="mono-extra-rewards">{Object.entries(prize??{}).filter(([,n])=>n>0).map(([key,n])=><span className="mono-resource" key={key} role="img" aria-label={`${prizeLabels[key as keyof Prize][en?1:0]} +${n}`}><Art name={key as keyof Prize}/><b>+{n}</b><small>{prizeLabels[key as keyof Prize][en?1:0]}</small></span>)}</div>;
}
function MonopolyClock({end,en}:{end?:string;en:boolean}){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{
  const id=window.setInterval(()=>setNow(Date.now()),1000);
  return ()=>window.clearInterval(id);
 },[]);
 const remaining=Math.max(0,Date.parse(end??'')-now)||0;
 const duration=`${Math.floor(remaining/86400000)}${en?'d':'д'} ${String(Math.floor(remaining/3600000)%24).padStart(2,'0')}:${String(Math.floor(remaining/60000)%60).padStart(2,'0')}:${String(Math.floor(remaining/1000)%60).padStart(2,'0')}`;
 return <strong>{end?duration:'…'}</strong>;
}
function monopolyError(e:unknown,en:boolean){
 const t=(ru:string,english:string)=>en?english:ru;
  const msg=e instanceof Error?e.message:'';
  if(msg.includes('monopoly_reload_required'))return t('Сохранение изменилось. Перезапусти игру и повтори получение; награды сохранятся.','Your save changed. Reload and collect again; rewards are retained.');
  if(msg.includes('monopoly_nothing_to_claim'))return t('Эти награды уже получены.','These rewards have already been collected.');
  if(msg.includes('monopoly_test_only'))return t('Закрытое тестирование: этот аккаунт ещё не приглашён.','Closed test: this account has not been invited yet.');
  if(/territory_monopoly_v2|schema cache/.test(msg))return t('Обновление Монополии ещё не установлено на сервере.','The Monopoly server update has not been installed yet.');
  if(msg.includes('monopoly_already_claimed'))return t('Эта награда уже получена.','This reward has already been claimed.');
  if(msg.includes('monopoly_not_ready'))return t('Сначала выполни условие награды.','Complete the reward requirement first.');
  if(msg.includes('monopoly_other_game'))return t('Заверши текущую игру в зале.','Finish your current game in the hall.');
  return hallError(e,en);
}
export function MonopolyAdventure({onBack,userId}:{onBack:()=>void;userId:string}){
 const {language}=useLanguage(),en=language==='en';
 const [data,setData]=useState<MonopolyData|null>(null),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[moving,setMoving]=useState(false),[position,setPosition]=useState(0);
 const [face,setFace]=useState(5),[fast,setFast]=useState(false),[ten,setTen]=useState(false);
 const [panel,setPanel]=useState<Panel>(null),[reward,setReward]=useState<{gold?:number;tickets?:number;event?:string;awards?:Prize}|null>(null);
 const [today,setToday]=useState(()=>calendarDayKey(Date.now())),[notice,setNotice]=useState('');
 const lock=useRef(false),mounted=useRef(true),generation=useRef(0);
 const statusDay=useRef(today);
 const diceButton=useRef<HTMLButtonElement>(null);
 const t=(ru:string,english:string)=>en?english:ru;
 const p=data?.progress,h=data?.hall;
 const active=h?.active?.game==='monopoly'?h.active:null;
 useEffect(()=>{
  mounted.current=true;
  const epoch=++generation.current;
  // Refresh daily calendar once a minute: the 28-cell board must not re-render every second.
  const timer=window.setInterval(()=>setToday(calendarDayKey(Date.now())),60000);
  void monopoly().then(d=>{if(mounted.current){setData(d);setPosition(d.hall.active?.game==='monopoly'?(d.hall.active.question.old_position??d.hall.position):d.hall.position);}}).catch(e=>{if(mounted.current)setError(monopolyError(e,en));});
  return()=>{mounted.current=false;generation.current=epoch+1;window.clearInterval(timer);};
 },[en]);
 useEffect(()=>{if(!panel&&!reward)return;const handle=(e:KeyboardEvent)=>{if(e.key==='Escape'){setPanel(null);setReward(null);}};window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);},[panel,reward]);
 useEffect(()=>{
  if(!panel&&!reward)return;
  const previous=document.activeElement as HTMLElement|null;
  const onTab=(event:KeyboardEvent)=>{
   if(event.key!=='Tab')return;
   const dialog=document.querySelector('.mono-overlay');
   const controls=dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
   if(!controls?.length)return;
   const first=controls[0],last=controls[controls.length-1];
   if(event.shiftKey&&(document.activeElement===first||!dialog?.contains(document.activeElement))){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!dialog?.contains(document.activeElement))){event.preventDefault();first.focus();}
  };
  window.addEventListener('keydown',onTab);
  return()=>{window.removeEventListener('keydown',onTab);previous?.focus();};
 },[panel,reward]);

 const describe=(e:unknown)=>monopolyError(e,en);
 // Revision-checked payouts. Failed credits remain in the protected server ledger.
 const settleWinnings=async(d:MonopolyData)=>{
  let gold=0,items=false,unpaid=false;
  if(d.hall.pending_gold>0){
   try{gold=await autoClaimHallGold(userId,d.hall.pending_gold);}
   catch{unpaid=true;}
  }
  if(Object.values(d.progress.pending_rewards).some(n=>n>0)){
   try{
    await claimMonopolyRewards();
    items=true;
    if(mounted.current)setData(current=>current?{...current,progress:{...current.progress,pending_rewards:{}}}:current);
   }catch{unpaid=true;}
  }
  if(!mounted.current)return;
  if(unpaid)setNotice(t('Награды сохранены на сервере. Повторим зачисление при следующем входе.','Rewards are safely saved. We will retry crediting on your next visit.'));
  else if(gold>0||items)setNotice(t('Выигрыш автоматически зачислен персонажу!','Prizes were automatically credited to your hero!'));
 };
 const request=async(action:string,value=1)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{const d=await monopoly(action,value);if(!mounted.current)return;setData(d);
   await settleWinnings(d);
   if(action==='gift'){setReward({tickets:2,awards:d.awards});setPanel(null);}
   else if(d.added){setReward({tickets:d.added,awards:d.awards});setPanel(null);}
  }catch(e){if(mounted.current)setError(describe(e));}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 };

 // Claimed in order and always checked by the server; no speculative prizes.
 const claimAllReady=async(kind:'quest'|'offer')=>{
  if(lock.current||!data)return;
  lock.current=true;setBusy(true);setError('');
  let last=data;let sum=0;const aggregated:Prize={};
  const target=(i:number)=>kind==='quest'?([5,3,1][i]):([0,3,10][i]);
  const progress=(i:number,d:MonopolyData)=>kind==='quest'
   ?([d.progress.rolls,d.progress.events,d.progress.laps][i])
   :([d.progress.rolls,d.progress.laps,d.progress.rolls][i]);
  try{
   for(let i=0;i<3;i++){
    if(last.progress.claimed.includes(`${kind}:${i+1}`)||progress(i,last)<target(i))continue;
    last=await monopoly(kind,i+1);
    sum+=last.added??0;
    for(const [key,value] of Object.entries(last.awards??{}))aggregated[key as keyof Prize]=(aggregated[key as keyof Prize]??0)+value;
    if(mounted.current)setData(last);
   }
   if(mounted.current&&sum>0){setPanel(null);setReward({tickets:sum,awards:aggregated});}
    await settleWinnings(last);
  }catch(e){if(mounted.current){if(sum>0){setPanel(null);setReward({tickets:sum,awards:aggregated});}setError(describe(e));}}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 };
 const goToDice=()=>{setPanel(null);window.requestAnimationFrame(()=>diceButton.current?.focus());};
 const roll=async(value=ten?10:1)=>{
  if(lock.current||!data)return;lock.current=true;setBusy(true);setMoving(true);setError('');setReward(null);
  const currentGeneration=generation.current;
  const alive=()=>mounted.current&&generation.current===currentGeneration;
  const pause=(ms:number)=>new Promise<void>(resolve=>window.setTimeout(resolve,ms));
  try{
   const d=active?data:await monopoly('roll',value);
   if(!alive())return;
   setData(d);
   const session=d.hall.active;
   if(!session||session.game!=='monopoly')throw new Error('monopoly_other_game');
   const turn=session.question as MonopolyQuestion;
   const steps=turn.steps??turn.roll??1;
   setPosition(turn.old_position??0);
   if(!fast&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    for(let tick=0;tick<5;tick++){if(!alive())return;setFace(tick%6+1);await pause(45);}
    if(!alive())return;setFace(turn.roll??1);await pause(90);
    for(let step=1;step<=steps;step++){if(!alive())return;setPosition(((turn.old_position??0)+step)%28);await pause(70);}
   }
   if(!alive())return;setFace(turn.roll??1);setPosition(turn.new_position??0);
   const finished=await monopoly('finish',1,session.token);
   if(!alive())return;
   setData(finished);setReward({gold:finished.result?.earned_gold??0,event:finished.result?.event,awards:finished.result?.awards});
   await settleWinnings(finished);
  }catch(e){if(alive())setError(describe(e));}
  finally{lock.current=false;if(alive()){setBusy(false);setMoving(false);}}
 };
 const redeem=async()=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   const awards=await claimMonopolyRewards();
   if(!mounted.current)return;
   // The credit is committed to the game state; do not restart the Mini App.
   setData(current=>current?{...current,progress:{...current.progress,pending_rewards:{}}}:current);
   setNotice(t('Сокровища в инвентаре!','Treasures added to inventory!'));
   setReward({awards});
   try{const refreshed=await monopoly();if(mounted.current)setData(refreshed);}
   catch{ /* No second award request: the previous claim already succeeded. */ }
  }catch(e){if(mounted.current)setError(describe(e));}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 };
 // Initial state is already loaded by monopoly() above. Refresh only when the
 // calendar day actually changes; avoid two simultaneous startup RPC calls.
 useEffect(()=>{
  if(today===statusDay.current)return;
  statusDay.current=today;
  if(mounted.current)void request('status');
 },[today]);
 const point=boardPoint(position);
 const claimed=(key:string)=>p?.claimed.includes(key)??false;
 const disabled=busy||!data;
 const quests=[{ru:'Сделай 5 бросков',en:'Roll 5 times',current:p?.rolls??0,target:5,reward:2},{ru:'Открой 3 события',en:'Discover 3 events',current:p?.events??0,target:3,reward:2},{ru:'Пройди полный круг',en:'Complete a lap',current:p?.laps??0,target:1,reward:3}];
 const offers=[{ru:'Приветствие хранителя',en:'Guardian’s welcome',current:p?.rolls??0,target:0,reward:1},{ru:'Мастер трёх кругов',en:'Three-lap master',current:p?.laps??0,target:3,reward:2},{ru:'Десять приключений',en:'Ten adventures',current:p?.rolls??0,target:10,reward:3}];

 const milestoneArt:ArtName[]=['chest','gift','gems','openChest','crown'];
 const readyQuests=quests.filter((v,i)=>v.current>=v.target&&!claimed(`quest:${i+1}`)).length;
 const readyOffers=offers.filter((v,i)=>v.current>=v.target&&!claimed(`offer:${i+1}`)).length;
 const resetTime='00:00';
 const quickPanels=[{key:'gifts' as const,art:'gift' as const,ru:'Подарки',en:'Gifts',count:h?.free_ready?1:0},{key:'quests' as const,art:'quests' as const,ru:'Задания',en:'Quests',count:readyQuests},{key:'offers' as const,art:'chest' as const,ru:'Предложения',en:'Offers',count:readyOffers}];

 const panelTitle=panel==='rewards'?t('Награды за круги','Lap rewards'):panel==='gifts'?t('Подарки лагуны','Lagoon gifts'):panel==='quests'?t('Задания Монополии','Monopoly quests'):panel==='offers'?t('Спецпредложения','Special offers'):panel==='jackpot'?t('Джекпот','Jackpot'):t('Правила приключения','Adventure rules');
 return <div className="territory-monopoly" data-testid="hall-play-monopoly">
  <header className="mono-header">
   <button className="mono-nav-button" aria-label={t('Вернуться в игры','Back to games')} onClick={onBack}><span className="mono-back-mark"/></button>
   <div><small>TERRITORY</small><h2>{t('Монополия','Monopoly')}</h2></div>
   <button className="mono-nav-button" aria-label={t('Правила','Rules')} onClick={()=>setPanel('help')}>?</button>
  </header>
  <div className="mono-clock"><span>{t('ЛАГУНА СОКРОВИЩ','TREASURE LAGOON')}</span><strong><MonopolyClock end={p?.ends_at} en={en}/></strong><button type="button" className="mono-jackpot-link" onClick={()=>setPanel('jackpot')}><Art name="openChest"/>{t('Джекпот','Jackpot')}</button></div>
  <nav className="mono-milestones" aria-label={t('Награды за круги','Lap rewards')}>
   {milestones.map((lap,i)=><button key={lap} aria-label={t(`Награды за ${lap} кругов`,`Rewards for ${lap} laps`)} onClick={()=>setPanel('rewards')} className={claimed(`milestone:${lap}`)?'claimed':''}><small>{t('Круг','Lap')} {lap}</small><Art name={milestoneArt[i]}/><strong>{claimed(`milestone:${lap}`)?t('Получено','Claimed'):`${lap/5+1}`}<Art name="ticket"/></strong></button>)}
  </nav>
  <div className="mono-scene" style={{backgroundImage:`url("${import.meta.env.BASE_URL}monopoly/lagoon.${import.meta.env.DEV?'png':'webp'}")`}}>
   <div className="mono-water-shimmer"/><div className="mono-fairy-lights">{Array.from({length:8},(_,i)=><i key={i} style={{left:`${14+i*11}%`,top:`${30+i%3*18}%`,animationDelay:`${i*.6}s`}}/>)}</div>
   <img className="mono-scene-ship" src={`${import.meta.env.BASE_URL}monopoly/ship.webp`} alt={t('Корабль TERRITORY в центре лагуны','TERRITORY ship at the heart of the lagoon')}/>
   <div className="mono-board" aria-label={t('Поле из 28 клеток','Board of 28 spaces')}>
    {Array.from({length:28},(_,i)=>{const pos=boardPoint(i),mystery=[6,14,21].includes(i),prize=cellPrize(i,ten?10:1),kind=Object.keys(prize)[0] as keyof Prize|undefined;return <div key={i} data-cell-index={i} aria-label={t(`Клетка ${i+1}`,`Space ${i+1}`)} className={`mono-cell ${position===i?'current':''}`} style={{left:`${pos.x}%`,top:`${pos.y}%`}} title={i===0?t('Старт · 100 золота','Start · 100 gold'):mystery?t('Случайное событие','Random event'):`${cellGold(i)} ${t('золота','gold')}`}>
     <Art name={i===0?'start':mystery?'mystery':'tile'} className="mono-cell-base"/>
     {i!==0&&!mystery&&<Art name={kind??'gold'} className="mono-cell-prize"/>}
     <small className="mono-cell-amount">{i===0?t('СТАРТ','START'):mystery?'?':kind?prize[kind]:cellGold(i)*(ten?10:1)}</small>
    </div>;})}
    <div className={`mono-hero ${moving?'moving':''}`} style={{left:`${point.x}%`,top:`${point.y}%`}} aria-label={t(`Герой на клетке ${position+1}`,`Hero on space ${position+1}`)}><div className="mono-hero-ring"/><span className="mono-hero-sprite" style={{backgroundImage:`url("${import.meta.env.BASE_URL}monopoly/hero-frames.${import.meta.env.DEV?'png':'webp'}")`}}/></div>
   </div>
   <div className="mono-lap-plaque">{t('КРУГ','LAP')} <b>{p?.laps??0}</b></div>
   <div className="mono-buffs">{p?.double_next&&<span><Art name="elixirs"/>{t('Следующий ход ×2','Next move ×2')}</span>}{p?.lucky_next&&<span><Art name="gems"/>{t('Выбор кубика','Choose your roll')}</span>}</div>
  <nav className="mono-scene-shortcuts" aria-label={t('Быстрые действия Монополии','Monopoly quick actions')}>
   {([{panel:'offers',art:'chest',ru:'Спецпредложения',en:'Offers',badge:!claimed('offer:1')},{panel:'gifts',art:'gift',ru:'Подарки',en:'Gifts',badge:h?.free_ready},{panel:'quests',art:'quests',ru:'Задания',en:'Quests',badge:quests.some((v,i)=>v.current>=v.target&&!claimed(`quest:${i+1}`))}] as const).map(item=><button type="button" key={item.panel} data-shortcut={item.panel} onClick={()=>setPanel(item.panel)} aria-label={en?item.en:item.ru}><Art name={item.art}/><span>{en?item.en:item.ru}</span>{item.badge&&<i aria-hidden="true"/>}</button>)}
  </nav>
  </div>
  <section className="mono-controls">
   <div className="mono-roll-row"><div className="mono-wallet"><Art name="ticket"/><span><small>{t('БИЛЕТЫ','TICKETS')}</small><b>{h?.tickets??'—'}</b></span><button aria-label={t('Получить билеты','Get tickets')} onClick={()=>setPanel('gifts')}>+</button></div>
    <button ref={diceButton} className={`mono-dice ${moving?'rolling':''}`} disabled={disabled||(!active&&(h?.tickets??0)<(ten?10:1))||!!(h?.active&&h.active.game!=='monopoly')} onClick={()=>void roll()} aria-label={active?t('Продолжить бросок','Resume roll'):t('Бросить кубик','Roll dice')}><span className="mono-dice-glow"/><Dice value={face}/><span className="mono-dice-cta">{moving?t('Ход…','Moving…'):active?t('Продолжить','Resume'):t(`БРОСИТЬ · ${ten?10:1}`,`ROLL · ${ten?10:1}`)}</span></button>
   </div>
   <div className="mono-toggles"><div className="mono-multiplier" role="group" aria-label={t('Множитель награды','Reward multiplier')}><button type="button" aria-pressed={!ten} className={!ten?'selected':''} disabled={busy||!!active} onClick={()=>setTen(false)}>×1</button><button type="button" aria-pressed={ten} className={ten?'selected':''} disabled={busy||!!active} onClick={()=>setTen(true)}>×10</button></div><label className="mono-skip"><input type="checkbox" checked={fast} disabled={busy} onChange={e=>setFast(e.target.checked)}/>{t('Пропустить анимацию','Skip animation')}</label></div>
  </section>
  <div className="mono-after-scene">
   {p?.lucky_next&&!active&&<div className="mono-choose"><small>{t('Выбери число — 1 билет','Choose a value — 1 ticket')}</small><div>{faces.map((n,i)=><button disabled={disabled||!h?.tickets} key={n} onClick={()=>void roll(101+i)} aria-label={String(n)}><Dice value={n}/></button>)}</div></div>}
   {Object.values(p?.pending_rewards??{}).some(n=>n>0)&&<div className="mono-pending"><b>{t('Твои сокровища','Your treasures')}</b><Prizes prize={p?.pending_rewards} en={en}/><button className="mono-cta" disabled={busy} onClick={()=>void redeem()}>{t('Получить награды','Collect rewards')}</button></div>}
  </div>
  <p className="mono-note" aria-live="polite">{notice||t('Награды начисляются персонажу автоматически','Prizes are credited to your hero automatically')}</p>
  {h?.active&&h.active.game!=='monopoly'&&<button className="mono-cta" onClick={onBack}>{t('Завершить другую игру в зале','Finish the other game in the hall')}</button>}
  {error&&<div className="mono-error" role="alert">{error}<button disabled={busy} onClick={()=>void request('status')}>{t('Обновить','Refresh')}</button></div>}
  {panel&&<IosGamePortal><div className="mono-overlay" role="dialog" aria-modal="true" aria-labelledby="mono-panel-title" onClick={()=>setPanel(null)}><section className={`mono-panel panel-${panel}`} onClick={e=>e.stopPropagation()}>

   <header><Art name={panel==='gifts'?'gift':panel==='quests'?'quests':panel==='offers'?'chest':'crown'}/><h3 id="mono-panel-title">{panelTitle}</h3><button autoFocus className="mono-close" aria-label={t('Закрыть','Close')} onClick={()=>setPanel(null)}><span/></button></header>
   {['rewards','help','jackpot'].includes(panel)&&<button type="button" autoFocus className="mono-panel-return" onClick={()=>setPanel(null)}>{t('← В Монополию','← Back to Monopoly')}</button>}
   {['gifts','quests','offers'].includes(panel)&&<><nav className="mono-panel-tabs" aria-label={t('Разделы Монополии','Monopoly sections')}>{quickPanels.map(item=><button type="button" key={item.key} aria-current={panel===item.key?'page':undefined} onClick={()=>{setPanel(item.key);setError('');}}><Art name={item.art}/><span>{en?item.en:item.ru}</span>{item.count>0&&<b>{item.count}</b>}</button>)}</nav>
    <div className="mono-panel-status"><span><Art name="ticket"/> {h?.tickets??'—'}</span><span>{panel==='gifts'?t(`Обновление в ${resetTime}`,`Resets at ${resetTime}`):panel==='quests'?t(`Можно забрать: ${readyQuests}`,`Ready to claim: ${readyQuests}`):t(`Доступно: ${readyOffers}`,`Available: ${readyOffers}`)}</span><button type="button" disabled={busy} onClick={()=>void request('status')}>{t('Обновить','Refresh')}</button></div>
   </>}
   <div className="mono-panel-body">{error&&<p className="mono-error" role="alert">{error}</p>}
    {panel==='rewards'&&<><p>{t('Каждый круг приближает тебя к сокровищам. Каждая награда доступна один раз.','Each lap brings you closer to treasure. Each reward can be collected once.')}</p>{milestones.map((lap,i)=><article className="mono-reward-row" key={lap}><Art name={milestoneArt[i]} className="mono-prize-icon"/><div><b>{t('Круги','Laps')} {i*5+1}–{lap}</b><small>{Math.min(p?.laps??0,lap)}/{lap} · {lap/5+1} {t('билетов','tickets')}</small><Prizes prize={bundlePrize('milestone',lap)} en={en}/></div><button disabled={disabled||(p?.laps??0)<lap||claimed(`milestone:${lap}`)} onClick={()=>void request('milestone',lap)}>{claimed(`milestone:${lap}`)?t('Получено','Claimed'):t('Забрать','Claim')}</button></article>)}</>}
    {panel==='gifts'&&<><div className="mono-banner"><Art name="gift"/><div><small>{t('ДАР ХРАНИТЕЛЯ','GUARDIAN’S GIFT')}</small><b>{t('Ежедневные сокровища','Daily treasures')}</b><span>{t('Бесплатно • обновляется каждый день','Free • renewed daily')}</span></div></div><article className="mono-gift-card"><Art name="openChest"/><div className="mono-gift-info"><h4>{t('Подарок дня','Daily gift')}</h4><div className="mono-gift-items"><span><Art name="ticket"/><b>2</b></span><span><Art name="potions"/><b>1</b></span></div><button className="mono-cta" disabled={disabled||!h?.free_ready} onClick={()=>void request('gift')}>{h?.free_ready?t('ЗАБРАТЬ БЕСПЛАТНО','COLLECT FREE'):(h?.tickets??0)>18?t('Сначала потрать билеты','Use tickets first'):t('Уже получено','Already collected')}</button></div></article><p className="mono-gift-foot">{t('Один подарок на весь игровой зал. Доступен при 18 билетах или меньше. Следующее обновление в','One shared daily gift for all Game Hall games. Available at 18 tickets or fewer. Next reset at')} <b>{resetTime}</b>.</p></>}
    {(panel==='quests'||panel==='offers')&&<><div className="mono-banner"><Art name={panel==='quests'?'quests':'chest'}/><div><small>TERRITORY</small><b>{panel==='quests'?t('Путь искателя','The explorer’s path'):t('Сокровища хранителя','Guardian treasures')}</b><span>{t('Выполняй задания, забирай настоящие награды','Complete objectives to earn real rewards')}</span></div></div>{panel==='quests'&&<DailyShareCard task="monopoly" userId={userId} onClaimed={()=>{void monopoly().then(d=>{if(mounted.current)setData(d);}).catch(()=>{});}}/>}{(panel==='quests'?quests:offers).map((v,i)=>{const key=`${panel==='quests'?'quest':'offer'}:${i+1}`,done=claimed(key),ready=v.current>=v.target&&!done;return <article className={`mono-quest ${done?'mono-quest-done':''} ${ready?'mono-quest-ready':''}`} key={key}><div className="mono-quest-heading"><Art name={panel==='quests'?'quests':i===0?'chest':i===1?'gift':'openChest'}/><b>{en?v.en:v.ru}</b>{done&&<span className="mono-quest-done-mark">✓</span>}</div><Prizes prize={bundlePrize(panel==='quests'?'quest':'offer',i+1)} en={en}/><div className="mono-progress" role="progressbar" aria-label={en?v.en:v.ru} aria-valuemin={0} aria-valuemax={v.target||1} aria-valuenow={Math.min(v.current,v.target)||0}><span style={{width:`${v.target?Math.min(100,v.current/v.target*100):100}%`}}/></div><div><span>{Math.min(v.current,v.target)}/{v.target} · +{v.reward} {t('билета','tickets')}</span><button type="button" disabled={disabled||done} onClick={()=>ready?void request(panel==='quests'?'quest':'offer',i+1):goToDice()}>{done?t('Получено','Claimed'):ready?t('Забрать','Claim'):t('Перейти','Go')}</button></div></article>;})}
    {(panel==='quests'?readyQuests:readyOffers)>1&&<button className="mono-claim-all" type="button" disabled={disabled} onClick={()=>void claimAllReady(panel==='quests'?'quest':'offer')}>{t('Забрать все доступные','Claim all available')} ({panel==='quests'?readyQuests:readyOffers})</button>}</>}
    {panel==='jackpot'&&<div className="mono-jackpot"><Art name="openChest"/><h4>{t('Джекпот пока недоступен','Jackpot is not available yet')}</h4><p>{t('Серверной механики джекпота нет. Здесь нет розыгрыша, списания билетов или обещания выигрыша. Рабочие награды доступны в разделе «Награды за круги».','There is no server jackpot mechanic. No drawing or ticket spending takes place here. Visit Lap rewards for available prizes.')}</p><button className="mono-cta" onClick={()=>setPanel('rewards')}>{t('Посмотреть награды за круги','View lap rewards')}</button></div>}
    {panel==='help'&&<div className="mono-rules"><p>{t('На поле ровно 28 клеток. Один бросок стоит 1 билет. Герой получает золото и показанный приз клетки. Алмазы, камни, материалы, зелья и эликсиры забираются кнопкой под полем в настоящий баланс и инвентарь.','The circuit has exactly 28 spaces. A roll costs 1 ticket. Gold and the shown prize await on the landing space. Collect gems, stones, materials and potions below the board.')}</p><p>{t('×10 стоит 10 билетов и умножает награду. Суточный лимит золота сохраняется.','×10 costs 10 tickets and multiplies the prize. The daily gold cap still applies.')}</p>{Object.entries(eventCopy).map(([key,v])=><p key={key}><b>{v[en?2:0]}.</b> {v[en?3:1]}</p>)}<p>{t('Каждый переход через старт засчитывает круг. Прогресс сохраняется на сервере. Событие длится 72 часа, затем круги и задания обновляются. Кошелёк и неполученные ресурсы сохраняются.','Crossing start completes a lap. Progress is saved on the server. The event lasts 72 hours. Your wallet and uncollected resources are retained.')}</p></div>}
   </div>
  </section></div></IosGamePortal>}
  {reward&&<IosGamePortal><div className="mono-overlay mono-celebration" role="dialog" aria-modal="true" aria-labelledby="mono-reward-title" onClick={()=>setReward(null)}><section onClick={e=>e.stopPropagation()}><div className="mono-prize-rays"/><div className="mono-sparkles">{Array.from({length:12},(_,i)=><i key={i} style={{'--i':i} as import('react').CSSProperties}/>)}</div><small>TERRITORY</small><h3 id="mono-reward-title">{t('Сокровище твоё!','Treasure is yours!')}</h3><Art name="openChest" className="mono-opening-chest"/>{(reward.tickets!==undefined||reward.gold!==undefined)&&<div className="mono-winnings"><Art name={reward.tickets!==undefined?'ticket':'gold'}/><strong>+{reward.tickets??reward.gold}</strong></div>}{reward.event&&eventCopy[reward.event]&&<div className="mono-event"><Art name="gems"/><b>{eventCopy[reward.event][en?2:0]}</b><p>{eventCopy[reward.event][en?3:1]}</p></div>}<Prizes prize={reward.awards} en={en}/>{Object.values(reward.awards??{}).some(n=>n>0)&&<p>{t('Ресурсы готовы к получению под полем.','Collect your resources below the board.')}</p>}<p>{reward.tickets!==undefined?t('Билеты уже в кошельке','Tickets are already in your wallet'):reward.gold!==undefined?t('Золото ожидает в игровом зале','Gold awaits in the Game Hall'):t('Сокровища зачислены в инвентарь','Treasures added to your inventory')}</p><button autoFocus className="mono-cta" onClick={()=>setReward(null)}>{t('ПРОДОЛЖИТЬ','CONTINUE')}</button></section></div></IosGamePortal>}
 </div>;
}
