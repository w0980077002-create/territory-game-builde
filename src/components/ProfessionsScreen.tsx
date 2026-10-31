import { useEffect, useMemo, useState } from 'react';
import { Hammer, Lock, Sparkles, CheckCircle2, MapPinned, Package, RefreshCw, ChevronRight } from 'lucide-react';
import { useGame } from '@/game/actions';
import { supabase } from '@/game/supabase';
import { captureGameEvent } from '@/game/analytics';
import { useLanguage, localizeText } from '@/game/i18n';
import { craftOutputArt, PROFESSION_ART, resourceArt } from '@/game/art';
import { useStore } from '@/game/store';
import { nextCraftRoute } from '@/game/craftJourney';
import type { ProfessionId, ProfessionProgress } from '@/game/types';
import { fetchCraftStatus, submitVerifiedCraft, receiptDisplayItem, mirrorCraftResources, keepPendingCraft, readPendingCraft, type CraftStatus } from '@/game/craftApi';
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

const INITIAL_PROFESSION_PROGRESS: ProfessionProgress = {
  active: null,
  masteryLevel: 1,
  masteryXp: 0,
  lastGatherAt: 0,
};

type Tab = 'profession' | 'craft';

export function ProfessionsScreen({ onMap, onInventory, onForge }: { onMap?: () => void; onInventory?: () => void; onForge?: () => void }) {
  const game = useStore(useGame);
  const { t, language } = useLanguage();
  const progress = game.professions ?? INITIAL_PROFESSION_PROGRESS;
  const [tab, setTab] = useState<Tab>('profession');
  const [message, setMessage] = useState('');
  const [busyRecipe, setBusyRecipe] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [craftStatus, setCraftStatus] = useState<CraftStatus | null>(null);
  const [craftCheck, setCraftCheck] = useState<'checking'|'ready'|'error'>('checking');
  const [pendingCraft, setPendingCraft] = useState<{ recipeId: string; operationId: string } | null>(null);
  useEffect(() => {
    let mounted = true;
    void fetchCraftStatus().then(async (status) => {
      const pending = status?.enabled ? await readPendingCraft() : null;
      if (mounted) {setCraftStatus(status);setPendingCraft(pending);setCraftCheck('ready');}
    }).catch(() => {if (mounted) setCraftCheck('error');});
    return () => {mounted=false;};
  }, []);

  const availableRecipes = useMemo(
    () => PROFESSION_RECIPES.filter((recipe) => recipe.profession === progress.active),
    [progress.active],
  );
  const nextXp = masteryXpToNext(craftStatus?.enabled ? craftStatus.masteryLevel : progress.masteryLevel);
  const displayedLevel = craftStatus?.enabled ? craftStatus.masteryLevel : progress.masteryLevel;
  const displayedXp = craftStatus?.enabled ? craftStatus.masteryXp : progress.masteryXp;
  const xpPercent = nextXp ? Math.min(100, Math.round((displayedXp / nextXp) * 100)) : 100;
  const routeGoal = nextCraftRoute(availableRecipes, displayedLevel,
    (id) => craftStatus?.enabled ? (craftStatus.resources[id] ?? 0) : countResource(game.inventory, RESOURCE_DEFINITIONS.find(resource => resource.id === id)?.id ?? RESOURCE_DEFINITIONS[0].id));
  const retryCraftCheck = async () => {
    if (craftCheck === 'checking') return;
    setCraftCheck('checking');
    try {
      const status = await fetchCraftStatus();
      const pending = status?.enabled ? await readPendingCraft() : null;
      setCraftStatus(status);
      setPendingCraft(pending);
      setCraftCheck('ready');
    } catch {
      setCraftCheck('error');
    }
  };

  const chooseProfession = async (id: ProfessionId) => {
    if (buying) return;
    const current = useGame.get();
    const currentProgress = current.professions ?? INITIAL_PROFESSION_PROGRESS;
    if (currentProgress.active) {
      setMessage(currentProgress.active === id ? t('alreadyChosen') : t('onlyOneProfession'));
      return;
    }
    if (current.player.gems < 1000) {
      setMessage(language === 'en' ? 'Need 1000 blue gems.' : 'Не хватает 1000 синих алмазов.');
      return;
    }
    setBuying(true);
    try {
      const { data, error } = await supabase.rpc('territory_profession_unlock', { p_profession: id });
      if (error || !data?.success || data.profession !== id) {
        setMessage(language === 'en' ? 'Could not confirm the result. Reopen the game to check your balance and profession.' : 'Не удалось подтвердить результат. Откройте игру заново, чтобы проверить баланс и профессию.');
        return;
      }
      const after = Number(data.gems_after);
      if (!Number.isSafeInteger(after) || after < 0) throw new Error('invalid_currency');
      const latest = useGame.get();
      useGame.set({
        ...latest,
        player: { ...latest.player, gems: after },
        professions: { ...(latest.professions ?? INITIAL_PROFESSION_PROGRESS), active: id },
      });
      setMessage(language === 'en' ? 'Profession unlocked forever!' : 'Профессия открыта навсегда!');
      captureGameEvent('territory_profession_unlock', { outcome: 'success' });
    } catch {
      setMessage(language === 'en' ? 'Connection lost. The operation may have completed; reopen the game to check.' : 'Связь прервалась. Операция могла завершиться; откройте игру заново для проверки.');
    } finally {
      setBuying(false);
    }
  };

  const craft = async (recipeId: string) => {
    if (busyRecipe || pendingCraft || craftCheck !== 'ready') return;
    const current = useGame.get();
    const currentProgress = current.professions ?? INITIAL_PROFESSION_PROGRESS;
    const recipe = PROFESSION_RECIPES.find((item) => item.id === recipeId);
    if (!recipe || !currentProgress.active || recipe.profession !== currentProgress.active) return;
    if (recipe.requiredLevel >= 300) {setMessage(language === 'en' ? 'Level 300 recipes require verified crafting and the Master License from the shop (50 red gems).' : 'Рецепты уровня 300 требуют защищённого ремесла и лицензии мастера из магазина (50 красных алмазов).');return;}

    if (craftStatus?.enabled) {
      if (craftStatus.profession !== recipe.profession || craftStatus.masteryLevel < recipe.requiredLevel) {
        setMessage(language === 'en' ? 'Server profession or mastery is not confirmed.' : 'Сервер не подтвердил профессию или мастерство.');return;
      }
      const canAfford = recipe.ingredients.every((r) => (craftStatus.resources[r.id] ?? 0) >= r.qty);
      if (!canAfford) {setMessage(t('notEnoughResources'));return;}
      setBusyRecipe(recipeId);
      const operationId = crypto.randomUUID();
      try {
        await keepPendingCraft({recipeId,operationId});
        setPendingCraft({recipeId,operationId});
        const receipt = await submitVerifiedCraft(recipeId, operationId);
        const displayItem = receiptDisplayItem(receipt);
        // Keep idempotency across a timeout: re-fetch the authoritative status
        // before mirroring a verified item or updating mastery.
        const server = await fetchCraftStatus();
        if (!server?.enabled) throw new Error('craft_server_disabled');
        const latest = useGame.get();
        const found = latest.inventory.some((it) => it.id === displayItem.id);
        const inventory = mirrorCraftResources(latest.inventory,server.resources);
        useGame.set({ ...latest, inventory: found ? inventory : [...inventory, displayItem],
          professions: { ...(latest.professions ?? INITIAL_PROFESSION_PROGRESS), active: currentProgress.active,
            masteryLevel: server.masteryLevel, masteryXp: server.masteryXp } });
        setCraftStatus(server);
        await keepPendingCraft(null);
        setPendingCraft(null);
        setMessage(language === 'en' ? 'Server-verified item crafted!' : 'Сервер подтвердил создание предмета!');
        captureGameEvent('territory_craft_completed', { outcome: 'success' });
      } catch {
        setMessage(language === 'en'
          ? 'Server response uncertain. Do not craft again; retry the pending transaction.'
          : 'Нет подтверждения сервера. Не создавайте предмет повторно — повторите прежнюю операцию.');
      } finally {setBusyRecipe(null);}
      return;
    }
    // Legacy local crafting: NOT exchangeable on the server auction and NOT
    // an authoritative economic operation. This path is removed at cutover.
    if (currentProgress.masteryLevel < recipe.requiredLevel) {
      setMessage(`${t('needMastery')} ${recipe.requiredLevel}.`);return;
    }
    const nextInventory = craftItem(current.inventory,recipe);
    if (!nextInventory) {setMessage(t('notEnoughResources'));return;}
    setBusyRecipe(recipeId);
    useGame.set({ ...current, inventory: nextInventory,professions:addMasteryXp(currentProgress,recipe.masteryXp) });
    captureGameEvent('territory_craft_completed', { outcome: 'success' });
    setMessage(language === 'en' ? `Crafted: ${localizeText(recipe.output.name, language)}. Gained ${recipe.masteryXp} mastery XP.` : `Создано: ${recipe.output.name}. Получено ${recipe.masteryXp} опыта мастерства.`);
    window.setTimeout(()=>setBusyRecipe((old)=>old===recipeId?null:old),250);
  };

  const retryPendingCraft = async () => {
    if (!pendingCraft || busyRecipe || !craftStatus?.enabled) return;
    setBusyRecipe(pendingCraft.recipeId);
    try {
      const receipt = await submitVerifiedCraft(pendingCraft.recipeId,pendingCraft.operationId);
      const display = receiptDisplayItem(receipt);
      const status = await fetchCraftStatus();
      if (!status?.enabled) throw new Error('server_disabled');
      const game = useGame.get();
      const items = mirrorCraftResources(game.inventory,status.resources);
      useGame.set({ ...game, inventory: items.some((item)=>item.id===display.id)?items:[...items,display],
        professions: { ...(game.professions ?? INITIAL_PROFESSION_PROGRESS),
          active: status.profession as ProfessionId,masteryLevel:status.masteryLevel,masteryXp:status.masteryXp } });
      setCraftStatus(status);await keepPendingCraft(null);setPendingCraft(null);
      setMessage(language==='en'?'Craft confirmed.':'Предмет подтверждён сервером.');
    } catch {setMessage(language==='en'?'Still unconfirmed. Please retry later.':'Нет подтверждения. Повторите позже.');}
    finally {setBusyRecipe(null);}
  };

  return (
    <div className="viking-screen viking-screen--professions space-y-3 pb-5 text-white">
      <section className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-[#282116] to-[#111820] p-4">
        <div className="flex items-center gap-2">
          <img src={progress.active ? PROFESSION_ART[progress.active] : import.meta.env.BASE_URL + 'ic-professions-viking.webp'} alt="" className="h-20 w-20 shrink-0 object-contain" />
          <div className="min-w-0">
            <h2 className="text-lg font-black">{t('professionsCraft')}</h2>
            <p className="text-xs text-slate-300">{t('chooseRecipesMastery')}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-black/30 p-2"><div className="text-xs text-slate-400">{t('mastery')}</div><b>{displayedLevel}/300</b></div>
          <div className="rounded-xl bg-black/30 p-2"><div className="text-xs text-slate-400">{t('experience')}</div><b>{nextXp ? `${displayedXp}/${nextXp}` : 'MAX'}</b></div>
          <div className="rounded-xl bg-black/30 p-2"><div className="text-xs text-slate-400">💎 {language === 'en' ? 'Blue gems' : 'Синие алмазы'}</div><b>{game.player.gems.toLocaleString('ru-RU')}</b></div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-200" style={{ width: `${xpPercent}%` }} /></div>
        {progress.active && <div className="mt-2 text-xs text-amber-200">{t('yourProfession')}: {language === 'en' ? ({ smith: 'Blacksmith', alchemist: 'Alchemist', artisan: 'Artisan', jeweler: 'Jeweler', engineer: 'Engineer' } as Record<string, string>)[progress.active] : PROFESSION_DEFINITIONS.find((p) => p.id === progress.active)?.name}</div>}
      </section>

      <section className="rounded-2xl border border-amber-400/50 bg-gradient-to-br from-[#4a2c14] via-[#2c1b11] to-[#17131b] p-3 shadow-[inset_0_2px_0_rgba(255,214,134,0.18)]" data-testid="profession-craft-route" aria-label={language === 'en' ? 'Crafting journey' : 'Путь ремесленника'}>
        <div className="flex items-center gap-3">
          <img src={progress.active ? PROFESSION_ART[progress.active] : import.meta.env.BASE_URL + 'ic-professions-viking.webp'} alt="" className="h-16 w-16 shrink-0 object-contain drop-shadow-lg" loading="lazy"/>
          <div className="min-w-0">
            <h3 className="text-base font-black text-amber-100 drop-shadow-[0_2px_1px_#241005]">{language === 'en' ? 'Your crafting journey' : 'Путь ремесленника'}</h3>
            <p className="text-xs text-amber-100/85">{!progress.active
              ? (language === 'en' ? 'Choose a profession to see real recipes and materials.' : 'Выбери профессию, чтобы увидеть настоящие рецепты и материалы.')
              : (language === 'en' ? 'Prepare materials, craft, then check your inventory.' : 'Собери материалы, изготовь вещь и проверь её на складе.')}</p>
          </div>
        </div>
        {progress.active && craftCheck === 'checking' && <p role="status" className="mt-2 text-xs text-amber-200">{language === 'en' ? 'Checking crafting status…' : 'Проверяем состояние ремесла…'}</p>}
        {progress.active && craftCheck === 'error' && <div className="mt-2 rounded-lg border border-red-400/40 bg-red-950/35 p-2 text-xs text-red-100" role="alert">
          <p>{language === 'en' ? 'Crafting status unavailable. No craft will start until checked.' : 'Статус ремесла недоступен. До проверки изготовление не начнётся.'}</p>
          <button type="button" onClick={() => { void retryCraftCheck(); }} className="mt-2 min-h-11 rounded-lg border border-amber-300/60 bg-amber-700/50 px-3 font-bold"><RefreshCw className="mr-1 inline h-4 w-4"/>{language === 'en' ? 'Retry check' : 'Повторить проверку'}</button>
        </div>}
        {progress.active && craftCheck === 'ready' && routeGoal && <div className="mt-3 rounded-xl border border-amber-300/30 bg-black/25 p-2.5">
          <div className="flex items-center gap-2">
            <img src={craftOutputArt(routeGoal.recipe.output)} alt="" className="h-12 w-12 shrink-0 object-contain" loading="lazy"/>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-300">{language === 'en' ? 'Next recipe' : 'Следующий рецепт'}</p>
              <b className="block text-sm text-amber-50">{localizeText(routeGoal.recipe.name, language)}</b>
              <p className="text-[11px] text-amber-100/85">{!routeGoal.levelReady
                ? (language === 'en' ? 'Requires mastery ' + routeGoal.recipe.requiredLevel : 'Нужно мастерство ' + routeGoal.recipe.requiredLevel)
                : routeGoal.ready ? (language === 'en' ? 'Materials are ready' : 'Материалы собраны')
                : (language === 'en' ? 'Gather missing materials' : 'Нужно добыть материалы')}</p>
            </div>
          </div>
          {routeGoal.missing.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5" aria-label={language === 'en' ? 'Missing materials' : 'Недостающие материалы'}>
            {routeGoal.missing.map(({ id, need }) => {
              const resource = RESOURCE_DEFINITIONS.find(item => item.id === id);
              return <span key={id} className="inline-flex items-center gap-1 rounded-lg border border-amber-400/25 bg-[#21150c] px-2 py-1 text-[11px] text-amber-100">
                {resource && <img src={resourceArt(resource.id)} alt="" className="h-5 w-5 object-contain"/>}
                {resource ? localizeText(resource.name, language) : id}: −{need}
              </span>;
            })}
          </div>}
          {craftStatus?.enabled ? <p className="mt-2 text-[10px] text-emerald-200">{language === 'en' ? 'Material counts verified by the crafting server.' : 'Количество материалов подтверждено сервером ремесла.'}</p>
            : <p className="mt-2 text-[10px] text-amber-200/80">{language === 'en' ? 'Local inventory preview; crafting requires its existing confirmation.' : 'Предпросмотр по инвентарю; изготовление требует действующего подтверждения.'}</p>}
        </div>}
        {pendingCraft && <p role="status" className="mt-2 text-xs font-bold text-amber-200">{language === 'en' ? 'Unconfirmed craft: return to the recipe tab to retry safely.' : 'Неподтверждённое изготовление: вернись к рецептам для безопасного повтора.'}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="profession-journey-navigation">
          {onMap && <button type="button" onClick={onMap} className="min-h-11 rounded-lg border border-sky-300/40 bg-sky-900/35 px-2 text-xs font-black text-sky-50"><MapPinned className="mr-1 inline h-4 w-4"/>{language === 'en' ? 'Gather' : 'Добыча'}</button>}
          {onInventory && <button type="button" onClick={onInventory} className="min-h-11 rounded-lg border border-violet-300/40 bg-violet-900/35 px-2 text-xs font-black text-violet-50"><Package className="mr-1 inline h-4 w-4"/>{language === 'en' ? 'Warehouse' : 'Склад'}</button>}
          {onForge && <button type="button" onClick={onForge} className="min-h-11 rounded-lg border border-orange-300/40 bg-orange-900/35 px-2 text-xs font-black text-orange-50"><Hammer className="mr-1 inline h-4 w-4"/>{language === 'en' ? 'Forge' : 'Кузница'}</button>}
          <button type="button" onClick={() => setTab('craft')} className="min-h-11 rounded-lg border border-amber-200 bg-gradient-to-b from-[#f6c66e] to-[#a86a2a] px-2 text-xs font-black text-[#241308]">{language === 'en' ? 'Recipes' : 'Рецепты'}<ChevronRight className="ml-1 inline h-4 w-4"/></button>
        </div>
      </section>

      {progress.active && progress.masteryLevel >= 300 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
          <p className="font-bold text-amber-200">👑 {language === 'en' ? 'Master license' : 'Лицензия мастера'}</p>
          <p className="mt-1 text-xs text-slate-300">{language === 'en' ? 'The permanent Master license is available in the Shop for 50 red gems. Use the new professions system to craft level-300 recipes.' : 'Постоянная лицензия мастера уже продаётся в Лавке за 50 красных алмазов. Рецепты 300-го уровня создаются в новой системе профессий.'}</p>
        </div>
      )}
      <div className="viking-screen-tabs grid grid-cols-2 gap-1.5" role="tablist">
        {([
          ['profession', t('professionTab')], ['craft', t('crafting')],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-xl border px-2 py-3 text-xs font-bold ${tab === id ? 'border-amber-400 bg-amber-500/20 text-amber-100' : 'border-white/10 bg-white/5 text-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'profession' && <>
        <div className="rounded-xl border border-sky-400/20 bg-sky-500/5 p-3 text-xs text-sky-100">
          {language === 'en' ? 'Unlock one profession forever for 1000 blue gems. The Master license costs 50 red gems in the Shop; 300-level recipes are available in the new professions system.' : 'Открой одну профессию навсегда за 1000 синих алмазов. Лицензия мастера стоит 50 красных алмазов в Лавке; рецепты 300-го уровня доступны в новой системе профессий.'}
        </div>
        {PROFESSION_DEFINITIONS.map((profession) => {
          const active = progress.active === profession.id;
          const lockedByChoice = progress.active !== null && !active;
          const starterRecipe = PROFESSION_RECIPES.find((recipe) => recipe.profession === profession.id && recipe.requiredLevel < 300);
          return <article key={profession.id} className={`profession-choice rounded-xl border p-3 ${active ? 'border-emerald-400/50 bg-emerald-500/10' : 'border-white/10 bg-white/[0.04]'}`}>
            <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-500/20 to-sky-900/30 p-0.5"><img src={PROFESSION_ART[profession.id]} alt="" loading="lazy" className="h-full w-full object-contain" /></div>
            <div className="min-w-0 flex-1"><b>{language === 'en' ? ({ smith: 'Blacksmith', alchemist: 'Alchemist', artisan: 'Artisan', jeweler: 'Jeweler', engineer: 'Engineer' } as Record<string, string>)[profession.id] : profession.name}</b><p className="text-xs text-slate-400">{language === 'en' ? ({ smith: 'Weapons, armor, and shields', alchemist: 'Potions and battle elixirs', artisan: 'Materials and useful kits', jeweler: 'Rings, amulets, and jewelry', engineer: 'Defensive devices and mechanisms' } as Record<string, string>)[profession.id] : profession.description}</p>{starterRecipe && <p className="mt-1 text-[11px] text-amber-200">{language === 'en' ? 'First craft' : 'Первый рецепт'}: {localizeText(starterRecipe.output.name, language)} · {language === 'en' ? 'Mastery Lv.' : 'Мастерство ур.'} {starterRecipe.requiredLevel}</p>}{active && <p className="mt-1 text-[10px] text-emerald-300">{t('activeProfession')}</p>}</div>
            <button disabled={lockedByChoice || active || buying} onClick={() => { void chooseProfession(profession.id); }} className={`profession-choice__action rounded-lg border px-2.5 py-2 text-xs font-bold ${active ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200' : 'border-white/10 bg-white/5 disabled:opacity-50'}`}>
              {active ? <><CheckCircle2 className="mr-1 inline h-3 w-3" />{t('selected')}</> : lockedByChoice ? <><Lock className="mr-1 inline h-3 w-3" />{t('locked')}</> : `${t('choose')} · 1000 💎`}
            </button>
          </article>;
        })}
        <p className="text-[11px] text-slate-500">{t('professionRule')}</p>
      </>}

      {tab === 'craft' && <>
        {!progress.active ? <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4 text-sm text-amber-100">{t('chooseProfessionFirst')}</div> : <>
          <p className="text-xs text-slate-400">{craftStatus?.enabled ? (language === 'en' ? 'Server-confirmed crafting: protected resources and real items.' : 'Серверное ремесло: проверенные ресурсы и настоящие предметы.') : t('craftedItemsSave')}</p>
          {craftCheck === 'error' && <p className="rounded-lg border border-red-500/30 p-2 text-xs text-red-200">{language==='en'?'Crafting server cannot be checked. Crafting is paused.':'Не удалось проверить сервер. Ремесло временно остановлено.'}</p>}
          {availableRecipes.map((recipe) => {
            const unlocked = recipe.requiredLevel < 300 && displayedLevel >= recipe.requiredLevel && (!craftStatus?.enabled || craftStatus.profession === recipe.profession);
            const hasMaterials = craftStatus?.enabled ? recipe.ingredients.every((r) => (craftStatus.resources[r.id] ?? 0)>=r.qty) : canCraft(game.inventory, recipe);
            return <article key={recipe.id} className={`rounded-xl border p-3 ${unlocked ? 'border-white/10 bg-white/[0.04]' : 'border-white/5 bg-black/20 opacity-70'}`}>
              <div className="flex items-start gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-amber-400/15 bg-amber-500/10 p-1"><img src={craftOutputArt(recipe.output)} alt="" loading="lazy" className="h-full w-full object-contain" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-1"><b className="text-sm">{localizeText(recipe.name, language)}</b>{recipe.requiredLevel >= 300 && <Sparkles className="h-3.5 w-3.5 text-amber-300" />}</div><p className="mt-0.5 text-xs text-slate-400">{localizeText(recipe.description, language)}</p><p className="mt-1 text-[11px] text-amber-200">{unlocked ? `+${recipe.masteryXp} ${t('masteryXp')}` : recipe.requiredLevel >= 300 ? (language === 'en' ? 'Verified crafting required' : 'Нужно защищённое ремесло') : `${t('needLevel')} ${recipe.requiredLevel}`}</p></div></div>
              <div className="mt-3 flex flex-wrap gap-1.5">{recipe.ingredients.map((ingredient) => { const resource = RESOURCE_DEFINITIONS.find((r) => r.id === ingredient.id)!; const count = craftStatus?.enabled ? (craftStatus.resources[ingredient.id] ?? 0) : countResource(game.inventory, ingredient.id); return <span key={ingredient.id} className={`rounded-md border px-2 py-1 text-[10px] ${count >= ingredient.qty ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200' : 'border-red-500/20 bg-red-500/5 text-red-200'}`}><img src={resourceArt(resource.id)} alt="" className="mr-1 inline-block h-4 w-4 align-middle object-contain" /> {localizeText(resource.name, language)} {count}/{ingredient.qty}</span>; })}</div>
              <button disabled={craftCheck !== 'ready' || !!pendingCraft || !unlocked || !hasMaterials || busyRecipe === recipe.id} onClick={() => {void craft(recipe.id);}} className="mt-3 w-full rounded-lg bg-amber-600 px-3 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><Hammer className="mr-1 inline h-3.5 w-3.5" />{unlocked ? hasMaterials ? t('craftItem') : t('notEnoughResourcesButton') : recipe.requiredLevel >= 300 ? (language === 'en' ? 'Verified crafting required' : 'Нужно защищённое ремесло') : `${t('needLevel')} ${recipe.requiredLevel}`}</button>
            </article>;
          })}
        </>}
      </>}

      {pendingCraft && <button onClick={() => {void retryPendingCraft();}} disabled={!!busyRecipe} className="w-full rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm font-bold text-amber-200 disabled:opacity-50">{language==='en'?'Retry pending transaction — no double charge':'Повторить неподтверждённую операцию — без двойного списания'}</button>}
      {message && <div role="status" className="rounded-xl border border-sky-400/20 bg-sky-500/10 p-3 text-sm text-sky-100">{message}<button onClick={() => setMessage('')} className="ml-2 font-bold">×</button></div>}
    </div>
  );
}
