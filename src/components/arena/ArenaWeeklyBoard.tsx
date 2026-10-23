import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Crown, RefreshCw, Swords, Timer, Trophy } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { getAppearanceIcon } from '@/game/appearance';
import { getArenaWeeklyStatus, type ArenaWeeklyStatus } from '@/game/arenaWeekly';
import { seasonWindow, seasonCountdown } from '@/game/seasonCalendar';
import { arenaWeeklyWithBots } from '@/game/arenaWeeklyBots';
import { arenaNextGoal } from '@/game/arenaProgress';

export function ArenaWeeklyBoard() {
  const { language } = useLanguage();
  const en = language === 'en';
  const [status, setStatus] = useState<ArenaWeeklyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const rowsRef = useRef<HTMLDivElement>(null);

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

  const week = seasonWindow(now);
  const current = status && Date.parse(status.starts_at) === week.startsAt && Date.parse(status.ends_at) === week.endsAt;
  const display = current ? arenaWeeklyWithBots(status, now) : null;
  const rows = display?.leaders ?? [];
  const visible = expanded ? rows : rows.slice(0, 3);
  const goal = current && status ? arenaNextGoal(rows, display?.displayRank ?? null, status.my_wins) : null;
  const isLeader = !!display && display.displayRank === 1;

  // A freshly expanded leaderboard must always start at rank 1, not at
  // an old scroll position (which made some players see rank 5 first).
  useEffect(() => {
    if (expanded && rowsRef.current) rowsRef.current.scrollTop = 0;
  }, [expanded]);

  return (
    <section className="arena-weekly" aria-label={en ? 'Arena weekly top 50' : 'Топ 50 арены за неделю'}>
      <div className="arena-weekly-head">
        <div className="arena-weekly-heading">
          <Crown className="h-5 w-5 text-yellow-300 shrink-0" />
          <h3>{en ? 'WEEKLY TOP 50' : 'ТОП-50 АРЕНЫ ЗА НЕДЕЛЮ'}</h3>
        </div>
        <div className="arena-weekly-timer"><Timer className="h-3.5 w-3.5" /><time>{seasonCountdown(week.remainingMs, en ? 'en' : 'ru')}</time></div>
      </div>
      {loading && !status ? <p className="arena-weekly-empty">{en ? 'Loading verified wins…' : 'Загружаем подтверждённые победы…'}</p> : null}
      {failed && !current ? <div className="arena-weekly-empty">
        {en ? 'Weekly ranking temporarily unavailable. No results were substituted.' : 'Недельный рейтинг пока недоступен. Выдуманные результаты не показываем.'}
      </div> : null}
      {!loading && !failed && rows.length === 0 ? <p className="arena-weekly-empty">
        {en ? 'No confirmed arena wins this week yet. Be the first!' : 'На этой неделе ещё нет подтверждённых побед. Стань первым!'}
      </p> : null}
      {visible.length > 0 && (
        <div ref={rowsRef} className={expanded ? 'arena-weekly-rows arena-weekly-rows-expanded' : 'arena-weekly-rows'}>
          {visible.map((player) => (
            <div
              className={`arena-weekly-player ${player.rank <= 3 ? 'arena-weekly-podium' : ''} ${player.arenaBot ? 'arena-weekly-npc' : ''} ${!player.arenaBot && player.rank === display?.displayRank ? 'arena-weekly-mine' : ''}`}
              key={player.player_id}
              aria-label={`${player.rank}. ${player.display_name}: ${player.wins} ${en ? 'wins' : 'побед'}`}
            >
              <span className={`arena-weekly-rank arena-weekly-rank-${Math.min(4, player.rank)}`}>{player.rank}</span>
              <span className="arena-weekly-avatar"><img src={getAppearanceIcon(player.appearance)} alt="" loading="lazy" /></span>
              <span className="arena-weekly-player-name" title={player.arenaBot ? (en ? 'Arena AI opponent' : 'Боец арены: игровой бот') : player.display_name}>
                <span className="arena-weekly-name-text">{player.display_name}</span>
                {player.arenaBot ? <small>{en ? 'Arena rival' : 'Соперник арены'}</small> : <small>{en ? 'Lv.' : 'Ур.'} {player.level}</small>}
              </span>
              <span className="arena-weekly-wins"><Trophy aria-hidden="true" />{player.wins.toLocaleString('ru-RU')}</span>
            </div>
          ))}
        </div>
      )}
      {current && (
        <div className="arena-weekly-foot">
          <span>{en ? `${status.my_wins} wins` : `${status.my_wins} побед`}</span>
          {rows.length > 3 && (
            <button type="button" className="arena-weekly-expand" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
              {expanded ? (en ? 'Collapse' : 'Свернуть') : (en ? 'All leaders' : 'Весь ТОП')} <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {(goal || isLeader) && <div className="arena-weekly-chase" aria-live="polite">
        <div className="arena-weekly-chase-top">
          <span className="arena-weekly-chase-heading">
            {isLeader ? <Crown aria-hidden="true" /> : <Swords aria-hidden="true" />}
            {isLeader
              ? (en ? 'LEADER OF THE WEEK' : 'ЛИДЕР НЕДЕЛИ')
              : (en ? `NEXT GOAL: #${goal!.nextRank}` : `СЛЕДУЮЩАЯ ЦЕЛЬ — №${goal!.nextRank}`)}
          </span>
          <strong>{isLeader
            ? (en ? 'KEEP YOUR LEAD!' : 'ДЕРЖИ ПЕРВОЕ МЕСТО!')
            : (en ? `+${goal!.winsNeeded} wins` : `+${goal!.winsNeeded} побед`)}</strong>
        </div>
        {goal && <>
          <div className="arena-weekly-chase-track" role="progressbar" aria-label={en ? 'Progress toward next place' : 'Прогресс до следующего места'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={goal.progressPercent}>
            <span style={{ width: `${goal.progressPercent}%` }} />
          </div>
          <span className="arena-weekly-chase-note">{en ? 'Based on current standings · results may change' : 'По текущему ТОПу · соперники продолжают побеждать'}</span>
        </>}
      </div>}
      {failed && current ? <span className="arena-weekly-note"><RefreshCw className="inline h-3 w-3 mr-1" />{en ? 'Showing last verified results' : 'Последние подтверждённые результаты'}</span> : null}
      <p className="arena-weekly-note">{en ? 'New season every Sunday (Kyiv time). Lifetime wins remain.' : 'Каждое воскресенье — новый сезон. Общие победы сохраняются.'}</p>
    </section>
  );
}
