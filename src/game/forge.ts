import type { Equipment, GameState, InventoryItem } from './types';
import { upgradeEquipment } from './equipmentBalance';

/** A single forge transaction, against the CURRENT state. Never use a delayed
 * captured copy of the user's wallet or equipment after another game action.
 * This is a client-side consistency fix, NOT server-authoritative spending. */
export function forgeCost(level: number) {
  return { gold: 50 + level * 30, materials: 1 + Math.floor(level / 3) };
}

export function forgeSuccessRate(level: number): number {
  return Math.max(0.5, 0.9 - level * 0.05);
}

export type ForgeOutcome = { next: GameState; status: 'success' | 'failed' | 'invalid' };

export function forgeAttempt(state: GameState, itemId: string, expectedLevel: number, roll: number): ForgeOutcome {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1 || !Number.isSafeInteger(expectedLevel) || expectedLevel < 1) return { next: state, status: 'invalid' };
  const equippedMode = itemId.startsWith('equipped_');
  const actualId = equippedMode ? itemId.slice('equipped_'.length) : itemId;
  const equipped = equippedMode ? Object.values(state.player.equipped).find((eq) => eq?.id === actualId) : undefined;
  const item = equippedMode ? undefined : state.inventory.find((i) => i.id === actualId && i.type === 'equipment');
  const eq = equipped ?? item?.equipment;
  if (!eq || !Number.isSafeInteger(eq.level) || eq.level !== expectedLevel || eq.level >= state.player.level) return { next: state, status: 'invalid' };
  const cost = forgeCost(eq.level);
  if (!Number.isSafeInteger(state.player.gold) || state.player.gold < cost.gold || !Number.isSafeInteger(state.forgeMaterials) || state.forgeMaterials < cost.materials) return { next: state, status: 'invalid' };

  const won = roll < forgeSuccessRate(eq.level);
  const upgraded: Equipment | null = won ? upgradeEquipment(eq) : null;
  const newEquipped = won && equipped ? { ...state.player.equipped, [eq.slot]: upgraded! } : state.player.equipped;
  const newInventory: InventoryItem[] = won && item ? state.inventory.map((it) => it.id === itemId
    ? { ...it, equipment: upgraded!, description: `Уровень ${upgraded!.level} · ${upgraded!.rarity}` } : it) : state.inventory;
  return {
    status: won ? 'success' : 'failed',
    next: {
      ...state, player: { ...state.player, gold: state.player.gold - cost.gold, equipped: newEquipped },
      forgeMaterials: state.forgeMaterials - cost.materials, inventory: newInventory,
    },
  };
}

/** A reason to upgrade ALL seven slots, not only sword and armor.
 * These small bonuses apply only to PvE (not Arena) and are capped.
 */
export function forgedSlotCount(equipped: GameState['player']['equipped']): number {
  return (Object.entries(equipped) as [string, Equipment | undefined][]).filter(([slot, eq]) =>
    !!eq && eq.slot === slot && Number.isSafeInteger(eq.upgradeCount) && (eq.upgradeCount ?? 0) >= 1).length;
}

export function forgeSetBonus(equipped: GameState['player']['equipped']) {
  const slots = forgedSlotCount(equipped);
  return { slots, hp: slots >= 3 ? 0.02 : 0, defense: slots >= 5 ? 0.03 : 0, attack: slots >= 7 ? 0.04 : 0 };
}
