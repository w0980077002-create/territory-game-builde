import { useEffect, useState } from 'react';
import { CalendarClock, Crown, ShieldCheck, Trophy, RefreshCcw } from 'lucide-react';
import { seasonWindow, seasonCountdown } from '@/game/seasonCalendar';
import { fetchSeasonStatus, type SeasonStatus } from '@/game/seasonApi';
import { useLanguage } from '@/game/i18n';
import type { AuthUser } from '@/game/auth';

/** Read-only season board. No rewards/points are ever issued by the browser. */
export function SeasonScreen({ user }: { user: AuthUser }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [clock, setClock] = useState(Date.now());
  const [status, setStatus] = useState<SeasonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const week = seasonWindow(clock);

  const refresh = async () => {
    setLoading(true);
    setFailed(false);
    try { setStatus(await fetchSeasonStatus()); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    void refresh();
    const ticker = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(ticker);
  }, []);

  const live = status?.enabled === true && status.week === week.weekKey;
  return (
    <div className="space-y-3 animate-fade-in">
      <div className="card relative overflow-hidden border-amber-400/40 bg-gradient-to-br from-amber-950/50 via-slate-900 to-sky-950/60">
        <div className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-amber-400/10 blur-2xl pointer-events-none" />
        <div className="relative flex items-center gap-3">
          <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-amber-400/10 border border-amber-400/20"><Crown className="text-amber-300" /></div>
          <div>
            <h3 className="font-black text-amber-100 text-lg">{en ? 'Weekly Championship' : 'Недельный чемпионат'}</h3>
          </div>
        </div>
        <div className="relative grid grid-cols-2 gap-2 mt-4">
          <div className="rounded-xl bg-black/25 p-3 border border-white/5">
            <div className="text-[11px] text-slate-400 flex gap-1.5 items-center"><CalendarClock className="w-3.5 h-3.5" />{en ? 'Week ends in' : 'До конца недели'}</div>
            <div className="mt-1 text-lg font-black text-white tabular-nums">{seasonCountdown(week.remainingMs, en ? 'en' : 'ru')}</div>
          </div>
          <div className="rounded-xl bg-black/25 p-3 border border-white/5">
            <div className="text-[11px] text-slate-400">{en ? 'Competition' : 'Соревнование'}</div>
            <div className={`mt-1 font-bold ${live ? 'text-emerald-300' : 'text-amber-300'}`}>
              {live ? en ? 'Active' : 'Активно' : en ? 'Preparing' : 'Подготовка'}
            </div>
          </div>
        </div>
      </div>

      {live ? (
        <>
          <div className="card text-sm">
            <div className="flex justify-between gap-3"><span className="text-slate-300">{en ? 'Your season points' : 'Твои сезонные очки'}</span><b className="text-amber-300">{status.my_points.toLocaleString()}</b></div>
            <div className="flex justify-between gap-3 mt-2"><span className="text-slate-300">{en ? 'Your rank' : 'Твоё место'}</span><b className="text-white">{status.my_rank ? `#${status.my_rank}` : '—'}</b></div>
          </div>
          {status.leaders.map((row) => (
            <div key={row.player_id} className={`card flex items-center gap-3 text-sm ${row.player_id === user.id ? 'border-teal-400/50 bg-teal-900/10' : ''}`}>
              <div className="shrink-0 w-8 text-center text-amber-300 font-black">#{row.rank}</div>
              <div className="min-w-0 flex-1 truncate text-slate-100">{row.display_name}{row.player_id === user.id ? en ? ' (you)' : ' (ты)' : ''}</div>
              <div className="font-black text-amber-200">{row.points}</div>
            </div>
          ))}
          {status.leaders.length === 0 && <div className="card text-slate-400 text-sm text-center">{en ? 'The season has no verified scores yet.' : 'Пока нет подтверждённых сервером результатов.'}</div>}
        </>
      ) : (
        <div className="card space-y-2 border-sky-500/20 bg-sky-950/20">
          <div className="flex items-center gap-2 text-sky-200 font-bold"><ShieldCheck className="w-5 h-5" />{en ? 'Fair play first' : 'Сначала честная игра'}</div>
          <p className="text-sm text-slate-300 leading-relaxed">
            {en
              ? 'The championship will start only after server verification of points and rewards. Local saves cannot create season scores or prizes.'
              : 'Чемпионат запустим только после серверной проверки очков и наград. Локальные сохранения не могут создавать сезонные очки или призы.'}
          </p>
          <div className="flex gap-2 rounded-xl bg-black/20 p-3 text-xs text-amber-200/90"><Trophy className="w-4 h-4 shrink-0" />{en ? 'Planned: rankings, weekly prizes and permanent champion titles. No prizes are active yet.' : 'В планах: рейтинг, недельные награды и постоянные титулы чемпионов. Сейчас призы не начисляются.'}</div>
        </div>
      )}
      {failed && <div className="text-xs text-amber-300 text-center">{en ? 'The season server did not respond. No score has been changed.' : 'Нет ответа сервера сезонов. Сезонные очки не изменены.'}</div>}
      <button onClick={() => void refresh()} disabled={loading} className="btn-ghost w-full text-xs flex justify-center gap-2 items-center"><RefreshCcw className="w-4 h-4" />{loading ? en ? 'Loading...' : 'Загрузка...' : en ? 'Refresh' : 'Обновить'}</button>
    </div>
  );
}
