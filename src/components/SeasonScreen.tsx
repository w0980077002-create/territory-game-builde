import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, ChevronRight, Crown, Mail, RefreshCcw, ShieldCheck, Swords, Trophy } from 'lucide-react';
import { kyivSeasonWeekKey, seasonCountdown } from '@/game/seasonCalendar';
import { fetchSeasonStatus, type SeasonStatus } from '@/game/seasonApi';
import { useLanguage } from '@/game/i18n';
import type { AuthUser } from '@/game/auth';
import { ArenaWeeklyBoard } from './arena/ArenaWeeklyBoard';
import './arena/arenaLobby.css';
import './seasonJourney.css';

interface Props {
  user: AuthUser;
  onArena?: () => void;
  onEvents?: () => void;
  onMessages?: () => void;
  onRankings?: () => void;
}

/** Reuse the Arena's exact mixed weekly TOP-50 display. Preserve the separate server-only prize standings below. */
export function SeasonScreen({ user, onArena, onEvents, onMessages, onRankings }: Props) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [clock, setClock] = useState(Date.now());
  const [status, setStatus] = useState<SeasonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [offset, setOffset] = useState(0);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setFailed(false);
    try {
      const result = await fetchSeasonStatus();
      if (current !== request.current) return;
      setStatus(result);
      const serverNow = Date.parse(result?.server_now ?? '');
      setOffset(Number.isFinite(serverNow) ? serverNow - Date.now() : 0);
    } catch {
      if (current === request.current) { setStatus(null); setFailed(true); }
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    setStatus(null);
    void refresh();
    const polling = window.setInterval(() => void refresh(), 60_000);
    const ticker = window.setInterval(() => setClock(Date.now()), 30_000);
    const resumed = () => { if (document.visibilityState === 'visible') { setClock(Date.now()); void refresh(); } };
    document.addEventListener('visibilitychange', resumed);
    window.addEventListener('online', resumed);
    return () => {
      request.current += 1;
      window.clearInterval(ticker);
      window.clearInterval(polling);
      document.removeEventListener('visibilitychange', resumed);
      window.removeEventListener('online', resumed);
    };
  }, [refresh]);

  const serverClock = clock + offset;
  const endsAt = Date.parse(status?.ends_at ?? '');
  const remaining = Number.isFinite(endsAt) ? Math.max(0, endsAt - serverClock) : 0;
  // The server's championship week is Sunday at 00:00 in Kyiv, NOT the
  // Monday/UTC quest week or Sunday/UTC Arena TOP-50 preview.
  const current = status?.week === kyivSeasonWeekKey(serverClock);
  const live = status?.enabled === true && current && Number.isFinite(endsAt) && remaining > 0;
  const prizeText = (prize: { gold?: number; gems?: number }) =>
    [prize.gold ? `${prize.gold.toLocaleString(en ? 'en-US' : 'ru-RU')} ${en ? 'gold' : 'золота'}` : '',
      prize.gems ? `${prize.gems.toLocaleString(en ? 'en-US' : 'ru-RU')} ${en ? 'blue gems' : 'синих алмазов'}` : ''].filter(Boolean).join(' · ');

  return <section className="viking-screen viking-screen--season season-journey" data-testid="season-journey">
    <header className="season-journey__hero">
      <img src={import.meta.env.BASE_URL + 'ic-trophy.webp'} alt="" loading="lazy" />
      <div className="season-journey__heading">
        <span>{en ? 'ARENA · VERIFIED RESULTS' : 'АРЕНА · ПОДТВЕРЖДЁННЫЕ РЕЗУЛЬТАТЫ'}</span>
        <h2>{en ? 'Weekly championship' : 'Недельный чемпионат'}</h2>
        <p>{en ? 'The same weekly TOP-50 as in the Arena.' : 'Тот же недельный ТОП-50, что и на Арене.'}</p>
      </div>
    </header>

    <div className="arena-lobby arena-approved-entry season-journey__arena-top" data-testid="season-arena-top50">
      <ArenaWeeklyBoard />
    </div>
    <details className="season-journey__details season-journey__official" data-testid="season-official-server">
      <summary><ShieldCheck size={18} aria-hidden="true"/>{en ? 'Official standings and championship prizes' : 'Официальные места и награды чемпионата'}</summary>
      <div className="season-journey__official-content">
    <div className="season-journey__summary" aria-live="polite">
      <div><CalendarClock size={17} aria-hidden="true"/><span>{en ? 'Until season end' : 'До конца сезона'}</span>
        <strong>{live ? seasonCountdown(remaining, language) : '—'}</strong></div>
      <div><ShieldCheck size={17} aria-hidden="true"/><span>{en ? 'Server status' : 'Статус сервера'}</span>
        <strong>{loading && !status ? (en ? 'Loading' : 'Загрузка') : failed ? (en ? 'Unavailable' : 'Нет связи') : live ? (en ? 'Active' : 'Активен') : (en ? 'Not active' : 'Не запущен')}</strong></div>
    </div>

    {loading && !status && <p className="season-journey__notice" role="status">{en ? 'Checking verified championship standings…' : 'Проверяем подтверждённые результаты чемпионата…'}</p>}
    {failed && <p className="season-journey__notice season-journey__notice--warning" role="alert">
      {en ? 'The season server did not respond. No scores or rewards were changed.' : 'Сервер чемпионата не ответил. Очки и награды не изменены.'}
    </p>}

    {live && status ? <>
      <section className="season-journey__personal" aria-label={en ? 'Your championship progress' : 'Твой прогресс в чемпионате'}>
        <div><span>{en ? 'YOUR POINTS' : 'ТВОИ ОЧКИ'}</span><strong>{status.my_points.toLocaleString(en ? 'en-US' : 'ru-RU')}</strong></div>
        <div><span>{en ? 'YOUR PLACE' : 'ТВОЁ МЕСТО'}</span><strong>{status.my_rank ? `№${status.my_rank}` : '—'}</strong></div>
      </section>
      <p className="season-journey__goal">{status.my_rank === 1
        ? (en ? 'You lead! Keep winning to defend first place.' : 'Ты лидируешь! Побеждай, чтобы удержать первое место.')
        : status.my_points > 0
          ? (en ? 'Your next verified Arena win strengthens your position.' : 'Следующая подтверждённая победа укрепит твою позицию.')
          : (en ? 'Win an Arena battle to earn your first confirmed point.' : 'Победи на Арене, чтобы получить первое подтверждённое очко.')}</p>
      <div className="season-journey__board" aria-label={en ? 'Verified championship leaders' : 'Подтверждённые лидеры чемпионата'}>
        <h3><Trophy size={19} aria-hidden="true"/>{en ? 'Current standings' : 'Текущие места'}</h3>
        {status.leaders.length ? status.leaders.map(row =>
          <div key={row.player_id} className={row.player_id === user.id ? 'season-journey__row season-journey__row--mine' : 'season-journey__row'}>
            <b>№{row.rank}</b><span title={row.display_name}>{row.display_name}{row.player_id === user.id ? (en ? ' (you)' : ' (ты)') : ''}</span>
            <strong>{row.points}</strong>
          </div>
        ) : <p className="season-journey__empty">{en ? 'No verified wins this season yet.' : 'В этом сезоне ещё нет подтверждённых побед.'}</p>}
      </div>
      <details className="season-journey__details" data-testid="season-prize-rules">
        <summary><Crown size={18} aria-hidden="true"/>{en ? 'Rules and server prizes' : 'Правила и серверные награды'}</summary>
        <p>{en ? 'One confirmed Arena win gives one championship point. The championship runs from Sunday to Sunday. Awards are sent by mail only after the server closes the season.' : 'Одна подтверждённая победа на Арене даёт одно очко чемпионата. Сезон идёт с воскресенья по воскресенье. Награды отправляются почтой только после завершения сезона на сервере.'}</p>
        {status.prizes.length ? status.prizes.map((prize, index) =>
          <div key={index} className="season-journey__prize"><b>№{index + 1}</b><span>{prizeText(prize)}</span></div>
        ) : <p>{en ? 'The server has not published prizes.' : 'Сервер пока не опубликовал награды.'}</p>}
      </details>
    </> : !failed && !loading && <div className="season-journey__notice">
      <ShieldCheck size={21} aria-hidden="true"/>
      <p>{en ? 'The championship is not active. No championship points or prizes are being promised. The Arena has its own weekly TOP-50 board.' : 'Чемпионат пока не активен. Очки и призы чемпионата не обещаем. На Арене отдельно работает недельный ТОП-50.'}</p>
    </div>}

    {!!status?.history.length && <details className="season-journey__details" data-testid="season-winners-history">
      <summary><Crown size={18} aria-hidden="true"/>{en ? 'Previous champions' : 'История чемпионов'}</summary>
      {status.history.map(row => <div key={`${row.week}:${row.player_id}`} className="season-journey__history">
        <span>{row.week} · №{row.rank} · {row.display_name}</span>
        <strong>{prizeText(row.reward) || `${row.points} ${en ? 'points' : 'очков'}`}</strong>
      </div>)}
    </details>}

      </div>
    </details>

    <nav className="season-journey__actions" aria-label={en ? 'Championship journey' : 'Путь чемпионата'}>
      {onArena && <button type="button" className="season-journey__primary" onClick={onArena}>
        <Swords size={20} aria-hidden="true"/>{live ? (en ? 'Fight in Arena' : 'Сражаться на Арене') : (en ? 'Open Arena' : 'Открыть Арену')}<ChevronRight size={17} aria-hidden="true"/>
      </button>}
      <div className={onRankings ? "season-journey__secondary season-journey__secondary--four" : "season-journey__secondary"}>
        {onRankings && <button type="button" data-testid="season-open-top50" onClick={onRankings}><Trophy size={17} aria-hidden="true"/>{en ? 'Arena TOP-50' : 'ТОП-50 Арены'}</button>}
        {onEvents && <button type="button" onClick={onEvents}>{en ? 'Events' : 'События'}</button>}
        {onMessages && <button type="button" onClick={onMessages}><Mail size={17} aria-hidden="true"/>{en ? 'Mail' : 'Почта'}</button>}
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          <RefreshCcw size={17} aria-hidden="true"/>{loading ? (en ? 'Loading…' : 'Загрузка…') : (en ? 'Refresh' : 'Обновить')}
        </button>
      </div>
    </nav>
  </section>;
}
