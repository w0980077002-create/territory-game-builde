import { useEffect, useMemo, useState } from 'react';
import { Hammer, Lock, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
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

/** Staging-only: server-authoritative replacement for legacy local crafting. */
export function ProfessionsStage8Screen() {
  const {language} = useLanguage();
  const [status,setStatus] = useState<Stage8Status|null>(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [pending,setPending] = useState<Stage8PendingOperation|null>(null);
  const [purchasePending,setPurchasePending] = useState<Stage8PurchaseOperation|null>(null);
  const [notice,setNotice] = useState('');
  const [showAll,setShowAll] = useState(false);

  const refresh = async () => {
    setLoading(true);setError('');
    try {
      const next=await fetchStage8Status();
      const waiting=await readStage8Pending();
      const purchaseWaiting=await readStage8PurchasePending();
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
  const visibleRecipes=showAll?available:available.filter((recipe)=>recipe.requiredLevel<=Math.max(25,status?.masteryLevel??1)+25);

  const confirm = async (recipeId:string,operationId:string) => {
    setBusy(true);setNotice('');
    try {
      const receipt=await executeStage8(recipeId,operationId);
      const verified=await fetchStage8Status();
      if (!verified.enabled || !verified.profession || verified.masteryLevel<receipt.masteryLevel) throw new Error('stage8_status_not_confirmed');
      const owned=await fetchStage8Items();
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
  const dailyLeft=status.dailyXpCap-status.dailyXpUsed;
  return <div className="space-y-3 pb-5 text-white">
    <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-[#282116] to-[#111820] p-4">
      <div className="flex items-center gap-2 text-amber-100"><ShieldCheck className="h-6 w-6 text-emerald-300"/><b>{language==='en'?'Verified professions':'Защищённые профессии'}</b></div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-black/30 p-2"><span className="block text-slate-400">{language==='en'?'Mastery':'Мастерство'}</span><b>{status.masteryLevel}/300</b></div>
        <div className="rounded-lg bg-black/30 p-2"><span className="block text-slate-400">{language==='en'?'XP to level':'Опыт'}</span><b>{nextXp?`${status.masteryXp}/${nextXp}`:'MAX'}</b></div>
        <div className="rounded-lg bg-black/30 p-2"><span className="block text-slate-400">{language==='en'?'XP today':'Опыт за день'}</span><b>{status.dailyXpUsed}/{status.dailyXpCap}</b></div>
      </div>
      <p className="mt-2 text-xs text-slate-400">{language==='en'?'Daily XP resets at Kyiv midnight.':'Дневной лимит обновляется в полночь по Киеву.'}</p>
      {status.profession && <p className="mt-2 text-sm font-bold text-amber-200">{language==='en'?'Profession':'Профессия'}: {PROFESSION_DEFINITIONS.find((p)=>p.id===status.profession)?.name}</p>}
      {status.masterLicense && <p className="mt-1 text-xs text-emerald-300">👑 {language==='en'?'Master license confirmed':'Лицензия мастера подтверждена'}</p>}
    </div>
    {!status.profession ? <div className="space-y-2 rounded-xl border border-white/10 p-3">
      <p className="text-xs text-slate-300">{language==='en'?'Choose one profession permanently for 1,000 blue gems.':'Выбери одну профессию навсегда за 1000 синих алмазов.'}</p>
      {PROFESSION_DEFINITIONS.map((p)=><button key={p.id} disabled={busy||!!purchasePending} onClick={()=>{void choose(p.id);}} className="flex w-full items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-2.5 text-left text-sm font-bold disabled:opacity-40"><img src={PROFESSION_ART[p.id]} alt="" loading="lazy" className="h-12 w-12 shrink-0 object-contain"/><span>{p.name} · 1000 💎</span></button>)}
    </div> : <>
      <div className="flex items-center justify-between gap-2"><b className="text-sm text-amber-100">{language==='en'?'Training and recipes':'Обучение и рецепты'}</b><button className="text-xs text-sky-300" onClick={()=>setShowAll((s)=>!s)}>{showAll?(language==='en'?'Nearby levels':'Ближайшие уровни'):(language==='en'?'Show all':'Показать все')}</button></div>
      {visibleRecipes.map((recipe)=>{
        const hasLevel=status.masteryLevel>=recipe.requiredLevel;
        const hasLicense=recipe.requiredLevel<300 || status.masterLicense;
        const hasResources=recipe.ingredients.every((r)=>(status.resources[r.id]??0)>=r.qty);
        const hasXpRoom=recipe.masteryXp<=dailyLeft || status.masteryLevel>=300;
        const canRun=hasLevel && hasLicense && hasResources && hasXpRoom && !pending && !busy;
        const label=recipe.kind==='practice' ? recipe.name??'Обучение мастера' : recipe.output?.name??recipe.id;
        return <article key={recipe.id} className="rounded-xl border border-amber-400/15 bg-slate-900/80 p-3">
          <div className="flex items-start gap-2"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-amber-400/15 bg-amber-400/10 p-1"><img src={recipe.output?craftOutputArt(recipe.output):PROFESSION_ART[recipe.profession]} alt="" loading="lazy" className="h-full w-full object-contain"/></div><div className="min-w-0 flex-1"><b className="text-sm">{localizeText(label,language)}</b><p className="text-xs text-amber-300">{language==='en'?'Profession mastery Lv.':'Мастерство профессии ур.'} {recipe.requiredLevel} · +{recipe.masteryXp} XP</p><p className="mt-1 text-xs text-slate-400">{recipe.kind==='practice'?(language==='en'?'Consumes resources, awards verified mastery; no inventory junk.':'Расходует ресурсы и даёт мастерство без лишних предметов.'):recipe.output?.description}</p></div>{!hasLicense&&<Lock className="h-4 w-4 text-amber-300"/>}{recipe.requiredLevel>=300&&<Sparkles className="h-4 w-4 text-violet-300"/>}</div>
          <div className="mt-2 flex flex-wrap gap-1">{recipe.ingredients.map((ingredient)=>{
            const material=RESOURCE_DEFINITIONS.find((r)=>r.id===ingredient.id);
            return <span key={ingredient.id} className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-slate-200">{material&&<img src={resourceArt(material.id)} alt="" className="mr-1 inline-block h-4 w-4 object-contain"/>}{material?.name} {status.resources[ingredient.id]??0}/{ingredient.qty}</span>;
          })}</div>
          <button disabled={!canRun} className="mt-2 w-full rounded-lg bg-amber-600 p-2 text-xs font-bold disabled:opacity-40" onClick={()=>{void start(recipe.id);}}><Hammer className="mr-1 inline h-3.5 w-3.5"/>{!hasLevel?`${language==='en'?'Need mastery level':'Нужно мастерство'} ${recipe.requiredLevel}`:!hasLicense?(language==='en'?'Master license required':'Нужна лицензия мастера'):!hasResources?(language==='en'?'Not enough resources':'Не хватает ресурсов'):!hasXpRoom?(language==='en'?'Daily XP limit reached':'Дневной лимит опыта'):recipe.kind==='practice'?(language==='en'?'Train profession':'Обучаться'):(language==='en'?'Craft item':'Создать предмет')}</button>
        </article>;
      })}
    </>}
    {pending && <button disabled={busy} className="w-full rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-sm font-bold text-amber-200 disabled:opacity-50" onClick={()=>{void confirm(pending.recipeId,pending.operationId);}}>{language==='en'?'Retry saved operation (no double debit)':'Повторить сохранённую операцию без двойного списания'}</button>}
    {purchasePending && <button disabled={busy} className="w-full rounded-lg border border-sky-400/50 bg-sky-400/10 p-3 text-sm font-bold text-sky-200 disabled:opacity-50" onClick={()=>{void confirmPurchase(purchasePending.profession,purchasePending.operationId);}}>{language==='en'?'Verify/retry previous purchase (no double debit)':'Проверить прежнюю покупку без повторного списания'}</button>}
    {notice && <div role="status" className="rounded-xl bg-sky-500/10 p-3 text-xs text-sky-100">{notice}</div>}
  </div>;
}
