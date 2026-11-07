import { useState } from 'react';
import { useGame } from '@/game/actions';
import { useStore } from '@/game/store';
import {
  TRIAL_BLUEPRINTS, TRIAL_CHEST_RULES, TRIAL_LOOT_ASSET_BASE,
  assembleTrialBlueprint, hasAssembledTrialBlueprint, ownedTrialFragmentCount,
} from '@/game/trialLoot';

/** Read-only city status + explicitly confirmed, local collection assembly.
 * This never opens bracelets or sells items on the not-yet-released auction. */
export function TrialLootCollection({ language }: { language: 'ru' | 'en' }) {
  const state = useStore(useGame);
  const en = language === 'en';
  const [notice, setNotice] = useState('');
  const reputation = state.territoryCityReputation ?? 0;
  const art = (file: string) => import.meta.env.BASE_URL + TRIAL_LOOT_ASSET_BASE + file;
  return (
    <details data-testid="territory-city-rewards" className="overflow-hidden rounded-2xl border-2 border-[#aa824d]/60 bg-[#241913] text-amber-50 shadow-[inset_0_1px_0_rgba(255,216,139,.15)]">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-2.5 px-3 py-2">
        <img src={art('city-reputation.svg')} alt="" width="53" height="53" className="h-[53px] w-[53px] shrink-0 object-contain" />
        <span className="min-w-0 flex-1">
          <strong className="block text-sm font-black text-amber-200">{en ? 'TERRITORY-CITY reputation' : 'Репутация TERRITORY-CITY'}</strong>
          <span className="block text-[11px] leading-4 text-amber-100/80">{en ? 'Future bracelet slots · permanent, non-tradable' : 'Для будущих слотов браслетов · навсегда, не продаётся'}</span>
        </span>
        <strong data-testid="territory-city-reputation-count" className="rounded-lg border border-amber-400/40 bg-black/40 px-2.5 py-1.5 text-xl font-black text-amber-300 tabular-nums">{reputation}</strong>
      </summary>
      <div className="space-y-3 border-t border-amber-600/25 px-3 pb-3 pt-3">
        <p className="text-xs text-amber-100/90">{en ? 'Exactly +1 city reputation can appear in each Trial chest. Not sold or spent; bracelet slots are not active yet.' : 'В сундуке Испытаний может выпасть ровно +1 репутация. Её нельзя продать или потратить. Слоты браслетов пока закрыты.'}</p>
        <div className="grid grid-cols-3 gap-1.5" data-testid="trial-chest-odds">
          {([
            ['explorer', 5, en ? 'Explorer' : 'Испытатель'],
            ['guardian', 10, en ? 'Guardian' : 'Страж'],
            ['legendary', 25, en ? 'Legend' : 'Легенда'],
          ] as const).map(([tier, floor, title]) => (
            <div key={tier} className="rounded-lg border border-amber-700/35 bg-[#140e0c] p-1.5 text-center">
              <img src={art('chest-' + tier + '.svg')} width="64" height="64" className="mx-auto h-16 w-16 object-contain" alt="" loading="lazy" />
              <b className="block text-[11px] text-amber-100">{title}</b>
              <span className="block text-[10px] text-amber-300">{en ? 'every' : 'каждый'} {floor}{en ? 'th floor' : '-й этаж'}</span>
              <span className="block text-[10px] text-amber-50">{Math.round(TRIAL_CHEST_RULES[tier].reputation * 100)}% {en ? 'reputation' : 'репутация'}</span>
              <span className="block text-[10px] text-sky-200">{Math.round(TRIAL_CHEST_RULES[tier].fragment * 100)}% {en ? 'fragment' : 'фрагмент'}</span>
            </div>
          ))}
        </div>
        <h3 className="text-sm font-bold text-amber-200">{en ? 'Ancient blueprints · six different parts' : 'Древние чертежи · шесть разных фрагментов'}</h3>
        {TRIAL_BLUEPRINTS.map(blueprint => {
          const amounts = [1, 2, 3, 4, 5, 6].map(part => ownedTrialFragmentCount(state, blueprint.id, part));
          const done = hasAssembledTrialBlueprint(state, blueprint.id);
          const ready = amounts.every(n => n > 0);
          return (
            <div key={blueprint.id} data-testid={'trial-blueprint-' + blueprint.id} className="rounded-xl border border-amber-700/35 bg-black/25 p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <img src={art('blueprint-fragment.svg')} alt="" width="40" height="40" className="h-10 w-10 object-contain" loading="lazy" />
                <span className="min-w-0 flex-1">
                  <b className="block text-xs">{en ? blueprint.nameEn : blueprint.name}</b>
                  <span className="text-[10px] text-amber-200/70">{blueprint.profession === 'smith' ? (en ? 'Blacksmith' : 'Кузнец') : (en ? 'Jeweler' : 'Ювелир')}</span>
                </span>
                <span className="text-[11px] font-bold text-amber-300">{done ? (en ? 'Learned' : 'Собран') : amounts.filter(n => n > 0).length + '/6'}</span>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {amounts.map((quantity, index) => (
                  <div key={index} className={'flex min-h-12 flex-col items-center justify-center rounded-md border ' + (quantity ? 'border-amber-400/60 bg-amber-900/50' : index >= 4 ? 'border-violet-500/45 bg-violet-950/30' : 'border-white/10 bg-black/35')}>
                    <span className={'text-[11px] font-black ' + (quantity ? 'text-amber-200' : 'text-slate-500')}>{index + 1}/6</span>
                    <span className="text-[10px]">{quantity ? '×' + quantity : '—'}</span>
                  </div>
                ))}
              </div>
              {ready && !done && state.professions?.active !== blueprint.profession && <p className="mt-2 text-[11px] text-amber-200">{en ? 'Assembly requires the matching profession; keep the parts for future auction trade.' : 'Собрать чертёж может только соответствующий мастер. Фрагменты можно сохранить для будущей продажи на аукционе.'}</p>}
              {ready && !done && state.professions?.active === blueprint.profession && <button type="button" className="mt-2 min-h-11 w-full rounded-lg border border-amber-300 bg-gradient-to-b from-amber-300 to-amber-700 px-2 text-xs font-black text-[#241309]" onClick={() => {
                let assembled = false;
                useGame.set(current => {
                  const next = assembleTrialBlueprint(current, blueprint.id);
                  if (next) { assembled = true; return next; }
                  return current;
                });
                setNotice(assembled ? (en ? 'Blueprint assembled! It is stored permanently in your warehouse.' : 'Чертёж собран! Он навсегда сохранён на складе.') : (en ? 'The six different parts are required.' : 'Нужны все шесть разных частей.'));
              }}>{en ? 'Assemble blueprint' : 'Собрать чертёж'}</button>}
              {done && <p className="mt-1 text-[10px] text-emerald-200">{en ? 'Permanent document owned. Crafting recipe will be connected to the professions later.' : 'Чертёж сохранён. Изготовление мастером подключим к профессиям отдельно.'}</p>}
            </div>
          );
        })}
        {notice && <p role="status" className="text-xs font-bold text-amber-200">{notice}</p>}
        <p className="text-[11px] text-slate-300">{en ? 'Extra fragments and rare ingredients are kept in the Warehouse without expiry. Trading will appear when server-verified auction transactions support these materials.' : 'Лишние фрагменты и ингредиенты хранятся на Складе без срока годности. Продажа на Аукционе откроется после подключения защищённых сделок для этих материалов.'}</p>
      </div>
    </details>
  );
}
