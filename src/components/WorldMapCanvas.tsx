import { memo, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, Compass, Hand, Layers3, LocateFixed, Minus, Plus, X } from 'lucide-react';
import { WoodenPlaque } from '@/components/ui/WoodenPlaque';
import './worldMapCanvas.css';

export type WorldMapRegion = 'forest' | 'mountain' | 'herbs' | 'hunting' | 'rare' | 'chamber';
export type WorldMapRoute = 'city' | 'arena' | 'shop' | 'forge' | 'professions' | 'auction'
  | 'inventory' | 'games' | 'hero' | 'battle' | 'clan' | 'friends' | 'quests' | 'messages' | 'events';
export type WorldMapPlace = WorldMapRegion | WorldMapRoute | 'runes' | 'trial' | 'companions';

type Place = {
  id: WorldMapPlace;
  ru: string;
  en: string;
  x: number;
  y: number;
  kind?: 'resource' | 'magic';
};

// Percentage coordinates on the owner-approved 1536 × 1024 background.
// Every destination uses an existing screen or existing server-backed region.
const PLACES: Place[] = [
  { id: 'city', ru: 'Замок', en: 'Castle', x: 51, y: 13 },
  { id: 'battle', ru: 'Приключения · 100 этапов', en: 'Adventure · 100 stages', x: 51, y: 27 },
  { id: 'arena', ru: 'Арена', en: 'Arena', x: 13, y: 27 },
  { id: 'mountain', ru: 'Рудники', en: 'Mines', x: 88, y: 24, kind: 'resource' },
  { id: 'auction', ru: 'Аукцион', en: 'Auction', x: 37, y: 36 },
  { id: 'hero', ru: 'Чертог героев', en: 'Hero hall', x: 56, y: 41 },
  { id: 'trial', ru: 'Испытания', en: 'Trials', x: 77, y: 19 },
  { id: 'chamber', ru: 'Чертог облика', en: 'Appearance', x: 12, y: 51, kind: 'magic' },
  { id: 'forge', ru: 'Кузница', en: 'Forge', x: 36, y: 52 },
  { id: 'professions', ru: 'Мастерские', en: 'Workshops', x: 60, y: 54 },
  { id: 'shop', ru: 'Лавка', en: 'Shop', x: 76, y: 54 },
  { id: 'hunting', ru: 'Охота', en: 'Hunting', x: 87, y: 50, kind: 'resource' },
  { id: 'forest', ru: 'Тёмный лес', en: 'Dark forest', x: 23, y: 18, kind: 'resource' },
  { id: 'herbs', ru: 'Травы', en: 'Herbs', x: 24, y: 65, kind: 'resource' },
  { id: 'inventory', ru: 'Склад', en: 'Storage', x: 41, y: 68 },
  { id: 'runes', ru: 'Руны', en: 'Runes', x: 68, y: 74, kind: 'magic' },
  { id: 'rare', ru: 'Пещеры', en: 'Caves', x: 92, y: 69, kind: 'resource' },
  { id: 'games', ru: 'Игровой порт', en: 'Game port', x: 22, y: 83 },
  { id: 'companions', ru: 'Спутники', en: 'Companions', x: 44, y: 85 },
];

// At minimum zoom only the primary hubs remain visible. The complete list
// stays one tap away in "All locations", and every pin returns at closer zoom.
const OVERVIEW_PLACES = new Set<WorldMapPlace>([
  'city', 'battle', 'arena', 'mountain', 'hero', 'forge', 'professions',
  'shop', 'inventory', 'runes', 'rare', 'games',
]);

// Sections without a distinctive building in this illustration are accessible
// from the compact places drawer; no dead-end decorative buttons.
const OTHER_PLACES: { id: WorldMapRoute; ru: string; en: string }[] = [
  { id: 'clan', ru: 'Клан', en: 'Clan' },
  { id: 'friends', ru: 'Друзья', en: 'Friends' },
  { id: 'quests', ru: 'Задания', en: 'Quests' },
  { id: 'messages', ru: 'Сообщения', en: 'Messages' },
  { id: 'events', ru: 'События', en: 'Events' },
];

type PlaceVisual = {
  art: string;
  tone: 'gold' | 'ember' | 'forest' | 'rune' | 'sea';
};

// All 24 locations have a real illustrated icon; reused approved navigation
// artwork stays unchanged, while missing places receive unique generated art.
const PLACE_VISUALS: Record<WorldMapPlace, PlaceVisual> = {
  city: { art: 'nav-city.webp', tone: 'gold' },
  arena: { art: 'ic-arena-viking.webp', tone: 'ember' },
  mountain: { art: 'assets/territory/map/icons/ore-cart-v1.webp', tone: 'gold' },
  auction: { art: 'ic-auction-viking.webp', tone: 'gold' },
  hero: { art: 'nav-hero-crown.webp', tone: 'rune' },
  trial: { art: 'ic-trials.webp', tone: 'ember' },
  chamber: { art: 'assets/territory/map/icons/appearance-mirror-v1.webp', tone: 'rune' },
  forge: { art: 'ic-forge.webp', tone: 'ember' },
  professions: { art: 'ic-professions-viking.webp', tone: 'gold' },
  shop: { art: 'ic-shop.webp', tone: 'gold' },
  hunting: { art: 'assets/territory/map/icons/hunting-bow-v1.webp', tone: 'forest' },
  forest: { art: 'assets/territory/map/icons/dark-forest-v1.webp', tone: 'forest' },
  herbs: { art: 'assets/territory/map/icons/herb-basket-v1.webp', tone: 'forest' },
  inventory: { art: 'nav-inventory.webp', tone: 'sea' },
  runes: { art: 'assets/territory/map/icons/rune-stones-v1.webp', tone: 'rune' },
  rare: { art: 'assets/territory/map/icons/crystal-cave-v1.webp', tone: 'rune' },
  games: { art: 'nav-games.webp', tone: 'sea' },
  companions: { art: 'assets/territory/map/icons/companions-v1.webp', tone: 'forest' },
  battle: { art: 'nav-battle.webp', tone: 'ember' },
  clan: { art: 'nav-clan.webp', tone: 'ember' },
  friends: { art: 'ic-invite.webp', tone: 'forest' },
  quests: { art: 'ic-quests.webp', tone: 'gold' },
  messages: { art: 'ic-mail.webp', tone: 'sea' },
  events: { art: 'ic-events.webp', tone: 'rune' },
};

const WORLD_WIDTH = 1536;
const WORLD_HEIGHT = 1024;
type View = { x: number; y: number; scale: number };
type Size = { width: number; height: number };
type CameraBookmark = { centerX: number; centerY: number; zoomRatio: number };
const CAMERA_STORAGE_KEY = 'territory-world-map-camera-v1';

function startingScale(width: number, height: number): number {
  return Math.max(width / WORLD_WIDTH, height / WORLD_HEIGHT) * 1.3;
}

function clampScale(scale: number, width: number, height: number): number {
  // At the minimum zoom the entire world fits, even on tall phone screens.
  // Keep the maximum high enough to inspect individual buildings.
  const min = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
  const max = startingScale(width, height) * 2.5;
  return Math.max(min, Math.min(max, scale));
}

function clampView(next: View, width: number, height: number): View {
  const contentWidth = WORLD_WIDTH * next.scale;
  const contentHeight = WORLD_HEIGHT * next.scale;
  return {
    ...next,
    x: contentWidth <= width ? (width - contentWidth) / 2 : Math.max(width - contentWidth, Math.min(0, next.x)),
    y: contentHeight <= height ? (height - contentHeight) / 2 : Math.max(height - contentHeight, Math.min(0, next.y)),
  };
}

function bookmarkCamera(view: View, size: Size): CameraBookmark {
  return {
    centerX: (size.width / 2 - view.x) / view.scale,
    centerY: (size.height / 2 - view.y) / view.scale,
    zoomRatio: view.scale / startingScale(size.width, size.height),
  };
}

function restoreCamera(bookmark: CameraBookmark, size: Size): View {
  const scale = clampScale(startingScale(size.width, size.height) * bookmark.zoomRatio, size.width, size.height);
  return clampView({
    scale,
    x: size.width / 2 - bookmark.centerX * scale,
    y: size.height / 2 - bookmark.centerY * scale,
  }, size.width, size.height);
}

function readCameraBookmark(): CameraBookmark | null {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(CAMERA_STORAGE_KEY) ?? 'null') as CameraBookmark | null;
    if (!saved || !Number.isFinite(saved.centerX) || !Number.isFinite(saved.centerY) || !Number.isFinite(saved.zoomRatio)) return null;
    if (saved.centerX < 0 || saved.centerX > WORLD_WIDTH || saved.centerY < 0 || saved.centerY > WORLD_HEIGHT) return null;
    if (saved.zoomRatio < 0.1 || saved.zoomRatio > 3) return null;
    return saved;
  } catch { return null; }
}

function sawPanHint(): boolean {
  try { return window.sessionStorage.getItem('territory-map-pan-seen') === 'yes'; }
  catch { return false; }
}

export const WorldMapCanvas = memo(function WorldMapCanvas({ onVisit, readyRegion, attentionPlaces = [], language }: {
  onVisit: (place: WorldMapPlace) => void;
  readyRegion?: WorldMapRegion;
  attentionPlaces?: readonly WorldMapPlace[];
  language: 'ru' | 'en';
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const viewRef = useRef<View>({ x: 0, y: 0, scale: 1 });
  const markerScaleRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const inertiaRef = useRef<number | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const cancelClick = useRef(false);
  const [hintVisible, setHintVisible] = useState(() => !sawPanHint());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const attentionSet = new Set<WorldMapPlace>(attentionPlaces);

  // Directly move one composited layer in requestAnimationFrame. React never
  // reconciles the 18 clickable landmarks on each pointermove (a major source
  // of stutter in Android Telegram WebView).
  const scheduleTransform = () => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const world = worldRef.current;
      if (!world) return;
      const { x, y, scale } = viewRef.current;
      world.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
      const { width, height } = sizeRef.current;
      if (width && height) {
        if (markerScaleRef.current !== scale) {
          world.style.setProperty('--map-marker-inverse', String(1 / scale));
          markerScaleRef.current = scale;
        }
        const relativeZoom = scale / startingScale(width, height);
        const mapMode = relativeZoom < 0.65 ? 'overview' : relativeZoom < 0.95 ? 'compact' : 'detail';
        if (world.dataset.mapMode !== mapMode) world.dataset.mapMode = mapMode;
        // Fade only at full-world zoom, joining the crisp map to its
        // softly extended illustrated backdrop.
        const fittedScale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
        const overview = scale <= fittedScale * 1.035;
        if (world.classList.contains('territory-world-map__world--overview') !== overview) {
          world.classList.toggle('territory-world-map__world--overview', overview);
        }
      }
      if (zoomLabelRef.current && width && height) {
        const label = `${Math.round(scale / startingScale(width, height) * 100)}%`;
        if (zoomLabelRef.current.textContent !== label) zoomLabelRef.current.textContent = label;
      }
    });
  };

  const moveWorld = (next: View) => {
    const { width, height } = sizeRef.current;
    viewRef.current = clampView(next, width, height);
    scheduleTransform();
  };

  const stopInertia = () => {
    if (inertiaRef.current !== null) window.cancelAnimationFrame(inertiaRef.current);
    inertiaRef.current = null;
  };

  // Android Telegram's WebView sometimes cancels pointer streams mid-swipe.
  // Non-passive native touch listeners keep one continuous finger gesture and
  // allow momentum after the finger is lifted, without React render work.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    type PanGesture = {
      kind: 'pan'; id: number; x: number; y: number; startX: number; startY: number;
      lastX: number; lastY: number; lastT: number;
      vx: number; vy: number; moved: boolean;
    };
    type PinchGesture = {
      kind: 'pinch'; ids: [number, number]; startDistance: number; startScale: number;
      worldX: number; worldY: number; left: number; top: number;
    };
    let gesture: PanGesture | PinchGesture | null = null;

    const markHintSeen = () => {
      setHintVisible(previous => {
        if (!previous) return false;
        try { window.sessionStorage.setItem('territory-map-pan-seen', 'yes'); } catch { /* Hint only. */ }
        return false;
      });
    };

    const beginPan = (finger: Touch, preserveClickCancellation = false) => {
      if (!preserveClickCancellation) cancelClick.current = false;
      const now = performance.now();
      gesture = {
        kind: 'pan', id: finger.identifier, x: finger.clientX, y: finger.clientY,
        startX: viewRef.current.x, startY: viewRef.current.y,
        lastX: finger.clientX, lastY: finger.clientY, lastT: now,
        vx: 0, vy: 0, moved: false,
      };
    };

    const beginPinch = (first: Touch, second: Touch) => {
      const bounds = viewport.getBoundingClientRect();
      const centerX = (first.clientX + second.clientX) / 2 - bounds.left;
      const centerY = (first.clientY + second.clientY) / 2 - bounds.top;
      const previous = viewRef.current;
      gesture = {
        kind: 'pinch', ids: [first.identifier, second.identifier],
        startDistance: Math.max(1, Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)),
        startScale: previous.scale,
        worldX: (centerX - previous.x) / previous.scale,
        worldY: (centerY - previous.y) / previous.scale,
        left: bounds.left, top: bounds.top,
      };
      cancelClick.current = true;
      markHintSeen();
    };

    const touchStart = (event: TouchEvent) => {
      stopInertia();
      if (event.touches.length === 2) beginPinch(event.touches[0], event.touches[1]);
      else if (event.touches.length === 1) beginPan(event.touches[0]);
      else gesture = null;
    };

    const touchMove = (event: TouchEvent) => {
      const current = gesture;
      if (!current) return;
      if (current.kind === 'pinch') {
        if (event.touches.length !== 2) return;
        const fingers = Array.from(event.touches);
        const first = fingers.find(item => item.identifier === current.ids[0]);
        const second = fingers.find(item => item.identifier === current.ids[1]);
        if (!first || !second) return;
        event.preventDefault();
        const { width, height } = sizeRef.current;
        if (!width || !height) return;
        const centerX = (first.clientX + second.clientX) / 2 - current.left;
        const centerY = (first.clientY + second.clientY) / 2 - current.top;
        const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
        const scale = clampScale(current.startScale * distance / current.startDistance, width, height);
        // The point between both fingers remains under the same world location.
        moveWorld({ scale, x: centerX - current.worldX * scale, y: centerY - current.worldY * scale });
        return;
      }
      if (event.touches.length !== 1) return;
      const finger = Array.from(event.touches).find(item => item.identifier === current.id);
      if (!finger) return;
      const dx = finger.clientX - current.x;
      const dy = finger.clientY - current.y;
      if (!current.moved && Math.abs(dx) + Math.abs(dy) > 5) {
        current.moved = true;
        markHintSeen();
      }
      if (!current.moved) return;
      event.preventDefault();
      moveWorld({ ...viewRef.current, x: current.startX + dx, y: current.startY + dy });
      const now = performance.now();
      const elapsed = now - current.lastT;
      if (elapsed >= 8) {
        const vx = Math.max(-2.5, Math.min(2.5, (finger.clientX - current.lastX) / elapsed));
        const vy = Math.max(-2.5, Math.min(2.5, (finger.clientY - current.lastY) / elapsed));
        current.vx = current.vx * 0.45 + vx * 0.55;
        current.vy = current.vy * 0.45 + vy * 0.55;
        current.lastX = finger.clientX;
        current.lastY = finger.clientY;
        current.lastT = now;
      }
    };

    const touchEnd = (event: TouchEvent) => {
      const current = gesture;
      if (!current) return;
      if (current.kind === 'pinch') {
        // Continue dragging with the remaining finger at the current position.
        if (event.touches.length === 1) beginPan(event.touches[0], true);
        else gesture = null;
        cancelClick.current = true;
        return;
      }
      if (!Array.from(event.changedTouches).some(item => item.identifier === current.id)) return;
      gesture = null;
      cancelClick.current = cancelClick.current || current.moved;
      if (!current.moved) return;
      if (performance.now() - current.lastT > 120) return;
      // Keep a direct, slow drag exact; only a flick gets extra travel.
      let vx = current.vx * 1.65;
      let vy = current.vy * 1.65;
      if (Math.hypot(vx, vy) < 0.22) return;
      let lastFrame = performance.now();
      const fling = (now: number) => {
        const dt = Math.min(32, now - lastFrame);
        lastFrame = now;
        const friction = Math.pow(0.94, dt / 16.67);
        vx *= friction;
        vy *= friction;
        const previous = viewRef.current;
        const desired = { ...previous, x: previous.x + vx * dt, y: previous.y + vy * dt };
        moveWorld(desired);
        if (Math.abs(viewRef.current.x - desired.x) > 0.5) vx = 0;
        if (Math.abs(viewRef.current.y - desired.y) > 0.5) vy = 0;
        if (Math.hypot(vx, vy) < 0.04) { inertiaRef.current = null; return; }
        inertiaRef.current = window.requestAnimationFrame(fling);
      };
      inertiaRef.current = window.requestAnimationFrame(fling);
    };

    const touchCancel = () => { gesture = null; cancelClick.current = true; };
    viewport.addEventListener('touchstart', touchStart, { passive: true });
    viewport.addEventListener('touchmove', touchMove, { passive: false });
    viewport.addEventListener('touchend', touchEnd, { passive: true });
    viewport.addEventListener('touchcancel', touchCancel, { passive: true });
    return () => {
      viewport.removeEventListener('touchstart', touchStart);
      viewport.removeEventListener('touchmove', touchMove);
      viewport.removeEventListener('touchend', touchEnd);
      viewport.removeEventListener('touchcancel', touchCancel);
      stopInertia();
    };
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = (width: number, height: number) => {
      if (width === 0 || height === 0) return;
      const previousSize = sizeRef.current;
      if (previousSize.width === width && previousSize.height === height) return;
      sizeRef.current = { width, height };
      if (previousSize.width === 0) {
        const bookmark = readCameraBookmark();
        if (bookmark) {
          viewRef.current = restoreCamera(bookmark, { width, height });
        } else {
          const scale = startingScale(width, height);
          viewRef.current = clampView({ x: (width - WORLD_WIDTH * scale) / 2, y: (height - WORLD_HEIGHT * scale) / 2, scale }, width, height);
        }
      } else {
        // Keep the same world point in the centre when Telegram changes the
        // viewport size (including iPhone safe areas and rotation).
        viewRef.current = restoreCamera(bookmarkCamera(viewRef.current, previousSize), { width, height });
      }
      scheduleTransform();
    };
    const persistCamera = () => {
      const size = sizeRef.current;
      if (!size.width || !size.height) return;
      try { window.sessionStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(bookmarkCamera(viewRef.current, size))); }
      catch { /* Visual preference only, never player progress. */ }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persistCamera();
    };
    const initial = viewport.getBoundingClientRect();
    resize(initial.width, initial.height);
    const observer = new ResizeObserver(([entry]) => {
      resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(viewport);
    window.addEventListener('pagehide', persistCamera);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      persistCamera();
      window.removeEventListener('pagehide', persistCamera);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      observer.disconnect();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, []);

  const recenter = () => {
    stopInertia();
    const { width, height } = sizeRef.current;
    if (!width || !height) return;
    const scale = startingScale(width, height);
    moveWorld({ x: (width - WORLD_WIDTH * scale) / 2, y: (height - WORLD_HEIGHT * scale) / 2, scale });
  };

  const zoom = (factor: number) => {
    stopInertia();
    const { width, height } = sizeRef.current;
    if (!width || !height) return;
    const previous = viewRef.current;
    const scale = clampScale(previous.scale * factor, width, height);
    const ratio = scale / previous.scale;
    moveWorld({ scale, x: width / 2 - (width / 2 - previous.x) * ratio, y: height / 2 - (height / 2 - previous.y) * ratio });
  };

  const stopDrag = (pointerId: number) => {
    const active = drag.current;
    if (!active || active.pointerId !== pointerId) return;
    cancelClick.current = active.moved;
    drag.current = null;
    if (viewportRef.current) viewportRef.current.style.cursor = 'grab';
  };

  const visit = (id: WorldMapPlace) => {
    setDrawerOpen(false);
    onVisit(id);
  };

  const renderDestination = (place: { id: WorldMapPlace; ru: string; en: string }) => {
    const visual = PLACE_VISUALS[place.id];
    const hasAttention = readyRegion === place.id || attentionSet.has(place.id);
    return (
      <button
        key={place.id}
        type="button"
        className={`territory-world-map__destination territory-world-map__destination--${visual.tone} ${hasAttention ? 'territory-world-map__destination--attention' : ''}`}
        onClick={() => visit(place.id)}
        aria-label={language === 'en' ? place.en : place.ru}
      >
        <span className="territory-world-map__destination-crest" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}${visual.art}`} alt="" draggable={false} loading="lazy" decoding="async" />
        </span>
        <span className="territory-world-map__destination-name">{language === 'en' ? place.en : place.ru}</span>
        {hasAttention && <span className="territory-world-map__destination-alert" aria-label={language === 'en' ? 'Action available' : 'Есть действие'}>!</span>}
        <ChevronRight className="territory-world-map__destination-arrow" size={15} strokeWidth={2.4} aria-hidden="true" />
      </button>
    );
  };

  return (
    <section className="territory-world-map relative h-full min-h-0 w-full overflow-hidden bg-[#547e66]" aria-label={language === 'en' ? 'Interactive world map' : 'Интерактивная карта мира'}>
      <div
        className="territory-world-map__backdrop"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}assets/territory/map/world-map-v1-20261027.webp)` }}
        aria-hidden="true"
      />
      <div
        ref={viewportRef}
        className="absolute inset-0 select-none"
        style={{ touchAction: 'none', overscrollBehavior: 'contain', cursor: 'grab' }}
        onPointerDown={event => {
          if (event.pointerType === 'touch') return; // Native touch gestures handle mobile WebViews.
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          if (drag.current) return;
          stopInertia();
          cancelClick.current = false;
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: viewRef.current.x, startY: viewRef.current.y, moved: false };
        }}
        onPointerMove={event => {
          if (event.pointerType === 'touch') return;
          const active = drag.current;
          if (!active || active.pointerId !== event.pointerId) return;
          const dx = event.clientX - active.x;
          const dy = event.clientY - active.y;
          if (Math.abs(dx) + Math.abs(dy) > 8) {
            if (!active.moved) {
              event.currentTarget.setPointerCapture(event.pointerId);
              event.currentTarget.style.cursor = 'grabbing';
            }
            active.moved = true;
            if (hintVisible) {
              setHintVisible(false);
              try { window.sessionStorage.setItem('territory-map-pan-seen', 'yes'); } catch { /* Optional hint only. */ }
            }
          }
          if (active.moved) {
            moveWorld({ ...viewRef.current, x: active.startX + dx, y: active.startY + dy });
          }
        }}
        onPointerUp={event => stopDrag(event.pointerId)}
        onPointerCancel={event => stopDrag(event.pointerId)}
        onLostPointerCapture={event => stopDrag(event.pointerId)}
        onClickCapture={event => {
          if (cancelClick.current) {
            event.preventDefault();
            event.stopPropagation();
            cancelClick.current = false;
          }
        }}
      >
        <div
          ref={worldRef}
          className="territory-world-map__world absolute left-0 top-0 will-change-transform"
          style={{ width: WORLD_WIDTH, height: WORLD_HEIGHT, transform: 'translate3d(0,0,0) scale(1)', transformOrigin: 'top left' }}
        >
          <img
            src={`${import.meta.env.BASE_URL}assets/territory/map/world-map-v1-20261027.webp`}
            alt=""
            draggable={false}
            className="h-full w-full select-none object-cover pointer-events-none"
          />
          {PLACES.map(place => {
            const resourceReady = readyRegion === place.id;
            const hasNotice = attentionSet.has(place.id);
            const hasAttention = resourceReady || hasNotice;
            return (
              <button
                key={place.id}
                type="button"
                className={`territory-world-map__place ${place.kind === 'magic' ? 'territory-world-map__place--magic' : ''} ${OVERVIEW_PLACES.has(place.id) ? '' : 'territory-world-map__place--minor'} ${resourceReady ? 'territory-world-map__place--ready' : hasNotice ? 'territory-world-map__place--notice' : ''}`}
                style={{ left: `${place.x}%`, top: `${place.y}%` }}
                onClick={() => visit(place.id)}
                aria-label={`${language === 'en' ? 'Open' : 'Открыть'}: ${language === 'en' ? place.en : place.ru}${hasAttention ? language === 'en' ? ' — action available' : ' — есть действие' : ''}`}
              >
                <span className="territory-world-map__place-icon" aria-hidden="true">
                  <img src={`${import.meta.env.BASE_URL}${PLACE_VISUALS[place.id].art}`} alt="" draggable={false} loading="lazy" decoding="async" />
                </span>
                <span className="territory-world-map__place-name">{language === 'en' ? place.en : place.ru}</span>
                {hasAttention && <span className="territory-world-map__place-attention" aria-hidden="true">!</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col items-start gap-1">
        <WoodenPlaque>{language === 'en' ? 'World map' : 'Карта мира'}</WoodenPlaque>
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#10251a]/65 px-2 py-1 text-[10px] font-semibold text-[#fff2c9] shadow-sm backdrop-blur-sm">
          <Compass size={12} /> {language === 'en' ? 'Explore by swiping' : 'Исследуй земли'}
        </span>
      </div>

      <div className="absolute right-2 top-3 z-20 flex flex-col gap-2">
        <button type="button" className="territory-world-map__control relative" onClick={() => setDrawerOpen(true)} aria-label={language === 'en' ? 'All locations' : 'Все места'}>
          <Layers3 size={18} />
          {(attentionPlaces.length > 0 || !!readyRegion) && <span className="territory-world-map__control-alert" aria-hidden="true" />}
        </button>
        <button type="button" className="territory-world-map__control" onClick={() => zoom(1.35)} aria-label={language === 'en' ? 'Zoom in' : 'Приблизить'}><Plus size={19} /></button>
        <span ref={zoomLabelRef} className="territory-world-map__zoom-label" aria-label={language === 'en' ? 'Map zoom level' : 'Масштаб карты'}>100%</span>
        <button type="button" className="territory-world-map__control" onClick={() => zoom(1 / 1.35)} aria-label={language === 'en' ? 'Zoom out' : 'Отдалить'}><Minus size={19} /></button>
        <button type="button" className="territory-world-map__control" onClick={recenter} aria-label={language === 'en' ? 'Center map' : 'В центр карты'}><LocateFixed size={18} /></button>
      </div>

      {hintVisible && !drawerOpen && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-amber-200/40 bg-[#281b0f]/85 px-3 py-2 text-center text-xs font-bold text-amber-50 shadow-xl backdrop-blur-sm">
          <Hand size={24} className="territory-world-map__hint-hand mx-auto mb-1 text-amber-200" />
          {language === 'en' ? 'Drag to explore · pinch to zoom' : 'Двигай пальцем · масштабируй двумя'}
        </div>
      )}

      {drawerOpen && (
        <div className="absolute inset-0 z-30 flex items-end bg-black/55" onClick={() => setDrawerOpen(false)}>
          <div className="territory-world-map__drawer flex max-h-[78%] w-full flex-col overflow-hidden rounded-t-2xl p-3 shadow-2xl" onClick={event => event.stopPropagation()} role="dialog" aria-label={language === 'en' ? 'All locations' : 'Все места'}>
            <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
              <WoodenPlaque>{language === 'en' ? 'All locations' : 'Все места'}</WoodenPlaque>
              <button type="button" className="territory-world-map__drawer-close" onClick={() => setDrawerOpen(false)} aria-label={language === 'en' ? 'Close' : 'Закрыть'}><X size={20} /></button>
            </div>
            <div className="territory-world-map__drawer-scroll min-h-0 overflow-y-auto pb-2">
              <p className="territory-world-map__drawer-section">{language === 'en' ? 'Discover on the map' : 'Места на карте'}</p>
              <div className="grid grid-cols-2 gap-2">
                {PLACES.map(renderDestination)}
              </div>
              <p className="territory-world-map__drawer-section mt-3">{language === 'en' ? 'Other destinations' : 'Другие разделы'}</p>
              <div className="grid grid-cols-2 gap-2">
                {OTHER_PLACES.map(renderDestination)}
              </div>
              <p className="mt-3 text-center text-[10px] font-medium text-amber-100/70">{language === 'en' ? 'Runes are in Hero → Combat training.' : 'Руны находятся в разделе «Герой» → «Тренировка».'}</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
