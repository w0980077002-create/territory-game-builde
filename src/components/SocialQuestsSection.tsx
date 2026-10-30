import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Gift, Loader2, UsersRound } from 'lucide-react';
import { Currency } from './ui/Currency';
import { useLanguage } from '@/game/i18n';
import { claimSocial, openSocialLink, socialStatus, type SocialTask, type SocialStatus } from '@/game/socialQuests';
import './socialQuestsBoard.css';

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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    socialStatus().then((result) => {
      if (active) { setStatus(result); onStatusChange?.(result); }
    }).catch(() => {
      if (active) setError(en ? 'Could not load community quests. Your rewards are safe.' : 'Не удалось загрузить задания сообщества. Награды сохранены.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [en, onStatusChange, attempt]);

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
    <section className="social-quests-board space-y-2" data-testid="social-quests-section" aria-busy={loading || !!busy}>
      <h3 className="social-quests-heading flex items-center gap-2 px-3 py-2 text-base font-black uppercase tracking-wide text-amber-100">
        <img src={import.meta.env.BASE_URL + 'ic-quests.webp'} alt="" className="h-8 w-8 shrink-0 object-contain" />
        <span className="min-w-0">{en ? 'Community quests' : 'Задания сообщества'}</span>
      </h3>
      {loading && <p role="status" className="social-quests-feedback">{en ? 'Checking your completed quests…' : 'Проверяем выполненные задания…'}</p>}
      {!loading && !status && <button type="button" onClick={() => setAttempt(n => n + 1)}
        className="social-quest-action social-quest-action--retry w-full font-black">
        {en ? 'Retry loading quests' : 'Повторить загрузку заданий'}
      </button>}
      {cards.map((item) => {
        const claimed = status?.[item.task] ?? false;
        return (
          <div key={item.task} className={'social-quest-card rounded-2xl border p-3 ' + (claimed ? 'social-quest-card--claimed' : '')}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h4 className="flex items-center gap-1.5 text-sm font-black leading-5 text-amber-100">
                  {!claimed && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_7px_rgba(239,68,68,0.8)]" />}
                  {en ? item.en : item.ru}
                </h4>
                <p className="mt-1 text-xs leading-5 text-amber-100/80">{en ? item.enDesc : item.ruDesc}</p>
              </div>
              {claimed && <CheckCircle2 aria-label={en ? 'Completed' : 'Выполнено'} className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <Currency kind="gold" value="+150" size={13} />
                <Currency kind="stones" value="+3" size={13} />
              </div>
              <div className="social-quest-actions flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => openSocialLink(item.task)}
                  className="social-quest-action inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-amber-400/60 bg-[#59351e] px-3 py-2 text-xs font-black text-amber-100">
                  <ExternalLink className="h-3.5 w-3.5" /> {en ? 'Open' : 'Перейти'}
                </button>
                {claimed ? (
                  <span className="social-quest-claimed inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-emerald-900/50 px-3 py-2 text-xs font-bold text-emerald-100">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {en ? 'Claimed' : 'Получено'}
                  </span>
                ) : (
                  <button type="button" onClick={() => void verify(item.task)}
                    disabled={loading || !status || !!busy}
                    className="social-quest-action inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-gradient-to-b from-yellow-300 to-amber-600 px-3 py-2 text-xs font-black text-[#301a0c] disabled:opacity-50">
                    {busy === item.task ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gift className="h-3.5 w-3.5" />}
                    {en ? 'Verify' : 'Проверить'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {error && <p role="alert" className="social-quests-feedback rounded-lg border border-red-400/45 bg-red-950/40 p-3 text-sm text-red-100">{error}</p>}
    </section>
  );
}
