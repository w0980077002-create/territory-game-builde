import { useState } from 'react';
import type { GameState } from '@/game/types';
import { useLanguage } from '@/game/i18n';
import { TRIAL_CHEST_ART, type TrialChestReward, type TrialChestTier } from '@/game/trialLoot';
import { openTrialChest } from '@/game/trialChestVault';
import { TreasuryInventory } from './TreasuryInventory';

const trialTier = (floor: number): TrialChestTier =>
  floor % 25 === 0 ? 'legendary' : floor % 10 === 0 ? 'guardian' : floor % 5 === 0 ? 'explorer' : 'common';

function LootSummary({ loot, en }: { loot: TrialChestReward; en: boolean }) {
  const rewards = [
    [en ? 'Gold' : 'Золото', loot.gold],
    [en ? 'Blue diamonds' : 'Синие алмазы', loot.gems],
    [en ? 'Forge materials' : 'Материалы кузницы', loot.materials],
    [en ? 'Strength elixirs' : 'Эликсиры силы', loot.elixirs],
    [en ? 'Health potions' : 'Зелья здоровья', loot.potions ?? 0],
    [en ? 'TERRITORY-CITY reputation' : 'Репутация TERRITORY-CITY', loot.reputation],
  ] as const;
  return <ul className="mt-1 text-xs leading-5 text-amber-100/90">
    {rewards.filter(([, amount]) => amount > 0).map(([label, amount]) => <li key={label}>{label}: +{amount}</li>)}
    {loot.fragment && <li>{en ? 'Blueprint fragment' : 'Фрагмент чертежа'}: {loot.fragment.part}/6</li>}
    {loot.component && <li>{en ? 'Rare ingredient' : 'Редкий ингредиент'}: ×{loot.component.qty}</li>}
  </ul>;
}

/**
 * Actual unopened Trials are a server-reserved one-time claim. Legacy chests
 * paid before the cutover are history ONLY. Fortune's existing server vault
 * continues to own its own receipts, while Wheel spins stay disabled.
 */
export function ChestVault({ userId, state }: { userId: string; state: GameState }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [busyFloor, setBusyFloor] = useState<number | null>(null);
  const [opened, setOpened] = useState<TrialChestReward | null>(null);
  const [error, setError] = useState('');
  const lastPaid = state.lastTrialChest ?? null;
  const earned = Array.isArray(state.trialChestClaims) ? new Set(state.trialChestClaims).size : 0;
  const unopened = [...new Set(state.trialChestUnopenedFloors ?? [])]
    .filter(floor => Number.isSafeInteger(floor) && floor >= 1 && floor <= 10000)
    .sort((a, b) => a - b);
  const tierNames: Record<TrialChestTier, [string, string]> = {
    common: ['Обычный', 'Common'],
    explorer: ['Испытателя', 'Explorer'],
    guardian: ['Стража', 'Guardian'],
    legendary: ['Легендарный', 'Legendary'],
  };

  async function open(floor: number) {
    if (busyFloor !== null) return;
    setError('');
    setOpened(null);
    setBusyFloor(floor);
    try {
      const result = await openTrialChest(userId, floor);
      setOpened(result.loot);
    } catch {
      // The server remains authoritative; never guess a prize or retry a
      // possibly committed RPC. A full re-entry reconciles its saved receipt.
      setError(en
        ? 'Could not confirm opening. Your chest is safe. Reopen the game to refresh before trying again.'
        : 'Не удалось подтвердить открытие. Сундук сохранён. Перезайди в игру для сверки с сервером.');
    } finally {
      setBusyFloor(null);
    }
  }

  return (
    <div data-testid="inventory-chest-vault" className="flex min-w-0 flex-col gap-3 pb-3 text-amber-100">
      <section className="rounded-2xl border-2 border-amber-700/65 bg-[linear-gradient(145deg,#4c301d,#26180f_65%,#1d1411)] p-3 shadow-[inset_0_1px_0_#dab47640,0_4px_12px_#10090799]">
        <h2 className="text-center text-lg font-black text-amber-200">{en ? 'Your chests' : 'Твои сундуки'}</h2>
        <p className="mt-1 text-center text-xs leading-5 text-amber-100/85">
          {en
            ? 'New Trials chests go here unopened. Open them when you choose; only then does the server award the loot. Earlier rewards stay credited.'
            : 'Новые сундуки Испытаний попадают сюда закрытыми. Открывай, когда захочешь: только тогда сервер начислит награду. Старые награды сохранены.'}
        </p>
      </section>

      <section data-testid="trial-sealed-chests" className="rounded-2xl border border-amber-700/60 bg-[#24170f]/95 p-2.5">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-sm font-black text-amber-200">{en ? 'Trials · unopened' : 'Испытания · неоткрытые'}</h3>
          <strong className="rounded-lg border border-amber-500/40 bg-amber-800/30 px-2 py-1 text-sm tabular-nums">{unopened.length}</strong>
        </div>
        {unopened.length > 0 ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {unopened.map(floor => {
              const tier = trialTier(floor);
              return <div key={floor} data-testid={`trial-sealed-floor-${floor}`}
                className="min-w-0 rounded-xl border border-amber-500/40 bg-[linear-gradient(#694023,#301c11_62%,#211710)] p-2 text-center shadow-[inset_0_1px_0_#ffcf8e40]">
                <img src={import.meta.env.BASE_URL + TRIAL_CHEST_ART[tier]} alt=""
                  className="mx-auto h-20 w-20 max-w-full object-contain drop-shadow-lg" draggable={false} />
                <strong className="block text-xs font-black text-amber-100">{tierNames[tier][en ? 1 : 0]}</strong>
                <span className="block text-[11px] text-amber-200">{en ? 'Floor' : 'Этаж'} {floor}</span>
                <button type="button" disabled={busyFloor !== null}
                  onClick={() => void open(floor)}
                  className="mt-2 min-h-10 w-full rounded-lg border border-amber-200/70 bg-gradient-to-b from-[#ffdc8d] to-[#a76429] px-1 text-xs font-black text-[#35190d] disabled:opacity-60">
                  {busyFloor === floor ? (en ? 'Opening…' : 'Открываем…') : (en ? 'Open chest' : 'Открыть')}
                </button>
              </div>;
            })}
          </div>
        ) : (
          <p className="mt-2 rounded-xl bg-black/20 px-3 py-4 text-center text-xs text-amber-100/80">
            {en ? 'No sealed Trials chests yet. Defeat the next floor boss to earn one.'
              : 'Пока нет закрытых сундуков. Победи босса следующего этажа Испытаний.'}
          </p>
        )}
        {error && <p role="alert" className="mt-2 rounded-lg border border-rose-500/40 bg-rose-950/40 p-2 text-xs text-rose-100">{error}</p>}
        {opened && <div data-testid="trial-chest-opened-receipt" role="status"
          className="mt-2 rounded-xl border border-yellow-400/60 bg-black/30 p-3">
          <strong className="text-sm text-yellow-200">{en ? 'Chest opened · rewards credited!' : 'Сундук открыт · награды начислены!'}</strong>
          <LootSummary loot={opened} en={en} />
        </div>}
      </section>

      <section data-testid="trial-chest-history" className="rounded-2xl border border-amber-700/60 bg-[#24170f]/95 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-black text-amber-200">{en ? 'Trials · floors rewarded' : 'Испытания · этажей с сундуками'}</h3>
          <strong className="rounded-lg border border-amber-500/40 bg-amber-800/30 px-2 py-1 text-sm tabular-nums">{earned}</strong>
        </div>
        {lastPaid ? <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-black/20 p-2">
          <img src={import.meta.env.BASE_URL + TRIAL_CHEST_ART[lastPaid.tier]} alt=""
            className="h-20 w-20 shrink-0 object-contain" draggable={false} />
          <div className="min-w-0 flex-1">
            <strong className="block text-sm text-amber-100">{en ? 'Last credited chest · floor' : 'Последний полученный сундук · этаж'} {lastPaid.floor}</strong>
            <span className="text-xs text-amber-300">{tierNames[lastPaid.tier][en ? 1 : 0]}</span>
            <LootSummary loot={lastPaid} en={en} />
          </div>
        </div> : <p className="mt-2 text-xs text-amber-100/80">
          {en ? 'No credited Trials chest receipt yet.' : 'Пока нет записи об открытом сундуке Испытаний.'}
        </p>}
        <p className="mt-2 text-[11px] leading-4 text-amber-100/65">
          {en ? 'Previously credited loot stays yours. No chest can be paid twice.'
            : 'Уже начисленные награды остаются у тебя. Повторных выплат нет.'}
        </p>
      </section>

      <div data-testid="wheel-saved-chests">
        <TreasuryInventory userId={userId} />
      </div>
    </div>
  );
}
