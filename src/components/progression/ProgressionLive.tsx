import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock3, Crown, Gem, Gift, RefreshCw, Shield, Sparkles, Swords } from 'lucide-react';
import { authenticatedProgressionClient } from '@/game/progressionV1/api';
import { FUND_KINDS, missingProgressionConfiguration, type FundKind, type ProgressionRequest, type ProgressionStatus } from '@/game/progressionV1';
import './progressionLive.css';

type Client = Awaited<ReturnType<typeof authenticatedProgressionClient>>;
const FUND_NAMES: Record<FundKind, {ru: string; en: string}> = {
  level: {ru:'Уровень героя',en:'Hero level'}, arena:{ru:'Арена',en:'Arena'},
  blessing:{ru:'Благословение',en:'Blessing'}, adventure:{ru:'Приключение',en:'Adventure'},
  artifact:{ru:'Артефакты',en:'Artifacts'}, dark_energy:{ru:'Тёмная энергия',en:'Dark energy'},
};
/**
 * Real server-only progression UI. No local rewards or guessed prices.
 * Silently hides when the staged RPC/config does not exist or is disabled,
 * leaving the established beta quests and blessing completely untouched.
 */
export function ProgressionLive({language, tab}: {language:'ru'|'en'; tab:'daily'|'weekly'}) {
  const en = language === 'en';
  const client = useRef<Client|null>(null);
  const [status,setStatus] = useState<ProgressionStatus|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [connected,setConnected] = useState(false);
  const [view,setView] = useState<'activities'|'funds'|'gems'>('activities');
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const api = client.current ?? await authenticatedProgressionClient();
      client.current = api;
      // Resume the EXACT pending operationId before showing any new reward action.
      const pending = api.readPending();
      const restored = pending ? await api.resume() : null;
      const latest = restored?.currentStatus ?? await api.fetchStatus();
      if (!alive.current) return;
      setStatus(latest.enabled ? latest : null);
      setConnected(latest.enabled);
      if(restored) setMessage(en ? 'Previous operation safely restored. Check your mail for rewards.' : 'Незавершённая операция восстановлена. Награды проверь в почте.');
    } catch {
      if(alive.current) { setStatus(null); setConnected(false); }
    }
  },[en]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {alive.current = false;};
  },[load]);

  const act = async (request: ProgressionRequest) => {
    if (busy || !client.current) return;
    setBusy(true);setMessage('');
    try {
      const {receipt,currentStatus} = await client.current.execute(request);
      if (!alive.current) return;
      setStatus(currentStatus);
      setMessage(receipt.grantId
        ? en ? 'Reward confirmed. Collect it from your mail.' : 'Награда подтверждена сервером. Забери её в почте.'
        : en ? 'Server confirmed the operation.' : 'Операция подтверждена сервером.');
    } catch {
      if (alive.current) setMessage(en ? 'Server unavailable or operation denied. Retry the same operation below.' : 'Сервер недоступен или отказал в операции. Для безопасного повтора нажми «Повторить».');
    } finally {if(alive.current) setBusy(false);}
  };
  if (!connected || !status) return null;
  const pending = (() => {try{return client.current?.readPending() ?? null;}catch{return null;}})();
  const claimed = (id:string,period:'daily'|'weekly'|'fund') => status.claims.some(c=>c.rule_id===id && c.period_key===(period==='daily'?status.day:period==='weekly'?status.week:'lifetime'));
  const missing = missingProgressionConfiguration(status);
  const fundProgress = (fund:FundKind) => status.funds.find(f=>f.fund===fund);
  const rewards = status.rewards.filter(r=>r.period===(tab==='daily'?'daily':'weekly'));
  return <section className="progression-live" data-testid="server-progression" aria-label={en?'Server progression':'Серверное развитие'}>
    <div className="progression-live__header"><Sparkles size={19}/><strong>{en?'HERO PROGRESSION':'РАЗВИТИЕ ГЕРОЯ'}</strong>
      <button type="button" onClick={()=>void load()} disabled={busy} aria-label={en?'Refresh progression':'Обновить развитие'}><RefreshCw size={16}/></button>
    </div>
    <p className="progression-live__server"><Shield size={13}/>{en?'Progress and rewards verified by server':'Прогресс и награды подтверждает сервер'}</p>
    <div className="progression-live__tabs" role="group">
      {([['activities',en?'Activities':'Активности'],['funds',en?'Funds':'Фонды'],['gems',en?'Gems':'Самоцветы']] as const).map(([id,label])=>
        <button type="button" key={id} onClick={()=>setView(id)} aria-pressed={view===id}>{label}</button>)}
    </div>
    {view==='activities' && <>
      <div className="progression-live__score">
        <b>{tab==='daily'?status.dailyPoints:status.weeklyPoints}/{tab==='daily'?100:700}</b>
        <span>{en?'Activity points':'Очки активности'}</span>
      </div>
      {tab==='daily' && <div className="progression-live__activity-list">
        {status.activities.map(a=><div key={a.id}><Check size={13}/><span>{a.id.replace(/_/g,' ')}</span><b>{Math.min(a.current,a.target)}/{a.target}</b></div>)}
      </div>}
      <div className="progression-live__rewards">
        {rewards.map(r=>{
          const taken=claimed(r.id,r.period==='daily'?'daily':'weekly');
          const enough=(r.period==='daily'?status.dailyPoints:status.weeklyPoints)>=r.threshold;
          return <div key={r.id} className="progression-live__reward">
            <Gift size={18}/><span><b>{r.threshold} {en?'points':'очков'}</b><small>{Object.entries(r.reward).map(([key,val])=>key+': '+String(val)).join(' · ')}</small></span>
            <button type="button" disabled={!enough||taken||busy||!!pending} onClick={()=>void act({action:'claim_reward',payload:{ruleId:r.id}})}>
              {taken?'✓':en?'Claim':'Забрать'}</button>
          </div>;
        })}
        {!rewards.length && <p>{en?'Rewards are being configured.':'Награды ещё настраиваются на сервере.'}</p>}
      </div>
      {status.blessing && <div className="progression-live__blessing">
        <Crown size={17}/><span>{en?'Blessing level':'Благословение, уровень'} <b>{status.blessing.level}</b>
          <small>XP: {status.blessing.xp} · {en?'Charges':'Заряды'}: {status.blessing.charges}</small></span>
        <button type="button" disabled={busy||!!pending||status.blessing.charges>0||status.legacyImportRequired}
          onClick={()=>void act({action:'claim_blessing',payload:{}})}>{en?'Claim':'Получить'}</button>
      </div>}
    </>}
    {view==='funds' && <div className="progression-live__funds">
      {FUND_KINDS.map(fund=>{
        const progress=fundProgress(fund);
        return <section key={fund}>
          <h4><Swords size={15}/>{en?FUND_NAMES[fund].en:FUND_NAMES[fund].ru}</h4>
          <p>{en?'Progress':'Прогресс'}: <b>{progress?.progress??0}</b>
            <span>{progress?.premium?(en?'Premium active':'Премиум активен'):(en?'Free track':'Бесплатная ветка')}</span></p>
          {status.rewards.filter(r=>r.period==='fund'&&r.fund===fund).map(r=>{
            const taken=claimed(r.id,'fund'), allowed=r.track==='free'||progress?.premium===true;
            return <div className="progression-live__fund-reward" key={r.id}>
              <span>{r.track==='premium'?'★':'◇'} {r.threshold}</span>
              <button type="button" disabled={!allowed||(progress?.progress??0)<r.threshold||taken||busy||!!pending}
                onClick={()=>void act({action:'claim_reward',payload:{ruleId:r.id}})}>{taken?'✓':en?'Collect':'Забрать'}</button>
            </div>;
          })}
        </section>;
      })}
    </div>}
    {view==='gems' && <div className="progression-live__gems">
      <h4><Gem size={17}/>{en?'Gem synthesis':'Синтез самоцветов'}</h4>
      <p>{en?'Combine 3 equal gems; effects are granted only by the server.':'Соедини 3 одинаковых самоцвета. Результат подтверждается сервером.'}</p>
      {status.gems.map(g=>{
        const rule=status.gemRules.find(r=>r.gem_kind===g.gem_kind&&r.level===g.gem_level);
        return <div className="progression-live__gem" key={g.gem_kind+':'+g.gem_level}>
          <Gem size={16}/><span>{g.gem_kind} · {en?'Lv':'Ур'} {g.gem_level}<small>×{g.quantity}</small></span>
          <button type="button" disabled={busy||!!pending||g.quantity<3||!rule?.next_level}
            onClick={()=>void act({action:'synthesize_gem',payload:{kind:g.gem_kind,level:g.gem_level}})}>{en?'Combine 3':'Соединить 3'}</button>
        </div>;
      })}
      {status.sockets.length>0&&<p>{en?'Equipped gemstones':'Установленных самоцветов'}: {status.sockets.length}</p>}
      {!status.gems.length&&<p>{en?'No loose gems in storage.':'В хранилище пока нет свободных самоцветов.'}</p>}
    </div>}
    {missing.length>0&&<p className="progression-live__notice"><Clock3 size={14}/>{en?'Some rewards and levels await server configuration.':'Некоторые награды и уровни ещё настраиваются сервером.'}</p>}
    {pending&&<button type="button" disabled={busy} className="progression-live__retry"
      onClick={async()=>{if(busy||!client.current)return;setBusy(true);try{const result=await client.current.resume();if(alive.current){setStatus(result?.currentStatus??await client.current.fetchStatus());setMessage(en?'Operation safely restored.':'Операция восстановлена.');}}catch{if(alive.current)setMessage(en?'Cannot confirm yet. Try again later.':'Пока нет подтверждения. Повтори позже.');}finally{if(alive.current)setBusy(false);}}}>
      {en?'Retry saved operation':'Повторить сохранённую операцию'}</button>}
    {message&&<p role="status" className="progression-live__notice">{message}</p>}
    <p className="progression-live__footnote">{en?'Collect confirmed rewards in Mail. The old seven-day journey remains independent.':'Подтверждённые награды забирай в почте. Старый семидневный календарь работает отдельно.'}</p>
  </section>;
}
