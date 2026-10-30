import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Crown, Gift, RefreshCw, Swords, Timer, Trophy, X } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { getAppearanceIcon } from '@/game/appearance';
import { getArenaWeeklyStatus, type ArenaWeeklyStatus } from '@/game/arenaWeekly';
import { arenaSeasonWindow, seasonCountdown } from '@/game/seasonCalendar';
import { arenaWeeklyWithBots } from '@/game/arenaWeeklyBots';
import { arenaNextGoal } from '@/game/arenaProgress';
import { ARENA_PRIZE_PREVIEW, arenaPrizePreviewForRank } from '@/game/arenaPrizePreview';

export function ArenaPrizesDialog({ en, rank, countdown, onClose }: {
  en: boolean;
  rank: number | null;
  countdown: string;
  onClose: () => void;
}) {
  const myTier = arenaPrizePreviewForRank(rank);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, []);

  const dialog = (
      <div className="arena-prizes-overlay" role="dialog" aria-modal="true" aria-label={en ? 'Arena TOP-50 weekly prizes' : 'Награды ТОП-50 Арены'}>
        <button type="button" className="arena-prizes-backdrop" onClick={onClose} aria-label={en ? 'Close prizes' : 'Закрыть награды'} />
        <div ref={panelRef} className="arena-prizes-panel">
          <div className="arena-prizes-head">
            <Gift aria-hidden="true" />
            <div><h3>{en ? 'ARENA TOP-50 PRIZES' : 'НАГРАДЫ ТОП-50 АРЕНЫ'}</h3><span>{en ? 'Weekly prizes' : 'Еженедельные награды'}</span></div>
            <button ref={closeRef} type="button" className="arena-prizes-close" onClick={onClose} aria-label={en ? 'Close' : 'Закрыть'}><X /></button>
          </div>
          <div className="arena-prizes-body" tabIndex={0}>
            <div className="arena-prizes-my-place">
              <Trophy aria-hidden="true" />
              {rank !== null
                ? <span><strong>{en ? `Your position: #${rank}` : `Твоё место: №${rank}`}</strong>
                    <small>{myTier ? (en ? 'Your projected prize is highlighted below' : 'Твоя возможная награда подсвечена ниже') : (en ? 'Enter the TOP 50 to earn prizes' : 'Войди в ТОП-50, чтобы получить награду')}</small></span>
                : <span><strong>{en ? 'Not yet in TOP-50' : 'Пока вне ТОП-50'}</strong><small>{en ? 'Win Arena battles to climb the board' : 'Побеждай на Арене и поднимайся в рейтинге'}</small></span>}
            </div>
            <p className="arena-prizes-condition">{en ? 'Rewards depend on your position at the end of the season.' : 'Награда зависит от места на момент завершения сезона.'}</p>
            <div className="arena-prizes-legend" aria-label={en ? 'Reward types' : 'Виды наград'}>
              <span><b>💎</b>{en ? 'Blue gems' : 'Синие алмазы'}</span>
              <span><b className="arena-prizes-red">♦</b>{en ? 'Red gems' : 'Красные алмазы'}</span>
              <span><b>⚔️</b>{en ? 'Battle stones' : 'Боевые камни'}</span>
              <span><b>🧪</b>{en ? 'Elixirs' : 'Эликсиры'}</span>
            </div>
            <div className="arena-prizes-list">
              {ARENA_PRIZE_PREVIEW.map((tier) => {
                const mine = tier === myTier;
                const label = tier.from === tier.to ? `№${tier.from}` : `№${tier.from}–${tier.to}`;
                return <div key={tier.from} className={`arena-prizes-tier arena-prizes-tier-${tier.from} ${mine ? 'arena-prizes-tier-mine' : ''}`}>
                  <strong className="arena-prizes-tier-rank">{label}</strong>
                  <div className="arena-prizes-resources">
                    <span aria-label={`${en ? 'Blue gems' : 'Синие алмазы'}: ${tier.blueGems}`}><i aria-hidden="true">💎</i><b>{tier.blueGems}</b></span>
                    <span className={tier.redGems ? 'arena-prizes-red' : 'arena-prizes-none'} aria-label={`${en ? 'Red gems' : 'Красные алмазы'}: ${tier.redGems}`}><i aria-hidden="true">♦</i><b>{tier.redGems || '—'}</b></span>
                    <span aria-label={`${en ? 'Battle stones' : 'Боевые камни'}: ${tier.stones}`}><i aria-hidden="true">⚔️</i><b>{tier.stones}</b></span>
                    <span aria-label={`${en ? 'Elixirs' : 'Эликсиры'}: ${tier.elixirs}`}><i aria-hidden="true">🧪</i><b>{tier.elixirs}</b></span>
                  </div>
                  {mine && <span className="arena-prizes-you">{en ? 'YOU' : 'ТЫ'}</span>}
                </div>;
              })}
            </div>
            <div className="arena-prizes-bottom"><Timer aria-hidden="true" /><span>{en ? 'Season ends Sunday, 00:00 UTC' : 'Конец сезона: воскресенье, 00:00 UTC'}</span><strong>{countdown}</strong></div>
          </div>
        </div>
      </div>
  );
  // Place the dialog above the game's fixed footer on both iOS and Android.
  const host = typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('.territory-shell') ?? document.body
    : null;
  return host ? createPortal(dialog, host) : dialog;
}

export function ArenaWeeklyBoard() {
  const { language } = useLanguage();
  const en = language === 'en';
  const [status, setStatus] = useState<ArenaWeeklyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showPrizes, setShowPrizes] = useState(false);
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

  const week = arenaSeasonWindow(now);
  const current = status && Date.parse(status.starts_at) === week.startsAt && Date.parse(status.ends_at) === week.endsAt;
  const display = current ? arenaWeeklyWithBots(status, now) : null;
  const rows = display?.leaders ?? [];
  const podium = [2, 1, 3].map((rank) => rows.find((player) => player.rank === rank)).filter((player) => !!player);
  const goal = current && status ? arenaNextGoal(rows, display?.displayRank ?? null, status.my_wins) : null;
  const isLeader = !!display && display.displayRank === 1;
  const countdown = seasonCountdown(week.remainingMs, en ? 'en' : 'ru');

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
          <h3>{en ? 'WEEKLY TOP 50' : 'ТОП-50 АРЕНЫ'}</h3>
        </div>
        <div className="arena-weekly-head-actions">
          <button type="button" className="arena-weekly-prize-button" onClick={() => setShowPrizes(true)} title={en ? 'Weekly prizes' : 'Награды за ТОП-50'} aria-label={en ? 'View TOP-50 prizes' : 'Посмотреть награды ТОП-50'} aria-haspopup="dialog"><Gift aria-hidden="true" /></button>
          <div className="arena-weekly-timer"><Timer className="h-3.5 w-3.5" /><time>{countdown}</time></div>
        </div>
      </div>
      {loading && !status ? <p className="arena-weekly-empty">{en ? 'Loading verified wins…' : 'Загружаем подтверждённые победы…'}</p> : null}
      {failed && !current ? <div className="arena-weekly-empty">
        {en ? 'Weekly ranking temporarily unavailable. No results were substituted.' : 'Недельный рейтинг пока недоступен. Выдуманные результаты не показываем.'}
      </div> : null}
      {!loading && !failed && rows.length === 0 ? <p className="arena-weekly-empty">
        {en ? 'No confirmed arena wins this week yet. Be the first!' : 'На этой неделе ещё нет подтверждённых побед. Стань первым!'}
      </p> : null}
      {podium.length > 0 && (
        <div className="arena-weekly-winners" aria-label={en ? 'Top three Arena contenders' : 'Тройка лидеров Арены'}>
          {podium.map((player) => (
            <div className={`arena-weekly-winner arena-weekly-winner-${player.rank} ${!player.arenaBot && player.rank === display?.displayRank ? 'arena-weekly-winner-mine' : ''}`} key={player.player_id} aria-label={`${player.rank}. ${player.display_name}: ${player.wins} ${en ? 'wins' : 'побед'}`}>
              {player.rank === 1 && <Crown className="arena-weekly-champion-crown" aria-hidden="true" />}
              <div className="arena-weekly-winner-portrait"><img src={getAppearanceIcon(player.appearance)} alt="" loading="lazy" /></div>
              <span className="arena-weekly-winner-medal">{player.rank}</span>
              <strong className="arena-weekly-winner-name" title={player.display_name}>{player.display_name}</strong>
              <span className="arena-weekly-winner-wins"><Trophy aria-hidden="true" />{player.wins.toLocaleString('ru-RU')}</span>
            </div>
          ))}
        </div>
      )}
      {expanded && rows.length > 0 && (
        <div ref={rowsRef} className="arena-weekly-rows arena-weekly-rows-expanded" aria-label={en ? 'All top 50 contenders' : 'Все участники ТОП-50'}>
          <div className="arena-weekly-list-head"><span>{en ? 'RANK · PLAYER' : 'МЕСТО · УЧАСТНИК'}</span><span>{en ? 'WINS' : 'ПОБЕДЫ'}</span></div>
          {rows.map((player) => (
            <div
              className={`arena-weekly-player ${player.rank <= 3 ? 'arena-weekly-podium' : ''} ${!player.arenaBot && player.rank === display?.displayRank ? 'arena-weekly-mine' : ''}`}
              key={player.player_id}
              aria-label={`${player.rank}. ${player.display_name}: ${player.wins} ${en ? 'wins' : 'побед'}`}
            >
              <span className={`arena-weekly-rank arena-weekly-rank-${Math.min(4, player.rank)}`}>{player.rank}</span>
              <span className="arena-weekly-avatar"><img src={getAppearanceIcon(player.appearance)} alt="" loading="lazy" /></span>
              <span className="arena-weekly-player-name" title={player.display_name}>
                <span className="arena-weekly-name-text">{player.display_name}</span>
                <small>{en ? 'Lv.' : 'Ур.'} {player.level}</small>
              </span>
              <span className="arena-weekly-wins"><Trophy aria-hidden="true" />{player.wins.toLocaleString('ru-RU')}</span>
            </div>
          ))}
        </div>
      )}
      {current && (
        <div className="arena-weekly-foot arena-weekly-personal">
          <span>{en ? 'MY WEEK' : 'МОЯ НЕДЕЛЯ'}: <strong>{en ? `${status.my_wins} WINS` : `${status.my_wins} ПОБЕД`}</strong>{display?.displayRank != null && <span className="arena-weekly-my-rank">{en ? `#${display.displayRank}` : `№${display.displayRank}`}</span>}</span>
          {rows.length > 3 && (
            <button type="button" className="arena-weekly-expand" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
              {expanded ? (en ? 'Collapse' : 'Свернуть') : (en ? 'TOP 50' : 'ВЕСЬ ТОП-50')} <ChevronRight className="h-4 w-4" />
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
          <span className="arena-weekly-chase-note">{en ? `Catch ${goal.opponentName} · standings can change` : `По текущему ТОПу: обойти ${goal.opponentName} · соперники продолжают побеждать`}</span>
        </>}
      </div>}
      {failed && current ? <span className="arena-weekly-note"><RefreshCw className="inline h-3 w-3 mr-1" />{en ? 'Showing last verified results' : 'Последние подтверждённые результаты'}</span> : null}
      <p className="arena-weekly-note">{en ? 'New season every Sunday at 00:00 UTC. Lifetime wins remain.' : 'Новый сезон каждое воскресенье в 00:00 UTC. Общие победы сохраняются.'}</p>
      {showPrizes && <ArenaPrizesDialog en={en} rank={display?.displayRank ?? null} countdown={countdown} onClose={() => setShowPrizes(false)} />}
    </section>
  );
}
