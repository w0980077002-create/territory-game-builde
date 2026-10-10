import { useState, useEffect } from 'react';
import { useAuth, type AuthUser } from '@/game/auth';
import { useGame, useArena, useAccount, applyTimeEffects } from '@/game/actions';
import { loadCloudSave, saveCloudSave } from '@/game/cloud';
import { HomeScreen } from '@/components/HomeScreen';
import { BattleScreen, type BattleView } from '@/components/BattleScreen';
import type { SaveStatus } from '@/components/home/HomeSheets';
import { InventoryScreen } from '@/components/InventoryScreen';
import { ShopScreen } from '@/components/ShopScreen';
import { MapScreen } from '@/components/MapScreen';
import { QuestsScreen } from '@/components/QuestsScreen';
import { ProfileScreen } from '@/components/ProfileScreen';
import { ArenaScreen } from '@/components/ArenaScreen';
import { ForgeScreen } from '@/components/ForgeScreen';
import { LeaderboardScreen } from '@/components/LeaderboardScreen';
import { GamesScreen } from '@/components/GamesScreen';
import { MonopolyScreen } from '@/components/MonopolyScreen';
import { ProfessionsScreen } from '@/components/ProfessionsScreen';
import { AuctionScreen } from '@/components/AuctionScreen';
import { MaintenanceScreen, BannedScreen } from '@/components/ServiceScreens';
import { useLive, useLiveSync, fetchMaintenance } from '@/game/live';
import { useStore } from '@/game/store';
import { isVerifiedAdmin } from '@/admin/api';
import { ChevronLeft, Shield, Wrench } from 'lucide-react';

type NavId = 'city' | 'inventory' | 'hero' | 'battle' | 'map' | 'games' | 'clan';
type SubScreen = 'shop' | 'forge' | 'arena' | 'leaderboard' | 'quests' | 'monopoly' | 'professions' | 'auction';
type Screen = Exclude<NavId, 'clan'> | SubScreen;

const NAV: { id: NavId; label: string; icon: string; soon?: boolean }[] = [
  { id: 'city', label: 'Город', icon: '/nav-city.webp' },
  { id: 'inventory', label: 'Инвентарь', icon: '/nav-inventory.webp' },
  { id: 'hero', label: 'Герой', icon: '/nav-hero.webp' },
  { id: 'battle', label: 'Бой', icon: '/nav-battle.webp' },
  { id: 'map', label: 'Карта', icon: '/nav-map.webp' },
  { id: 'games', label: 'Игры', icon: '/nav-games.webp' },
  { id: 'clan', label: 'Клан', icon: '/nav-clan.webp', soon: true },
];

const SUB_SCREENS: Partial<Record<SubScreen, { title: string; icon: string }>> = {
  shop: { title: 'Лавка', icon: '/ic-shop.webp' },
  forge: { title: 'Кузница', icon: '/ic-forge.webp' },
  arena: { title: 'Арена', icon: '/ic-arena.webp' },
  leaderboard: { title: 'Топ игроков', icon: '/ic-trophy.webp' },
  quests: { title: 'Задания', icon: '/ic-quests.webp' },
  professions: { title: 'Профессии и ремесло', icon: '/ic-forge.webp' },
  auction: { title: 'Аукцион и чат', icon: '/ic-shop.webp' },
};

function Splash({ text }: { text: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: 'var(--color-bg)' }}>
      <img src="/hero-viking.webp" alt="" className="w-28 h-28 object-contain mb-4 animate-float" />
      <h1 className="text-2xl font-bold text-white mb-2">Territory</h1>
      <p className="text-gray-400 text-sm">{text}</p>
    </div>
  );
}

function Welcome({ onStart, error }: { onStart: (name: string) => void; error?: string }) {
  const [name, setName] = useState('');
  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <div className="absolute inset-0 bg-gradient-to-b from-teal-900/20 via-transparent to-amber-900/10 pointer-events-none" />
      <form
        className="relative w-full max-w-sm card text-center py-8 animate-fade-in"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(name);
        }}
      >
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-teal-400 to-teal-700 flex items-center justify-center mb-4 animate-float">
          <Shield className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">Territory</h1>
        <p className="text-sm text-gray-400 mb-6">Сражайся с монстрами, побеждай на арене и стань легендой</p>
        <label className="block text-left text-xs text-gray-400 mb-1">Имя героя</label>
        <input
          className="w-full rounded-lg bg-black/30 border border-white/10 px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-teal-500 transition-colors mb-4"
          placeholder="Например, Рагнар"
          maxLength={20}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        <button type="submit" className="btn-primary w-full text-lg">Начать игру</button>
        <p className="text-xs text-gray-500 mt-4">Прогресс сохраняется автоматически</p>
      </form>
    </div>
  );
}

function GameShell({ user, isAdmin }: { user: AuthUser; isAdmin: boolean }) {
  const [screen, setScreen] = useState<Screen>('city');
  const [battleView, setBattleView] = useState<BattleView>('campaign');
  const [autoStart, setAutoStart] = useState(false);
  const [inventoryTab, setInventoryTab] = useState<'items' | 'equipment'>('items');
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [battleLocked, setBattleLocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const live = useStore(useLive);
  useLiveSync(loaded);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = (text: string) => setToast({ id: Date.now(), text });

  useEffect(() => {
    let cancelled = false;
    loadCloudSave(user.id, user.displayName)
      .then(async (profile) => {
        if (cancelled) return;
        const loadedState = applyTimeEffects(profile.state);
        useGame.set(loadedState);
        if (profile.balanceMigrated) {
          const migratedSaveOk = await saveCloudSave(user.id, loadedState);
          if (!migratedSaveOk) {
            console.error('Equipment balance migration save failed; scheduling a retry.');
            window.setTimeout(() => { void saveCloudSave(user.id, useGame.get()); }, 5000);
          }
        }
        useArena.set({ rating: profile.arenaRating, wins: profile.arenaWins, losses: profile.arenaLosses });
        useAccount.set({ vip: profile.vip });
        setLoaded(true);
      })
      .catch(() => !cancelled && setLoadError('Не удалось загрузить прогресс. Проверь интернет и обнови страницу.'));
    return () => {
      cancelled = true;
    };
  }, [user.id, user.displayName]);

  useEffect(() => {
    if (!loaded) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useGame.subscribe(() => {
      setSaveStatus('saving');
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const ok = await saveCloudSave(user.id, useGame.get());
        setSaveStatus(ok ? 'saved' : 'error');
      }, 1500);
    });
    const tick = setInterval(() => {
      const current = useGame.get();
      const next = applyTimeEffects(current);
      if (next.player.energy !== current.player.energy || next.dailyResetDay !== current.dailyResetDay) {
        useGame.set(next);
      }
    }, 30000);
    return () => {
      unsubscribe();
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [loaded, user.id]);

  if (live.banned) return <BannedScreen />;
  if (live.maintenance && !isAdmin) return <MaintenanceScreen />;
  if (loadError) return <Splash text={loadError} />;
  if (!loaded) return <Splash text="Загрузка героя..." />;

  const sub = SUB_SCREENS[screen as SubScreen];
  const navActive: NavId = sub ? 'city' : screen === 'monopoly' ? 'games' : (screen as NavId);

  const goNav = (id: NavId) => {
    if (id === 'clan') return notify('Кланы откроются в следующих обновлениях');
    if (id === 'battle') setBattleView('campaign');
    setScreen(id);
  };

  return (
    <div className="h-[100dvh] flex flex-col max-w-md mx-auto overflow-hidden relative" style={{ background: 'var(--color-bg)' }}>
      {live.maintenance && (
        <div className="shrink-0 z-40 flex items-center justify-center gap-1.5 bg-amber-500 py-1 text-[11px] font-bold text-black">
          <Wrench className="w-3 h-3" /> Техработы включены — вы вошли как админ
        </div>
      )}
      {sub && (
        <header className="shrink-0 z-30 h-12 px-2 flex items-center gap-2 border-b border-amber-500/20 bg-[#0c1117]/95">
          <button disabled={battleLocked} onClick={() => setScreen('city')} className="h-9 pl-1.5 pr-3 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 text-sm font-semibold text-amber-100 bg-white/5 border border-white/10 active:scale-95 transition-transform">
            <ChevronLeft className="w-4 h-4" /> Город
          </button>
          <img src={sub.icon} alt="" className="w-7 h-7 object-contain" />
          <h1 className="text-base font-bold text-white truncate">{sub.title}</h1>
        </header>
      )}

      <main className={`flex-1 min-h-0 ${screen === 'city' || screen === 'monopoly' ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden scrollbar-hide px-3 py-3'}`}>
        {screen === 'city' && (
          <HomeScreen
            user={user}
            saveStatus={saveStatus}
            notify={notify}
            onOpen={setScreen}
            onBattle={(view, auto) => {
              setBattleView(view);
              setAutoStart(!!auto);
              setScreen('battle');
            }}
            onInventory={(tab) => {
              setInventoryTab(tab);
              setScreen('inventory');
            }}
          />
        )}
        {screen === 'battle' && (
          <BattleScreen
            view={battleView}
            onView={setBattleView}
            autoStart={autoStart}
            onAutoStartHandled={() => setAutoStart(false)}
            onShop={() => setScreen('shop')}
            onActiveChange={setBattleLocked}
          />
        )}
        {screen === 'inventory' && <InventoryScreen key={inventoryTab} initialTab={inventoryTab} />}
        {screen === 'hero' && <ProfileScreen />}
        {screen === 'map' && <MapScreen />}
        {screen === 'shop' && <ShopScreen />}
        {screen === 'forge' && <ForgeScreen />}
        {screen === 'arena' && <ArenaScreen onActiveChange={setBattleLocked} />}
        {screen === 'leaderboard' && <LeaderboardScreen user={user} />}
        {screen === 'quests' && <QuestsScreen />}
        {screen === 'games' && (
          <GamesScreen onPlay={(gameId) => gameId === 'monopoly' && setScreen('monopoly')} />
        )}
        {screen === 'monopoly' && <MonopolyScreen onBack={() => setScreen('games')} />}
        {screen === 'professions' && <ProfessionsScreen />}
        {screen === 'auction' && <AuctionScreen />}
      </main>

      <nav className="shrink-0 z-30 border-t border-amber-500/25 bg-gradient-to-b from-[#161b24] to-[#0a0d12] px-1 pt-1 pb-[max(4px,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-0.5 h-[60px]">
          {NAV.map((t) => {
            const active = navActive === t.id;
            const center = t.id === 'battle';
            return (
              <button
                key={t.id}
                disabled={battleLocked}
                onClick={() => goNav(t.id)}
                aria-current={active ? 'page' : undefined}
                className={`nav-btn disabled:opacity-40 disabled:cursor-not-allowed ${
                  center
                    ? `-mt-3 h-[70px] border-sky-300/60 bg-gradient-to-b from-sky-600/60 to-[#0d1a33] shadow-[0_0_14px_rgba(56,189,248,0.35)] ${active ? 'ring-2 ring-sky-300/70' : ''}`
                    : active
                      ? 'border-amber-400/60 bg-gradient-to-b from-amber-500/25 to-amber-900/20'
                      : 'border-white/5 bg-white/[0.03]'
                }`}
              >
                <img
                  src={t.icon}
                  alt=""
                  draggable={false}
                  className={`object-contain transition-transform duration-200 ${center ? 'w-10 h-10' : 'w-8 h-8'} ${active ? 'scale-110' : ''} ${t.soon ? 'opacity-60 grayscale-[40%]' : ''}`}
                />
                <span className={`text-[9px] tracking-tight font-bold leading-none truncate max-w-full ${active || center ? 'text-white' : 'text-gray-400'}`}>{t.label}</span>
{t.id === 'clan' && <span className="absolute top-0.5 right-0.5 rounded bg-slate-700 px-0.5 text-[7px] font-bold uppercase text-gray-300">скоро</span>}
              </button>
            );
          })}
        </div>
      </nav>

      {toast && (
        <div key={toast.id} className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[84px] z-[60] w-[calc(100%-32px)] max-w-sm rounded-xl border border-amber-400/40 bg-[#1a1610]/95 px-3 py-2 text-center text-xs font-semibold text-amber-50 shadow-2xl animate-sheet-up">
          {toast.text}
        </div>
      )}
    </div>
  );
}

function App() {
  const { authState, startAsGuest } = useAuth();
  const { maintenance } = useStore(useLive);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    isVerifiedAdmin().then(setIsAdmin);
    fetchMaintenance().then((on) => useLive.set((s) => ({ ...s, maintenance: on })));
  }, []);

  if (authState.status === 'loading' || isAdmin === null) return <Splash text="Загрузка..." />;
  if (maintenance && !isAdmin) return <MaintenanceScreen />;
  if (authState.status === 'guest') return <Welcome onStart={startAsGuest} error={authState.error} />;
  return <GameShell key={authState.user.id} user={authState.user} isAdmin={isAdmin} />;
}

export default App;
