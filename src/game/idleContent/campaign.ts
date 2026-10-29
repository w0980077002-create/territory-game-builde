/** Original TERRITORY V1 combat laboratory campaign. No player progress or rewards. */
import type { IdleEffect, IdleSkill, IdleStats } from '@/game/idleEngine';

export const CAMPAIGN_CHAPTERS = [
  'Северные леса', 'Дорога фьордов', 'Туманные курганы', 'Ледяные пределы', 'Врата Рагнарёка',
] as const;

export const ENEMY_ROSTER = [
  { id: 'goblin', name: 'Гоблин-налётчик' },
  { id: 'wolf', name: 'Лесной волк' },
  { id: 'bandit', name: 'Разбойник фьордов' },
  { id: 'boar', name: 'Дикий вепрь' },
  { id: 'troll', name: 'Северный тролль' },
] as const;

export const BOSS_ROSTER = [
  { id: 'bandit_chief', name: 'Вождь разбойников', vfx: 'steel' },
  { id: 'barrow_guardian', name: 'Страж курганов', vfx: 'shield' },
  { id: 'dark_priest', name: 'Тёмный жрец', vfx: 'precision' },
  { id: 'northern_jarl', name: 'Северный ярл', vfx: 'steel' },
  { id: 'storm_lord', name: 'Повелитель бури', vfx: 'lightning' },
  { id: 'fire_lord', name: 'Владыка пламени', vfx: 'fire' },
  { id: 'undead_king', name: 'Король мёртвых', vfx: 'ice' },
  { id: 'giant_king', name: 'Король великанов', vfx: 'wind' },
  { id: 'chaos_shadow', name: 'Тень Хаоса', vfx: 'precision' },
  { id: 'abyss_demon', name: 'Демон Бездны', vfx: 'fire' },
] as const;

export type PreviewStage = {
  index: number;
  chapter: number;
  chapterName: string;
  stageInChapter: number;
  boss: boolean;
  elite: boolean;
  enemyId: string;
  enemyName: string;
  enemyArt: string;
  stats: IdleStats;
  ability?: IdleSkill;
};

const bossEffects: Record<string, IdleEffect[]> = {
  bandit_chief: [{ type: 'precision', strength: 0.3, durationMs: 1300 }],
  barrow_guardian: [{ type: 'mitigation', strength: 0.32, durationMs: 2600 }],
  dark_priest: [{ type: 'magic', strength: 26 }],
  northern_jarl: [{ type: 'crit', strength: 0.3, durationMs: 2000 }],
  storm_lord: [{ type: 'magic', strength: 36 }],
  fire_lord: [{ type: 'burn', strength: 8, durationMs: 1800, tickMs: 600 }],
  undead_king: [{ type: 'slow', strength: 0.28, durationMs: 2200 }],
  giant_king: [{ type: 'mitigation', strength: 0.26, durationMs: 2400 }],
  chaos_shadow: [{ type: 'precision', strength: 0.35, durationMs: 2200 }],
  abyss_demon: [{ type: 'magic', strength: 48 }],
};

export function getPreviewStage(index: number): PreviewStage {
  const safeIndex = Math.max(1, Math.floor(index));
  const stageInChapter = ((safeIndex - 1) % 20) + 1;
  const chapter = Math.floor((safeIndex - 1) / 20) + 1;
  const boss = safeIndex % 5 === 0;
  const elite = boss && safeIndex % 10 !== 0;
  const baseHp = Math.round(350 + safeIndex * 34);
  const baseAttack = Math.round(18 + safeIndex * 1.8);
  if (boss) {
    const entry = BOSS_ROSTER[(Math.floor(safeIndex / 5) - 1) % BOSS_ROSTER.length];
    return {
      index: safeIndex, chapter, chapterName: CAMPAIGN_CHAPTERS[Math.min(chapter - 1, CAMPAIGN_CHAPTERS.length - 1)],
      stageInChapter, boss, elite, enemyId: entry.id, enemyName: entry.name,
      enemyArt: `bosses/${entry.id}`,
      stats: { maxHp: Math.round(baseHp * (elite ? 1.8 : 2.45)), attack: Math.round(baseAttack * 1.5),
        defense: 11 + Math.floor(safeIndex / 4), attackIntervalMs: 1580, windupMs: 320,
        critChance: 0.14, criticalMultiplier: 1.7, blockChance: 0.18, blockReduction: 0.45, dodgeChance: 0.08,
        maxEnergy: 0 },
      ability: {
        id: `boss_${entry.id}`, category: 'core', cooldownMs: elite ? 4700 : 3600, energyCost: 0,
        multiplier: elite ? 1.4 : 1.7, windupMs: 320, vfxKey: entry.vfx,
        effects: bossEffects[entry.id] ?? [],
      },
    };
  }
  const entry = ENEMY_ROSTER[(safeIndex - 1) % ENEMY_ROSTER.length];
  return {
    index: safeIndex, chapter, chapterName: CAMPAIGN_CHAPTERS[Math.min(chapter - 1, CAMPAIGN_CHAPTERS.length - 1)],
    stageInChapter, boss, elite: false, enemyId: entry.id, enemyName: entry.name, enemyArt: `enemies/${entry.id}`,
    stats: { maxHp: baseHp, attack: baseAttack, defense: 7 + Math.floor(safeIndex / 5),
      attackIntervalMs: 1450 - (safeIndex % 3) * 75, windupMs: 240,
      critChance: 0.06, blockChance: 0.08, blockReduction: 0.25, dodgeChance: 0.07 },
  };
}

export function buildPreviewCampaign(count = 100): PreviewStage[] {
  return Array.from({ length: count }, (_, i) => getPreviewStage(i + 1));
}
