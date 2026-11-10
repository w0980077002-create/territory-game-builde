import type { MortarionRewardStatus, MortarionRewardTier } from '@/game/mortarionRewards';

const tiers: { tier:MortarionRewardTier; ru:string; en:string; art:string }[] = [
  { tier:'participant',ru:'Участник',en:'Participant',art:'assets/territory/ui/materials/royal-chest.webp' },
  { tier:'hunter',ru:'Охотник',en:'Soul hunter',art:'assets/territory/ui/trial-loot/chest-explorer.svg' },
  { tier:'legendary',ru:'Легенда',en:'Legendary',art:'assets/territory/ui/trial-loot/chest-legendary.svg' },
];

interface Props {
  status:MortarionRewardStatus|null;
  en:boolean;
  busy:boolean;
  error:string;
  onClaim:()=>void;
}

/** A single reward chest grows with real server-verified participation.
 * Neither this panel nor its probabilities mint any client-side currency. */
export function MortarionRewardPanel({status,en,busy,error,onClaim}:Props) {
  const receipt=status?.receipt;
  return <section data-testid="mortarion-rewards" className="rounded-2xl border-2 border-violet-600/60 bg-[linear-gradient(140deg,#392137,#1c1420_70%)] px-3 py-3 text-amber-100">
    <div className="flex items-center gap-2">
      <img src={import.meta.env.BASE_URL + 'assets/territory/ui/materials/royal-chest.webp'} alt=""
        className="h-14 w-14 shrink-0 object-contain" draggable={false}/>
      <div className="min-w-0">
        <h3 className="text-sm font-black text-amber-200">🎁 {en ? 'MORTARION REWARDS' : 'НАГРАДЫ МОРТАРИОНА'}</h3>
        <p className="text-[11px] leading-4 text-amber-100/85">
          {en ? 'One chest upgrades as you fight. Claim it once when the raid ends.'
            : 'Один сундук улучшается за активность. Забери его после завершения рейда.'}
        </p>
      </div>
    </div>

    <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[10px]">
      {tiers.map(({tier,ru,en:nameEn,art},i)=>
        <div key={tier} className={status?.tier===tier
          ? 'rounded-lg border border-amber-300 bg-amber-900/30 px-1 py-1'
          : 'rounded-lg border border-amber-800/40 bg-black/20 px-1 py-1'}>
          <img src={import.meta.env.BASE_URL + art} alt="" className="mx-auto h-12 w-12 object-contain" draggable={false}/>
          <strong className="block text-amber-200">{en ? nameEn : ru}</strong>
          <span className="block text-amber-100/75">{i===0 ? (en?'1 day':'1 день')
            : i===1 ? (en?'3 days':'3 дня')
            : (en?'5 days, 15 hits':'5 дней, 15 ударов')}</span>
        </div>
      )}
    </div>

    <p className="mt-2 text-xs font-bold text-amber-100" data-testid="mortarion-participation">
      {en ? 'Participation' : 'Активность'}: {status
        ? <>{status.activeDays}/{status.requiredDays} {en?'days':'дней'} · {status.totalHits} {en?'hits':'ударов'}</>
        : (en?'Checking the server…':'Сверяем с сервером…')}
    </p>
    {status && <div className="mt-1 flex gap-1.5" aria-label={en?'Participation days':'Дни участия'}>
      {Array.from({length:status.requiredDays},(_,i)=>{
        const done=status.hitDays.includes(i+1);
        return <span key={i} className={done
          ? 'flex h-6 flex-1 items-center justify-center rounded-md border border-emerald-400/60 bg-emerald-800/60 text-xs font-bold text-emerald-100'
          : 'flex h-6 flex-1 items-center justify-center rounded-md border border-amber-700/40 bg-black/35 text-xs font-bold text-amber-200/60'}>
          {done?'✓':i+1}</span>;
      })}
    </div>}

    <p className="mt-2 text-[11px] leading-4 text-amber-100/85">
      {en ? 'TOP 1: Lord of Souls title, gold frame, guaranteed blueprint fragment and legendary chest. TOP 2–3: special frame, fragment and upgraded chest. TOP 4–10: permanent medal and extra resources.'
        : 'Топ-1: титул «Повелитель душ», золотая рамка, гарантированный фрагмент и легендарный сундук. Топ-2–3: рамка, фрагмент и улучшенный сундук. Топ-4–10: постоянная медаль и бонус ресурсов.'}
    </p>
    <p className="mt-2 text-[11px] leading-4 text-violet-200">
      💜 {en ? 'Legendary chest: 0.3% Heart of Mortarion (future trade/craft), 0.05% Awakening Stone. Defeating the boss grants an extra bonus to every eligible participant.'
        : 'Легендарный сундук: шанс 0,3% на «Сердце Мортариона» (будущий крафт и аукцион), 0,05% на Камень пробуждения. При общей победе всем участникам дополнительный бонус.'}
    </p>
    {status?.claimed && receipt && <div role="status" data-testid="mortarion-reward-receipt"
      className="mt-2 rounded-lg border border-emerald-500/50 bg-emerald-950/50 p-2 text-xs">
      <strong className="text-emerald-200">{en?'Chest claimed and credited!':'Сундук открыт, награды начислены!'}</strong>
      <p>+{receipt.gold} 🪙 · +{receipt.gems} 💎 · +{receipt.materials} ⚒ · {receipt.elixirs} {en?'elixirs':'эликсиров'}</p>
      {receipt.items.map((item,i)=><p key={item.id+'-'+i}>✦ {item.name} ×{item.qty}</p>)}
      {receipt.title && <p>🏅 {receipt.title}</p>}
    </div>}
    {status?.canClaim && <button type="button" data-testid="mortarion-claim-reward"
      disabled={busy} onClick={onClaim}
      className="mt-2 min-h-11 w-full rounded-lg border border-yellow-300 bg-gradient-to-b from-amber-300 to-orange-700 px-2 text-sm font-black text-[#24120a] disabled:opacity-50">
      {busy ? (en?'Checking reward…':'Выдаём награду…') : (en?'OPEN YOUR RAID CHEST':'ОТКРЫТЬ СВОЙ СУНДУК')}
    </button>}
    {status?.closed && !status.canClaim && !status.claimed && status.totalHits===0 &&
      <p className="mt-2 text-xs text-amber-200">{en?'At least one confirmed hit is required.':'Нужен хотя бы один подтверждённый удар.'}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-200">{error}</p>}
  </section>;
}
