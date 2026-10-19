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
  isFullscreen?: boolean;
  isVersionAtLeast?: (version: string) => boolean;
  requestFullscreen?: () => void;
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
  // Telegram's stable height excludes the native header in sheet mode.
  // It also updates when the user expands the sheet or enters fullscreen.
  if (Number.isFinite(tg.viewportStableHeight) && tg.viewportStableHeight > 0) {
    root.style.setProperty('--territory-viewport-height', `${tg.viewportStableHeight}px`);
  } else {
    root.style.removeProperty('--territory-viewport-height');
  }

  // Insets are only subtracted for actual fullscreen: outside fullscreen,
  // Telegram has already reserved the area occupied by its native header.
  const inset = (edge: 'top' | 'bottom') => tg.isFullscreen
    ? Math.max(0, (tg.safeAreaInset?.[edge] ?? 0) + (tg.contentSafeAreaInset?.[edge] ?? 0))
    : 0;
  root.style.setProperty('--territory-top-inset', `${inset('top')}px`);
  root.style.setProperty('--territory-bottom-inset', `${inset('bottom')}px`);
}

export function initTelegramWebApp() {
  const tg = getTelegramWebApp();
  if (!tg) return;

  // The game scrolls inside its own panels, not the outer browser page.
  document.documentElement.classList.add('territory-telegram-webapp');

  tg.ready();
  tg.expand();
  // Prevent dragging/minimizing the Telegram Mini App by swiping on the game.
  // In-game inventory, sidebars and chat remain scrollable as usual.
  try {
    if (tg.disableVerticalSwipes && (!tg.isVersionAtLeast || tg.isVersionAtLeast('7.7'))) {
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
  }

  // Fullscreen is an enhancement, not a requirement: unsupported iOS/Android
  // clients continue using the stable-height, scrollable layout.
  try {
    if (tg.requestFullscreen && tg.isVersionAtLeast?.('8.0') && !tg.isFullscreen) {
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
