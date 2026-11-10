import { useState } from 'react';
import { useCaveSandbox } from '@/game/cave/sandboxStore';
import {
  gemKey, gemTotals, gemType, gemValue, parseGemKey, quickSynthesizeGems, GEM_FRAMES, GEM_TYPES, SYNTH_INPUT,
  type GemFrameId, type GemKey, type GemStat,
} from '@/game/cave/gems';
import { DemoNote, Dialog, GemCell, reasonText, useToast, woodStyle } from './caveShared';

const STAT_NAMES: Record<GemStat, [string, string]> = {
  attack: ['Атака', 'Attack'], defense: ['Защита', 'Defense'], hp: ['Здоровье', 'Health'],
  crit: ['Шанс крита', 'Crit chance'], block: ['Блок', 'Block'], dodge: ['Уклонение', 'Dodge'],
};
const PCT: ReadonlySet<GemStat> = new Set(['crit', 'block', 'dodge']);
const bonus = (stat: GemStat, value: number, en: boolean) => `${STAT_NAMES[stat][en ? 1 : 0]} +${value}${PCT.has(stat) ? '%' : ''}`;
const gemBonus = (key: GemKey, en: boolean) => { const g = parseGemKey(key)!; return bonus(gemType(g.type).stat, gemValue(g.type, g.level), en); };

type View = { kind: 'socket'; frame: GemFrameId; index: number } | { kind: 'totals' } | { kind: 'synth'; gem: GemKey | null } | null;

/**
 * Gems: a stand-alone system (not runes, not Umbra item instances).
 * Cave drops are Lv.1–3 only; higher levels come from 3 identical -> 1.
 */
export function CaveGemsScreen({ en, onBack }: { en: boolean; onBack: () => void }) {
  const [box, dispatch] = useCaveSandbox();
  const [view, setView] = useState<View>(null);
  const [toast, say] = useToast();
  const stacks = (Object.entries(box.gems) as [GemKey, number][])
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => { const x = parseGemKey(a)!, y = parseGemKey(b)!; return GEM_TYPES.findIndex(t => t.id === x.type) - GEM_TYPES.findIndex(t => t.id === y.type) || y.level - x.level; });
  const totals = Object.entries(gemTotals(box.sockets)) as [GemStat, number][];
  const quickPlan = quickSynthesizeGems(box.gems).made;
  const canQuick = quickPlan.length > 0;
  const socketed = GEM_FRAMES.reduce((n, f) => n + box.sockets[f.id].filter(Boolean).length, 0);
  const done = (result: ReturnType<typeof dispatch>, text: string) => { if (result.ok) say(text); else say(reasonText(result.reason, en), true); return result.ok; };
  const synthGem = view?.kind === 'synth' && view.gem ? parseGemKey(view.gem) : null;
  const synthCount = synthGem ? box.gems[gemKey(synthGem.type, synthGem.level)] ?? 0 : 0;

  return <div className="cv-root cv-panel cv-screen" data-testid="cave-gems-screen" style={woodStyle()}>
    <header className="cv-screen-head">
      <button type="button" className="cv-back" onClick={onBack} aria-label={en ? 'Back to cave' : 'Назад в пещеру'}>‹</button>
      <h3>{en ? 'Gems' : 'Драгоценные камни'}
        <small>{en ? 'Sockets · synthesis 3 → 1 · not runes' : 'Гнёзда · синтез 3 → 1 · это не руны'}</small></h3>
      <span className="cv-chip cv-chip--demo">{en ? 'TEST' : 'ТЕСТ'}</span>
    </header>

    <div className="cv-row">
      <button type="button" className="cv-btn" data-testid="gems-totals" onClick={() => setView({ kind: 'totals' })}>{en ? 'Total attributes' : 'Общие атрибуты'} ({socketed})</button>
      <button type="button" className="cv-btn cv-btn--gold" data-testid="gems-synth-open" onClick={() => setView({ kind: 'synth', gem: null })}>
        {en ? 'Synthesize' : 'Синтезировать'}{canQuick ? ' •' : ''}</button>
    </div>

    <div data-testid="gems-frames">{GEM_FRAMES.map(frame => <div key={frame.id} className="cv-frame">
      <div className="cv-frame-name">{en ? frame.en : frame.ru}
        <small>{box.sockets[frame.id].filter(Boolean).map(k => gemBonus(k!, en)).join(' · ') || (en ? 'No gems set' : 'Камни не вставлены')}</small></div>
      {box.sockets[frame.id].map((gem, index) => <span key={index} className="cv-socket">{gem
        ? <GemCell gem={gem} en={en} testId="gem-socket" onClick={() => setView({ kind: 'socket', frame: frame.id, index })} />
        : <button type="button" className="cv-cell cv-cell--empty" data-testid="gem-socket" onClick={() => setView({ kind: 'socket', frame: frame.id, index })}
            aria-label={(en ? frame.en : frame.ru) + ' · ' + (en ? 'empty socket ' : 'пустое гнездо ') + (index + 1)}>＋</button>}</span>)}
    </div>)}</div>

    <div className="cv-store-head"><h4>{en ? 'Gem pouch' : 'Мешочек камней'}</h4><strong data-testid="gems-count">{stacks.reduce((n, [, c]) => n + c, 0)}</strong></div>
    {stacks.length ? <div className="cv-gemlist" data-testid="gems-pouch">{stacks.map(([key, count]) => <GemCell key={key} gem={key} count={count} en={en} testId="gem-stack"
      onClick={() => setView({ kind: 'synth', gem: key })} />)}</div>
      : <p className="cv-empty">{en ? 'No gems yet. Gems Lv.1–3 are found in the cave from floor 6.' : 'Камней пока нет. Самоцветы 1–3 уровня добываются в Пещере с 6 этажа.'}</p>}
    <p className="cv-note">{en
      ? 'Which equipment finally owns the sockets is awaiting the owner\'s decision; these frames change neither your main gear nor dark items.'
      : 'Привязка гнёзд к конкретной экипировке ждёт решения владельца: эти оправы не меняют ни основную, ни тёмную экипировку.'}</p>
    <div style={{ marginTop: 6 }}><DemoNote en={en} /></div>
    {toast}

    {view?.kind === 'socket' && (() => {
      const frame = GEM_FRAMES.find(f => f.id === view.frame)!;
      const current = box.sockets[view.frame][view.index];
      return <Dialog label={en ? frame.en : frame.ru} onClose={() => setView(null)} testId="gem-socket-dialog">
        <p className="cv-kicker">{en ? 'Socket' : 'Гнездо'} {view.index + 1} / 3</p>
        <h3>{en ? frame.en : frame.ru}</h3>
        {current && <><div className="cv-recipe"><span style={{ width: 56 }}><GemCell gem={current} en={en} /></span><span className="cv-note">{gemBonus(current, en)}</span></div>
          <button type="button" className="cv-btn cv-btn--wide" data-testid="gem-remove"
            onClick={() => { if (done(dispatch({ type: 'unsocket', frame: view.frame, index: view.index }), en ? 'Gem removed to the pouch' : 'Камень снят в мешочек')) setView(null); }}>{en ? 'Remove' : 'Снять'}</button></>}
        <p className="cv-note" style={{ marginTop: 6 }}>{current ? (en ? 'Or replace with:' : 'Или заменить на:') : (en ? 'Choose a gem to insert:' : 'Выбери камень, чтобы вставить:')}</p>
        {stacks.length ? <div className="cv-gemlist">{stacks.map(([key, count]) => <span key={key} style={{ display: 'grid', gap: 2 }}>
          <GemCell gem={key} count={count} en={en} testId="gem-insert"
            onClick={() => { if (done(dispatch({ type: 'socket', frame: view.frame, index: view.index, key }), (en ? 'Inserted: ' : 'Вставлено: ') + gemBonus(key, en))) setView(null); }} />
          <span className="cv-note" style={{ textAlign: 'center', fontSize: 9 }}>{gemBonus(key, en)}</span></span>)}</div>
          : <p className="cv-empty">{en ? 'The pouch is empty.' : 'В мешочке нет камней.'}</p>}
      </Dialog>;
    })()}

    {view?.kind === 'totals' && <Dialog label={en ? 'Total gem attributes' : 'Общие атрибуты камней'} onClose={() => setView(null)} testId="gems-totals-dialog">
      <h3>{en ? 'Total gem attributes' : 'Общие атрибуты камней'}</h3>
      {totals.length ? <div className="cv-lines">{totals.map(([stat, value]) => <div key={stat} className="cv-line">
        <span>{STAT_NAMES[stat][en ? 1 : 0]}</span><b>+{value}{PCT.has(stat) ? '%' : ''}</b></div>)}</div>
        : <p className="cv-empty">{en ? 'No gems are set yet.' : 'Камни ещё не вставлены.'}</p>}
      <p className="cv-note">{en ? 'Sum over all socketed gems. In the test build it does not change real fights.' : 'Сумма по всем вставленным камням. В тестовой версии на настоящие бои не влияет.'}</p>
    </Dialog>}

    {view?.kind === 'synth' && <Dialog label={en ? 'Gem synthesis' : 'Синтез камней'} onClose={() => setView(null)} testId="gems-synth-dialog">
      <h3>{en ? 'Gem synthesis' : 'Синтез драгоценных камней'}</h3>
      <p className="cv-note">{en ? '3 gems of the same type and level → 1 gem of the next level. No failures, no extra cost.' : '3 камня одного вида и уровня → 1 камень следующего уровня. Без провалов и доплат.'}</p>
      {synthGem ? <>
        <div className="cv-recipe">
          {[0, 1, 2].map(i => <span key={i} style={{ opacity: synthCount > i ? 1 : .3 }}><GemCell gem={view.gem!} en={en} /></span>)}
          <b>→</b><GemCell gem={gemKey(synthGem.type, synthGem.level + 1)} en={en} />
        </div>
        <p className="cv-note" style={{ textAlign: 'center' }}>{gemBonus(view.gem!, en)} ×3 → <b className="cv-up">{gemBonus(gemKey(synthGem.type, synthGem.level + 1), en)}</b> · {en ? 'owned' : 'есть'} {synthCount}/{SYNTH_INPUT}</p>
        <button type="button" className="cv-btn cv-btn--gold cv-btn--wide" data-testid="gem-synth" disabled={synthCount < SYNTH_INPUT}
          onClick={() => done(dispatch({ type: 'synth', gem: synthGem.type, level: synthGem.level }), (en ? 'Created: Lv.' : 'Создан камень ур.') + (synthGem.level + 1))}>
          {en ? 'Synthesize' : 'Синтезировать'}</button>
      </> : <p className="cv-note">{en ? 'Tap a stack below to combine it manually.' : 'Нажми на камень ниже, чтобы объединить вручную.'}</p>}
      {stacks.length > 0 && <div className="cv-gemlist">{stacks.map(([key, count]) => <GemCell key={key} gem={key} count={count} en={en} onClick={() => setView({ kind: 'synth', gem: key })} />)}</div>}
      <button type="button" className="cv-btn cv-btn--wide" data-testid="gem-quick-synth" disabled={!canQuick}
        onClick={() => { const r = dispatch({ type: 'quickSynth' }); done(r, (en ? 'Quick synthesis: new gems ' : 'Быстрый синтез: новых камней ') + (r.count ?? 0)); setView({ kind: 'synth', gem: null }); }}>
        {en ? 'Quick synthesis' : 'Быстрый синтез'}{canQuick ? ` (${quickPlan.reduce((n, m) => n + m.count, 0)})` : ''}</button>
      {toast}
    </Dialog>}
  </div>;
}
