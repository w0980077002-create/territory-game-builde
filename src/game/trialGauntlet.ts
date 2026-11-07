import type { Enemy } from './types';
import type { PveSide } from './pve';

/**
 * A complete Trials floor is a single paid gauntlet: five distinct enemies
 * followed by the floor guardian. The next floor and its ONE existing reward
 * are granted only once, after the final boss dies. All encounter stats are
 * transient and never change the saved hero, economy, or other PvE modes.
 */
export const TRIAL_REGULAR_ENEMIES = 5;
export const TRIAL_ENCOUNTERS_PER_FLOOR = TRIAL_REGULAR_ENEMIES + 1;

const TRIAL_ENEMIES = [
  { name: 'Гоблин-разведчик', art: '/assets/territory/characters/enemies/goblin/idle.webp', hp: 1.20, pressure: 0.038, defense: 0.12 },
  { name: 'Дикий кабан', art: '/assets/territory/characters/enemies/boar/idle.webp', hp: 1.35, pressure: 0.043, defense: 0.15 },
  { name: 'Лесной разбойник', art: '/assets/territory/characters/enemies/bandit/idle.webp', hp: 1.55, pressure: 0.047, defense: 0.17 },
  { name: 'Тёмный волк', art: '/assets/territory/characters/enemies/wolf/idle.webp', hp: 1.75, pressure: 0.052, defense: 0.19 },
  { name: 'Пещерный тролль', art: '/assets/territory/characters/enemies/troll/idle.webp', hp: 1.90, pressure: 0.060, defense: 0.22 },
] as const;

export function buildTrialGauntlet(guardian: Enemy, hero: PveSide): Enemy[] {
  const floor = Number(/^trial_(\d+)$/.exec(guardian.id)?.[1] ?? NaN);
  if (!Number.isSafeInteger(floor) || floor < 1) return [guardian];

  const power = Math.max(1, Math.floor(hero.attack));
  const stamina = Math.max(1, Math.floor(hero.maxHp));
  const armor = Math.max(0, Math.floor(hero.defense));
  // Progression remains harder at higher floors, but a returning high-floor
  // tester won't face dozens of unplayable hours in one paid encounter.
  const floorPressure = 1 + Math.min(1.2, Math.log2(floor) * 0.15);

  return [...TRIAL_ENEMIES, {
    name: guardian.name,
    art: guardian.art,
    hp: 3.25,
    pressure: 0.086,
    defense: 0.27,
  }].map((template, index) => {
    const boss = index === TRIAL_REGULAR_ENEMIES;
    const heroHp = Math.ceil(power * template.hp * floorPressure);
    const guardianHp = Math.floor(guardian.maxHp * (boss ? 1 : 0.16 + index * 0.045));
    const maxHp = Math.max(35, heroHp, Math.min(guardianHp, Math.ceil(power * template.hp * 3)));
    const baseAttack = armor / 2 + stamina * template.pressure * floorPressure;
    const naturalAttack = guardian.attack * (boss ? 1 : 0.42 + index * 0.09);
    const attack = Math.max(1, Math.round(Math.max(baseAttack, Math.min(naturalAttack, baseAttack * 2.8))));
    const defense = Math.max(
      Math.round(power * template.defense),
      Math.min(Math.round(guardian.defense * (boss ? 1 : 0.18 + index * 0.08)), Math.round(power * 0.7)),
    );
    return {
      ...guardian,
      id: `trial_${floor}_wave_${index + 1}`,
      name: template.name,
      art: template.art,
      hp: maxHp,
      maxHp,
      attack,
      defense,
      isBoss: boss,
      // One stone and ONE original floor reward, after the boss only.
      rewardGold: 0,
      rewardXp: 0,
    };
  });
}
