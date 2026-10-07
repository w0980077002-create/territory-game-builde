import { useStore } from '@/game/store';
import { useGame, claimQuest, claimAchievement } from '@/game/actions';
import { CheckCircle2, Lock } from 'lucide-react';
import type { Achievement, Quest } from '@/game/types';
import { Currency } from './ui/Currency';

const SECTIONS: { type: Quest['type']; title: string; hint: string }[] = [
  { type: 'daily', title: 'Ежедневные', hint: 'Обновляются каждый день' },
  { type: 'weekly', title: 'Еженедельные', hint: 'Сложнее, но щедрее' },
  { type: 'story', title: 'Сюжетные', hint: 'Путь героя' },
];

export function QuestsScreen() {
  const state = useStore(useGame);
  const ready = state.quests.filter((q) => !q.claimed && q.current >= q.target).length;

  return (
    <div className="space-y-4 animate-fade-in pb-2">
      <div className="relative rounded-2xl overflow-hidden border border-amber-500/20 p-4">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-900/35 via-[#16130d] to-[#0f1115]" />
        <div className="relative flex items-center gap-3">
          <img src="/ic-quests.webp" alt="" className="w-12 h-12 object-contain" />
          <div className="flex-1">
            <h2 className="text-lg font-bold text-amber-100">Задания</h2>
            <p className="text-xs text-gray-400">{ready ? `Готово к получению: ${ready}` : 'Выполняй задания и получай боевые камни'}</p>
          </div>
        </div>
      </div>

      {SECTIONS.map((sec) => {
        const list = state.quests.filter((q) => q.type === sec.type);
        if (!list.length) return null;
        return (
          <section key={sec.type}>
            <div className="flex items-baseline justify-between px-1 mb-2">
              <h3 className="text-xs font-semibold text-amber-200/80 uppercase tracking-wider">{sec.title}</h3>
              <span className="text-[11px] text-gray-500">{sec.hint}</span>
            </div>
            <div className="space-y-2">
              {list.map((q) => (
                <QuestCard key={q.id} quest={q} onClaim={() => useGame.set(claimQuest(useGame.get(), q.id))} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Progress({ current, target, tone }: { current: number; target: number; tone: string }) {
  const pct = Math.min(100, (current / target) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-black/40 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-gray-400 tabular-nums w-14 text-right">{Math.min(current, target)}/{target}</span>
    </div>
  );
}

function ClaimState({ complete, claimed, onClaim }: { complete: boolean; claimed: boolean; onClaim: () => void }) {
  if (claimed) return <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />;
  if (!complete) return <Lock className="w-4 h-4 text-gray-600 shrink-0" />;
  return (
    <button onClick={onClaim} className="shrink-0 h-9 px-3 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 text-black text-xs font-bold active:scale-95 transition-transform animate-pulse-glow">
      Забрать
    </button>
  );
}

function QuestCard({ quest: q, onClaim }: { quest: Quest; onClaim: () => void }) {
  const complete = q.current >= q.target;
  return (
    <div className={`rounded-2xl border p-3 transition-colors ${complete && !q.claimed ? 'border-amber-400/40 bg-amber-950/20' : 'border-white/10 bg-[#161b26]'} ${q.claimed ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-white">{q.title}</h4>
          <p className="text-xs text-gray-400">{q.description}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs">
            {q.rewardGold > 0 && <Currency kind="gold" value={`+${q.rewardGold}`} size={14} className="text-amber-200" />}
            {q.rewardGems > 0 && <Currency kind="gems" value={`+${q.rewardGems}`} size={14} className="text-sky-200" />}
            {(q.rewardStones ?? 0) > 0 && <Currency kind="stones" value={`+${q.rewardStones}`} size={14} className="text-orange-200" />}
            {q.rewardXp > 0 && <span className="text-emerald-300 font-semibold">+{q.rewardXp} опыта</span>}
          </div>
        </div>
        <ClaimState complete={complete} claimed={q.claimed} onClaim={onClaim} />
      </div>
      <div className="mt-2">
        <Progress current={q.current} target={q.target} tone="from-teal-400 to-emerald-400" />
      </div>
    </div>
  );
}

export function AchievementList() {
  const state = useStore(useGame);
  return (
    <div className="space-y-2">
      {state.achievements.map((a) => (
        <AchievementCard key={a.id} ach={a} onClaim={() => useGame.set(claimAchievement(useGame.get(), a.id))} />
      ))}
    </div>
  );
}

function AchievementCard({ ach, onClaim }: { ach: Achievement; onClaim: () => void }) {
  const complete = ach.current >= ach.target;
  return (
    <div className={`rounded-2xl border p-3 ${complete && !ach.claimed ? 'border-amber-400/40 bg-amber-950/20' : 'border-white/10 bg-black/25'}`}>
      <div className="flex items-center gap-3">
        <img src="/ic-trophy.webp" alt="" className={`w-10 h-10 object-contain shrink-0 ${complete ? '' : 'grayscale opacity-50'}`} />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-white">{ach.title}</h4>
          <p className="text-xs text-gray-400">{ach.description}</p>
          <Currency kind="gems" value={`+${ach.rewardGems}`} size={13} className="text-xs text-sky-200 mt-0.5" />
        </div>
        <ClaimState complete={complete} claimed={ach.claimed} onClaim={onClaim} />
      </div>
      <div className="mt-2">
        <Progress current={ach.current} target={ach.target} tone="from-amber-400 to-amber-500" />
      </div>
    </div>
  );
}
