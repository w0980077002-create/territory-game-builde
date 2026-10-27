import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass, Hand, Layers3, LocateFixed, Minus, Plus, X } from 'lucide-react';
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

// Sections without a distinctive building in this illustration are accessible
// from the compact places drawer; no dead-end decorative buttons.
const OTHER_PLACES: { id: WorldMapRoute; ru: string; en: string }[] = [
  { id: 'battle', ru: 'Поход', en: 'Campaign' },
  { id: 'clan', ru: 'Клан', en: 'Clan' },
  { id: 'friends', ru: 'Друзья', en: 'Friends' },
  { id: 'quests', ru: 'Задания', en: 'Quests' },
  { id: 'messages', ru: 'Сообщения', en: 'Messages' },
  { id: 'events', ru: 'События', en: 'Events' },
];

const WORLD_WIDTH = 1536;
const WORLD_HEIGHT = 1024;
type View = { x: number; y: number; scale: number };

function startingScale(width: number, height: number): number {
  return Math.max(width / WORLD_WIDTH, height / WORLD_HEIGHT) * 1.3;
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

function sawPanHint(): boolean {
  try { return window.sessionStorage.getItem('territory-map-pan-seen') === 'yes'; }
  catch { return false; }
}

export function WorldMapCanvas({ onVisit, readyRegion, language }: {
  onVisit: (place: WorldMapPlace) => void;
  readyRegion?: WorldMapRegion;
  language: 'ru' | 'en';
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const initialized = useRef(false);
  const drag = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const cancelClick = useRef(false);
  const [hintVisible, setHintVisible] = useState(() => !sawPanHint());
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      if (width === 0 || height === 0) return;
      setSize({ width, height });
      if (!initialized.current) {
        const scale = startingScale(width, height);
        setView(clampView({ x: (width - WORLD_WIDTH * scale) / 2, y: (height - WORLD_HEIGHT * scale) / 2, scale }, width, height));
        initialized.current = true;
      } else {
        setView(previous => clampView(previous, width, height));
      }
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const recenter = useCallback(() => {
    if (!size.width || !size.height) return;
    const scale = startingScale(size.width, size.height);
    setView(clampView({ x: (size.width - WORLD_WIDTH * scale) / 2, y: (size.height - WORLD_HEIGHT * scale) / 2, scale }, size.width, size.height));
  }, [size]);

  const zoom = (factor: number) => {
    const min = startingScale(size.width, size.height);
    setView(previous => {
      const scale = Math.max(min, Math.min(min * 2.2, previous.scale * factor));
      const ratio = scale / previous.scale;
      return clampView({
        scale,
        x: size.width / 2 - (size.width / 2 - previous.x) * ratio,
        y: size.height / 2 - (size.height / 2 - previous.y) * ratio,
      }, size.width, size.height);
    });
  };

  const stopDrag = (pointerId: number) => {
    const active = drag.current;
    if (!active || active.pointerId !== pointerId) return;
    cancelClick.current = active.moved;
    drag.current = null;
  };

  const visit = (id: WorldMapPlace) => {
    setDrawerOpen(false);
    onVisit(id);
  };

  return (
    <section className="territory-world-map relative h-full min-h-0 w-full overflow-hidden bg-[#547e66]" aria-label={language === 'en' ? 'Interactive world map' : 'Интерактивная карта мира'}>
      <div
        ref={viewportRef}
        className="absolute inset-0 select-none"
        style={{ touchAction: 'none', cursor: drag.current ? 'grabbing' : 'grab' }}
        onPointerDown={event => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          if (drag.current) return;
          cancelClick.current = false;
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: view.x, startY: view.y, moved: false };
        }}
        onPointerMove={event => {
          const active = drag.current;
          if (!active || active.pointerId !== event.pointerId) return;
          const dx = event.clientX - active.x;
          const dy = event.clientY - active.y;
          if (Math.abs(dx) + Math.abs(dy) > 8) {
            if (!active.moved) event.currentTarget.setPointerCapture(event.pointerId);
            active.moved = true;
            if (hintVisible) {
              setHintVisible(false);
              try { window.sessionStorage.setItem('territory-map-pan-seen', 'yes'); } catch { /* Optional hint only. */ }
            }
          }
          if (active.moved) {
            setView(previous => clampView({ ...previous, x: active.startX + dx, y: active.startY + dy }, size.width, size.height));
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
          className="absolute left-0 top-0 will-change-transform"
          style={{ width: WORLD_WIDTH, height: WORLD_HEIGHT, transform: `translate3d(${view.x}px,${view.y}px,0) scale(${view.scale})`, transformOrigin: 'top left' }}
        >
          <img
            src={`${import.meta.env.BASE_URL}assets/territory/map/world-map-v1-20261027.webp`}
            alt=""
            draggable={false}
            className="h-full w-full select-none object-cover pointer-events-none"
          />
          {PLACES.map(place => (
            <button
              key={place.id}
              type="button"
              className={`territory-world-map__place ${place.kind === 'magic' ? 'territory-world-map__place--magic' : ''} ${readyRegion === place.id ? 'territory-world-map__place--ready' : ''}`}
              style={{ left: `${place.x}%`, top: `${place.y}%` }}
              onClick={() => visit(place.id)}
              aria-label={`${language === 'en' ? 'Open' : 'Открыть'}: ${language === 'en' ? place.en : place.ru}`}
            >
              <span className="territory-world-map__place-dot" aria-hidden="true" />
              <span className="territory-world-map__place-name">{language === 'en' ? place.en : place.ru}</span>
              {readyRegion === place.id && <span className="territory-world-map__place-ready">{language === 'en' ? 'Ready!' : 'Готово!'}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col items-start gap-1">
        <WoodenPlaque>{language === 'en' ? 'World map' : 'Карта мира'}</WoodenPlaque>
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#10251a]/65 px-2 py-1 text-[10px] font-semibold text-[#fff2c9] shadow-sm backdrop-blur-sm">
          <Compass size={12} /> {language === 'en' ? 'Explore by swiping' : 'Исследуй земли'}
        </span>
      </div>

      <div className="absolute right-2 top-3 z-20 flex flex-col gap-2">
        <button type="button" className="territory-world-map__control" onClick={() => setDrawerOpen(true)} aria-label={language === 'en' ? 'All locations' : 'Все места'}><Layers3 size={18} /></button>
        <button type="button" className="territory-world-map__control" onClick={() => zoom(1.25)} aria-label={language === 'en' ? 'Zoom in' : 'Приблизить'}><Plus size={18} /></button>
        <button type="button" className="territory-world-map__control" onClick={() => zoom(0.8)} aria-label={language === 'en' ? 'Zoom out' : 'Отдалить'}><Minus size={18} /></button>
        <button type="button" className="territory-world-map__control" onClick={recenter} aria-label={language === 'en' ? 'Center map' : 'В центр карты'}><LocateFixed size={18} /></button>
      </div>

      {hintVisible && !drawerOpen && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-amber-200/40 bg-[#281b0f]/85 px-3 py-2 text-center text-xs font-bold text-amber-50 shadow-xl backdrop-blur-sm">
          <Hand size={24} className="territory-world-map__hint-hand mx-auto mb-1 text-amber-200" />
          {language === 'en' ? 'Drag the map with your finger' : 'Двигай карту пальцем'}
        </div>
      )}

      {drawerOpen && (
        <div className="absolute inset-0 z-30 flex items-end bg-black/45" onClick={() => setDrawerOpen(false)}>
          <div className="max-h-[70%] w-full overflow-y-auto rounded-t-2xl border-t border-amber-400/50 bg-[#1b211b]/95 p-3 shadow-2xl" onClick={event => event.stopPropagation()} role="dialog" aria-label={language === 'en' ? 'All locations' : 'Все места'}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="font-bold text-amber-100">{language === 'en' ? 'All locations' : 'Все места'}</h3>
              <button type="button" className="rounded-lg p-2 text-amber-100" onClick={() => setDrawerOpen(false)} aria-label={language === 'en' ? 'Close' : 'Закрыть'}><X size={19} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[...PLACES, ...OTHER_PLACES].map(place => (
                <button key={place.id} type="button" className="rounded-xl border border-amber-400/20 bg-[#3c3425]/70 px-3 py-2 text-left text-xs font-semibold text-amber-50 active:bg-amber-800/40" onClick={() => visit(place.id)}>
                  {language === 'en' ? place.en : place.ru}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-amber-100/65">{language === 'en' ? 'Runes are in Hero → Combat training.' : 'Руны сейчас находятся в разделе «Герой» → «Тренировка».'}</p>
          </div>
        </div>
      )}
    </section>
  );
}
