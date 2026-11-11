/** Cosmetic, deterministic DEMO catalog. Never used by the server floor catalog. */
export type Biome = 'crystal' | 'spore' | 'ember' | 'astral' | 'forge';
export type Species = 'shardling' | 'moth' | 'eel' | 'boss';
export const CREATURES: Record<Species, { name: string; row: number; hp: number; damage: number; range: number; speed: number }> = {
  shardling: { name: 'Осколочник', row: 0, hp: 115, damage: 13, range: 80, speed: 65 },
  moth: { name: 'Споровый парус', row: 1, hp: 100, damage: 15, range: 125, speed: 50 },
  eel: { name: 'Янтарный глубинник', row: 2, hp: 145, damage: 17, range: 85, speed: 75 },
  boss: { name: 'Собор Бездны', row: 3, hp: 1250, damage: 55, range: 130, speed: 32 },
};
export const BIOMES: Record<Biome, { name: string; color: string; sky: string; enemies: Species[]; art: number }> = {
  crystal: { name: 'Хрустальный разлом', color: '#64e7ff', sky: '#0a1c30', enemies: ['shardling', 'moth', 'shardling'], art: 0 },
  spore: { name: 'Сад без солнца', color: '#a0ef7c', sky: '#10251f', enemies: ['moth', 'moth', 'eel'], art: 1 },
  ember: { name: 'Янтарные недра', color: '#ffb45b', sky: '#291914', enemies: ['eel', 'eel', 'shardling'], art: 2 },
  astral: { name: 'Звёздный склеп', color: '#c6a0ff', sky: '#1c1637', enemies: ['moth', 'shardling', 'moth'], art: 3 },
  forge: { name: 'Сердце разлома', color: '#ff805f', sky: '#30141b', enemies: ['eel', 'shardling', 'eel'], art: 2 },
};
export const PORTALS: { biome: Biome; title: string; hint: string; symbol: string }[][] = [
  [{ biome: 'spore', title: 'Сад без солнца', hint: 'Споровые паруса · дальние атаки', symbol: '✥' }, { biome: 'ember', title: 'Янтарные недра', hint: 'Глубинники · крепкая броня', symbol: '◆' }],
  [{ biome: 'astral', title: 'Звёздный склеп', hint: 'Паруса и Собор Бездны', symbol: '✧' }, { biome: 'forge', title: 'Сердце разлома', hint: 'Глубинники и Собор Бездны', symbol: '♜' }],
];
