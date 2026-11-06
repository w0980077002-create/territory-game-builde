import { useEffect, useState } from 'react';

type Category = 'gear' | 'gems' | 'materials';
type Item = Readonly<{ id: string; file: string; ru: string; en: string; category: Category; floor: number; typeRu: string; typeEn: string }>;
const rows: ReadonlyArray<readonly [string, string, string, string, Category, number, string, string]> = [
  ['shadow_amulet','01-shadow-amulet.webp','Тёмный амулет','Shadow Amulet','gear',1,'Аксессуар','Accessory'],
  ['void_axe','02-void-axe.webp','Топор Бездны','Void Axe','gear',1,'Оружие','Weapon'],
  ['rune_boots','03-rune-boots.webp','Рунные сапоги','Rune Boots','gear',1,'Ботинки','Boots'],
  ['azure_crystal','04-azure-crystal.webp','Лазурный кристалл','Azure Crystal','gems',6,'Самоцвет','Gem'],
  ['storm_crystal','05-storm-crystal.webp','Грозовой кристалл','Storm Crystal','gems',6,'Самоцвет','Gem'],
  ['void_spear','06-void-spear.webp','Копьё Бездны','Void Spear','gear',1,'Оружие','Weapon'],
  ['shadow_gauntlets','07-shadow-gauntlets.webp','Теневые перчатки','Shadow Gauntlets','gear',1,'Перчатки','Gloves'],
  ['ruby_crystal','08-ruby-crystal.webp','Рубиновый кристалл','Ruby Crystal','gems',6,'Самоцвет','Gem'],
  ['shadow_ring','09-shadow-ring.webp','Кольцо Тени','Shadow Ring','gear',1,'Аксессуар','Accessory'],
  ['ward_shield','10-ward-shield.webp','Щит защиты','Ward Shield','gear',1,'Щит','Shield'],
  ['shadow_mail','11-shadow-mail.webp','Тёмная кольчуга','Shadow Mail','gear',1,'Нагрудник','Chest armor'],
  ['royal_shadow_mail','12-royal-shadow-mail.webp','Королевская тёмная кольчуга','Royal Shadow Mail','gear',41,'Пример комплекта','Set example'],
  ['shadow_greaves','13-shadow-greaves.webp','Теневые поножи','Shadow Greaves','gear',1,'Поножи','Greaves'],
  ['umbra_essence','14-essence-flask.webp','Тёмная эссенция','Umbra Essence','materials',1,'Материал перековки','Reforging material'],
  ['rune_emblem','15-rune-emblem.webp','Рунная эмблема','Rune Emblem','materials',1,'Возможный материал','Potential material'],
  ['horned_helmet','16-horned-helmet.webp','Рогатый шлем','Horned Helmet','gear',1,'Шлем','Helmet'],
];
export const CAVE_ITEMS: readonly Item[] = rows.map(([id,file,ru,en,category,floor,typeRu,typeEn]) => ({id,file,ru,en,category,floor,typeRu,typeEn}));
const art = (item: Item) => import.meta.env.BASE_URL + 'assets/territory/cave-loot/2026-11-06/' + item.file;
const button = 'min-h-11 rounded-lg border border-[#8c69a1] bg-[#30223e] px-2 py-1 text-xs font-bold text-[#f5e4ff] aria-pressed:bg-[#74468d]';
function Picture({item,en}: {item: Item; en: boolean}) {
  const [failed,setFailed] = useState(false);
  return failed ? <span className="flex h-24 items-center justify-center text-center text-xs">{en ? item.en : item.ru}</span> : <img src={art(item)} alt={en ? item.en : item.ru} loading="lazy" onError={() => setFailed(true)} className="h-24 w-full object-contain"/>;
}
export function CavePreview({tab,en,depth,clearedDepth}: {tab: 'loot'|'enhance'|'fund'; en: boolean; depth: number; clearedDepth: number}) {
  const [filter,setFilter] = useState<'all'|Category>('all');
  const [selected,setSelected] = useState<Item|null>(null);
  const [section,setSection] = useState<'gems'|'reforge'|'sets'>('gems');
  const [example,setExample] = useState(CAVE_ITEMS[1].id);
  const [lines,setLines] = useState<string[]>([]);
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' || event.key === 'Backspace') { event.preventDefault(); setSelected(null); } };
    window.addEventListener('keydown',onKey);
    return () => window.removeEventListener('keydown',onKey);
  },[selected]);
  const labels = {all: en?'All':'Все',gear: en?'Gear':'Вещи',gems: en?'Gems':'Камни',materials: en?'Materials':'Матер.'};
  const items = CAVE_ITEMS.filter(item => filter === 'all' || item.category === filter);
  const note = en ? 'Preview only — this item does not drop yet.' : 'Предпросмотр — предмет пока не выпадает.';
  return <div className="relative mt-1 min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#51416c] bg-[#100c1d] p-2 text-[#f1e0f7]" data-testid={'cave-preview-'+tab}>
    {tab === 'loot' && <><p className="mb-1 text-xs font-bold text-amber-200">{en?'Umbra gear is ADDITIONAL equipment. It never replaces your main gear.':'Тёмная экипировка — ДОПОЛНИТЕЛЬНЫЙ набор. Основное снаряжение героя она не заменяет.'}</p>
      <p className="mb-1 text-xs text-amber-200">{note}</p>
      <p className="mb-2 text-xs">{depth < 6 ? (en?'Next milestone: gems from floor 6':'Следующая ступень: самоцветы с 6-го этажа') : depth < 41 ? (en?'Next milestone: sets from floor 41':'Следующая ступень: комплекты с 41-го этажа') : (en?'Sets milestone reached · preview only':'Ступень комплектов достигнута · только просмотр')}</p>
      <div className="grid grid-cols-4 gap-1">{(['all','gear','gems','materials'] as const).map(f => <button key={f} type="button" className={button} aria-pressed={filter===f} onClick={() => setFilter(f)}>{labels[f]}</button>)}</div>
      <p className="my-2 text-xs">{en?'Items':'Предметов'}: {items.length}</p>
      <div className="grid grid-cols-2 gap-2">{items.map(item => <button key={item.id} type="button" onClick={() => setSelected(item)} className="rounded-lg border border-[#755589] bg-[#23182e] p-2 text-left"><Picture item={item} en={en}/><strong className="block text-xs">{en?item.en:item.ru}</strong><span className="block text-[11px] text-[#d4b5dc]">{en?item.typeEn:item.typeRu} · {item.floor===41?(en?'Set':'Комплект'):(en?'Preview':'Пример')}</span><span className="text-[11px] text-amber-200">{depth>=item.floor?(en?'Preview':'Пример'):(en?'From floor ':'С этажа ')+item.floor}</span></button>)}</div>
    </>}
    {tab === 'enhance' && <><p className="mb-1 text-xs font-bold text-amber-200">{en?'This is a separate additional Umbra loadout, not your main equipment.':'Это отдельный дополнительный тёмный комплект, а не основная экипировка.'}</p>
      <div className="grid grid-cols-3 gap-1">{(['gems','reforge','sets'] as const).map(s => <button key={s} type="button" className={button} aria-pressed={section===s} onClick={()=>setSection(s)}>{s==='gems'?labels.gems:s==='reforge'?(en?'Reforge':'Перековка'):(en?'Sets':'Комплекты')}</button>)}</div>
      <p className="my-2 text-xs text-amber-200">{en?'Example only. No items or materials are spent.':'Только пример. Предметы и материалы не расходуются.'}</p>
      {section==='gems' && <><p className="text-sm">{en?'Gems are planned from floor 6. A gem could be placed in a socket; merging could improve a gem. In the video, the selected item has three sockets. Three gems of the same color and level can be combined; actual TERRITORY costs and compatibility await approval.':'Самоцветы планируются с 6-го этажа. Камень можно будет поместить в гнездо; слияние может улучшить камень. На видео у выбранного предмета три гнезда. Три самоцвета одного цвета и уровня можно объединить; стоимость и совместимость в TERRITORY ещё не утверждены.'}</p><div className="grid grid-cols-3 gap-1">{CAVE_ITEMS.filter(i=>i.category==='gems').map(i=><button key={i.id} type="button" onClick={()=>setSelected(i)}><Picture item={i} en={en}/><span className="text-xs">{en?i.en:i.ru}</span></button>)}</div></>}
      {section==='reforge' && <><label className="block text-sm">{en?'Example item':'Пример предмета'} <select value={example} onChange={e=>setExample(e.target.value)} className="mt-1 w-full rounded bg-[#30223e] p-2">{CAVE_ITEMS.filter(i=>i.category==='gear').map(i=><option key={i.id} value={i.id}>{en?i.en:i.ru}</option>)}</select></label><strong className="mt-2 block text-amber-200">{en?'EXAMPLE':'ПРИМЕР'}</strong><p className="text-sm">{en?'Main attribute: illustrative':'Основная характеристика: условная'}</p>{[en?'Additional property A':'Дополнительное свойство А',en?'Additional property B':'Дополнительное свойство Б'].map(line=><label key={line} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={lines.includes(line)} onChange={()=>setLines(v=>v.includes(line)?v.filter(x=>x!==line):[...v,line])}/>{line}</label>)}<Picture item={CAVE_ITEMS[13]} en={en}/><p className="text-sm">{en?'Reforging may change properties using essence. Rules and cost are undecided.':'Перековка может изменить свойства с помощью эссенции. Правила и стоимость ещё не определены.'}</p></>}
      {section==='sets' && <><button type="button" onClick={()=>setSelected(CAVE_ITEMS[11])} className="w-full"><Picture item={CAVE_ITEMS[11]} en={en}/></button><p className="text-sm">{en?'Set items are planned from floor 41. Matching pieces may provide special effects; their composition and bonuses are undecided. No combat bonuses apply in this preview.':'Комплекты планируются с 41-го этажа. Части набора могут давать особые эффекты; состав и бонусы ещё не определены. В этом примере боевые бонусы не действуют.'}</p></>}
    </>}
    {tab === 'fund' && <><p className="mb-2 text-sm">{en?'Future free and premium tracks follow your highest cleared floor. Rewards and premium access are not available yet.':'Будущие бесплатная и премиальная дорожки зависят от максимального пройденного этажа. Награды и премиальный доступ пока недоступны.'}</p><div className="grid grid-cols-2 gap-2">{[en?'Free':'Бесплатно',en?'Premium':'Премиум'].map(track=><div key={track} className="rounded-lg border border-[#86639a] p-2"><strong>{track}</strong>{[5,10,15,20,25,30,35].map(n=><p key={n} className="my-2 rounded bg-[#30223e] p-2 text-xs">{en?'Floor':'Этаж'} {n} · {clearedDepth>=n?(en?'Threshold reached · preview':'Порог достигнут · пример'):(en?'Upcoming':'Будет доступно')}<br/>{en?'Not awarded yet':'Пока не выдаётся'}</p>)}</div>)}</div></>}
    {selected && <div role="dialog" aria-modal="true" aria-label={en?selected.en:selected.ru} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"><div className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-xl border border-[#b18acf] bg-[#20152b] p-4 shadow-xl"><button type="button" onClick={()=>setSelected(null)} aria-label={en?'Close':'Закрыть'} className="float-right min-h-11 min-w-11 text-xl">×</button><Picture key={selected.id} item={selected} en={en}/><h3 className="text-lg font-black">{en?selected.en:selected.ru}</h3><p className="text-sm">{en?selected.typeEn:selected.typeRu} · {selected.floor===41?(en?'Set example':'Пример комплекта'):(en?'Preview':'Пример')}</p><p className="mt-2 text-sm">{selected.category==='gems'?(en?'A future socket enhancement.':'Будущее усиление для гнезда.'):selected.category==='materials'?(en?'A potential material for a future system.':'Возможный материал будущей системы.'):(en?'Additional Umbra gear. It does not replace your main equipment.':'Дополнительная тёмная экипировка. Основной комплект героя остаётся без изменений.')}</p><p className="mt-2 text-sm">{en?'Category milestone: floor ':'Ступень категории: этаж '}{selected.floor} · {depth>=selected.floor?(en?'threshold reached':'порог достигнут'):(en?'not reached':'ещё не достигнут')}</p><p className="mt-2 text-sm text-amber-200">{note}</p><button type="button" onClick={()=>setSelected(null)} className={'mt-3 w-full '+button}>{en?'Back':'Назад'}</button></div></div>}
  </div>;
}
