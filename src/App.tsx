import { useState, useEffect } from 'react';
import { useAuth, type AuthUser } from '@/game/auth';
import { useGame, useArena, applyTimeEffects } from '@/game/actions';
import { loadCloudSave, saveCloudSave } from '@/game/cloud';
import { HomeScreen } from '@/components/HomeScreen';
import { BattleScreen } from '@/components/BattleScreen';
import { InventoryScreen } from '@/components/InventoryScreen';
import { ShopScreen } from '@/components/ShopScreen';
import { QuestsScreen } from '@/components/QuestsScreen';
import { ProfileScreen } from '@/components/ProfileScreen';
import { ArenaScreen } from '@/components/ArenaScreen';
import { ForgeScreen } from '@/components/ForgeScreen';
import { LeaderboardScreen } from '@/components/LeaderboardScreen';
import { Home, Swords, Backpack, ShoppingCart, Scroll, User, Trophy, Hammer, Medal, Cloud, CloudOff, Shield } from 'lucide-react';

type Tab = 'home' | 'battle' | 'arena' | 'inventory' | 'shop' | 'forge' | 'quests' | 'leaderboard' | 'profile';

const TABS: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Дом', icon: Home },
  { id: 'battle', label: 'Бой', icon: Swords },
  { id: 'arena', label: 'Арена', icon: Trophy },
  { id: 'inventory', label: 'Сумка', icon: Backpack },
  { id: 'shop', label: 'Лавка', icon: ShoppingCart },
  { id: 'forge', label: 'Кузница', icon: Hammer },
  { id: 'quests', label: 'Квесты', icon: Scroll },
  { id: 'leaderboard', label: 'Топ', icon: Medal },
  { id: 'profile', label: 'Профиль', icon: User },
];

type SaveStatus = 'saved' | 'saving' | 'error';

function Splash({ text }: { text: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: 'var(--color-bg)' }}>
      <div className="text-5xl mb-4 animate-float">⚔️</div>
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

function GameShell({ user }: { user: AuthUser }) {
  const [tab, setTab] = useState<Tab>('home');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

  useEffect(() => {
    let cancelled = false;
    loadCloudSave(user.id, user.displayName)
      .then((profile) => {
        if (cancelled) return;
        useGame.set(applyTimeEffects(profile.state));
        useArena.set({ rating: profile.arenaRating, wins: profile.arenaWins, losses: profile.arenaLosses });
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

  if (loadError) return <Splash text={loadError} />;
  if (!loaded) return <Splash text="Загрузка героя..." />;

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto" style={{ background: 'var(--color-bg)' }}>
      <header
        className="sticky top-0 z-30 px-4 py-3 flex items-center justify-between backdrop-blur-md"
        style={{ background: 'rgba(12, 17, 23, 0.85)', borderBottom: '1px solid var(--color-border)' }}
      >
        <h1 className="text-lg font-bold text-white tracking-tight">Territory</h1>
        <div className="flex items-center gap-2">
          <span title={saveStatus === 'error' ? 'Ошибка сохранения' : 'Сохранено'}>
            {saveStatus === 'error' ? (
              <CloudOff className="w-4 h-4 text-red-400" />
            ) : (
              <Cloud className={`w-4 h-4 ${saveStatus === 'saving' ? 'text-gray-500 animate-pulse' : 'text-teal-400'}`} />
            )}
          </span>
          {user.photoUrl ? (
            <img src={user.photoUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-400 to-teal-700 flex items-center justify-center text-sm">🦸</div>
          )}
        </div>
      </header>

      <main className="flex-1 px-3 py-3 overflow-y-auto scrollbar-hide" style={{ paddingBottom: '80px' }}>
        {tab === 'home' && <HomeScreen />}
        {tab === 'battle' && <BattleScreen />}
        {tab === 'arena' && <ArenaScreen />}
        {tab === 'inventory' && <InventoryScreen />}
        {tab === 'shop' && <ShopScreen />}
        {tab === 'forge' && <ForgeScreen />}
        {tab === 'quests' && <QuestsScreen />}
        {tab === 'leaderboard' && <LeaderboardScreen user={user} />}
        {tab === 'profile' && <ProfileScreen />}
      </main>

      <nav
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-30 backdrop-blur-md"
        style={{ background: 'rgba(12, 17, 23, 0.9)', borderTop: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center py-1.5 px-1 overflow-x-auto scrollbar-hide gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg transition-all shrink-0 ${
                  active ? 'text-teal-400 bg-teal-500/10' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Icon className={`w-5 h-5 transition-transform ${active ? 'scale-110' : ''}`} />
                <span className="text-[10px] font-medium">{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function App() {
  const { authState, startAsGuest } = useAuth();

  if (authState.status === 'loading') return <Splash text="Загрузка..." />;
  if (authState.status === 'guest') return <Welcome onStart={startAsGuest} error={authState.error} />;
  return <GameShell key={authState.user.id} user={authState.user} />;
}

export default App;
