import { refreshFortuneVip } from '@/game/fortuneVip';
import { captureGameEvent } from '@/game/analytics';
import { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth, type AuthUser } from '@/game/auth';
import { useGame, useArena, useAccount, applyTimeEffects } from '@/game/actions';
import { reconcileLockedBelt } from '@/game/belt';
import { loadCloudSave, saveCloudSave } from '@/game/cloud';
import { createImmediateSaveController } from '@/game/immediateSave';
import { HomeScreen } from '@/components/HomeScreen';
import type { BattleView } from '@/components/BattleScreen';
import type { SaveStatus } from '@/components/home/HomeSheets';










import type { HallGame } from '@/game/gameHall';




import { MaintenanceScreen, BannedScreen } from '@/components/ServiceScreens';
import { useLive, useLiveSync, fetchMaintenance } from '@/game/live';
import { useStore } from '@/game/store';
import { isVerifiedAdmin } from '@/admin/api';
import { ChevronLeft, Send, Wrench, Smartphone, BellRing } from 'lucide-react';
import { useLanguage } from '@/game/i18n';
import { useGatherReady } from '@/game/gatherNotice';
import { socialStatus, type SocialStatus } from '@/game/socialQuests';
import { getQuestAlerts, readSeenQuests, rememberSeenQuests } from '@/game/questAttention';

// Only City is downloaded for initial login; other screens load on demand.
// Never prefetch every game mode on a mobile connection.
const BattleScreen = lazy(() => import('@/components/BattleScreen').then(m => ({ default: m.BattleScreen })));
const InventoryScreen = lazy(() => import('@/components/InventoryScreen').then(m => ({ default: m.InventoryScreen })));
const ShopScreen = lazy(() => import('@/components/ShopScreen').then(m => ({ default: m.ShopScreen })));
const MapScreen = lazy(() => import('@/components/MapScreen').then(m => ({ default: m.MapScreen })));
const QuestsScreen = lazy(() => import('@/components/QuestsScreen').then(m => ({ default: m.QuestsScreen })));
const ProfileScreen = lazy(() => import('@/components/ProfileScreen').then(m => ({ default: m.ProfileScreen })));
const ArenaScreen = lazy(() => import('@/components/ArenaScreen').then(m => ({ default: m.ArenaScreen })));
const ForgeScreen = lazy(() => import('@/components/ForgeScreen').then(m => ({ default: m.ForgeScreen })));
const LeaderboardScreen = lazy(() => import('@/components/LeaderboardScreen').then(m => ({ default: m.LeaderboardScreen })));
const GamesScreen = lazy(() => import('@/components/GamesScreen').then(m => ({ default: m.GamesScreen })));
const HallPlayScreen = lazy(() => import('@/components/HallPlayScreen').then(m => ({ default: m.HallPlayScreen })));
const ProfessionsScreen = lazy(() => import('@/components/ProfessionsScreen').then(m => ({ default: m.ProfessionsScreen })));
const ClanScreen = lazy(() => import('@/components/ClanScreen').then(m => ({ default: m.ClanScreen })));
const AuctionScreen = lazy(() => import('@/components/AuctionScreen').then(m => ({ default: m.AuctionScreen })));
const FriendsScreen = lazy(() => import('@/components/FriendsScreen').then(m => ({ default: m.FriendsScreen })));

type NavId = 'city' | 'inventory' | 'hero' | 'battle' | 'map' | 'games' | 'clan';
type SubScreen = 'shop' | 'forge' | 'arena' | 'leaderboard' | 'quests' | 'hall-play' | 'professions' | 'auction' | 'friends';
type Screen = NavId | SubScreen;

/** Warm only the navigation chunks people are most likely to open.
 * React.lazy and these import() calls share the same browser module cache.
 * No server requests, game state writes, or speculative mini-game sessions.
 */
const sectionPreloaders: Partial<Record<Screen, () => Promise<unknown>>> = {
  inventory: () => import('@/components/InventoryScreen'),
  battle: () => import('@/components/BattleScreen'),
  map: () => import('@/components/MapScreen'),
  games: () => import('@/components/GamesScreen'),
  hero: () => import('@/components/ProfileScreen'),
  arena: () => import('@/components/ArenaScreen'),
  clan: () => import('@/components/ClanScreen'),
  shop: () => import('@/components/ShopScreen'),
  forge: () => import('@/components/ForgeScreen'),
  quests: () => import('@/components/QuestsScreen'),
  leaderboard: () => import('@/components/LeaderboardScreen'),
  friends: () => import('@/components/FriendsScreen'),
};

function preloadSection(screen: Screen): Promise<unknown> {
  const load = sectionPreloaders[screen];
  return load ? load().catch(() => undefined) : Promise.resolve();
}

const NAV: { id: NavId; label: string; icon: string; soon?: boolean }[] = [
  { id: 'city', label: 'Город', icon: '/nav-city.webp' },
  { id: 'inventory', label: 'Инвентарь', icon: '/nav-inventory.webp' },
  { id: 'hero', label: 'Герой', icon: '/nav-hero-crown.webp' },
  { id: 'battle', label: 'Бой', icon: '/nav-battle.webp' },
  { id: 'map', label: 'Карта', icon: '/nav-map-parchment.webp' },
  { id: 'games', label: 'Игры', icon: '/nav-games.webp' },
  { id: 'clan', label: 'Клан', icon: '/nav-clan.webp' },
];

const SUB_SCREENS: Partial<Record<SubScreen, { title: string; icon: string }>> = {
  shop: { title: 'Лавка', icon: '/ic-shop.webp' },
  forge: { title: 'Кузница', icon: '/ic-forge.webp' },
  arena: { title: 'Арена', icon: '/ic-arena.webp' },
  leaderboard: { title: 'Топ игроков', icon: '/ic-trophy.webp' },
  quests: { title: 'Задания', icon: '/ic-quests.webp' },
  professions: { title: 'Профессии и ремесло', icon: '/ic-professions.svg' },
  auction: { title: 'Аукцион и чат', icon: '/ic-auction.svg' },
  friends: { title: 'Друзья', icon: '/ic-invite.webp' },
};

function Splash({ text }: { text: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: 'var(--color-bg)' }}>
      <img src={import.meta.env.BASE_URL + 'assets/territory/characters/heroes/male_viking/idle.webp'} alt="" className="w-28 h-28 object-contain mb-4 animate-float" />
      <h1 className="text-2xl font-bold text-white mb-2">Territory</h1>
      <p className="text-gray-400 text-sm">{text}</p>
    </div>
  );
}

function TelegramPrompt({ error }: { error?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <div className="absolute inset-0 bg-gradient-to-b from-teal-900/20 via-transparent to-amber-900/10 pointer-events-none" />
      <div className="relative w-full max-w-sm card text-center py-8 animate-fade-in">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-teal-400 to-teal-700 flex items-center justify-center mb-4 animate-float">
          <Send className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">Territory</h1>
        <p className="text-sm text-gray-400 mb-6">Откройте игру через Telegram, чтобы войти в существующего героя или создать нового.</p>
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      </div>
    </div>
  );
}

function tNav(translate: (key: string) => string, label: string) {
  const keyByLabel: Record<string, string> = { 'Город': 'city', 'Инвентарь': 'inventory', 'Герой': 'hero', 'Бой': 'battle', 'Карта': 'map', 'Игры': 'games', 'Клан': 'clan' };
  return translate(keyByLabel[label] ?? label);
}

function GameShell({ user, isAdmin }: { user: AuthUser; isAdmin: boolean }) {
  const { language, setLanguage, t: translate } = useLanguage();
  const [isLandscapePhone, setIsLandscapePhone] = useState(false);
  const [screen, setScreen] = useState<Screen>('city');
  const [hallGame, setHallGame] = useState<HallGame>('monopoly');
  const [battleView, setBattleView] = useState<BattleView>('campaign');
  const [autoStart, setAutoStart] = useState(false);
  const [inventoryTab, setInventoryTab] = useState<'items' | 'equipment'>('equipment');
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [battleLocked, setBattleLocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const gatherReady = useGatherReady(loaded);
  const needsInitialSave = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const live = useStore(useLive);
  const game = useStore(useGame);
  const [socialClaims, setSocialClaims] = useState<SocialStatus | null>(null);
  const [seenQuestKeys, setSeenQuestKeys] = useState<string[]>(() => readSeenQuests(user.id));
  const questAlerts = getQuestAlerts(game, socialClaims, seenQuestKeys);
  const onSocialStatusChange = useCallback((next: SocialStatus) => setSocialClaims(next), []);
  useLiveSync(loaded);
  // Anonymously count successful navigation after the cloud save has loaded.
  // No user ID, character name or gameplay data is sent to analytics.
  useEffect(() => {
    if (!loaded) return;
    captureGameEvent('territory_screen_open', { screen });
    // Session-only anonymous dwell time; no account identity or user actions.
    const opened = performance.now();
    return () => {
      const elapsed = performance.now() - opened;
      if (elapsed < 1000) return; // ignore React StrictMode/re-render noise
      captureGameEvent('territory_screen_dwell', {
        screen,
        duration: elapsed < 10_000 ? 'under_10s' : elapsed < 60_000 ? '10_60s' : 'over_60s',
      });
    };
  }, [loaded, screen]);


  // Idle, sequential chunk warming removes Telegram WebView's first-tap
  // JavaScript download delay. Avoid flooding constrained/mobile data.
  useEffect(() => {
    if (!loaded) return;
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || /2g/.test(connection?.effectiveType ?? '')) return;
    const fast = !connection?.effectiveType || connection.effectiveType === '4g';
    // On mobile, eager loading twelve sections competed with artwork.
    // Other sections still load normally when the player navigates to them.
    const screens: Screen[] = fast
      ? ['battle', 'inventory', 'games', 'arena', 'hero']
      : ['battle', 'inventory'];
    let cancelled = false;
    let timer = 0;
    let nextIndex = 0;
    const warmNext = async () => {
      if (cancelled || nextIndex >= screens.length) return;
      if (document.visibilityState === 'hidden') {
        timer = window.setTimeout(() => { void warmNext(); }, 1_500);
        return;
      }
      await preloadSection(screens[nextIndex++]);
      if (!cancelled) timer = window.setTimeout(() => { void warmNext(); }, 1_500);
    };
    timer = window.setTimeout(() => { void warmNext(); }, 1_800);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [loaded]);


  // Expiring VIP is refreshed against server time, including WebView resume.
  useEffect(()=>{
    if(!loaded)return;
    const refresh=()=>{if(document.visibilityState!=='hidden')void refreshFortuneVip();};
    const timer=setInterval(refresh,60000);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[loaded,user.id]);

  // Social rewards are stored on the server, never inferred from local quest progress.
  useEffect(() => {
    if (!loaded) return;
    let active = true;
    socialStatus().then((result) => {
      if (active) setSocialClaims(result);
    }).catch(() => { /* Normal quests still show alerts if Telegram is temporarily unavailable. */ });
    return () => { active = false; };
  }, [loaded, user.id]);

  // A first visit dismisses "new" dots, but earned unclaimed rewards stay highlighted.
  useEffect(() => {
    if (!loaded || screen !== 'quests') return;
    setSeenQuestKeys(rememberSeenQuests(user.id, game, socialClaims));
  }, [loaded, screen, user.id, game.quests, game.dailyResetDay, game.weeklyResetWeek, socialClaims]);

  useEffect(() => {
    const orientation = window.matchMedia('(orientation: landscape)');
    // Only compact phones need the portrait warning. Tablets and desktop
    // windows must remain usable in landscape even with a touch screen.
    const updateOrientation = () => setIsLandscapePhone(
      orientation.matches && Math.min(window.innerWidth, window.innerHeight) < 520
    );
    updateOrientation();
    orientation.addEventListener?.('change', updateOrientation);
    window.addEventListener('resize', updateOrientation);
    return () => {
      orientation.removeEventListener?.('change', updateOrientation);
      window.removeEventListener('resize', updateOrientation);
    };
  }, []);

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
        const timedState = applyTimeEffects(profile.state);
        // Historic belt slots can become locked by harder win requirements.
        // Return their consumables to the inventory before showing or saving.
        const loadedState = reconcileLockedBelt(timedState, profile.arenaWins);
        const beltReconciled = loadedState !== timedState;
        useGame.set(loadedState);
        const hasNewTimeEffects = loadedState.dailyResetDay !== profile.state.dailyResetDay
          || loadedState.weeklyResetWeek !== profile.state.weeklyResetWeek
          || loadedState.player.energy !== profile.state.player.energy;
        // Start the first migration save through the same tracked autosave queue.
        // A separate fire-and-forget write could collide with iOS gameplay saves.
        needsInitialSave.current = !!(profile.balanceMigrated || profile.rosterMigrated || hasNewTimeEffects || beltReconciled);
        useArena.set({ rating: profile.arenaRating, wins: profile.arenaWins, losses: profile.arenaLosses });
        useAccount.set({ vip: profile.vip, permanentVip:profile.vip, vipUntil:null, vipRemaining:0, vipCheckedAt:performance.now() });
        void refreshFortuneVip();
        setLoaded(true);
      })
      .catch(() => !cancelled && setLoadError('failedLoad'));
    return () => {
      cancelled = true;
    };
  }, [user.id, user.displayName]);

  useEffect(() => {
    if (!loaded) return;
    // Important actions (battle wins, shop purchases, forge upgrades, rewards)
    // start a cloud write immediately. Only one is in flight; newer changes
    // are sent as soon as its confirmed response arrives.
    const controller = createImmediateSaveController(
      () => saveCloudSave(user.id, useGame.get()),
      setSaveStatus,
    );
    const unsubscribe = useGame.subscribe(controller.changed);
    // iOS Telegram WebViews can suspend on close before an old debounce fires.
    const flush = () => controller.flush();
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    window.addEventListener('pageshow', flush);
    window.addEventListener('online', flush);
    if (needsInitialSave.current) {
      needsInitialSave.current = false;
      controller.changed();
    }
    const tick = setInterval(() => {
      const current = useGame.get();
      const next = applyTimeEffects(current);
      if (next.player.energy !== current.player.energy || next.dailyResetDay !== current.dailyResetDay || next.weeklyResetWeek !== current.weeklyResetWeek) {
        useGame.set(next);
      }
    }, 30000);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('pageshow', flush);
      window.removeEventListener('online', flush);
      clearInterval(tick);
      controller.stop();
    };
  }, [loaded, user.id]);

  if (live.banned) return <BannedScreen />;
  if (live.maintenance && !isAdmin) return <MaintenanceScreen />;
  if (loadError) return <Splash text={loadError === 'failedLoad' ? translate('failedLoad') : loadError} />;
  if (!loaded) return <Splash text={translate('loadingHero')} />;

  const sub = SUB_SCREENS[screen as SubScreen];
  const navActive: NavId = screen === 'hall-play' ? 'games' : screen === 'arena' ? 'battle' : sub ? 'city' : (screen as NavId);
  const slotImmersive = screen === 'hall-play' && hallGame === 'slots';

  const goNav = (id: NavId) => {
    if (id === 'battle') setBattleView('campaign');
    setScreen(id);
  };

  return (
    <div
      className={`territory-shell flex flex-col max-w-md mx-auto overflow-hidden relative ${screen === 'hall-play' && hallGame === 'wheel' ? 'territory-wheel-open' : ''} ${slotImmersive ? 'territory-slots-open' : ''} ${screen === 'arena' ? 'territory-arena-theme' : ''}`}
      // Android Chrome/WebView displays the public image URL on long-press.
      // Block native context menus only on game art and controls, never on
      // chat messages, input fields, or other selectable player content.
      onContextMenuCapture={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest('img, button, [role="button"]')) {
          event.preventDefault();
        }
      }}
      onDragStartCapture={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest('img')) {
          event.preventDefault();
        }
      }}
      // JS receives the stable viewport from Telegram; CSS falls back to its
      // native variable, then to the browser's dynamic viewport height.
      style={{ background: 'var(--color-bg)', height: 'var(--territory-viewport-height, var(--tg-viewport-stable-height, 100dvh))' }}
    >
      {live.maintenance && (
        <div className="shrink-0 z-40 flex items-center justify-center gap-1.5 bg-amber-500 py-1 text-[11px] font-bold text-black">
          <Wrench className="w-3 h-3" /> {translate('maintenance')}
        </div>
      )}
      {saveStatus === 'error' && (
        <div role="alert" className="shrink-0 z-40 border-b border-red-500/60 bg-red-950 px-2 py-1 text-center text-[10px] font-semibold leading-tight text-red-100">
          {language === 'en'
            ? 'Progress not saved! Stay in the game; check connection.'
            : 'Прогресс не сохранён! Не закрывайте игру, проверьте сеть.'}
        </div>
      )}
      {sub && screen !== 'arena' && (
        <header className="shrink-0 z-30 h-12 px-2 flex items-center gap-2 border-b border-amber-500/20 bg-[#0c1117]/95">
          <button disabled={battleLocked} onClick={() => setScreen('city')} className="h-9 pl-1.5 pr-3 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 text-sm font-semibold text-amber-100 bg-white/5 border border-white/10 active:scale-95 transition-transform">
            <ChevronLeft className="w-4 h-4" /> {translate('cityBack')}
          </button>
          <img src={sub.icon} alt="" className="w-7 h-7 object-contain" />
          <h1 className="text-base font-bold text-white truncate">{translate(({ shop: 'shop', forge: 'forge', arena: 'arena', leaderboard: 'leaderboard', quests: 'quests', professions: 'professions', auction: 'auction', friends: 'friends' } as Record<string, string>)[screen] ?? sub.title)}</h1>
        </header>
      )}

      <main className={`territory-screen flex-1 min-h-0 min-w-0 ${screen === 'city' ? 'territory-city-screen overflow-y-auto overflow-x-hidden' : screen === 'inventory' ? 'overflow-hidden px-3 pt-3 pb-1' : slotImmersive ? 'overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide !px-0 !py-0' : 'overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide px-3 py-3'}`}>
        <Suspense fallback={<div role="status" className="flex min-h-32 items-center justify-center text-center text-sm text-amber-100/80">{language === 'en' ? 'Opening section…' : 'Открываем раздел…'}</div>}>
        {screen === 'city' && (
          <HomeScreen
            user={user}
            saveStatus={saveStatus}
            notify={notify}
            onOpen={setScreen}
            questAlerts={questAlerts}
            onBattle={(view, auto) => {
              captureGameEvent('territory_battle_open', { mode: view });
              if (game.player.level <= 2 && game.totalBattlesWon === 0 && view === 'campaign') {
                captureGameEvent('territory_newcomer_fight_click', { mode: 'campaign' });
              }
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
            userId={user.id}
            view={battleView}
            onView={setBattleView}
            autoStart={autoStart}
            onAutoStartHandled={() => setAutoStart(false)}
            onShop={() => setScreen('shop')}
            onActiveChange={setBattleLocked}
          />
        )}
        {screen === 'inventory' && <InventoryScreen key={inventoryTab} initialTab={inventoryTab} userId={user.id} />}
        {screen === 'hero' && <ProfileScreen user={user} />}
        {screen === 'map' && <MapScreen />}
        {screen === 'shop' && <ShopScreen />}
        {screen === 'forge' && <ForgeScreen />}
        {screen === 'arena' && <ArenaScreen onActiveChange={setBattleLocked} onBack={() => setScreen('city')} backDisabled={battleLocked} onLeaderboard={() => setScreen('leaderboard')} notify={notify} saveStatus={saveStatus} />}
        {screen === 'leaderboard' && <LeaderboardScreen user={user} />}
        {screen === 'quests' && <QuestsScreen userId={user.id} onSocialStatusChange={onSocialStatusChange} />}
        {screen === 'games' && (
          <GamesScreen userId={user.id} onPlay={(gameId) => {
            captureGameEvent('territory_hall_game_open', { mode: gameId });
            setHallGame(gameId);
            setScreen('hall-play');
          }} />
        )}
        {screen === 'hall-play' && <HallPlayScreen game={hallGame} userId={user.id} onBack={() => setScreen('games')} />}
        {screen === 'professions' && <ProfessionsScreen />}
        {screen === 'auction' && <AuctionScreen />}
        {screen === 'friends' && <FriendsScreen user={user} onHero={() => setScreen('hero')} />}
        {screen === 'clan' && <ClanScreen userId={user.id} notify={notify} />}
        </Suspense>
      </main>

      {/* Computer-only shortcuts: visible without scrolling the city's side
          panels. CSS keeps this entire bar hidden on phones and tablets. */}
      {screen === 'city' && (
        <nav className="territory-desktop-quicknav shrink-0" aria-label={language === 'en' ? 'Quick access' : 'Быстрый доступ'}>
          {[
            { id: 'arena', icon: '/ic-arena.webp', label: translate('arena'), action: () => setScreen('arena') },
            { id: 'trial', icon: '/ic-trials.webp', label: translate('trials'), action: () => { setBattleView('trial'); setAutoStart(false); setScreen('battle'); } },
            { id: 'quests', icon: '/ic-quests.webp', label: translate('quests'), action: () => setScreen('quests') },
            { id: 'shop', icon: '/ic-shop.webp', label: translate('shop'), action: () => setScreen('shop') },
            { id: 'forge', icon: '/ic-forge.webp', label: translate('forge'), action: () => setScreen('forge') },
            { id: 'professions', icon: '/ic-professions.svg', label: translate('professions'), action: () => setScreen('professions') },
          ].map((item) => (
            <button type="button" key={item.id} disabled={battleLocked} onClick={item.action}
              aria-label={item.label} title={item.label}>
              <img src={item.icon} alt="" draggable={false} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}

      {!slotImmersive && <nav className="territory-nav shrink-0 z-30 border-t border-amber-500/25 bg-gradient-to-b from-[#161b24] to-[#0a0d12] px-1 pt-1 pb-1">
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
                aria-label={t.id === 'map' && gatherReady ? `${tNav(translate, t.label)} — ${language === 'en' ? 'resources ready' : 'ресурсы готовы'}` : tNav(translate, t.label)}
                className={`nav-btn relative disabled:opacity-40 disabled:cursor-not-allowed ${
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
                  className={`object-contain transition-transform duration-200 ${center ? 'w-10 h-10' : t.id === 'hero' || t.id === 'map' ? 'w-9 h-9' : 'w-8 h-8'} ${active ? 'scale-110' : ''} `}
                />
                {t.id === 'map' && gatherReady && (
                  <span aria-hidden="true" className="absolute right-0 top-0 w-4 h-4 rounded-full bg-emerald-500 border border-emerald-200 flex items-center justify-center shadow-[0_0_10px_rgba(52,211,153,0.9)] animate-pulse">
                    <BellRing className="w-2.5 h-2.5 text-white" />
                  </span>
                )}
                <span className={`territory-nav-label text-[9px] tracking-tight font-bold max-w-full ${active || center ? 'text-white' : 'text-gray-400'}`}>{tNav(translate, t.label)}</span>
              </button>
            );
          })}
        </div>
      </nav>}

      {isLandscapePhone && (
        <div role="alertdialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-[#070b12]/95 p-6 text-center backdrop-blur-md" style={{ paddingTop: 'max(24px, env(safe-area-inset-top))', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
          <div className="w-full max-w-sm rounded-3xl border border-sky-400/35 bg-gradient-to-b from-[#14283b] to-[#090f18] px-6 py-8 shadow-[0_0_50px_rgba(14,165,233,0.12)]">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-sky-300/40 bg-sky-500/10 text-sky-200"><Smartphone className="h-12 w-12 rotate-90" strokeWidth={1.7} /></div>
            <h2 className="mb-3 text-xl font-extrabold leading-tight text-white">{translate('rotateTitle')}</h2>
            <p className="text-sm leading-relaxed text-slate-300">{translate('rotateBody')}</p>
            <div className="mt-5 inline-flex rounded-full border border-white/10 bg-black/30 p-1">
              <button onClick={() => setLanguage('ru')} className={`rounded-full px-4 py-1.5 text-sm font-bold ${language === 'ru' ? 'bg-amber-400 text-black' : 'text-slate-300'}`}>RU</button>
              <button onClick={() => setLanguage('en')} className={`rounded-full px-4 py-1.5 text-sm font-bold ${language === 'en' ? 'bg-amber-400 text-black' : 'text-slate-300'}`}>EN</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div key={toast.id} className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[84px] z-[60] w-[calc(100%-32px)] max-w-sm rounded-xl border border-amber-400/40 bg-[#1a1610]/95 px-3 py-2 text-center text-xs font-semibold text-amber-50 shadow-2xl animate-sheet-up">
          {toast.text}
        </div>
      )}
    </div>
  );
}

function App() {
  const { authState } = useAuth();
  const { t } = useLanguage();
  const { maintenance } = useStore(useLive);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Owner verification must still happen server-side, but it should not hold
    // the loading screen for ALL players while the admin API is slow.
    // Until verified the client has NO admin privileges, including maintenance
    // bypass. Never infer admin status from a cached token.
    void isVerifiedAdmin().then(setIsAdmin).catch(() => setIsAdmin(false));
    void fetchMaintenance().then((on) => useLive.set((s) => ({ ...s, maintenance: on }))).catch(() => {});
  }, []);

  if (authState.status === 'loading') return <Splash text={t('loadingHero')} />;
  if (maintenance && !isAdmin) return <MaintenanceScreen />;
  if (authState.status === 'guest') return <TelegramPrompt error={authState.error} />;
  return <GameShell key={authState.user.id} user={authState.user} isAdmin={isAdmin} />;
}

export default App;
