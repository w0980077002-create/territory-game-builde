import type { GameState } from '@/game/types';
import { useLanguage } from '@/game/i18n';
import { TRIAL_CHEST_ART } from '@/game/trialLoot';
import { TreasuryInventory } from './TreasuryInventory';

/**
 * Safe, read-only Trials history plus the existing authenticated Treasury.
 * This view never reserves, rolls, or grants a new Trials reward.
 * A separate approved server change is required for unopened Trials chests.
 */
export function InventoryChestShelf({ userId, state }: { userId: string; state: GameState }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const latest = state.lastTrialChest ?? null;
  const pastFloors = new Set((state.trialChestClaims ?? []).filter(Number.isSafeInteger)).size;
  const rewards = latest ? [
    [en ? 'Gold' : 'Золото', latest.gold],
    [en ? 'Blue diamonds' : 'Синие алмазы', latest.gems],
    [en ? 'Forge materials' : 'Материалы кузницы', latest.materials],
    [en ? 'Elixirs' : 'Эликсиры', latest.elixirs],
    [en ? 'Potions' : 'Зелья', latest.potions ?? 0],
    [en ? 'City reputation' : 'Репутация города', latest.reputation],
  ] as const : [];

  return (
    <div data-testid="inventory-chest-shelf" className="space-y-3 pb-3">
      <header className="relative overflow-hidden rounded-2xl border-2 border-[#a77a43] bg-[linear-gradient(145deg,#422719,#1e1411_68%,#392114)] px-3 py-3 text-amber-100 shadow-[inset_0_2px_8px_#8c613855,0_4px_16px_#0008]">
        <div className="absolute inset-x-2 top-1 h-px bg-gradient-to-r from-transparent via-amber-200/55 to-transparent" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <img src={import.meta.env.BASE_URL + TRIAL_CHEST_ART.common} alt="" draggable={false}
            className="h-20 w-20 shrink-0 object-contain drop-shadow-[0_4px_7px_#000b]" />
          <div className="min-w-0">
            <h2 className="text-lg font-black tracking-wide text-amber-200">{en ? 'CHESTS' : 'СУНДУКИ'}</h2>
            <p className="text-xs leading-5 text-amber-100/90">{en
              ? 'Earned treasure in one place. Only server-confirmed rewards are shown.'
              : 'Полученные сокровища в одном месте. Отображаются только подтверждённые награды.'}</p>
          </div>
        </div>
      </header>

      <section data-testid="trial-chest-confirmed-history" className="rounded-2xl border border-amber-700/60 bg-[#241913] p-3 text-amber-100">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-black text-amber-200">{en ? 'Trials' : 'Испытания'}</h3>
          <span className="rounded-lg border border-amber-700/60 bg-black/35 px-2 py-1 text-[11px] font-bold text-amber-200">
            {en ? 'Previously granted' : 'Выдано ранее'}: {pastFloors}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-amber-100/75">{en
          ? 'Rewards already credited for past victories are history, not unopened chests. They cannot be claimed again.'
          : 'Награды за прошлые победы уже начислены. Это история, а не закрытые сундуки: повторно забрать их нельзя.'}</p>
        {latest ? (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-700/45 bg-black/25 p-2">
            <img src={import.meta.env.BASE_URL + TRIAL_CHEST_ART[latest.tier]} alt=""
              className="h-20 w-20 shrink-0 object-contain" loading="lazy" />
            <div className="min-w-0 flex-1">
              <strong className="text-xs text-amber-200">{en ? 'Last opened chest · Floor ' : 'Последний открытый сундук · Этаж '}{latest.floor}</strong>
              <p className="text-[10px] text-emerald-200">{en ? 'Reward already credited' : 'Награда уже начислена'}</p>
              <ul className="mt-1 text-[11px] leading-4">
                {rewards.filter(([, count]) => count > 0).map(([label, count]) => <li key={label}>{label}: +{count}</li>)}
                {latest.fragment && <li>{en ? 'Blueprint fragment' : 'Фрагмент чертежа'}: {latest.fragment.part}/6</li>}
                {latest.component && <li>{en ? 'Rare material' : 'Редкий материал'}: ×{latest.component.qty}</li>}
              </ul>
            </div>
          </div>
        ) : <p className="mt-3 text-xs text-amber-100/70">{en
          ? 'There is no recent Trials chest receipt in this save.'
          : 'В этом сохранении пока нет квитанции о последнем сундуке Испытаний.'}</p>}
      </section>

      <section className="rounded-2xl border border-amber-700/60 bg-[#241913] p-2">
        <h3 className="px-1 py-1 text-sm font-black text-amber-200">{en ? 'Saved Fortune chests' : 'Сохранённые сундуки Колеса'}</h3>
        <p className="px-1 pb-2 text-[11px] leading-4 text-amber-100/75">{en
          ? 'Open previously earned chests through their existing server-protected inventory. Wheel spins remain disabled.'
          : 'Открывай ранее выигранные сундуки через существующее серверное хранилище. Вращения Колеса остаются отключены.'}</p>
        <TreasuryInventory userId={userId} />
      </section>
    </div>
  );
}
