import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Clock3, RefreshCw, UserPlus, Users } from 'lucide-react';
import { adminCall } from '@/admin/api';
import { Empty, ErrorLine, Loading, Panel, fmt } from '@/admin/ui';

type Period = 'today' | 'week' | 'all';
type Registration = {
  id: string;
  telegramId: number | null;
  username: string | null;
  name: string;
  level: number;
  country: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  online: boolean;
};
type NewPlayersResponse = {
  today: number;
  week: number;
  total: number;
  players: Registration[];
  hasMore: boolean;
  asOf: string;
};

const PAGE_SIZE = 30;
const FILTERS: { key: Period; title: string }[] = [
  { key: 'today', title: 'Сегодня' },
  { key: 'week', title: '7 дней' },
  { key: 'all', title: 'Все' },
];
const countryNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['ru'], { type: 'region' }) : null;

function countryLabel(code: string | null) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return 'Страна неизвестна';
  return countryNames?.of(code) ?? code;
}
function countryFlag(code: string | null) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0)));
}
function utcDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) + ' UTC';
}

export function NewPlayersTab() {
  const [period, setPeriod] = useState<Period>('today');
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<NewPlayersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await adminCall<NewPlayersResponse>('new_players', {
          period, offset: page * PAGE_SIZE,
        });
        if (!Array.isArray(response.players) ||
            ![response.today, response.week, response.total].every((n) => Number.isSafeInteger(n) && n >= 0)) {
          throw new Error('Не удалось проверить список регистраций');
        }
        if (!active) return;
        setResult(response);
        setError(null);
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [period, page, refresh]);

  const changePeriod = (value: Period) => {
    if (value === period) return;
    setPage(0);
    setResult(null);
    setPeriod(value);
  };

  return (
    <div className="space-y-3">
      <Panel title="Новые игроки" icon={<UserPlus className="w-4 h-4" />} right={
        <button type="button" onClick={reload}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          title="Обновить данные" aria-label="Обновить новых игроков">
          <RefreshCw className="w-4 h-4" />
        </button>
      }>
        <div className="grid grid-cols-3 gap-2" aria-label="Новые регистрации">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-2 py-3 text-center">
            <Clock3 className="mx-auto mb-1 h-4 w-4 text-emerald-300" />
            <div className="text-xl font-bold tabular-nums text-emerald-200">{result ? fmt(result.today) : '—'}</div>
            <div className="text-[10px] text-slate-300">Сегодня</div>
          </div>
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-2 py-3 text-center">
            <CalendarDays className="mx-auto mb-1 h-4 w-4 text-sky-300" />
            <div className="text-xl font-bold tabular-nums text-sky-200">{result ? fmt(result.week) : '—'}</div>
            <div className="text-[10px] text-slate-300">За 7 дней</div>
          </div>
          <div className="rounded-xl border border-slate-600/50 bg-slate-800/50 px-2 py-3 text-center">
            <Users className="mx-auto mb-1 h-4 w-4 text-slate-300" />
            <div className="text-xl font-bold tabular-nums text-white">{result ? fmt(result.total) : '—'}</div>
            <div className="text-[10px] text-slate-300">Всего</div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Именно регистрации по времени создания аккаунта. Сегодня — с 00:00 UTC.
          7 дней — последние 168 часов. Автоматическое обновление каждые 30 секунд.
        </p>
      </Panel>
      <Panel title="Последние регистрации" icon={<UserPlus className="h-4 w-4" />}>
        <div className="mb-3 grid grid-cols-3 gap-1.5">
          {FILTERS.map((filter) => (
            <button type="button" key={filter.key} onClick={() => changePeriod(filter.key)}
              aria-pressed={period === filter.key}
              className={`h-10 rounded-lg border px-2 text-xs font-semibold transition-colors ${period === filter.key
                ? 'border-sky-500/60 bg-sky-500/20 text-sky-200'
                : 'border-slate-700 bg-slate-950/50 text-slate-400 hover:text-white'}`}>
              {filter.title}
            </button>
          ))}
        </div>
        <ErrorLine text={error} />
        {loading && !result && <Loading />}
        {!loading && result && result.players.length === 0 && <Empty text="За выбранный период новых игроков нет." />}
        {result && result.players.length > 0 && (
          <div className="space-y-2" aria-label="Список новых игроков">
            {result.players.map((p) => (
              <div key={p.id} className="min-w-0 rounded-xl border border-slate-700/70 bg-slate-950/50 p-3">
                <div className="flex min-w-0 items-start gap-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-200">
                    <UserPlus className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-slate-100">{p.name?.trim() || 'Без имени'}</div>
                    <div className="truncate text-[11px] text-slate-400">
                      {p.username ? `@${p.username} · ` : ''}TG {p.telegramId ?? '—'} · ур. {p.level}
                    </div>
                  </div>
                  {p.online && (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-300">В сети</span>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-y-1 border-t border-slate-800/70 pt-2 text-[11px] text-slate-400">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0">{countryFlag(p.country)}</span>
                    <span className="truncate">{countryLabel(p.country)}</span>
                  </div>
                  <div className="text-slate-300">Зарегистрирован: <span className="font-medium">{utcDate(p.createdAt)}</span></div>
                  <div>Последний визит: {utcDate(p.lastSeenAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {result && (page > 0 || result.hasMore) && (
          <div className="mt-3 flex items-center justify-between gap-2 text-xs">
            <button type="button" disabled={loading || page === 0} onClick={() => setPage((v) => Math.max(0, v - 1))}
              className="h-10 rounded-lg border border-slate-700 px-3 text-slate-200 disabled:opacity-40">Назад</button>
            <span className="text-slate-400">Страница {page + 1}</span>
            <button type="button" disabled={loading || !result.hasMore} onClick={() => setPage((v) => v + 1)}
              className="h-10 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 font-semibold text-sky-200 disabled:opacity-40">Дальше</button>
          </div>
        )}
      </Panel>
    </div>
  );
}
