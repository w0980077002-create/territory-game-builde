import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock3, RefreshCw, UserRound, Wifi } from 'lucide-react';
import { adminCall, type ActivityPeriod, type PlayerActivity } from '@/admin/api';
import { Empty, ErrorLine, Loading, Panel, fmtDate } from '@/admin/ui';

const PERIODS: { id: ActivityPeriod; label: string }[] = [
  { id: 'online', label: 'Сейчас' },
  { id: 'today', label: 'Сегодня' },
  { id: 'week', label: '7 дней' },
];

const PAGE_SIZE = 50;

export function ActivityPanel({ onOpen }: { onOpen: (playerId: string) => void }) {
  const [period, setPeriod] = useState<ActivityPeriod>('online');
  const [players, setPlayers] = useState<PlayerActivity[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPlayers = useRef<PlayerActivity[]>([]);
  const requestId = useRef(0);

  const load = useCallback(async (append = false) => {
    const id = ++requestId.current;
    const offset = append ? currentPlayers.current.length : 0;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await adminCall<{ players: PlayerActivity[]; hasMore: boolean }>(
        'activity', { period, offset },
      );
      if (id !== requestId.current) return;
      const next = append ? [...currentPlayers.current, ...response.players] : response.players;
      currentPlayers.current = next;
      setPlayers(next);
      setHasMore(response.hasMore && next.length < 5000);
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [period]);

  useEffect(() => {
    currentPlayers.current = [];
    setPlayers([]);
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => {
      requestId.current++;
      clearInterval(interval);
    };
  }, [load]);

  return (
    <Panel title="Активность игроков" icon={<Wifi className="w-4 h-4" />} right={
      <button type="button" onClick={() => void load()} aria-label="Обновить активность"
        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
        <RefreshCw className="w-4 h-4" />
      </button>
    }>
      <p className="text-xs text-slate-400 mb-3 leading-relaxed">
        Сейчас — активность за последние 5 минут; сегодня — с 00:00 по Киеву;
        7 дней — последние 168 часов. Данные обновляются каждые 30 секунд.
      </p>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {PERIODS.map(({ id, label }) => (
          <button key={id} type="button" aria-pressed={period === id}
            onClick={() => setPeriod(id)}
            className={`h-10 rounded-xl text-xs font-semibold border transition-colors ${
              period === id
                ? 'bg-sky-600/30 text-sky-100 border-sky-500'
                : 'bg-slate-950/60 text-slate-400 border-slate-700/70 hover:text-white'
            }`}>
            {label}
          </button>
        ))}
      </div>
      <ErrorLine text={error} />
      {loading && players.length === 0 ? <Loading /> : players.length === 0 ? (
        <Empty text={error ? 'Не удалось загрузить список' : 'За этот период игроков нет'} />
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-400">Показано игроков: {players.length}</p>
          {players.map((p) => (
            <button key={p.id} type="button" onClick={() => onOpen(p.id)}
              className="w-full flex items-center gap-2.5 rounded-xl border border-slate-700/60 bg-slate-950/50 px-3 py-3 text-left hover:border-sky-500/50 transition-colors">
              <span className="w-9 h-9 shrink-0 rounded-full bg-slate-800 flex items-center justify-center">
                <UserRound className="w-4 h-4 text-sky-300" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white truncate">{p.name || 'Герой'}</span>
                  {p.banned && <span className="text-[10px] text-red-300">БАН</span>}
                </span>
                <span className="block text-[11px] text-slate-400 truncate">
                  {p.username ? `@${p.username} · ` : ''}TG {p.telegramId ?? '—'} · ур. {p.level}
                </span>
                <span className="flex items-center gap-1 mt-1 text-[11px] text-slate-400">
                  {period === 'online'
                    ? <Wifi className="w-3 h-3 text-emerald-400" />
                    : period === 'today'
                      ? <Clock3 className="w-3 h-3" />
                      : <CalendarDays className="w-3 h-3" />}
                  Последний визит: {fmtDate(p.lastSeenAt)}
                </span>
              </span>
              <span className="shrink-0 text-[11px] font-semibold text-sky-300">Открыть ›</span>
            </button>
          ))}
          {hasMore && (
            <button type="button" disabled={loadingMore || loading} onClick={() => void load(true)}
              className="w-full h-10 rounded-xl border border-sky-500/30 bg-sky-500/10 text-xs font-bold text-sky-200 disabled:opacity-50">
              {loadingMore ? 'Загрузка…' : `Показать ещё ${PAGE_SIZE}`}
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}
