import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Gift, ScrollText, Sparkles, Trophy, X, Info, Ticket } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { hallError } from '@/game/gameHall';
import { monopoly, boardPoint, cellGold, cellPrize, bundlePrize, prizeIcons, prizeLabels, claimMonopolyRewards, type Prize, type MonopolyData, type MonopolyQuestion } from './api';
import './monopoly.css';
const milestones=[5,10,15,20,25];
const faces=['⚀','⚁','⚂','⚃','⚄','⚅'];
type Panel='rewards'|'gifts'|'quests'|'offers'|'help'|null;
const eventCopy:Record<string,[string,string,string,string]>={
 gift:['Сокровище лагуны','Ещё 25 золота к награде клетки!','Lagoon treasure','25 extra gold added to the cell prize!'],
 teleport:['Портал прилива','Перемещение ещё на 3 клетки вперёд.','Tidal portal','Move another 3 spaces forward.'],
 double:['Шаг по облакам','Следующий бросок переместит героя вдвое дальше.','Cloud step','Your next roll moves the hero twice as far.'],
 lucky:['Руна удачи','Выбери число на кубике для следующего хода.','Lucky rune','Choose the dice value on your next turn.'],
};
function Prizes({prize,en}:{prize?:Prize;en:boolean}){
 return <div className="mono-extra-rewards">{Object.entries(prize??{}).filter(([,n])=>n>0).map(([key,n])=><span key={key} title={prizeLabels[key as keyof Prize][en?1:0]}>{prizeIcons[key as keyof Prize]} +{n} <small>{prizeLabels[key as keyof Prize][en?1:0]}</small></span>)}</div>;
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
export function MonopolyAdventure({onBack}:{onBack:()=>void}){
 const {language}=useLanguage(),en=language==='en';
 const [data,setData]=useState<MonopolyData|null>(null),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[moving,setMoving]=useState(false),[position,setPosition]=useState(0);
 const [face,setFace]=useState(5),[fast,setFast]=useState(false),[ten,setTen]=useState(false);
 const [panel,setPanel]=useState<Panel>(null),[reward,setReward]=useState<{gold?:number;tickets?:number;event?:string;awards?:Prize}|null>(null);
 const [now,setNow]=useState(Date.now()),[notice,setNotice]=useState('');
 const lock=useRef(false),mounted=useRef(true),generation=useRef(0);
 const t=(ru:string,english:string)=>en?english:ru;
 const p=data?.progress,h=data?.hall;
 const active=h?.active?.game==='monopoly'?h.active:null;
 useEffect(()=>{
  mounted.current=true;
  const epoch=++generation.current;
  const timer=window.setInterval(()=>setNow(Date.now()),1000);
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
 const request=async(action:string,value=1)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{const d=await monopoly(action,value);if(!mounted.current)return;setData(d);
   if(action==='gift'){setReward({tickets:2,awards:d.awards});setPanel(null);}
   else if(d.added){setReward({tickets:d.added,awards:d.awards});setPanel(null);}
  }catch(e){if(mounted.current)setError(describe(e));}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 };
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
    for(let tick=0;tick<10;tick++){if(!alive())return;setFace(tick%6+1);await pause(65);}
    if(!alive())return;setFace(turn.roll??1);await pause(220);
    for(let step=1;step<=steps;step++){if(!alive())return;setPosition(((turn.old_position??0)+step)%28);await pause(155);}
   }
   if(!alive())return;setFace(turn.roll??1);setPosition(turn.new_position??0);
   const finished=await monopoly('finish',1,session.token);
   if(!alive())return;
   setData(finished);setReward({gold:finished.result?.earned_gold??0,event:finished.result?.event,awards:finished.result?.awards});
   setNotice(t('Награда зачислена в золото игрового зала.','Reward added to your Game Hall gold.'));
  }catch(e){if(alive())setError(describe(e));}
  finally{lock.current=false;if(alive()){setBusy(false);setMoving(false);}}
 };
 const redeem=async()=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{await claimMonopolyRewards();}catch(e){if(mounted.current)setError(describe(e));}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 };
 const point=boardPoint(position);
 const remaining=Math.max(0,Date.parse(p?.ends_at??'')-now)||0;
 const duration=`${Math.floor(remaining/86400000)}${t('д','d')} ${String(Math.floor(remaining/3600000)%24).padStart(2,'0')}:${String(Math.floor(remaining/60000)%60).padStart(2,'0')}:${String(Math.floor(remaining/1000)%60).padStart(2,'0')}`;
 const claimed=(key:string)=>p?.claimed.includes(key)??false;
 const disabled=busy||!data;
 const quests=[{ru:'Сделай 5 бросков',en:'Roll 5 times',current:p?.rolls??0,target:5,reward:2},{ru:'Открой 3 события',en:'Discover 3 events',current:p?.events??0,target:3,reward:2},{ru:'Пройди полный круг',en:'Complete a lap',current:p?.laps??0,target:1,reward:3}];
 const offers=[{ru:'Приветствие хранителя',en:'Guardian’s welcome',current:p?.rolls??0,target:0,reward:1},{ru:'Мастер трёх кругов',en:'Three-lap master',current:p?.laps??0,target:3,reward:2},{ru:'Десять приключений',en:'Ten adventures',current:p?.rolls??0,target:10,reward:3}];
 return <div className="territory-monopoly" data-testid="hall-play-monopoly">
  <header className="mono-header">
   <button aria-label={t('Вернуться в игры','Back to games')} onClick={onBack}><ArrowLeft size={19}/></button>
   <div><small>TERRITORY · {t('ПРИКЛЮЧЕНИЕ','ADVENTURE')}</small><h2>{t('Монополия','Monopoly')}</h2></div>
   <button aria-label={t('Правила','Rules')} onClick={()=>setPanel('help')}><Info size={20}/></button>
  </header>
  <div className="mono-clock">✦ {t('ЛАГУНА СОКРОВИЩ','TREASURE LAGOON')} <span>{data?duration:'…'}</span></div>
  <nav className="mono-milestones" aria-label={t('Награды за круги','Lap rewards')}>
   {milestones.map((lap,i)=><button key={lap} onClick={()=>setPanel('rewards')} className={claimed(`milestone:${lap}`)?'claimed':''}>
    <small>{t('Круг','Lap')} {lap}</small><span>{['✦','🎒','💎','🏰','👑'][i]}</span><strong>{claimed(`milestone:${lap}`)?'✓':`${lap/5+1} 🎟`}</strong>
   </button>)}
   <button className="mono-preview" onClick={()=>setPanel('rewards')}><Trophy size={21}/><small>{t('Все призы','All prizes')}</small></button>
  </nav>
  <div className="mono-scene">
   <svg className="mono-landscape" viewBox="0 0 500 540" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="mono-sea" x2="0" y2="1"><stop stopColor="#18dfdc"/><stop offset="1" stopColor="#08448a"/></linearGradient><linearGradient id="mono-rock" x2=".7" y2="1"><stop stopColor="#d0fff5"/><stop offset=".4" stopColor="#56b8d9"/><stop offset="1" stopColor="#32359a"/></linearGradient></defs>
    <path fill="url(#mono-sea)" d="M0 0H500V540H0Z"/>
    <path fill="#a7fff0" opacity=".25" d="M-20 60Q100 5 250 65T530 40V0H0ZM-20 400Q110 350 260 410T530 390V540H0Z"/>
    <g fill="url(#mono-rock)" stroke="#99ffef" strokeWidth="2"><path d="M-25 180L18 28 48 100 84 14 121 130 160 158Z"/><path d="M352 126L394 35 415 90 451 10 484 98 530 165Z"/><path d="M-15 535L9 406 44 460 70 387 100 510Z"/><path d="M405 540L423 445 452 480 484 384 530 530Z"/></g>
    <g fill="#e7ffed"><path d="M18 28L4 78 22 67 34 80ZM84 14L66 70 85 55 101 72ZM394 35L375 77 395 67 408 81ZM451 10L433 57 451 47 467 62Z"/></g>
    <g fill="none" stroke="#b9fff1" opacity=".35"><ellipse cx="250" cy="275" rx="183" ry="100"/><ellipse cx="250" cy="275" rx="162" ry="80"/><path d="M95 365q45-16 78 0m156-221q40-16 72-1M146 220q30-9 52 0"/></g>
    <g fill="#fff3a4"><circle cx="71" cy="195" r="2"/><circle cx="420" cy="320" r="3"/><circle cx="330" cy="80" r="2"/><circle cx="186" cy="407" r="2"/></g>
   </svg>
   <div className="mono-center"><div className="mono-orbit"/><img src="/monopoly/ship.webp" alt={t('Корабль TERRITORY','TERRITORY ship')}/><span>{t('Круг','Lap')} <b>{p?.laps??0}</b> · {t('Клетка','Space')} {position+1}</span></div>
   <div className="mono-board">
    {Array.from({length:28},(_,i)=>{const pos=boardPoint(i),mystery=[6,14,21].includes(i),prize=cellPrize(i,ten?10:1),kind=Object.keys(prize)[0] as keyof Prize|undefined;return <div key={i} className={`mono-cell ${i===0?'start':mystery?'mystery':`tone-${i%3}`} ${position===i?'current':''}`} style={{left:`${pos.x}%`,top:`${pos.y}%`}} title={i===0?t('Старт · 100 золота','Start · 100 gold'):mystery?t('Случайное событие','Random event'):`${cellGold(i)} ${t('золота','gold')}`}>
     <div>{i===0?'➜':mystery?'?':kind?<span title={prizeLabels[kind][en?1:0]}>{prizeIcons[kind]}</span>:<img src="/monopoly/gold-coin.webp" alt=""/>}</div><small>{i===0?t('СТАРТ','START'):mystery?'✦':(kind?prize[kind]:cellGold(i)*(ten?10:1))}</small>
    </div>;})}
    <div className={`mono-hero ${moving?'moving':''}`} style={{left:`${point.x}%`,top:`${point.y}%`}} aria-label={t(`Герой на клетке ${position+1}`,`Hero on space ${position+1}`)}><img src="/monopoly/hero.webp" alt=""/><span>▼</span></div>
   </div>
   <div className="mono-buffs">{p?.double_next&&<span>☁ {t('Следующий ход ×2','Next move ×2')}</span>}{p?.lucky_next&&<span>✦ {t('Выбор кубика','Choose your roll')}</span>}</div>
  </div>
  <nav className="mono-actions">
   <button onClick={()=>setPanel('offers')}><Sparkles/><span>{t('Предложения','Offers')}</span>{!claimed('offer:1')&&<i/>}</button>
   <button onClick={()=>setPanel('gifts')}><Gift/><span>{t('Подарки','Gifts')}</span>{h?.free_ready&&<i/>}</button>
   <button onClick={()=>setPanel('quests')}><ScrollText/><span>{t('Задания','Quests')}</span>{quests.some((v,i)=>v.current>=v.target&&!claimed(`quest:${i+1}`))&&<i/>}</button>
  </nav>
  <section className="mono-controls">
   {Object.values(p?.pending_rewards??{}).some(n=>n>0)&&<div className="mono-pending"><b>{t('Награды для героя','Hero rewards')}</b><Prizes prize={p?.pending_rewards} en={en}/><button className="mono-cta" disabled={busy} onClick={()=>void redeem()}>{t('Получить в баланс и инвентарь','Collect to wallet and inventory')}</button></div>}
   <div className="mono-roll-row"><div className="mono-wallet"><Ticket size={18}/><b>{h?.tickets??'—'}</b><button aria-label={t('Получить билеты','Get tickets')} onClick={()=>setPanel('gifts')}>+</button></div>
    <button className={`mono-dice ${moving?'rolling':''}`} disabled={disabled||(!active&&(h?.tickets??0)<(ten?10:1))||!!(h?.active&&h.active.game!=='monopoly')} onClick={()=>void roll()} aria-label={active?t('Продолжить бросок','Resume roll'):t('Бросить кубик','Roll dice')}><span>{faces[face-1]}</span></button>
    <div className="mono-lap-stat"><b>{p?.rolls??0}</b><small>{t('бросков','rolls')}</small></div>
   </div>
   <p className="mono-roll-caption">{moving?t('Приключение начинается…','Adventure awaits…'):active?t('Продолжить незавершённый ход','Resume unfinished turn'):t(`Бросить · ${ten?10:1} ${ten?'билетов':'билет'}`,`Roll · ${ten?10:1} ticket${ten?'s':''}`)}</p>
   {p?.lucky_next&&!active&&<div className="mono-choose"><small>{t('Руна удачи: выбери число (1 билет)','Lucky rune: choose a value (1 ticket)')}</small><div>{faces.map((f,i)=><button disabled={disabled||!h?.tickets} key={f} onClick={()=>void roll(101+i)} aria-label={String(i+1)}>{f}</button>)}</div></div>}
   <div className="mono-toggles"><label><input type="checkbox" checked={ten} disabled={busy||!!active} onChange={e=>setTen(e.target.checked)}/>{t('Призы ×10 · 10 билетов','Prizes ×10 · 10 tickets')}</label><label><input type="checkbox" checked={fast} disabled={busy} onChange={e=>setFast(e.target.checked)}/>{t('Без анимации','Skip animation')}</label></div>
   <p className="mono-note" aria-live="polite">{notice||t('Золото забирается в игровом зале. Лимит: 1000 в сутки.','Collect gold in the Game Hall. Daily cap: 1,000.')}</p>
  </section>
  {h?.active&&h.active.game!=='monopoly'&&<button className="mono-cta" onClick={onBack}>{t('Вернуться и завершить другую игру','Return to finish the other game')}</button>}
  {error&&<div className="mono-error" role="alert">{error}<button disabled={busy} onClick={()=>void request('status')}>{t('Обновить','Refresh')}</button></div>}
  {panel&&<div className="mono-overlay" role="dialog" aria-modal="true" aria-labelledby="mono-panel-title" onClick={()=>setPanel(null)}><section className="mono-panel" onClick={e=>e.stopPropagation()}>
   <header><h3 id="mono-panel-title">{panel==='rewards'?t('Награды за круги','Lap rewards'):panel==='gifts'?t('Подарки лагуны','Lagoon gifts'):panel==='quests'?t('Задания Монополии','Monopoly quests'):panel==='offers'?t('Предложения хранителя','Guardian offers'):t('Как играть','How to play')}</h3><button autoFocus aria-label={t('Закрыть','Close')} onClick={()=>setPanel(null)}><X/></button></header>
   <div className="mono-panel-body">{error&&<p className="mono-error" role="alert">{error}</p>}
    {panel==='rewards'&&<><p>{t('Пройди круги до конца события и забери билеты. Каждая награда доступна один раз.','Complete laps before the event ends. Each reward can be collected once.')}</p>{milestones.map((lap,i)=><article className="mono-reward-row" key={lap}><span className="mono-prize-icon">{['✦','🎒','💎','🏰','👑'][i]}</span><div><b>{t('Круги','Laps')} {i*5+1}–{lap}</b><small>{Math.min(p?.laps??0,lap)}/{lap} · +{lap/5+1} 🎟</small><Prizes prize={bundlePrize('milestone',lap)} en={en}/></div><button disabled={disabled||(p?.laps??0)<lap||claimed(`milestone:${lap}`)} onClick={()=>void request('milestone',lap)}>{claimed(`milestone:${lap}`)?'✓':t('Забрать','Claim')}</button></article>)}</>}
    {panel==='gifts'&&<><div className="mono-banner"><Gift size={46}/><b>{t('Подарок нового дня','A new day’s gift')}</b><span>{t('2 билета и зелье здоровья каждый день','2 tickets and a health potion every day')}</span></div><article className="mono-reward-row"><span className="mono-prize-icon">🎟</span><div><b>+2 {t('билета','tickets')}</b><small>{t('Общий подарок игрового зала','Shared Game Hall daily gift')}</small></div><button disabled={disabled||!h?.free_ready} onClick={()=>void request('gift')}>{h?.free_ready?t('Бесплатно','Free'):t('Получено','Collected')}</button></article><p>{t('Обновление в 00:00 UTC. В кошельке должно быть не больше 18 билетов.','Resets at 00:00 UTC. Your wallet must contain at most 18 tickets.')}</p></>}
    {(panel==='quests'||panel==='offers')&&<><div className="mono-banner"><img src="/monopoly/guardian.webp" alt=""/><b>{panel==='quests'?t('Путь искателя','The explorer’s path'):t('Награды за приключения','Adventure rewards')}</b><span>{t('Больше играешь — больше открываешь','Play more, discover more')}</span></div>{(panel==='quests'?quests:offers).map((v,i)=>{const key=`${panel==='quests'?'quest':'offer'}:${i+1}`;return <article className="mono-quest" key={key}><b>{en?v.en:v.ru}</b><Prizes prize={bundlePrize(panel==='quests'?'quest':'offer',i+1)} en={en}/><div className="mono-progress"><span style={{width:`${v.target?Math.min(100,v.current/v.target*100):100}%`}}/></div><div><span>{Math.min(v.current,v.target)}/{v.target} · +{v.reward} 🎟</span><button disabled={disabled||v.current<v.target||claimed(key)} onClick={()=>void request(panel==='quests'?'quest':'offer',i+1)}>{claimed(key)?t('Получено','Claimed'):v.current<v.target?t('Недоступно','Locked'):t('Забрать','Claim')}</button></div></article>;})}</>}
    {panel==='help'&&<div className="mono-rules"><p>{t('Один бросок стоит 1 билет. Кубик и награду определяет сервер. Герой получает золото и указанный приз клетки: алмазы, камни, материалы, зелье или эликсир. Ресурсы получаются кнопкой под полем в настоящий баланс и инвентарь.','A roll costs 1 ticket. The server determines the dice and prize. Your hero earns gold and the shown cell prize: gems, stones, materials, potion or elixir. Collect resources below the board to your real wallet and inventory.')}</p><p>{t('Призы ×10 стоят 10 билетов: один бросок, десятикратная награда. Суточный лимит золота сохраняется.','Prizes ×10 costs 10 tickets: one roll, ten times the reward. The daily gold cap still applies.')}</p>{Object.entries(eventCopy).map(([key,v])=><p key={key}><b>{v[en?2:0]}.</b> {v[en?3:1]}</p>)}<p>{t('Каждый переход через старт засчитывает круг. Прогресс и бонусы хранятся на сервере. Событие длится 72 часа; затем круги, задания и предложения обновляются. Билеты и золото сохраняются.','Crossing start completes a lap. Progress and bonuses are saved on the server. The event lasts 72 hours, then laps, quests and offers reset. Tickets and gold are retained.')}</p></div>}
   </div>
  </section></div>}
  {reward&&<div className="mono-overlay mono-celebration" role="dialog" aria-modal="true" aria-labelledby="mono-reward-title" onClick={()=>setReward(null)}><section onClick={e=>e.stopPropagation()}><div className="mono-burst">✦</div><small>TERRITORY</small><h3 id="mono-reward-title">{t('Награда получена!','Reward received!')}</h3><div className="mono-winnings"><>{reward.tickets?<Ticket size={64} className="text-amber-200"/>:<img src="/monopoly/gold-coin.webp" alt=""/>}</><strong>+{reward.tickets??reward.gold} {reward.tickets?'🎟':'🪙'}</strong></div>{reward.event&&eventCopy[reward.event]&&<div className="mono-event"><Sparkles/><b>{eventCopy[reward.event][en?2:0]}</b><p>{eventCopy[reward.event][en?3:1]}</p></div>}<Prizes prize={reward.awards} en={en}/>{Object.values(reward.awards??{}).some(n=>n>0)&&<p>{t('Ресурсы готовы к получению: кнопка под полем.','Resources await collection below the board.')}</p>}<p>{reward.tickets?t('Билеты уже в кошельке','Tickets are already in your wallet'):t('Золото ожидает в игровом зале','Gold awaits collection in the Game Hall')}</p><button autoFocus className="mono-cta" onClick={()=>setReward(null)}>{t('Продолжить','Continue')}</button></section></div>}
 </div>;
}
