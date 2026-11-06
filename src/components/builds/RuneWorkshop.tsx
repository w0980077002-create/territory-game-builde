import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Sparkles, X } from 'lucide-react';
import catalog from '@/game/config/territory-independent-rune-slots-v1.json';
import './runeWorkshop.css';

const groups = [
  { ru: 'Защита', en: 'Defense' },
  { ru: 'Сила', en: 'Power' },
  { ru: 'Контроль', en: 'Control' },
  { ru: 'Магия', en: 'Magic' },
  { ru: 'Мастерство', en: 'Mastery' },
] as const;
const signs = ['ᛉ', 'ᚠ', 'ᚦ', 'ᚱ', 'ᛏ', 'ᚺ', 'ᛇ', 'ᛒ', 'ᚷ', 'ᛗ', 'ᚹ', 'ᛟ', 'ᛞ', 'ᛋ', 'ᛝ'] as const;
type Selection = Record<string, string>;

/** Offline visual prototype: does not touch server-owned runes, combat or save data. */
export function RuneWorkshop({ language }: { language: 'ru' | 'en' }) {
  const en = language === 'en';
  const [selection, setSelection] = useState<Selection>({});
  const [active, setActive] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const current = active === null ? null : catalog.slots[active];
  const equipped = Object.keys(selection).length;

  useEffect(() => {
    if (active === null) return;
    closeRef.current?.focus({ preventScroll: true });
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActive(null);
    };
    document.addEventListener('keydown', keyDown);
    return () => document.removeEventListener('keydown', keyDown);
  }, [active]);

  const pick = (id: string, runeId: string | null) => {
    setSelection(previous => {
      const next = { ...previous };
      if (runeId) next[id] = runeId;
      else delete next[id];
      return next;
    });
    setActive(null);
  };

  return <section className="rune-workshop" data-testid="rune-offline-workshop">
    <header className="rune-workshop__header">
      <Sparkles size={29} aria-hidden="true"/>
      <div>
        <h2>{en ? 'Runes of TERRITORY' : 'Руны TERRITORY'}</h2>
        <p>{en ? '15 slots · 3 choices each' : '15 слотов · по 3 варианта'}</p>
      </div>
      <b>{equipped}/15</b>
    </header>
    <p className="rune-workshop__notice" role="status">
      {en
        ? 'Visual playtest. Pick rune variants and compare combinations. No combat bonuses, items, purchases or server saves are changed.'
        : 'Игровая примерка. Выбирай руны и собирай комбинации. Боевые бонусы, предметы, покупки и сохранения игроков не меняются.'}
    </p>
    <div className="rune-workshop__board">
      {groups.map((group, row) => <div className="rune-workshop__row" key={group.en}>
        <div className="rune-workshop__chapter"><strong>{en ? group.en : group.ru}</strong><span>{row + 1}/5</span></div>
        <div className="rune-workshop__slots">
          {catalog.slots.slice(row * 3, row * 3 + 3).map((slot, i) => {
            const index = row * 3 + i;
            const selected = slot.options.find(option => option.runeId === selection[slot.slotId]);
            return <button type="button" key={slot.slotId} onClick={() => setActive(index)}
              data-testid={'rune-preview-slot-' + (index + 1)}
              className={'rune-workshop__slot' + (selected ? ' rune-workshop__slot--selected' : '')}
              aria-label={(en ? 'Rune slot ' : 'Слот руны ') + (index + 1) + (selected ? ': ' + (en ? selected.nameEn : selected.nameRu) : '')}>
              <span className="rune-workshop__glyph" aria-hidden="true">{signs[index]}</span>
              <small>{index + 1}</small>
              <strong>{selected ? (en ? selected.nameEn : selected.nameRu) : (en ? 'Choose rune' : 'Выбрать руну')}</strong>
              {selected ? <Check className="rune-workshop__mark" size={15} aria-hidden="true"/> : <ChevronRight className="rune-workshop__arrow" size={14} aria-hidden="true"/>}
            </button>;
          })}
        </div>
      </div>)}
    </div>
    <footer className="rune-workshop__footer">
      <span>{en ? 'This is a preview, not the player’s combat loadout.' : 'Это примерка, а не действующая боевая сборка.'}</span>
      <button type="button" onClick={() => setSelection({})} disabled={equipped === 0}>
        {en ? 'Reset choices' : 'Сбросить выбор'}
      </button>
    </footer>
    {current && active !== null && <div className="rune-workshop__veil"
      onMouseDown={event => { if (event.target === event.currentTarget) setActive(null); }}>
      <section role="dialog" aria-modal="true" aria-label={(en ? 'Rune slot ' : 'Слот руны ') + (active + 1)}
        className="rune-workshop__dialog">
        <header><strong>{en ? 'Choose rune' : 'Выбери руну'} · {active + 1}</strong>
          <button ref={closeRef} type="button" onClick={() => setActive(null)}
            aria-label={en ? 'Close' : 'Закрыть'}><X size={22}/></button>
        </header>
        <div className="rune-workshop__options">
          {current.options.map((option, i) => <button key={option.runeId} type="button"
            data-testid={'rune-preview-option-' + i} aria-pressed={selection[current.slotId] === option.runeId}
            onClick={() => pick(current.slotId, option.runeId)}>
            <span className="rune-workshop__option-glyph" aria-hidden="true">{signs[(active + i * 5) % signs.length]}</span>
            <span><strong>{en ? option.nameEn : option.nameRu}</strong>
              <small>{en ? option.effectEn : option.effectRu}</small></span>
            {selection[current.slotId] === option.runeId && <Check size={19} aria-hidden="true"/>}
          </button>)}
        </div>
        <button type="button" className="rune-workshop__remove"
          onClick={() => pick(current.slotId, null)}>{en ? 'Clear slot' : 'Очистить слот'}</button>
      </section>
    </div>}
  </section>;
}
