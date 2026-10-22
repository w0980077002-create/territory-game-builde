import { useEffect, useState } from 'react';
import { ChevronRight, Crown, RefreshCw, Timer, Trophy } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { getAppearanceIcon } from '@/game/appearance';
import { getArenaWeeklyStatus, type ArenaWeeklyStatus } from '@/game/arenaWeekly';
import { seasonWindow, seasonCountdown } from '@/game/seasonCalendar';

export function ArenaWeeklyBoard() {
  const { language } = useLanguage();
  const en = language === 'en';
  const [status, setStatus] = useState<ArenaWeeklyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const result = await getArenaWeeklyStatus();
        if (mounted) { setStatus(result); setFailed(false); }
      } catch {
        if (mounted) setFailed(true);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    const ticker = window.setInterval(() => {
      if (!mounted) return;
      setNow(Date.now());
      void load();
    }, 60_000);
    return () => { mounted = false; window.clearInterval(ticker); };
  }, []);

  const window = seasonWindow(now);
  const current = status && Date.parse(status.starts_at) === window.startsAt && Date.parse(status.ends_at) === window.endsAt;
  const rows = current ? status.leaders : [];
  const visible = expanded ? rows : rows.slice(0, 3);

  return (
    <section className="arena-weekly" aria-label={en ? 'Arena weekly top 50' : 'Топ 50 арены за неделю'}>
      <div className="arena-weekly-head">
        <div className="arena-weekly-heading">
          <Crown className="h-5 w-5 text-yellow-300 shrink-0" />
          <h3>{en ? 'WEEKLY TOP 50' : 'ТОП-50 АРЕНЫ ЗА НЕДЕЛЮ'}</h3>
        </div>
        <div className="arena-weekly-timer"><Timer className="h-3.5 w-3.5" /><time>{seasonCountdown(window.remainingMs, en ? 'en' : 'ru')}</time></div>
      </div>
      {loading && !status ? <p className="arena-weekly-empty">{en ? 'Loading verified wins…' : 'Загружаем подтверждённые победы…'}</p> : null}
      {failed && !current ? <div className="arena-weekly-empty">
        {en ? 'Weekly ranking temporarily unavailable. No results were substituted.' : 'Недельный рейтинг пока недоступен. Выдуманные результаты не показываем.'}
      </div> : null}
      {!loading && !failed && rows.length === 0 ? <p className="arena-weekly-empty">
        {en ? 'No confirmed arena wins this week yet. Be the first!' : 'На этой неделе ещё нет подтверждённых побед. Стань первым!'}
      </p> : null}
      {visible.length > 0 && (
        <div className={expanded ? 'arena-weekly-rows arena-weekly-rows-expanded' : 'arena-weekly-rows'}>
          {visible.map((player) => (
            <div className="arena-weekly-player" key={player.player_id}>
              <span className={`arena-weekly-rank arena-weekly-rank-${Math.min(4, player.rank)}`}>{player.rank}</span>
              <span className="arena-weekly-avatar"><img src={getAppearanceIcon(player.appearance)} alt="" loading="lazy" /></span>
              <span className="arena-weekly-player-name" title={player.display_name}>{player.display_name}<small>{en ? 'Lv.' : 'Ур.'} {player.level}</small></span>
              <span className="arena-weekly-wins"><Trophy className="h-3 w-3" />{player.wins}</span>
            </div>
          ))}
        </div>
      )}
      {current && (
        <div className="arena-weekly-foot">
          <span>{status.my_rank ? (en ? `Your place: #${status.my_rank} · ${status.my_wins} wins` : `Твоё место: №${status.my_rank} · ${status.my_wins} побед`) : (en ? `Your wins: ${status.my_wins}` : `Твои победы: ${status.my_wins}`)}</span>
          {rows.length > 3 && (
            <button type="button" className="arena-weekly-expand" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
              {expanded ? (en ? 'Collapse' : 'Свернуть') : (en ? 'All leaders' : 'Весь ТОП')} <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {failed && current ? <span className="arena-weekly-note"><RefreshCw className="inline h-3 w-3 mr-1" />{en ? 'Showing last verified results' : 'Последние подтверждённые результаты'}</span> : null}
      <p className="arena-weekly-note">{en ? 'Wins reset every Sunday (Kyiv time). Lifetime wins are preserved.' : 'Каждое воскресенье — новая неделя. Общие победы сохраняются.'}</p>
    </section>
  );
}
