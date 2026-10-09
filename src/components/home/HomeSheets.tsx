import { Check, Cloud, CloudOff } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { DAILY_REWARDS, MAIL, claimDaily, claimMail, dailyStatus, type Reward } from '@/game/progression';
import { Modal } from '@/components/ui/Modal';
import { Currency } from '@/components/ui/Currency';
import { useLive, claimMailGrant, type GrantPayload } from '@/game/live';
import { generateShopItems } from '@/game/engine';
import { useRef, useState } from 'react';

function grantItemsText(p: GrantPayload) {
  const shop = generateShopItems(1);
  return Object.entries(p.items ?? {})
    .filter(([, q]) => q > 0)
    .map(([id, q]) => `${shop.find((s) => s.id === id)?.name ?? id} x${q}`)
    .join(', ');
}

export type SaveStatus = 'saved' | 'saving' | 'error';

function RewardLine({ reward, size = 16 }: { reward: Reward; size?: number }) {
  return (
    <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-xs text-amber-50">
      {!!reward.gold && <Currency kind="gold" value={reward.gold} size={size} />}
      {!!reward.gems && <Currency kind="gems" value={reward.gems} size={size} />}
      {!!reward.redGems && <Currency kind="redGems" value={reward.redGems} size={size} />}
      {!!reward.stones && <Currency kind="stones" value={reward.stones} size={size} />}
    </span>
  );
}

export function DailySheet({ onClose, notify }: { onClose: () => void; notify: (t: string) => void }) {
  const state = useStore(useGame);
  const { claimedToday, dayIndex } = dailyStatus(state);

  const claim = () => {
    const next = claimDaily(useGame.get());
    if (!next) return;
    useGame.set(next);
    notify('Ежедневная награда получена');
  };

  return (
    <Modal title="Ежедневные награды" icon="/ic-daily.webp" onClose={onClose}>
      <p className="text-xs text-gray-400 mb-3 leading-relaxed">Заходи каждый день подряд, чтобы награды росли. Пропуск дня начинает серию заново.</p>
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
              <span className="text-[10px] font-bold text-gray-300">День {i + 1}</span>
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
        {claimedToday ? 'Сегодня уже получено' : `Забрать награду дня ${dayIndex + 1}`}
      </button>
    </Modal>
  );
}

export function MailSheet({ onClose, notify }: { onClose: () => void; notify: (t: string) => void }) {
  const state = useStore(useGame);
  const { mail: adminMail } = useStore(useLive);
  const [claiming, setClaiming] = useState<string | null>(null);

  const claimAdmin = async (id: string) => {
    setClaiming(id);
    const ok = await claimMailGrant(id);
    setClaiming(null);
    notify(ok ? 'Награда из письма получена' : 'Не удалось забрать награду');
  };

  const claim = (id: string) => {
    const next = claimMail(useGame.get(), id);
    if (!next) return;
    useGame.set(next);
    notify('Подарок из письма получен');
  };

  return (
    <Modal title="Почта" icon="/ic-mail.webp" onClose={onClose}>
      <div className="space-y-3">
        {adminMail.map((m) => {
          const extra = grantItemsText(m.payload);
          const reward = { gold: Math.max(0, m.payload.gold ?? 0), gems: Math.max(0, m.payload.gems ?? 0), redGems: Math.max(0, m.payload.redGems ?? 0), stones: Math.max(0, m.payload.stones ?? 0) };
          return (
            <div key={m.id} className="rounded-2xl border border-sky-400/40 bg-sky-500/5 p-3 shadow-[0_0_12px_rgba(56,189,248,0.15)]">
              <div className="text-[11px] text-sky-300/90">Администрация</div>
              <div className="text-sm font-bold text-white mb-1">{m.subject}</div>
              <p className="text-xs text-gray-300 leading-relaxed mb-2.5 whitespace-pre-line break-words">{m.body}</p>
              {extra && <p className="text-[11px] text-amber-200 mb-2">{extra}</p>}
              <div className="flex items-center justify-between gap-2">
                <RewardLine reward={reward} />
                <button
                  onClick={() => claimAdmin(m.id)}
                  disabled={claiming === m.id}
                  className="shrink-0 h-8 px-3 rounded-lg text-xs font-bold bg-sky-400 text-black disabled:opacity-50 transition-colors"
                >
                  {claiming === m.id ? '...' : 'Забрать награду'}
                </button>
              </div>
            </div>
          );
        })}
        {MAIL.map((l) => {
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
                  {claimed ? 'Получено' : 'Забрать'}
                </button>
              </div>
            </div>
          );
        })}
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

export function SettingsSheet({ onClose, saveStatus }: { onClose: () => void; saveStatus: SaveStatus }) {
  const { settings } = useStore(useGame);
  const update = (patch: Partial<typeof settings>) => useGame.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const taps = useRef({ count: 0, last: 0 });

  const secretTap = () => {
    const now = Date.now();
    taps.current.count = now - taps.current.last < 600 ? taps.current.count + 1 : 1;
    taps.current.last = now;
    if (taps.current.count >= 5) window.location.href = '/admin';
  };

  return (
    <Modal title="Настройки" icon="/ic-settings.webp" onClose={onClose}>
      <div className="space-y-2">
        <Toggle label="Скорость боя x2" hint="Ускоряет бои в походе и Испытаниях" on={settings.speed === 2} onChange={() => update({ speed: settings.speed === 2 ? 1 : 2 })} />
        <Toggle label="Автобой" hint="Герой сам выбирает зоны удара и защиты" on={settings.auto} onChange={() => update({ auto: !settings.auto })} />
        <div onClick={secretTap} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm select-none">
          {saveStatus === 'error' ? <CloudOff className="w-4 h-4 text-red-400" /> : <Cloud className={`w-4 h-4 ${saveStatus === 'saving' ? 'text-gray-400 animate-pulse' : 'text-emerald-400'}`} />}
          <span className="text-gray-300">
            {saveStatus === 'error' ? 'Не удалось сохранить, повторим позже' : saveStatus === 'saving' ? 'Сохраняем прогресс...' : 'Прогресс сохранён'}
          </span>
        </div>
      </div>
    </Modal>
  );
}

export function StonesSheet({ onClose, onShop, onDaily }: { onClose: () => void; onShop: () => void; onDaily: () => void }) {
  const stones = useStore(useGame).battleStones;
  return (
    <Modal title="Боевые камни" icon="/battle-stone.webp" onClose={onClose}>
      <div className="flex items-center justify-center gap-2 mb-3">
        <Currency kind="stones" value={stones} size={36} className="text-2xl text-white" />
      </div>
      <p className="text-xs text-gray-400 leading-relaxed mb-3 text-center">
        Каждый бой в походе и в Испытаниях стоит 1 камень. Камни не восстанавливаются сами.
      </p>
      <ul className="text-xs text-gray-300 space-y-1.5 mb-4">
        <li className="rounded-lg bg-black/30 border border-white/10 px-3 py-2">Ежедневная награда за вход</li>
        <li className="rounded-lg bg-black/30 border border-white/10 px-3 py-2">Ежедневные задания</li>
        <li className="rounded-lg bg-black/30 border border-white/10 px-3 py-2">Лавка, раздел «Ресурсы», за синие кристаллы</li>
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onDaily} className="btn-ghost">Награда дня</button>
        <button onClick={onShop} className="btn-primary">В Лавку</button>
      </div>
    </Modal>
  );
}
