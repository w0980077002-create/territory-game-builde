import { useCallback, useEffect, useState } from 'react';
import { Globe2, RefreshCw, Users, Wifi, Clock3, CalendarDays } from 'lucide-react';
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4">
          <Globe2 className="mb-2 h-6 w-6 text-sky-300" />
          <div className="text-2xl font-bold tabular-nums">{fmt(countries.length)}</div>
          <div className="text-xs text-slate-400">Стран подключения</div>
        </div>
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4">
          <Users className="mb-2 h-6 w-6 text-emerald-300" />
          <div className="text-2xl font-bold tabular-nums">{fmt(data?.trackedPlayers ?? 0)}</div>
          <div className="text-xs text-slate-400">Игроков с определённой страной</div>
        </div>
      </div>
      <Panel title="География игроков" icon={<Globe2 className="w-4 h-4" />} right={
        <button onClick={() => void load()} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Обновить географию">
          <RefreshCw className="w-4 h-4" />
        </button>
      }>
        <p className="mb-3 text-xs leading-relaxed text-slate-400">
          Страна определяется приблизительно по подключению. VPN и прокси могут менять её.
          Время активности берётся из системы онлайна TERRITORY.
        </p>
        {loading && !data ? <Loading /> : null}
        <ErrorLine text={error} />
        {!loading && data && countries.length === 0 ? <Empty text="Страны ещё не определены. Статистика появится после запуска серверного сбора и новых входов игроков." /> : null}
        {countries.length > 0 && (
          <>
            {/* Full-size comparison table stays visible on tablets and desktops. */}
            <div className="hidden sm:block overflow-x-auto rounded-xl border border-slate-700/70">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead className="bg-slate-800/80 text-slate-400">
                  <tr>
                    <th className="px-3 py-3 font-semibold">Страна</th>
                    <th className="px-2 py-3 text-right font-semibold"><span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />Всего</span></th>
                    <th className="px-2 py-3 text-right font-semibold" title="За последние 5 минут"><span className="inline-flex items-center gap-1"><Wifi className="w-3 h-3" />Сейчас</span></th>
                    <th className="px-2 py-3 text-right font-semibold"><span className="inline-flex items-center gap-1"><Clock3 className="w-3 h-3" />Сегодня</span></th>
                    <th className="px-3 py-3 text-right font-semibold"><span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />7 дней</span></th>
                  </tr>
                </thead>
                <tbody>
                  {countries.map((c) => (
                    <tr key={c.code} className="border-t border-slate-800 hover:bg-slate-800/40">
                      <td className="px-3 py-3 font-semibold text-slate-100"><span className="mr-2">{flag(c.code)}</span>{countryName(c.code)}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{fmt(c.players)}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-emerald-300">{fmt(c.online)}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{fmt(c.today)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmt(c.week)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* On small phones display every metric without horizontal scrolling. */}
            <div className="sm:hidden space-y-2" aria-label="Статистика стран">
              {countries.map((c) => (
                <div key={c.code} className="min-w-0 rounded-xl border border-slate-700/70 bg-slate-950/40 p-3">
                  <div className="mb-3 flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-100">
                    <span className="text-lg leading-none" aria-hidden="true">{flag(c.code)}</span>
                    <span className="min-w-0 break-words">{countryName(c.code)}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-center">
                    {([
                      ['Всего', c.players, false],
                      ['Сейчас', c.online, true],
                      ['Сегодня', c.today, false],
                      ['7 дней', c.week, false],
                    ] as const).map(([label, count, current]) => (
                      <div key={label} className="min-w-0 rounded-lg bg-slate-800/50 py-2 px-0.5">
                        <div className="text-[10px] leading-4 text-slate-400">{label}</div>
                        <div className={`text-base font-bold tabular-nums ${current ? 'text-emerald-300' : 'text-slate-100'}`}>{fmt(count)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <p className="mt-3 text-[11px] text-slate-500">
          Сегодня — с 00:00 по Киеву; «Сейчас» — 5 минут; «7 дней» — последние 168 часов.
          Данные учитываются после подключения географии; исторические посещения не восстанавливаются.
        </p>
      </Panel>
    </div>
  );
}
