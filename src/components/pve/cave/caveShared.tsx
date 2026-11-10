import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gemArt, gemType, parseGemKey, type GemKey } from '@/game/cave/gems';
import { UMBRA_STATS, umbraRank, umbraSet, umbraTemplate, type StatLine, type UmbraItem, type UmbraStat } from '@/game/cave/umbra';
import './caveUi.css';

export const caveAsset = (path: string) => import.meta.env.BASE_URL + path;
export const ESSENCE_ART = 'assets/territory/cave-loot/2026-11-06/14-essence-flask.webp';
export const WOOD_ART = 'assets/territory/ui/shop/shop-wood-planks.webp';
export const woodStyle = () => ({ backgroundImage: `linear-gradient(180deg, rgba(22,11,14,.70), rgba(26,12,20,.84)), url("${caveAsset(WOOD_ART)}")` });

export const statLabel = (stat: UmbraStat, en: boolean) => en ? UMBRA_STATS[stat].en : UMBRA_STATS[stat].ru;
export const statValue = (stat: UmbraStat, value: number) => UMBRA_STATS[stat].pct ? `${value.toFixed(1)}%` : String(Math.round(value));
export const signed = (n: number, pct = false) => (n > 0 ? '+' : n < 0 ? '−' : '') + (pct ? Math.abs(n).toFixed(1) + '%' : Math.abs(Math.round(n)));
export const itemName = (item: UmbraItem, en: boolean) => {
  const t = umbraTemplate(item.templateId);
  return t ? (en ? t.en : t.ru) : item.templateId;
};

/** Messages for typed refusals of the sandbox reducer. */
export function reasonText(reason: string | undefined, en: boolean): string {
  const map: Record<string, [string, string]> = {
    not_enough_essence: ['Не хватает тёмной эссенции', 'Not enough dark essence'],
    max_enhance: ['Достигнут предел усиления', 'Enhancement limit reached'],
    item_equipped: ['Сначала сними вещь — надетое не разбирается', 'Unequip first — worn gear cannot be dismantled'],
    item_locked: ['Вещь под замком. Сними замок, чтобы изменить её', 'Item is locked. Unlock it first'],
    nothing_equipped: ['Нет надетых тёмных вещей', 'No dark gear is equipped'],
    nothing_selected: ['Ничего не выбрано', 'Nothing selected'],
    not_enough: ['Нужно 3 одинаковых камня одного уровня', 'Needs 3 identical gems of one level'],
    not_owned: ['Этого предмета нет в запасе', 'You do not own this'],
    not_reached: ['Глубина ещё не достигнута', 'Depth not reached yet'],
    already_claimed: ['Уже получено', 'Already claimed'],
  };
  const text = reason ? map[reason] : undefined;
  return text ? text[en ? 1 : 0] : (en ? 'Action is not available' : 'Действие недоступно');
}

export function useToast() {
  const [toast, setToast] = useState<{ text: string; bad: boolean; key: number } | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = (text: string, bad = false) => {
    window.clearTimeout(timer.current);
    setToast({ text, bad, key: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), 2600);
  };
  const node = toast && <p key={toast.key} role="status" className={'cv-toast' + (toast.bad ? ' cv-toast--bad' : '')}>{toast.text}</p>;
  return [node, show] as const;
}

export function Dialog({ label, onClose, children, testId }: { label: string; onClose: () => void; children: ReactNode; testId?: string }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="cv-root cv-overlay" role="dialog" aria-modal="true" aria-label={label} data-testid={testId} onClick={onClose}>
    <div className="cv-dialog" onClick={event => event.stopPropagation()}>
      <button type="button" ref={closeRef} className="cv-close" onClick={onClose} aria-label="×">×</button>
      {children}
    </div>
  </div>;
}

export function ItemCell({ item, en, onClick, picked, better, testId }: {
  item: UmbraItem; en: boolean; onClick?: () => void; picked?: boolean; better?: boolean; testId?: string;
}) {
  const template = umbraTemplate(item.templateId);
  const rank = umbraRank(item.rank);
  const content = <>
    {template && <img src={caveAsset(template.art)} alt="" loading="lazy" draggable={false} />}
    <span className="cv-cell-lv">{en ? 'Lv.' : 'Ур.'}{item.level}</span>
    {item.enhance > 0 && <span className="cv-cell-plus">+{item.enhance}</span>}
    {item.setId && <span className="cv-cell-set" aria-hidden="true">◆</span>}
    {item.locked && <span className="cv-cell-lock" aria-hidden="true">🔒</span>}
    {better && <span className="cv-cell-up" aria-hidden="true">▲</span>}
  </>;
  const className = 'cv-cell' + (picked ? ' cv-cell--picked' : '');
  const style = { '--rank': rank.color } as React.CSSProperties;
  const label = `${itemName(item, en)} · ${en ? rank.en : rank.ru} · ${en ? 'Lv.' : 'Ур.'}${item.level}`;
  return onClick
    ? <button type="button" className={className} style={style} onClick={onClick} aria-label={label} aria-pressed={picked} data-testid={testId}>{content}</button>
    : <span className={className} style={style} role="img" aria-label={label}>{content}</span>;
}

export function GemCell({ gem, count, en, onClick, testId }: { gem: GemKey; count?: number; en: boolean; onClick?: () => void; testId?: string }) {
  const parsed = parseGemKey(gem);
  if (!parsed) return null;
  const type = gemType(parsed.type);
  const label = `${en ? type.en : type.ru} · ${en ? 'Lv.' : 'Ур.'}${parsed.level}${count !== undefined ? ' ×' + count : ''}`;
  const content = <>
    <img src={caveAsset(gemArt(parsed.type))} alt="" loading="lazy" draggable={false} />
    <span className="cv-cell-lv">{en ? 'Lv.' : 'Ур.'}{parsed.level}</span>
    {count !== undefined && <span className="cv-cell-count">×{count}</span>}
  </>;
  const style = { '--rank': type.color } as React.CSSProperties;
  return onClick
    ? <button type="button" className="cv-cell" style={style} onClick={onClick} aria-label={label} data-testid={testId}>{content}</button>
    : <span className="cv-cell" style={style} role="img" aria-label={label}>{content}</span>;
}

export function StatLines({ lines, en, mainFirst = true }: { lines: readonly StatLine[]; en: boolean; mainFirst?: boolean }) {
  return <div className="cv-lines">{lines.map((line, i) => <div key={line.stat + i} className={'cv-line' + (mainFirst && i === 0 ? ' cv-line--main' : '')}>
    <span>{statLabel(line.stat, en)}</span><b>+{statValue(line.stat, line.value)}</b>
  </div>)}</div>;
}

export function SetBadge({ item, have, en }: { item: UmbraItem; have: number; en: boolean }) {
  const set = umbraSet(item.setId);
  if (!set) return null;
  return <div className="cv-set">
    <b>{en ? set.en : set.ru} ({have}/{set.slots.length})</b>
    {set.bonuses.map(bonus => <span key={bonus.need} className={'cv-set-bonus' + (have >= bonus.need ? ' cv-set-bonus--on' : '')}>
      {bonus.need}: {bonus.stats.map(s => `${statLabel(s.stat, en)} +${statValue(s.stat, s.value)}`).join(', ')}
    </span>)}
  </div>;
}

export const DemoNote = ({ en, children }: { en: boolean; children?: ReactNode }) => <p className="cv-note cv-note--demo" role="note">
  <b>{en ? 'Test mode.' : 'Тестовый режим.'}</b> {children ?? (en
    ? 'Stored on this device only. Not a real reward; nothing is charged or granted on the server.'
    : 'Хранится только на этом устройстве. Это не настоящая награда: сервер ничего не списывает и не начисляет.')}
</p>;
