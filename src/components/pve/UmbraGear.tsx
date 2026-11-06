import { useEffect, useState } from 'react';
import { CAVE_ITEMS } from './CavePreview';
import './umbraGear.css';

type Item = typeof CAVE_ITEMS[number];
type Filter = 'all' | Item['category'];
const slots = [
  ['Шлем','Helmet',15], ['Амулет','Amulet',0], ['Оружие','Weapon',1], ['Нагрудник','Chest',10],
  ['Перчатки','Gloves',6], ['Кольцо','Ring',8], ['Поножи','Greaves',12], ['Сапоги','Boots',2],
  ['Позиция 9','Position 9',null], ['Позиция 10','Position 10',null], ['Позиция 11','Position 11',null], ['Позиция 12','Position 12',null],
] as const;
const image = (item: Item) => import.meta.env.BASE_URL + 'assets/territory/cave-loot/2026-11-06/' + item.file;

type Detail = { kind: 'slot'; index: number } | { kind: 'item'; item: Item } | { kind: 'info'; topic: number };
export function UmbraGear({en, hero, clearedDepth, onBack}: {en: boolean; hero: string; clearedDepth: number; onBack: () => void}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<Detail | null>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Backspace') {
        event.preventDefault();
        if (detail) setDetail(null); else onBack();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [detail, onBack]);
  const labels = {all: en?'All':'Все', gear: en?'Gear':'Вещи', gems: en?'Gems':'Самоцветы', materials: en?'Materials':'Материалы'};
  const shown = CAVE_ITEMS.filter(item => filter === 'all' || item.category === filter);
  const selectedSlot = detail?.kind === 'slot' ? slots[detail.index] : null;
  const selectedItem = detail?.kind === 'item' ? detail.item : selectedSlot && selectedSlot[2] !== null ? CAVE_ITEMS[selectedSlot[2]] : null;
  return <div className="umbra-screen" data-testid="umbra-screen">
    <header className="umbra-header"><button type="button" onClick={onBack} aria-label={en?'Back to cave':'Назад в пещеру'}>‹</button><h3>{en?'Additional Umbra Gear':'Дополнительное тёмное снаряжение'}</h3></header>
    <p className="umbra-note">{en?'Test preview · Nothing is equipped or saved':'Тестовая версия · ничего не экипируется и не сохраняется'}</p>
    <div className="umbra-hero-grid">
      <div className="umbra-slots">{slots.slice(0,6).map((slot,i) => <button type="button" key={slot[1]} onClick={()=>setDetail({kind:'slot',index:i})} aria-label={(en?slot[1]:slot[0]) + (en?' · sample slot':' · образец слота')} data-testid="umbra-slot"><img src={image(CAVE_ITEMS[slot[2]!])} alt=""/><span>{en?'Sample':'Образец'}</span></button>)}</div>
      <div className="umbra-hero"><img src={hero} alt={en?'Your hero':'Твой герой'}/></div>
      <div className="umbra-slots">{slots.slice(6).map((slot,i) => <button type="button" key={slot[1]} onClick={()=>setDetail({kind:'slot',index:i+6})} aria-label={(en?slot[1]:slot[0]) + (en?' · prototype slot':' · прототип слота')} data-testid="umbra-slot">{slot[2] !== null ? <img src={image(CAVE_ITEMS[slot[2]])} alt=""/> : <span className="umbra-slot-mark">{i < 4 ? '+' : '◇'}</span>}<span>{slot[2] !== null ? (en?'Sample':'Образец') : i < 4 ? (en?'Empty':'Пусто') : (en?'Locked':'Закрыто')}</span></button>)}</div>
    </div>
    <p className="umbra-note">{en?'Slot names and unlock rules are provisional. Samples are not equipped.':'Названия слотов и условия открытия рабочие. Образцы не надеты.'}</p>
    <section aria-label={en?'Dark storage':'Тёмный склад'}><h3 className="umbra-title">{en?'Dark storage':'Тёмный склад'}</h3><p className="umbra-note">{en?'Loot samples, not yet obtained':'Образцы добычи, ещё не получены'}</p>
      <div className="umbra-actions">{(en?['Guide','Dismantle','Enhance all']:['Справочник','Разобрать','Усилить в один клик']).map((label,i)=><button key={label} type="button" onClick={()=>setDetail({kind:'info',topic:i})}>{label}</button>)}</div>
      <div className="umbra-filters">{(['all','gear','gems','materials'] as const).map(f=><button type="button" key={f} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{labels[f]}</button>)}</div>
      <div className="umbra-items">{shown.map(item=><button type="button" key={item.id} onClick={()=>setDetail({kind:'item',item})} data-testid="umbra-item"><img src={image(item)} alt="" loading="lazy"/><span>{en?item.en:item.ru}</span></button>)}</div>
    </section>
    {detail && <div className="umbra-overlay" role="dialog" aria-modal="true" aria-label={en?'Details':'Подробности'} onClick={()=>setDetail(null)}><div className="umbra-dialog" onClick={event=>event.stopPropagation()}><button type="button" className="umbra-close" onClick={()=>setDetail(null)} aria-label={en?'Close':'Закрыть'}>×</button>
      {selectedSlot && <><h3>{en?selectedSlot[1]:selectedSlot[0]}</h3><p>{en?'Prototype position · name and unlock conditions are not confirmed.':'Позиция прототипа · название и условия открытия ещё не утверждены.'}</p><p>{en?'The slot is not equipped.':'Слот не экипирован.'}</p></>}
      {selectedItem && <><img className="umbra-detail-art" src={image(selectedItem)} alt=""/><h3>{en?selectedItem.en:selectedItem.ru}</h3><p>{en?selectedItem.ru:selectedItem.en}</p><p>{en?'Category':'Категория'}: {labels[selectedItem.category]} · {en?selectedItem.typeEn:selectedItem.typeRu}</p><p>{en?'Reference category':'Референсная категория'}: {selectedItem.category === 'gear' ? (selectedItem.floor === 41 ? 'Set' : 'Common Dark Gear') : (en?'Not a gear rank':'Не ранг экипировки')}. {en?'Planned milestone: floor ':'Планируемая ступень: этаж '}{selectedItem.floor} · {clearedDepth >= selectedItem.floor ? (en?'threshold reached':'порог пройден') : (en?'threshold not reached':'порог не пройден')}.</p><p>{en?'Additional equipment. The hero’s main set is not replaced.':'Дополнительная экипировка. Основной комплект героя не заменяется.'}</p><p>{selectedItem.category === 'gear' ? (en?'A separate Umbra sample, not an ordinary equipped item.':'Образец отдельного тёмного набора, не обычная надетая вещь.') : (en?'A sample for a separate future system, not equipment.':'Образец для отдельной будущей системы, не экипировка.')}</p><p className="umbra-note">{en?'Sample only; not obtained or available as loot yet.':'Только образец; ещё не получен и не выпадает.'}</p></>}
      {detail.kind === 'info' && <><h3>{(en?['Guide','Dismantle','Enhance all']:['Справочник','Разобрать','Усилить в один клик'])[detail.topic]}</h3><p>{en?'This future function is not available in the test version. No items or resources are spent.':'Эта функция планируется и пока недоступна в тестовой версии. Предметы и ресурсы не расходуются.'}</p></>}
      <button type="button" className="umbra-back" onClick={()=>setDetail(null)}>{en?'Back':'Назад'}</button></div></div>}
  </div>;
}
