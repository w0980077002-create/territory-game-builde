import { useStore } from '@/game/store';
import { useGame, claimQuest, claimAchievement } from '@/game/actions';
import { captureGameEvent } from '@/game/analytics';
import { CheckCircle2, ChevronRight, Lock } from 'lucide-react';
import type { Achievement, Quest } from '@/game/types';
import { Currency } from './ui/Currency';
import { useLanguage } from '@/game/i18n';
import { SocialQuestsSection } from './SocialQuestsSection';
import { RewardJourney } from './RewardJourney';
import { SocialTrail, type SocialDestination } from './social/SocialTrail';
import type { SocialStatus } from '@/game/socialQuests';
import { getStarterMilestones, shouldShowStarterJourney, type StarterDestination } from '@/game/starterJourney';
import { questAction } from '@/game/eventsBoard';

const SECTIONS: { type: Quest['type']; titleKey: string; hintKey: string }[] = [
  { type: 'daily', titleKey: 'daily', hintKey: 'dailyHint' },
  { type: 'weekly', titleKey: 'weekly', hintKey: 'weeklyHint' },
  { type: 'story', titleKey: 'story', hintKey: 'storyHint' },
];

export function QuestsScreen({ userId, onSocialStatusChange, onNavigate, onSocialNavigate, onMail, onDaily }: { userId: string; onSocialStatusChange: (status: SocialStatus) => void; onNavigate: (screen: StarterDestination) => void; onSocialNavigate: (destination: SocialDestination) => void; onMail: () => void; onDaily: () => void }) {
  const { t, language } = useLanguage();
  const state = useStore(useGame);
  const readyQuests = state.quests.filter((q) => !q.claimed && q.current >= q.target);
  const ready = readyQuests.length;
  const starterSteps = shouldShowStarterJourney(state) ? getStarterMilestones(state) : [];
  const starterDone = starterSteps.filter(step => step.done).length;
  const starterNext = starterSteps.find(step => !step.done);
  // Promote an existing actionable quest when no reward or starter step is
  // already directing the player. This does not create progress or rewards.
  const featuredQuest = !ready && !starterNext
    ? state.quests.find(q => !q.claimed && q.current < q.target && questAction(q, language === 'en'))
    : undefined;
  const claim = (questId: string) => {
    const previous = useGame.get();
    const next = claimQuest(previous, questId);
    if (next !== previous) {
      useGame.set(next);
      captureGameEvent('territory_quest_claim', { screen: 'quests', outcome: 'success' });
    }
  };

  return (
    <div className="viking-screen viking-screen--quests space-y-4 animate-fade-in pb-2">
      <div className="relative rounded-2xl overflow-hidden border border-amber-500/20 p-4">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-900/35 via-[#16130d] to-[#0f1115]" />
        <div className="relative flex items-center gap-3">
          <img src={import.meta.env.BASE_URL + 'ic-quests.webp'} alt="" className="w-12 h-12 object-contain" />
          <div className="flex-1">
            <h2 className="text-lg font-bold text-amber-100">{t('questTitle')}</h2>
            <p className="text-xs text-gray-400">{ready ? `${t('readyToClaim')}: ${ready}` : t('doQuestsForStones')}</p>
          </div>
        </div>
      </div>

      <RewardJourney active="quests" onDaily={onDaily} onMessages={onMail} />

      {ready > 0 && <section aria-label={language === 'en' ? 'Rewards ready' : 'Готовые награды'}>
        <h3 className="mb-2 px-1 text-sm font-bold text-amber-200">{language === 'en' ? 'Rewards ready' : 'Награды готовы'} · {ready}</h3>
        <div className="space-y-2">
          {readyQuests.map(q => <QuestCard key={q.id} quest={q} language={language} t={t} onNavigate={onNavigate} onClaim={() => claim(q.id)} />)}
        </div>
      </section>}

      {starterNext && (
        <section data-testid="quest-hero-path" className="rounded-2xl border-2 border-amber-500/65 bg-gradient-to-br from-[#704322] via-[#442812] to-[#251509] p-3 shadow-[inset_0_2px_12px_rgba(255,194,94,0.14),0_5px_14px_rgba(0,0,0,0.25)]" aria-label={language === 'en' ? 'Hero path' : 'Путь героя'}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-amber-100">🧭 {language === 'en' ? 'Hero path' : 'Путь героя'}</h3>
            <span className="text-xs font-bold text-amber-200 tabular-nums">{starterDone}/4</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/45" role="progressbar" aria-valuenow={starterDone} aria-valuemin={0} aria-valuemax={4}>
            <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-200" style={{ width: `${starterDone * 25}%` }} />
          </div>
          <ol className="mt-2 space-y-1">
            {starterSteps.map((step) => <li key={step.id} className={`flex items-center gap-2 text-xs ${step.done ? 'text-emerald-300' : 'text-slate-200'}`}>
              {step.done ? <CheckCircle2 size={14} className="shrink-0" /> : <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full border border-amber-400/70" />}
              <span>{language === 'en' ? step.titleEn : step.titleRu}</span>
            </li>)}
          </ol>
          <button type="button" onClick={() => onNavigate(starterNext.destination)} className="mt-2 min-h-10 w-full rounded-lg border border-yellow-200/80 bg-gradient-to-b from-yellow-300 via-amber-400 to-amber-600 px-3 py-2 text-sm font-black text-[#40220c] shadow-[0_3px_0_#633c15] active:scale-[0.99]">
            {language === 'en' ? starterNext.actionEn : starterNext.actionRu}
          </button>
          <p className="mt-2 text-[10px] text-amber-100/70">{language === 'en' ? 'Your regular quest rewards are listed below.' : 'Награды за выполненные задания находятся ниже.'}</p>
        </section>
      )}

      {featuredQuest && <section aria-label={language === 'en' ? 'Next quest' : 'Следующее задание'}>
        <h3 className="mb-2 px-1 text-sm font-black text-amber-100">{language === 'en' ? 'Next quest' : 'Следующее задание'}</h3>
        <QuestCard quest={featuredQuest} language={language} t={t} onNavigate={onNavigate} onClaim={() => claim(featuredQuest.id)} featured />
      </section>}

      <SocialTrail active="quests" onNavigate={onSocialNavigate}
        detail={language === 'en' ? 'Verified community quests and your allies' : 'Задания сообщества и твои союзники'} />
      <SocialQuestsSection userId={userId} onStatusChange={onSocialStatusChange} />

      {SECTIONS.map((sec) => {
        const list = state.quests.filter((q) => q.id !== featuredQuest?.id && q.type === sec.type && (q.claimed || q.current < q.target)).sort((left, right) => {
          const priority = (q: Quest) => q.claimed ? 1 : 0;
          return priority(left) - priority(right);
        });
        if (!list.length) return null;
        return (
          <section key={sec.type}>
            <div className="flex items-baseline justify-between px-1 mb-2">
              <h3 className="text-xs font-semibold text-amber-200/80 uppercase tracking-wider">{t(sec.titleKey)}</h3>
              <span className="text-[11px] text-gray-400">{t(sec.hintKey)}</span>
            </div>
            <div className="space-y-2">
              {list.map((q) => (
                <QuestCard key={q.id} quest={q} language={language} t={t} onNavigate={onNavigate} onClaim={() => claim(q.id)} />
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

function ClaimState({ complete, claimed, onClaim, claimLabel }: { complete: boolean; claimed: boolean; onClaim: () => void; claimLabel: string }) {
  if (claimed) return <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />;
  if (!complete) return <Lock className="w-4 h-4 text-gray-600 shrink-0" />;
  return (
    <button onClick={onClaim} className="shrink-0 min-h-11 px-3 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 text-black text-xs font-bold active:scale-95 transition-transform animate-pulse-glow">
      {claimLabel}
    </button>
  );
}

function QuestCard({ quest: q, onClaim, onNavigate, language, t, featured = false }: { quest: Quest; onClaim: () => void; onNavigate: (screen: StarterDestination) => void; language: 'ru' | 'en'; t: (key: string) => string; featured?: boolean }) {
  const complete = q.current >= q.target;
  const action = questAction(q, language === 'en');
  return (
    <div className={`relative rounded-2xl border p-3 transition-colors ${featured ? 'border-amber-400/70 bg-gradient-to-br from-[#694124] to-[#1e2935]' : complete && !q.claimed ? 'border-amber-400/65 bg-amber-950/25 shadow-[0_0_13px_rgba(245,158,11,0.14)]' : !q.claimed ? 'border-sky-400/25 bg-[#161b26]' : 'border-white/10 bg-[#161b26] opacity-60'}`}>
      <div className="flex items-start gap-3">
        {featured && <img src={import.meta.env.BASE_URL + 'ic-quests.webp'} alt="" className="h-16 w-16 shrink-0 object-contain" />}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">{!q.claimed && <span aria-hidden="true" className={`w-2 h-2 shrink-0 rounded-full ${complete ? 'bg-red-500 animate-pulse shadow-[0_0_7px_rgba(239,68,68,0.9)]' : 'bg-sky-400'}`} />}{language === 'en' ? ({ q_daily_1: t('questKill3'), q_daily_2: t('questSpend50'), q_daily_3: t('questGladiator'), q_weekly_1: t('questBoss'), q_story_1: t('questChapters') } as Record<string, string>)[q.id] ?? q.title : q.title}</h4>
          <p className="text-xs text-gray-400">{language === 'en' ? ({ q_daily_1: t('questKill3Desc'), q_daily_2: t('questSpend50Desc'), q_daily_3: t('questGladiatorDesc'), q_weekly_1: t('questBossDesc'), q_story_1: t('questChaptersDesc') } as Record<string, string>)[q.id] ?? q.description : q.description}</p>
          {complete && !q.claimed && <p className="text-[10px] text-amber-300 font-bold mt-1">{language === 'en' ? 'REWARD READY!' : 'НАГРАДА ГОТОВА!'}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs">
            {q.rewardGold > 0 && <Currency kind="gold" value={`+${q.rewardGold}`} size={14} className="text-amber-200" />}
            {q.rewardGems > 0 && <Currency kind="gems" value={`+${q.rewardGems}`} size={14} className="text-sky-200" />}
            {(q.rewardStones ?? 0) > 0 && <Currency kind="stones" value={`+${q.rewardStones}`} size={14} className="text-orange-200" />}
            {q.rewardXp > 0 && <span className="text-emerald-300 font-semibold">+{q.rewardXp} {t('xpWord')}</span>}
          </div>
          {!complete && !q.claimed && action && <button type="button" className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-md border border-sky-400/30 bg-sky-600/15 px-3 py-1 text-xs font-bold text-sky-200" onClick={() => onNavigate(action.destination)}>
            {action.label}<ChevronRight size={13} aria-hidden="true"/>
          </button>}
        </div>
        <ClaimState complete={complete} claimed={q.claimed} onClaim={onClaim} claimLabel={t('claim')} />
      </div>
      <div className="mt-2">
        <Progress current={q.current} target={q.target} tone="from-teal-400 to-emerald-400" />
      </div>
    </div>
  );
}

export function AchievementList() {
  const { language, t } = useLanguage();
  const state = useStore(useGame);
  return (
    <div className="space-y-2">
      {state.achievements.map((a) => (
        <AchievementCard key={a.id} ach={a} language={language} t={t} onClaim={() => {
          const previous = useGame.get();
          const next = claimAchievement(previous, a.id);
          if (next !== previous) {
            useGame.set(next);
            captureGameEvent('territory_quest_claim', { screen: 'quests', outcome: 'success' });
          }
        }} />
      ))}
    </div>
  );
}

function AchievementCard({ ach, onClaim, language, t }: { ach: Achievement; onClaim: () => void; language: 'ru' | 'en'; t: (key: string) => string }) {
  const complete = ach.current >= ach.target;
  return (
    <div className={`rounded-2xl border p-3 ${complete && !ach.claimed ? 'border-amber-400/40 bg-amber-950/20' : 'border-white/10 bg-black/25'}`}>
      <div className="flex items-center gap-3">
        <img src={import.meta.env.BASE_URL + 'ic-trophy.webp'} alt="" className={`w-10 h-10 object-contain shrink-0 ${complete ? '' : 'grayscale opacity-50'}`} />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-white">{language === 'en' ? ({ ach_1: t('achievementFirst'), ach_2: t('achievementFighter'), ach_3: t('achievementChapters'), ach_4: t('achievementBosses'), ach_5: t('achievementRich') } as Record<string, string>)[ach.id] ?? ach.title : ach.title}</h4>
          <p className="text-xs text-gray-400">{language === 'en' ? ({ ach_1: t('achievementFirstDesc'), ach_2: t('achievementFighterDesc'), ach_3: t('achievementChaptersDesc'), ach_4: t('achievementBossesDesc'), ach_5: t('achievementRichDesc') } as Record<string, string>)[ach.id] ?? ach.description : ach.description}</p>
          <Currency kind="gems" value={`+${ach.rewardGems}`} size={13} className="text-xs text-sky-200 mt-0.5" />
        </div>
        <ClaimState complete={complete} claimed={ach.claimed} onClaim={onClaim} claimLabel={t('claim')} />
      </div>
      <div className="mt-2">
        <Progress current={ach.current} target={ach.target} tone="from-amber-400 to-amber-500" />
      </div>
    </div>
  );
}
