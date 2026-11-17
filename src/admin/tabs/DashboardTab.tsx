import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Activity, Bot, CalendarDays, Clock3, DollarSign, RefreshCw, Settings2, Users, Wifi, UserPlus } from 'lucide-react';
import { adminCall, type Settings } from '@/admin/api';
import { ErrorLine, Loading, Panel, Switch, fmt, type Confirm } from '@/admin/ui';

interface CommunityHumorStatus {
  monitoringEnabled: boolean;
  groupSelected: boolean;
  humorEnabled: boolean;
  mode: 'mentions' | 'lively';
  sentToday: number;
  aiConfigured: boolean;
}

interface Stats {
  totalPlayers: number;
  onlinePlayers: number;
  todayPlayers: number;
  weekPlayers: number;
  newTodayPlayers: number;
  newWeekPlayers: number;
  todayPurchasesUsd: number;
  settings: Settings;
}

function StatCard({ label, value, icon, tone }: { label: string; value: string; icon: ReactNode; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-3 sm:p-4">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 ${tone}`}>{icon}</div>
      <div className="text-xl sm:text-2xl font-bold text-white tabular-nums">{value}</div>
      <div className="text-[11px] sm:text-xs text-slate-400 leading-tight">{label}</div>
    </div>
  );
}

export function DashboardTab({ confirm }: { confirm: Confirm }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [community, setCommunity] = useState<CommunityHumorStatus | null>(null);
  const [communityError, setCommunityError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    adminCall<Stats>('stats').then(setStats).catch((e: Error) => setError(e.message));
    adminCall<CommunityHumorStatus>('community_humor_status')
      .then((v) => { setCommunity(v); setCommunityError(null); })
      .catch((e: Error) => setCommunityError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = (key: keyof Settings, label: string) => {
    if (!stats) return;
    const value = !stats.settings[key];
    confirm(`${value ? 'Включить' : 'Выключить'}: ${label}`, async () => {
      const r = await adminCall<{ settings: Settings }>('set_setting', { key, value });
      setStats((s) => (s ? { ...s, settings: r.settings } : s));
      return `${label}: ${value ? 'включено' : 'выключено'}`;
    });
  };

  if (!stats) return error ? <ErrorLine text={error} /> : <Loading />;
  const s = stats.settings;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <StatCard label="Всего игроков" value={fmt(stats.totalPlayers)} icon={<Users className="w-5 h-5 text-sky-300" />} tone="bg-sky-500/15" />
        <StatCard label="Сейчас (5 мин)" value={fmt(stats.onlinePlayers)} icon={<Wifi className="w-5 h-5 text-emerald-300" />} tone="bg-emerald-500/15" />
        <StatCard label="Заходили сегодня" value={fmt(stats.todayPlayers)} icon={<Clock3 className="w-5 h-5 text-cyan-300" />} tone="bg-cyan-500/15" />
        <StatCard label="Заходили за 7 дней" value={fmt(stats.weekPlayers)} icon={<CalendarDays className="w-5 h-5 text-violet-300" />} tone="bg-violet-500/15" />
        <StatCard label="Новых сегодня" value={fmt(stats.newTodayPlayers)} icon={<UserPlus className="w-5 h-5 text-emerald-300" />} tone="bg-emerald-500/15" />
        <StatCard label="Новых за 7 дней" value={fmt(stats.newWeekPlayers)} icon={<UserPlus className="w-5 h-5 text-sky-300" />} tone="bg-sky-500/15" />
        <StatCard label="Покупки сегодня" value={`$${stats.todayPurchasesUsd.toFixed(2)}`} icon={<DollarSign className="w-5 h-5 text-amber-300" />} tone="bg-amber-500/15" />
      </div>
      <p className="text-[11px] text-slate-400">Сегодня — с 00:00 UTC; 7 дней — последние 168 часов. Новые регистрации — вкладка «Новые игроки», посещения — «Игроки & Онлайн».</p>
      <ErrorLine text={error} />

      <Panel title="Управление игрой" icon={<Settings2 className="w-4 h-4" />} right={
        <button onClick={load} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors" aria-label="Обновить"><RefreshCw className="w-4 h-4" /></button>
      }>
        <div className="space-y-2">
          <Switch
            label="Режим техработ"
            hint="Игра закроется для всех плашкой «Идут технические работы». Вы, как админ, сможете зайти с этого устройства."
            on={s.maintenance}
            tone="red"
            onToggle={() => toggle('maintenance', 'Режим техработ')}
          />
          {s.maintenance && (
            <p className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">
              <Activity className="w-4 h-4 shrink-0" /> Игра сейчас закрыта для игроков
            </p>
          )}
        </div>
      </Panel>

      <Panel title="ИИ-бот игрового чата" icon={<Bot className="w-4 h-4" />}>
        <div className="space-y-3">
          {communityError && <ErrorLine text={communityError} />}
          {community && <>
            <Switch
              label="Живые ответы TERRITORY AI"
              hint={community.aiConfigured
                ? 'Смешные ответы в Telegram, отдельно от игровых ботов. Не отвечает на жалобы о багах и потерях.'
                : 'Пока нет AI API-ключа: включение недоступно, расходов нет.'}
              on={community.humorEnabled}
              tone="emerald"
              onToggle={() => confirm(
                community.humorEnabled ? 'Отключить ответы TERRITORY AI?' : 'Включить AI-ответы в Telegram? Сообщение об ИИ появится в группе.',
                async () => {
                  const state = await adminCall<CommunityHumorStatus>('community_humor_set', { enabled: !community.humorEnabled });
                  setCommunity(state);
                  return state.humorEnabled ? 'ИИ-ответы включены' : 'ИИ-ответы выключены';
                }
              )}
            />
            <p className="text-xs text-slate-400">
              Группа: {community.groupSelected ? 'выбрана' : 'не выбрана'} ·
              Мониторинг: {community.monitoringEnabled ? 'включён' : 'выключен'} ·
              Реплик сегодня: {community.sentToday}/15
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => confirm('Отвечать только при обращении к боту?', async () => {
                const state = await adminCall<CommunityHumorStatus>('community_humor_set', { mode: 'mentions' });
                setCommunity(state);
                return 'Режим: по обращению';
              })} className={community.mode === 'mentions' ? 'h-10 rounded-lg border border-emerald-400/70 bg-emerald-500/20 text-white text-xs font-semibold' : 'h-10 rounded-lg border border-slate-700 text-slate-300 text-xs'}>
                По обращению
              </button>
              <button type="button" onClick={() => confirm('Разрешить редкие шутки бота в игровых беседах?', async () => {
                const state = await adminCall<CommunityHumorStatus>('community_humor_set', { mode: 'lively' });
                setCommunity(state);
                return 'Режим: живой чат';
              })} className={community.mode === 'lively' ? 'h-10 rounded-lg border border-emerald-400/70 bg-emerald-500/20 text-white text-xs font-semibold' : 'h-10 rounded-lg border border-slate-700 text-slate-300 text-xs'}>
                Живой чат
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Пауза 2 минуты для обращений, 15 минут между спонтанными шутками. Максимум 15 ответов в сутки.
              Кнопка управления не меняет Арену, сохранения, валюты или игровые награды.
            </p>
          </>}
        </div>
      </Panel>

      <Panel title="Боты Арены" icon={<Bot className="w-4 h-4" />}>
        <div className="space-y-2">
          <Switch
            label="Боты на арене"
            hint="Если выключено, боты не добавляются в бои — бой начнётся, когда соберутся минимум 2 живых игрока."
            on={s.arena_bots_enabled}
            tone="emerald"
            onToggle={() => toggle('arena_bots_enabled', 'Боты Арены')}
          />
          <button
            onClick={() => confirm('Сбросить и перезапустить ботов? Зависшие бои будут закрыты.', async () => {
              const r = await adminCall<{ closedRooms: number }>('reset_bots');
              return `Боты перезапущены, закрыто зависших боёв: ${r.closedRooms}`;
            })}
            className="w-full h-11 rounded-xl border border-sky-500/40 bg-sky-500/10 text-sm font-semibold text-sky-200 hover:bg-sky-500/20 flex items-center justify-center gap-2 transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Сбросить / перезапустить ботов
          </button>
        </div>
      </Panel>
    </div>
  );
}
