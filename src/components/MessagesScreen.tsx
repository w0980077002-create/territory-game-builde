import { MailInbox } from '@/components/home/HomeSheets';

/** The player's private mailbox lives in its own section, off the city HUD. */
export function MessagesScreen({ notify }: { notify: (message: string) => void }) {
  return (
    <div className="mx-auto w-full max-w-sm">
      <MailInbox notify={notify} />
    </div>
  );
}
