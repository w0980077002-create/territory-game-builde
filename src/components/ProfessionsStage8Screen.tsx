import { useEffect, useMemo, useState } from 'react';
import { Hammer, Lock, RefreshCw, ShieldCheck, Sparkles, Search, MapPinned, Package, Anvil } from 'lucide-react';
import { useGame } from '@/game/actions';
import { useLanguage, localizeText } from '@/game/i18n';
import { craftOutputArt, PROFESSION_ART, resourceArt } from '@/game/art';
import { PROFESSION_DEFINITIONS, RESOURCE_DEFINITIONS } from '@/game/professions';
import { mirrorCraftResources } from '@/game/craftApi';
import {
  fetchStage8Status, fetchStage8Items, mirrorStage8Items,
  executeStage8, purchaseStage8, readStage8Pending, setStage8Pending,
  readStage8PurchasePending, setStage8PurchasePending, stage8XpToNext, STAGE8_RECIPES,
  type Stage8Status, type Stage8PendingOperation, type Stage8PurchaseOperation,
} from '@/game/stage8CraftApi';
import type { ProfessionId } from '@/game/types';
import { recipeReadiness, visibleWorkshopRecipes, type WorkshopRecipeFilter } from '@/game/workshopPlanner';

/** Staging-only: server-authoritative replacement for legacy local crafting. */
export function ProfessionsStage8Screen({onNavigate}:{onNavigate?:(screen:'map'|'inventory'|'forge',inventoryTab?:'equipment'|'items')=>void} = {}) {
  const {language} = useLanguage();
  const [status,setStatus] = useState<Stage8Status|null>(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [pending,setPending] = useState<Stage8PendingOperation|null>(null);
  const [purchasePending,setPurchasePending] = useState<Stage8PurchaseOperation|null>(null);
  const [notice,setNotice] = useState('');
  const [recipeFilter,setRecipeFilter] = useState<WorkshopRecipeFilter>('nearby');
  const [recipeSearch,setRecipeSearch] = useState('');
  const [craftedItemTab,setCraftedItemTab] = useState<'equipment'|'items'|null>(null);

  const refresh = async () => {
    setLoading(true);setError('');
    try {
      const [next,waiting,purchaseWaiting]=await Promise.all([
        fetchStage8Status(),readStage8Pending(),readStage8PurchasePending(),
      ]);
      if (next.enabled && next.profession) {
        const owned=await fetchStage8Items();
        const latest=useGame.get();
        const equippedIds=new Set(Object.values(latest.player.equipped).flatMap((item)=>item?[item.id]:[]));
        useGame.set({...latest,inventory:mirrorStage8Items(
          mirrorCraftResources(latest.inventory,next.resources),owned,equippedIds),
          professions:{...(latest.professions??{active:null,masteryLevel:1,masteryXp:0,lastGatherAt:0}),
            active:next.profession,masteryLevel:next.masteryLevel,masteryXp:next.masteryXp}});
      }
      setStatus(next);setPending(waiting);setPurchasePending(purchaseWaiting);
    }catch{setStatus(null);setError(language==='en'?'Verified crafting is unavailable. Check saved pending operations before attempting another.':'Нет связи с защищённым ремеслом. Сначала проверь сохранённую операцию — повторную пока не начинай.');}
    finally{setLoading(false);}
  };
  useEffect(()=>{void refresh();},[]); // Intentional once-on-mount server status fetch.

  const currentProfession=status?.profession??null;
  const available=useMemo(()=>STAGE8_RECIPES.filter((recipe)=>recipe.profession===currentProfession),[currentProfession]);
  const readyRecipes=useMemo(()=>status?available.filter(recipe=>recipeReadiness(recipe,status).ready).length:0,[available,status]);
  const shownRecipes=useMemo(()=>status?visibleWorkshopRecipes(available,status,recipeFilter,recipeSearch):[],[available,status,recipeFilter,recipeSearch]);

  const confirm = async (recipeId:string,operationId:string) => {
    setBusy(true);setNotice('');
    try {
      const receipt=await executeStage8(recipeId,operationId);
      const [verified,owned]=await Promise.all([fetchStage8Status(),fetchStage8Items()]);
      if (!verified.enabled || !verified.profession || verified.masteryLevel<receipt.masteryLevel) throw new Error('stage8_status_not_confirmed');
      if (receipt.kind==='item' && !owned.some((item)=>item.itemId===receipt.itemId))
        throw new Error('stage8_item_not_in_server_inventory');
      const latest=useGame.get();
      const equippedIds=new Set(Object.values(latest.player.equipped).flatMap((item)=>item?[item.id]:[]));
      useGame.set({...latest,
        inventory:mirrorStage8Items(mirrorCraftResources(latest.inventory,verified.resources),owned,equippedIds),
        professions:{...(latest.professions??{active:null,masteryLevel:1,masteryXp:0,lastGatherAt:0}),
          active:verified.profession,masteryLevel:verified.masteryLevel,masteryXp:verified.masteryXp},
      });
      await setStage8Pending(null);
      setPending(null);setStatus(verified);
      setNotice(language==='en'?(receipt.kind==='item'?'Verified item crafted.':'Mastery training confirmed.'):(receipt.kind==='item'?'Предмет создан и подтверждён сервером.':'Обучение подтверждено сервером.'));
      const crafted=owned.find(item=>item.itemId===receipt.itemId);
      setCraftedItemTab(receipt.kind==='item'?(crafted?.output.type==='equipment'?'equipment':'items'):null);
    }catch{
      setNotice(language==='en'?'Response uncertain. Retry the SAME operation; never start another.':'Сервер не подтвердил результат. Повтори ЭТУ ЖЕ операцию, чтобы не списать ресурсы дважды.');
    }finally{setBusy(false);}
  };

  const start = async (recipeId:string) => {
    if (busy || pending || !status?.enabled) return;
    setBusy(true);
    const operationId=crypto.randomUUID();
    try {
      await setStage8Pending({recipeId,operationId});
      setPending({recipeId,operationId});
    }catch{
      setNotice(language==='en'?'Secure operation storage unavailable; crafting blocked.':'Не удалось сохранить номер операции. Крафт остановлен без списания.');
      setBusy(false);return;
    }
    setBusy(false);
    await confirm(recipeId,operationId);
  };

  const confirmPurchase = async (profession:ProfessionId,operationId:string) => {
    setBusy(true);setNotice('');
    try {
      const receipt=await purchaseStage8(profession,operationId);
      const verified=await fetchStage8Status();
      if (!verified.enabled || verified.profession!==profession || verified.masteryLevel!==1) throw new Error('unlock_not_confirmed');
      const latest=useGame.get();
      useGame.set({...latest,player:{...latest.player,gems:receipt.gemsAfter},
        professions:{...(latest.professions??{active:null,masteryLevel:1,masteryXp:0,lastGatherAt:0}),active:profession,
          masteryLevel:verified.masteryLevel,masteryXp:verified.masteryXp}});
      await setStage8PurchasePending(null);
      setPurchasePending(null);setStatus(verified);
      setNotice(language==='en'?'Profession purchase verified by server.':'Профессия открыта и подтверждена сервером.');
    }catch{setNotice(language==='en'?'Purchase result uncertain. Retry the SAME operation, never buy again.':'Результат покупки пока неизвестен. Повтори ЭТУ ЖЕ операцию: алмазы повторно не спишутся.');}
    finally{setBusy(false);}
  };
  const choose = async (profession:ProfessionId) => {
    if (busy || purchasePending || !status?.enabled || status.profession) return;
    setBusy(true);setNotice('');
    const operationId=crypto.randomUUID();
    try {
      await setStage8PurchasePending({profession,operationId});
      setPurchasePending({profession,operationId});
    }catch{
      setNotice(language==='en'?'Cannot preserve purchase request. No gems were spent.':'Не удалось сохранить номер покупки. Алмазы не списывались.');
      setBusy(false);return;
    }
    setBusy(false);
    await confirmPurchase(profession,operationId);
  };

  if (loading && !status) return <div role="status" className="rounded-xl border border-amber-500/30 p-4 text-sm text-amber-100">{language==='en'?'Checking the verified profession server…':'Проверяем защищённый сервер профессий…'}</div>;
  if (error || !status?.enabled) return <div role="status" className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
    <ShieldCheck className="h-6 w-6"/><b className="block">{language==='en'?'Crafting is paused safely':'Ремесло безопасно приостановлено'}</b>
    <p>{error||(language==='en'?'Server release is not enabled yet. Your items, resources and mastery are preserved.':'Серверный этап ещё не включён. Твои вещи, ресурсы и мастерство сохранены.')}</p>
    <button className="rounded-lg bg-amber-600 px-3 py-2 font-bold" onClick={()=>{void refresh();}}><RefreshCw className="mr-1 inline h-4 w-4"/>{language==='en'?'Check again':'Проверить снова'}</button>
  </div>;

  const nextXp=stage8XpToNext(status.masteryLevel);
  return <div className="space-y-3 pb-5 text-white">
    <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-[#282116] to-[#111820] p-4">
      <div className="flex items-center gap-2 text-amber-100"><ShieldCheck className="h-6 w-6 text-emerald-300"/><b>{language==='en'?'Verified professions':'Защищённые профессии'}</b></div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-black/30 p-2"><span className="block text-slate-400">{language==='en'?'Mastery':'Мастерство'}</span><b>{status.masteryLevel}/300</b></div>
        <div className="rounded-lg bg-black/30 p-2"><span className="block text-slate-400">{language==='en'?'XP to level':'Опыт'}</span><b>{nextXp?`${status.masteryXp}/${nextXp}`:'MAX'}</b></div>
        <div className="rounded-lg bg-black/30 p-2"><span className="block text-slate-400">{language==='en'?'XP today':'Опыт за день'}</span><b>{status.dailyXpUsed}/{status.dailyXpCap}</b></div>
      </div>
      <p className="mt-2 text-xs text-slate-400">{language==='en'?'Daily XP resets at 00:00 UTC.':'Дневной лимит обновляется в 00:00 UTC.'}</p>
      {status.profession && <p className="mt-2 text-sm font-bold text-amber-200">{language==='en'?'Profession':'Профессия'}: {PROFESSION_DEFINITIONS.find((p)=>p.id===status.profession)?.name}</p>}
      {status.masterLicense && <p className="mt-1 text-xs text-emerald-300">👑 {language==='en'?'Master license confirmed':'Лицензия мастера подтверждена'}</p>}
      {status.profession && <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/50" role="progressbar" aria-label={language==='en'?'Mastery progress':'Прогресс мастерства'} aria-valuenow={nextXp?status.masteryXp:1} aria-valuemin={0} aria-valuemax={nextXp||1}>
        <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-amber-400" style={{width:`${nextXp?Math.min(100,status.masteryXp/nextXp*100):100}%`}}/>
      </div>}
    </div>
    {!status.profession ? <div className="space-y-2 rounded-xl border border-white/10 p-3">
      <p className="text-xs text-slate-300">{language==='en'?'Choose one profession permanently for 1,000 blue gems.':'Выбери одну профессию навсегда за 1000 синих алмазов.'}</p>
      {PROFESSION_DEFINITIONS.map((p)=><button key={p.id} disabled={busy||!!purchasePending} onClick={()=>{void choose(p.id);}} className="flex w-full items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-2.5 text-left text-sm font-bold disabled:opacity-40"><img src={PROFESSION_ART[p.id]} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-lg border border-amber-400/25 bg-slate-800/40 object-contain"/><span>{p.name} · 1000 💎</span></button>)}
    </div> : <>
      <section className="rounded-xl border border-amber-400/20 bg-gradient-to-br from-slate-900 to-[#1c2331] p-3" data-testid="workshop-resources">
        <div className="flex items-center justify-between gap-2"><b className="text-sm text-amber-100">{language==='en'?'Workshop warehouse':'Склад мастерской'}</b><span className="text-xs font-bold text-emerald-300">{readyRecipes} {language==='en'?'recipes ready':'рецептов готово'}</span></div>
        <div className="mt-2 grid grid-cols-5 gap-1">
          {RESOURCE_DEFINITIONS.map(resource=><div key={resource.id} className="min-w-0 rounded-md border border-white/10 bg-black/25 px-0.5 py-1.5 text-center" title={resource.name}>
            <img src={resourceArt(resource.id)} alt="" loading="lazy" className="mx-auto h-7 w-7 object-contain"/>
            <span className="block truncate text-[10px] font-black text-white tabular-nums">{status.resources[resource.id]??0}</span>
          </div>)}
        </div>
        {onNavigate&&<div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] font-bold">
          <button type="button" className="rounded-lg border border-sky-400/30 bg-sky-500/15 p-2 text-sky-100" onClick={()=>onNavigate('map')}><MapPinned className="mx-auto mb-1 h-4 w-4"/>{language==='en'?'Gather':'Добыча'}</button>
          <button type="button" className="rounded-lg border border-amber-400/30 bg-amber-500/15 p-2 text-amber-100" onClick={()=>onNavigate('inventory')}><Package className="mx-auto mb-1 h-4 w-4"/>{language==='en'?'Inventory':'Инвентарь'}</button>
          <button type="button" className="rounded-lg border border-orange-400/30 bg-orange-500/15 p-2 text-orange-100" onClick={()=>onNavigate('forge')}><Anvil className="mx-auto mb-1 h-4 w-4"/>{language==='en'?'Forge':'Кузница'}</button>
        </div>}
      </section>
      <div className="flex items-center justify-between gap-2"><b className="text-sm text-amber-100">{language==='en'?'Training and recipes':'Обучение и рецепты'}</b><span className="text-xs text-slate-400">{shownRecipes.length}/{available.length}</span></div>
      <div className="relative"><Search size={16} className="absolute left-3 top-2.5 text-slate-400"/><input value={recipeSearch} onChange={event=>setRecipeSearch(event.target.value)} placeholder={language==='en'?'Find a recipe…':'Найти рецепт…'} aria-label={language==='en'?'Find a recipe':'Найти рецепт'} className="w-full rounded-lg border border-white/15 bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500"/></div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={language==='en'?'Recipe filters':'Фильтр рецептов'}>
        {(['ready','nearby','all','locked'] as const).map(mode=><button type="button" key={mode} aria-pressed={recipeFilter===mode} onClick={()=>setRecipeFilter(mode)} className={`shrink-0 rounded-lg border px-2.5 py-2 text-[11px] font-bold ${recipeFilter===mode?'border-amber-300 bg-amber-500/25 text-amber-100':'border-white/10 bg-white/5 text-slate-300'}`}>
          {mode==='ready'?(language==='en'?'Ready':'Можно создать'):mode==='nearby'?(language==='en'?'Nearby':'Ближайшие'):mode==='locked'?(language==='en'?'Locked':'Недоступные'):(language==='en'?'All':'Все')}
        </button>)}
      </div>
      {shownRecipes.length===0&&<div className="rounded-xl border border-dashed border-amber-400/25 bg-black/20 p-4 text-center text-xs text-slate-300">{language==='en'?'No matching recipes. Change the filter or gather materials.':'По выбранному фильтру рецептов нет. Смени фильтр или собери ресурсы.'}</div>}
      {shownRecipes.map((recipe)=>{
        const readiness=recipeReadiness(recipe,status);
        const hasLevel=readiness.levelReady;
        const hasLicense=readiness.licenseReady;
        const hasResources=readiness.missing.length===0;
        const hasXpRoom=readiness.xpReady;
        const canRun=readiness.ready && !pending && !busy;
        const label=recipe.kind==='practice' ? recipe.name??'Обучение мастера' : recipe.output?.name??recipe.id;
        return <article key={recipe.id} className="rounded-xl border border-amber-400/15 bg-slate-900/80 p-3">
          <div className="flex items-start gap-2"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-amber-400/15 bg-amber-400/10 p-1"><img src={recipe.output?craftOutputArt(recipe.output):PROFESSION_ART[recipe.profession]} alt="" loading="lazy" className="h-full w-full object-contain"/></div><div className="min-w-0 flex-1"><b className="text-sm">{localizeText(label,language)}</b><p className="text-xs text-amber-300">{language==='en'?'Profession mastery Lv.':'Мастерство профессии ур.'} {recipe.requiredLevel} · +{recipe.masteryXp} XP</p><p className="mt-1 text-xs text-slate-400">{recipe.kind==='practice'?(language==='en'?'Consumes resources, awards verified mastery; no inventory junk.':'Расходует ресурсы и даёт мастерство без лишних предметов.'):recipe.output?.description}</p></div>{!hasLicense&&<Lock className="h-4 w-4 text-amber-300"/>}{recipe.requiredLevel>=300&&<Sparkles className="h-4 w-4 text-violet-300"/>}</div>
          <div className="mt-2 flex flex-wrap gap-1">{recipe.ingredients.map((ingredient)=>{
            const material=RESOURCE_DEFINITIONS.find((r)=>r.id===ingredient.id);
            const insufficient=(status.resources[ingredient.id]??0)<ingredient.qty;
            return <span key={ingredient.id} className={`rounded-md px-2 py-1 text-[11px] ${insufficient?'bg-rose-500/15 text-rose-200':'bg-emerald-500/10 text-emerald-100'}`}>{material&&<img src={resourceArt(material.id)} alt="" className="mr-1 inline-block h-4 w-4 object-contain"/>}{material?.name} {status.resources[ingredient.id]??0}/{ingredient.qty}</span>;
          })}</div>
          {!hasResources&&<p className="mt-1 text-[10px] text-rose-300">{language==='en'?'Missing materials':'Не хватает ресурсов'}: {readiness.missing.map(ingredient=>`${RESOURCE_DEFINITIONS.find(resource=>resource.id===ingredient.id)?.name??ingredient.id} ×${ingredient.need}`).join(' · ')}</p>}
          <button disabled={!canRun} className="mt-2 w-full rounded-lg bg-amber-600 p-2 text-xs font-bold disabled:opacity-40" onClick={()=>{void start(recipe.id);}}><Hammer className="mr-1 inline h-3.5 w-3.5"/>{!hasLevel?`${language==='en'?'Need mastery level':'Нужно мастерство'} ${recipe.requiredLevel}`:!hasLicense?(language==='en'?'Master license required':'Нужна лицензия мастера'):!hasResources?(language==='en'?'Not enough resources':'Не хватает ресурсов'):!hasXpRoom?(language==='en'?'Daily XP limit reached':'Дневной лимит опыта'):recipe.kind==='practice'?(language==='en'?'Train profession':'Обучаться'):(language==='en'?'Craft item':'Создать предмет')}</button>
        </article>;
      })}
    </>}
    {pending && <button disabled={busy} className="w-full rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-sm font-bold text-amber-200 disabled:opacity-50" onClick={()=>{void confirm(pending.recipeId,pending.operationId);}}>{language==='en'?'Retry saved operation (no double debit)':'Повторить сохранённую операцию без двойного списания'}</button>}
    {purchasePending && <button disabled={busy} className="w-full rounded-lg border border-sky-400/50 bg-sky-400/10 p-3 text-sm font-bold text-sky-200 disabled:opacity-50" onClick={()=>{void confirmPurchase(purchasePending.profession,purchasePending.operationId);}}>{language==='en'?'Verify/retry previous purchase (no double debit)':'Проверить прежнюю покупку без повторного списания'}</button>}
    {notice && <div role="status" className="rounded-xl bg-sky-500/10 p-3 text-xs text-sky-100">{notice}</div>}
    {craftedItemTab&&onNavigate&&<button type="button" onClick={()=>onNavigate('inventory',craftedItemTab)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/20 p-3 text-sm font-black text-emerald-100"><Package size={17}/>{language==='en'?'See crafted item in Inventory':'Посмотреть созданную вещь в инвентаре'}</button>}
  </div>;
}
