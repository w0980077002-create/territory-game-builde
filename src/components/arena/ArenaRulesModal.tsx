import { useEffect, useRef } from 'react';
import { IosGamePortal } from '@/components/ui/Modal';
import { useLanguage } from '@/game/i18n';
import { Swords, X } from 'lucide-react';
import './arenaLobby.css';

export function RulesModal({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab') {
        const list = document.querySelector<HTMLElement>('.arena-rules-list');
        if (event.shiftKey && document.activeElement === closeRef.current) { event.preventDefault(); list?.focus(); }
        else if (!event.shiftKey && document.activeElement === list) { event.preventDefault(); closeRef.current?.focus(); }
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => { window.removeEventListener('keydown', closeOnEscape); previousFocus?.focus(); };
  }, []);
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
    <div className="arena-rules-overlay" role="dialog" aria-modal="true" aria-labelledby="arena-rules-title">
      <button type="button" className="arena-rules-backdrop" aria-label={language === 'en' ? 'Close rules' : 'Закрыть правила'} onClick={onClose} />
      <div className="arena-rules-panel">
        <div className="arena-rules-head">
          <Swords aria-hidden="true" />
          <h3 id="arena-rules-title">{language === 'en' ? 'ARENA RULES' : 'ПРАВИЛА АРЕНЫ'}</h3>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={language === 'en' ? 'Close' : 'Закрыть'}><X aria-hidden="true" /></button>
        </div>
        <ol className="arena-rules-list" tabIndex={0}>
          {rules.map((r, i) => (
            <li key={i}>
              <span className="arena-rules-number">{i + 1}</span>
              <span>{language === 'en' ? ([
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
              ] as string[])[i] : r}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
    </IosGamePortal>
  );
}
