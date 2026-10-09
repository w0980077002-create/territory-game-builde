import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Ban, Hammer, Minus, Plus, Search, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react';
import { RESOURCES, adminCall, payloadFor, type PlayerSummary } from '@/admin/api';
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

function PlayerProfile({ id, confirm, onBack }: { id: string; confirm: Confirm; onBack: () => void }) {
  const [p, setP] = useState<PlayerSummary | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [levels, setLevels] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    adminCall<{ player: PlayerSummary; pendingAdjustments: number }>('player', { playerId: id })
      .then((r) => {
        setP(r.player);
        setPending(r.pendingAdjustments);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);

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
    const level = Math.floor(Number(levels[slot]));
    if (!level || level < 1 || level > 1000) return setError('Уровень должен быть от 1 до 1000');
    setError(null);
    confirm(`Установить уровень ${level} для «${p.equipped[slot].name}» (${SLOT_LABELS[slot]})`, async () => {
      await adminCall('adjust', { playerId: p.id, payload: { equipLevels: { [slot]: level } } });
      load();
      return `Уровень экипировки изменён на ${level}`;
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

      <Panel title="Экипировка (Кузница)" icon={<Hammer className="w-4 h-4" />}>
        {slots.length === 0 ? <Empty text="Нет надетой экипировки" /> : (
          <div className="space-y-2">
            {slots.map((slot) => (
              <div key={slot} className="flex items-center gap-2 rounded-xl bg-slate-950/50 border border-slate-800 px-2.5 py-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold text-slate-100 truncate">{p.equipped[slot].name}</span>
                  <span className="block text-[11px] text-slate-400">{SLOT_LABELS[slot] ?? slot} · ур. {p.equipped[slot].level}</span>
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
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
  const [suspicious, setSuspicious] = useState<(PlayerSummary & { goldPerHour: number })[] | null>(null);

  useEffect(() => {
    adminCall<{ players: (PlayerSummary & { goldPerHour: number })[] }>('suspicious')
      .then((r) => setSuspicious(r.players))
      .catch(() => setSuspicious([]));
  }, []);

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
        <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
          Помечаются игроки, у которых монеты растут быстрее 5 000 в час с момента регистрации, уровень растёт быстрее 15 в день, или слишком много алмазов.
        </p>
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
