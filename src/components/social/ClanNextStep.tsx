import { useLanguage } from '@/game/i18n';
import type { ClanState } from '@/game/clanApi';
import { Gift, ScrollText, Send, Swords } from 'lucide-react';

type ClanProgress = Pick<ClanState, 'pending_boss_rewards' | 'quests' | 'boss' | 'boss_attacks_left' | 'boss_claimed' | 'my_boss_damage'>;
type ClanStep = { target: 'clan-boss-rewards' | 'clan-quests' | 'clan-boss' | 'clan-chat'; ru: string; en: string; actionRu: string; actionEn: string; icon: 'gift' | 'quest' | 'boss' | 'chat' };

/** Read-only priority derived exclusively from server-returned clan state. */
export function getClanNextStep(state: ClanProgress): ClanStep {
  if (state.pending_boss_rewards.length > 0) {
    return { target: 'clan-boss-rewards', ru: 'Есть награда за босса', en: 'Boss reward is ready',
      actionRu: 'К наградам', actionEn: 'View rewards', icon: 'gift' };
  }
  if (state.boss && state.boss.hp <= 0 && !state.boss_claimed && state.my_boss_damage > 0) {
    return { target: 'clan-boss', ru: 'Победа над боссом подтверждена', en: 'Boss defeated — reward available',
      actionRu: 'Забрать награду', actionEn: 'Claim reward', icon: 'gift' };
  }
  if (state.quests.some(q => !q.claimed && q.progress >= q.target && q.member >= q.member_req)) {
    return { target: 'clan-quests', ru: 'Клановое задание выполнено', en: 'Clan quest completed',
      actionRu: 'Забрать награду', actionEn: 'Claim quest', icon: 'quest' };
  }
  if (state.boss && state.boss.hp > 0 && state.boss_attacks_left > 0) {
    return { target: 'clan-boss', ru: 'Можно атаковать кланового босса', en: 'Clan boss can be attacked',
      actionRu: 'К боссу', actionEn: 'Go to boss', icon: 'boss' };
  }
  return { target: 'clan-chat', ru: 'Обсуди следующий поход с кланом', en: 'Plan the next raid with your clan',
    actionRu: 'Открыть чат', actionEn: 'Open chat', icon: 'chat' };
}

export function ClanNextStep({ state, onJump }: { state: ClanProgress; onJump: (target: ClanStep['target']) => void }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const step = getClanNextStep(state);
  const Icon = step.icon === 'gift' ? Gift : step.icon === 'quest' ? ScrollText : step.icon === 'boss' ? Swords : Send;
  return (
    <section data-testid="clan-next-step" className="rounded-2xl border-2 border-amber-400/60 bg-gradient-to-br from-[#704326] via-[#4b2c19] to-[#25180e] p-3 shadow-[inset_0_1px_0_#ffe4a955,0_4px_12px_#10080366]">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-300/60 bg-amber-950/50"><Icon className="h-6 w-6 text-amber-200" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-200/85">{en ? 'Next clan action' : 'Следующее дело клана'}</p>
          <p className="text-sm font-black leading-snug text-white">{en ? step.en : step.ru}</p>
        </div>
      </div>
      <button type="button" onClick={() => onJump(step.target)}
        className="mt-2.5 flex min-h-11 w-full items-center justify-center rounded-xl border border-yellow-100/75 bg-gradient-to-b from-yellow-300 to-amber-600 px-3 py-2 text-sm font-black text-[#40220c] active:scale-[0.99]">
        {en ? step.actionEn : step.actionRu}
      </button>
    </section>
  );
}
