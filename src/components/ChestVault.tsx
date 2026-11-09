import type { GameState } from '@/game/types';
import { useLanguage } from '@/game/i18n';
import { TRIAL_CHEST_ART, type TrialChestTier } from '@/game/trialLoot';
import { TreasuryInventory } from './TreasuryInventory';

/**
 * A presentation-only history for already-credited Trial loot, followed by
 * the existing SERVER-owned Fortune chest vault. Never roll or grant loot here.
 * The Wheel of Fortune and the old Hall routes remain disabled.
 */
export function ChestVault({ userId, state }: { userId: string; state: GameState }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const chest = state.lastTrialChest ?? null;
  const claimed = Array.isArray(state.trialChestClaims) ? new Set(state.trialChestClaims).size : 0;
  const tierNames: Record<TrialChestTier, [string, string]> = {
    common: ['Обычный', 'Common'],
    explorer: ['Испытателя', 'Explorer'],
    guardian: ['Стража', 'Guardian'],
    legendary: ['Легендарный', 'Legendary'],
  };
  const rewards = chest ? [
    [en ? 'Gold' : 'Золото', chest.gold],
    [en ? 'Blue diamonds' : 'Синие алмазы', chest.gems],
    [en ? 'Forge materials' : 'Материалы кузницы', chest.materials],
    [en ? 'Elixirs' : 'Эликсиры', chest.elixirs],
    [en ? 'Potions' : 'Зелья', chest.potions ?? 0],
    [en ? 'TERRITORY-CITY reputation' : 'Репутация TERRITORY-CITY', chest.reputation],
  ] as const : [];

  return (
    <div data-testid="inventory-chest-vault" className="flex min-w-0 flex-col gap-3 pb-3 text-amber-100">
      <section className="rounded-2xl border-2 border-amber-700/65 bg-[linear-gradient(145deg,#4c301d,#26180f_65%,#1d1411)] p-3 shadow-[inset_0_1px_0_#dab47640,0_4px_12px_#10090799]">
        <h2 className="text-center text-lg font-black text-amber-200">
          {en ? 'Your chests' : 'Твои сундуки'}
        </h2>
        <p className="mt-1 text-center text-xs leading-5 text-amber-100/85">
          {en
            ? 'Trials chests pay out immediately on victory. Unopened Wheel chests are stored separately on the server.'
            : 'Сундуки Испытаний выдают награды сразу после победы. Неоткрытые сундуки Колеса хранятся отдельно на сервере.'}
        </p>
      </section>

      <section data-testid="trial-chest-history" className="rounded-2xl border border-amber-700/60 bg-[#24170f]/95 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-black text-amber-200">{en ? 'Trials · received' : 'Испытания · получено'}</h3>
          <strong className="rounded-lg border border-amber-500/40 bg-amber-800/30 px-2 py-1 text-sm tabular-nums">{claimed}</strong>
        </div>
        {chest ? (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-black/20 p-2">
            <img src={import.meta.env.BASE_URL + TRIAL_CHEST_ART[chest.tier]} alt=""
              className="h-20 w-20 shrink-0 object-contain" draggable={false} />
            <div className="min-w-0 flex-1">
              <strong className="block text-sm text-amber-100">
                {en ? 'Last chest' : 'Последний сундук'} · {en ? 'floor' : 'этаж'} {chest.floor}
              </strong>
              <span className="text-xs text-amber-300">{tierNames[chest.tier][en ? 1 : 0]}</span>
              <ul className="mt-1 text-xs leading-5 text-amber-100/90">
                {rewards.filter(([, amount]) => amount > 0).map(([label, amount]) =>
                  <li key={label}>{label}: +{amount}</li>)}
                {chest.fragment && <li>{en ? 'Blueprint fragment' : 'Фрагмент чертежа'}: {chest.fragment.part}/6</li>}
                {chest.component && <li>{en ? 'Rare ingredient' : 'Редкий ингредиент'}: ×{chest.component.qty}</li>}
              </ul>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-amber-100/80">
            {en ? 'No latest Trial chest receipt saved.' : 'Нет сохранённой записи о последнем сундуке Испытаний.'}
          </p>
        )}
        <p className="mt-2 text-[11px] leading-4 text-amber-100/65">
          {en
            ? 'Already credited to resources or inventory. Opening again would duplicate rewards, so these chests cannot be claimed twice.'
            : 'Содержимое уже начислено в ресурсы или инвентарь. Повторно получать сундуки нельзя.'}
        </p>
      </section>

      <div data-testid="wheel-saved-chests">
        <TreasuryInventory userId={userId} />
      </div>
    </div>
  );
}
