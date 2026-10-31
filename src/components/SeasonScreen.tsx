import { ChevronRight, Mail, Swords, Trophy } from 'lucide-react';
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

/** The public championship shows one canonical Arena TOP-50 only.
 * The independent server prize ledger stays intact and remains outside this screen.
 * Never show the owner two incompatible places or two unrelated season clocks. */
export function SeasonScreen({ onArena, onEvents, onMessages, onRankings }: Props) {
  const { language } = useLanguage();
  const en = language === 'en';

  return <section className="viking-screen viking-screen--season season-journey" data-testid="season-journey">
    <header className="season-journey__hero">
      <img src={import.meta.env.BASE_URL + 'ic-trophy.webp'} alt="" loading="lazy" />
      <div className="season-journey__heading">
        <span>{en ? 'ARENA' : 'АРЕНА'}</span>
        <h2>{en ? 'Weekly championship' : 'Недельный чемпионат'}</h2>
        <p>{en ? 'The same weekly TOP-50 as in the Arena.' : 'Тот же недельный ТОП-50, что и на Арене.'}</p>
      </div>
    </header>

    <div className="arena-lobby arena-approved-entry season-journey__arena-top" data-testid="season-arena-top50">
      <ArenaWeeklyBoard />
    </div>

    <nav className="season-journey__actions" aria-label={en ? 'Championship navigation' : 'Навигация чемпионата'}>
      {onArena && <button type="button" className="season-journey__primary" onClick={onArena}>
        <Swords size={20} aria-hidden="true"/>{en ? 'Open Arena' : 'Открыть Арену'}<ChevronRight size={17} aria-hidden="true"/>
      </button>}
      {(onRankings || onEvents || onMessages) && <div className={onRankings ? 'season-journey__secondary season-journey__secondary--four' : 'season-journey__secondary'}>
        {onRankings && <button type="button" data-testid="season-open-top50" onClick={onRankings}><Trophy size={17} aria-hidden="true"/>{en ? 'Arena TOP-50' : 'ТОП-50 Арены'}</button>}
        {onEvents && <button type="button" onClick={onEvents}>{en ? 'Events' : 'События'}</button>}
        {onMessages && <button type="button" onClick={onMessages}><Mail size={17} aria-hidden="true"/>{en ? 'Mail' : 'Почта'}</button>}
      </div>}
    </nav>
  </section>;
}
