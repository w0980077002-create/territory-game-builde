import { useEffect, useState } from 'react';
import { ArrowRight, Swords } from 'lucide-react';
import type { AuthUser } from '@/game/auth';
import { useLanguage } from '@/game/i18n';
import { SHOW_WEEKLY_CHAMPIONSHIP } from '@/game/uiFeatureFlags';
import { ArenaWeeklyBoard } from './arena/ArenaWeeklyBoard';
import { SeasonScreen } from './SeasonScreen';
import './arena/arenaLobby.css';
import './arenaRankJourney.css';

type InitialRankTab = 'rating' | 'wins' | 'season';
type RankTab = 'arena' | 'season';

/** One public Arena TOP-50: the very same players, opponents, ranking and
 * appearance as the Arena lobby. No separate lifetime/server-only leaderboard
 * and no other player's level is shown here. Official prizes stay untouched. */
export function LeaderboardScreen({ user, initialTab = 'rating', onArena, onEvents, onMessages }: {
  user: AuthUser;
  initialTab?: InitialRankTab;
  onArena?: () => void;
  onEvents?: () => void;
  onMessages?: () => void;
}) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [tab, setTab] = useState<RankTab>(SHOW_WEEKLY_CHAMPIONSHIP && initialTab === 'season' ? 'season' : 'arena');

  useEffect(() => {
    setTab(SHOW_WEEKLY_CHAMPIONSHIP && initialTab === 'season' ? 'season' : 'arena');
  }, [initialTab]);

  return <div className="arena-rank-journey viking-screen viking-screen--leaderboard animate-fade-in" data-testid="arena-rank-journey">
    {SHOW_WEEKLY_CHAMPIONSHIP && <div className="arena-rank-journey__tabs" role="tablist" aria-label={en ? 'Arena rankings' : 'Рейтинги Арены'}>
      {([
        ['arena', en ? 'Arena TOP-50' : 'ТОП-50 Арены'],
        ['season', en ? 'Championship' : 'Чемпионат'],
      ] as const).map(([id, label]) =>
        <button type="button" role="tab" key={id} aria-selected={tab === id}
          aria-controls="arena-rank-journey-content" onClick={() => setTab(id)}
          className={tab === id ? 'arena-rank-journey__tab arena-rank-journey__tab--active' : 'arena-rank-journey__tab'}>
          {label}
        </button>
      )}
    </div>}

    <div id="arena-rank-journey-content" role="tabpanel" className="arena-rank-journey__content">
      {SHOW_WEEKLY_CHAMPIONSHIP && tab === 'season'
        ? <SeasonScreen user={user} onArena={onArena} onEvents={onEvents} onMessages={onMessages}
            onRankings={() => setTab('arena')} />
        : <>
            <div className="arena-lobby arena-approved-entry arena-rank-journey__arena-top" data-testid="arena-rank-shared-top50">
              <ArenaWeeklyBoard />
            </div>
            {onArena && <nav className="arena-rank-journey__actions" aria-label={en ? 'Arena actions' : 'Действия Арены'}>
              <button type="button" className="arena-rank-journey__primary" onClick={onArena}>
                <Swords size={20} aria-hidden="true" />{en ? 'Go to Arena' : 'На Арену'}<ArrowRight size={17} aria-hidden="true" />
              </button>
            </nav>}
          </>}
    </div>
  </div>;
}
