import { useCallback, useEffect, useState } from 'react';
import { Globe2, RefreshCw } from 'lucide-react';
import { adminCall } from '@/admin/api';
import { Empty, ErrorLine, Loading, Panel, fmt } from '@/admin/ui';

type GeoCountry = {
  code: string;
  players: number;
  online: number;
  today: number;
  week: number;
};
type GeoData = {
  totalPlayers: number;
  trackedPlayers: number;
  unknownPlayers: number;
  onlinePlayers: number;
  todayPlayers: number;
  weekPlayers: number;
  unknown: Omit<GeoCountry, 'code'>;
  lastGeoObservedAt: string | null;
  countries: GeoCountry[];
};
type RegionNames = { of(code: string): string | undefined };
const DisplayNames = (Intl as unknown as {
  DisplayNames?: new (locales: string[], options: { type: 'region' }) => RegionNames;
}).DisplayNames;
const names = DisplayNames ? new DisplayNames(['ru'], { type: 'region' }) : null;

function countryName(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return 'Неизвестно';
  return names?.of(code) ?? code;
}
function flag(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return '🌍';
  return String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0)));
}

// Fits the real Telegram mobile viewport inside the admin panel's 16px padding.
// A percentage-based table does not need sideways scrolling, even on 320px phones.
const metricColumns = [44, 14, 14, 14, 14] as const;

export function GeographyTab() {
  const [data, setData] = useState<GeoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await adminCall<GeoData>('geo_stats');
      if (!Array.isArray(response.countries) ||
          ![response.totalPlayers, response.trackedPlayers, response.unknownPlayers,
            response.onlinePlayers, response.todayPlayers, response.weekPlayers]
            .every((value) => Number.isSafeInteger(value) && value >= 0) ||
          response.totalPlayers !== response.trackedPlayers + response.unknownPlayers ||
          !response.unknown) {
        throw new Error('Некорректная статистика географии');
      }
      setData(response);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const countries = data?.countries ?? [];
  const lastGeoAt = data?.lastGeoObservedAt ? new Date(data.lastGeoObservedAt) : null;
  const staleGeo = lastGeoAt && Date.now() - lastGeoAt.getTime() > 48 * 60 * 60 * 1000;

  return (
    <div className="space-y-2">
      <Panel title="География игроков" icon={<Globe2 className="w-4 h-4" />} right={
        <button onClick={() => void load()} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Обновить географию">
          <RefreshCw className="w-4 h-4" />
        </button>
      }>
        <div className="mb-2 space-y-1.5 rounded-lg bg-slate-800/40 px-2.5 py-2 text-xs" aria-label="Общая статистика географии">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-slate-300">👥 Всего игроков: <strong className="text-white">{fmt(data?.totalPlayers ?? 0)}</strong></span>
            <span className="text-slate-300">🌍 Стран: <strong className="text-sky-200">{fmt(countries.length)}</strong></span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-slate-300">Страна известна: <strong className="text-emerald-200">{fmt(data?.trackedPlayers ?? 0)}</strong></span>
            <span className="text-slate-300">Без страны: <strong className="text-amber-300">{fmt(data?.unknownPlayers ?? 0)}</strong></span>
          </div>
          {data && <div className="text-slate-300 tabular-nums">
            Онлайн: <strong className="text-emerald-300">{fmt(data.onlinePlayers)}</strong>
            {' · '}Сегодня: <strong>{fmt(data.todayPlayers)}</strong>
            {' · '}7 дней: <strong>{fmt(data.weekPlayers)}</strong>
          </div>}
        </div>
        {loading && !data && <Loading />}
        <ErrorLine text={error} />
        {!loading && data && countries.length === 0 && data.unknownPlayers === 0 && (
          <Empty text="Пока нет игроков." />
        )}
        {data && (
          <div className="w-full min-w-0 overflow-hidden rounded-lg border border-slate-700/70">
            <table className="w-full table-fixed border-collapse text-[11px] leading-tight sm:text-xs" aria-label="Игроки по странам">
              <colgroup>
                {metricColumns.map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}
              </colgroup>
              <thead className="bg-slate-800/80 text-slate-300">
                <tr className="h-8">
                  <th scope="col" className="px-1.5 text-left font-semibold">Страна</th>
                  <th scope="col" className="px-0.5 text-center font-semibold" title="Всего игроков" aria-label="Всего игроков">Вс.</th>
                  <th scope="col" className="px-0.5 text-center font-semibold" title="Сейчас: последние 5 минут" aria-label="Сейчас онлайн">Онл.</th>
                  <th scope="col" className="px-0.5 text-center font-semibold" title="Сегодня с 00:00 UTC" aria-label="Сегодня">Сег.</th>
                  <th scope="col" className="px-0.5 text-center font-semibold" title="За последние 7 дней" aria-label="За последние 7 дней">7д</th>
                </tr>
              </thead>
              <tbody>
                {countries.map((c) => (
                  <tr key={c.code} className="h-8 border-t border-slate-800/90 hover:bg-slate-800/40">
                    <td className="overflow-hidden px-1.5 font-medium text-slate-100" title={countryName(c.code)}>
                      <div className="flex min-w-0 items-center gap-1">
                        <span className="shrink-0 text-[13px] leading-none" aria-hidden="true">{flag(c.code)}</span>
                        <span className="min-w-0 truncate">{countryName(c.code)}</span>
                      </div>
                    </td>
                    <td className="px-0.5 text-center font-semibold tabular-nums">{fmt(c.players)}</td>
                    <td className="px-0.5 text-center font-semibold tabular-nums text-emerald-300">{fmt(c.online)}</td>
                    <td className="px-0.5 text-center tabular-nums">{fmt(c.today)}</td>
                    <td className="px-0.5 text-center tabular-nums">{fmt(c.week)}</td>
                  </tr>
                ))}
                {data.unknownPlayers > 0 && (
                  <tr className="h-9 border-t border-amber-500/30 bg-amber-500/5">
                    <th scope="row" className="overflow-hidden px-1.5 text-left font-semibold text-amber-200" title="Страна пока не определена">
                      <span className="truncate block">🌐 Неизвестно</span>
                    </th>
                    <td className="px-0.5 text-center font-semibold tabular-nums text-amber-200">{fmt(data.unknown.players)}</td>
                    <td className="px-0.5 text-center font-semibold tabular-nums text-emerald-300">{fmt(data.unknown.online)}</td>
                    <td className="px-0.5 text-center tabular-nums">{fmt(data.unknown.today)}</td>
                    <td className="px-0.5 text-center tabular-nums">{fmt(data.unknown.week)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {data && <p className="mt-2 text-[10px] leading-4 text-slate-400">
          Последнее определение страны: {lastGeoAt && !Number.isNaN(lastGeoAt.getTime())
            ? lastGeoAt.toLocaleString('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' UTC'
            : 'данных пока нет'}.
          {staleGeo && <span className="block text-amber-300">Сбор стран давно не обновлялся. Страны могут быть устаревшими; остальных игроков показываем как «Неизвестно».</span>}
        </p>}
        <p className="mt-1 text-[10px] leading-4 text-slate-500">
          По последнему определённому подключению (VPN может менять страну). Сегодня — с 00:00 UTC, онлайн — последние 5 минут.
        </p>
      </Panel>
    </div>
  );
}
