import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Lock, Sparkles, Crown, Check } from 'lucide-react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { APPEARANCE_PRESETS, MALE_PRESETS, FEMALE_PRESETS, getPlayableAppearance, type AppearancePreset } from '@/game/appearance';

type RegionId = 'forest' | 'mountain' | 'herbs' | 'hunting' | 'rare';
type LocationId = RegionId | 'chamber';

interface Region {
  id: RegionId;
  name: string;
  icon: string;
  desc: string;
  resources: { name: string; icon: string }[];
  accent: string;
  glow: string;
  profession: string;
}

const REGIONS: Region[] = [
  {
    id: 'forest',
    name: 'Тёмный лес',
    icon: '/map-forest.webp',
    desc: 'Густые чащи скрывают древнюю древесину и дикорастущие корни.',
    resources: [
      { name: 'Древесина', icon: '🪵' },
      { name: 'Корни', icon: '🌿' },
      { name: 'Янтарь', icon: '🟡' },
    ],
    accent: 'from-emerald-700/40 to-emerald-950/60',
    glow: 'emerald',
    profession: 'Лесоруб',
  },
  {
    id: 'mountain',
    name: 'Северные рудники',
    icon: '/map-mountain.webp',
    desc: 'Холодные пики хранят руду, камень и драгоценные минералы.',
    resources: [
      { name: 'Железная руда', icon: '⛏️' },
      { name: 'Медь', icon: '🟠' },
      { name: 'Серебро', icon: '⚪' },
    ],
    accent: 'from-stone-600/40 to-stone-900/60',
    glow: 'stone',
    profession: 'Шахтёр',
  },
  {
    id: 'herbs',
    name: 'Травяные дебри',
    icon: '/map-herbs.webp',
    desc: 'Туманные луга с лечебными травами и алхимическими ингредиентами.',
    resources: [
      { name: 'Целебные травы', icon: '🍃' },
      { name: 'Грибы', icon: '🍄' },
      { name: 'Коренья', icon: '🫚' },
    ],
    accent: 'from-lime-700/40 to-green-950/60',
    glow: 'lime',
    profession: 'Травник',
  },
  {
    id: 'hunting',
    name: 'Охотничьи угодья',
    icon: '/map-hunting.webp',
    desc: 'Дикие земли, где добывают шкуры, кости и охотничьи трофеи.',
    resources: [
      { name: 'Шкуры', icon: '🐾' },
      { name: 'Кости', icon: '🦴' },
      { name: 'Клыки', icon: '🐺' },
    ],
    accent: 'from-amber-800/40 to-amber-950/60',
    glow: 'amber',
    profession: 'Охотник',
  },
  {
    id: 'rare',
    name: 'Затерянные пещеры',
    icon: '/map-rare.webp',
    desc: 'Опасные глубины с редкими кристаллами и древними артефактами.',
    resources: [
      { name: 'Кристаллы', icon: '💎' },
      { name: 'Мифрил', icon: '🔮' },
      { name: 'Древние осколки', icon: '📜' },
    ],
    accent: 'from-sky-700/40 to-indigo-950/60',
    glow: 'sky',
    profession: 'Мастер',
  },
];

const GLOW_RING: Record<string, string> = {
  emerald: 'shadow-[0_0_18px_rgba(16,185,129,0.25)]',
  stone: 'shadow-[0_0_18px_rgba(168,162,158,0.25)]',
  lime: 'shadow-[0_0_18px_rgba(132,204,22,0.25)]',
  amber: 'shadow-[0_0_18px_rgba(245,158,11,0.25)]',
  sky: 'shadow-[0_0_18px_rgba(56,189,248,0.25)]',
};

const GLOW_BORDER: Record<string, string> = {
  emerald: 'border-emerald-500/40',
  stone: 'border-stone-400/40',
  lime: 'border-lime-500/40',
  amber: 'border-amber-500/40',
  sky: 'border-sky-500/40',
};

export function MapScreen() {
  const [selected, setSelected] = useState<LocationId | null>(null);

  return (
    <div className="relative min-h-full animate-fade-in pb-2">
      {/* World map background */}
      <div className="fixed inset-0 pointer-events-none">
        <img src="/map-bg.webp" alt="" className="w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0c1117]/60 via-transparent to-[#0c1117]/80" />
      </div>

      <div className="relative space-y-4">
        {/* Header */}
        <div className="relative rounded-2xl overflow-hidden border border-amber-500/20 p-4">
          <div className="absolute inset-0 bg-gradient-to-br from-teal-900/30 via-[#16130d] to-[#0f1115]" />
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl border border-amber-400/30 bg-black/40 flex items-center justify-center">
              <img src="/nav-map.webp" alt="" className="w-9 h-9 object-contain" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-amber-100">Карта мира</h2>
              <p className="text-xs text-gray-400">Исследуй земли, добывай ресурсы и меняй облик героя</p>
            </div>
          </div>
        </div>

        {/* Resource Regions */}
        <div>
          <div className="flex items-baseline justify-between px-1 mb-2">
            <h3 className="text-xs font-semibold text-amber-200/80 uppercase tracking-wider">Ресурсные земли</h3>
            <span className="text-[11px] text-gray-500">Скоро: профессии</span>
          </div>
          <div className="space-y-2.5">
            {REGIONS.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r.id)}
                className={`group relative w-full rounded-2xl border ${GLOW_BORDER[r.glow]} bg-gradient-to-r ${r.accent} ${GLOW_RING[r.glow]} overflow-hidden p-3 flex items-center gap-3 text-left active:scale-[0.98] transition-transform`}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
                <div className="relative w-16 h-16 rounded-xl border border-white/10 bg-black/30 overflow-hidden shrink-0">
                  <img src={r.icon} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="relative flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-white truncate">{r.name}</h4>
                  <p className="text-[11px] text-gray-300/80 truncate">{r.desc}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {r.resources.map((res) => (
                      <span key={res.name} className="inline-flex items-center gap-0.5 rounded-md bg-black/40 border border-white/10 px-1.5 py-0.5 text-[9px] font-semibold text-gray-200">
                        <span className="text-[10px]">{res.icon}</span> {res.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="relative shrink-0 flex flex-col items-center gap-1">
                  <span className="rounded-lg bg-black/50 border border-white/10 px-2 py-1 text-[9px] font-bold text-amber-200/90">{r.profession}</span>
                  <span className="flex items-center gap-0.5 text-[9px] text-gray-400">
                    <Lock className="w-3 h-3" /> Скоро
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Chamber of Appearance */}
        <div>
          <div className="flex items-baseline justify-between px-1 mb-2">
            <h3 className="text-xs font-semibold text-amber-200/80 uppercase tracking-wider">Особые места</h3>
          </div>
          <button
            onClick={() => setSelected('chamber')}
            className="group relative w-full rounded-2xl border border-purple-400/30 bg-gradient-to-r from-indigo-900/40 to-purple-950/50 shadow-[0_0_18px_rgba(168,85,247,0.2)] overflow-hidden p-4 flex items-center gap-3 text-left active:scale-[0.98] transition-transform"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
            <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-purple-500/10 blur-2xl pointer-events-none" />
            <div className="relative w-16 h-16 rounded-xl border border-purple-300/30 bg-black/30 overflow-hidden shrink-0">
              <img src="/map-chamber.webp" alt="" className="w-full h-full object-cover" />
            </div>
            <div className="relative flex-1 min-w-0">
              <h4 className="text-sm font-bold text-purple-100 truncate">Чертог Облика</h4>
              <p className="text-[11px] text-purple-200/70 truncate">Смени облик героя. Внешность не влияет на боевые характеристики.</p>
            </div>
            <Sparkles className="relative w-5 h-5 text-purple-300 shrink-0" />
          </button>
        </div>
      </div>

      {/* Region detail modal */}
      {selected && selected !== 'chamber' && (() => {
        const r = REGIONS.find((reg) => reg.id === selected)!;
        return (
          <Modal title={r.name} icon={r.icon} onClose={() => setSelected(null)}>
            <div className="space-y-4">
              <div className="rounded-xl overflow-hidden border border-white/10">
                <img src={r.icon} alt="" className="w-full h-32 object-cover" />
              </div>
              <p className="text-sm text-gray-300">{r.desc}</p>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Добываемые ресурсы</p>
                <div className="grid grid-cols-3 gap-2">
                  {r.resources.map((res) => (
                    <div key={res.name} className="rounded-xl border border-white/10 bg-black/30 p-3 flex flex-col items-center gap-1">
                      <span className="text-2xl">{res.icon}</span>
                      <span className="text-[11px] font-semibold text-gray-200 text-center leading-tight">{res.name}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-3 flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-200/80">
                  Регион откроется с системой профессий. Ресурсы будут нужны для крафта и улучшений.
                </p>
              </div>
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
  const [tab, setTab] = useState<'male' | 'female' | 'unique'>('male');
  const state = useStore(useGame);
  const currentAppearance = getPlayableAppearance(state.appearance);

  const pickAppearance = (id: string) => {
    const preset = APPEARANCE_PRESETS.find((p) => p.id === id);
    if (preset?.available) useGame.set((s) => ({ ...s, appearance: id }));
  };

  return (
    <Modal title="Чертог Облика" icon="/map-chamber.webp" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-300">Выбери облик героя. Внешность — это косметика: она не влияет на боевые характеристики.</p>

        {/* Tabs */}
        <div className="flex gap-1.5">
          <TabBtn active={tab === 'male'} onClick={() => setTab('male')}>Мужские</TabBtn>
          <TabBtn active={tab === 'female'} onClick={() => setTab('female')}>Женские</TabBtn>
          <TabBtn active={tab === 'unique'} onClick={() => setTab('unique')}>
            <Crown className="w-3.5 h-3.5 inline mr-1" /> Уникальный
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
                  <h4 className="text-sm font-bold text-amber-100">Уникальный облик</h4>
                  <p className="text-[11px] text-amber-200/70">Полностью настраиваемая внешность — лицо, тело, детали. Премиум-косметика.</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="text-xs text-gray-400 leading-relaxed">
                Уникальный облик позволит тонко настроить черты лица, телосложение и детали внешности героя.
                Это исключительно косметическая функция — она не даёт преимуществ в бою.
              </p>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-3 flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-200/80">
                Премиум-косметика. Доступ будет добавлен в одном из следующих обновлений.
              </p>
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

interface Preset {
  id: string;
  name: string;
  icon: string;
  desc: string;
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
