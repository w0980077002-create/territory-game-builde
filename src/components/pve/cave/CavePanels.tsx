import { useEffect, useRef, useState } from 'react';
import { caveElixir, CAVE_ELIXIRS, type CaveElixirId } from '@/game/cave/blessing';
import { CAVE_LOOT_TIERS, type CaveFloor } from '@/game/cave/floors';
import { fundReward, FUND_THRESHOLDS } from '@/game/cave/fund';
import { gemKey, gemType } from '@/game/cave/gems';
import type { CaveLoot } from '@/game/cave/sandbox';
import { useCaveSandbox } from '@/game/cave/sandboxStore';
import { caveAsset, DemoNote, Dialog, ESSENCE_ART, GemCell, ItemCell, reasonText, useToast, woodStyle } from './caveShared';

/** Three cave-blessing slots shown right above Challenge. Never the city blessing. */
export function CaveBlessingSlots({ en, floor, onShop }: { en: boolean; floor: number; onShop?: () => void }) {
  const [box, dispatch] = useCaveSandbox();
  const [slot, setSlot] = useState<number | null>(null);
  const [toast, say] = useToast();
  const boosted = box.blessSlots.filter((e): e is CaveElixirId => !!e).map(e => en ? caveElixir(e).boostEn : caveElixir(e).boostRu);
  const owned = CAVE_ELIXIRS.filter(e => (box.elixirs[e.id] ?? 0) > 0);
  return <div className="cv-bless" data-testid="cave-blessing">
    <div className="cv-bless-label">{en ? 'Cave Blessing' : 'Благословение Пещеры'}
      <small>{boosted.length ? (en ? 'Boosted: ' : 'Усилено: ') + [...new Set(boosted)].join(', ') : (en ? 'Shop elixirs · loot chance' : 'Эликсиры из Лавки · шанс добычи')}</small></div>
    {box.blessSlots.map((id, index) => <button key={index} type="button" data-testid="cave-blessing-slot"
      className={'cv-bless-slot' + (id ? ' cv-bless-slot--full' : '')} onClick={() => setSlot(index)}
      aria-label={(en ? 'Cave blessing slot ' : 'Ячейка благословения Пещеры ') + (index + 1) + (id ? ': ' + (en ? caveElixir(id).en : caveElixir(id).ru) : (en ? ', empty' : ', пусто'))}>
      {id ? <img src={caveAsset(caveElixir(id).art)} alt="" /> : '+'}</button>)}
    {slot !== null && <Dialog label={en ? 'Cave Blessing' : 'Благословение Пещеры'} onClose={() => setSlot(null)} testId="cave-blessing-dialog">
      <p className="cv-kicker">{en ? 'Slot' : 'Ячейка'} {slot + 1} / 3</p>
      <h3>{en ? 'Dark Energy Blessing' : 'Благословение Тёмной энергии'}</h3>
      <p className="cv-note">{en
        ? 'Special elixirs from the Shop. Each kind raises the chance of its own loot category in the cave. This is not the city blessing.'
        : 'Особые эликсиры из Лавки. Каждый вид повышает шанс своей категории добычи в Пещере. Это не городское благословение.'}</p>
      {box.blessSlots[slot] && <button type="button" className="cv-btn cv-btn--wide" style={{ margin: '6px 0' }} data-testid="cave-blessing-remove"
        onClick={() => { dispatch({ type: 'bless', slot, elixir: null }); setSlot(null); }}>
        {en ? 'Take out: ' : 'Вынуть: '}{en ? caveElixir(box.blessSlots[slot]!).en : caveElixir(box.blessSlots[slot]!).ru}</button>}
      {owned.length ? <div className="cv-shelf-grid">{owned.map(e => {
        const early = e.category === 'sets' && floor < 41 || e.category === 'gems' && floor < 6;
        return <button key={e.id} type="button" className="cv-shelf-item" data-testid="cave-blessing-pick"
          onClick={() => { const r = dispatch({ type: 'bless', slot, elixir: e.id }); if (r.ok) setSlot(null); else say(reasonText(r.reason, en), true); }}>
          <img src={caveAsset(e.art)} alt="" /><strong>{en ? e.en : e.ru} ×{box.elixirs[e.id]}</strong>
          <span>{en ? 'Boosts: ' : 'Усиливает: '}{en ? e.boostEn : e.boostRu}</span>
          {early && <span style={{ color: '#ffb6a6' }}>{en ? 'This category is not found on this floor yet' : 'На этом этаже такая добыча ещё не встречается'}</span>}
        </button>;
      })}</div> : <p className="cv-empty" data-testid="cave-blessing-empty">{en ? 'You have no cave blessing elixirs. They are sold in the Shop.' : 'У тебя нет эликсиров благословения Пещеры. Они продаются в Лавке.'}</p>}
      {onShop && <button type="button" className="cv-btn cv-btn--gold cv-btn--wide" style={{ marginTop: 8 }} data-testid="cave-blessing-shop" onClick={onShop}>
        {en ? 'To the Shop: cave elixirs' : 'В Лавку: эликсиры Пещеры'}</button>}
      <p className="cv-note" style={{ marginTop: 6 }}>{en
        ? 'Prices, exact chances, stacking and the moment of consumption await the owner\'s decision. In the test build an elixir is spent by one victory and marks its category in the test loot.'
        : 'Цены, точные шансы, сочетание и момент расхода ждут решения владельца. В тестовой версии эликсир тратится одной победой и отмечает свою категорию в тестовой добыче.'}</p>
      {toast}
    </Dialog>}
  </div>;
}

/** Shop shelf: the four cave-blessing elixirs as their own product kind. */
export function CaveElixirShelf({ en, focus }: { en: boolean; focus?: boolean }) {
  const [box, dispatch] = useCaveSandbox();
  const ref = useRef<HTMLElement | null>(null);
  const [toast, say] = useToast();
  useEffect(() => {
    if (!focus) return;
    const frame = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [focus]);
  return <section ref={ref} className="cv-root cv-panel cv-shelf" style={woodStyle()} data-testid="cave-elixir-shelf"
    aria-label={en ? 'Cave blessing elixirs' : 'Эликсиры благословения Пещеры'}>
    <h3>{en ? 'Dark Cave blessing elixirs' : 'Эликсиры благословения Пещеры'}</h3>
    <p className="cv-note">{en
      ? 'Placed into the three blessing slots before a cave Challenge. Not related to the city blessing.'
      : 'Ставятся в три ячейки благословения перед «Вызовом» в Пещере. Не связаны с городским благословением.'}</p>
    <div className="cv-shelf-grid">{CAVE_ELIXIRS.map(e => <div key={e.id} className="cv-shelf-item" data-testid="cave-elixir-product">
      <img src={caveAsset(e.art)} alt="" loading="lazy" />
      <strong>{en ? e.en : e.ru}</strong>
      <span>{en ? 'Boosts: ' : 'Усиливает: '}{en ? e.boostEn : e.boostRu}</span>
      <span>{en ? 'Owned (test)' : 'В запасе (тест)'}: <b>{box.elixirs[e.id] ?? 0}</b> · {en ? 'price: pending' : 'цена: на утверждении'}</span>
      <button type="button" className="cv-btn cv-btn--wide" data-testid="cave-elixir-sample"
        onClick={() => { if (dispatch({ type: 'takeElixir', elixir: e.id }).ok) say((en ? 'Test sample added: ' : 'Тестовый образец добавлен: ') + (en ? e.en : e.ru)); }}>
        {en ? 'Take test sample' : 'Взять тестовый образец'}</button>
    </div>)}</div>
    <DemoNote en={en}>{en
      ? 'Real sale is not enabled: the price and the boost value are not approved yet. A test sample costs nothing and is stored on this device only.'
      : 'Настоящая продажа не включена: цена и величина усиления ещё не утверждены. Тестовый образец ничего не стоит и хранится только на этом устройстве.'}</DemoNote>
    {toast}
  </section>;
}

/** Fund: free track by the server-confirmed maximum cleared floor. */
export function CaveFundPanel({ en, clearedDepth }: { en: boolean; clearedDepth: number }) {
  const [box, dispatch] = useCaveSandbox();
  const [toast, say] = useToast();
  const next = FUND_THRESHOLDS.find(t => t > clearedDepth);
  return <div className="cv-root cv-panel cv-screen" data-testid="cave-fund" style={{ ...woodStyle(), paddingTop: 7 }}>
    <div className="cv-store-head" style={{ marginTop: 0 }}><h4>{en ? 'Dark Energy Fund' : 'Фонд Тёмной энергии'}</h4>
      <strong>{en ? 'Depth' : 'Глубина'} {clearedDepth}/100</strong></div>
    <div className="cv-progress" aria-hidden="true"><div style={{ width: clearedDepth + '%' }} /></div>
    <p className="cv-note" style={{ margin: '5px 0' }}>{next
      ? (en ? `Next stage at floor ${next}. Progress follows your deepest cleared floor.` : `Следующая ступень — этаж ${next}. Прогресс идёт от самого глубокого пройденного этажа.`)
      : (en ? 'Every stage of the fund is reached.' : 'Все ступени фонда достигнуты.')}</p>
    <div data-testid="cave-fund-rows">{FUND_THRESHOLDS.map(threshold => {
      const reward = fundReward(threshold);
      const claimed = box.fundClaimed.includes(threshold);
      const ready = !claimed && clearedDepth >= threshold;
      return <div key={threshold} className={'cv-fund-row' + (ready ? ' cv-fund-row--ready' : claimed ? ' cv-fund-row--done' : '')} data-testid="cave-fund-row">
        <div className="cv-fund-floor">{threshold}<small>{en ? 'floor' : 'этаж'}</small></div>
        <div className="cv-fund-rewards">
          <span className="cv-chip"><img src={caveAsset(ESSENCE_ART)} alt="" style={{ width: 14, height: 14 }} />{en ? 'Essence' : 'Эссенция'} ×{reward.essence}</span>
          {reward.gem && <span className="cv-chip" style={{ color: gemType(reward.gem.type).color }}>{en ? gemType(reward.gem.type).en : gemType(reward.gem.type).ru} {en ? 'Lv.' : 'ур.'}{reward.gem.level}</span>}
          {reward.item && <span className="cv-chip" style={{ color: '#ffd36b' }}>{en ? 'Dark item' : 'Тёмная вещь'}</span>}
        </div>
        <button type="button" className={'cv-btn' + (ready ? ' cv-btn--gold' : '')} disabled={!ready} data-testid="cave-fund-claim"
          onClick={() => { const r = dispatch({ type: 'fundClaim', threshold, maxFloor: clearedDepth }); say(r.ok ? (en ? 'Test reward moved to the dark storage' : 'Тестовая награда отправлена на тёмный склад') : reasonText(r.reason, en), !r.ok); }}>
          {claimed ? (en ? 'Claimed' : 'Получено') : ready ? (en ? 'Claim' : 'Забрать') : (en ? 'Locked' : 'Закрыто')}</button>
      </div>;
    })}</div>
    <p className="cv-note" style={{ marginTop: 7 }}>{en
      ? 'A second (paid) track exists in the reference, but it is not enabled: no payments, no premium rewards.'
      : 'Вторая (платная) дорожка есть в референсе, но не включена: платежей и премиальных наград нет.'}</p>
    <div style={{ marginTop: 6 }}><DemoNote en={en} /></div>
    {toast}
  </div>;
}

/** Multi-category loot shown after a server-confirmed victory (test loot). */
export function CaveLootReveal({ en, loot, onOpenGear }: { en: boolean; loot: CaveLoot; onOpenGear?: () => void }) {
  const boostedNames = CAVE_LOOT_TIERS.filter(t => loot.boosted.includes(t.id)).map(t => en ? t.en : t.ru);
  return <div className="cv-root cv-loot" data-testid="cave-loot-reveal">
    <div className="cv-store-head" style={{ margin: 0 }}><h4>{en ? 'Dark loot' : 'Тёмная добыча'}</h4><span className="cv-chip cv-chip--demo">{en ? 'TEST LOOT' : 'ТЕСТОВАЯ ДОБЫЧА'}</span></div>
    <div className="cv-loot-grid">
      {loot.items.map(item => <ItemCell key={item.id} item={item} en={en} />)}
      <span className="cv-cell" style={{ '--rank': '#b46cf2' } as React.CSSProperties} role="img" aria-label={(en ? 'Dark essence ×' : 'Тёмная эссенция ×') + loot.essence}>
        <img src={caveAsset(ESSENCE_ART)} alt="" /><span className="cv-cell-count">×{loot.essence}</span></span>
      {loot.gems.map((gem, i) => <GemCell key={i} gem={gemKey(gem.type, gem.level)} en={en} />)}
    </div>
    {boostedNames.length > 0 && <p className="cv-note" data-testid="cave-loot-boosted">{en ? 'Blessing boosted: ' : 'Усилено благословением: '}{boostedNames.join(', ')}</p>}
    {loot.overflow > 0 && <p className="cv-note" style={{ color: '#ffb6a6' }}>{en ? `Storage is full: ${loot.overflow} item(s) not received.` : `Склад заполнен: не получено вещей — ${loot.overflow}.`}</p>}
    <p className="cv-note">{en
      ? 'Sent to the test dark storage on this device. Real server loot is not enabled yet.'
      : 'Отправлено на тестовый тёмный склад этого устройства. Настоящая серверная добыча ещё не включена.'}</p>
    {onOpenGear && <button type="button" className="cv-btn cv-btn--wide" style={{ marginTop: 5 }} data-testid="cave-loot-open-gear" onClick={onOpenGear}>{en ? 'Open dark gear' : 'Открыть тёмное снаряжение'}</button>}
  </div>;
}

/** Floor card: enemy, depth and loot categories for a selected floor. */
export function CaveFloorDialog({ en, floor, state, onClose }: { en: boolean; floor: CaveFloor; state: 'cleared' | 'current' | 'locked'; onClose: () => void }) {
  return <Dialog label={(en ? 'Floor ' : 'Этаж ') + floor.index} onClose={onClose} testId="cave-floor-dialog">
    <p className="cv-kicker" style={{ color: floor.depth.hue }}>{en ? floor.depth.en : floor.depth.ru} · {floor.floorInDepth}/20</p>
    <h3>{en ? 'Floor' : 'Этаж'} {floor.index} · {en ? floor.enemyEn : floor.enemyRu}</h3>
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <img src={caveAsset('assets/territory/characters/' + floor.enemyArt + '/idle.webp')} alt={en ? floor.enemyEn : floor.enemyRu}
        style={{ width: 118, height: 132, objectFit: 'contain', objectPosition: 'bottom', transform: 'scaleX(-1)', filter: `drop-shadow(0 0 9px ${floor.depth.hue})` }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="cv-chip">{floor.kind === 'boss' ? (en ? '👑 Boss' : '👑 Босс') : floor.kind === 'elite' ? (en ? 'Elite' : 'Элитный враг') : (en ? 'Cave dweller' : 'Обитатель пещеры')}</span>{' '}
        <span className="cv-chip">{state === 'cleared' ? (en ? 'Cleared' : 'Пройден') : state === 'current' ? (en ? 'Current floor' : 'Текущий этаж') : (en ? 'Locked' : 'Закрыт')}</span>
        <p className="cv-note" style={{ marginTop: 6 }}>{en ? 'Victory (server-confirmed): gold and XP.' : 'За победу (подтверждает сервер): монеты и опыт.'}</p>
      </div>
    </div>
    <p className="cv-kicker" style={{ marginTop: 8 }}>{en ? 'Dark loot categories' : 'Категории тёмной добычи'}</p>
    <div className="cv-row">{CAVE_LOOT_TIERS.map(tier => <span key={tier.id} className={'cv-chip' + (floor.index >= tier.fromFloor ? '' : ' cv-chip--off')}>
      {en ? tier.en : tier.ru}{floor.index >= tier.fromFloor ? '' : (en ? ` · from ${tier.fromFloor}` : ` · с ${tier.fromFloor}`)}</span>)}</div>
    <p className="cv-note">{state === 'cleared'
      ? (en ? 'Repeat raids of cleared floors are designed (your deepest floor is kept), but the server contract is not enabled yet.' : 'Повторные рейды пройденных этажей спроектированы (самый глубокий этаж сохраняется), но серверный контракт ещё не включён.')
      : state === 'locked' ? (en ? 'Clear the previous floor first.' : 'Сначала пройди предыдущий этаж.')
      : (en ? 'Entry costs 1 Dark Stone. On defeat the stone returns only by the server receipt.' : 'Вход — 1 Тёмный камень. При поражении камень возвращается только по квитанции сервера.')}</p>
    <DemoNote en={en}>{en ? 'Dark loot is test loot for now; categories and thresholds are a reference, not live drop rates.' : 'Тёмная добыча пока тестовая; категории и пороги — ориентир, а не живые шансы выпадения.'}</DemoNote>
  </Dialog>;
}
