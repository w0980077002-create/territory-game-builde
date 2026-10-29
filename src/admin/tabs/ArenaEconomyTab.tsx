import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, BarChart3, Coins, FlaskConical, RefreshCw, Shield, Swords, Trophy, Wallet } from 'lucide-react';
import { adminCall } from '@/admin/api';
import { ErrorLine, Loading, Panel, fmt, fmtDate } from '@/admin/ui';

type Period = 1 | 7 | 30;
type Data = {
  period: Period; from: string; to: string;
  battles: { finished: number; allParticipants: number; uniquePlayers: number;
    botDuels: number; humanWins: number; botWins: number; draws: number };
  wallet: { events: number; goldOut: number; gemsOut: number; stonesOut: number;
    goldIn: number; gemsIn: number; stoneIn: number };
  consumables: { total: number; users: number; byKind: Record<string, number> };
  rewards: { claimed: number; goldComputed: number; top50MailCreated: number;
    top50MailClaimed: number; redGemsGranted: number; redGemsClaimed: number };
  daily: { date: string; duels: number; humanWins: number; botWins: number }[];
  topPlayers: { name: string; fights: number; wins: number; losses: number }[];
};
const PERIODS: { days: Period; label: string }[] = [
  { days: 1, label: 'Сегодня' }, { days: 7, label: '7 дней' }, { days: 30, label: '30 дней' },
];
const KIND_NAMES: Record<string, string> = {
  attack: 'Эликсир силы', defense: 'Эликсир защиты', crit: 'Эликсир крита',
  heal_small: 'Малое зелье HP', heal_large: 'Большое зелье HP',
  time: 'Зелье времени', adrenaline: 'Адреналин',
};
const ITEM_ORDER = ['attack', 'defense', 'crit', 'heal_small', 'heal_large', 'time', 'adrenaline'];
const pct = (part: number, total: number) => total ? (100 * part / total).toFixed(1) + '%' : '—';

function Metric({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return <div className="rounded-xl border border-slate-700/70 bg-slate-950/60 p-3 min-w-0">
    <div className="text-lg sm:text-xl text-white font-bold tabular-nums break-all">
      {typeof value === 'number' ? fmt(value) : value}
    </div>
    <div className="text-xs font-semibold text-slate-300 mt-1">{label}</div>
    {note && <div className="text-[10px] text-slate-500 mt-1 leading-snug">{note}</div>}
  </div>;
}

export function ArenaEconomyTab() {
  const [period, setPeriod] = useState<Period>(7);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await adminCall<Data>('arena_economy', { days: period });
      if (id === request.current) setData(result);
    } catch (e) {
      if (id === request.current) { setData(null); setError((e as Error).message); }
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
    return () => { request.current++; };
  }, [load]);

  const b = data?.battles;
  const decisive = b ? b.humanWins + b.botWins : 0;
  const botPct = b && decisive ? 100 * b.botWins / decisive : 0;
  const humanPct = b && decisive ? 100 * b.humanWins / decisive : 0;
  const items = data?.consumables.byKind ?? {};
  const days = data?.daily ?? [];
  const peak = Math.max(1, ...days.map(d => d.duels));

  return <div className="space-y-4">
    <Panel title="Экономика Арены" icon={<BarChart3 size={18} />} right={
      <button type="button" aria-label="Обновить экономику" disabled={loading}
        onClick={() => void load()} className="h-8 w-8 rounded-lg grid place-items-center text-slate-300 hover:bg-slate-800 disabled:opacity-50">
        <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
      </button>
    }>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {PERIODS.map(p => <button type="button" key={p.days} onClick={() => setPeriod(p.days)}
          aria-pressed={period === p.days}
          className={`h-10 text-xs font-semibold rounded-xl border ${period === p.days ? 'border-sky-400 bg-sky-500/20 text-sky-100' : 'border-slate-700 bg-slate-950 text-slate-400'}`}>
          {p.label}
        </button>)}
      </div>
      {data && <p className="text-[11px] text-slate-400 mb-2">
        Период: {fmtDate(data.from)} — {fmtDate(data.to)}. День — с 00:00 UTC, остальные периоды скользящие.
      </p>}
      <p className="text-[11px] text-slate-400">Данные из базы игры. Обновление вручную; это не данные виртуального ТОП-50.</p>
      <ErrorLine text={error} />
      {loading && !data && <Loading />}
    </Panel>

    {data && <>
      <Panel title="Результаты настоящих боёв" icon={<Swords size={17} />}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Metric label="Завершено боёв" value={data.battles.finished} />
          <Metric label="Участий игроков" value={data.battles.allParticipants} />
          <Metric label="Уникальных игроков" value={data.battles.uniquePlayers} />
          <Metric label="Дуэлей с ботами" value={data.battles.botDuels} />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold">
          <span className="text-orange-300">Боты: {pct(b!.botWins, decisive)}</span>
          <span className="text-sky-300">Игроки: {pct(b!.humanWins, decisive)}</span>
        </div>
        <div role="img" aria-label="Доля побед ботов и игроков" className="mt-2 h-4 bg-slate-700 rounded-full overflow-hidden flex">
          <div className="bg-orange-400 h-full" style={{ width: `${botPct}%` }} />
          <div className="bg-sky-400 h-full" style={{ width: `${humanPct}%` }} />
        </div>
        <p className="text-xs text-slate-300 mt-2">
          Победы ботов: <b>{fmt(b!.botWins)}</b> · победы игроков: <b>{fmt(b!.humanWins)}</b> · ничьи: <b>{fmt(b!.draws)}</b>
        </p>
        <p className="text-[11px] text-slate-400 mt-2">
          Цель: 51% побед ботов / 49% игроков в решающих дуэлях без расходников.
          Текущий показатель считает все завершённые дуэли периода, независимо от применённых зелий.
          Включает бои до изменения баланса 29.10.2026.
        </p>
      </Panel>

      <Panel title="Динамика дуэлей по дням (UTC)" icon={<Activity size={17} />}>
        <div className="space-y-2">
          {days.map((d, i) => <div key={i} className="grid grid-cols-[43px_1fr_48px] items-center gap-2">
            <span className="text-[10px] text-slate-400">{d.date}</span>
            <div className="h-3.5 bg-slate-800 rounded-full overflow-hidden flex">
              <div className="bg-orange-400" style={{ width: `${100 * d.botWins / peak}%` }} />
              <div className="bg-sky-400" style={{ width: `${100 * d.humanWins / peak}%` }} />
              <div className="bg-slate-500" style={{ width: `${100 * Math.max(0, d.duels - d.botWins - d.humanWins) / peak}%` }} />
            </div>
            <span className="text-[11px] font-semibold tabular-nums text-right">{fmt(d.duels)}</span>
          </div>)}
          <div className="flex flex-wrap gap-3 text-[11px] text-slate-400 mt-2">
            <span>🟠 боты</span><span>🔵 игроки</span><span>⚪ ничьи</span>
          </div>
        </div>
      </Panel>

      <Panel title="Использованные в боях эликсиры и зелья" icon={<FlaskConical size={17} />}>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Metric label="Расходников применено" value={data.consumables.total} />
          <Metric label="Игроков применяли" value={data.consumables.users} />
        </div>
        <div className="space-y-1.5">
          {ITEM_ORDER.map(kind => <div key={kind} className="flex justify-between items-center gap-2 border-b border-slate-800 py-2">
            <span className="text-xs text-slate-300">{KIND_NAMES[kind]}</span>
            <b className="text-sm text-amber-200 tabular-nums">{fmt(items[kind] ?? 0)}</b>
          </div>)}
        </div>
        <p className="text-[11px] text-amber-200/90 mt-3">
          Точный серверный учёт использования начался 29.10.2026.
          Нулевые значения за прошлые дни не означают, что игроки ничего не применяли.
          Покупки в лавке и использование в бою — разные действия.
        </p>
      </Panel>

      <Panel title="Движение валют всей игры" icon={<Wallet size={17} />}>
        <p className="text-[11px] text-amber-200/90 mb-3">
          Списания ниже — из всех режимов TERRITORY, а НЕ подтверждённые покупки эликсиров и боевых камней.
          История старых покупок по товарам на сервере отсутствует.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Монет списано" value={data.wallet.goldOut} />
          <Metric label="Монет добавлено" value={data.wallet.goldIn} />
          <Metric label="Синих списано" value={data.wallet.gemsOut} />
          <Metric label="Синих добавлено" value={data.wallet.gemsIn} />
          <Metric label="Камней списано" value={data.wallet.stonesOut} />
          <Metric label="Камней добавлено" value={data.wallet.stoneIn} />
        </div>
        <p className="text-[11px] text-slate-500 mt-2">Событий изменений кошелька: {fmt(data.wallet.events)}.</p>
      </Panel>

      <Panel title="Полученные награды" icon={<Trophy size={17} />}>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Награды за бой получены" value={data.rewards.claimed} />
          <Metric label="Золота за бои" value={data.rewards.goldComputed} note="Расчёт по завершённым боям с полученной наградой" />
          <Metric label="Писем за ТОП-50 создано" value={data.rewards.top50MailCreated} />
          <Metric label="Писем за ТОП-50 забрано" value={data.rewards.top50MailClaimed} />
          <Metric label="Красных назначено" value={data.rewards.redGemsGranted} />
          <Metric label="Красных получено" value={data.rewards.redGemsClaimed} />
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Призы за ТОП-50 учитываются отдельно от награды за обычные бои.</p>
      </Panel>

      <Panel title="Самые активные бойцы" icon={<Shield size={17} />}>
        <p className="text-[11px] text-slate-400 mb-3">Только живые игроки. Победы и поражения — по завершённым боям выбранного периода.</p>
        {data.topPlayers.length ? <div className="space-y-1">
          {data.topPlayers.map((row, i) => <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-950/50 p-2">
            <span className="w-6 shrink-0 text-xs text-amber-300 font-bold">{i + 1}</span>
            <span className="flex-1 min-w-0 text-xs font-semibold text-slate-100 truncate">{row.name}</span>
            <span className="text-[11px] tabular-nums text-right text-slate-300 shrink-0">
              <b>{fmt(row.fights)}</b> боёв · <span className="text-emerald-300">{fmt(row.wins)} П</span> · {fmt(row.losses)} Пор
            </span>
          </div>)}
        </div> : <p className="text-xs text-slate-500">Нет завершённых боёв за период.</p>}
      </Panel>

      <Panel title="Что означают показатели" icon={<Coins size={17} />}>
        <p className="text-xs leading-relaxed text-slate-400">
          Победы Арены, отправленные письма и серверный расход зелий подтверждены базой.
          Покупки предметов за монеты пока нельзя отделить от остальных трат без отдельного учёта продаж.
          Награды и остатки кошельков игроков эта вкладка не изменяет.
        </p>
      </Panel>
    </>}
  </div>;
}
