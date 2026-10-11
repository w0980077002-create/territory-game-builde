import type { Equipment, EquipmentBaseStats, GameState, InventoryItem } from './types';
import { EQUIPMENT_TEMPLATES, rarityForChapter } from './equipmentCatalog';

/** Save-data version. Bump only when a new persistent migration is introduced. */
export const EQUIPMENT_BALANCE_VERSION = 3;
/**
 * Fixed, slot- and rarity-aware stat growth per successful forge level.
 * Accessories grow more slowly than weapons; defensive slots have separate budgets
 * so upgrading a full set does not make the hero effectively invulnerable.
 */
export const FORGE_STAT_GROWTH: Record<Equipment['slot'], Record<Equipment['rarity'], { attack: number; defense: number; hp: number }>> = {
  weapon: {
    common: { attack: 1, defense: 0, hp: 0 },
    rare: { attack: 1.5, defense: 0, hp: 0 },
    epic: { attack: 2, defense: 0, hp: 0 },
    legendary: { attack: 3, defense: 0, hp: 0 },
  },
  ring: {
    common: { attack: 0.5, defense: 0, hp: 0.5 },
    rare: { attack: 0.5, defense: 0.25, hp: 0.75 },
    epic: { attack: 0.75, defense: 0.5, hp: 1 },
    legendary: { attack: 1, defense: 0.5, hp: 1.5 },
  },
  amulet: {
    common: { attack: 0.25, defense: 0, hp: 0.5 },
    rare: { attack: 0.5, defense: 0.25, hp: 0.75 },
    epic: { attack: 0.75, defense: 0.5, hp: 1 },
    legendary: { attack: 1, defense: 0.5, hp: 1.5 },
  },
  armor: {
    common: { attack: 0, defense: 0.25, hp: 1 },
    rare: { attack: 0, defense: 0.5, hp: 1.5 },
    epic: { attack: 0, defense: 0.75, hp: 2 },
    legendary: { attack: 0, defense: 1, hp: 3 },
  },
  helmet: {
    common: { attack: 0, defense: 0.25, hp: 0.5 },
    rare: { attack: 0, defense: 0.25, hp: 0.75 },
    epic: { attack: 0, defense: 0.5, hp: 1 },
    legendary: { attack: 0, defense: 0.5, hp: 1.5 },
  },
  shield: {
    common: { attack: 0, defense: 0.5, hp: 0.5 },
    rare: { attack: 0, defense: 0.5, hp: 0.75 },
    epic: { attack: 0, defense: 0.75, hp: 1 },
    legendary: { attack: 0, defense: 1, hp: 1.5 },
  },
  boots: {
    common: { attack: 0, defense: 0.25, hp: 0.5 },
    rare: { attack: 0, defense: 0.25, hp: 1 },
    epic: { attack: 0, defense: 0.5, hp: 1.5 },
    legendary: { attack: 0, defense: 0.5, hp: 2 },
  },
};
const LEGACY_FORGE_GAIN = 0.15;

const STAT_KEYS = ['attack', 'defense', 'hp', 'critChance'] as const;
function onlyStats(eq: Equipment): EquipmentBaseStats {
  const stats: EquipmentBaseStats = {};
  for (const key of STAT_KEYS) {
    const value = eq[key];
    if (typeof value === 'number' && Number.isFinite(value)) stats[key] = value;
  }
  return stats;
}

function legacyForgeStat(value: number | undefined, upgrades: number): number | undefined {
  if (value === undefined || value === 0) return value;
  let result = value;
  for (let i = 0; i < upgrades; i++) result += Math.ceil(result * LEGACY_FORGE_GAIN);
  return result;
}

function legacyAdminLevelStat(value: number | undefined, upgrades: number): number | undefined {
  if (value === undefined || value === 0) return value;
  return Math.max(1, Math.round(value * Math.pow(1 + LEGACY_FORGE_GAIN, upgrades)));
}

function relativeError(expected: number | undefined, actual: number | undefined): number | null {
  if (expected === undefined || actual === undefined) return null;
  return Math.abs(expected - actual) / Math.max(1, Math.abs(actual));
}

function candidateScore(baseStats: EquipmentBaseStats, actual: Equipment, upgrades: number, mode: 'forge' | 'admin'): number | null {
  const expected: EquipmentBaseStats = {};
  for (const key of STAT_KEYS) {
    const base = baseStats[key];
    if (base !== undefined) {
      // The legacy forge and admin grant code never scaled critical chance.
      expected[key] = key === 'critChance'
        ? base
        : mode === 'forge'
          ? legacyForgeStat(base, upgrades)
          : legacyAdminLevelStat(base, upgrades);
    }
  }

  const errors = STAT_KEYS
    .map((key) => relativeError(expected[key], actual[key]))
    .filter((value): value is number => value !== null);
  if (errors.length === 0) return null;
  return errors.reduce((sum, value) => sum + value, 0) / errors.length;
}

function inferLegacyBase(eq: Equipment): { baseLevel: number; baseStats: EquipmentBaseStats } | null {
  const shopTemplate = EQUIPMENT_TEMPLATES.find(
    (item) => item.name === eq.name && item.slot === eq.slot && item.rarity === eq.rarity,
  );
  if (shopTemplate) {
    const baseStats = onlyStats(shopTemplate);
    const upgrades = Math.max(0, Math.floor(eq.level) - shopTemplate.level);
    // Names are not unique identifiers: preserve custom/admin-created gear that
    // happens to share a shop item's name unless its stats match a known legacy path.
    const score = Math.min(
      candidateScore(baseStats, eq, upgrades, 'forge') ?? Number.POSITIVE_INFINITY,
      candidateScore(baseStats, eq, upgrades, 'admin') ?? Number.POSITIVE_INFINITY,
    );
    if (Number.isFinite(score) && score <= 0.075) {
      return { baseLevel: shopTemplate.level, baseStats };
    }
    return null;
  }

  // Existing boss drops only occupy weapon/armor slots and use IDs with the loot_ prefix.
  // Support both historical upgrade paths: repeated forge rounding and admin level grants.
  if (!eq.id.startsWith('loot_') || (eq.slot !== 'weapon' && eq.slot !== 'armor')) return null;

  const maxChapter = Math.min(500, Math.max(1, Math.floor(eq.level)));
  let best: { chapter: number; score: number; baseStats: EquipmentBaseStats } | null = null;

  for (let chapter = 1; chapter <= maxChapter; chapter++) {
    if (rarityForChapter(chapter) !== eq.rarity) continue;
    const isWeapon = eq.slot === 'weapon';
    const baseStats: EquipmentBaseStats = isWeapon
      ? { attack: 10 + chapter * 3 }
      : { defense: 5 + chapter * 2, hp: 20 + chapter * 5 };
    const upgrades = Math.max(0, Math.floor(eq.level) - chapter);
    const score = Math.min(
      candidateScore(baseStats, eq, upgrades, 'forge') ?? Number.POSITIVE_INFINITY,
      candidateScore(baseStats, eq, upgrades, 'admin') ?? Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(score)) continue;
    if (!best || score < best.score) best = { chapter, score, baseStats };
    if (score === 0) return { baseLevel: chapter, baseStats };
  }

  // Loot IDs are generated by this project, so a small tolerance safely accounts for rounding paths.
  if (best && best.score <= 0.075) return { baseLevel: best.chapter, baseStats: best.baseStats };
  return null;
}

/** Deterministic stats for a base item at a given number of successful upgrades. */
export function calculateEquipmentStats(
  baseStats: EquipmentBaseStats,
  upgradeCount: number,
  rarity: Equipment['rarity'],
  slot: Equipment['slot'],
): EquipmentBaseStats {
  const count = Math.max(0, Math.floor(Number.isFinite(upgradeCount) ? upgradeCount : 0));
  const growth = FORGE_STAT_GROWTH[slot][rarity];
  const grow = (value: number | undefined, perLevel: number) => value === undefined
    ? undefined
    : value <= 0 ? value : value + Math.round(perLevel * count);
  return {
    ...(baseStats.attack !== undefined ? { attack: grow(baseStats.attack, growth.attack) } : {}),
    ...(baseStats.defense !== undefined ? { defense: grow(baseStats.defense, growth.defense) } : {}),
    ...(baseStats.hp !== undefined ? { hp: grow(baseStats.hp, growth.hp) } : {}),
    // Critical chance remains a fixed property of the item; forge upgrades do not compound it.
    ...(baseStats.critChance !== undefined ? { critChance: baseStats.critChance } : {}),
  };
}

/** Attach the immutable baseline to an item at the moment it is created. */
export function prepareNewEquipment(eq: Equipment): Equipment {
  if (eq.baseStats && eq.baseLevel !== undefined && eq.upgradeCount !== undefined) {
    return setEquipmentLevel(eq, eq.level);
  }
  const baseStats = onlyStats(eq);
  return { ...eq, baseLevel: Math.max(1, Math.floor(eq.level)), baseStats, upgradeCount: 0 };
}

/** Change a displayed item level without compounding previously rounded stat values. */
export function setEquipmentLevel(eq: Equipment, targetLevel: number): Equipment {
  const rawBaseLevel = eq.baseLevel ?? eq.level;
  const baseLevel = Math.max(1, Math.floor(Number.isFinite(rawBaseLevel) ? rawBaseLevel : 1));
  const baseStats = eq.baseStats ?? onlyStats(eq);
  const target = Number.isFinite(targetLevel) ? Math.floor(targetLevel) : eq.level;
  // Administrative grants may raise an item's level, but must not make it lower than its template level.
  const level = Math.max(baseLevel, target);
  const upgradeCount = Math.max(0, level - baseLevel);
  return {
    ...eq,
    ...calculateEquipmentStats(baseStats, upgradeCount, eq.rarity, eq.slot),
    baseLevel,
    baseStats,
    upgradeCount,
    level,
  };
}

export function upgradeEquipment(eq: Equipment): Equipment {
  const prepared = eq.baseStats && eq.baseLevel !== undefined && eq.upgradeCount !== undefined
    ? eq
    : (() => {
        const inferred = inferLegacyBase(eq);
        // Unknown/custom legacy gear is preserved exactly instead of being destructively guessed.
        return inferred
          ? {
              ...eq,
              baseLevel: inferred.baseLevel,
              baseStats: inferred.baseStats,
              upgradeCount: Math.max(0, eq.level - inferred.baseLevel),
            }
          : {
              ...eq,
              baseLevel: Math.max(1, Math.floor(eq.level)),
              baseStats: onlyStats(eq),
              upgradeCount: 0,
            };
      })();
  return setEquipmentLevel(prepared, prepared.level + 1);
}

function migrateEquipment(eq: Equipment): Equipment {
  // Recalculate already-migrated items too. This also safely moves saves from an
  // earlier balance version onto the current curve without compounding rounding.
  if (eq.baseStats && eq.baseLevel !== undefined && eq.upgradeCount !== undefined) {
    return setEquipmentLevel(eq, eq.level);
  }
  const inferred = inferLegacyBase(eq);
  if (!inferred) {
    // Preserve unknown/custom items; establish a fixed baseline for future upgrades only.
    return {
      ...eq,
      baseLevel: Math.max(1, Math.floor(eq.level)),
      baseStats: onlyStats(eq),
      upgradeCount: 0,
    };
  }
  const baseLevel = Math.max(1, Math.floor(inferred.baseLevel));
  const normalized = setEquipmentLevel({
    ...eq,
    baseLevel,
    baseStats: inferred.baseStats,
    upgradeCount: Math.max(0, Math.floor(eq.level) - baseLevel),
  }, eq.level);
  return normalized;
}

function migrateInventoryItem(item: InventoryItem): InventoryItem {
  return item.equipment ? { ...item, equipment: migrateEquipment(item.equipment) } : item;
}

export function migrateGameStateBalance(saved: Partial<GameState>): Partial<GameState> {
  // Do not reinterpret already-current saves: future crafted/custom stat rolls must
  // survive ordinary loads. Only migrate saves whose persisted balance version is old.
  if ((saved.balanceVersion ?? 0) >= EQUIPMENT_BALANCE_VERSION) return saved;

  const player = saved.player;
  return {
    ...saved,
    balanceVersion: EQUIPMENT_BALANCE_VERSION,
    inventory: Array.isArray(saved.inventory) ? saved.inventory.map(migrateInventoryItem) : saved.inventory,
    belt: Array.isArray(saved.belt) ? saved.belt.map((item) => item ? migrateInventoryItem(item) : null) : saved.belt,
    player: player ? {
      ...player,
      equipped: player.equipped ? Object.fromEntries(
        Object.entries(player.equipped).map(([slot, eq]) => [slot, eq ? migrateEquipment(eq) : eq]),
      ) as NonNullable<GameState['player']['equipped']> : player.equipped,
    } : player,
  };
}

/** Test helper kept out of the UI; does not mutate the supplied equipment. */
export function normalizeEquipmentForTests(eq: Equipment): Equipment {
  return migrateEquipment(eq);
}
