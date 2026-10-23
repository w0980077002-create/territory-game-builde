import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, ChevronRight, Gift, Loader2, RefreshCw, Ticket,
} from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { captureGameEvent } from '@/game/analytics';
import {
  hallStatus, hallDaily, autoClaimHallGold, hallError,
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
  artwork: string;
  color: 'green' | 'blue' | 'violet' | 'red' | 'gold';
  comingSoon?: boolean;
  demo?: boolean;
}

const base = import.meta.env.BASE_URL;
const GAMES: GameCard[] = [
  {
    id: 'monopoly', ru: 'Монополия', en: 'Monopoly',
    ruHint: 'Поле, кубик, события, награды', enHint: 'Board, dice, events and prizes',
    scene: 'hall-art/monopoly.svg', artwork: 'hall-art/monopoly-hd.webp', color: 'green',
  },
  {
    id: 'treasury', ru: 'Сокровищница', en: 'Treasury',
    ruHint: 'Открывай сундуки, получай награды', enHint: 'Open chests and collect prizes',
    scene: 'hall-art/treasury.svg', artwork: 'hall-art/treasury-hd.webp', color: 'blue',
  },
  {
    id: 'dice', ru: 'Кости судьбы', en: 'Dice of Fate',
    ruHint: 'Рискни и сорви куш', enHint: 'Take a chance and win big',
    scene: 'hall-art/dice.svg', artwork: 'hall-art/dice-hd.webp', color: 'violet',
  },
  {
    id: 'tower', ru: 'Башня испытаний', en: 'Trial Tower',
    ruHint: 'Проверь свою удачу и навыки', enHint: 'Test your luck and skills',
    scene: 'hall-art/tower.svg', artwork: 'hall-art/tower-hd.webp', color: 'red',
  },
  {
    id: 'wheel', ru: 'Колесо фортуны', en: 'Wheel of Fortune',
    ruHint: 'Вращай колесо и получай награды', enHint: 'Spin the wheel and collect prizes',
    scene: 'hall-art/wheel.svg', artwork: 'hall-art/wheel-hd.webp', color: 'gold',
  },
  {
    id: 'slots', ru: 'Сокровища викингов', en: 'Viking Treasures',
    ruHint: 'Автомат с бонусами и риском · демо', enHint: 'Reels, bonuses and double-up · demo',
    scene: 'hall-art/slots.svg', artwork: 'hall-art/slots.svg', color: 'gold', demo: true,
  },
];

export function GamesScreen({
  onPlay, userId,
}: { onPlay: (id: HallGame) => void; userId: string }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const hallRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const shell = hallRef.current?.closest('.territory-shell');
    shell?.classList.add('territory-hall-open');
    return () => { shell?.classList.remove('territory-hall-open'); };
  }, []);
  const [state, setState] = useState<HallState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [payoutRecovery, setPayoutRecovery] = useState(false);

  const refresh = async (isCurrent:()=>boolean=()=>true) => {
    try {
      const next=await hallStatus();
      if(!isCurrent())return;
      setState(next);
      setError('');
      setLoading(false);
      if(next.pending_gold>0){
        try {
          const amount=await autoClaimHallGold(userId,next.pending_gold);
          if(!isCurrent())return;
          // The server has consumed the pending payout; never synthesize player gold.
          setPayoutRecovery(false);
          if(amount>0)setNotice(en ? `+${amount} gold credited automatically!` : `+${amount} золота автоматически зачислено персонажу!`);
          const settled=await hallStatus();
          if(isCurrent())setState(settled);
        }catch {
          if(isCurrent())setPayoutRecovery(true); // Payout is safely retained on the server.
        }
      }else{
        setPayoutRecovery(false);
      }
    }catch(cause){
      if(isCurrent())setError(hallError(cause,en));
    }finally{
      if(isCurrent())setLoading(false);
    }
  };

  useEffect(()=>{
    let mounted=true;
    void refresh(()=>mounted);
    return ()=>{mounted=false;};
  },[en,userId]);

  const takeDaily=async()=>{
    if(busy||loading||!state?.free_ready)return;
    setBusy(true);setError('');setNotice('');
    try{
      await hallDaily();
      captureGameEvent('territory_hall_ticket_claim', { outcome: 'success' });
      setNotice(en?'Two free tickets collected!':'Получено 2 бесплатных билета!');
      await refresh();
    }catch(cause){
      setError(hallError(cause,en));
    }finally{setBusy(false);}
  };

  const play = (game: GameCard) => {
    const id = game.id as HallGame;
    // Preview has no server ticket debits, no gold payouts, and works offline from the Hall API.
    if (id === 'slots') { onPlay('slots'); return; }
    if (!state || loading || busy) return;
    if (state.active) {
      if (state.active.game !== id) return;
      onPlay(state.active.game);
      return;
    }
    if (state.tickets < 1 && id !== 'treasury' && id !== 'wheel') {
      setNotice(en ? 'Collect tickets to play.' : 'Получи билеты, чтобы играть.');
      captureGameEvent('territory_hall_no_tickets', { mode: id });
      return;
    }
    onPlay(id);
  };

  return (
    <div ref={hallRef} className="territory-game-hall" data-testid="game-hall">
      <header className="hall-marquee" style={{backgroundImage: `url("${base}hall-art/marquee.svg")`}} aria-label={en ? 'TERRITORY Game Hall' : 'TERRITORY Игровой зал'}>
        <span className="hall-marquee__sr">{en ? 'TERRITORY GAME HALL' : 'TERRITORY ИГРОВОЙ ЗАЛ'}</span>
        {en && <span className="hall-marquee__en-neon">GAME HALL</span>}
      </header>

      <section className="hall-cashier" aria-label={en ? 'Game Hall wallet' : 'Касса игрового зала'}>
        <div className="hall-cashier__stats hall-cashier__stats--tickets-only">
          <div className="hall-cashier__stat hall-cashier__stat--tickets">
            <Ticket className="hall-cashier__stat-icon" aria-hidden="true" />
            <strong className="hall-cashier__value tabular-nums">{loading?'…':state?.tickets??'—'}</strong>
            <span className="hall-cashier__label">{en?'Tickets available':'Билеты для игр'}</span>
          </div>
        </div>
        <div className="hall-cashier__actions hall-cashier__actions--single">
          <button type="button" className="hall-action hall-action--gift" onClick={()=>void takeDaily()}
            disabled={busy||loading||!state?.free_ready} data-testid="hall-free-tickets">
            {busy?<Loader2 className="animate-spin" size={18}/>:<Gift size={22}/>}
            <span>
              <b>{en?'Free +2':'Бесплатно +2'}</b>
              <small>{loading ? (en ? 'Loading…' : 'Загрузка…') : !state ? (en ? 'Daily bonus' : 'Ежедневный бонус') : state.free_ready ? (en ? 'Daily bonus' : 'Ежедневный бонус') : (en ? 'Back after 00:00' : 'После 00:00')}</small>
            </span>
            <ChevronRight className="hall-action__end" size={16} aria-hidden="true"/>
          </button>
        </div>
        {payoutRecovery&&<div className="hall-payout-recovery" role="status">
          <span>{en?'Your gold is saved; automatic credit is delayed.':'Выигранное золото сохранено. Автоматическое зачисление пока не удалось.'}</span>
          <button type="button" disabled={busy} onClick={()=>void refresh()}>{en?'Retry credit':'Повторить зачисление'}</button>
        </div>}
      </section>

      {!loading && state?.tickets === 0 && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-950/25 p-3 text-sm text-amber-100" role="status">
          <strong className="block font-bold">{en ? 'Out of game tickets?' : 'Закончились игровые билеты?'}</strong>
          <span className="block mt-1">
            {state.free_ready
              ? (en ? 'Your 2 daily free tickets are ready. Claim them above.' : 'Твои 2 бесплатных билета на сегодня готовы. Забери их в кассе выше.')
              : (en ? 'The next 2 free tickets can be claimed after midnight Kyiv time. No purchase required.'
                : 'Следующие 2 бесплатных билета можно забрать после полуночи по Киеву. Покупка не нужна.')}
          </span>
          {state.free_ready && (
            <button type="button" disabled={busy} onClick={() => void takeDaily()}
              className="mt-2 rounded-lg border border-amber-300/50 bg-amber-600/25 px-3 py-2 font-bold disabled:opacity-50">
              {en ? 'Claim 2 free tickets' : 'Забрать 2 билета'}
            </button>
          )}
        </div>
      )}

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
              aria-label={`${en ? game.en : game.ru} · ${game.demo ? (en ? 'Demo, no real rewards' : 'Демо, без реальных наград') : game.comingSoon ? (en ? 'Play, no tickets used' : 'Играть, билеты не списываются') : (en ? '1 ticket' : '1 билет')}`}
              onClick={() => play(game)}
              disabled={!game.demo && !game.comingSoon && (loading || !state || busy || otherActive)}
              className={`hall-game hall-game--${game.color} ${featured ? 'hall-game--featured' : ''} ${locked && !game.comingSoon && !game.demo ? 'hall-game--no-tickets' : ''} ${game.comingSoon ? 'hall-game--coming-soon' : ''}`}
            >
              <picture className="hall-game__scene">
                <source
                  type="image/webp"
                  srcSet={featured
                    ? `${base + game.artwork} 1774w`
                    : `${base + game.artwork.replace('-hd.webp', '-mobile.webp')} 768w, ${base + game.artwork} 1536w`}
                  sizes={featured
                    ? '(max-width: 448px) calc(100vw - 18px), 430px'
                    : '(max-width: 360px) calc((100vw - 21px) / 2), (max-width: 448px) calc((100vw - 27px) / 2), 211px'}
                />
                <img src={base + game.scene} alt="" loading="lazy" decoding="async" draggable={false} />
              </picture>
              <span className="hall-game__glow" aria-hidden="true" />
              <span className="hall-game__shimmer" aria-hidden="true" />
              {featured && <span className="hall-game__ribbon">{en ? 'Popular' : 'Популярно'}</span>}
              
              {!game.comingSoon && !game.demo && <span className="hall-game__price" aria-label={en ? '1 ticket' : '1 билет'}><Ticket size={13} aria-hidden="true" /> 1</span>}
              <span className="hall-game__info">
                <strong className="hall-game__name">{en ? game.en : game.ru}</strong>
                <small className="hall-game__hint">{en ? game.enHint : game.ruHint}</small>
              </span>
              <span className="hall-game__play">{game.demo ? (en ? 'Try demo' : 'Демо') : (en ? 'Play' : 'Играть')}<ChevronRight size={14} aria-hidden="true" /></span>
            </button>
          );
        })}
      </section>

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
