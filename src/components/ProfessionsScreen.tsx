import { useMemo, useState } from 'react';
import { Hammer, FlaskConical, Gem, Cog, Pickaxe, ShoppingBag, Lock, Leaf, Package, ScrollText, Sparkles, CheckCircle2 } from 'lucide-react';
import { useGame } from '@/game/actions';
import { useStore } from '@/game/store';
import type { InventoryItem, ProfessionId, ProfessionProgress } from '@/game/types';
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

type Tab = 'profession' | 'gather' | 'craft' | 'auction';

export function ProfessionsScreen() {
  const game = useStore(useGame);
  const progress = game.professions ?? INITIAL_PROFESSION_PROGRESS;
  const [tab, setTab] = useState<Tab>('profession');
  const [message, setMessage] = useState('');
  const [busyRecipe, setBusyRecipe] = useState<string | null>(null);

  const resourceCounts = useMemo(() => new Map(
    RESOURCE_DEFINITIONS.map((resource) => [resource.id, countResource(game.inventory, resource.id)]),
  ), [game.inventory]);
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
      setMessage(currentProgress.active === id ? 'Эта профессия уже выбрана. Сменить её после выбора будет нельзя.' : 'Можно выбрать только одну профессию. Сменить её нельзя.');
      return;
    }
    updateProgress({ ...currentProgress, active: id });
    setMessage('Профессия выбрана для тестирования. Постоянная лицензия и платёж будут подключены только перед запуском игры.');
  };

  const gather = (resource: typeof RESOURCE_DEFINITIONS[number]) => {
    const current = useGame.get();
    const currentProgress = current.professions ?? INITIAL_PROFESSION_PROGRESS;
    if (Date.now() - currentProgress.lastGatherAt < 2500) {
      setMessage('Небольшая передышка: попробуй собрать ресурс через пару секунд.');
      return;
    }
    const found = current.inventory.find((item) => item.id === resource.id);
    let inventory: InventoryItem[];
    if (found) {
      inventory = current.inventory.map((item) => item.id === resource.id ? { ...item, qty: item.qty + 1 } : item);
    } else {
      const item: InventoryItem = {
        id: resource.id,
        name: resource.name,
        icon: resource.icon,
        type: 'material',
        rarity: resource.rarity,
        qty: 1,
        description: 'Ресурс для ремесла и торговли.',
      };
      inventory = [...current.inventory, item];
    }
    updateProgress({ ...currentProgress, lastGatherAt: Date.now() }, inventory);
    setMessage(`Собрано: ${resource.name}. Теперь в сумке: ${(found?.qty ?? 0) + 1}.`);
  };

  const craft = (recipeId: string) => {
    const current = useGame.get();
    const currentProgress = current.professions ?? INITIAL_PROFESSION_PROGRESS;
    const recipe = PROFESSION_RECIPES.find((item) => item.id === recipeId);
    if (!recipe || !currentProgress.active || recipe.profession !== currentProgress.active) return;
    if (currentProgress.masteryLevel < recipe.requiredLevel) {
      setMessage(`Нужен уровень мастерства ${recipe.requiredLevel}.`);
      return;
    }
    const nextInventory = craftItem(current.inventory, recipe);
    if (!nextInventory) {
      setMessage('Не хватает ресурсов для этого рецепта.');
      return;
    }
    setBusyRecipe(recipeId);
    const nextProgress = addMasteryXp(currentProgress, recipe.masteryXp);
    useGame.set({ ...current, inventory: nextInventory, professions: nextProgress });
    setMessage(`Создано: ${recipe.output.name}. Получено ${recipe.masteryXp} опыта мастерства.`);
    window.setTimeout(() => setBusyRecipe((old) => old === recipeId ? null : old), 250);
  };

  return (
    <div className="space-y-3 pb-5 text-white">
      <section className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-[#282116] to-[#111820] p-4">
        <div className="flex items-center gap-2">
          <Hammer className="h-7 w-7 shrink-0 text-amber-300" />
          <div className="min-w-0">
            <h2 className="text-lg font-black">Профессии и торговля</h2>
            <p className="text-xs text-slate-300">Сбор ресурсов, рецепты и развитие мастерства</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-black/30 p-2"><div className="text-xs text-slate-400">Мастерство</div><b>{progress.masteryLevel}/300</b></div>
          <div className="rounded-xl bg-black/30 p-2"><div className="text-xs text-slate-400">Опыт</div><b>{nextXp ? `${progress.masteryXp}/${nextXp}` : 'MAX'}</b></div>
          <div className="rounded-xl bg-black/30 p-2"><div className="text-xs text-slate-400">Золото</div><b>{game.player.gold.toLocaleString('ru-RU')}</b></div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-200" style={{ width: `${xpPercent}%` }} /></div>
        {progress.active && <div className="mt-2 text-xs text-amber-200">Твоя профессия: {PROFESSION_DEFINITIONS.find((p) => p.id === progress.active)?.name}</div>}
      </section>

      <div className="grid grid-cols-4 gap-1.5">
        {([
          ['profession', 'Профессии'], ['gather', 'Сбор'], ['craft', 'Крафт'], ['auction', 'Аукцион'],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`rounded-xl border px-1 py-3 text-[11px] font-bold ${tab === id ? 'border-amber-400 bg-amber-500/20 text-amber-100' : 'border-white/10 bg-white/5 text-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'profession' && <>
        <div className="rounded-xl border border-sky-400/20 bg-sky-500/5 p-3 text-xs text-sky-100">
          Сейчас профессии доступны для тестирования без платежей. При запуске выбор одной профессии будет оформляться постоянной лицензией. Оплату сейчас не подключаем.
        </div>
        {PROFESSION_DEFINITIONS.map((profession) => {
          const Icon = ICONS[profession.id];
          const active = progress.active === profession.id;
          const lockedByChoice = progress.active !== null && !active;
          return <article key={profession.id} className={`flex items-center gap-3 rounded-xl border p-3 ${active ? 'border-emerald-400/50 bg-emerald-500/10' : 'border-white/10 bg-white/[0.04]'}`}>
            <div className="rounded-xl bg-amber-500/10 p-3"><Icon className="h-6 w-6 text-amber-300" /></div>
            <div className="min-w-0 flex-1"><b>{profession.name}</b><p className="text-xs text-slate-400">{profession.description}</p>{active && <p className="mt-1 text-[10px] text-emerald-300">Активная профессия</p>}</div>
            <button disabled={lockedByChoice || active} onClick={() => chooseProfession(profession.id)} className={`shrink-0 rounded-lg border px-2.5 py-2 text-xs font-bold ${active ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200' : 'border-white/10 bg-white/5 disabled:opacity-50'}`}>
              {active ? <><CheckCircle2 className="mr-1 inline h-3 w-3" />Выбрана</> : lockedByChoice ? <><Lock className="mr-1 inline h-3 w-3" />Закрыта</> : 'Выбрать'}
            </button>
          </article>;
        })}
        <p className="text-[11px] text-slate-500">У каждого персонажа будет только одна профессия. Смена профессии отдельно не предусмотрена.</p>
      </>}

      {tab === 'gather' && <>
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3 text-xs text-emerald-100"><Leaf className="mr-1 inline h-3.5 w-3.5" />Ресурсы может собирать каждый игрок — лицензия и профессия не нужны.</div>
        <div className="grid grid-cols-2 gap-2">
          {RESOURCE_DEFINITIONS.map((resource) => <article key={resource.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="text-2xl">{resource.icon}</div><b className="text-sm">{resource.name}</b>
            <p className="mt-1 text-xs text-slate-400">В сумке: {resourceCounts.get(resource.id) ?? 0}</p>
            <p className="text-[10px] text-slate-500">Ориентир рынка: {resource.value} золота</p>
            <button onClick={() => gather(resource)} className="mt-2 w-full rounded-lg bg-emerald-700/80 px-3 py-2 text-xs font-bold active:scale-[0.98]"><Pickaxe className="mr-1 inline h-3.5 w-3.5" />Собрать</button>
          </article>)}
        </div>
      </>}

      {tab === 'craft' && <>
        {!progress.active ? <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4 text-sm text-amber-100">Сначала выбери одну профессию во вкладке «Профессии». Собирать ресурсы можно уже сейчас.</div> : <>
          <p className="text-xs text-slate-400">Созданные предметы попадают в обычный инвентарь и сохраняются вместе с прогрессом игры.</p>
          {availableRecipes.map((recipe) => {
            const unlocked = progress.masteryLevel >= recipe.requiredLevel;
            const hasMaterials = canCraft(game.inventory, recipe);
            return <article key={recipe.id} className={`rounded-xl border p-3 ${unlocked ? 'border-white/10 bg-white/[0.04]' : 'border-white/5 bg-black/20 opacity-70'}`}>
              <div className="flex items-start gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-2xl">{recipe.icon}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1"><b className="text-sm">{recipe.name}</b>{recipe.requiredLevel >= 300 && <Sparkles className="h-3.5 w-3.5 text-amber-300" />}</div><p className="mt-0.5 text-xs text-slate-400">{recipe.description}</p><p className="mt-1 text-[11px] text-amber-200">{unlocked ? `+${recipe.masteryXp} опыта мастерства` : `Откроется на уровне ${recipe.requiredLevel}`}</p></div></div>
              <div className="mt-3 flex flex-wrap gap-1.5">{recipe.ingredients.map((ingredient) => { const resource = RESOURCE_DEFINITIONS.find((r) => r.id === ingredient.id)!; const count = countResource(game.inventory, ingredient.id); return <span key={ingredient.id} className={`rounded-md border px-2 py-1 text-[10px] ${count >= ingredient.qty ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200' : 'border-red-500/20 bg-red-500/5 text-red-200'}`}>{resource.icon} {count}/{ingredient.qty}</span>; })}</div>
              <button disabled={!unlocked || !hasMaterials || busyRecipe === recipe.id} onClick={() => craft(recipe.id)} className="mt-3 w-full rounded-lg bg-amber-600 px-3 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><Hammer className="mr-1 inline h-3.5 w-3.5" />{unlocked ? hasMaterials ? 'Создать предмет' : 'Не хватает ресурсов' : `Нужен уровень ${recipe.requiredLevel}`}</button>
            </article>;
          })}
        </>}
      </>}

      {tab === 'auction' && <>
        <section className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2"><ShoppingBag className="h-6 w-6 text-amber-300"/><h3 className="font-bold">Общий аукцион игроков</h3></div>
          <p className="mt-2 text-sm text-slate-300">Правила рынка подготовлены: игроки смогут выставлять ресурсы и созданные предметы, покупать чужие лоты, а с успешной продажи будет удерживаться комиссия 10% в игровом золоте.</p>
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-300"><ScrollText className="mr-1 inline h-4 w-4 text-amber-300"/>Общий рынок нельзя безопасно имитировать на одном телефоне: для реальных сделок нужен серверный учёт лотов, баланса и предметов. Здесь предметы пока не списываются и золото за фиктивную продажу не начисляется.</div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center"><div className="rounded-lg bg-black/25 p-3"><b className="block text-lg text-amber-200">10%</b><span className="text-[10px] text-slate-400">Комиссия с продажи</span></div><div className="rounded-lg bg-black/25 p-3"><b className="block text-lg text-amber-200">0</b><span className="text-[10px] text-slate-400">Фиктивных сделок</span></div></div>
        </section>
      </>}

      {message && <div role="status" className="rounded-xl border border-sky-400/20 bg-sky-500/10 p-3 text-sm text-sky-100">{message}<button onClick={() => setMessage('')} className="ml-2 font-bold">×</button></div>}
    </div>
  );
}
