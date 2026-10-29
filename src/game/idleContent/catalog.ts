/** Original TERRITORY content for the isolated idle-combat preview.
 * Not a live reward, inventory, or balance catalog. */

export type SkillBranch = 'base' | 'core' | 'control' | 'awakening' | 'final';
export type CombatVfx = 'steel' | 'wind' | 'fire' | 'ice' | 'lightning' | 'shield' | 'wolf' | 'heal' | 'precision';

export type IdleSkillContent = {
  id: string;
  branch: SkillBranch;
  name: string;
  description: string;
  symbol: string;
  vfx: CombatVfx;
  cooldownSeconds: number;
  energyCost: number;
  hits?: number;
  hitGapMs?: number;
  hue: number;
};

export type IdleRuneContent = {
  id: string;
  name: string;
  detail: string;
  symbol: string;
  vfx: CombatVfx;
  accent: string;
  compatible: SkillBranch[];
};

export type IdlePassiveContent = {
  id: string;
  name: string;
  description: string;
  symbol: string;
  accent: string;
};

export const BRANCHES: ReadonlyArray<{ id: SkillBranch; title: string; short: string }> = [
  { id: 'base', title: 'База', short: 'Удары оружием' },
  { id: 'core', title: 'Ядро', short: 'Сила стихий' },
  { id: 'control', title: 'Контроль', short: 'Срыв атак' },
  { id: 'awakening', title: 'Пробуждение', short: 'Боевая стойка' },
  { id: 'final', title: 'Финал', short: 'Решающая атака' },
];

export const IDLE_SKILLS: ReadonlyArray<IdleSkillContent> = [
  { id: 'double_cleave', branch: 'base', name: 'Двойной рубящий', description: 'Два стремительных удара с переменой стойки.', symbol: '⚔', vfx: 'steel', cooldownSeconds: 2.5, energyCost: 0, hits: 2, hitGapMs: 220, hue: 38 },
  { id: 'hunter_lunge', branch: 'base', name: 'Выпад охотника', description: 'Рывок вперёд и точный удар по слабому месту.', symbol: '➶', vfx: 'precision', cooldownSeconds: 3, energyCost: 0, hue: 195 },
  { id: 'axe_circle', branch: 'base', name: 'Круг секиры', description: 'Два размашистых удара по противнику.', symbol: '✶', vfx: 'wind', cooldownSeconds: 4, energyCost: 0, hits: 2, hitGapMs: 240, hue: 118 },

  { id: 'forge_heat', branch: 'core', name: 'Жар кузни', description: 'Оружие вспыхивает и оставляет огненный след.', symbol: '♨', vfx: 'fire', cooldownSeconds: 7, energyCost: 14, hue: 18 },
  { id: 'storm_spark', branch: 'core', name: 'Искра бури', description: 'С меча срывается разряд северной грозы.', symbol: 'ϟ', vfx: 'lightning', cooldownSeconds: 8, energyCost: 16, hue: 210 },
  { id: 'warband_roar', branch: 'core', name: 'Рёв дружины', description: 'Боевой клич восстанавливает энергию отряда.', symbol: '✦', vfx: 'heal', cooldownSeconds: 10, energyCost: 8, hue: 80 },

  { id: 'ice_shackles', branch: 'control', name: 'Ледяные оковы', description: 'Мороз сковывает врага и мешает ответить.', symbol: '❄', vfx: 'ice', cooldownSeconds: 9, energyCost: 18, hue: 197 },
  { id: 'ancestral_shield', branch: 'control', name: 'Щит предков', description: 'Блокирует натиск и открывает окно контратаки.', symbol: '⬡', vfx: 'shield', cooldownSeconds: 9, energyCost: 12, hue: 47 },
  { id: 'wolf_charge', branch: 'control', name: 'Волчий наскок', description: 'Рывок с двумя быстрыми ударами сбивает противника с ритма.', symbol: '♜', vfx: 'wolf', cooldownSeconds: 8, energyCost: 15, hits: 2, hitGapMs: 180, hue: 125 },

  { id: 'berserker_fury', branch: 'awakening', name: 'Ярость берсерка', description: 'Три быстрых удара с нарастающим напором.', symbol: '✹', vfx: 'fire', cooldownSeconds: 17, energyCost: 26, hits: 3, hitGapMs: 160, hue: 8 },
  { id: 'jarl_resolve', branch: 'awakening', name: 'Сила ярла', description: 'Герой занимает крепкую защитную позицию.', symbol: '♛', vfx: 'shield', cooldownSeconds: 18, energyCost: 22, hue: 42 },
  { id: 'valkyrie_song', branch: 'awakening', name: 'Песнь валькирии', description: 'Золотой свет поддерживает здоровье и дух.', symbol: '✧', vfx: 'heal', cooldownSeconds: 20, energyCost: 24, hue: 293 },

  { id: 'thunder_wrath', branch: 'final', name: 'Гнев грома', description: 'Один сокрушительный удар с громовым разрядом.', symbol: 'ϟ', vfx: 'lightning', cooldownSeconds: 25, energyCost: 40, hue: 225 },
  { id: 'northern_blizzard', branch: 'final', name: 'Метель севера', description: 'Три ледяных удара кружат вокруг врага.', symbol: '❅', vfx: 'ice', cooldownSeconds: 27, energyCost: 38, hits: 3, hitGapMs: 190, hue: 192 },
  { id: 'burning_axe', branch: 'final', name: 'Пылающая секира', description: 'Два тяжёлых рубящих удара в огненном вихре.', symbol: '☄', vfx: 'fire', cooldownSeconds: 26, energyCost: 42, hits: 2, hitGapMs: 210, hue: 24 },
];

export const IDLE_RUNES: ReadonlyArray<IdleRuneContent> = [
  { id: 'fire_ember', name: 'Тлеющий пепел', detail: 'Поджигает удар и оставляет краткий след пламени.', symbol: '♨', vfx: 'fire', accent: '#ff8d3f', compatible: ['base', 'core', 'awakening', 'final'] },
  { id: 'glacial_edge', name: 'Грань льда', detail: 'Зачаровывает удар морозом и замедляет цель.', symbol: '❄', vfx: 'ice', accent: '#6de6ff', compatible: ['base', 'core', 'control', 'final'] },
  { id: 'storm_core', name: 'Сердце грозы', detail: 'Добавляет разряд молнии и отклик энергии.', symbol: 'ϟ', vfx: 'lightning', accent: '#a2b7ff', compatible: ['core', 'awakening', 'final'] },
  { id: 'wolf_fang', name: 'Волчий клык', detail: 'Усиливает точную серию яростных ударов.', symbol: '♜', vfx: 'wolf', accent: '#a2f47f', compatible: ['base', 'control', 'awakening'] },
  { id: 'oak_bark', name: 'Дубовая кора', detail: 'Укрепляет стойку и уменьшает входящий урон.', symbol: '⬡', vfx: 'shield', accent: '#ffd36b', compatible: ['control', 'awakening'] },
  { id: 'seers_mark', name: 'Метка провидца', detail: 'Отмечает слабое место противника для следующей атаки.', symbol: '✧', vfx: 'precision', accent: '#d6a6ff', compatible: ['base', 'core', 'final'] },
];

export const IDLE_PASSIVES: ReadonlyArray<IdlePassiveContent> = [
  { id: 'northern_stamina', name: 'Крепость Севера', description: 'Выносливость героя и крепость щита.', symbol: '♥', accent: '#ff7b89' },
  { id: 'rune_sense', name: 'Рунное чутьё', description: 'Более уверенное управление боевой энергией.', symbol: '✷', accent: '#91b4ff' },
  { id: 'battle_memory', name: 'Память битв', description: 'Сосредоточенность после успешной комбинации.', symbol: '✦', accent: '#ffce71' },
];

export const DEFAULT_SKILLS: Readonly<Record<SkillBranch, string>> = {
  base: 'double_cleave', core: 'forge_heat', control: 'ice_shackles', awakening: 'berserker_fury', final: 'thunder_wrath',
};

export function findIdleSkill(id: string): IdleSkillContent | undefined {
  return IDLE_SKILLS.find((skill) => skill.id === id);
}

export function availableRunesForSkill(skill: IdleSkillContent): IdleRuneContent[] {
  return IDLE_RUNES.filter((rune) => rune.compatible.includes(skill.branch));
}
