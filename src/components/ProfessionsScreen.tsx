import { useMemo, useState } from 'react';
import { Hammer, FlaskConical, Gem, Cog, Lock, Package, Sparkles, CheckCircle2 } from 'lucide-react';
import { useGame } from '@/game/actions';
import { useLanguage, localizeText } from '@/game/i18n';
import { useStore } from '@/game/store';
import type { ProfessionId, ProfessionProgress } from '@/game/types';
import {
  PROFESSION_DEFINITIONS,
  PROFESSION_RECIPES,
  RESOURCE_DEFINITIONS,
  addMasteryXp,
  canCraft,
  craftItem,
  countResource,
  masteryXpToNext,
} from '@/game/professions';

const ICONS: Record<ProfessionId, typeof Hammer> = {
  smith: Hammer,
  alchemist: FlaskConical,
  artisan: Package,
  jeweler: Gem,
  engineer: Cog,
};
const INITIAL_PROFESSION_PROGRESS: ProfessionProgress = {
  active: null,
  masteryLevel: 1,
  masteryXp: 0,
  lastGatherAt: 0,
};

type Tab = 'profession' | 'craft';

export function ProfessionsScreen() {
  const game = useStore(useGame);
  const { t, language } = useLanguage();
  const progress = game.professions ?? INITIAL_PROFESSION_PROGRESS;
  const [tab, setTab] = useState<Tab>('profession');
  const [message, setMessage] = useState('');
  const [busyRecipe, setBusyRecipe] = useState<string | null>(null);

  const availableRecipes = useMemo(
    () => PROFESSION_RECIPES.filter((recipe) => recipe.profession === progress.active),
    [progress.active],
  );
  const nextXp = masteryXpToNext(progress.masteryLevel);
  const xpPercent = nextXp ? Math.min(100, Math.round((progress.masteryXp / nextXp) * 100)) : 100;

  const updateProgress = (nextProgress: ProfessionProgress, inventory = game.inventory) => {
    useGame.set({ ...useGame.get(), inventory, professions: nextProgress });
  };

  const chooseProfession = (id: ProfessionId) => {
    const current = useGame.get();
    const currentProgress = current.professions ?? INITIAL_PROFESSION_PROGRESS;
    if (currentProgress.active) {
      setMessage(currentProgress.active === id ? t('alreadyChosen') : t('onlyOneProfession'));
      return;
    }
    updateProgress({ ...currentProgress, active: id });
    setMessage(t('professionChosen'));
  };

  const craft = (recipeId: string) => {
    const current = useGame.get();
    const currentProgress = current.professions ?? INITIAL_PROFESSION_PROGRESS;
    const recipe = PROFESSION_RECIPES.find((item) => item.id === recipeId);
    if (!recipe || !currentProgress.active || recipe.profession !== currentProgress.active) return;
    if (currentProgress.masteryLevel < recipe.requiredLevel) {
      setMessage(`${t('needMastery')} ${recipe.requiredLevel}.`);
      return;
    }
    const nextInventory = craftItem(current.inventory, recipe);
    if (!nextInventory) {
      setMessage(t('notEnoughResources'));
      return;
    }
    setBusyRecipe(recipeId);
    const nextProgress = addMasteryXp(currentProgress, recipe.masteryXp);
    useGame.set({ ...current, inventory: nextInventory, professions: nextProgress });
    setMessage(language === 'en' ? `Crafted: ${localizeText(recipe.output.name, language)}. Gained ${recipe.masteryXp} mastery XP.` : `Создано: ${recipe.output.name}. Получено ${recipe.masteryXp} опыта мастерства.`);
    window.setTimeout(() => setBusyRecipe((old) => old === recipeId ? null : old), 250);
  };

  return (
    <div className="space-y-3 pb-5 text-white">
      <section className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-[#282116] to-[#111820] p-4">
        <div className="flex items-center gap-2">
          <Hammer className="h-7 w-7 shrink-0 text-amber-300" />
          <div className="min-w-0">
            <h2 className="text-lg font-black">{t('professionsCraft')}</h2>
            <p className="text-xs text-slate-300">{t('chooseRecipesMastery')}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-black/30 p-2"><div className="text-xs text-slate-400">{t('mastery')}</div><b>{progress.masteryLevel}/300</b></div>
          <div className="rounded-xl bg-black/30 p-2"><div className="text-xs text-slate-400">{t('experience')}</div><b>{nextXp ? `${progress.masteryXp}/${nextXp}` : 'MAX'}</b></div>
          <div className="rounded-xl bg-black/30 p-2"><div className="text-xs text-slate-400">{t('gold')}</div><b>{game.player.gold.toLocaleString('ru-RU')}</b></div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-200" style={{ width: `${xpPercent}%` }} /></div>
        {progress.active && <div className="mt-2 text-xs text-amber-200">{t('yourProfession')}: {language === 'en' ? ({ smith: 'Blacksmith', alchemist: 'Alchemist', artisan: 'Artisan', jeweler: 'Jeweler', engineer: 'Engineer' } as Record<string, string>)[progress.active] : PROFESSION_DEFINITIONS.find((p) => p.id === progress.active)?.name}</div>}
      </section>

      <div className="grid grid-cols-2 gap-1.5">
        {([
          ['profession', t('professionTab')], ['craft', t('crafting')],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`rounded-xl border px-2 py-3 text-xs font-bold ${tab === id ? 'border-amber-400 bg-amber-500/20 text-amber-100' : 'border-white/10 bg-white/5 text-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'profession' && <>
        <div className="rounded-xl border border-sky-400/20 bg-sky-500/5 p-3 text-xs text-sky-100">
          {t('professionTestNotice')}
        </div>
        {PROFESSION_DEFINITIONS.map((profession) => {
          const Icon = ICONS[profession.id];
          const active = progress.active === profession.id;
          const lockedByChoice = progress.active !== null && !active;
          return <article key={profession.id} className={`flex items-center gap-3 rounded-xl border p-3 ${active ? 'border-emerald-400/50 bg-emerald-500/10' : 'border-white/10 bg-white/[0.04]'}`}>
            <div className="rounded-xl bg-amber-500/10 p-3"><Icon className="h-6 w-6 text-amber-300" /></div>
            <div className="min-w-0 flex-1"><b>{language === 'en' ? ({ smith: 'Blacksmith', alchemist: 'Alchemist', artisan: 'Artisan', jeweler: 'Jeweler', engineer: 'Engineer' } as Record<string, string>)[profession.id] : profession.name}</b><p className="text-xs text-slate-400">{language === 'en' ? ({ smith: 'Weapons, armor, and shields', alchemist: 'Potions and battle elixirs', artisan: 'Materials and useful kits', jeweler: 'Rings, amulets, and jewelry', engineer: 'Defensive devices and mechanisms' } as Record<string, string>)[profession.id] : profession.description}</p>{active && <p className="mt-1 text-[10px] text-emerald-300">{t('activeProfession')}</p>}</div>
            <button disabled={lockedByChoice || active} onClick={() => chooseProfession(profession.id)} className={`shrink-0 rounded-lg border px-2.5 py-2 text-xs font-bold ${active ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200' : 'border-white/10 bg-white/5 disabled:opacity-50'}`}>
              {active ? <><CheckCircle2 className="mr-1 inline h-3 w-3" />{t('selected')}</> : lockedByChoice ? <><Lock className="mr-1 inline h-3 w-3" />{t('locked')}</> : t('choose')}
            </button>
          </article>;
        })}
        <p className="text-[11px] text-slate-500">{t('professionRule')}</p>
      </>}

      {tab === 'craft' && <>
        {!progress.active ? <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4 text-sm text-amber-100">{t('chooseProfessionFirst')}</div> : <>
          <p className="text-xs text-slate-400">{t('craftedItemsSave')}</p>
          {availableRecipes.map((recipe) => {
            const unlocked = progress.masteryLevel >= recipe.requiredLevel;
            const hasMaterials = canCraft(game.inventory, recipe);
            return <article key={recipe.id} className={`rounded-xl border p-3 ${unlocked ? 'border-white/10 bg-white/[0.04]' : 'border-white/5 bg-black/20 opacity-70'}`}>
              <div className="flex items-start gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-2xl">{recipe.icon}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1"><b className="text-sm">{localizeText(recipe.name, language)}</b>{recipe.requiredLevel >= 300 && <Sparkles className="h-3.5 w-3.5 text-amber-300" />}</div><p className="mt-0.5 text-xs text-slate-400">{localizeText(recipe.description, language)}</p><p className="mt-1 text-[11px] text-amber-200">{unlocked ? `+${recipe.masteryXp} ${t('masteryXp')}` : `${t('needLevel')} ${recipe.requiredLevel}`}</p></div></div>
              <div className="mt-3 flex flex-wrap gap-1.5">{recipe.ingredients.map((ingredient) => { const resource = RESOURCE_DEFINITIONS.find((r) => r.id === ingredient.id)!; const count = countResource(game.inventory, ingredient.id); return <span key={ingredient.id} className={`rounded-md border px-2 py-1 text-[10px] ${count >= ingredient.qty ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200' : 'border-red-500/20 bg-red-500/5 text-red-200'}`}>{resource.icon} {localizeText(resource.name, language)} {count}/{ingredient.qty}</span>; })}</div>
              <button disabled={!unlocked || !hasMaterials || busyRecipe === recipe.id} onClick={() => craft(recipe.id)} className="mt-3 w-full rounded-lg bg-amber-600 px-3 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><Hammer className="mr-1 inline h-3.5 w-3.5" />{unlocked ? hasMaterials ? t('craftItem') : t('notEnoughResourcesButton') : `${t('needLevel')} ${recipe.requiredLevel}`}</button>
            </article>;
          })}
        </>}
      </>}

      {message && <div role="status" className="rounded-xl border border-sky-400/20 bg-sky-500/10 p-3 text-sm text-sky-100">{message}<button onClick={() => setMessage('')} className="ml-2 font-bold">×</button></div>}
    </div>
  );
}
