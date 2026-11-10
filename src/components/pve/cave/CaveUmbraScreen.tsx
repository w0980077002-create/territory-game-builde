import { useMemo, useState } from 'react';
import { useCaveSandbox } from '@/game/cave/sandboxStore';
import {
  compareCandidate, dismantleYield, enhanceCost, enhancedMain, equippedItems, itemLines, itemPower, loadoutPower, reforgeCost, setProgress,
  umbraRank, umbraSet, UMBRA_MAX_ENHANCE, UMBRA_RANKS, UMBRA_SETS, UMBRA_SLOTS, UMBRA_STORAGE_CAP, UMBRA_TEMPLATES,
  type UmbraItem, type UmbraSlotId,
} from '@/game/cave/umbra';
import {
  caveAsset, DemoNote, Dialog, ESSENCE_ART, ItemCell, itemName, reasonText, SetBadge, signed, StatLines, statLabel, statValue, useToast, woodStyle,
} from './caveShared';

type View = { kind: 'item'; id: string } | { kind: 'slot'; slot: UmbraSlotId } | { kind: 'guide' } | { kind: 'bulk' } | null;
type Sort = 'power' | 'level' | 'rank';

/**
 * Additional Dark Energy gear: 12 slots around the hero + its own warehouse.
 * Works on the device-local test sandbox only; the hero's ordinary equipment
 * is neither read nor changed here.
 */
export function CaveUmbraScreen({ en, hero, onBack }: { en: boolean; hero: string; onBack: () => void }) {
  const [box, dispatch] = useCaveSandbox();
  const [view, setView] = useState<View>(null);
  const [slotFilter, setSlotFilter] = useState<'all' | UmbraSlotId>('all');
  const [rankFilter, setRankFilter] = useState(0);
  const [setsOnly, setSetsOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('power');
  const [picked, setPicked] = useState<string[]>([]);
  const [toast, say] = useToast();

  const worn = useMemo(() => equippedItems(box.items, box.loadout), [box.items, box.loadout]);
  const wornIds = new Set(worn.map(i => i.id));
  const sets = setProgress(worn);
  const stored = box.items.filter(item => !wornIds.has(item.id));
  const shown = stored
    .filter(item => (slotFilter === 'all' || item.slot === slotFilter) && (!rankFilter || item.rank === rankFilter) && (!setsOnly || !!item.setId))
    .sort((a, b) => sort === 'power' ? itemPower(b) - itemPower(a) : sort === 'level' ? b.level - a.level : b.rank - a.rank || itemPower(b) - itemPower(a));
  const isBetter = (item: UmbraItem) => compareCandidate(box.items, box.loadout, item).powerDelta > 0;
  const run = (result: ReturnType<typeof dispatch>, done: string) => {
    if (result.ok) say(done); else say(reasonText(result.reason, en), true);
    return result.ok;
  };
  const bulkMode = view?.kind === 'bulk';
  const pickedItems = picked.map(id => box.items.find(i => i.id === id)).filter((i): i is UmbraItem => !!i);
  const bulkYield = pickedItems.reduce((sum, i) => sum + dismantleYield(i), 0);

  const renderSlot = (slot: (typeof UMBRA_SLOTS)[number]) => {
    const item = worn.find(i => i.slot === slot.id);
    const candidate = !item && stored.some(i => i.slot === slot.id);
    return item
      ? <ItemCell key={slot.id} item={item} en={en} testId="umbra-slot" onClick={() => setView({ kind: 'item', id: item.id })} />
      : <button key={slot.id} type="button" className="cv-cell cv-cell--empty" data-testid="umbra-slot"
          onClick={() => setView({ kind: 'slot', slot: slot.id })} aria-label={(en ? slot.en : slot.ru) + ' · ' + (en ? 'empty slot' : 'пустой слот')}>
          <span aria-hidden="true">{candidate ? '＋' : '◇'}</span>
          <span className="cv-slot-name">{en ? slot.en : slot.ru}</span>
          {candidate && <span className="cv-cell-up" aria-hidden="true">▲</span>}
        </button>;
  };

  const detail = view?.kind === 'item' ? box.items.find(i => i.id === view.id) ?? null : null;
  const detailWorn = !!detail && wornIds.has(detail.id);
  const cmp = detail && !detailWorn ? compareCandidate(box.items, box.loadout, detail) : null;
  const haveOfSet = (item: UmbraItem) => worn.filter(i => i.setId === item.setId).length;

  const card = (item: UmbraItem, tone: 'worn' | 'new') => {
    const rank = umbraRank(item.rank);
    return <div className={'cv-card' + (tone === 'new' ? ' cv-card--new' : '')}>
      <div className="cv-card-top">
        <ItemCell item={item} en={en} />
        <div style={{ minWidth: 0 }}>
          <strong style={{ color: rank.color }}>{itemName(item, en)}</strong>
          <span>{en ? rank.en : rank.ru} · {en ? 'Lv.' : 'Ур.'}{item.level}{item.enhance ? ` · +${item.enhance}` : ''}</span>
          <span>{tone === 'worn' ? (en ? 'Equipped' : 'Надето') : (en ? 'In storage' : 'На складе')} · {en ? 'Power' : 'Сила'} {itemPower(item)}</span>
        </div>
      </div>
      <StatLines lines={itemLines(item)} en={en} />
      {item.setId && <SetBadge item={item} have={haveOfSet(item)} en={en} />}
    </div>;
  };

  return <div className="cv-root cv-panel cv-screen" data-testid="umbra-screen" style={woodStyle()}>
    <header className="cv-screen-head">
      <button type="button" className="cv-back" onClick={onBack} aria-label={en ? 'Back to cave' : 'Назад в пещеру'}>‹</button>
      <h3>{en ? 'Dark Energy gear' : 'Снаряжение Тёмной энергии'}
        <small>{en ? '12 extra slots · separate from main equipment' : '12 дополнительных слотов · отдельно от основной экипировки'}</small></h3>
      <span className="cv-chip cv-chip--demo">{en ? 'TEST' : 'ТЕСТ'}</span>
    </header>

    <div className="cv-doll" aria-label={en ? 'Twelve additional equipment slots' : '12 дополнительных слотов'}>
      <div className="cv-doll-col">{UMBRA_SLOTS.slice(0, 6).map(renderSlot)}</div>
      <div className="cv-doll-hero">
        <span className="cv-power" data-testid="umbra-power">{en ? 'Dark power' : 'Сила тьмы'}: {loadoutPower(worn)}</span>
        <img className="cv-doll-rune" src={caveAsset('assets/territory/cave/scene/rune-circle.svg')} alt="" />
        <img className="cv-doll-figure" src={hero} alt={en ? 'Your hero' : 'Твой герой'} draggable={false} />
      </div>
      <div className="cv-doll-col">{UMBRA_SLOTS.slice(6).map(renderSlot)}</div>
    </div>

    {sets.length > 0 && <div className="cv-sets" data-testid="umbra-sets">{sets.map(p => <div key={p.set.id} className="cv-set">
      <b>{en ? p.set.en : p.set.ru} ({p.have}/{p.size})</b>
      {p.set.bonuses.map(bonus => <span key={bonus.need} className={'cv-set-bonus' + (p.have >= bonus.need ? ' cv-set-bonus--on' : '')}>
        {bonus.need}: {bonus.stats.map(s => `${statLabel(s.stat, en)} +${statValue(s.stat, s.value)}`).join(', ')}
      </span>)}
    </div>)}</div>}

    <div className="cv-store-head">
      <h4>{en ? 'Dark storage' : 'Тёмный склад'}</h4>
      <span className="cv-chip"><img src={caveAsset(ESSENCE_ART)} alt="" style={{ width: 16, height: 16 }} />{en ? 'Essence' : 'Эссенция'}: <b data-testid="umbra-essence">{box.essence}</b></span>
      <strong data-testid="umbra-capacity">{box.items.length}/{UMBRA_STORAGE_CAP}</strong>
    </div>
    <div className="cv-row">
      <button type="button" className="cv-btn" onClick={() => setView({ kind: 'guide' })}>{en ? 'Guide' : 'Справочник'}</button>
      <button type="button" className={'cv-btn' + (bulkMode ? ' cv-btn--danger' : '')} data-testid="umbra-bulk"
        onClick={() => { setPicked([]); setView(bulkMode ? null : { kind: 'bulk' }); }}>{bulkMode ? (en ? 'Cancel' : 'Отмена') : (en ? 'Dismantle' : 'Разобрать')}</button>
      <button type="button" className="cv-btn cv-btn--gold" data-testid="umbra-enhance-all"
        onClick={() => { const r = dispatch({ type: 'enhanceAll' }); run(r, (en ? 'Enhanced: +' : 'Усилено: +') + (r.count ?? 0) + (en ? ' levels, essence ' : ' ур., эссенция ') + (r.gained ?? 0)); }}>
        {en ? 'Enhance all' : 'Усилить в один клик'}</button>
    </div>
    <div className="cv-filter" role="group" aria-label={en ? 'Filter by slot' : 'Фильтр по слоту'}>
      <button type="button" className="cv-tab" aria-pressed={slotFilter === 'all'} onClick={() => setSlotFilter('all')}>{en ? 'All' : 'Все'}</button>
      {UMBRA_SLOTS.map(slot => <button key={slot.id} type="button" className="cv-tab" aria-pressed={slotFilter === slot.id} onClick={() => setSlotFilter(slot.id)}>{en ? slot.en : slot.ru}</button>)}
    </div>
    <div className="cv-filter" role="group" aria-label={en ? 'Rank, sets and sorting' : 'Ранг, комплекты и сортировка'}>
      <button type="button" className="cv-tab" aria-pressed={!rankFilter} onClick={() => setRankFilter(0)}>{en ? 'Any rank' : 'Любой ранг'}</button>
      {UMBRA_RANKS.map(rank => <button key={rank.id} type="button" className="cv-tab" aria-pressed={rankFilter === rank.id} style={{ color: rankFilter === rank.id ? undefined : rank.color }} onClick={() => setRankFilter(rank.id)}>{en ? rank.en : rank.ru}</button>)}
      <button type="button" className="cv-tab" aria-pressed={setsOnly} onClick={() => setSetsOnly(v => !v)}>◆ {en ? 'Sets' : 'Комплекты'}</button>
      <button type="button" className="cv-tab" onClick={() => setSort(s => s === 'power' ? 'level' : s === 'level' ? 'rank' : 'power')} data-testid="umbra-sort">
        ⇅ {sort === 'power' ? (en ? 'Power' : 'Сила') : sort === 'level' ? (en ? 'Level' : 'Уровень') : (en ? 'Rank' : 'Ранг')}</button>
    </div>

    {bulkMode && <div className="cv-note cv-note--demo" data-testid="umbra-bulk-bar" style={{ marginTop: 5 }}>
      {en ? 'Tap items to dismantle. Worn and locked items are protected.' : 'Отметь вещи для разбора. Надетые и запертые защищены.'}
      <div className="cv-row" style={{ marginTop: 5, marginBottom: 0 }}>
        <button type="button" className="cv-btn" onClick={() => setPicked(shown.filter(i => !i.locked && i.rank <= 2).map(i => i.id))}>{en ? 'Pick ranks I–II' : 'Выбрать ранги I–II'}</button>
        <button type="button" className="cv-btn cv-btn--danger" disabled={!picked.length} data-testid="umbra-bulk-confirm"
          onClick={() => { if (run(dispatch({ type: 'dismantle', itemIds: picked }), (en ? `Dismantled ${picked.length} · essence +` : `Разобрано ${picked.length} · эссенция +`) + bulkYield)) { setPicked([]); setView(null); } }}>
          {en ? `Dismantle ${picked.length} → +${bulkYield}` : `Разобрать ${picked.length} → +${bulkYield}`}</button>
      </div>
    </div>}

    {shown.length ? <div className="cv-grid" data-testid="umbra-storage">
      {shown.map(item => <ItemCell key={item.id} item={item} en={en} testId="umbra-item" better={isBetter(item)} picked={bulkMode && picked.includes(item.id)}
        onClick={() => bulkMode
          ? item.locked ? say(reasonText('item_locked', en), true) : setPicked(list => list.includes(item.id) ? list.filter(id => id !== item.id) : [...list, item.id])
          : setView({ kind: 'item', id: item.id })} />)}
    </div> : <p className="cv-empty" data-testid="umbra-empty">{box.items.length
      ? (en ? 'Nothing matches the filters.' : 'По выбранным фильтрам ничего нет.')
      : (en ? 'The storage is empty. Dark gear is found in cave fights.' : 'Склад пуст. Тёмные вещи добываются в боях Пещеры.')}</p>}
    <div style={{ marginTop: 8 }}><DemoNote en={en} /></div>
    <button type="button" className="cv-btn" style={{ marginTop: 6, alignSelf: 'center' }} data-testid="umbra-reset"
      onClick={() => { if (window.confirm(en ? 'Clear the whole test storage on this device?' : 'Очистить весь тестовый склад на этом устройстве?')) run(dispatch({ type: 'reset' }), en ? 'Test storage cleared' : 'Тестовый склад очищен'); }}>
      {en ? 'Clear test storage' : 'Очистить тестовый склад'}</button>
    {toast}

    {detail && <Dialog label={itemName(detail, en)} onClose={() => setView(null)} testId="umbra-item-dialog">
      <p className="cv-kicker">{detailWorn ? (en ? 'Equipped dark item' : 'Надетая тёмная вещь') : (en ? 'Compare: equipped vs new' : 'Сравнение: надето / новое')}</p>
      <h3>{itemName(detail, en)}</h3>
      {cmp ? <>
        {cmp.current
          ? <div className="cv-compare">{card(cmp.current, 'worn')}{card(detail, 'new')}</div>
          : <>{card(detail, 'new')}<p className="cv-note" style={{ marginTop: 4 }}>{en ? 'This slot is empty: nothing to compare with.' : 'Слот пуст: сравнивать пока не с чем.'}</p></>}
        <p className={'cv-delta ' + (cmp.powerDelta >= 0 ? 'cv-up' : 'cv-down')} data-testid="umbra-delta">{en ? 'Power' : 'Сила'} {signed(cmp.powerDelta)}</p>
        <div className="cv-lines">{cmp.lines.map(line => {
          const delta = line.candidate - line.current;
          return <div key={line.stat} className="cv-line"><span>{statLabel(line.stat, en)}</span>
            <b className={delta > 0 ? 'cv-up' : delta < 0 ? 'cv-down' : ''}>{signed(delta, statValue(line.stat, 0).endsWith('%'))}</b></div>;
        })}</div>
      </> : card(detail, 'worn')}
      {detail.enhance < UMBRA_MAX_ENHANCE
        ? <p className="cv-note">{en ? 'Next enhancement' : 'Следующее усиление'}: {statLabel(detail.main.stat, en)} {statValue(detail.main.stat, enhancedMain(detail))} → <b className="cv-up">{statValue(detail.main.stat, enhancedMain({ ...detail, enhance: detail.enhance + 1 }))}</b> · {en ? 'cost' : 'цена'} {enhanceCost(detail)} {en ? 'essence' : 'эссенции'} ({en ? 'have' : 'есть'} {box.essence})</p>
        : <p className="cv-note">{en ? 'Enhancement limit of the test build reached.' : 'Достигнут предел усиления тестовой версии.'}</p>}
      <div className="cv-actions">
        {detailWorn
          ? <button type="button" className="cv-btn" data-testid="umbra-unequip" onClick={() => { if (run(dispatch({ type: 'unequip', slot: detail.slot }), en ? 'Unequipped' : 'Снято')) setView(null); }}>{en ? 'Unequip' : 'Снять'}</button>
          : <button type="button" className="cv-btn cv-btn--gold" data-testid="umbra-equip" onClick={() => { if (run(dispatch({ type: 'equip', itemId: detail.id }), en ? 'Equipped' : 'Надето')) setView(null); }}>{en ? 'Equip' : 'Надеть'}</button>}
        <button type="button" className="cv-btn cv-btn--gold" data-testid="umbra-enhance" disabled={detail.enhance >= UMBRA_MAX_ENHANCE}
          onClick={() => run(dispatch({ type: 'enhance', itemId: detail.id }), (en ? 'Enhanced to +' : 'Усилено до +') + (detail.enhance + 1))}>{en ? 'Enhance' : 'Улучшить'} · {enhanceCost(detail)}</button>
        <button type="button" className="cv-btn" data-testid="umbra-reforge"
          onClick={() => run(dispatch({ type: 'reforge', itemId: detail.id }), en ? 'Extra attributes rerolled' : 'Дополнительные свойства перекованы')}>{en ? 'Reforge' : 'Перековать'} · {reforgeCost(detail)}</button>
        <button type="button" className="cv-btn" data-testid="umbra-lock"
          onClick={() => run(dispatch({ type: 'lock', itemId: detail.id, locked: !detail.locked }), detail.locked ? (en ? 'Unlocked' : 'Замок снят') : (en ? 'Locked' : 'Заперто'))}>{detail.locked ? (en ? '🔓 Unlock' : '🔓 Снять замок') : (en ? '🔒 Lock' : '🔒 Запереть')}</button>
        {!detailWorn && <button type="button" className="cv-btn cv-btn--danger" data-testid="umbra-dismantle" style={{ gridColumn: '1 / -1' }}
          onClick={() => { if (window.confirm((en ? 'Dismantle this item for essence +' : 'Разобрать вещь? Эссенция +') + dismantleYield(detail)) && run(dispatch({ type: 'dismantle', itemIds: [detail.id] }), (en ? 'Dismantled · essence +' : 'Разобрано · эссенция +') + dismantleYield(detail))) setView(null); }}>
          {en ? 'Dismantle' : 'Разобрать'} → +{dismantleYield(detail)} {en ? 'essence' : 'эссенции'}</button>}
      </div>
      <p className="cv-note" style={{ marginTop: 6 }}>{en ? 'Reforge rerolls extra attributes and keeps the main one.' : 'Перековка меняет дополнительные свойства, основное остаётся.'}</p>
      {toast}
    </Dialog>}

    {view?.kind === 'slot' && (() => {
      const slot = UMBRA_SLOTS.find(s => s.id === view.slot)!;
      const options = stored.filter(i => i.slot === slot.id).sort((a, b) => itemPower(b) - itemPower(a));
      return <Dialog label={en ? slot.en : slot.ru} onClose={() => setView(null)} testId="umbra-slot-dialog">
        <p className="cv-kicker">{en ? 'Additional slot' : 'Дополнительный слот'} {UMBRA_SLOTS.indexOf(slot) + 1} / 12</p>
        <h3>{en ? slot.en : slot.ru}</h3>
        {options.length ? <><p className="cv-note">{en ? 'Choose an item from the storage:' : 'Выбери вещь со склада:'}</p>
          <div className="cv-grid">{options.map(item => <ItemCell key={item.id} item={item} en={en} better onClick={() => setView({ kind: 'item', id: item.id })} />)}</div></>
          : <p className="cv-empty">{en ? 'No item for this slot yet. Win cave fights to find one.' : 'Для этого слота пока нет вещи. Побеждай в Пещере, чтобы её найти.'}</p>}
        <p className="cv-note" style={{ marginTop: 6 }}>{en ? 'A dark item never takes an ordinary equipment slot.' : 'Тёмная вещь не занимает обычный слот экипировки героя.'}</p>
      </Dialog>;
    })()}

    {view?.kind === 'guide' && <Dialog label={en ? 'Dark Energy guide' : 'Справочник Тёмной энергии'} onClose={() => setView(null)} testId="umbra-guide">
      <h3>{en ? 'Dark Energy guide' : 'Справочник Тёмной энергии'}</h3>
      <p className="cv-note">{en ? 'Item types by slot. Dimmed ones have not been found yet.' : 'Типы вещей по слотам. Затемнённые ещё не найдены.'}</p>
      <div className="cv-gemlist">{UMBRA_TEMPLATES.map(t => {
        const found = box.items.some(i => i.templateId === t.id);
        const slot = UMBRA_SLOTS.find(s => s.id === t.slot)!;
        return <span key={t.id} className="cv-cell" style={{ opacity: found ? 1 : .45, filter: found ? undefined : 'grayscale(.9)' }}>
          <img src={caveAsset(t.art)} alt="" loading="lazy" />
          <span className="cv-gem-cap">{en ? t.en : t.ru}<br /><i style={{ opacity: .7 }}>{en ? slot.en : slot.ru}</i></span>
        </span>;
      })}</div>
      <p className="cv-kicker" style={{ marginTop: 6 }}>{en ? 'Ranks' : 'Ранги'}</p>
      <div className="cv-row">{UMBRA_RANKS.map(r => <span key={r.id} className="cv-chip" style={{ color: r.color, borderColor: r.color }}>{en ? r.en : r.ru}</span>)}</div>
      <p className="cv-kicker">{en ? 'Sets (from floor 41)' : 'Комплекты (с 41 этажа)'}</p>
      <div className="cv-sets">{UMBRA_SETS.map(set => <div key={set.id} className="cv-set">
        <b>{en ? set.en : set.ru} · {set.slots.length} {en ? 'pieces' : 'частей'}</b>
        <span style={{ display: 'block', opacity: .8 }}>{set.slots.map(id => { const s = UMBRA_SLOTS.find(x => x.id === id)!; return en ? s.en : s.ru; }).join(' · ')}</span>
        {umbraSet(set.id)!.bonuses.map(b => <span key={b.need} className="cv-set-bonus cv-set-bonus--on">{b.need}: {b.stats.map(s => `${statLabel(s.stat, en)} +${statValue(s.stat, s.value)}`).join(', ')}</span>)}
      </div>)}</div>
      <p className="cv-note" style={{ marginTop: 6 }}>{en ? 'All numbers are test values awaiting owner approval.' : 'Все числа — тестовые значения, ожидают утверждения владельцем.'}</p>
    </Dialog>}
  </div>;
}
