import { useEffect, useState } from 'react';
import {
  ArrowRight, Coins, Gift, Loader2, RefreshCw, ShieldCheck,
  Sparkles, Ticket, Trophy,
} from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import {
  hallStatus, hallDaily, hallClaimGold, hallError,
  type HallGame, type HallState,
} from '@/game/gameHall';
import './gameHall.css';

interface GameCard {
  id: HallGame | 'wheel';
  ru: string;
  en: string;
  ruHint: string;
  enHint: string;
  scene: string;
  foreground: string;
  color: 'green' | 'blue' | 'violet' | 'red' | 'gold';
  comingSoon?: boolean;
}

const base = import.meta.env.BASE_URL;
const GAMES: GameCard[] = [
  {
    id: 'monopoly', ru: 'Монополия', en: 'Monopoly',
    ruHint: 'Поле, кубик, события, награды', enHint: 'Board, dice, events and prizes',
    scene: 'hall-art/monopoly.svg', foreground: '', color: 'green',
  },
  {
    id: 'treasury', ru: 'Сокровищница', en: 'Treasury',
    ruHint: 'Открывай сундуки, получай награды', enHint: 'Open chests and collect prizes',
    scene: 'hall-art/treasury.svg', foreground: '', color: 'blue',
  },
  {
    id: 'dice', ru: 'Кости судьбы', en: 'Dice of Fate',
    ruHint: 'Рискни и сорви куш', enHint: 'Take a chance and win big',
    scene: 'hall-art/dice.svg', foreground: '', color: 'violet',
  },
  {
    id: 'tower', ru: 'Башня испытаний', en: 'Trial Tower',
    ruHint: 'Проверь свою удачу и навыки', enHint: 'Test your luck and skills',
    scene: 'hall-art/tower.svg', foreground: '', color: 'red',
  },
  {
    id: 'wheel', ru: 'Колесо фортуны', en: 'Wheel of Fortune',
    ruHint: 'Вращай колесо и получай награды', enHint: 'Spin the wheel and collect prizes',
    scene: 'hall-art/wheel.svg', foreground: '', color: 'gold',
    comingSoon: true,
  },
];

export function GamesScreen({
  onPlay, userId,
}: { onPlay: (id: HallGame) => void; userId: string }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [state, setState] = useState<HallState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showRules, setShowRules] = useState(false);

  const refresh = async () => {
    try {
      setState(await hallStatus());
      setError('');
    } catch (cause) {
      setError(hallError(cause, en));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    // Never create a new wallet or infer rewards while fetching the real status.
    void hallStatus().then((result) => {
      if (mounted) { setState(result); setError(''); }
    }).catch((cause) => {
      if (mounted) setError(hallError(cause, en));
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [en]);

  const takeDaily = async () => {
    if (busy || loading || !state?.free_ready) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await hallDaily();
      setNotice(en ? 'Two free tickets collected!' : 'Получено 2 бесплатных билета!');
      await refresh();
    } catch (cause) {
      setError(hallError(cause, en));
    } finally { setBusy(false); }
  };

  const claim = async () => {
    if (busy || loading || !state || state.pending_gold < 1) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const amount = await hallClaimGold(userId);
      setNotice(en ? `+${amount} gold credited to your hero!` : `+${amount} золота зачислено герою!`);
      await refresh();
    } catch (cause) {
      setError(hallError(cause, en));
    } finally { setBusy(false); }
  };

  const play = (game: GameCard) => {
    if (game.comingSoon) {
      setNotice(en ? 'Wheel of Fortune is being prepared. No tickets were used.' : 'Колесо фортуны готовится к запуску. Билеты не списаны.');
      return;
    }
    const id = game.id as HallGame;
    if (!state || loading || busy) return;
    if (state.active) {
      onPlay(state.active.game);
      return;
    }
    if (state.tickets < 1) {
      setNotice(en ? 'Collect tickets to play.' : 'Получи билеты, чтобы играть.');
      return;
    }
    onPlay(id);
  };

  const numbers = [
    { key: 'tickets', value: state?.tickets, ru: 'Билеты', en: 'Tickets', icon: Ticket, style: 'tickets' },
    { key: 'points', value: state?.points, ru: 'Очки зала', en: 'Hall points', icon: Trophy, style: 'points' },
    { key: 'gold', value: state?.pending_gold, ru: 'Золото', en: 'Gold', icon: Coins, style: 'gold' },
  ] as const;

  return (
    <div className="territory-game-hall" data-testid="game-hall">
      <header className="hall-marquee" style={{backgroundImage: `url("${base}hall-art/marquee.svg")`}} aria-label={en ? 'TERRITORY Game Hall' : 'TERRITORY Игровой зал'}>
        <span className="hall-marquee__sr">{en ? 'TERRITORY GAME HALL' : 'TERRITORY ИГРОВОЙ ЗАЛ'}</span>
        {en && <span className="hall-marquee__en-neon">GAME HALL</span>}
      </header>

      <section className="hall-cashier" aria-label={en ? 'Game Hall wallet' : 'Касса игрового зала'}>
        <div className="hall-cashier__stats">
          {numbers.map((counter) => {
            const Icon = counter.icon;
            return (
              <div key={counter.key} className={`hall-cashier__stat hall-cashier__stat--${counter.style}`}>
                <Icon aria-hidden="true" className="hall-cashier__stat-icon" />
                <strong className="hall-cashier__value tabular-nums">{loading ? '…' : counter.value ?? '—'}</strong>
                <span className="hall-cashier__label">{en ? counter.en : counter.ru}</span>
              </div>
            );
          })}
        </div>
        <div className="hall-cashier__actions">
          <button type="button" className="hall-action hall-action--gift" onClick={() => void takeDaily()}
            disabled={busy || loading || !state?.free_ready} data-testid="hall-free-tickets">
            {busy ? <Loader2 className="animate-spin" size={18} /> : <Gift size={22} />}
            <span>
              <b>{en ? 'FREE +2' : 'БЕСПЛАТНО +2'}</b>
              <small>{state?.free_ready ? (en ? 'Daily tickets' : 'Бонус дня') : (en ? 'Back after 00:00' : 'После 00:00')}</small>
            </span>
            <Ticket className="hall-action__end" size={20} />
          </button>
          <button type="button" className="hall-action hall-action--gold" onClick={() => void claim()}
            disabled={busy || loading || !state || state.pending_gold < 1} data-testid="hall-claim-gold">
            <Coins size={23} />
            <b>{en ? 'CLAIM GOLD' : 'ЗАБРАТЬ ЗОЛОТО'}</b>
          </button>
        </div>
        <button className="hall-cashier__info" type="button" aria-label={en ? 'About tickets and prizes' : 'О билетах и наградах'} aria-expanded={showRules} onClick={() => setShowRules(v => !v)}>i</button>
        {showRules && <p className="hall-cashier__details">{en
          ? 'Games use one ticket per round. Two free tickets are available once per day. Ad rewards will be added later.'
          : 'Игры расходуют по одному билету за раунд. Два бесплатных билета можно получить раз в сутки. Рекламные награды появятся позже.'}</p>}
        <div className="hall-cashier__rule">
          <Sparkles size={13} aria-hidden="true" />
          <span>{en ? 'One ticket per game · Play and win rewards' : '1 билет за игру · Играй и получай награды'}</span>
        </div>
      </section>

      {state?.active && (
        <button className="hall-resume" type="button" onClick={() => onPlay(state.active!.game)}
          data-testid="resume-hall">
          <RefreshCw size={18} />
          <span>{en ? 'Continue your unfinished game' : 'Продолжить незавершённую игру'}</span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      )}

      <section className="hall-games" aria-label={en ? 'Choose a game' : 'Выбери игру'}>
        {GAMES.map((game, index) => {
          const featured = index === 0;
          const locked = !state || (state.tickets < 1 && !state.active);
          const otherActive = !!state?.active && state.active.game !== game.id;
          return (
            <button
              key={game.id}
              type="button"
              data-testid={`hall-game-${game.id}`}
              aria-label={`${en ? game.en : game.ru} · ${game.comingSoon ? (en ? 'Coming soon, no tickets used' : 'Скоро, билеты не списываются') : (en ? '1 ticket' : '1 билет')}`}
              onClick={() => play(game)}
              disabled={!game.comingSoon && (loading || !state || busy || otherActive)}
              className={`hall-game hall-game--${game.color} ${featured ? 'hall-game--featured' : ''} ${locked && !game.comingSoon ? 'hall-game--no-tickets' : ''} ${game.comingSoon ? 'hall-game--coming-soon' : ''}`}
            >
              <img className="hall-game__scene" src={base + game.scene} alt="" loading="lazy" draggable={false} />
              <span className="hall-game__glow" aria-hidden="true" />
              <span className="hall-game__shimmer" aria-hidden="true" />
              {featured && <span className="hall-game__ribbon">{en ? 'POPULAR' : 'ПОПУЛЯРНО'}</span>}
              {game.foreground && <img className="hall-game__art" src={base + game.foreground} alt="" draggable={false} loading="lazy" />}
              
              <span className="hall-game__price">{game.comingSoon
                ? (en ? 'SOON' : 'СКОРО')
                : <><Ticket size={15} /> 1</>}</span>
              <span className="hall-game__info">
                <strong className="hall-game__name">{en ? game.en : game.ru}</strong>
                <small className="hall-game__hint">{en ? game.enHint : game.ruHint}</small>
              </span>
              <span className="hall-game__play">{game.comingSoon ? (en ? 'COMING SOON' : 'СКОРО')
                : state?.active?.game === game.id ? (en ? 'Resume' : 'Продолжить')
                : (en ? 'Play' : 'Играть')}</span>
            </button>
          );
        })}
      </section>

      <p className="hall-safety">
        <ShieldCheck size={15} aria-hidden="true" />
        {en
          ? 'Tickets and rewards are protected by the game server.'
          : 'Билеты и награды защищены игровым сервером.'}
      </p>
      {notice && <p role="status" className="hall-toast hall-toast--success">{notice}</p>}
      {error && (
        <div role="alert" className="hall-toast hall-toast--error">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>
            {en ? 'Retry' : 'Повторить'}
          </button>
        </div>
      )}
    </div>
  );
}
