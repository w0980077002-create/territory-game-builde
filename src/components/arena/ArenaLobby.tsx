import { useState } from 'react';
import { useStore } from '@/game/store';
import { useGame, useArena } from '@/game/actions';
import type { ArenaMode } from '@/game/arenaApi';
import { secureArenaJoin } from '@/game/arenaSecure';
import { captureGameEvent } from '@/game/analytics';
import { hapticImpact } from '@/game/telegram';
import { IosGamePortal } from '@/components/ui/Modal';
import { useLanguage, localizeText } from '@/game/i18n';
import { ChevronLeft, Flame, Info, Loader2, Swords, Trophy, Users, X } from 'lucide-react';
import { ArenaWeeklyBoard } from './ArenaWeeklyBoard';
import './arenaLobby.css';

const ENERGY_COST = 1;
const ORIGINAL = import.meta.env.BASE_URL + 'assets/territory/characters/';
const APPROVED = import.meta.env.BASE_URL + 'assets/territory/arena-approved/';
const BACKUP_SCENE = import.meta.env.BASE_URL + 'assets/territory/scenes/arena-viking.webp';

/** All three illustrated cards below are cropped from the single design approved by the player.
 * The art is merely presentation: the REAL mode still reaches secureArenaJoin(mode). */
const MODES: { id: ArenaMode; title: string; english: string; size: string; sizeEn: string; desc: string; descEn: string; bonus: string; picture: string; fallback: string; tone: string; icon: typeof Swords }[] = [
  { id: 'duel', title: 'Дуэль', english: 'Duel', size: '1 на 1', sizeEn: '1 vs 1',
    desc: 'Классический поединок', descEn: 'Classic duel', bonus: '×1', picture: APPROVED + 'duel.webp',
    fallback: ORIGINAL + 'heroes/male_viking/idle.webp', tone: 'gold', icon: Swords },
  { id: 'team', title: 'Отряд', english: 'Squad', size: '3 на 3', sizeEn: '3 vs 3',
    desc: 'Командный бой', descEn: 'Team battle', bonus: '×1.2', picture: APPROVED + 'squad.webp',
    fallback: ORIGINAL + 'heroes/female_warrior/idle.webp', tone: 'blue', icon: Users },
  { id: 'chaos', title: 'Хаос', english: 'Chaos', size: 'до 20 на 20', sizeEn: 'up to 20 vs 20',
    desc: 'Масштабная битва', descEn: 'Mass battle', bonus: '×1.5', picture: APPROVED + 'chaos.webp',
    fallback: ORIGINAL + 'enemies/goblin/idle.webp', tone: 'red', icon: Flame },
];

export function ArenaLobby({ onJoined, onBack, backDisabled = false }: {
  onJoined: (roomId: string) => void;
  onBack?: () => void;
  backDisabled?: boolean;
}) {
  const { language } = useLanguage();
  const en = language === 'en';
  const state = useStore(useGame);
  const arena = useStore(useArena);
  const [joining, setJoining] = useState<ArenaMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [artFailed, setArtFailed] = useState(false);
  const noEnergy = state.player.energy < ENERGY_COST;

  const join = async (mode: ArenaMode) => {
    if (joining) return;
    if (noEnergy) {
      setError(en ? 'Not enough energy. 1 point returns every 5 minutes.' : 'Недостаточно энергии. 1 единица восстанавливается каждые 5 минут.');
      return;
    }
    hapticImpact('medium');
    setJoining(mode);
    setError(null);
    try {
      // Do not touch the server-authoritative matchmaking, wallet or room state.
      const roomId = await secureArenaJoin(mode);
      captureGameEvent('territory_arena_fight_start', { mode });
      onJoined(roomId);
    } catch (e) {
      setError(localizeText((e as Error).message, language));
      setJoining(null);
    }
  };

  return (
    <div className="arena-lobby arena-approved-entry animate-fade-in">
      <section className="arena-approved-hero" aria-label={en ? 'Viking Arena' : 'Арена викингов'}>
        {!artFailed ? (
          <div className={`arena-approved-stadium ${en ? 'arena-approved-stadium-en' : ''}`}>
            <img src={APPROVED + 'stadium.webp'} alt={en ? 'Colorful Viking Arena with cheering crowds' : 'Арена — праздничные трибуны викингов'} onError={() => setArtFailed(true)} />
            {en ? (
              <>
                <span className="arena-approved-en-banner" aria-hidden="true">ARENA</span>
                <button type="button" onClick={onBack} disabled={backDisabled} className="arena-approved-en-city" aria-label="City"><ChevronLeft aria-hidden="true" /> CITY</button>
                <button type="button" onClick={() => setShowRules(true)} className="arena-approved-en-rules" aria-label="Rules"><Info aria-hidden="true" /> RULES</button>
              </>
            ) : (
              <>
                <button type="button" onClick={onBack} disabled={backDisabled} className="arena-approved-hotspot arena-approved-hotspot-city" aria-label="Город"><span className="sr-only">Город</span></button>
                <button type="button" onClick={() => setShowRules(true)} className="arena-approved-hotspot arena-approved-hotspot-rules" aria-label="Правила"><span className="sr-only">Правила</span></button>
              </>
            )}
          </div>
        ) : (
          <div className="arena-approved-stadium arena-approved-stadium-fallback" style={{ backgroundImage: `url("${BACKUP_SCENE}")` }}>
            <button type="button" onClick={onBack} disabled={backDisabled} className="arena-lobby-back"><ChevronLeft className="h-4 w-4" />{en ? 'City' : 'Город'}</button>
            <strong className="arena-approved-fallback-banner">{en ? 'ARENA' : 'АРЕНА'}</strong>
            <button type="button" onClick={() => setShowRules(true)} className="arena-lobby-rules"><Info className="h-4 w-4" />{en ? 'Rules' : 'Правила'}</button>
          </div>
        )}
        <div className="arena-approved-stats" style={{ backgroundImage: `url("${APPROVED}arena-stats-ornament.svg")` }} aria-label={en ? 'Arena statistics' : 'Статистика арены'}>
          <div className="arena-approved-stat arena-approved-stat-rating"><img className="arena-approved-stat-icon" src={APPROVED + 'icon-trophy.svg'} alt="" aria-hidden="true" /><span className="arena-approved-stat-info"><strong>{arena.rating.toLocaleString('ru-RU')}</strong><span>{en ? 'RATING' : 'РЕЙТИНГ'}</span></span></div>
          <div className="arena-approved-stat arena-approved-stat-wins"><img className="arena-approved-stat-icon" src={APPROVED + 'icon-laurel.svg'} alt="" aria-hidden="true" /><span className="arena-approved-stat-info"><strong>{arena.wins.toLocaleString('ru-RU')}</strong><span>{en ? 'WINS' : 'ПОБЕДЫ'}</span></span></div>
          <div className="arena-approved-stat arena-approved-stat-losses"><img className="arena-approved-stat-icon" src={APPROVED + 'icon-skull.svg'} alt="" aria-hidden="true" /><span className="arena-approved-stat-info"><strong>{arena.losses.toLocaleString('ru-RU')}</strong><span>{en ? 'LOSSES' : 'ПОРАЖЕНИЯ'}</span></span></div>
        </div>
      </section>

      <section className="arena-approved-modes" aria-label={en ? 'Battle modes' : 'Режимы боя'}>
        {MODES.map((m) => {
          const Icon = m.icon;
          const busy = joining === m.id;
          return (
            <button
              key={m.id} type="button"
              className={`arena-approved-mode arena-approved-mode-${m.tone}`}
              disabled={!!joining}
              onClick={() => void join(m.id)}
              aria-label={en ? `Start ${m.english}, ${m.sizeEn}` : `Начать бой: ${m.title}, ${m.size}`}
            >
              <img
                className="arena-approved-mode-image"
                src={m.picture}
                alt={en ? `${m.english} — ${m.descEn}` : `${m.title} — ${m.desc}. Начать бой`}
              />
              {en && <div className="arena-approved-en-overlay" aria-hidden="true">
                <span className="arena-approved-en-card-title">{m.english}<small>{m.sizeEn}</small></span>
                <span className="arena-approved-en-card-desc"><Icon />{m.descEn}</span>
                <span className="arena-approved-en-card-cta">{busy ? 'MATCHING…' : 'START BATTLE'}</span>
              </div>}
              {busy && <span className="arena-approved-mode-loading"><Loader2 className="h-6 w-6 animate-spin" />{en ? 'Matching...' : 'Ищем бой...'}</span>}
            </button>
          );
        })}
      </section>

      {error && <p role="alert" className="arena-lobby-warning">{error}</p>}
      <ArenaWeeklyBoard />
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage();
  const rules = [
    'Каждый раунд выбери цель, 2 из 4 зон защиты слева и 1 зону удара справа, затем жми «УДАР».',
    'Удар в заблокированную зону не проходит. Критический удар пробивает блок, но слабее.',
    'Удар в голову сильнее (×1.25), по ногам слабее (×0.85).',
    'На ход даётся тайм — 60 сек. Не успел сходить — выбываешь из боя по тайму.',
    'Зелье времени сокращает тайм на 10 сек., но не меньше 30 сек.',
    'В бою работает только то, что лежит на поясе: до 5 шт. в слоте, одно зелье за раунд, каждый эликсир — один раз за бой.',
    'Иногда боец успевает увернуться от удара — даже если зона не закрыта.',
    'Павший остаётся в комнате до конца боя. Союзник может вернуть его адреналином.',
    'Автобой: сервер бьёт за тебя, даже если ты свернул игру.',
    'После боя у игроков есть 30 минут на общение в чате. Затем арена закроется автоматически.',
  ];
  return (
    <IosGamePortal>
    <div className="arena-modal-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-md animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-white flex items-center gap-2"><Trophy className="w-5 h-5 text-amber-400" /> {language === 'en' ? 'How combat works' : 'Как проходит бой'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <ol className="space-y-2">
          {rules.map((r, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-300 leading-relaxed">
              <span className="w-5 h-5 rounded-full bg-teal-500/20 text-teal-300 text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              {language === 'en' ? ([
                'Each round, choose a target, 2 of 4 defense zones on the left, and 1 attack zone on the right, then press STRIKE.',
                'A strike against a blocked zone does not land. Critical strikes pierce blocks but deal less damage.',
                'Head strikes deal more damage (×1.25); leg strikes deal less (×0.85).',
                'You have 60 seconds per turn. If you do not act in time, you are eliminated.',
                'The Time Potion reduces the timer by 10 seconds, down to a minimum of 30 seconds.',
                'Only items on your belt can be used in battle: up to 5 per slot, one potion per round, each elixir once per battle.',
                'Sometimes a fighter dodges an attack even when the zone is unguarded.',
                'A fallen fighter stays in the room until battle ends. An ally can revive them with Adrenaline.',
                'Auto-battle: the server fights for you even while the game is minimized.',
                'After the battle, you have 30 minutes to chat. The arena then closes automatically.'
              ] as string[])[i] : r}
            </li>
          ))}
        </ol>
      </div>
    </div>
    </IosGamePortal>
  );
}
