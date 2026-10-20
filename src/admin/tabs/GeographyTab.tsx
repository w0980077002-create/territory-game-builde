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
type GeoData = { trackedPlayers: number; countries: GeoCountry[] };
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
      if (!Array.isArray(response.countries) || !Number.isSafeInteger(response.trackedPlayers)) {
        throw new Error('Некорректная статистика');
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

  return (
    <div className="space-y-2">
      <Panel title="География игроков" icon={<Globe2 className="w-4 h-4" />} right={
        <button onClick={() => void load()} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Обновить географию">
          <RefreshCw className="w-4 h-4" />
        </button>
      }>
        {/* The former two large statistic cards consumed most of a phone screen. */}
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-800/40 px-2.5 py-1.5 text-xs" aria-label="Общая статистика географии">
          <span className="whitespace-nowrap text-slate-300">🌍 Стран: <strong className="text-sky-200">{fmt(countries.length)}</strong></span>
          <span className="whitespace-nowrap text-slate-300">👥 Игроков: <strong className="text-emerald-200">{fmt(data?.trackedPlayers ?? 0)}</strong></span>
        </div>
        {loading && !data && <Loading />}
        <ErrorLine text={error} />
        {!loading && data && countries.length === 0 && (
          <Empty text="Пока нет игроков с определённой страной подключения." />
        )}
        {countries.length > 0 && (
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
                  <th scope="col" className="px-0.5 text-center font-semibold" title="Сегодня с 00:00 по Киеву" aria-label="Сегодня">Сег.</th>
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
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[10px] leading-4 text-slate-500">
          Страна по подключению (VPN может менять её). Сегодня — с 00:00 по Киеву, онлайн — 5 мин.
        </p>
      </Panel>
    </div>
  );
}
