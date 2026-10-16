export interface AppearancePreset {
  id: string;
  name: string;
  icon: string;
  desc: string;
  gender: 'male' | 'female';
  available: boolean;
}

export interface CombatAppearance {
  idle: string;
  attack: string;
  block: string;
  dodge?: string;
  hit: string;
  death: string;
}

function frames(hero: string): CombatAppearance {
  const folder = import.meta.env.BASE_URL + 'assets/territory/characters/heroes/' + hero + '/';
  return {
    idle: folder + 'idle.webp',
    attack: folder + 'attack.webp',
    block: folder + 'block.webp',
    dodge: folder + 'dodge.webp',
    hit: folder + 'hit.webp',
    death: folder + 'death.webp',
  };
}

// Keep m2 as the default for backward-compatible cloud saves.
export const MALE2_COMBAT: CombatAppearance = frames('male_viking');

const COMBAT_FRAMES: Record<string, CombatAppearance> = {
  m1: frames('male_rogue'),
  m2: MALE2_COMBAT,
  f1: frames('female_warrior'),
  f2: frames('female_archer'),
};

export const APPEARANCE_PRESETS: AppearancePreset[] = [
  { id: 'm2', name: 'Викинг / Viking', icon: COMBAT_FRAMES.m2.idle, desc: 'Меч и щит', gender: 'male', available: true },
  { id: 'm1', name: 'Разбойник / Rogue', icon: COMBAT_FRAMES.m1.idle, desc: 'Клинки', gender: 'male', available: true },
  { id: 'f1', name: 'Воительница / Warrior', icon: COMBAT_FRAMES.f1.idle, desc: 'Меч и щит', gender: 'female', available: true },
  { id: 'f2', name: 'Лучница / Archer', icon: COMBAT_FRAMES.f2.idle, desc: 'Лук', gender: 'female', available: true },
];

export const MALE_PRESETS = APPEARANCE_PRESETS.filter((p) => p.gender === 'male');
export const FEMALE_PRESETS = APPEARANCE_PRESETS.filter((p) => p.gender === 'female');
export const DEFAULT_APPEARANCE = 'm2';

export function getPlayableAppearance(id: string | undefined): string {
  return !!id && Object.prototype.hasOwnProperty.call(COMBAT_FRAMES, id) ? id : DEFAULT_APPEARANCE;
}

export function getAppearanceIcon(id: string | undefined): string {
  return getCombatAppearance(id).idle;
}

export function getCombatAppearance(id: string | undefined): CombatAppearance {
  return COMBAT_FRAMES[getPlayableAppearance(id)];
}
