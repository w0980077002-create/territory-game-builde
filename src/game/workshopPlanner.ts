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
