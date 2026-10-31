/**
 * Read-only preparation goal for the existing profession recipes.
 * Never changes balances, inventory, ownership or server craft receipts.
 */
export type CraftRouteIngredient = { id: string; qty: number };
export type CraftRouteRecipe = { id: string; requiredLevel: number; ingredients: readonly CraftRouteIngredient[] };

export function nextCraftRoute<T extends CraftRouteRecipe>(
  recipes: readonly T[],
  masteryLevel: number,
  owned: (resourceId: string) => number,
): { recipe: T; levelReady: boolean; ready: boolean; missing: { id: string; need: number }[] } | null {
  const candidates = recipes.filter(recipe => recipe.requiredLevel < 300).map(recipe => {
    const missing = recipe.ingredients.map(ingredient => ({
      id: ingredient.id,
      need: Math.max(0, ingredient.qty - Math.max(0, owned(ingredient.id))),
    })).filter(ingredient => ingredient.need > 0);
    const levelReady = masteryLevel >= recipe.requiredLevel;
    return { recipe, levelReady, ready: levelReady && missing.length === 0, missing };
  });
  candidates.sort((a, b) =>
    Number(b.ready) - Number(a.ready)
    || Number(b.levelReady) - Number(a.levelReady)
    || a.missing.reduce((sum, item) => sum + item.need, 0) - b.missing.reduce((sum, item) => sum + item.need, 0)
    || a.recipe.requiredLevel - b.recipe.requiredLevel
  );
  return candidates[0] ?? null;
}
