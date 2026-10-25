import { Check, Cloud, CloudOff } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { DAILY_REWARDS, MAIL, claimDaily, claimMail, dailyStatus, type Reward } from '@/game/progression';
import { Modal } from '@/components/ui/Modal';
import { Currency } from '@/components/ui/Currency';
import { ItemArt } from '@/components/ui/ItemArt';
import { useLive, claimMailGrant, getClaimedMailHistory, type ClaimedMailGrant } from '@/game/live';
import { generateShopItems } from '@/game/engine';
import { mailRewardVisuals } from '@/game/mailRewardVisuals';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage, localizeText } from '@/game/i18n';

export type SaveStatus = 'saved' | 'saving' | 'error';

const LARGE_HEALTH_POTION = generateShopItems(1).find((item) => item.id === 'shop_potion_hp_large');

function RewardLine({ reward, size = 16 }: { reward: Reward; size?: number }) {
  const { language } = useLanguage();
  return (
    <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-xs text-amber-50">
      {!!reward.gold && <Currency kind="gold" value={reward.gold} size={size} />}
      {!!reward.gems && <Currency kind="gems" value={reward.gems} size={size} />}
      {!!reward.redGems && <Currency kind="redGems" value={reward.redGems} size={size} />}
      {!!reward.largeHealthPotions && LARGE_HEALTH_POTION && (
        <span className="inline-flex items-center gap-0.5 font-semibold" title={localizeText(LARGE_HEALTH_POTION.name, language)}>
          <ItemArt item={LARGE_HEALTH_POTION} size={size + 3} />
          ×{reward.largeHealthPotions}
        </span>
      )}
      {!!reward.stones && <Currency kind="stones" value={reward.stones} size={size} />}
    </span>
  );
}

export function DailySheet({ onClose, notify }: { onClose: () => void; notify: (t: string) => void }) {
  const { t, language } = useLanguage();
  const state = useStore(useGame);
  const { claimedToday, dayIndex } = dailyStatus(state);

  const claim = () => {
    const next = claimDaily(useGame.get());
    if (!next) return;
    useGame.set(next);
    notify(language === 'en' ? 'Daily reward claimed' : 'Ежедневная награда получена');
  };

  return (
    <Modal title={t('dailyRewards')} icon="/ic-daily.webp" onClose={onClose}>
      <p className="text-xs text-gray-400 mb-3 leading-relaxed">{t('dailyRewardsHint')}</p>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {DAILY_REWARDS.map((r, i) => {
          const done = claimedToday ? i <= dayIndex : i < dayIndex;
          const current = i === dayIndex && !claimedToday;
          return (
            <div
              key={i}
              className={`relative rounded-xl border p-1.5 flex flex-col items-center gap-1 min-h-[76px] ${
                i === 6 ? 'col-span-2' : ''
              } ${current ? 'border-amber-400/80 bg-amber-500/10 shadow-[0_0_12px_rgba(251,191,36,0.25)]' : done ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-black/30'}`}
            >
              <span className="text-[10px] font-bold text-gray-300">{t('day')} {i + 1}</span>
              <RewardLine reward={r} size={14} />
              {done && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </span>
              )}
            </div>
          );
        })}
      </div>
      <button onClick={claim} disabled={claimedToday} className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed">
        {claimedToday ? t('alreadyClaimedToday') : `${t('claimDayReward')} ${dayIndex + 1}`}
      </button>
    </Modal>
  );
}

export function MailSheet({ onClose, notify }: { onClose: () => void; notify: (t: string) => void }) {
  const { t, language } = useLanguage();
  const state = useStore(useGame);
  const { mail: adminMail } = useStore(useLive);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [tab, setTab] = useState<'new' | 'received'>('new');
  const [history, setHistory] = useState<ClaimedMailGrant[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const historyRequest = useRef(0);

  const loadHistory = useCallback(async (offset = 0) => {
    const request = ++historyRequest.current;
    setHistoryLoading(true);
    setHistoryError(false);
    try {
      const result = await getClaimedMailHistory(offset);
      if (request !== historyRequest.current) return;
      setHistory((previous) => offset === 0 ? result.letters : [
        ...previous,
        ...result.letters.filter((letter) => !previous.some((old) => old.id === letter.id)),
      ]);
      setHistoryHasMore(result.hasMore);
    } catch {
      if (request === historyRequest.current) setHistoryError(true);
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    return () => { historyRequest.current += 1; };
  }, [loadHistory]);

  const claimAdmin = async (id: string) => {
    setClaiming(id);
    try {
      const ok = await claimMailGrant(id);
      if (ok) {
        setTab('received');
        void loadHistory();
      }
      notify(ok ? t('claimLetterRewardOk') : t('claimLetterRewardFail'));
    } catch {
      notify(t('claimLetterRewardFail'));
    } finally {
      setClaiming(null);
    }
  };

  const claim = (id: string) => {
    const next = claimMail(useGame.get(), id);
    if (!next) return;
    useGame.set(next);
    setTab('received');
    notify(language === 'en' ? 'Mail gift claimed' : 'Подарок из письма получен');
  };

  const received = tab === 'received';
  const shownAdminMail = received ? history : adminMail;
  const shownGameMail = MAIL.filter((letter) => state.mailClaimed.includes(letter.id) === received);
  const newCount = adminMail.length + MAIL.filter((letter) => !state.mailClaimed.includes(letter.id)).length;

  return (
    <Modal title={t('mail')} icon="/ic-mail.webp" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label={language === 'en' ? 'Mail folders' : 'Разделы почты'}>
          <button type="button" role="tab" aria-selected={!received} onClick={() => setTab('new')}
            className={`rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${!received ? 'border-sky-400/60 bg-sky-500/20 text-sky-100' : 'border-white/10 bg-black/20 text-gray-400'}`}>
            {language === 'en' ? 'New' : 'Новые'} {newCount > 0 ? `(${newCount})` : ''}
          </button>
          <button type="button" role="tab" aria-selected={received} onClick={() => setTab('received')}
            className={`rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${received ? 'border-sky-400/60 bg-sky-500/20 text-sky-100' : 'border-white/10 bg-black/20 text-gray-400'}`}>
            {language === 'en' ? 'Received' : 'Полученные'}
          </button>
        </div>
        {received && historyLoading && history.length === 0 && (
          <p className="py-4 text-center text-sm text-gray-400">{t('loading')}</p>
        )}
        {received && historyError && (
          <div className="rounded-xl border border-red-400/25 bg-red-500/10 p-3 text-center text-sm text-red-200">
            <p>{language === 'en' ? 'Could not load mail history.' : 'Не удалось загрузить историю писем.'}</p>
            <button type="button" className="mt-2 text-sky-300 underline" onClick={() => void loadHistory(history.length)}>
              {language === 'en' ? 'Try again' : 'Повторить'}
            </button>
          </div>
        )}
        {shownAdminMail.map((m) => {
          const rewards = mailRewardVisuals(m.payload);
          return (
            <div key={m.id} className={`rounded-2xl border p-3 ${received ? 'border-white/15 bg-black/20' : 'border-sky-400/40 bg-sky-500/5 shadow-[0_0_12px_rgba(56,189,248,0.15)]'}`}>
              <div className={`text-[11px] ${received ? 'text-gray-400' : 'text-sky-300/90'}`}>{t('administration')}</div>
              <div className="text-sm font-bold text-white mb-1">{m.subject}</div>
              <p className="text-xs text-gray-300 leading-relaxed mb-2.5 whitespace-pre-line break-words">{m.body}</p>
              {received && <p className="mb-2 text-[10px] text-gray-500">
                {language === 'en' ? 'Claimed' : 'Получено'}: {new Date((m as ClaimedMailGrant).claimed_at).toLocaleDateString(language === 'en' ? 'en-US' : 'ru-RU')}
              </p>}
              <div className="flex flex-wrap items-end justify-between gap-2">
                {rewards.length > 0 && (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" aria-label={language === 'en' ? 'Mail rewards' : 'Награды письма'}>
                    {rewards.map((reward) => {
                      const name = language === 'en' ? reward.nameEn : reward.name;
                      return (
                        <span
                          key={reward.key}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300/15 bg-black/20 px-1.5 py-1 text-xs font-bold text-amber-50 tabular-nums"
                          title={name}
                          aria-label={`${name}: ${reward.amount}`}
                        >
                          <img src={import.meta.env.BASE_URL + reward.image} alt="" width={22} height={22} className="h-[22px] w-[22px] shrink-0 object-contain" />
                          <span>×{reward.amount.toLocaleString(language === 'en' ? 'en-US' : 'ru-RU')}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                {received ? (
                  <span className="shrink-0 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-gray-400">✓ {t('claimed')}</span>
                ) : (
                  <button
                    onClick={() => void claimAdmin(m.id)}
                    disabled={claiming === m.id}
                    className="shrink-0 h-8 px-3 rounded-lg text-xs font-bold bg-sky-400 text-black disabled:opacity-50 transition-colors"
                  >
                    {claiming === m.id ? '...' : t('claimReward')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {shownGameMail.map((l) => {
          const claimed = state.mailClaimed.includes(l.id);
          return (
            <div key={l.id} className={`rounded-2xl border p-3 ${claimed ? 'border-white/5 bg-black/20 opacity-70' : 'border-amber-500/25 bg-black/30'}`}>
              <div className="text-[11px] text-amber-300/80">{l.from}</div>
              <div className="text-sm font-bold text-white mb-1">{l.title}</div>
              <p className="text-xs text-gray-400 leading-relaxed mb-2.5">{l.body}</p>
              <div className="flex items-center justify-between gap-2">
                <RewardLine reward={l.reward} />
                <button
                  onClick={() => claim(l.id)}
                  disabled={claimed}
                  className="shrink-0 h-8 px-3 rounded-lg text-xs font-bold bg-amber-500 text-black disabled:bg-white/10 disabled:text-gray-400 transition-colors"
                >
                  {claimed ? t('claimed') : t('claim')}
                </button>
              </div>
            </div>
          );
        })}
        {received && historyHasMore && !historyLoading && !historyError && (
          <button type="button" className="btn-ghost w-full text-sm" onClick={() => void loadHistory(history.length)}>
            {language === 'en' ? 'Show more letters' : 'Показать ещё письма'}
          </button>
        )}
        {received && historyLoading && history.length > 0 && <p className="text-center text-xs text-gray-400">{t('loading')}</p>}
        {!historyLoading && !historyError && shownAdminMail.length === 0 && shownGameMail.length === 0 && (
          <p className="py-5 text-center text-sm text-gray-400">
            {received
              ? (language === 'en' ? 'No received letters yet.' : 'Полученных писем пока нет.')
              : (language === 'en' ? 'No new letters.' : 'Новых писем нет.')}
          </p>
        )}
      </div>
    </Modal>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className="w-full flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-left">
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="block text-[11px] text-gray-400">{hint}</span>
      </span>
      <span className={`w-11 h-6 rounded-full p-0.5 transition-colors ${on ? 'bg-amber-500' : 'bg-white/15'}`}>
        <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}

export function SettingsSheet({ onClose, saveStatus, cityMotion, onToggleCityMotion }: { onClose: () => void; saveStatus: SaveStatus; cityMotion: boolean; onToggleCityMotion: () => void }) {
  const { t, language } = useLanguage();
  const { settings } = useStore(useGame);
  const update = (patch: Partial<typeof settings>) => useGame.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const taps = useRef({ count: 0, last: 0 });

  const secretTap = () => {
    const now = Date.now();
    taps.current.count = now - taps.current.last < 600 ? taps.current.count + 1 : 1;
    taps.current.last = now;
    if (taps.current.count >= 5) {
      // GitHub Pages hosts this mini-app under /territory-game-builde/.
      // A root-level /admin path is a GitHub 404. Keep the current path
      // and use the admin hash supported by src/main.tsx instead.
      window.location.hash = 'admin';
      window.location.reload();
    }
  };

  return (
    <Modal title={t('settings')} icon="/ic-settings.webp" onClose={onClose}>
      <div className="space-y-2">
        <Toggle label={t('battleSpeed')} hint={t('speedHint')} on={settings.speed === 2} onChange={() => update({ speed: settings.speed === 2 ? 1 : 2 })} />
        <Toggle label={t('autoBattle')} hint={t('autoBattleHint')} on={settings.auto} onChange={() => update({ auto: !settings.auto })} />
        <Toggle label={language === 'en' ? 'Living city' : 'Живой город'} hint={language === 'en' ? 'Animated ships, waterfalls and fire. Disable to save battery.' : 'Движение кораблей, водопадов и огня. Можно отключить для экономии заряда.'} on={cityMotion} onChange={onToggleCityMotion} />
        <div onClick={secretTap} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm select-none">
          {saveStatus === 'error' ? <CloudOff className="w-4 h-4 text-red-400" /> : <Cloud className={`w-4 h-4 ${saveStatus === 'saving' ? 'text-gray-400 animate-pulse' : 'text-emerald-400'}`} />}
          <span className="text-gray-300">
            {saveStatus === 'error' ? t('saveRetry') : saveStatus === 'saving' ? t('savingProgress') : t('progressSaved')}
          </span>
        </div>
      </div>
    </Modal>
  );
}

export function StonesSheet({ onClose, onShop, onDaily }: { onClose: () => void; onShop: () => void; onDaily: () => void }) {
  const { t } = useLanguage();
  const stones = useStore(useGame).battleStones;
  return (
    <Modal title={t('battleStones')} icon="/battle-stone.webp" onClose={onClose}>
      <div className="flex items-center justify-center gap-2 mb-3">
        <Currency kind="stones" value={stones} size={36} className="text-2xl text-white" />
      </div>
      <p className="text-xs text-gray-400 leading-relaxed mb-3 text-center">
        {t('stonesExplain')}
      </p>
      <ul className="text-xs text-gray-300 space-y-1.5 mb-4">
        <li className="rounded-lg bg-black/30 border border-white/10 px-3 py-2">{t('dailyLoginReward')}</li>
        <li className="rounded-lg bg-black/30 border border-white/10 px-3 py-2">{t('dailyQuests')}</li>
        <li className="rounded-lg bg-black/30 border border-white/10 px-3 py-2">{t('shopResources')}</li>
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onDaily} className="btn-ghost">{t('dailyRewardButton')}</button>
        <button onClick={onShop} className="btn-primary">{t('toShop')}</button>
      </div>
    </Modal>
  );
}
