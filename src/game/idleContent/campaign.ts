/**
 * Adventure content identities from the TERRITORY 1.0 combat laboratory.
 * This is descriptive content only: stage access, enemy combat stats and rewards
 * are determined by the server's approved encounter configuration.
 */
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

export const CAMPAIGN_STAGE_COUNT = 100;
export type CampaignStage = {
  index: number;
  chapter: number;
  chapterName: string;
  stageInChapter: number;
  kind: 'normal' | 'elite' | 'boss';
  enemyId: string;
  enemyName: string;
  enemyArt: string;
};

/** Reject invalid indices rather than silently wrapping or unlocking new stages. */
export function getCampaignStage(index: number): CampaignStage {
  if (!Number.isInteger(index) || index < 1 || index > CAMPAIGN_STAGE_COUNT) {
    throw new RangeError('invalid_campaign_stage');
  }
  const stageInChapter = ((index - 1) % 20) + 1;
  const chapter = Math.floor((index - 1) / 20) + 1;
  const boss = stageInChapter === 10 || stageInChapter === 20;
  const elite = stageInChapter === 5 || stageInChapter === 15;
  // Boss roster is ordered by chapter; each of its ten members appears once.
  const entry = boss ? BOSS_ROSTER[(chapter - 1) * 2 + (stageInChapter === 20 ? 1 : 0)]
    : ENEMY_ROSTER[(index - 1) % ENEMY_ROSTER.length];
  return {
    index, chapter, chapterName: CAMPAIGN_CHAPTERS[chapter - 1], stageInChapter,
    kind: boss ? 'boss' : elite ? 'elite' : 'normal',
    enemyId: entry.id, enemyName: entry.name,
    enemyArt: `${boss ? 'bosses' : 'enemies'}/${entry.id}`,
  };
}

export function buildCampaign(): CampaignStage[] {
  return Array.from({ length: CAMPAIGN_STAGE_COUNT }, (_, i) => getCampaignStage(i + 1));
}
