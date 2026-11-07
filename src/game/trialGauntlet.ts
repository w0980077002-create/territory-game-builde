import type { Enemy } from './types';
import type { PveSide } from './pve';

/**
 * Mobile-playable test gauntlet for the first ten Trials floors.
 * No account mutations, new rewards, alternate save paths, or Arena/Cave changes.
 * All three encounters share ONE paid battle, ONE victory, and ONE floor reward.
 */
export function buildTrialGauntlet(guardian: Enemy, hero: PveSide): Enemy[] {
  const floor = Number(/^trial_(\d+)$/.exec(guardian.id)?.[1] ?? NaN);
  if (!Number.isInteger(floor) || floor < 1 || floor > 10) return [guardian];

  // Scale the test encounters to the actual hero in this fight, so a level-59
  // tester starting at floor one still has to defend and land multiple blows.
  // These are fight-local enemy stats; we never modify a player's equipment.
  const power = Math.max(1, Math.floor(hero.attack));
  const stamina = Math.max(1, Math.floor(hero.maxHp));
  const armor = Math.max(0, Math.floor(hero.defense));
  const names = ['Тёмный волк', 'Лесной разбойник', guardian.name];
  const artwork = [
    '/assets/territory/characters/enemies/wolf/idle.webp',
    '/assets/territory/characters/enemies/bandit/idle.webp',
    guardian.art,
  ];
  const hpWeights = [2.3, 2.8, 3.5];
  const pressure = [0.055, 0.072, 0.088];

  return [0, 1, 2].map((wave) => {
    const maxHp = Math.max(35, Math.ceil(power * hpWeights[wave]));
    const attack = Math.max(1, Math.round(armor / 2 + stamina * pressure[wave]));
    const defense = Math.max(0, Math.round(power * (wave === 2 ? 0.3 : 0.18)));
    return {
      ...guardian,
      id: `trial_${floor}_wave_${wave + 1}`,
      name: names[wave],
      art: artwork[wave],
      hp: maxHp,
      maxHp,
      attack,
      defense,
      isBoss: wave === 2,
      // Only the original guardian grants XP at final resolution.
      rewardGold: 0,
      rewardXp: 0,
    };
  });
}
