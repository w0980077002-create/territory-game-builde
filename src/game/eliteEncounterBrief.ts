import type { Enemy } from './types';

/** Read-only comparisons of the same saved hero stats and generated enemy
 * used by the classic PvE encounter. No victory prediction, combat modifier,
 * resource spending or state mutation is performed here. */
export function getEliteEncounterBrief(
  enemy: Pick<Enemy, 'attack' | 'defense'>,
  hero: { attack: number; defense: number },
) {
  return {
    heroAttack: hero.attack,
    heroDefense: hero.defense,
    enemyAttack: enemy.attack,
    enemyDefense: enemy.defense,
    attackAtOrBelowDefense: hero.attack <= enemy.defense,
    enemyAttackExceedsDefense: enemy.attack > hero.defense,
  };
}
