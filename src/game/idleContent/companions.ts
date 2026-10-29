/** Five existing approved cartoon Viking companions; isolated preview attack kits. */
import type { IdleCompanionConfig } from '@/game/idleEngine';

export const HERO_APPEARANCES = [
  { id: 'male_viking', name: 'Воин севера' },
  { id: 'male_rogue', name: 'Северный ловкач' },
  { id: 'female_warrior', name: 'Дева щита' },
  { id: 'female_archer', name: 'Охотница' },
] as const;

export const COMPANION_ROSTER: ReadonlyArray<IdleCompanionConfig & { name: string; description: string }> = [
  { id: 'loyal_shield', name: 'Верный щитоносец', description: 'Реальный удар и защитный эффект.',
    attack: 28, intervalMs: 3100, windupMs: 300, vfxKey: 'shield',
    effects: [{ type: 'mitigation', strength: 0.12, durationMs: 1600, vfxKey: 'shield' }] },
  { id: 'rune_mage', name: 'Рунный маг', description: 'Магический разряд, отдельный урон.',
    attack: 0, intervalMs: 4700, windupMs: 380, vfxKey: 'lightning',
    effects: [{ type: 'magic', strength: 44, vfxKey: 'lightning' }] },
  { id: 'moon_hunter', name: 'Лунный охотник', description: 'Точный выстрел и метка цели.',
    attack: 35, intervalMs: 2500, windupMs: 240, vfxKey: 'precision',
    effects: [{ type: 'precision', strength: 0.14, durationMs: 1600, vfxKey: 'precision' }] },
  { id: 'northern_warrior', name: 'Северный воитель', description: 'Быстрый оружейный удар.',
    attack: 40, intervalMs: 2400, windupMs: 220, vfxKey: 'steel' },
  { id: 'forest_healer', name: 'Лесная целительница', description: 'Лечит здоровье, восстанавливает энергию и защищает героя.',
    attack: 0, intervalMs: 6000, windupMs: 400, vfxKey: 'heal',
    effects: [{ type: 'heal', strength: 75, vfxKey: 'heal' },
      { type: 'energy', strength: 16, vfxKey: 'heal' },
      { type: 'mitigation', strength: 0.26, durationMs: 2100, vfxKey: 'heal' }] },
];

export const DEFAULT_COMPANIONS: ReadonlyArray<string> = COMPANION_ROSTER.map(companion => companion.id);
