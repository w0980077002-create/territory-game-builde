import { useState } from 'react';
import type { GameState } from '@/game/types';
import { useLanguage } from '@/game/i18n';
import { TRIAL_CHEST_ART, trialChestTier, type TrialChestReward } from '@/game/trialLoot';
import { openTrialChest } from '@/game/trialChestVault';
import { TreasuryInventory } from './TreasuryInventory';

function RewardDetails({ loot, en }: { loot: TrialChestReward; en: boolean }) {
  const earned = [
    [en ? 'Gold' : 'Золото', loot.gold],
    [en ? 'Blue diamonds' : 'Синие алмазы', loot.gems],
    [en ? 'Materials' : 'Материалы', loot.materials],
    [en ? 'Elixirs' : 'Эликсиры', loot.elixirs],
    [en ? 'Potions' : 'Зелья', loot.potions ?? 0],
    [en ? 'City reputation' : 'Репутация', loot.reputation],
  ] as const;
  return <ul className="text-[11px] leading-[1.55] text-amber-100">
    {earned.filter(([, qty]) => qty > 0).map(([label, qty]) =>
      <li key={label}>{label}: +{qty}</li>)}
    {loot.fragment && <li>{en ? 'Blueprint fragment' : 'Фрагмент чертежа'}: {loot.fragment.part}/6</li>}
    {loot.component && <li>{en ? 'Rare ingredient' : 'Редкий ингредиент'}: ×{loot.component.qty}</li>}
  </ul>;
}

/** New Trials chests stay sealed until an authenticated server RPC pays them.
 * Historical pre-cutover rewards are displayed only, never claimed again. */
export function InventoryChestShelf({ userId, state }: { userId: string; state: GameState }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [busyFloor, setBusyFloor] = useState<number | null>(null);
  const [lastOpened, setLastOpened] = useState<TrialChestReward | null>(null);
  const [error, setError] = useState('');
  const openedReceipt = state.lastTrialChest ?? null;
  const earned = new Set((state.trialChestClaims ?? []).filter(Number.isSafeInteger)).size;
  const unopened = [...new Set(state.trialChestUnopenedFloors ?? [])]
    .filter(floor => Number.isSafeInteger(floor) && floor >= 1 && floor <= 10000)
    .sort((a, b) => a - b);

  async function open(floor: number) {
    if (busyFloor !== null) return;
    setError('');
    setLastOpened(null);
    setBusyFloor(floor);
    try {
      const result = await openTrialChest(userId, floor);
      setLastOpened(result.loot);
    } catch {
      // A lost response can be a committed payout. Never retry blindly.
      setError(en
        ? 'Opening could not be confirmed. Your chest is protected. Reopen the game to synchronize.'
        : 'Не удалось подтвердить открытие. Сундук защищён. Перезайди в игру для сверки с сервером.');
    } finally {
      setBusyFloor(null);
    }
  }

  return <div data-testid="inventory-chest-shelf" className="min-w-0 space-y-2.5 pb-2 text-amber-100">
    <header className="flex items-center gap-2.5 rounded-xl border-2 border-[#ad8248] bg-[linear-gradient(120deg,#50321e,#211712_75%)] px-2.5 py-2 shadow-[inset_0_1px_0_#fff2c026]">
      <img src={import.meta.env.BASE_URL + TRIAL_CHEST_ART.common} alt="" draggable={false}
        className="h-14 w-14 shrink-0 object-contain drop-shadow-[0_3px_5px_#000a]" />
      <div className="min-w-0">
        <h2 className="text-base font-black text-amber-200">{en ? 'CHESTS' : 'СУНДУКИ'}</h2>
        <p className="text-[11px] leading-4 text-amber-100/85">{en
          ? 'Win a Trial floor — keep its chest sealed until you open it.'
          : 'Победи босса этажа — сохрани сундук и открой, когда захочешь.'}</p>
      </div>
    </header>

    <section data-testid="trial-sealed-chests" className="rounded-xl border border-amber-700/60 bg-[#251911]/95 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-black text-amber-200">{en ? 'Trials · unopened' : 'Испытания · закрытые'}</h3>
        <strong className="rounded-md border border-amber-500/40 bg-amber-900/40 px-2 py-0.5 text-sm tabular-nums">{unopened.length}</strong>
      </div>
      {unopened.length ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {unopened.map(floor => {
            const tier = trialChestTier(floor) ?? 'common';
            return <article key={floor} data-testid={'trial-sealed-floor-' + floor}
              className="min-w-0 rounded-xl border border-[#b68a4b]/65 bg-[linear-gradient(#5b3924,#291b13)] p-2">
              <div className="flex items-center gap-1.5">
                <img src={import.meta.env.BASE_URL + TRIAL_CHEST_ART[tier]} alt="" draggable={false}
                  className="h-14 w-14 max-w-[55%] shrink-0 object-contain" />
                <div className="min-w-0 text-[11px] leading-4 text-amber-100">
                  <strong className="block font-black">{en ? 'Floor' : 'Этаж'} {floor}</strong>
                  <span className="text-amber-200">{tier === 'legendary' ? (en ? 'Legend' : 'Легенда')
                    : tier === 'guardian' ? (en ? 'Guardian' : 'Страж')
                    : tier === 'explorer' ? (en ? 'Explorer' : 'Испытатель')
                    : (en ? 'Common' : 'Обычный')}</span>
                </div>
              </div>
              <button type="button" disabled={busyFloor !== null} onClick={() => void open(floor)}
                className="mt-1.5 min-h-10 w-full rounded-lg border border-amber-200/70 bg-gradient-to-b from-[#ffdf98] to-[#bc7836] px-2 text-xs font-black text-[#321909] disabled:opacity-60">
                {busyFloor === floor ? (en ? 'Opening…' : 'Открываем…') : (en ? 'Open' : 'Открыть')}
              </button>
            </article>;
          })}
        </div>
      ) : <p className="mt-1 text-[11px] leading-5 text-amber-100/70">{en
        ? 'No sealed chests yet. Defeat the next Trials boss.'
        : 'Пока пусто. Победи следующего босса Испытаний.'}</p>}
      {error && <p role="alert" className="mt-2 rounded-md border border-rose-500/40 bg-rose-950/45 p-2 text-xs">{error}</p>}
      {lastOpened && <div data-testid="trial-chest-opened-receipt" role="status"
        className="mt-2 flex gap-2 rounded-lg border border-amber-300/60 bg-amber-950/50 p-2">
        <img src={import.meta.env.BASE_URL + TRIAL_CHEST_ART[lastOpened.tier]} alt=""
          className="h-14 w-14 shrink-0 object-contain" />
        <div>
          <strong className="text-xs font-bold text-emerald-200">{en ? 'Opened · rewards credited!' : 'Открыт · награда начислена!'}</strong>
          <RewardDetails loot={lastOpened} en={en} />
        </div>
      </div>}
    </section>

    <details data-testid="trial-chest-confirmed-history" className="rounded-xl border border-amber-700/45 bg-[#241913] px-3 py-2">
      <summary className="cursor-pointer text-xs font-bold text-amber-200">
        {en ? 'Earlier Trials chests' : 'История сундуков Испытаний'} · {earned - unopened.length}
      </summary>
      {openedReceipt ? <div className="mt-2 flex items-start gap-2 border-t border-amber-800/50 pt-2">
        <img src={import.meta.env.BASE_URL + TRIAL_CHEST_ART[openedReceipt.tier]} alt=""
          className="h-14 w-14 shrink-0 object-contain" loading="lazy" />
        <div>
          <strong className="text-xs text-amber-200">{en ? 'Last opened · floor' : 'Последний открытый · этаж'} {openedReceipt.floor}</strong>
          <RewardDetails loot={openedReceipt} en={en} />
        </div>
      </div> : <p className="mt-2 text-[11px] text-amber-100/75">{en ? 'No saved receipt yet.' : 'Квитанции пока нет.'}</p>}
      <p className="mt-1 text-[10px] text-amber-100/65">{en
        ? 'Previously credited rewards stay yours; nothing is paid twice.'
        : 'Ранее полученные награды сохранены, повторной выдачи нет.'}</p>
    </details>

    <section className="rounded-xl border border-amber-700/60 bg-[#251911] p-2.5">
      <h3 className="mb-1 text-sm font-black text-amber-200">{en ? 'Saved Wheel chests' : 'Сундуки Колеса'}</h3>
      <TreasuryInventory userId={userId} compact />
    </section>
  </div>;
}
