import { useState } from 'react';
import { useStore } from '@/game/store';
import { useGame, useArena } from '@/game/actions';
import type { ArenaMode } from '@/game/arenaApi';
import { secureArenaJoin } from '@/game/arenaSecure';
import { hapticImpact } from '@/game/telegram';
import { IosGamePortal } from '@/components/ui/Modal';
import { useLanguage, localizeText } from '@/game/i18n';
import { Crown, Flame, Info, Loader2, Shield, Swords, Trophy, Users, X } from 'lucide-react';
import { ArenaWeeklyBoard } from './ArenaWeeklyBoard';
import './arenaLobby.css';

const ENERGY_COST = 1;
const ART = import.meta.env.BASE_URL + 'assets/territory/characters/';
const MODES: { id: ArenaMode; title: string; english: string; size: string; desc: string; descEn: string; bonus: string; icon: typeof Swords; art: string; accent: string }[] = [
  { id: 'duel', title: 'Дуэль', english: 'Duel', size: '1 на 1', desc: 'Один на один', descEn: 'One on one', bonus: '×1', icon: Swords, art: ART + 'heroes/male_viking/idle.webp', accent: 'gold' },
  { id: 'team', title: 'Отряд', english: 'Squad', size: '3 на 3', desc: 'Бой команд', descEn: 'Team combat', bonus: '×1.2', icon: Users, art: ART + 'heroes/female_warrior/idle.webp', accent: 'blue' },
  { id: 'chaos', title: 'Хаос', english: 'Chaos', size: 'до 20 на 20', desc: 'Большая битва', descEn: 'Mass battle', bonus: '×1.5', icon: Flame, art: ART + 'enemies/goblin/idle.webp', accent: 'red' },
];

export function ArenaLobby({ onJoined }: { onJoined: (roomId: string) => void }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const state = useStore(useGame);
  const arena = useStore(useArena);
  const [mode, setMode] = useState<ArenaMode>('duel');
  const [joining, setJoining] = useState<ArenaMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const noEnergy = state.player.energy < ENERGY_COST;

  const join = async () => {
    if (noEnergy || joining) return;
    hapticImpact('medium');
    setJoining(mode);
    setError(null);
    try {
      // Preserve the atomic server-side join and one-energy debit.
      const roomId = await secureArenaJoin(mode);
      onJoined(roomId);
    } catch (e) {
      setError(localizeText((e as Error).message, language));
      setJoining(null);
    }
  };

  return (
    <div className="arena-lobby animate-fade-in">
      <section className="arena-lobby-stage">
        <div className="arena-lobby-stage-art" aria-hidden="true" style={{ backgroundImage: `linear-gradient(180deg,rgba(0,12,27,.15) 12%,rgba(10,12,21,.04) 49%,rgba(3,10,17,.98) 100%),url("${import.meta.env.BASE_URL}assets/territory/scenes/arena-viking.webp")` }} />
        <div className="arena-lobby-heading">
          <span className="arena-lobby-title"><Swords aria-hidden="true" />{en ? 'ARENA' : 'АРЕНА'}</span>
          <button type="button" className="arena-lobby-rules" onClick={() => setShowRules(true)}>
            <Info className="h-4 w-4" />{en ? 'Rules' : 'Правила'}
          </button>
        </div>
        <div className="arena-lobby-characters" aria-hidden="true">
          <img className="arena-lobby-character arena-lobby-character-hero" src={ART + 'heroes/male_viking/idle.webp'} alt="" />
          <img className="arena-lobby-character arena-lobby-character-enemy" src={ART + 'bosses/bandit_chief/idle.webp'} alt="" />
        </div>
        <div className="arena-lobby-stats" aria-label={en ? 'Arena record' : 'Статистика арены'}>
          <div className="arena-lobby-stat arena-lobby-stat-rating">
            <Trophy className="arena-lobby-stat-icon" aria-hidden="true" />
            <strong>{arena.rating.toLocaleString()}</strong><span>{en ? 'RATING' : 'РЕЙТИНГ'}</span>
          </div>
          <div className="arena-lobby-stat arena-lobby-stat-wins">
            <Crown className="arena-lobby-stat-icon" aria-hidden="true" />
            <strong>{arena.wins.toLocaleString()}</strong><span>{en ? 'WINS' : 'ПОБЕДЫ'}</span>
          </div>
          <div className="arena-lobby-stat arena-lobby-stat-losses">
            <Shield className="arena-lobby-stat-icon" aria-hidden="true" />
            <strong>{arena.losses.toLocaleString()}</strong><span>{en ? 'LOSSES' : 'ПОРАЖЕНИЯ'}</span>
          </div>
        </div>
      </section>

      <ArenaWeeklyBoard />

      <div className="arena-lobby-modes" role="group" aria-label={en ? 'Choose battle mode' : 'Выбери режим боя'}>
        {MODES.map((option) => {
          const Icon = option.icon;
          const active = option.id === mode;
          return (
            <button
              key={option.id}
              type="button"
              className={`arena-mode-card arena-mode-${option.accent} ${active ? 'arena-mode-active' : ''}`}
              aria-pressed={active}
              onClick={() => { hapticImpact('light'); setMode(option.id); setError(null); }}
              disabled={!!joining}
            >
              <span className="arena-mode-art" aria-hidden="true"><img src={option.art} alt="" loading="lazy" /></span>
              <span className="arena-mode-name"><Icon aria-hidden="true" />{en ? option.english : option.title}</span>
              <span className="arena-mode-size">{en && option.id === 'duel' ? '1 vs 1' : en && option.id === 'team' ? '3 vs 3' : en && option.id === 'chaos' ? 'up to 20 vs 20' : option.size}</span>
              <span className="arena-mode-description">{en ? option.descEn : option.desc}</span>
              <span className="arena-mode-reward">{en ? 'Reward' : 'Награда'} {option.bonus}</span>
            </button>
          );
        })}
      </div>

      <button type="button" className="arena-lobby-fight" onClick={() => void join()} disabled={noEnergy || !!joining}>
        {joining ? <Loader2 className="h-7 w-7 animate-spin" /> : <Swords className="h-7 w-7" />}
        {joining ? (en ? 'FINDING A FIGHT...' : 'ИЩЕМ СОПЕРНИКА...') : (en ? 'TO BATTLE' : 'В БОЙ')}
      </button>
      {noEnergy && <p className="arena-lobby-warning">{en ? 'Not enough energy to enter. One point regenerates every 5 minutes.' : 'Недостаточно энергии для входа. 1 единица восстанавливается каждые 5 минут.'}</p>}
      {error && <p role="alert" className="arena-lobby-warning">{error}</p>}
      <p className="arena-lobby-footer">{en ? 'Choose a mode and enter a real server battle' : 'Выбери режим и вступай в настоящий бой'}</p>
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
