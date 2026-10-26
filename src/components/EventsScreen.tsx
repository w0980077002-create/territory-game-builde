import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CalendarDays, Check, ChevronRight, Clock3, Crown, Gift, Map, RefreshCw, ScrollText, Shield, Swords, Ticket, Trophy } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { useLive } from '@/game/live';
import { useLanguage } from '@/game/i18n';
import { DAILY_REWARDS, MAIL, blessingReady, dailyStatus } from '@/game/progression';
import { hallStatus, type HallState } from '@/game/gameHall';
import { fetchSeasonStatus, type SeasonStatus } from '@/game/seasonApi';
import { getArenaWeeklyStatus, type ArenaWeeklyStatus } from '@/game/arenaWeekly';
import { eventCalendar, readyQuestCount, withEventStatusTimeout } from '@/game/eventsBoard';
import { captureGameEvent } from '@/game/analytics';
import { seasonCountdown, seasonWindow } from '@/game/seasonCalendar';
import './eventsBoard.css';

export type EventDestination = 'city' | 'quests' | 'games' | 'map' | 'arena' | 'leaderboard' | 'messages' | 'clan';
type CardStatus = 'ready' | 'done' | 'active' | 'unknown';

function EventCard({ icon: Icon, image, name, description, detail, status, action, actionId, onClick, en }: {
  icon: typeof Gift; image?: string; name: string; description: string; detail?: string;
  status: CardStatus; action?: string; actionId?: string; onClick?: () => void; en: boolean;
}) {
  const statuses: Record<CardStatus, string> = {
    ready: en ? 'READY' : 'ГОТОВО', done: en ? 'DONE' : 'ГОТОВО ✓',
    active: en ? 'ACTIVE' : 'АКТИВНО', unknown: en ? 'CHECK STATUS' : 'ПРОВЕРКА',
  };
  return <article className={`territory-event territory-event--${status}`}>
    <div className="territory-event__art" aria-hidden="true">
      {image ? <img src={import.meta.env.BASE_URL + image} alt="" loading="lazy" decoding="async"/> : <Icon size={29} strokeWidth={1.8}/>}
    </div>
    <div className="territory-event__body">
      <div className="territory-event__heading"><h3>{name}</h3><span className="territory-event__status">{status === 'done' && <Check size={10}/>} {statuses[status]}</span></div>
      <p>{description}</p>
      {detail && <span className="territory-event__detail">{detail}</span>}
      {action && onClick && <button type="button" className="territory-event__action" onClick={() => { captureGameEvent('territory_events_action', { screen: 'events', mode: actionId }); onClick(); }}>{action}<ChevronRight size={14}/></button>}
    </div>
  </article>;
}

/** Real existing bonuses and competition progress; zero synthetic payouts. */
export function EventsScreen({ onNavigate, onDaily, gatherReady }: {
  onNavigate: (screen: EventDestination) => void;
  onDaily: () => void;
  onSeason: () => void;
  gatherReady: boolean;
}) {
  const { language } = useLanguage();
  const en = language === 'en';
  const state = useStore(useGame);
  const { mail } = useStore(useLive);
  const [tab, setTab] = useState<'daily' | 'weekly'>('daily');
  const [clock, setClock] = useState(Date.now());
  const [hall, setHall] = useState<HallState | null>(null);
  const [season, setSeason] = useState<SeasonStatus | null>(null);
  const [arena, setArena] = useState<ArenaWeeklyStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState({ hall: false, season: false, arena: false });
  const tabRef = useRef<'daily' | 'weekly'>('daily');
  const currentRequest = useRef(0);
  const lastFetched = useRef({ daily: 0, weekly: 0 });

  const refresh = useCallback((view: 'daily' | 'weekly' = tabRef.current) => {
    const request = ++currentRequest.current;
    lastFetched.current[view] = Date.now();
    setChecking(true);
    setFailed({ hall: false, season: false, arena: false });
    // Daily opening needs only Hall status; defer weekly RPCs until the
    // player opens that tab. Stalled optional reads expire independently.
    const checks = view === 'daily' ? [
      withEventStatusTimeout(hallStatus()).then(value => { if (request === currentRequest.current) setHall(value); })
        .catch(() => { if (request === currentRequest.current) { setHall(null); setFailed(v => ({ ...v, hall: true })); } }),
    ] : [
      withEventStatusTimeout(fetchSeasonStatus()).then(value => { if (request === currentRequest.current) setSeason(value); })
        .catch(() => { if (request === currentRequest.current) { setSeason(null); setFailed(v => ({ ...v, season: true })); } }),
      withEventStatusTimeout(getArenaWeeklyStatus()).then(value => { if (request === currentRequest.current) setArena(value); })
        .catch(() => { if (request === currentRequest.current) { setArena(null); setFailed(v => ({ ...v, arena: true })); } }),
    ];
    void Promise.allSettled(checks).then(() => { if (request === currentRequest.current) setChecking(false); });
  }, []);

  useEffect(() => {
    refresh('daily');
    const ticker = window.setInterval(() => setClock(Date.now()), 30_000);
    const resumed = () => {
      if (document.visibilityState === 'visible') {
        setClock(Date.now());
        const view = tabRef.current;
        if (Date.now() - lastFetched.current[view] > 90_000) refresh(view);
      }
    };
    document.addEventListener('visibilitychange', resumed);
    window.addEventListener('online', resumed);
    return () => {
      currentRequest.current += 1;
      window.clearInterval(ticker);
      document.removeEventListener('visibilitychange', resumed);
      window.removeEventListener('online', resumed);
    };
  }, [refresh]);

  const daily = dailyStatus(state, clock);
  const blessing = blessingReady(state, clock);
  const dayQuests = state.quests.filter(q => q.type === 'daily' && !q.claimed);
  const weekQuests = state.quests.filter(q => q.type === 'weekly' && !q.claimed);
  const readyDaily = readyQuestCount(state.quests, 'daily');
  const readyWeekly = readyQuestCount(state.quests, 'weekly');
  const unreadMail = MAIL.filter(letter => !state.mailClaimed.includes(letter.id)).length + mail.length;
  const time = eventCalendar(clock);
  const seasonActive = season?.enabled === true && season.week === seasonWindow(clock).weekKey;
  // A staged server can report an older week; never display it as today's contest.
  const weeklySeasonLive = seasonActive && season?.ends_at !== '' && Date.parse(season.ends_at) > clock;
  const weeklyArenaLive = !!arena && Date.parse(arena.starts_at) <= clock && Date.parse(arena.ends_at) > clock;
  const readyNow = Number(!daily.claimedToday) + Number(blessing) + Number(readyDaily > 0)
    + Number(hall?.free_ready === true) + Number(gatherReady) + Number(unreadMail > 0);
  const dayReward = DAILY_REWARDS[daily.dayIndex];
  const format = (n: number) => n.toLocaleString(en ? 'en-US' : 'ru-RU');
  const visit = (destination: EventDestination) => () => onNavigate(destination);
  const switchTab = (next: 'daily' | 'weekly') => {
    if (tabRef.current === next) return;
    tabRef.current = next;
    setTab(next);
    refresh(next);
  };

  return <div className="territory-events" data-testid="territory-events">
    <header className="territory-events__hero">
      <div className="territory-events__hero-mark"><img src={import.meta.env.BASE_URL + 'ic-events.webp'} alt="" /></div>
      <div className="territory-events__hero-text">
        <span className="territory-events__kicker">TERRITORY · {en ? 'LIVE EVENTS' : 'СОБЫТИЯ'}</span>
        <h2>{en ? 'Adventure calendar' : 'Календарь приключений'}</h2>
        <p>{en ? 'Real quests, bonuses and standings in one place' : 'Все задания, бонусы и соревнования в одном месте'}</p>
      </div>
      <button type="button" className="territory-events__refresh" onClick={() => refresh()} aria-label={en ? 'Refresh events' : 'Обновить события'} disabled={checking}>
        <RefreshCw size={18} className={checking ? 'animate-spin' : ''}/>
      </button>
    </header>

    <div className="territory-events__summary">
      <div><Bell size={16}/><strong>{readyNow}</strong><span>{en ? 'requiring attention' : 'требуют внимания'}</span></div>
      <div><Clock3 size={16}/><strong>{seasonCountdown(time.dailyRemaining, language)}</strong><span>{en ? 'until Kyiv midnight' : 'до полуночи по Киеву'}</span></div>
    </div>

    <div className="territory-events__tabs" role="tablist" aria-label={en ? 'Event calendar' : 'Календарь событий'}>
      <button id="territory-events-daily-tab" type="button" role="tab" aria-controls="territory-events-daily-panel" aria-selected={tab === 'daily'} onClick={() => switchTab('daily')}><CalendarDays size={17}/>{en ? 'Today' : 'Сегодня'}</button>
      <button id="territory-events-weekly-tab" type="button" role="tab" aria-controls="territory-events-weekly-panel" aria-selected={tab === 'weekly'} onClick={() => switchTab('weekly')}><Trophy size={17}/>{en ? 'This week' : 'Эта неделя'}</button>
    </div>

    {tab === 'daily' ? <div id="territory-events-daily-panel" className="territory-events__list" role="tabpanel" aria-labelledby="territory-events-daily-tab">
      <EventCard icon={Gift} image="ic-daily.webp" name={en ? 'Daily login gift' : 'Ежедневный подарок'}
        description={en ? `Day ${daily.dayIndex + 1} of 7. Open the reward calendar.` : `День ${daily.dayIndex + 1} из 7. Забери подарок в календаре.`}
        detail={dayReward ? [dayReward.gold ? `${format(dayReward.gold)} 🪙` : '', dayReward.gems ? `${dayReward.gems} 💎` : '', dayReward.stones ? `${dayReward.stones} ⚔️` : ''].filter(Boolean).join(' · ') : ''}
        status={daily.claimedToday ? 'done' : 'ready'} action={en ? 'Open rewards' : 'Открыть награды'} actionId="daily-reward" onClick={onDaily} en={en}/>
      <EventCard icon={Ticket} image="hall-art/dice-mobile.webp" name={en ? 'Game Hall tickets' : 'Бесплатные игровые билеты'}
        description={hall ? (en ? `${format(hall.tickets)} tickets in your wallet · +2 daily` : `На счету ${format(hall.tickets)} билетов · ежедневно +2`) : (en ? 'Ticket status is checked on the game server' : 'Наличие билетов проверяется сервером')}
        status={hall ? hall.free_ready ? 'ready' : 'done' : 'unknown'} action={en ? 'Go to Game Hall' : 'В игровой зал'} actionId="hall-tickets" onClick={visit('games')} en={en}/>
      <EventCard icon={ScrollText} image="ic-quests.webp" name={en ? 'Daily quests' : 'Ежедневные задания'}
        description={en ? `${readyDaily} rewards ready · ${dayQuests.length} active tasks` : `${readyDaily} наград готово · ${dayQuests.length} текущих заданий`}
        status={readyDaily ? 'ready' : dayQuests.length ? 'active' : 'done'} action={en ? 'Open quests' : 'Перейти к заданиям'} actionId="daily-quests" onClick={visit('quests')} en={en}/>
      <EventCard icon={Shield} image="ic-blessing.webp" name={en ? 'Battle blessing' : 'Боевое благословение'}
        description={blessing ? (en ? '+50% campaign gold for 3 fights. Claim in City.' : '+50% золота за 3 боя в походе. Забери в городе.') : (en ? `${state.blessing.charges} boosted fights remaining` : `Усиленных боёв осталось: ${state.blessing.charges}`)}
        status={blessing ? 'ready' : 'done'} action={en ? 'Go to City' : 'В город'} actionId="blessing" onClick={visit('city')} en={en}/>
      <EventCard icon={Map} image="nav-map-parchment.webp" name={en ? 'Resource gathering' : 'Добыча ресурсов'}
        description={gatherReady ? (en ? 'Your 4-hour gathering is complete. Claim it.' : 'Добыча за 4 часа завершена. Забери ресурс.') : (en ? 'Gather a resource on the Map. One action at a time.' : 'Добывай ресурс на карте. Одновременно только один.')}
        status={gatherReady ? 'ready' : 'active'} action={en ? 'Open Map' : 'Открыть карту'} actionId="gather" onClick={visit('map')} en={en}/>
      <EventCard icon={Bell} image="ic-mail.webp" name={en ? 'Mail and gifts' : 'Почта и подарки'}
        description={en ? `${unreadMail} unclaimed letters` : `Не получено писем: ${unreadMail}`}
        status={unreadMail ? 'ready' : 'done'} action={en ? 'Open inbox' : 'Открыть сообщения'} actionId="mail" onClick={visit('messages')} en={en}/>
    </div> : <div id="territory-events-weekly-panel" className="territory-events__list" role="tabpanel" aria-labelledby="territory-events-weekly-tab">
      <div className="territory-events__week-clock"><Clock3 size={16}/>{en ? 'Week ends in' : 'До конца недели'} <strong>{seasonCountdown(time.weeklyRemaining, language)}</strong></div>
      <EventCard icon={ScrollText} image="ic-quests.webp" name={en ? 'Weekly challenges' : 'Недельные задания'}
        description={en ? `${readyWeekly} rewards ready · ${weekQuests.length} active tasks` : `${readyWeekly} наград готово · ${weekQuests.length} текущих заданий`}
        status={readyWeekly ? 'ready' : weekQuests.length ? 'active' : 'done'} action={en ? 'Open quests' : 'Перейти к заданиям'} actionId="weekly-quests" onClick={visit('quests')} en={en}/>
      <EventCard icon={Swords} image="ic-arena.webp" name={en ? 'Arena weekly ranking' : 'Недельный рейтинг арены'}
        description={weeklyArenaLive && arena ? (en ? `Verified wins: ${format(arena.my_wins)} · rank ${arena.my_rank ? '#' + arena.my_rank : '—'}` : `Подтверждено побед: ${format(arena.my_wins)} · место ${arena.my_rank ? '№' + arena.my_rank : '—'}`)
          : (en ? 'The Arena server confirms weekly wins and positions.' : 'Победы и место в рейтинге подтверждает сервер арены.')}
        status={weeklyArenaLive ? 'active' : 'unknown'} action={en ? 'Fight in Arena' : 'Сражаться на арене'} actionId="arena-weekly" onClick={visit('arena')} en={en}/>
      <EventCard icon={Crown} image="ic-trophy.webp" name={en ? 'Weekly championship' : 'Недельный чемпионат'}
        description={weeklySeasonLive && season ? (en ? `Your points: ${format(season.my_points)} · place ${season.my_rank ? '#' + season.my_rank : '—'}` : `Твои очки: ${format(season.my_points)} · место ${season.my_rank ? '№' + season.my_rank : '—'}`)
          : (en ? 'Points and prizes start only when the server enables the championship.' : 'Очки и призы появятся после запуска чемпионата на сервере.')}
        status={weeklySeasonLive ? 'active' : 'unknown'} en={en}/>
      <EventCard icon={Shield} image="nav-clan.webp" name={en ? 'Clan missions' : 'Клановые испытания'}
        description={en ? 'Contributions, quests, clan boss and wars.' : 'Взносы, задания, клановый босс и войны.'}
        status="active" action={en ? 'Open Clan' : 'Войти в клан'} actionId="clan" onClick={visit('clan')} en={en}/>
    </div>}

    {(failed.hall || failed.arena || failed.season) && <p className="territory-events__note" role="status">
      {en ? 'Some live data is unavailable. Your items and rewards have not changed.' : 'Некоторые серверные данные временно недоступны. Награды и предметы не изменены.'}
    </p>}
    <p className="territory-events__footnote">{en ? 'Countdowns use Kyiv time. Rewards and rankings are confirmed by the game server.' : 'Таймеры работают по Киеву. Начисления и рейтинги подтверждаются сервером игры.'}</p>
  </div>;
}
