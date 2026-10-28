import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock3, Gem, Package, RefreshCw, ShoppingBag } from 'lucide-react';
import {
  fetchAuctionCompletion, submitAuctionCompletion, readPendingAuctionCompletion, keepPendingAuctionCompletion,
  validAuctionCompletionAction,
  type AuctionCompletionAction, type AuctionCompletionFilters, type AuctionCompletionOverview, type AuctionCurrency,
  type PendingAuctionCompletion,
} from '@/game/auctionCompletion';
import { AuctionTradeError } from '@/game/auctionApi';
import './auctionCompletionPanel.css';

type TradeTab = 'lots' | 'mine' | 'history';
const CURRENCIES: Record<AuctionCurrency, {ru:string;en:string;symbol:string}> = {
  gold: {ru:'Монеты',en:'Gold',symbol:'🪙'},
  gems: {ru:'Синие алмазы',en:'Blue gems',symbol:'💎'},
  redGems: {ru:'Красные алмазы',en:'Red gems',symbol:'♦'},
};
/** Live replacement for gold-only trading, shown only when the v2 server is enabled.
 * Strictly server-derived lots/wallets; never performs a client-side transfer. */
export function AuctionCompletionPanel({tab,language}:{tab:TradeTab;language:'ru'|'en'}) {
  const en=language==='en';
  const alive=useRef(true);
  const lock=useRef(false);
  const [overview,setOverview]=useState<AuctionCompletionOverview|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [recoveryReady,setRecoveryReady]=useState(false);
  const [pending,setPending]=useState<PendingAuctionCompletion|null>(null);
  const [filters,setFilters]=useState<AuctionCompletionFilters>({});
  const [search,setSearch]=useState('');
  const [currency,setCurrency]=useState<AuctionCurrency>('gold');
  const [price,setPrice]=useState('100');
  const [amount,setAmount]=useState('1');
  const [duration,setDuration]=useState(86400);
  const format=(v:number)=>v.toLocaleString(en?'en-US':'ru-RU');
  const refresh=useCallback(async(next:AuctionCompletionFilters={})=>{
    const result=await fetchAuctionCompletion(next);
    if(alive.current){setOverview(result?.enabled?result:null);setLoading(false);}
  },[]);
  useEffect(()=>{
    alive.current=true;
    void (async()=>{
      try{
        const saved=await readPendingAuctionCompletion();
        if(alive.current){setPending(saved);setRecoveryReady(true);}
      }catch{
        if(alive.current){setRecoveryReady(false);setError(en?'Saved trade cannot be verified. Trading locked.':'Не удалось проверить сохранённую сделку. Торговля заблокирована.');}
      }
      try{await refresh();}catch{
        if(alive.current){setLoading(false);setError(en?'Market server unavailable.':'Аукцион временно недоступен.');}
      }
    })();
    return()=>{alive.current=false;};
  },[en,refresh]);
  const execute=async(action:AuctionCompletionAction,retry?:PendingAuctionCompletion)=>{
    if(lock.current||!recoveryReady||(pending&&!retry)||!validAuctionCompletionAction(action))return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    const order=retry??{id:crypto.randomUUID(),action};
    try{
      if(!retry){await keepPendingAuctionCompletion(order);if(alive.current)setPending(order);}
      const receipt=await submitAuctionCompletion(order.action,order.id);
      await keepPendingAuctionCompletion(null);
      if(alive.current){setPending(null);setNotice(en?'Server confirmed the trade.':'Сделка подтверждена сервером.');}
      if(receipt.success)await refresh(filters);
    }catch(err){
      if(err instanceof AuctionTradeError&&err.rejected){
        try{await keepPendingAuctionCompletion(null);if(alive.current)setPending(null);}catch{}
        if(alive.current)setError(en?'Trade rejected by server.':'Сервер отклонил операцию.');
      }else if(alive.current)setError(en?'Result uncertain. Use safe retry with the same ID.':'Результат неизвестен. Повтори операцию с сохранённым ID.');
    }finally{lock.current=false;if(alive.current)setBusy(false);}
  };
  const parsedPrice=Number(price),quantity=Number(amount);
  const validPrice=Number.isSafeInteger(parsedPrice)&&parsedPrice>0&&parsedPrice<=2147483647&&(currency==='gold'||parsedPrice%10===0);
  const balances=overview?.wallets??{gold:null,gems:null,redGems:null};
  const filtered=tab==='mine'?overview?.mine??[]:overview?.lots??[];
  const makeAction=(itemId:string,source:'stage3'|'stage8'|'resource',resourceId?:string):AuctionCompletionAction=>{
    if(source==='resource')return{action:'list',source:'resource',resourceId:resourceId as 'gather-ore',quantity,price:parsedPrice,currency,durationSeconds:duration};
    return{action:'list',source,itemId,price:parsedPrice,currency,durationSeconds:duration};
  };
  if(loading)return <p className="auction-completion__status">{en?'Checking market…':'Проверяем аукцион…'}</p>;
  if(!overview)return <p className="auction-completion__status">{en?'Enhanced market is disabled.':'Расширенный аукцион пока отключён сервером.'}</p>;
  return <section className="auction-completion" data-testid="auction-completion" aria-label={en?'Verified multi-currency auction':'Трёхвалютный аукцион'}>
    <div className="auction-completion__header">
      <ShoppingBag size={19}/><b>{en?'PLAYER MARKET':'АУКЦИОН ИГРОКОВ'}</b>
      <button type="button" disabled={busy} aria-label={en?'Refresh auction':'Обновить аукцион'} onClick={()=>void refresh(filters).catch(()=>setError(en?'Refresh failed':'Ошибка обновления'))}><RefreshCw size={17}/></button>
    </div>
    <div className="auction-completion__wallets">
      {(Object.keys(CURRENCIES) as AuctionCurrency[]).map(key=><div key={key}><span>{CURRENCIES[key].symbol} {en?CURRENCIES[key].en:CURRENCIES[key].ru}</span><b>{balances[key]===null?'—':format(balances[key]!)}</b></div>)}
    </div>
    {tab==='history'?<>
      <h3>{en?'Completed trades':'История сделок'}</h3>
      {overview.history.map(item=><article className="auction-completion__lot" key={item.id}>
        <b>{item.item.customName??item.item.name??(en?'Item':'Предмет')}</b>
        <span>{item.role==='buyer'?(en?'Bought':'Куплено'):(en?'Sold/listing':'Продажа/лот')} · {item.status}</span>
        <span>{item.price} {CURRENCIES[item.currency].symbol} · {en?'Fee':'Комиссия'}: {item.fee??'—'}</span>
      </article>)}
      {!overview.history.length&&<p className="auction-completion__status">{en?'No completed trades yet.':'Сделок пока нет.'}</p>}
    </>:<>
      {tab==='lots'&&<form className="auction-completion__search" onSubmit={ev=>{ev.preventDefault();setFilters(old=>({...old,search}));void refresh({...filters,search}).catch(()=>setError(en?'Search failed':'Ошибка поиска'));}}>
        <label>{en?'Search':'Поиск'}<input value={search} maxLength={100} onChange={ev=>setSearch(ev.target.value)} placeholder={en?'Item or seller':'Предмет или продавец'}/></label>
        <button type="submit" disabled={busy}>{en?'Find':'Найти'}</button>
      </form>}
      <div className="auction-completion__lots">
        {filtered.map(lot=><article className="auction-completion__lot" key={lot.id}>
          <div className="auction-completion__lot-head"><Package size={20}/>
            <div><b>{lot.item.customName??lot.item.name??(en?'Item':'Предмет')}</b><small>{lot.item.rarity??'—'} · {lot.item.makerName??lot.seller??''}</small></div>
            <strong>{format(lot.price)} {CURRENCIES[lot.currency].symbol}</strong>
          </div>
          <p><Clock3 size={12}/>{en?'Expires':'Истекает'}: {new Date(lot.expires_at).toLocaleString(en?'en-US':'ru-RU')}</p>
          {tab==='mine'?<button type="button" disabled={busy||!recoveryReady||!!pending} onClick={()=>void execute({action:'cancel',listingId:lot.id})}>{en?'Cancel listing':'Снять с продажи'}</button>
           :!overview.mine.some(own=>own.id===lot.id)&&<button type="button" disabled={busy||!recoveryReady||!!pending||balances[lot.currency]===null||(balances[lot.currency]??0)<lot.price}
             onClick={()=>void execute({action:'buy',listingId:lot.id})}>{en?'Buy':'Купить'}</button>}
        </article>)}
        {!filtered.length&&<p className="auction-completion__status">{en?'No lots available.':'Пока нет доступных лотов.'}</p>}
      </div>
      {tab==='mine'&&<div className="auction-completion__sell">
        <h3>{en?'List for sale':'Выставить на продажу'}</h3>
        <div className="auction-completion__form">
          <label>{en?'Currency':'Валюта'}<select value={currency} onChange={e=>setCurrency(e.target.value as AuctionCurrency)}>
            {(Object.keys(CURRENCIES) as AuctionCurrency[]).map(key=><option key={key} value={key}>{en?CURRENCIES[key].en:CURRENCIES[key].ru}</option>)}
          </select></label>
          <label>{en?'Price':'Цена'}<input type="number" inputMode="numeric" min="1" step={currency==='gold'?'1':'10'} value={price} onChange={e=>setPrice(e.target.value)} /></label>
          <label>{en?'Duration':'Срок'}<select value={duration} onChange={e=>setDuration(Number(e.target.value))}>
            <option value={3600}>{en?'1 hour':'1 час'}</option><option value={21600}>{en?'6 hours':'6 часов'}</option><option value={86400}>{en?'24 hours':'24 часа'}</option>
          </select></label>
        </div>
        {currency!=='gold'&&<p>{en?'Gem prices must be multiples of 10.':'Цена в алмазах должна быть кратной 10.'}</p>}
        {overview.items.filter(item=>item.source==='stage3'||item.source==='stage8').map(item=><button type="button" key={item.source+item.item_id} disabled={!validPrice||!!pending||busy||!recoveryReady} onClick={()=>void execute(makeAction(item.item_id,item.source as 'stage3'|'stage8'))}>
          <Package size={15}/> {item.item.customName??item.item.name??(en?'Crafted item':'Изделие мастера')} — {en?'Sell':'Продать'}
        </button>)}
        {Object.entries(overview.resources).filter(([,q])=>(q??0)>0).length>0&&<div className="auction-completion__resources">
          <label>{en?'Quantity':'Количество ресурсов'}<input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
          {Object.entries(overview.resources).filter(([,q])=>(q??0)>0).map(([id,qty])=><button type="button" key={id}
            disabled={!validPrice||!Number.isSafeInteger(quantity)||quantity<1||quantity>(qty??0)||busy||!!pending||!recoveryReady}
            onClick={()=>void execute(makeAction('', 'resource',id))}><Gem size={14}/> {id.replace('gather-','')} ×{qty} — {en?'List':'Выставить'}</button>)}
        </div>}
        <p>{en?'Commission: 10% on a completed sale; unsold items are returned by the server.':'Комиссия: 10% при продаже. Непроданное сервер возвращает автоматически.'}</p>
      </div>}
    </>}
    {!!pending&&<button className="auction-completion__retry" type="button" disabled={busy||!recoveryReady} onClick={()=>void execute(pending.action,pending)}>
      {en?'Retry saved trade safely':'Повторить сохранённую сделку'}</button>}
    {error&&<p className="auction-completion__error" role="alert">{error}</p>}
    {notice&&<p className="auction-completion__status" role="status"><Check size={14}/>{notice}</p>}
  </section>;
}
