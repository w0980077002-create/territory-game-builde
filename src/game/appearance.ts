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
  hit: string;
  death: string;
}

export const MALE2_COMBAT: CombatAppearance = {
  idle: '/male2-idle.webp',
  attack: '/male2-attack.webp',
  block: '/male2-block.webp',
  hit: '/male2-hit.webp',
  death: '/male2-death.webp',
};

const PLACEHOLDER_DESC = 'Недоступно';

export const APPEARANCE_PRESETS: AppearancePreset[] = [
  { id: 'm1', name: 'MALE 1', icon: '', desc: PLACEHOLDER_DESC, gender: 'male', available: false },
  { id: 'm2', name: 'MALE 2', icon: MALE2_COMBAT.idle, desc: 'Доступен', gender: 'male', available: true },
  { id: 'm3', name: 'MALE 3', icon: '', desc: PLACEHOLDER_DESC, gender: 'male', available: false },
  { id: 'm4', name: 'MALE 4', icon: '', desc: PLACEHOLDER_DESC, gender: 'male', available: false },
  { id: 'm5', name: 'MALE 5', icon: '', desc: PLACEHOLDER_DESC, gender: 'male', available: false },
  { id: 'f1', name: 'FEMALE 1', icon: '', desc: PLACEHOLDER_DESC, gender: 'female', available: false },
  { id: 'f2', name: 'FEMALE 2', icon: '', desc: PLACEHOLDER_DESC, gender: 'female', available: false },
  { id: 'f3', name: 'FEMALE 3', icon: '', desc: PLACEHOLDER_DESC, gender: 'female', available: false },
  { id: 'f4', name: 'FEMALE 4', icon: '', desc: PLACEHOLDER_DESC, gender: 'female', available: false },
  { id: 'f5', name: 'FEMALE 5', icon: '', desc: PLACEHOLDER_DESC, gender: 'female', available: false },
];

export const MALE_PRESETS = APPEARANCE_PRESETS.filter((p) => p.gender === 'male');
export const FEMALE_PRESETS = APPEARANCE_PRESETS.filter((p) => p.gender === 'female');

export const DEFAULT_APPEARANCE = 'm2';

export function getPlayableAppearance(id: string | undefined): string {
  return id === 'm2' ? id : DEFAULT_APPEARANCE;
}

export function getAppearanceIcon(id: string | undefined): string {
  return MALE2_COMBAT.idle;
}

export function getCombatAppearance(id: string | undefined): CombatAppearance {
  return id === 'm2' ? MALE2_COMBAT : MALE2_COMBAT;
}
