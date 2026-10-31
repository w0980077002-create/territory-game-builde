import { lazy, Suspense, useState } from 'react';
import { useStore } from '@/game/store';
import { useGame } from '@/game/actions';
import { getTelegramInitData } from '@/game/telegram';
import { linkTelegram, type AuthUser } from '@/game/auth';
import { useLanguage } from '@/game/i18n';
import { getComputedStats } from '@/game/engine';
import { Heart, Sword, Shield, Star, Send, Check, Link2, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { APPEARANCE_PRESETS, getPlayableAppearance } from '@/game/appearance';
import { HeroShowcase } from './HeroShowcase';

const BuildTrainingPanel = lazy(() => import('./builds/BuildTrainingPanel').then(module => ({ default: module.BuildTrainingPanel })));
const RuneSkillBook = lazy(() => import('./builds/ServerRuneBook').then(module => ({ default: module.ServerRuneBook })));
// Do not show an unfinished skill book to live players before the verified combat cutover.
const VERIFIED_RUNE_BOOK = import.meta.env.VITE_TERRITORY_V1_SERVER_COMBAT === 'verified';

export function ProfileScreen({ user, initialTrainingOpen = false, onEquipment, onAdventure, onForge, onQuests, onCompanions }: { user: AuthUser; initialTrainingOpen?: boolean; onEquipment: () => void; onAdventure: () => void; onForge: (equipmentId: string) => void; onQuests: () => void; onCompanions: () => void }) {
  const { t, language } = useLanguage();
  const state = useStore(useGame);
  const computed = getComputedStats(state);
  const [linking, setLinking] = useState(false);
  const [linkResult, setLinkResult] = useState<string | null>(null);
  const [trainingOpen, setTrainingOpen] = useState(!VERIFIED_RUNE_BOOK && initialTrainingOpen);
  // Existing world-map Rune route uses initialTrainingOpen. Open the new rune book there,
  // while keeping the original training laboratory available separately.
  const [runeBookOpen, setRuneBookOpen] = useState(VERIFIED_RUNE_BOOK && initialTrainingOpen);
  const canLink = user.telegramId === null && !!getTelegramInitData();

  const handleLink = async () => {
    const initData = getTelegramInitData();
    if (!initData || linking) return;
    setLinking(true);
    setLinkResult(null);
    try {
      const result = await linkTelegram(initData);
      setLinkResult(result.success
        ? 'Telegram привязан! Перезапусти игру, чтобы обновить профиль.'
        : result.error || 'Не удалось привязать Telegram.');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="territory-profile space-y-4 animate-fade-in pb-4">
      <HeroShowcase state={state} stats={computed} onEquipment={onEquipment} onAdventure={onAdventure} onForge={onForge} onQuests={onQuests} onCompanions={onCompanions} />
      {/* Owner-approved 5×3 skill interface. Visual-only until server battle integration. */}
      {VERIFIED_RUNE_BOOK && <details className="card group" data-testid="profile-rune-skill-book" open={runeBookOpen}
        onToggle={event => setRuneBookOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-semibold text-amber-200">
          <span>✨ {language === 'en' ? 'Skills and runes · Preview' : 'Навыки и руны · Предпросмотр'}</span>
          <span className="text-xs text-gray-400 group-open:hidden">▾</span>
          <span className="text-xs text-gray-400 hidden group-open:inline">▴</span>
        </summary>
        {runeBookOpen && <Suspense fallback={<p className="py-4 text-xs text-amber-100">{language === 'en' ? 'Opening skill book...' : 'Открываем книгу навыков...'}</p>}>
          <RuneSkillBook language={language}/>
        </Suspense>}
      </details>}

      {/* Build lab runs only when opened; it cannot change the saved character. */}
      <details className="card group" data-testid="profile-build-training" open={trainingOpen} onToggle={event => setTrainingOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-semibold text-amber-200">
          <span>⚔️ {language === 'en' ? 'Combat builds · Training' : 'Боевые сборки · Тренировка'}</span>
          <span className="text-xs text-gray-400 group-open:hidden">▾</span><span className="text-xs text-gray-400 hidden group-open:inline">▴</span>
        </summary>
        {trainingOpen && <Suspense fallback={<p className="py-4 text-xs text-amber-100">{language === 'en' ? 'Opening training...' : 'Открываем тренировку...'}</p>}>
          <BuildTrainingPanel baseStats={computed} language={language}/>
        </Suspense>}
      </details>

      {/* Appearance is optional; keep the profile compact until requested. */}
      <details className="card group" data-testid="profile-appearance">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-semibold text-amber-200">
          <span>{language === 'en' ? 'Change hero appearance' : 'Сменить внешность героя'}</span>
          <span className="text-xs text-gray-400 group-open:hidden">{language === 'en' ? 'Show' : 'Открыть'} ▾</span>
          <span className="text-xs text-gray-400 hidden group-open:inline">{language === 'en' ? 'Hide' : 'Свернуть'} ▴</span>
        </summary>
        <p className="text-xs text-gray-400 mt-3 mb-3">{language === 'en' ? 'Appearance only. Your level and equipment stay the same.' : 'Меняется только внешность. Уровень и экипировка сохраняются.'}</p>
        <div className="grid grid-cols-2 gap-2">
          {APPEARANCE_PRESETS.map((preset) => {
            const active = getPlayableAppearance(state.appearance) === preset.id;
            return (
              <button
                type="button"
                key={preset.id}
                aria-pressed={active}
                onClick={() => useGame.set((prev) => prev.appearance === preset.id ? prev : { ...prev, appearance: preset.id })}
                className={`relative flex flex-col items-center rounded-xl border p-2 transition-colors active:scale-[0.98] ${active ? 'border-amber-300 bg-amber-300/15' : 'border-white/10 bg-black/25'}`}
              >
                {active && <Check className="absolute right-2 top-2 h-4 w-4 text-amber-300" />}
                <img src={preset.icon} alt="" draggable={false} loading="lazy" className="h-28 w-full object-contain object-bottom" />
                <span className="mt-1 text-xs font-semibold text-white">{preset.name}</span>
              </button>
            );
          })}
        </div>
      </details>

      {/* Keep original base attributes accessible without duplicating the main stats. */}
      <details className="card group" data-testid="profile-base-stats">
        <summary className="cursor-pointer text-sm font-semibold text-gray-300">
          {t('baseStats')} <span className="float-right text-gray-500 text-xs group-open:hidden">▾</span>
          <span className="float-right text-gray-500 text-xs hidden group-open:inline">▴</span>
        </summary>
        <div className="mt-3">
        <div className="grid grid-cols-2 gap-3">
          <StatBox icon={<Heart className="w-4 h-4 text-red-400" />} label={t('heroHealth')} value={`${state.player.stats.maxHp}`} />
          <StatBox icon={<Sword className="w-4 h-4 text-orange-400" />} label={t('attack')} value={state.player.stats.attack} />
          <StatBox icon={<Shield className="w-4 h-4 text-blue-400" />} label={t('defense')} value={state.player.stats.defense} />
          <StatBox icon={<Star className="w-4 h-4 text-yellow-400" />} label={t('critChance')} value={`${state.player.stats.critChance}%`} />
        </div>
        </div>
      </details>

      {/* Telegram account linkage: only verified Edge Functions can link identities. */}
      <div className="card">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center shrink-0">
            <Send className="w-5 h-5 text-sky-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">Telegram</p>
            {user.telegramId !== null ? (
              <p className="text-xs text-emerald-400 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Привязан (ID: {user.telegramId})
              </p>
            ) : <p className="text-xs text-gray-400">Аккаунт ещё не привязан</p>}
          </div>
          {canLink && (
            <button onClick={handleLink} disabled={linking} className="rounded-xl bg-sky-500/20 border border-sky-400/40 px-3 py-2 text-xs font-bold text-sky-100 disabled:opacity-50 flex items-center gap-1.5">
              {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Привязать
            </button>
          )}
        </div>
        {linkResult && <p role="status" className="mt-3 text-xs text-sky-200">{linkResult}</p>}
      </div>

    </div>
  );
}

function StatBox({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return (
    <div className="territory-profile-stat flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2">
      {icon}
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}
