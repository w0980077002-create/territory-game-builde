import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Ban, Hammer, Minus, Plus, Search, ShieldAlert, ShieldCheck, UserRound, Ticket, RotateCcw, Trash2 } from 'lucide-react';
import { RESOURCES, adminCall, payloadFor, type PlayerSummary } from '@/admin/api';
import { ActivityPanel } from '@/admin/tabs/ActivityPanel';
import { Empty, ErrorLine, Loading, Panel, fmt, fmtDate, inputCls, type Confirm } from '@/admin/ui';

const SLOT_LABELS: Record<string, string> = {
  helmet: 'Шлем', amulet: 'Амулет', armor: 'Броня', weapon: 'Оружие', shield: 'Щит', ring: 'Кольцо', boots: 'Сапоги',
};

function currentAmount(p: PlayerSummary, key: string) {
  if (key in p.resources) return p.resources[key as keyof PlayerSummary['resources']];
  if (key === 'shop_stone_5') return null;
  return p.items[key] ?? 0;
}

function PlayerRow({ p, onOpen, extra }: { p: PlayerSummary; onOpen: () => void; extra?: ReactNode }) {
  return (
    <button onClick={onOpen} className="w-full flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-950/50 px-3 py-2.5 text-left hover:border-sky-500/50 transition-colors">
      <span className="w-9 h-9 shrink-0 rounded-full bg-slate-800 flex items-center justify-center"><UserRound className="w-4 h-4 text-slate-400" /></span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-white truncate">{p.name}</span>
          {p.banned && <span className="rounded bg-red-500/20 px-1.5 text-[10px] font-bold text-red-300">БАН</span>}
        </span>
        <span className="block text-[11px] text-slate-400 truncate">
          {p.username ? `@${p.username} · ` : ''}TG {p.telegramId ?? '—'} · ур. {p.level}
        </span>
        {extra}
      </span>
    </button>
  );
}

interface PendingGrant { id:string;kind:'adjust'|'mail';subject:string;payload:Record<string,unknown>;created_at:string; }
interface HallAccount {tickets:number;played:number;wins:number;points:number;pendingGold:number;claimedGold:number;activeGame:string|null;activeSince:string|null;}
function PlayerProfile({ id, confirm, onBack }: { id: string; confirm: Confirm; onBack: () => void }) {
  const [p, setP] = useState<PlayerSummary | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [grants, setGrants] = useState<PendingGrant[]>([]);
  const [hall, setHall] = useState<HallAccount | null>(null);
  const [ticketQty, setTicketQty] = useState('20');
  const [reason, setReason] = useState('Награда за тестирование');
  const [warningText, setWarningText] = useState('');

  const load = useCallback(() => {
    adminCall<{ player: PlayerSummary; pendingAdjustments: number }>('player', { playerId: id })
      .then((r) => {
        setP(r.player);
        setPending(r.pendingAdjustments);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const loadExtra = useCallback(() => {
    void adminCall<{rows:PendingGrant[]}>('pending_grants',{playerId:id})
      .then(r=>setGrants(r.rows)).catch((e:Error)=>setError(e.message));
    void adminCall<HallAccount>('hall_player',{playerId:id})
      .then(setHall).catch((e:Error)=>setError(e.message));
  },[id]);
  useEffect(() => {load();loadExtra();},[load,loadExtra]);

  if (!p) return error ? <ErrorLine text={error} /> : <Loading />;

  const change = (key: string, label: string, sign: 1 | -1) => {
    const qty = Math.floor(Number(amounts[key] || 0));
    if (!qty || qty < 1) return setError('Введите количество больше нуля');
    setError(null);
    confirm(`${sign > 0 ? 'Выдать' : 'Списать'} ${fmt(qty)} — ${label} игроку ${p.name}`, async () => {
      await adminCall('adjust', { playerId: p.id, payload: payloadFor(key, qty * sign) });
      setAmounts((a) => ({ ...a, [key]: '' }));
      load();
      return `${label}: ${sign > 0 ? '+' : '-'}${fmt(qty)}`;
    });
  };

  const saveLevel = (slot: string) => {
    const level = Number(levels[slot]);
    if (!Number.isSafeInteger(level) || level < 1 || level > 500) return setError('Уровень должен быть от 1 до 500');
    setError(null);
    confirm(`Установить уровень ${level} для «${p.equipped[slot].name}» (${SLOT_LABELS[slot]})`, async () => {
      const result = await adminCall<{ applied: boolean; gear: { level: number; attack: number; defense: number; hp: number; critChance: number } }>('set_test_gear_level', { playerId: p.id, slot, level });
      if (!result.applied || result.gear?.level !== level) throw new Error('Сервер не подтвердил новый уровень и характеристики. Обнови данные игрока.');
      load();
      loadExtra();
      setLevels((current) => ({ ...current, [slot]: '' }));
      const current = result.gear;
      return `Уровень ${level} и характеристики сохранены на сервере: атака +${current.attack}, защита +${current.defense}, HP +${current.hp}, крит +${current.critChance}%. В открытой игре обновится при синхронизации.`;
    });
  };

  const toggleBan = () => {
    const banned = !p.banned;
    confirm(`${banned ? 'Забанить' : 'Разбанить'} игрока ${p.name}`, async () => {
      await adminCall('ban', { playerId: p.id, banned });
      setP({ ...p, banned });
      return banned ? 'Игрок забанен' : 'Игрок разбанен';
    });
  };

  const warnPlayer = () => {
    const message = warningText.trim();
    if (message.length < 5) return setError('Напиши текст предупреждения (минимум 5 символов).');
    setError(null);
    confirm(`Отправить игроку ${p.name} предупреждение без блокировки? Текст: ${message}`, async () => {
      await adminCall('warn', { playerId: p.id, message });
      setWarningText('');
      loadExtra();
      return 'Предупреждение отправлено в игровую почту. Игрок не заблокирован.';
    });
  };
  const giveTickets = () => {
    const count=Number(ticketQty),note=reason.trim();
    if(!Number.isSafeInteger(count)||count===0||Math.abs(count)>250)
      return setError('Разрешено от −250 до +250 билетов за операцию.');
    if(note.length<3||note.length>140)return setError('Напиши причину выдачи.');
    setError(null);
    confirm((count>0?'Выдать ':'Списать ')+Math.abs(count)+' билетов игроку '+p.name+'? Причина: '+note,async()=>{
      const r=await adminCall<{affected:number;balance:number}>('hall_grant',{
        scope:'one',playerId:p.id,amount:count,reason:note,requestId:crypto.randomUUID(),
      });
      loadExtra();
      return 'Билеты изменены. Новый баланс: '+r.balance+' 🎟️';
    });
  };
  const cancel = (grant:PendingGrant) => {
    confirm('Отменить ещё не полученную выдачу игроку '+p.name+'? ('+grant.kind+')',async()=>{
      await adminCall('cancel_pending',{playerId:p.id,grantId:grant.id});
      load();loadExtra();
      return 'Неполученная выдача отменена.';
    });
  };
  const slots = Object.keys(p.equipped);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-sky-300 hover:text-sky-200"><ArrowLeft className="w-4 h-4" /> К поиску</button>

      <Panel title={p.name} icon={<UserRound className="w-4 h-4" />} right={
        p.banned ? <span className="rounded-lg bg-red-500/20 px-2 py-0.5 text-xs font-bold text-red-300">ЗАБАНЕН</span> : null
      }>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-slate-400">Telegram ID</dt><dd className="text-slate-100 text-right tabular-nums">{p.telegramId ?? '—'}</dd>
          <dt className="text-slate-400">Username</dt><dd className="text-slate-100 text-right truncate">{p.username ? `@${p.username}` : '—'}</dd>
          <dt className="text-slate-400">Уровень</dt><dd className="text-slate-100 text-right">{p.level}</dd>
          <dt className="text-slate-400">Регистрация</dt><dd className="text-slate-100 text-right">{fmtDate(p.createdAt)}</dd>
          <dt className="text-slate-400">Последний заход</dt><dd className="text-slate-100 text-right">{fmtDate(p.lastSeenAt)}</dd>
        </dl>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <button onClick={toggleBan} disabled={p.banned} className="h-11 rounded-xl bg-red-600 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-30 flex items-center justify-center gap-1.5 transition-colors">
            <Ban className="w-4 h-4" /> Бан
          </button>
          <button onClick={toggleBan} disabled={!p.banned} className="h-11 rounded-xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-30 flex items-center justify-center gap-1.5 transition-colors">
            <ShieldCheck className="w-4 h-4" /> Разбан
          </button>
        </div>
      </Panel>

      <Panel title="Предупреждение без блокировки" icon={<ShieldAlert className="w-4 h-4 text-amber-300" />}>
        <p className="text-xs text-slate-400 mb-3">Подозрительная активность не доказывает нарушение. Решение предупредить или забанить всегда принимаешь только ты. Это действие не блокирует игрока.</p>
        <textarea className={`${inputCls} h-28 py-2.5 resize-none`} maxLength={1000}
          value={warningText} onChange={(e) => setWarningText(e.target.value)}
          placeholder="Здравствуйте! Мы заметили необычную активность и просим уточнить обстоятельства..." />
        <button type="button" onClick={warnPlayer}
          className="mt-2 h-11 rounded-xl bg-amber-500/15 border border-amber-500/50 text-amber-200 w-full font-semibold text-sm">
          Отправить предупреждение (без бана)
        </button>
      </Panel>
      <ErrorLine text={error} />
      {pending > 0 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Ожидают применения: {pending}. Изменения применяются, когда игрок в игре (в течение 20 секунд) или при следующем входе.
        </p>
      )}

      <Panel title="Баланс и ресурсы">
        <div className="space-y-2">
          {RESOURCES.map((r) => {
            const cur = currentAmount(p, r.key);
            return (
              <div key={r.key} className="flex items-center gap-2 rounded-xl bg-slate-950/50 border border-slate-800 px-2.5 py-2">
                <img src={r.icon} alt="" className="w-7 h-7 object-contain shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold text-slate-100 truncate">{r.label}</span>
                  <span className="block text-[11px] text-slate-400 tabular-nums">{cur === null ? 'добавляет по 5 камней' : `Сейчас: ${fmt(cur)}`}</span>
                </span>
                <button onClick={() => change(r.key, r.label, -1)} className="w-9 h-9 shrink-0 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 flex items-center justify-center active:scale-90 transition-transform" aria-label="Списать"><Minus className="w-4 h-4" /></button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={amounts[r.key] ?? ''}
                  onChange={(e) => setAmounts((a) => ({ ...a, [r.key]: e.target.value }))}
                  placeholder="0"
                  className="w-16 sm:w-24 h-9 rounded-lg border border-slate-700 bg-slate-900 px-2 text-center text-sm text-white focus:outline-none focus:border-sky-500"
                />
                <button onClick={() => change(r.key, r.label, 1)} className="w-9 h-9 shrink-0 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center justify-center active:scale-90 transition-transform" aria-label="Выдать"><Plus className="w-4 h-4" /></button>
              </div>
            );
          })}
        </div>
      </Panel>


      <Panel title="Билеты игрового зала" icon={<Ticket className="w-4 h-4"/>} right={
        <button onClick={loadExtra} type="button" title="Обновить билеты"><RotateCcw size={16}/></button>
      }>
        <div className="grid grid-cols-3 gap-2 mb-3 text-center">
          {([['Билеты',hall?.tickets],['Партий',hall?.played],['Побед',hall?.wins]] as const)
            .map(([label,value])=><div key={label} className="rounded-lg bg-slate-950/60 p-2">
              <strong className="block text-lg text-white">{value??'—'}</strong>
              <span className="text-[11px] text-slate-400">{label}</span>
            </div>)}
        </div>
        <div className="grid grid-cols-[90px_1fr] gap-2">
          <input type="number" step={1} min={-250} max={250} className={inputCls}
            value={ticketQty} onChange={e=>setTicketQty(e.target.value)}/>
          <input type="text" className={inputCls} value={reason} maxLength={140}
            onChange={e=>setReason(e.target.value)} placeholder="Причина"/>
        </div>
        <button type="button" onClick={giveTickets}
          className="mt-2 h-11 rounded-xl bg-sky-600 w-full font-bold text-sm text-white">
          {Number(ticketQty)<0?'Списать':'Выдать'} билеты этому игроку
        </button>
        <p className="text-xs text-slate-400 mt-2">
          Изменяется сразу на сервере. У игрока максимум 1000 билетов.
        </p>
      </Panel>
      <Panel title="Неполученные награды" icon={<Trash2 size={17}/>}>
        {grants.length===0?<Empty text="Ожидающих наград и писем нет."/>:
         <div className="space-y-2">{grants.map(grant=><div key={grant.id}
           className="rounded-xl border border-slate-700/60 bg-slate-950/45 px-3 py-2.5 flex gap-2 items-center">
           <div className="min-w-0 flex-1">
             <p className="text-xs font-bold">{grant.kind==='mail'?'Письмо: '+(grant.subject||'без темы'):'Корректировка ресурсов'}</p>
             <p className="text-[11px] text-slate-400">{fmtDate(grant.created_at)}</p>
             <p className="text-[10px] text-slate-400 break-all">{JSON.stringify(grant.payload).slice(0,190)}</p>
           </div>
           <button type="button" onClick={()=>cancel(grant)} title="Отменить до получения"
             className="rounded-lg border border-red-500/40 bg-red-950/30 text-red-300 h-9 w-9 shrink-0 flex justify-center items-center">
             <Trash2 size={16}/>
           </button>
         </div>)}</div>}
      </Panel>
      <Panel title="Экипировка (Кузница)" icon={<Hammer className="w-4 h-4" />}>
        <p className="text-[11px] text-amber-200/90 mb-2">Режим владельца: уровень предмета 1–500 независимо от героя. При сохранении сервер сразу пересчитывает атаку, защиту и HP предмета и характеристики персонажа. В открытой игре обновится при синхронизации; для обычных игроков античит остаётся включённым.</p>
        {p.combatStats && <p className="text-[11px] text-emerald-200 mb-2">Боевые статы персонажа: ⚔️ {p.combatStats.attack} · 🛡️ {p.combatStats.defense} · ❤️ {p.combatStats.hp} · ⭐ {p.combatStats.critChance}%</p>}
        {slots.length === 0 ? <Empty text="Нет надетой экипировки" /> : (
          <div className="space-y-2">
            {slots.map((slot) => (
              <div key={slot} className="flex items-center gap-2 rounded-xl bg-slate-950/50 border border-slate-800 px-2.5 py-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold text-slate-100 truncate">{p.equipped[slot].name}</span>
                  <span className="block text-[11px] text-slate-400">{SLOT_LABELS[slot] ?? slot} · ур. {p.equipped[slot].level}{p.equipped[slot].adminTestLevel ? ' · Тест' : ''}</span>
                  <span className="block text-[11px] text-emerald-200/90">{[
                    p.equipped[slot].attack > 0 ? `⚔️ +${p.equipped[slot].attack}` : '',
                    p.equipped[slot].defense > 0 ? `🛡️ +${p.equipped[slot].defense}` : '',
                    p.equipped[slot].hp > 0 ? `❤️ +${p.equipped[slot].hp}` : '',
                    p.equipped[slot].critChance > 0 ? `⭐ +${p.equipped[slot].critChance}%` : '',
                  ].filter(Boolean).join(' · ')}</span>
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={500}
                  value={levels[slot] ?? ''}
                  onChange={(e) => setLevels((l) => ({ ...l, [slot]: e.target.value }))}
                  placeholder={String(p.equipped[slot].level)}
                  className="w-16 h-9 rounded-lg border border-slate-700 bg-slate-900 px-2 text-center text-sm text-white focus:outline-none focus:border-sky-500"
                />
                <button onClick={() => saveLevel(slot)} className="h-9 px-3 shrink-0 rounded-lg bg-sky-600 text-xs font-bold text-white hover:bg-sky-500 transition-colors">Сохранить</button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

export function PlayersTab({ confirm }: { confirm: Confirm }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlayerSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [suspicious, setSuspicious] = useState<(PlayerSummary & { goldPerHour: number; auditCount?: number })[] | null>(null);
  const [auditSummary, setAuditSummary] = useState<{ events: number; players: number; nearAdminGrant: number; available: boolean } | null>(null);
  const [auditError, setAuditError] = useState(false);
  const loadSuspicious = useCallback(() => {
    setAuditError(false);
    void adminCall<{
      players: (PlayerSummary & { goldPerHour: number; auditCount?: number })[];
      auditSummary?: { events: number; players: number; nearAdminGrant: number; available: boolean };
    }>('suspicious')
      .then((r) => { setSuspicious(r.players); setAuditSummary(r.auditSummary ?? null); })
      .catch(() => { setAuditError(true); });
  }, []);
  useEffect(() => { loadSuspicious(); }, [loadSuspicious]);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const r = await adminCall<{ players: PlayerSummary[] }>('search', { query });
      setResults(r.players);
      if (r.players.length === 1) setOpenId(r.players[0].id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  if (openId) return <PlayerProfile id={openId} confirm={confirm} onBack={() => setOpenId(null)} />;

  return (
    <div className="space-y-4">
      <ActivityPanel onOpen={setOpenId} />
      <Panel title="Поиск игрока" icon={<Search className="w-4 h-4" />}>
        <form onSubmit={search} className="flex gap-2">
          <input className={inputCls} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Telegram ID или @username" />
          <button disabled={searching} className="h-11 px-4 shrink-0 rounded-xl bg-sky-600 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-50 transition-colors">Найти</button>
        </form>
        <div className="mt-3 space-y-2">
          <ErrorLine text={error} />
          {results && results.length === 0 && <Empty text="Никого не найдено" />}
          {results && results.length > 1 && results.map((p) => <PlayerRow key={p.id} p={p} onOpen={() => setOpenId(p.id)} />)}
        </div>
      </Panel>

      <Panel title="Подозрительные игроки" icon={<ShieldAlert className="w-4 h-4 text-amber-400" />}>
        <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
          Сигналы для ручной проверки, а НЕ доказательство нарушения. Автоматических банов нет. Результаты включают аномальный рост ресурсов и журнал подозрительных начислений за последние 7 суток. Прежде чем предупредить игрока, сверяй награды и рассылки.
        </p>
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-950/20 px-2.5 py-2">
          <span className="text-xs text-amber-100">
            {auditSummary?.available
              ? `Аудит: ${auditSummary.events} сигналов у ${auditSummary.players} игроков · совпадений по времени с письмами: ${auditSummary.nearAdminGrant}`
              : 'Аудит начислений: нет подтверждённых данных'}
          </span>
          <button type="button" onClick={loadSuspicious}
            className="shrink-0 rounded-lg border border-amber-400/40 px-2 py-1 text-[11px] font-semibold text-amber-200">Обновить</button>
        </div>
        {auditError && <p className="mb-2 text-xs text-rose-300">Не удалось обновить сигналы. Старый список сохранён.</p>}
        {!suspicious ? <Loading /> : suspicious.length === 0 ? <Empty text="Подозрительных игроков нет" /> : (
          <div className="space-y-2">
            {suspicious.map((p) => (
              <PlayerRow key={p.id} p={p} onOpen={() => setOpenId(p.id)} extra={
                <span className="mt-1 flex flex-wrap gap-1">
                  {p.reasons?.map((r) => <span key={r} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">{r}</span>)}
                </span>
              } />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
