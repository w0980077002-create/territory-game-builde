import type {
  GameState,
  Chapter,
  Enemy,
  Equipment,
  InventoryItem,
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

export function xpForLevel(level: number): number {
  return Math.floor(100 * Math.pow(1.15, level - 1));
}

export function createInitialGame(): GameState {
  return {
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
    followers: [
      {
        id: 'follower_1',
        name: 'Верный щит',
        icon: '🛡️',
        level: 1,
        attack: 5,
        defense: 10,
        unlocked: false,
        description: 'Спутник, который помогает в бою. Открывается на 3 уровне.',
      },
    ],
    forgeMaterials: 0,
    storyProgress: 0,
    lastEnergyAt: Date.now(),
    dailyResetDay: new Date().toDateString(),
    belt: Array(7).fill(null),
    activeDays: 1,
    battleStones: 10,
    settings: { speed: 1, auto: false },
    blessing: { day: '', charges: 0 },
    dailyReward: { streak: 0, lastDay: '' },
    mailClaimed: [],
    trialLevel: 1,
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
  rewardLoot?: InventoryItem,
): Enemy {
  return { id, name, art, hp, maxHp: hp, attack, defense, isBoss, rewardGold, rewardXp, rewardLoot };
}

const ENEMY_NAMES = [
  { name: 'Гоблин-разведчик', art: '/enemy-goblin.webp' },
  { name: 'Дикий кабан', art: '/enemy-boar.webp' },
  { name: 'Лесной разбойник', art: '/enemy-bandit.webp' },
  { name: 'Тёмный волк', art: '/enemy-wolf.webp' },
  { name: 'Пещерный тролль', art: '/enemy-troll.webp' },
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
  const baseHp = 60 + num * 20;
  const baseAtk = 12 + num * 4;
  const baseDef = 3 + num * 2;

  const enemies: Enemy[] = ENEMY_NAMES.map((e, i) =>
    makeEnemy(
      `ch${num}_enemy_${i}`,
      e.name,
      e.art,
      Math.floor(baseHp * (0.8 + i * 0.1)),
      Math.floor(baseAtk * (0.8 + i * 0.1)),
      Math.floor(baseDef * (0.8 + i * 0.1)),
      false,
      15 + num * 5,
      20 + num * 8,
    ),
  );

  const boss = makeEnemy(
    `ch${num}_boss`,
    BOSS_NAMES[(num - 1) % BOSS_NAMES.length],
    '/enemy-boss.webp',
    Math.floor(baseHp * 2.2),
    Math.floor(baseAtk * 1.15),
    Math.floor(baseDef * 2),
    true,
    50 + num * 15,
    80 + num * 20,
    generateLoot(num),
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
  const baseHp = 60 + num * 20;
  const baseAtk = 12 + num * 4;
  const baseDef = 3 + num * 2;
  return makeEnemy(
    `trial_${num}`,
    'Страж испытаний',
    '/enemy-viking.webp',
    Math.floor(baseHp * 1.8),
    Math.floor(baseAtk * 1.2),
    Math.floor(baseDef * 1.5),
    false,
    40 + num * 12,
    40 + num * 10,
  );
}

function generateLoot(chapter: number): InventoryItem {
  const rarities: Array<'common' | 'rare' | 'epic' | 'legendary'> = ['common', 'rare', 'epic', 'legendary'];
  const rarity = rarities[Math.min(Math.floor(chapter / 10), 3)];
  const isWeapon = Math.random() > 0.5;
  const eq: Equipment = {
    id: `loot_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    slot: isWeapon ? 'weapon' : 'armor',
    name: isWeapon ? 'Клинок победителя' : 'Доспех воина',
    icon: isWeapon ? '⚔️' : '🛡️',
    rarity,
    attack: isWeapon ? 10 + chapter * 3 : 0,
    defense: !isWeapon ? 5 + chapter * 2 : 0,
    hp: !isWeapon ? 20 + chapter * 5 : 0,
    level: chapter,
  };
  return {
    id: eq.id,
    name: eq.name,
    icon: eq.icon,
    type: 'equipment',
    rarity,
    qty: 1,
    description: `Уровень ${chapter} · ${rarity}`,
    equipment: eq,
  };
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

  const items: ShopItem[] = [
    {
      id: 'shop_weapon_warrior',
      name: 'Меч воина',
      icon: '⚔️',
      type: 'equipment',
      rarity: 'common',
      priceGold: 100,
      description: 'Надёжный стальной меч. +8 к атаке.',
      equipment: {
        id: 'shop_weapon_warrior_eq',
        slot: 'weapon',
        name: 'Меч воина',
        icon: '⚔️',
        rarity: 'common',
        attack: 8,
        level: 1,
      },
    },
    {
      id: 'shop_weapon_knight',
      name: 'Клинок рыцаря',
      icon: '🗡️',
      type: 'equipment',
      rarity: 'rare',
      priceGold: 300,
      description: 'Острый клинок. +18 к атаке, +3% крит.',
      equipment: {
        id: 'shop_weapon_knight_eq',
        slot: 'weapon',
        name: 'Клинок рыцаря',
        icon: '🗡️',
        rarity: 'rare',
        attack: 18,
        critChance: 3,
        level: 3,
      },
    },
    {
      id: 'shop_weapon_hero',
      name: 'Героический меч',
      icon: '🔱',
      type: 'equipment',
      rarity: 'epic',
      priceGems: 30,
      priceGold: 0,
      description: 'Легендарное оружие. +35 к атаке, +8% крит.',
      equipment: {
        id: 'shop_weapon_hero_eq',
        slot: 'weapon',
        name: 'Героический меч',
        icon: '🔱',
        rarity: 'epic',
        attack: 35,
        critChance: 8,
        level: 5,
      },
    },
    {
      id: 'shop_armor_leather',
      name: 'Кожаная броня',
      icon: '🦺',
      type: 'equipment',
      rarity: 'common',
      priceGold: 100,
      description: 'Базовая защита. +5 к защите, +30 HP.',
      equipment: {
        id: 'shop_armor_leather_eq',
        slot: 'armor',
        name: 'Кожаная броня',
        icon: '🦺',
        rarity: 'common',
        defense: 5,
        hp: 30,
        level: 1,
      },
    },
    {
      id: 'shop_armor_plate',
      name: 'Латные доспехи',
      icon: '🛡️',
      type: 'equipment',
      rarity: 'rare',
      priceGold: 350,
      description: 'Тяжёлая броня. +12 к защите, +80 HP.',
      equipment: {
        id: 'shop_armor_plate_eq',
        slot: 'armor',
        name: 'Латные доспехи',
        icon: '🛡️',
        rarity: 'rare',
        defense: 12,
        hp: 80,
        level: 3,
      },
    },
    {
      id: 'shop_helmet_iron',
      name: 'Железный шлем',
      icon: '⛑️',
      type: 'equipment',
      rarity: 'common',
      priceGold: 80,
      description: 'Защита головы. +3 к защите, +20 HP.',
      equipment: {
        id: 'shop_helmet_iron_eq',
        slot: 'helmet',
        name: 'Железный шлем',
        icon: '⛑️',
        rarity: 'common',
        defense: 3,
        hp: 20,
        level: 1,
      },
    },
    {
      id: 'shop_boots_swift',
      name: 'Сапоги скорости',
      icon: '🥾',
      type: 'equipment',
      rarity: 'rare',
      priceGold: 200,
      description: 'Лёгкие сапоги. +4 к защите, +40 HP, +2% крит.',
      equipment: {
        id: 'shop_boots_swift_eq',
        slot: 'boots',
        name: 'Сапоги скорости',
        icon: '🥾',
        rarity: 'rare',
        defense: 4,
        hp: 40,
        critChance: 2,
        level: 2,
      },
    },
    {
      id: 'shop_ring_power',
      name: 'Кольцо силы',
      icon: '💍',
      type: 'equipment',
      rarity: 'epic',
      priceGems: 50,
      priceGold: 0,
      description: 'Магическое кольцо. +15 к атаке, +5% крит.',
      equipment: {
        id: 'shop_ring_power_eq',
        slot: 'ring',
        name: 'Кольцо силы',
        icon: '💍',
        rarity: 'epic',
        attack: 15,
        critChance: 5,
        level: 5,
      },
    },
    {
      id: 'shop_shield_oak',
      name: 'Дубовый щит',
      icon: '🛡️',
      type: 'equipment',
      rarity: 'common',
      priceGold: 120,
      description: 'Окованный железом щит. +5 к защите, +25 HP.',
      equipment: {
        id: 'shop_shield_oak_eq',
        slot: 'shield',
        name: 'Дубовый щит',
        icon: '🛡️',
        rarity: 'common',
        defense: 5,
        hp: 25,
        level: 2,
      },
    },
    {
      id: 'shop_amulet_raven',
      name: 'Амулет ворона',
      icon: '📿',
      type: 'equipment',
      rarity: 'rare',
      priceGold: 260,
      description: 'Оберег из кости ворона. +6 к атаке, +3% крит.',
      equipment: {
        id: 'shop_amulet_raven_eq',
        slot: 'amulet',
        name: 'Амулет ворона',
        icon: '📿',
        rarity: 'rare',
        attack: 6,
        critChance: 3,
        level: 3,
      },
    },
  ];

  shopEquipmentCache = items;
  return items;
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
