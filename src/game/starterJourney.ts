import type { GameState } from './types';

export type StarterDestination = 'battle' | 'inventory' | 'shop' | 'arena';
export type StarterMilestone = {
  id: 'first-fight' | 'three-fights' | 'first-equipment' | 'level-five';
  done: boolean;
  destination: StarterDestination;
  titleRu: string;
  titleEn: string;
  actionRu: string;
  actionEn: string;
};

/** A read-only guide over saved gameplay progress. No new currency or tutorial flags. */
export function getStarterMilestones(state: Pick<GameState, 'player' | 'inventory' | 'totalBattlesWon'>): StarterMilestone[] {
  const hasEquipment = Object.values(state.player.equipped ?? {}).some(Boolean);
  const canEquip = (state.inventory ?? []).some((item) => item.type === 'equipment' && !!item.equipment);
  return [
    { id: 'first-fight', done: state.totalBattlesWon >= 1, destination: 'battle', titleRu: 'Победи первого врага', titleEn: 'Win your first fight', actionRu: 'В бой', actionEn: 'Fight' },
    { id: 'three-fights', done: state.totalBattlesWon >= 3, destination: 'battle', titleRu: 'Победи 3 врагов', titleEn: 'Win 3 fights', actionRu: 'Продолжить бой', actionEn: 'Keep fighting' },
    { id: 'first-equipment', done: hasEquipment, destination: canEquip ? 'inventory' : 'shop', titleRu: 'Надень первое снаряжение', titleEn: 'Equip your first item', actionRu: canEquip ? 'В инвентарь' : 'В лавку', actionEn: canEquip ? 'Inventory' : 'Shop' },
    { id: 'level-five', done: state.player.level >= 5, destination: 'battle', titleRu: 'Достигни 5-го уровня', titleEn: 'Reach level 5', actionRu: 'Развивать героя', actionEn: 'Level up' },
  ];
}
