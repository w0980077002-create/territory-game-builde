import type { Stage8Recipe, Stage8Status } from './stage8CraftApi';

/** Read-only craft preparation. Execution, prices and loot stay on the server. */
export function recipeReadiness(recipe: Stage8Recipe, status: Pick<Stage8Status,
  'masteryLevel' | 'masterLicense' | 'dailyXpCap' | 'dailyXpUsed' | 'resources'>) {
  const levelReady = status.masteryLevel >= recipe.requiredLevel;
  const licenseReady = recipe.requiredLevel < 300 || status.masterLicense;
  const xpReady = status.masteryLevel >= 300 || recipe.masteryXp <= Math.max(0, status.dailyXpCap - status.dailyXpUsed);
  const missing = recipe.ingredients.map(ingredient => ({
    id: ingredient.id,
    need: Math.max(0, ingredient.qty - (status.resources[ingredient.id] ?? 0)),
  })).filter(ingredient => ingredient.need > 0);
  return {
    levelReady, licenseReady, xpReady, missing,
    ready: levelReady && licenseReady && xpReady && missing.length === 0,
  };
}

export type WorkshopRecipeFilter = 'all' | 'ready' | 'nearby' | 'locked';

export function visibleWorkshopRecipes(recipes: readonly Stage8Recipe[], status: Stage8Status,
  filter: WorkshopRecipeFilter, search: string): Stage8Recipe[] {
  const term = search.trim().toLocaleLowerCase('ru-RU');
  const filtered = recipes.filter(recipe => {
    const readiness = recipeReadiness(recipe, status);
    if (filter === 'ready' && !readiness.ready) return false;
    if (filter === 'nearby' && recipe.requiredLevel > Math.max(25, status.masteryLevel) + 25) return false;
    if (filter === 'locked' && readiness.ready) return false;
    if (term && !(recipe.name ?? recipe.output?.name ?? recipe.id).toLocaleLowerCase('ru-RU').includes(term)) return false;
    return true;
  });
  return filtered.sort((a, b) => {
    const aReady = Number(recipeReadiness(a, status).ready);
    const bReady = Number(recipeReadiness(b, status).ready);
    return bReady - aReady || a.requiredLevel - b.requiredLevel || a.id.localeCompare(b.id);
  });
}

/** The next achievable workshop action, derived from verified server resources only. */
export type WorkshopGuidance =
  | { kind: 'materials'; recipe: Stage8Recipe; missing: { id: string; need: number }[] }
  | { kind: 'dailyCap' }
  | { kind: 'masterLicense' }
  | { kind: 'level'; level: number };

export function nextWorkshopGuidance(recipes: readonly Stage8Recipe[],
  status: Stage8Status): WorkshopGuidance | null {
  const checks = recipes.map(recipe => ({ recipe, check: recipeReadiness(recipe, status) }));
  if (checks.some(({check}) => check.ready)) return null;
  const candidates = checks.filter(({check}) =>
    check.levelReady && check.licenseReady && check.xpReady && check.missing.length > 0);
  if (candidates.length) {
    candidates.sort((a, b) =>
      a.check.missing.reduce((sum, ingredient) => sum + ingredient.need, 0)
        - b.check.missing.reduce((sum, ingredient) => sum + ingredient.need, 0)
      || Number(a.recipe.kind !== 'practice') - Number(b.recipe.kind !== 'practice')
      || a.recipe.requiredLevel - b.recipe.requiredLevel || a.recipe.id.localeCompare(b.recipe.id));
    return {kind:'materials',recipe:candidates[0].recipe,missing:candidates[0].check.missing};
  }
  if (checks.some(({check}) => check.levelReady && check.licenseReady && !check.xpReady))
    return {kind:'dailyCap'};
  if (checks.some(({check}) => check.levelReady && !check.licenseReady))
    return {kind:'masterLicense'};
  const nextLevel = Math.min(...checks.filter(({check}) => !check.levelReady)
    .map(({recipe}) => recipe.requiredLevel));
  return Number.isFinite(nextLevel) ? {kind:'level',level:nextLevel} : null;
}

const resourceForms: Record<string, { ru:[string,string,string]; en:string }> = {
  'gather-wood': {ru:['дерево','дерева','деревьев'],en:'wood'},
  'gather-ore': {ru:['руду','руды','руды'],en:'ore'},
  'gather-herb': {ru:['траву','травы','трав'],en:'herbs'},
  'gather-hide': {ru:['шкуру','шкуры','шкур'],en:'hides'},
  'gather-crystal': {ru:['кристалл','кристалла','кристаллов'],en:'crystals'},
};
export function workshopGuidanceText(guidance: WorkshopGuidance, language:'ru'|'en'): string {
  if (guidance.kind==='dailyCap') return language==='en'
    ? 'Daily mastery XP limit reached. Come back after 00:00 UTC.'
    : 'Дневной лимит опыта: продолжи обучение после 00:00 UTC.';
  if (guidance.kind==='masterLicense') return language==='en'
    ? 'A Master License is needed for level 300 recipes.'
    : 'Для рецептов 300-го уровня нужна лицензия мастера.';
  if (guidance.kind==='level') return language==='en'
    ? `Next recipe unlocks at mastery level ${guidance.level}.`
    : `Следующий рецепт откроется на уровне мастерства ${guidance.level}.`;
  const items = guidance.missing.map(({id,need}) => {
    const forms=resourceForms[id];
    if (!forms) return `${need} ${id}`;
    if (language==='en') return `${need} ${forms.en}`;
    const tail=need%100;
    const form=tail>=11&&tail<=14?2:need%10===1?0:need%10>=2&&need%10<=4?1:2;
    return `${need} ${forms.ru[form]}`;
  });
  const list=items.length<=2?items.join(language==='en'?' and ':' и '):
    `${items.slice(0,-1).join(', ')}${language==='en'?', and ':' и '}${items[items.length-1]}`;
  const isTraining=guidance.recipe.kind==='practice';
  return language==='en'
    ? `Gather ${list} ${isTraining?'for your next training':`for the "${guidance.recipe.name??guidance.recipe.output?.name??'item'}" recipe`}.`
    : `Собери ${list} ${isTraining?'для следующего обучения':`для рецепта «${guidance.recipe.name??guidance.recipe.output?.name??'предмет'}»`}.`;
}
