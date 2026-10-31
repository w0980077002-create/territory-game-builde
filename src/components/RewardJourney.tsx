import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { useLive } from '@/game/live';
import { DAILY_REWARDS, MAIL, dailyStatus } from '@/game/progression';
import { useLanguage } from '@/game/i18n';

type Destination = 'daily' | 'quests' | 'messages';

interface Props {
  active: 'quests' | 'messages';
  onDaily: () => void;
  onQuests?: () => void;
  onMessages?: () => void;
}

/** One read-only overview of three EXISTING reward sources.
 * All claims remain in DailySheet, QuestsScreen and MailInbox.
 * No client-side grant, invented reward, or new persistence format.
 */
export function RewardJourney({ active, onDaily, onQuests, onMessages }: Props) {
  const { language } = useLanguage();
  const en = language === 'en';
  const state = useStore(useGame);
  const liveMail = useStore(useLive).mail;
  const { claimedToday, dayIndex } = dailyStatus(state);
  const pendingQuests = state.quests.filter(q => !q.claimed && q.current >= q.target).length;
  const pendingMail = liveMail.length + MAIL.filter(m => !state.mailClaimed.includes(m.id)).length;
  const currentGift = DAILY_REWARDS[dayIndex];
  const next: Destination | null = !claimedToday ? 'daily'
    : pendingQuests > 0 ? 'quests'
    : pendingMail > 0 ? 'messages'
    : null;
  const destinations: { id: Destination; art: string; title: string; status: string; action?: () => void }[] = [
    {
      id: 'daily', art: 'ic-daily.webp',
      title: en ? 'Daily gift' : 'Подарок дня',
      status: claimedToday ? (en ? 'Collected' : 'Получен') : (en ? 'Ready' : 'Готов'),
      action: onDaily,
    },
    {
      id: 'quests', art: 'ic-quests.webp',
      title: en ? 'Quests' : 'Задания',
      status: pendingQuests > 0 ? String(pendingQuests) + (en ? ' ready' : ' готово') : (en ? 'No claims' : 'Нет наград'),
      action: active === 'quests' ? undefined : onQuests,
    },
    {
      id: 'messages', art: 'ic-mail.webp',
      title: en ? 'Mail' : 'Почта',
      status: pendingMail > 0 ? String(pendingMail) + (en ? ' new' : ' новых') : (en ? 'No new mail' : 'Нет новых'),
      action: active === 'messages' ? undefined : onMessages,
    },
  ];
  return (
    <section data-testid="reward-journey" className="rounded-2xl border-2 border-amber-500/70 bg-gradient-to-br from-[#704625] via-[#442a19] to-[#23170f] p-2.5 text-amber-50 shadow-[inset_0_1px_0_#ffe1a066,0_5px_14px_#10090477]"
      aria-label={en ? 'Your reward journey' : 'Путь наград'}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="min-w-0 text-sm font-black text-amber-100">{en ? 'Your reward journey' : 'Твой путь наград'}</h3>
        <span className="shrink-0 rounded-md border border-amber-400/40 bg-black/30 px-2 py-1 text-[10px] font-bold text-amber-200">
          {en ? 'Day' : 'День'} {dayIndex + 1}/{DAILY_REWARDS.length}
        </span>
      </div>
      <p className="mb-2 text-[11px] leading-snug text-amber-100/85" data-testid="reward-journey-next">
        {next === 'daily' ? (en ? 'Your daily gift is waiting.' : 'Тебя ждёт ежедневный подарок.')
          : next === 'quests' ? (en ? 'Claim the quests you completed.' : 'Забери награды выполненных заданий.')
          : next === 'messages' ? (en ? 'Open your unread letters.' : 'Открой непрочитанные письма.')
          : (en ? 'All current rewards collected. Keep exploring!' : 'Все доступные награды собраны. Продолжай приключение!')}
      </p>
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={en ? 'Reward destinations' : 'Разделы наград'}>
        {destinations.map(item => (
          <button key={item.id} type="button" data-testid={`reward-journey-${item.id}`}
            onClick={item.action} disabled={!item.action} aria-current={active === item.id ? 'page' : undefined}
            className={`flex min-h-[88px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-1.5 text-center transition-transform active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 ${active === item.id ? 'border-amber-200 bg-amber-500/20' : 'border-amber-500/45 bg-black/25'} disabled:cursor-default`}>
            <img src={import.meta.env.BASE_URL + item.art} alt="" className="h-9 w-9 shrink-0 object-contain drop-shadow-md" loading="lazy" />
            <span className="w-full break-words text-[11px] font-black leading-tight text-amber-50">{item.title}</span>
            <span className="w-full break-words text-[10px] leading-tight text-amber-200">{item.status}</span>
          </button>
        ))}
      </div>
      {currentGift && <p className="mt-2 text-center text-[10px] text-amber-100/70">
        {en ? 'Daily rewards and letters are collected only in their original screens.' : 'Подарки и письма выдаются только в действующих разделах игры.'}
      </p>}
    </section>
  );
}
