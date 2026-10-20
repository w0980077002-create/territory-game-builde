import { EQUIPMENT_BALANCE_VERSION } from './equipmentBalance';
import { initialFollowers } from './followers';
import { calendarDayKey, weeklyQuestKey } from './weeklyQuests';
import { bossEnemyMultipliers, chapterEnemyMultipliers, trialEnemyMultipliers } from './pveBalance';
import { SHOP_EQUIPMENT_ITEMS } from './equipmentCatalog';
import type {
  GameState,
  Chapter,
  Enemy,
  Equipment,
  Quest,
  Achievement,
  Follower,
  ShopItem,
} from './types';

const RARITY_COLORS: Record<string, string> = {
  common: '#9ca3af',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
};

export { RARITY_COLORS };

export const EQUIPMENT_SLOTS: { id: Equipment['slot']; name: string; icon: string }[] = [
  { id: 'helmet', name: 'Шлем', icon: '⛑️' },
  { id: 'amulet', name: 'Амулет', icon: '📿' },
  { id: 'armor', name: 'Броня', icon: '🥋' },
  { id: 'weapon', name: 'Оружие', icon: '⚔️' },
  { id: 'shield', name: 'Щит', icon: '🛡️' },
  { id: 'ring', name: 'Кольцо', icon: '💍' },
  { id: 'boots', name: 'Сапоги', icon: '🥾' },
];

/** Hard cap: hero level never exceeds 100. Forge/profession levels remain independent. */
export const HERO_MAX_LEVEL = 100;
/** Existing progression through level 82 is unchanged, so players can catch up. */
export const HERO_SLOW_GROWTH_FROM = 83;

export function xpForLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  const current = Math.max(1, Math.floor(level));
  if (current >= HERO_MAX_LEVEL) return 0;
  const original = Math.floor(100 * Math.pow(1.15, current - 1));
  if (current < HERO_SLOW_GROWTH_FROM) return original;
  // From hero level 83 onward each promotion takes substantially longer.
  // Preserve the old XP requirement for 82 -> 83, to avoid changing live saves.
  return Math.floor(original * (3 + 0.12 * (current - HERO_SLOW_GROWTH_FROM)));
}

export function createInitialGame(): GameState {
  return {
    balanceVersion: EQUIPMENT_BALANCE_VERSION,
    inventoryCleanupVersion: 1,
    professions: { active: null, masteryLevel: 1, masteryXp: 0, lastGatherAt: 0 },
    player: {
      name: 'Герой',
      level: 1,
      xp: 0,
      xpToNext: xpForLevel(1),
      gold: 100,
      gems: 10,
      redGems: 0,
      energy: 20,
      maxEnergy: 20,
      stats: {
        hp: 100,
        maxHp: 100,
        attack: 20,
        defense: 5,
        critChance: 5,
        critDamage: 50,
      },
      equipped: {},
    },
    inventory: [
      {
        id: 'potion_hp_1',
        name: 'Зелье здоровья',
        icon: '🧪',
        type: 'potion',
        rarity: 'common',
        qty: 3,
        description: 'Восстанавливает 50 HP',
        effect: { stat: 'hp', value: 50, duration: 'instant' },
      },
    ],
    currentChapter: 1,
    chapterWins: 0,
    totalBattlesWon: 0,
    totalBossesDefeated: 0,
    followers: initialFollowers(),
    activeFollowerId: null,
    forgeMaterials: 0,
    storyProgress: 0,
    lastEnergyAt: Date.now(),
    dailyResetDay: calendarDayKey(),
    weeklyResetWeek: weeklyQuestKey(),
    belt: Array(7).fill(null),
    activeDays: 1,
    battleStones: 10,
    settings: { speed: 1, auto: false },
    blessing: { day: '', charges: 0 },
    dailyReward: { streak: 0, lastDay: '' },
    mailClaimed: [],
    trialLevel: 1,
    appearance: 'm2',
    dailyStonesBought: 0,
    dailyStonesDate: calendarDayKey(),
    quests: createInitialQuests(),
    achievements: createInitialAchievements(),
  };
}

function makeEnemy(
  id: string,
  name: string,
  art: string,
  hp: number,
  attack: number,
  defense: number,
  isBoss: boolean,
  rewardGold: number,
  rewardXp: number,
): Enemy {
  return { id, name, art, hp, maxHp: hp, attack, defense, isBoss, rewardGold, rewardXp };
}

const ENEMY_NAMES = [
  { name: 'Гоблин-разведчик', art: '/assets/territory/characters/enemies/goblin/idle.webp' },
  { name: 'Дикий кабан', art: '/assets/territory/characters/enemies/boar/idle.webp' },
  { name: 'Лесной разбойник', art: '/assets/territory/characters/enemies/bandit/idle.webp' },
  { name: 'Тёмный волк', art: '/assets/territory/characters/enemies/wolf/idle.webp' },
  { name: 'Пещерный тролль', art: '/assets/territory/characters/enemies/troll/idle.webp' },
];

const BOSS_NAMES = [
  'Вождь разбойников',
  'Ярл Севера',
  'Тёмный жрец',
  'Король нежити',
  'Страж кургана',
  'Демон бездны',
  'Король великанов',
  'Повелитель бурь',
  'Огненный лорд',
  'Тень хаоса',
];

const BOSS_ARTS = [
  '/assets/territory/characters/bosses/bandit_chief/idle.webp',
  '/assets/territory/characters/bosses/northern_jarl/idle.webp',
  '/assets/territory/characters/bosses/dark_priest/idle.webp',
  '/assets/territory/characters/bosses/undead_king/idle.webp',
  '/assets/territory/characters/bosses/barrow_guardian/idle.webp',
  '/assets/territory/characters/bosses/abyss_demon/idle.webp',
  '/assets/territory/characters/bosses/giant_king/idle.webp',
  '/assets/territory/characters/bosses/storm_lord/idle.webp',
  '/assets/territory/characters/bosses/fire_lord/idle.webp',
  '/assets/territory/characters/bosses/chaos_shadow/idle.webp',
];

const CHAPTER_TITLES = [
  'Тёмный лес',
  'Северные земли',
  'Ледяные фьорды',
  'Пещеры троллей',
  'Курганы предков',
  'Огненные пустоши',
  'Земли великанов',
  'Мост Биврёст',
  'Чертоги Хель',
  'Врата Асгарда',
];

export const PVE_STONE_COST = 1;

export function chapterTitle(num: number): string {
  return CHAPTER_TITLES[(num - 1) % CHAPTER_TITLES.length];
}

export function generateChapter(num: number): Chapter {
  const baseHp = 75 + num * 25;
  const baseAtk = 12 + num * 4;
  const baseDef = 3 + num * 2;
  const difficulty = chapterEnemyMultipliers(num);
  const bossDifficulty = bossEnemyMultipliers(num);

  const enemies: Enemy[] = ENEMY_NAMES.map((e, i) =>
    makeEnemy(
      `ch${num}_enemy_${i}`,
      e.name,
      e.art,
      Math.floor(baseHp * (0.8 + i * 0.1) * difficulty.hp),
      Math.floor(baseAtk * (0.8 + i * 0.1) * difficulty.attack),
      Math.floor(baseDef * (0.8 + i * 0.1) * difficulty.defense),
      false,
      15 + num * 5,
      20 + num * 8,
    ),
  );

  const boss = makeEnemy(
    `ch${num}_boss`,
    BOSS_NAMES[(num - 1) % BOSS_NAMES.length],
    BOSS_ARTS[(num - 1) % BOSS_ARTS.length],
    Math.floor(baseHp * 2.55 * difficulty.hp * bossDifficulty.hp),
    Math.floor(baseAtk * 1.30 * difficulty.attack * bossDifficulty.attack),
    Math.floor(baseDef * 2.15 * difficulty.defense * bossDifficulty.defense),
    true,
    50 + num * 15,
    80 + num * 20,
  );

  return {
    number: num,
    title: chapterTitle(num),
    enemies,
    boss,
    winsNeeded: enemies.length,
    rewardGold: 30 + num * 10,
    rewardXp: 50 + num * 15,
  };
}

export function generateTrial(num: number): Enemy {
  const baseHp = 75 + num * 25;
  const baseAtk = 12 + num * 4;
  const baseDef = 3 + num * 2;
  const difficulty = trialEnemyMultipliers(num);
  return makeEnemy(
    `trial_${num}`,
    'Страж испытаний',
    // Use the fully animated six-pose guardian rather than the old idle-only
    // Use the trial guardian art without changing trial combat or rewards.
    '/assets/territory/characters/bosses/barrow_guardian/idle.webp',
    Math.floor(baseHp * 1.8 * difficulty.hp),
    Math.floor(baseAtk * 1.2 * difficulty.attack),
    Math.floor(baseDef * 1.5 * difficulty.defense),
    false,
    40 + num * 12,
    40 + num * 10,
  );
}

export function createInitialQuests(): Quest[] {
  return [
    {
      id: 'q_daily_1',
      title: 'Победить 3 врагов',
      description: 'Победи 3 врагов в PvE-боях',
      icon: '⚔️',
      target: 3,
      current: 0,
      rewardGold: 50,
      rewardXp: 30,
      rewardGems: 1,
      rewardStones: 2,
      claimed: false,
      type: 'daily',
    },
    {
      id: 'q_daily_2',
      title: 'Потратить 50 золота',
      description: 'Купи что-нибудь в лавке',
      icon: '🛒',
      target: 50,
      current: 0,
      rewardGold: 30,
      rewardXp: 20,
      rewardGems: 1,
      claimed: false,
      type: 'daily',
    },
    {
      id: 'q_daily_3',
      title: 'Гладиатор',
      description: 'Победи 3 раза на арене',
      icon: '🏟️',
      target: 3,
      current: 0,
      rewardGold: 80,
      rewardXp: 50,
      rewardGems: 2,
      rewardStones: 2,
      claimed: false,
      type: 'daily',
    },
    {
      id: 'q_weekly_1',
      title: 'Победить босса',
      description: 'Победи босса в любой главе',
      icon: '🐉',
      target: 1,
      current: 0,
      rewardGold: 100,
      rewardXp: 80,
      rewardGems: 5,
      claimed: false,
      type: 'weekly',
    },
    {
      id: 'q_story_1',
      title: 'Пройти 5 глав',
      description: 'Дойди до 6-й главы',
      icon: '🗺️',
      target: 5,
      current: 0,
      rewardGold: 200,
      rewardXp: 150,
      rewardGems: 10,
      claimed: false,
      type: 'story',
    },
  ];
}

function createInitialAchievements(): Achievement[] {
  return [
    {
      id: 'ach_1',
      title: 'Первый воин',
      description: 'Победи 1 врага',
      icon: '🥇',
      target: 1,
      current: 0,
      rewardGems: 5,
      claimed: false,
    },
    {
      id: 'ach_2',
      title: 'Опытный боец',
      description: 'Победи 10 врагов',
      icon: '🥈',
      target: 10,
      current: 0,
      rewardGems: 10,
      claimed: false,
    },
    {
      id: 'ach_3',
      title: 'Покоритель глав',
      description: 'Пройди 10 глав',
      icon: '🗺️',
      target: 10,
      current: 0,
      rewardGems: 20,
      claimed: false,
    },
    {
      id: 'ach_4',
      title: 'Убийца боссов',
      description: 'Победи 5 боссов',
      icon: '👑',
      target: 5,
      current: 0,
      rewardGems: 15,
      claimed: false,
    },
    {
      id: 'ach_5',
      title: 'Богатей',
      description: 'Накопи 1000 золота',
      icon: '💰',
      target: 1000,
      current: 0,
      rewardGems: 10,
      claimed: false,
    },
  ];
}

let shopEquipmentCache: ShopItem[] | null = null;

function generateShopEquipment(): ShopItem[] {
  if (shopEquipmentCache) return shopEquipmentCache;

  shopEquipmentCache = SHOP_EQUIPMENT_ITEMS;
  return shopEquipmentCache;
}

export function generateShopItems(chapter: number): ShopItem[] {
  const consumables: ShopItem[] = [
    {
      id: 'shop_potion_hp',
      name: 'Зелье здоровья',
      icon: '🧪',
      type: 'potion',
      rarity: 'common',
      priceGold: 25,
      description: 'Восстанавливает 50 HP мгновенно',
      effect: { stat: 'hp', value: 50, duration: 'instant' },
    },
    {
      id: 'shop_potion_hp_large',
      name: 'Большое зелье здоровья',
      icon: '⚗️',
      type: 'potion',
      rarity: 'rare',
      priceGold: 60,
      description: 'Восстанавливает 150 HP мгновенно',
      effect: { stat: 'hp', value: 150, duration: 'instant' },
    },
    {
      id: 'shop_elixir_atk',
      name: 'Эликсир силы',
      icon: '💪',
      type: 'elixir',
      rarity: 'rare',
      priceGold: 80,
      description: '+10 к атаке на один бой',
      effect: { stat: 'attack', value: 10, duration: 'battle' },
    },
    {
      id: 'shop_elixir_def',
      name: 'Эликсир защиты',
      icon: '🛡️',
      type: 'elixir',
      rarity: 'rare',
      priceGold: 80,
      description: '+10 к защите на один бой',
      effect: { stat: 'defense', value: 10, duration: 'battle' },
    },
    {
      id: 'shop_elixir_crit',
      name: 'Эликсир крита',
      icon: '🎯',
      type: 'elixir',
      rarity: 'epic',
      priceGold: 150,
      description: '+15% к шансу крита на один бой',
      effect: { stat: 'critChance', value: 15, duration: 'battle' },
    },
    {
      id: 'shop_arena_time',
      name: 'Зелье времени',
      icon: '⏳',
      type: 'arena',
      rarity: 'rare',
      priceGold: 60,
      description: 'Арена: сокращает тайм боя на 10 сек. (не меньше 30 сек.)',
      arenaEffect: 'time',
    },
    {
      id: 'shop_arena_adrenaline',
      name: 'Адреналин',
      icon: '💉',
      type: 'arena',
      rarity: 'epic',
      priceGold: 0,
      priceGems: 3,
      description: 'Арена: возвращает павшего союзника в бой с 50% здоровья',
      arenaEffect: 'adrenaline',
    },
    {
      id: 'shop_stone_1',
      name: 'Боевой камень',
      icon: '',
      type: 'stone',
      rarity: 'rare',
      priceGold: 0,
      priceGems: 2,
      amount: 1,
      description: 'Тратится на один бой в походе или Испытаниях',
    },
    {
      id: 'shop_stone_5',
      name: 'Связка боевых камней',
      icon: '',
      type: 'stone',
      rarity: 'epic',
      priceGold: 0,
      priceGems: 8,
      amount: 5,
      description: '5 боевых камней со скидкой',
    },
    {
      id: 'shop_gem_pack_1',
      name: 'Малый набор кристаллов',
      icon: '💎',
      type: 'gem_pack',
      rarity: 'rare',
      priceGems: 0,
      priceGold: 200,
      amount: 5,
      description: 'Получи 5 кристаллов',
    },
    {
      id: 'shop_gem_pack_2',
      name: 'Большой набор кристаллов',
      icon: '💎',
      type: 'gem_pack',
      rarity: 'epic',
      priceGems: 0,
      priceGold: 500,
      amount: 15,
      description: 'Получи 15 кристаллов',
    },
    {
      id: 'shop_forge_material',
      name: 'Материалы кузницы',
      icon: '🔩',
      type: 'material',
      rarity: 'common',
      priceGold: 50,
      description: '1 материал для улучшения экипировки',
    },
  ];

  const equipment = generateShopEquipment();
  return [...consumables, ...equipment];
}

export function getComputedStats(state: GameState): GameState['player']['stats'] {
  const base = { ...state.player.stats };
  for (const eq of Object.values(state.player.equipped)) {
    if (!eq) continue;
    if (eq.attack) base.attack += eq.attack;
    if (eq.defense) base.defense += eq.defense;
    if (eq.hp) {
      base.maxHp += eq.hp;
      base.hp += eq.hp;
    }
    if (eq.critChance) base.critChance += eq.critChance;
  }
  return base;
}
