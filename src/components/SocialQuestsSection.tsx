import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Gift, Loader2, UsersRound } from 'lucide-react';
import { Currency } from './ui/Currency';
import { useLanguage } from '@/game/i18n';
import { claimSocial, openSocialLink, socialStatus, SOCIAL_LINKS, type SocialTask, type SocialStatus } from '@/game/socialQuests';

const cards: { task: SocialTask; ru: string; en: string; ruDesc: string; enDesc: string }[] = [
  { task: 'chat', ru: 'Вступить в чат TERRITORY', en: 'Join TERRITORY Chat',
    ruDesc: 'Подпишись на игровой чат', enDesc: 'Join the official game chat' },
  { task: 'news', ru: 'Подписаться на TerritoryNews', en: 'Follow TerritoryNews',
    ruDesc: 'Подпишись на новостной канал', enDesc: 'Subscribe to our news channel' },
];

export function SocialQuestsSection({ userId, onStatusChange }: { userId: string; onStatusChange?: (next: SocialStatus) => void }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [status, setStatus] = useState<SocialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<SocialTask | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    socialStatus().then((result) => { if (active) { setStatus(result); onStatusChange?.(result); } })
      .catch(() => { if (active) setError(en ? 'Restart to load community quests.' : 'Перезапусти игру, чтобы загрузить задания.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [en, onStatusChange]);

  async function verify(task: SocialTask) {
    if (busy || !status || status[task]) return;
    setBusy(task);
    setError('');
    try {
      await claimSocial(userId, task);
      const updated = { ...status, [task]: true };
      setStatus(updated);
      onStatusChange?.(updated);
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(code === 'not_subscribed'
        ? (en ? 'Join first, then tap Verify.' : 'Сначала подпишись, затем нажми «Проверить».')
        : code === 'membership_check_unavailable' || code === 'bot_token_not_configured'
          ? (en ? 'Subscription check unavailable: bot needs admin rights in the group/channel.'
            : 'Проверка подписки недоступна: боту нужны права администратора в чате и канале.')
          : code === 'already_claimed'
            ? (en ? 'Reward already claimed. Restart the game.' : 'Награда уже получена. Перезапусти игру.')
            : (en ? 'Unable to claim. Restart and try again.' : 'Не удалось получить награду. Перезапусти игру и повтори.'));
    } finally { setBusy(null); }
  }

  return (
    <section className="space-y-2" data-testid="social-quests-section">
      <h3 className="flex items-center gap-2 px-1 text-sm font-bold uppercase tracking-wider text-amber-200">
        <UsersRound className="w-4 h-4" /> {en ? 'Community quests' : 'Задания сообщества'}
      </h3>
      {cards.map((item) => {
        const claimed = status?.[item.task] ?? false;
        return (
          <div key={item.task} className={`rounded-2xl border p-3 ${claimed ? 'border-emerald-400/40 bg-emerald-950/20' : 'border-amber-400/30 bg-[#161b26]'}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold leading-5 text-white">
                  {!claimed && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_7px_rgba(239,68,68,0.8)]" />}
                  {en ? item.en : item.ru}
                </h4>
                <p className="mt-0.5 text-xs leading-4 text-gray-400">{en ? item.enDesc : item.ruDesc}</p>
              </div>
              {claimed && <CheckCircle2 aria-label={en ? 'Completed' : 'Выполнено'} className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <Currency kind="gold" value="+150" size={13} />
                <Currency kind="stones" value="+3" size={13} />
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => openSocialLink(item.task)}
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-sky-400/40 bg-sky-900/50 px-2 text-[11px] font-bold text-sky-100">
                  <ExternalLink className="h-3.5 w-3.5" /> {en ? 'Open' : 'Перейти'}
                </button>
                {claimed ? (
                  <span className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-amber-500/20 px-2 text-[11px] font-semibold text-amber-200">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {en ? 'Claimed' : 'Получено'}
                  </span>
                ) : (
                  <button type="button" onClick={() => void verify(item.task)}
                    disabled={loading || !status || !!busy}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-gradient-to-b from-amber-400 to-amber-600 px-2 text-[11px] font-bold text-black disabled:opacity-50">
                    {busy === item.task ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gift className="h-3.5 w-3.5" />}
                    {en ? 'Verify' : 'Проверить'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {error && <p role="alert" className="p-2 rounded-lg bg-red-950/40 text-red-200 text-xs">{error}</p>}
    </section>
  );
}
