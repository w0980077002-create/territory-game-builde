// Telegram WebApp SDK type declarations and integration

interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: TelegramWebAppUser;
    auth_date?: number;
    hash?: string;
  };
  ready: () => void;
  expand: () => void;
  close: () => void;
  openTelegramLink?: (url: string) => void;
  /** Telegram Mini Apps 8.0+: user-confirmed bot-prepared photo/card share. */
  shareMessage?: (messageId: string, callback?: (sent: boolean) => void) => void;
  MainButton: {
    text: string;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
  };
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
  };
  HapticFeedback: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  viewportHeight: number;
  viewportStableHeight: number;
  platform?: string;
  isFullscreen?: boolean;
  isVersionAtLeast?: (version: string) => boolean;
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  // Telegram Mini Apps 7.7+: control native sheet swipe gestures.
  disableVerticalSwipes?: () => void;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  onEvent?: (event: string, callback: () => void) => void;
}


declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp || null;
}

export function getTelegramInitData(): string {
  const tg = getTelegramWebApp();
  return tg?.initData || '';
}

export function getTelegramUser(): TelegramWebAppUser | null {
  const tg = getTelegramWebApp();
  return tg?.initDataUnsafe?.user || null;
}

let viewportListenersAttached = false;

function updateTelegramViewport(tg: TelegramWebApp) {
  const root = document.documentElement;
  // Stable Telegram height is ideal for pinned controls, but some WebViews
  // report a stale/larger value after expansion or when system UI changes.
  // Never allow the game's bottom navigation beyond the *visible* viewport.
  const candidates = [
    tg.viewportStableHeight,
    window.innerHeight,
    window.visualViewport?.height,
    root.clientHeight,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (candidates.length) {
    const height = Math.floor(Math.min(...candidates));
    root.style.setProperty('--territory-viewport-height', `${height}px`);
  } else {
    root.style.removeProperty('--territory-viewport-height');
  }

  // Insets are only subtracted for actual fullscreen: outside fullscreen,
  // Telegram has already reserved the area occupied by its native header.
  const inset = (edge: 'top' | 'bottom') => tg.isFullscreen
    ? Math.max(0, (tg.safeAreaInset?.[edge] ?? 0) + (tg.contentSafeAreaInset?.[edge] ?? 0))
    : 0;
  // Safety fallback while iOS is exiting a previously requested fullscreen:
  // old Telegram iOS WebViews may briefly report zero safe-area insets.
  // This fallback NEVER affects normal expanded iOS sheets or Android.
  const topInset = tg.platform === 'ios' && tg.isFullscreen
    ? Math.max(104, inset('top'))
    : inset('top');
  root.style.setProperty('--territory-top-inset', `${topInset}px`);
  root.style.setProperty('--territory-bottom-inset', `${inset('bottom')}px`);
}

export function initTelegramWebApp() {
  const tg = getTelegramWebApp();
  if (!tg) return;

  // The game scrolls inside its own panels, not the outer browser page.
  document.documentElement.classList.add('territory-telegram-webapp');
  // A desktop-only CSS hook. Native Android/iOS (including tablets) never
  // receives it, even when connected to an external mouse or keyboard.
  const desktopTelegram = !['android', 'android_x', 'ios'].includes(tg.platform ?? '')
    && window.matchMedia('(any-pointer: fine)').matches;
  document.documentElement.classList.toggle('territory-desktop-webapp', desktopTelegram);
  // Isolate iOS fixes from Android and the desktop Telegram layout.
  const iosTelegram = tg.platform === 'ios';
  document.documentElement.classList.toggle('territory-ios-webapp', iosTelegram);

  tg.ready();
  // Only native phone Telegram should auto-expand. Desktop, laptop and tablet
  // players keep Telegram's resizable window instead of forced fullscreen.
  const phoneTelegram = ['android', 'android_x', 'ios'].includes(tg.platform ?? '')
    && Math.min(window.innerWidth, window.innerHeight) < 600;
  if (phoneTelegram) {
    tg.expand();
  }
  // On iOS a fullscreen header can cover the hero HUD even after safe-area
  // events. Use Telegram's native expanded sheet instead, as on normal Mini Apps.
  if (tg.isFullscreen && (iosTelegram || !phoneTelegram)) {
    try { tg.exitFullscreen?.(); } catch { /* Telegram may refuse this. */ }
  }
  // Prevent dragging/minimizing the Telegram Mini App by swiping on the game.
  // In-game inventory, sidebars and chat remain scrollable as usual.
  try {
    if (phoneTelegram && tg.disableVerticalSwipes && (!tg.isVersionAtLeast || tg.isVersionAtLeast('7.7'))) {
      tg.disableVerticalSwipes();
    }
  } catch {
    // Older Telegram versions may not support this setting.
  }
  updateTelegramViewport(tg);

  if (!viewportListenersAttached) {
    viewportListenersAttached = true;
    const refresh = () => updateTelegramViewport(tg);
    try {
      tg.onEvent?.('viewportChanged', refresh);
      tg.onEvent?.('fullscreenChanged', refresh);
      tg.onEvent?.('fullscreenFailed', refresh);
      tg.onEvent?.('safeAreaChanged', refresh);
      tg.onEvent?.('contentSafeAreaChanged', refresh);
    } catch {
      // Older Telegram versions may not expose all events.
    }
    window.addEventListener('resize', refresh);
    // A Telegram/keyboard resize may change only the visual viewport.
    window.visualViewport?.addEventListener('resize', refresh);
    window.addEventListener('pageshow', refresh);
  }

  // Android keeps its current fullscreen behavior. On iOS we deliberately use
  // the native expanded Telegram sheet so the close/header bar cannot overlap
  // the hero HUD on iPhone 14 Pro and other notched iPhones.
  try {
    if (phoneTelegram && !iosTelegram && tg.requestFullscreen && tg.isVersionAtLeast?.('8.0') && !tg.isFullscreen) {
      tg.requestFullscreen();
    }
  } catch {
    // Telegram can refuse fullscreen (e.g. older clients); layout still works.
  }

  try {
    tg.setHeaderColor('#0c1117');
    tg.setBackgroundColor('#0c1117');
  } catch {
    // ignore if not supported
  }
}

export function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'light') {
  const tg = getTelegramWebApp();
  tg?.HapticFeedback?.impactOccurred(style);
}

export function hapticNotify(type: 'error' | 'success' | 'warning') {
  const tg = getTelegramWebApp();
  tg?.HapticFeedback?.notificationOccurred(type);
}

export type { TelegramWebAppUser, TelegramWebApp };
