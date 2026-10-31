import { MailInbox } from '@/components/home/HomeSheets';
import { RewardJourney } from '@/components/RewardJourney';
import { WoodenPlaque } from '@/components/ui/WoodenPlaque';
import { useLanguage } from '@/game/i18n';

/** Private mailbox. The existing server history and claim flows remain in MailInbox. */
export function MessagesScreen({ notify, onQuests, onDaily }: { notify: (message: string) => void; onQuests: () => void; onDaily: () => void }) {
  const { language } = useLanguage();
  const en = language === 'en';
  return (
    <div className="mx-auto w-full max-w-sm">
      <header className="mb-2 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-950/65 to-slate-900/95 px-2 py-1.5">
        <img src={import.meta.env.BASE_URL + 'ic-mail.webp'} alt="" className="h-12 w-12 shrink-0 object-contain drop-shadow-lg" />
        <div className="min-w-0 flex-1">
          <WoodenPlaque>{en ? 'MAIL' : 'ПОЧТА'}</WoodenPlaque>
          <p className="px-1 text-[10px] leading-tight text-amber-100/75">{en ? 'Letters, gifts and your reward history' : 'Письма, подарки и история наград'}</p>
        </div>
      </header>
      <RewardJourney active="messages" onDaily={onDaily} onQuests={onQuests} />
      <div className="mt-3"><MailInbox notify={notify} /></div>
    </div>
  );
}
