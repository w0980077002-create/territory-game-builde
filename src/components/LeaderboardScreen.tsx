import { useCallback, useEffect, useRef, useState } from 'react';
import { getLeaderboard } from '@/game/cloud';
import { ArrowRight, Crown, Medal, RefreshCcw, ShieldCheck, Swords, Trophy } from 'lucide-react';
import type { AuthUser } from '@/game/auth';
import { useLanguage } from '@/game/i18n';
import { SeasonScreen } from './SeasonScreen';
import './arenaRankJourney.css';

interface LeaderboardEntry {
  player_id: string;
  display_name: string;
  level: number;
  arena_rating: number;
  arena_wins: number;
  total_battles_won: number;
  photo_url: string | null;
}

type RankTab = 'rating' | 'wins' | 'season';

/** Read-only Arena TOP-50. Rank and values are the server's ordered rows.
 * Never infer a player's global rank from a truncated list or local saves. */
export function LeaderboardScreen({ user, initialTab = 'rating', onArena, onEvents, onMessages }: {
  user: AuthUser;
  initialTab?: RankTab;
  onArena?: () => void;
  onEvents?: () => void;
  onMessages?: () => void;
}) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<RankTab>(initialTab);
  const requestId = useRef(0);

  const loadLeaderboard = useCallback(async (kind: 'rating' | 'wins') => {
    const ticket = ++requestId.current;
    setLoading(true);
    setError(false);
    try {
      // Query orders the FULL view before LIMIT 50. Do not sort a rating
      // sample by wins on the client: that hides real wins leaders.
      const result = await getLeaderboard(50, kind === 'rating' ? 'arena_rating' : 'arena_wins');
      if (ticket !== requestId.current) return;
      setEntries(result as LeaderboardEntry[]);
    } catch {
      if (ticket !== requestId.current) return;
      setEntries([]);
      setError(true);
    } finally {
      if (ticket === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'season') {
      requestId.current += 1;
      return;
    }
    void loadLeaderboard(tab);
    return () => { requestId.current += 1; };
  }, [tab, loadLeaderboard]);

  const metric = tab === 'wins' ? 'arena_wins' : 'arena_rating';
  const mine = entries.findIndex(entry => entry.player_id === user.id);
  const myRow = mine >= 0 ? entries[mine] : null;
  const nextRival = mine > 0 ? entries[mine - 1] : null;
  const leader = entries[0];
  const gap = myRow && nextRival ? Math.max(0, nextRival[metric] - myRow[metric]) : null;
  const number = (value: number) => value.toLocaleString(en ? 'en-US' : 'ru-RU');
  const metricLabel = tab === 'wins' ? (en ? 'wins' : 'побед') : (en ? 'rating' : 'рейтинг');

  return <div className="arena-rank-journey viking-screen viking-screen--leaderboard animate-fade-in" data-testid="arena-rank-journey">
    <header className="arena-rank-journey__hero">
      <img src={import.meta.env.BASE_URL + 'ic-trophy.webp'} alt="" draggable={false} />
      <div>
        <span>{en ? 'ARENA · VERIFIED RESULTS' : 'АРЕНА · ПОДТВЕРЖДЁННЫЕ РЕЗУЛЬТАТЫ'}</span>
        <h2>{en ? 'Path to the top' : 'Путь к вершине'}</h2>
        <p>{en ? 'Compare real rankings, check the championship and return to battle.' : 'Сравни места, проверь чемпионат и возвращайся в бой.'}</p>
      </div>
    </header>

    <div className="arena-rank-journey__tabs" role="tablist" aria-label={en ? 'Arena rankings' : 'Рейтинги Арены'}>
      {([
        ['rating', en ? 'Rating' : 'Рейтинг'],
        ['wins', en ? 'Wins' : 'Победы'],
        ['season', en ? 'Championship' : 'Чемпионат'],
      ] as const).map(([id, label]) => <button type="button" role="tab" key={id}
        aria-selected={tab === id} aria-controls="arena-rank-journey-content"
        onClick={() => setTab(id)} className={tab === id ? 'arena-rank-journey__tab arena-rank-journey__tab--active' : 'arena-rank-journey__tab'}>
        {label}
      </button>)}
    </div>

    <div id="arena-rank-journey-content" role="tabpanel" className="arena-rank-journey__content">
      {tab === 'season' ? <SeasonScreen user={user} onArena={onArena} onEvents={onEvents} onMessages={onMessages}
        onRankings={() => setTab('rating')} /> : <>
        {loading ? <div className="arena-rank-journey__notice" role="status">
          <RefreshCcw size={19} aria-hidden="true"/>{en ? 'Checking the Arena TOP-50…' : 'Проверяем ТОП-50 Арены…'}
        </div> : error ? <div className="arena-rank-journey__notice arena-rank-journey__notice--error" role="alert">
          <p>{en ? 'Could not load the server ranking. No scores were changed.' : 'Не удалось загрузить серверный рейтинг. Очки не изменены.'}</p>
          <button type="button" onClick={() => void loadLeaderboard(tab)}>
            <RefreshCcw size={16} aria-hidden="true"/>{en ? 'Try again' : 'Повторить'}
          </button>
        </div> : <>
          <section className="arena-rank-journey__personal" data-testid="arena-rank-personal" aria-label={en ? 'Your verified TOP-50 result' : 'Твой результат в ТОП-50'}>
            <div className="arena-rank-journey__personal-heading">
              <ShieldCheck size={20} aria-hidden="true"/>
              <strong>{en ? 'Your place in TOP-50' : 'Твоё место в ТОП-50'}</strong>
              <b>{myRow ? `№${mine + 1}` : '—'}</b>
            </div>
            {myRow ? <>
              <p>{en ? 'Your confirmed result:' : 'Твой подтверждённый результат:'} <strong>{number(myRow[metric])} {metricLabel}</strong></p>
              {nextRival ? <div className="arena-rank-journey__rival" data-testid="arena-rank-next-rival">
                <span>{en ? 'Next rival' : 'Следующий соперник'}: <b>{nextRival.display_name}</b> · №{mine}</span>
                <span>{en ? 'Difference' : 'Разница'}: <b>{number(gap ?? 0)} {metricLabel}</b></span>
              </div> : <p>{en ? 'You lead this TOP-50 list. Defend your place in Arena!' : 'Ты возглавляешь этот ТОП-50. Защищай место на Арене!'}</p>}
            </> : <p>{entries.length
              ? (en ? 'Your account is not shown among these 50 server results. Your exact global place is unknown.' : 'Тебя нет в этих 50 серверных результатах. Точное место вне списка неизвестно.')
              : (en ? 'There are no confirmed results in this ranking yet.' : 'В этом рейтинге пока нет подтверждённых результатов.')}</p>}
          </section>

          {leader && <div className="arena-rank-journey__leader" data-testid="arena-rank-leader">
            <Crown size={20} aria-hidden="true"/><span>{en ? 'Current leader' : 'Текущий лидер'}</span>
            <strong title={leader.display_name}>{leader.display_name}</strong><b>{number(leader[metric])}</b>
          </div>}

          <section className="arena-rank-journey__board" aria-label={en ? 'Server TOP-50' : 'Серверный ТОП-50'}>
            <h3><Trophy size={19} aria-hidden="true"/>{en ? 'Server TOP-50' : 'Серверный ТОП-50'} <span>{entries.length}/50</span></h3>
            {entries.length ? entries.map((entry, index) => {
              const isMe = entry.player_id === user.id;
              const rank = index + 1;
              return <div key={entry.player_id} className={isMe ? 'arena-rank-journey__row arena-rank-journey__row--mine' : 'arena-rank-journey__row'}>
                <span className="arena-rank-journey__place">{rank <= 3 ? <Medal size={17} aria-hidden="true"/> : null}№{rank}</span>
                <div className="arena-rank-journey__portrait">
                  {entry.photo_url ? <img src={entry.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer"/> : <Trophy size={19} aria-hidden="true"/>}
                </div>
                <div className="arena-rank-journey__player">
                  <strong title={entry.display_name}>{entry.display_name}{isMe ? (en ? ' (you)' : ' (ты)') : ''}</strong>
                  <small>{en ? 'Level' : 'Уровень'} {entry.level}</small>
                </div>
                <b className="arena-rank-journey__score">{number(entry[metric])}</b>
              </div>;
            }) : <p className="arena-rank-journey__empty">{en ? 'Win a confirmed Arena battle to join the competition.' : 'Победи на Арене, чтобы участвовать в соревновании.'}</p>}
          </section>
        </>}

        <nav className="arena-rank-journey__actions" aria-label={en ? 'Arena ranking actions' : 'Действия рейтинга'}>
          {onArena && <button type="button" className="arena-rank-journey__primary" onClick={onArena}>
            <Swords size={20} aria-hidden="true"/>{en ? 'Go to Arena' : 'На Арену'}<ArrowRight size={17} aria-hidden="true"/>
          </button>}
          <div className="arena-rank-journey__secondary">
            <button type="button" onClick={() => setTab('season')}>{en ? 'Championship' : 'Чемпионат'}</button>
            <button type="button" onClick={() => void loadLeaderboard(tab)} disabled={loading}>
              <RefreshCcw size={16} aria-hidden="true"/>{en ? 'Refresh' : 'Обновить'}
            </button>
          </div>
        </nav>
      </>}
    </div>
  </div>;
}
