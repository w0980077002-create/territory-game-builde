import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Lock, Sparkles, Crown, Check, BellRing } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { supabase } from '@/game/supabase';
import { notifyGatherStatusChanged } from '@/game/gatherNotice';
import { useLanguage, localizeText } from '@/game/i18n';
import { APPEARANCE_PRESETS, MALE_PRESETS, FEMALE_PRESETS, getPlayableAppearance, type AppearancePreset } from '@/game/appearance';
import type { InventoryItem } from '@/game/types';
import { RESOURCE_DEFINITIONS, type ResourceId } from '@/game/professions';
import { resourceArt } from '@/game/art';
import { WorldMapCanvas, type WorldMapPlace, type WorldMapRoute } from '@/components/WorldMapCanvas';

type GatherStatus = {
  active: { resource_id: string; finishes_at: string } | null;
  wallet: Record<string, number>;
  server_now: string;
};

function timeRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type RegionId = 'forest' | 'mountain' | 'herbs' | 'hunting' | 'rare';
type LocationId = RegionId | 'chamber';

interface Region {
  id: RegionId;
  name: string;
  icon: string;
  desc: string;
  resources: { id: ResourceId; name: string; icon: string }[];
  accent: string;
  glow: string;
}

const REGIONS: Region[] = [
  {
    id: 'forest',
    name: 'Тёмный лес',
    icon: '/map-forest.webp',
    desc: 'Густые чащи скрывают древнюю древесину и дикорастущие корни.',
    resources: [
      { id: 'gather-wood', name: 'Древесина', icon: '🪵' },
      { id: 'gather-herb', name: 'Лекарственные травы', icon: '🌿' },
    ],
    accent: 'from-emerald-700/40 to-emerald-950/60',
    glow: 'emerald',
  },
  {
    id: 'mountain',
    name: 'Северные рудники',
    icon: '/map-mountain.webp',
    desc: 'Холодные пики хранят руду, камень и драгоценные минералы.',
    resources: [
      { id: 'gather-ore', name: 'Железная руда', icon: '⛏️' },
      { id: 'gather-crystal', name: 'Магический кристалл', icon: '💎' },
    ],
    accent: 'from-stone-600/40 to-stone-900/60',
    glow: 'stone',
  },
  {
    id: 'herbs',
    name: 'Травяные дебри',
    icon: '/map-herbs.webp',
    desc: 'Туманные луга с лечебными травами и алхимическими ингредиентами.',
    resources: [
      { id: 'gather-herb', name: 'Лекарственные травы', icon: '🌿' },
    ],
    accent: 'from-lime-700/40 to-green-950/60',
    glow: 'lime',
  },
  {
    id: 'hunting',
    name: 'Охотничьи угодья',
    icon: '/map-hunting.webp',
    desc: 'Дикие земли, где добывают шкуры, кости и охотничьи трофеи.',
    resources: [
      { id: 'gather-hide', name: 'Шкура', icon: '🐾' },
    ],
    accent: 'from-amber-800/40 to-amber-950/60',
    glow: 'amber',
  },
  {
    id: 'rare',
    name: 'Затерянные пещеры',
    icon: '/map-rare.webp',
    desc: 'Опасные глубины с редкими кристаллами и древними артефактами.',
    resources: [
      { id: 'gather-crystal', name: 'Магический кристалл', icon: '💎' },
    ],
    accent: 'from-sky-700/40 to-indigo-950/60',
    glow: 'sky',
  },
];

export function MapScreen({ onNavigate, onTrial, onCave, onCompanions, onRunes, attentionPlaces }: {
  onNavigate: (route: WorldMapRoute) => void;
  onTrial: () => void;
  onCave: () => void;
  onCompanions: () => void;
  onRunes: () => void;
  attentionPlaces?: readonly WorldMapPlace[];
}) {
  const [selected, setSelected] = useState<LocationId | null>(null);
  const [notice, setNotice] = useState('');
  const { t, language } = useLanguage();
  const [gather, setGather] = useState<GatherStatus | null>(null);
  const [gatherBusy, setGatherBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);

  const refreshGather = async () => {
    const { data, error } = await supabase.rpc('territory_gather_status');
    if (error || !data || typeof data !== 'object') throw new Error('server_unavailable');
    const status = data as GatherStatus;
    setGather(status);
    setServerOffset(Date.parse(status.server_now) - Date.now());
    setClock(Date.now());
    notifyGatherStatusChanged();
    return status;
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('territory_gather_status');
        if (!cancelled && !error && data && typeof data === 'object') {
          const status = data as GatherStatus;
          setGather(status);
          setServerOffset(Date.parse(status.server_now) - Date.now());
          setClock(Date.now());
        }
      } catch { /* Keep resource actions disabled if server is not configured. */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // A four-hour gather should not re-render the whole map 14,400 times.
  // Tick each second only while the resource detail is open; otherwise schedule
  // one wake-up near completion. Return from Telegram's background state is
  // handled below so a throttled timer cannot hide a finished gather.
  useEffect(() => {
    if (!gather?.active) return;
    const finishesAt = gather.active.finishes_at;
    const dueAt = Date.parse(finishesAt) - serverOffset;
    if (!Number.isFinite(dueAt)) return;
    const detailOpen = selected !== null && selected !== 'chamber';
    if (detailOpen) {
      const interval = window.setInterval(() => setClock(Date.now()), 1000);
      return () => window.clearInterval(interval);
    }
    const delay = dueAt - Date.now();
    if (delay <= 0) {
      setClock(Date.now());
      return;
    }
    const wakeup = window.setTimeout(() => setClock(Date.now()), Math.min(delay + 20, 2_147_483_647));
    return () => window.clearTimeout(wakeup);
  }, [gather?.active?.finishes_at, serverOffset, selected]);

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'visible') setClock(Date.now());
    };
    document.addEventListener('visibilitychange', onReturn);
    return () => document.removeEventListener('visibilitychange', onReturn);
  }, []);

  const remainingMs = gather?.active
    ? Math.max(0, Date.parse(gather.active.finishes_at) - (clock + serverOffset))
    : 0;

  const readyRegion = gather?.active && remainingMs === 0
    ? REGIONS.find((region) => region.resources.some((resource) => resource.id === gather.active?.resource_id))
    : undefined;

  const resourceButtonLabel = (id: ResourceId): string => {
    if (!gather) return language === 'en' ? 'Server unavailable' : 'Сервер недоступен';
    if (!gather.active) return language === 'en' ? 'Start · 4h' : 'Начать · 4 ч';
    if (gather.active.resource_id !== id) return language === 'en' ? 'Occupied' : 'Занято';
    if (remainingMs === 0) return language === 'en' ? 'Claim' : 'Забрать';
    return timeRemaining(remainingMs);
  };

  const gatherResource = async (regionResource: Region['resources'][number]) => {
    if (!gather || gatherBusy) return;
    setGatherBusy(true);
    try {
      const resource = RESOURCE_DEFINITIONS.find((item) => item.id === regionResource.id);
      if (!resource) return;
      if (!gather.active) {
        const { data, error } = await supabase.rpc('territory_gather_start', { p_resource_id: resource.id });
        if (error || data?.error) throw new Error('start_failed');
        setNotice(language === 'en' ? 'Gathering started. Return in 4 hours.' : 'Добыча началась. Вернитесь через 4 часа.');
      } else if (gather.active.resource_id !== resource.id) {
        setNotice(language === 'en' ? 'Only one gathering action at a time.' : 'Можно добывать только один ресурс одновременно.');
      } else if (Math.max(0, Date.parse(gather.active.finishes_at) - (Date.now() + serverOffset)) > 0) {
        const latestRemainingMs = Math.max(0, Date.parse(gather.active.finishes_at) - (Date.now() + serverOffset));
        setNotice(`${language === 'en' ? 'Time left' : 'Осталось'}: ${timeRemaining(latestRemainingMs)}`);
      } else {
        const { data, error } = await supabase.rpc('territory_gather_claim');
        if (error || data?.error || data?.resource_id !== resource.id) throw new Error('claim_failed');
        const quantity = Number(data.quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('invalid_reward');
        // Mirror the server-confirmed resource count to the existing game inventory.
        // The protected wallet remains the authority for gathering rewards.
        const current = useGame.get();
        const inventory = current.inventory.filter((item) => !(item.id === resource.id && item.type === 'material'));
        const refreshed: InventoryItem[] = [...inventory, {
          id: resource.id, name: resource.name, icon: resource.icon,
          type: 'material', rarity: resource.rarity, qty: quantity,
          description: t('resourceDescription'),
        }];
        useGame.set({ ...current, inventory: refreshed });
        setNotice(`${t('gathered')}: ${localizeText(resource.name, language)} ×1`);
      }
      await refreshGather();
    } catch {
      setNotice(language === 'en'
        ? 'Could not confirm the result. Reopen the map to check the server status.'
        : 'Не удалось подтвердить результат. Откройте карту заново, чтобы проверить состояние на сервере.');
    } finally {
      setGatherBusy(false);
    }
  };

  const handleWorldVisit = useCallback((place: WorldMapPlace) => {
    switch (place) {
      case 'forest':
      case 'mountain':
      case 'herbs':
      case 'hunting':
      case 'rare':
      case 'chamber':
        setNotice('');
        setSelected(place);
        break;
      case 'trial': onTrial(); break;
      case 'cave': onCave(); break;
      case 'companions': onCompanions(); break;
      case 'runes': onRunes(); break;
      default: onNavigate(place);
    }
  }, [onTrial, onCave, onCompanions, onRunes, onNavigate]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <WorldMapCanvas onVisit={handleWorldVisit} readyRegion={readyRegion?.id} attentionPlaces={attentionPlaces} language={language} />
      {/* Separate Dark Cave entrance; never replaces the old campaign. */}
      <button
        type="button"
        data-testid="map-server-adventure-entry"
        onClick={onCave}
        className="absolute left-2 top-[76px] z-20 flex max-w-[calc(100%-76px)] items-center gap-2 rounded-xl border border-amber-300/70 bg-[#3e2514]/95 px-3 py-2.5 text-left text-amber-50 shadow-[0_5px_20px_rgba(0,0,0,0.45)] backdrop-blur-sm active:scale-[0.98]"
        aria-label={language === 'en' ? 'Dark Cave: 100 stages' : 'Тёмная пещера: 100 этапов'}
      >
        <img src={`${import.meta.env.BASE_URL}map-chamber.webp`} alt="" className="h-9 w-9 shrink-0 object-contain" />
        <span className="flex flex-col gap-0.5 leading-tight">
          <span className="text-[13px] font-black">{language === 'en' ? 'Dark Cave' : 'Тёмная пещера'}</span>
          <span className="text-[11px] font-semibold text-amber-200">{language === 'en' ? '100 stages · separate campaign' : '100 этапов · отдельный поход'}</span>
        </span>
      </button>
      {readyRegion && (
        <button
          type="button"
          onClick={() => handleWorldVisit(readyRegion.id)}
          className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-xl border border-emerald-200/75 bg-emerald-950/85 px-3 py-2 text-left text-xs font-bold text-emerald-100 shadow-xl backdrop-blur-sm"
        >
          <BellRing className="h-4 w-4 animate-pulse text-emerald-300" />
          {language === 'en' ? 'Resources ready — claim' : 'Добыча готова — забрать'}
        </button>
      )}

      {/* Region detail modal */}
      {selected && selected !== 'chamber' && (() => {
        const r = REGIONS.find((reg) => reg.id === selected)!;
        return (
          <Modal title={language === 'en' ? ({ forest: t('gatherForest'), mountain: t('gatherMines'), herbs: t('gatherHerbs'), hunting: t('gatherHunting'), rare: t('gatherCaves') } as Record<string, string>)[r.id] : r.name} icon={r.icon} onClose={() => setSelected(null)}>
            <div className="space-y-4">
              <div className="rounded-xl overflow-hidden border border-white/10">
                <img src={r.icon} alt="" className="w-full h-32 object-cover" />
              </div>
              <p className="text-sm text-gray-300">{language === 'en' ? ({ forest: t('gatherForestDesc'), mountain: t('gatherMinesDesc'), herbs: t('gatherHerbsDesc'), hunting: t('gatherHuntingDesc'), rare: t('gatherCavesDesc') } as Record<string, string>)[r.id] : r.desc}</p>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t('gatherResources')}</p>
                <div className="grid grid-cols-3 gap-2">
                  {r.resources.map((res) => {
                    const count = gather?.wallet?.[res.id] ?? 0;
                    return (
                      <button
                        key={res.id}
                        type="button"
                        onClick={() => gatherResource(res)}
                        disabled={!gather || gatherBusy || (!!gather.active && gather.active.resource_id !== res.id)}
                        className="rounded-xl border border-emerald-400/20 bg-black/30 p-3 flex flex-col items-center gap-1 active:scale-95 transition-transform"
                      >
                        <img src={resourceArt(res.id)} alt="" className="h-10 w-10 object-contain" />
                        <span className="text-[11px] font-semibold text-gray-200 text-center leading-tight">{language === 'en' ? ({ 'gather-wood': t('wood'), 'gather-herb': t('healingHerbs'), 'gather-ore': t('ironOre'), 'gather-crystal': t('magicCrystal'), 'gather-hide': t('hide') } as Record<string, string>)[res.id] : res.name}</span>
                        <span className="text-[10px] text-gray-400">{t('inBag')}: {count}</span>
                        <span className={`mt-1 rounded-lg bg-emerald-700/80 px-2 py-1 text-[10px] font-bold text-white ${gather?.active?.resource_id === res.id && remainingMs === 0 ? 'ring-2 ring-emerald-300 animate-pulse' : ''}`}>{resourceButtonLabel(res.id)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-300 shrink-0" />
                <p className="text-xs text-emerald-100/80">
                  {language === 'en' ? 'One gathering action takes 4 hours. Only one resource may be gathered at a time. The server checks time and pays once after claiming.' : 'Одна добыча длится 4 часа. Одновременно можно добывать только один ресурс. Сервер проверяет время и начисляет награду один раз после получения.'}
                </p>
              </div>
              {notice && <p role="status" className="rounded-lg border border-sky-400/20 bg-sky-500/10 p-2 text-xs text-sky-100">{notice}</p>}
            </div>
          </Modal>
        );
      })()}

      {/* Chamber of Appearance modal */}
      {selected === 'chamber' && (
        <ChamberModal onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function ChamberModal({ onClose }: { onClose: () => void }) {
  const { t, language } = useLanguage();
  const [tab, setTab] = useState<'male' | 'female' | 'unique'>('male');
  const state = useStore(useGame);
  const currentAppearance = getPlayableAppearance(state.appearance);

  const pickAppearance = (id: string) => {
    const preset = APPEARANCE_PRESETS.find((p) => p.id === id);
    if (preset?.available) useGame.set((s) => ({ ...s, appearance: id }));
  };

  return (
    <Modal title={t('appearanceHall')} icon="/map-chamber.webp" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-300">{language === 'en' ? 'Choose your hero appearance. It is cosmetic and does not affect combat stats.' : 'Выбери облик героя. Внешность — это косметика: она не влияет на боевые характеристики.'}</p>

        {/* Tabs */}
        <div className="flex gap-1.5">
          <TabBtn active={tab === 'male'} onClick={() => setTab('male')}>{t('male')}</TabBtn>
          <TabBtn active={tab === 'female'} onClick={() => setTab('female')}>{t('female')}</TabBtn>
          <TabBtn active={tab === 'unique'} onClick={() => setTab('unique')}>
            <Crown className="w-3.5 h-3.5 inline mr-1" /> {t('unique')}
          </TabBtn>
        </div>

        {/* Preset grids */}
        {tab === 'male' && (
          <PresetGrid presets={MALE_PRESETS} selected={currentAppearance} onPick={pickAppearance} />
        )}
        {tab === 'female' && (
          <PresetGrid presets={FEMALE_PRESETS} selected={currentAppearance} onPick={pickAppearance} />
        )}
        {tab === 'unique' && (
          <div className="space-y-3">
            <div className="relative rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-900/30 to-amber-950/40 p-4 overflow-hidden">
              <div className="absolute -right-8 -top-8 w-28 h-28 rounded-full bg-amber-500/10 blur-2xl" />
              <div className="relative flex items-center gap-3">
                <div className="w-16 h-16 rounded-xl border border-amber-300/40 bg-black/30 flex items-center justify-center shrink-0">
                  <Crown className="w-8 h-8 text-amber-300" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-amber-100">{t('uniqueAppearance')}</h4>
                  <p className="text-[11px] text-amber-200/70">{language === 'en' ? 'Fully customizable appearance — face, body, details. Premium cosmetics.' : 'Полностью настраиваемая внешность — лицо, тело, детали. Премиум-косметика.'}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="text-xs text-gray-400 leading-relaxed">
                {language === 'en' ? 'Customize your hero’s facial features, body shape, and appearance details. This is cosmetic only and provides no combat advantage.' : 'Уникальный облик позволит тонко настроить черты лица, телосложение и детали внешности героя. Это исключительно косметическая функция — она не даёт преимуществ в бою.'}
              </p>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-3 flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-200/80">{t('premiumCosmetics')}</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 h-9 rounded-xl border text-xs font-bold transition-all active:scale-95 ${
        active
          ? 'border-purple-400/50 bg-purple-600/30 text-purple-100'
          : 'border-white/10 bg-black/30 text-gray-400'
      }`}
    >
      {children}
    </button>
  );
}

function PresetGrid({ presets, selected, onPick }: { presets: AppearancePreset[]; selected: string; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {presets.map((p) => {
        const isSelected = selected === p.id;
        return (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            disabled={!p.available}
            className={`relative rounded-2xl border p-3 flex flex-col items-center gap-2 transition-all active:scale-95 disabled:opacity-60 ${
              isSelected
                ? 'border-purple-400/60 bg-purple-950/30 shadow-[0_0_14px_rgba(168,85,247,0.25)]'
                : 'border-white/10 bg-black/30'
            }`}
          >
            {isSelected && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-purple-500 border border-black flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
              </span>
            )}
            <div className="w-16 h-16 rounded-xl border border-white/10 bg-[#1b1a16] overflow-hidden flex items-center justify-center">
              {p.available ? <img src={p.icon} alt="" className="w-full h-full object-contain" /> : <Lock className="w-6 h-6 text-gray-600" />}
            </div>
            <div className="text-center">
              <p className="text-xs font-bold text-white">{p.name}</p>
              <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{p.desc}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
