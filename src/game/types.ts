export interface PlayerStats {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  critChance: number;
  critDamage: number;
}

export type ArenaEffect = 'time' | 'adrenaline';

export interface Equipment {
  id: string;
  slot: 'helmet' | 'amulet' | 'armor' | 'weapon' | 'shield' | 'ring' | 'boots';
  name: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  attack?: number;
  defense?: number;
  hp?: number;
  critChance?: number;
  level: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  icon: string;
  type: 'potion' | 'elixir' | 'material' | 'equipment' | 'arena';
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  qty: number;
  arenaEffect?: ArenaEffect;
  description: string;
  effect?: {
    stat: keyof PlayerStats;
    value: number;
    duration?: 'instant' | 'battle';
  };
  equipment?: Equipment;
}

export interface Enemy {
  id: string;
  name: string;
  art: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  isBoss: boolean;
  rewardGold: number;
  rewardXp: number;
  rewardLoot?: InventoryItem;
}

export interface Chapter {
  number: number;
  title: string;
  enemies: Enemy[];
  boss: Enemy;
  winsNeeded: number;
  rewardGold: number;
  rewardXp: number;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  current: number;
  rewardGold: number;
  rewardXp: number;
  rewardGems: number;
  rewardStones?: number;
  claimed: boolean;
  type: 'daily' | 'weekly' | 'story';
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  current: number;
  rewardGems: number;
  claimed: boolean;
}

export interface Follower {
  id: string;
  name: string;
  icon: string;
  level: number;
  attack: number;
  defense: number;
  unlocked: boolean;
  description: string;
}

export interface ShopItem {
  id: string;
  name: string;
  icon: string;
  type: 'potion' | 'elixir' | 'equipment' | 'gem_pack' | 'material' | 'arena' | 'stone';
  amount?: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  priceGold: number;
  arenaEffect?: ArenaEffect;
  priceGems?: number;
  description: string;
  effect?: {
    stat: keyof PlayerStats;
    value: number;
    duration?: 'instant' | 'battle';
  };
  equipment?: Equipment;
}

export interface GameState {
  player: {
    name: string;
    level: number;
    xp: number;
    xpToNext: number;
    gold: number;
    gems: number;
    redGems: number;
    energy: number;
    maxEnergy: number;
    stats: PlayerStats;
    equipped: Partial<Record<Equipment['slot'], Equipment>>;
  };
  inventory: InventoryItem[];
  currentChapter: number;
  chapterWins: number;
  totalBattlesWon: number;
  totalBossesDefeated: number;
  followers: Follower[];
  quests: Quest[];
  achievements: Achievement[];
  forgeMaterials: number;
  storyProgress: number;
  lastEnergyAt: number;
  dailyResetDay: string;
  belt: (InventoryItem | null)[];
  activeDays: number;
  battleStones: number;
  settings: { speed: 1 | 2; auto: boolean };
  blessing: { day: string; charges: number };
  dailyReward: { streak: number; lastDay: string };
  mailClaimed: string[];
  trialLevel: number;
}
