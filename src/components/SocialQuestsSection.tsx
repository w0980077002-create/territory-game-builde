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

export function SocialQuestsSection({ userId }: { userId: string }) {
  const { language } = useLanguage();
  const en = language === 'en';
  const [status, setStatus] = useState<SocialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<SocialTask | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    socialStatus().then((result) => { if (active) setStatus(result); })
      .catch(() => { if (active) setError(en ? 'Restart to load community quests.' : 'Перезапусти игру, чтобы загрузить задания.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [en]);

  async function verify(task: SocialTask) {
    if (busy || !status || status[task]) return;
    setBusy(task);
    setError('');
    try {
      await claimSocial(userId, task);
      setStatus((prev) => prev ? { ...prev, [task]: true } : prev);
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
      <p className="px-1 text-xs text-gray-400">
        {en ? 'Each verified subscription: 150 gold + 3 battle stones. Once per player.'
          : 'За каждую подтверждённую подписку: 150 золота и 3 боевых камня. Один раз для игрока.'}
      </p>
      {cards.map((item) => {
        const claimed = status?.[item.task] ?? false;
        return (
          <div key={item.task} className={`rounded-2xl border p-3 ${claimed ? 'border-emerald-400/40 bg-emerald-950/20' : 'border-amber-400/30 bg-[#161b26]'}`}>
            <div className="flex gap-3 items-start">
              <Gift className="w-6 h-6 shrink-0 text-amber-300" />
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-white">{en ? item.en : item.ru}</h4>
                <p className="text-xs text-gray-400 mt-1">{en ? item.enDesc : item.ruDesc}</p>
                <p className="text-xs text-sky-300 mt-1 truncate">{SOCIAL_LINKS[item.task].replace('https://', '')}</p>
                <div className="flex gap-3 mt-2">
                  <Currency kind="gold" value="+150" size={15} />
                  <Currency kind="stones" value="+3" size={15} />
                </div>
              </div>
              {claimed && <CheckCircle2 className="w-6 h-6 text-emerald-400" />}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button type="button" onClick={() => openSocialLink(item.task)}
                className="h-10 rounded-xl border border-sky-400/40 bg-sky-900/50 text-sky-100 text-xs font-bold flex items-center justify-center gap-1">
                <ExternalLink className="w-4 h-4" /> {en ? 'Open' : 'Перейти'}
              </button>
              <button type="button" onClick={() => void verify(item.task)}
                disabled={loading || !status || !!busy || claimed}
                className="h-10 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 text-black text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1">
                {busy === item.task ? <Loader2 className="w-4 h-4 animate-spin" /> : claimed ? <CheckCircle2 className="w-4 h-4" /> : <Gift className="w-4 h-4" />}
                {claimed ? (en ? 'Claimed' : 'Получено') : (en ? 'Verify & claim' : 'Проверить')}
              </button>
            </div>
          </div>
        );
      })}
      {error && <p role="alert" className="p-2 rounded-lg bg-red-950/40 text-red-200 text-xs">{error}</p>}
    </section>
  );
}
