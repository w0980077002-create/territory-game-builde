import type { Equipment, EquipmentBaseStats, GameState, InventoryItem } from './types';
import { EQUIPMENT_TEMPLATES, rarityForChapter, createBossLootEquipment } from './equipmentCatalog';

/** Save-data version. Bump only when a new persistent migration is introduced. */
export const EQUIPMENT_BALANCE_VERSION = 4;
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


/**
 * Owner-only correction path for old over-levelled gear.
 * Regular forge and shop upgrades still use setEquipmentLevel and cannot lower
 * below an item's natural base level. Historic boss loot often has
 * baseLevel=164/165, which previously made admin reductions a no-op.
 */
export function setAdminEquipmentLevel(eq: Equipment, targetLevel: number): Equipment {
  if (!Number.isSafeInteger(targetLevel) || targetLevel < 1 || targetLevel > 500) return eq;
  const baseLevel = Math.max(1, Math.floor(Number.isFinite(eq.baseLevel ?? eq.level) ? (eq.baseLevel ?? eq.level) : 1));
  if (targetLevel >= baseLevel) return setEquipmentLevel(eq, targetLevel);

  // Keep shop equipment at its canonical template baseline.
  if (EQUIPMENT_TEMPLATES.some((t) => t.name === eq.name && t.slot === eq.slot && t.rarity === eq.rarity)) {
    return setEquipmentLevel(normalizeEquipmentV4(eq), targetLevel);
  }

  // A high-chapter boss item is a new lower-chapter item after an owner correction:
  // reconstruct its LEVEL-APPROPRIATE base stats instead of retaining inflated
  // stats from e.g. a chapter-165 drop.
  const isBossWeapon = eq.slot === 'weapon' && eq.name === 'Клинок победителя';
  const isBossArmor = eq.slot === 'armor' && eq.name === 'Доспех воина';
  if (isBossWeapon || isBossArmor) {
    const canonical = createBossLootEquipment(targetLevel, isBossWeapon, eq.id);
    const baseStats = onlyStats(canonical);
    return normalizeEquipmentV4({
      ...eq, ...baseStats, level: targetLevel, baseLevel: targetLevel,
      baseStats, upgradeCount: 0,
    });
  }

  // Unknown/custom gear: never preserve higher-level stats as the new baseline.
  // Scale its current values down, then apply the same slot caps as the server.
  const ratio = Math.min(1, targetLevel / Math.max(1, eq.level));
  const scaled: EquipmentBaseStats = {};
  for (const stat of ['attack', 'defense', 'hp'] as const) {
    const value = eq[stat];
    if (value !== undefined) scaled[stat] = Math.max(0, Math.floor(value * ratio));
  }
  if (eq.critChance !== undefined) scaled.critChance = Math.max(0, Math.min(25, eq.critChance));
  return normalizeEquipmentV4({
    ...eq, ...scaled, level: targetLevel, baseLevel: targetLevel,
    baseStats: scaled, upgradeCount: 0,
  });
}


/**
 * One rule for every gear source: an item can never exceed its owner's hero level.
 * For boss drops, reconstruct chapter-based stats at the NEW level.
 * For catalog gear, use the canonical linear growth curve (proportional below the
 * catalog's minimum level). Custom items are scaled and slot-capped.
 * The production server independently enforces the same ceiling on EVERY save.
 */
export function capEquipmentToHeroLevel(eq: Equipment, heroLevel: number): Equipment {
  if (!Number.isSafeInteger(eq.level) || eq.level < 1) return eq;
  // The server adds this hint only for a specific owner-authorized item ID.
  // It independently enforces the approval on every save, even if a client forges this field.
  if (eq.adminTestLevel === true && eq.level <= 500) return eq;
  const hero = Number.isSafeInteger(heroLevel) ? Math.max(1, Math.min(500, heroLevel)) : 1;
  const level = Math.min(eq.level, hero);
  const template = EQUIPMENT_TEMPLATES.find(
    (t) => t.name === eq.name && t.slot === eq.slot && t.rarity === eq.rarity,
  );
  if (template) {
    if (level < template.level) {
      const ratio = level / template.level;
      const scaled: EquipmentBaseStats = {};
      for (const key of STAT_KEYS) {
        const value = template[key];
        if (typeof value === 'number') scaled[key] = Math.max(0, Math.round(value * ratio));
      }
      return { ...eq, ...scaled, level, baseLevel: level, baseStats: scaled, upgradeCount: 0 };
    }
    return level < eq.level ? normalizeEquipmentV4({ ...eq, level }) : eq;
  }
  if (level === eq.level) return eq;
  if ((eq.slot === 'weapon' && eq.name === 'Клинок победителя')
    || (eq.slot === 'armor' && eq.name === 'Доспех воина')) {
    const canonical = createBossLootEquipment(level, eq.slot === 'weapon', eq.id);
    const baseStats = onlyStats(canonical);
    return normalizeEquipmentV4({
      ...eq, ...baseStats, level, baseLevel: level, baseStats, upgradeCount: 0,
    });
  }
  const source = normalizeEquipmentV4(eq);
  const ratio = level / Math.max(1, eq.level);
  const scaled: EquipmentBaseStats = {};
  for (const key of STAT_KEYS) {
    const value = source[key];
    if (typeof value === 'number') scaled[key] = Math.max(0, Math.round(value * ratio));
  }
  return normalizeEquipmentV4({
    ...source, ...scaled, level, baseLevel: level, baseStats: scaled, upgradeCount: 0,
  });
}

export function upgradeEquipment(eq: Equipment): Equipment {
  const shopTemplate = EQUIPMENT_TEMPLATES.find(
    (t) => t.name === eq.name && t.slot === eq.slot && t.rarity === eq.rarity,
  );
  if (shopTemplate && eq.level < shopTemplate.level) {
    // A catalog item capped below its original minimum must grow proportionally
    // until the hero reaches that minimum, never jump back to its original level.
    return capEquipmentToHeroLevel({ ...eq, level: eq.level + 1 }, eq.level + 1);
  }
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

/** Identical ceilings to the server's territory_normalize_gear_v4.
 * Existing levels, item IDs, slots, rarities and ownership are retained.
 * Shop catalog items always follow the non-compounding forge growth table.
 * Generated loot or custom gear only changes if above generous slot caps.
 */
export function normalizeEquipmentV4(eq: Equipment): Equipment {
  const template = EQUIPMENT_TEMPLATES.find(
    (x) => x.name === eq.name && x.slot === eq.slot && x.rarity === eq.rarity,
  );
  if (template) {
    const baseStats = onlyStats(template);
    return setEquipmentLevel({
      ...eq,
      baseLevel: template.level,
      baseStats,
      upgradeCount: Math.max(0, Math.floor(eq.level) - template.level),
    }, eq.level);
  }
  const lvl = Math.max(1, Math.min(500, Math.floor(Number.isFinite(eq.level) ? eq.level : 1)));
  const attackCap = eq.slot === 'weapon' ? 40 + 6 * lvl
    : eq.slot === 'ring' || eq.slot === 'amulet' ? 20 + 4 * lvl : 10 + 2 * lvl;
  const defenseCap = ['armor', 'shield', 'helmet', 'boots'].includes(eq.slot) ? 10 + 5 * lvl : 10 + 3 * lvl;
  const hpCap = eq.slot === 'armor' ? 50 + 12 * lvl
    : ['boots', 'shield', 'helmet'].includes(eq.slot) ? 40 + 10 * lvl : 25 + 5 * lvl;
  const capped: Equipment = {
    ...eq,
    ...(eq.attack !== undefined ? { attack: Math.max(0, Math.min(eq.attack, attackCap)) } : {}),
    ...(eq.defense !== undefined ? { defense: Math.max(0, Math.min(eq.defense, defenseCap)) } : {}),
    ...(eq.hp !== undefined ? { hp: Math.max(0, Math.min(eq.hp, hpCap)) } : {}),
    ...(eq.critChance !== undefined ? { critChance: Math.max(0, Math.min(eq.critChance, 25)) } : {}),
  };
  const poisonedBaseline = !!eq.baseStats && (
    (eq.baseStats.attack ?? 0) > attackCap
    || (eq.baseStats.defense ?? 0) > defenseCap
    || (eq.baseStats.hp ?? 0) > hpCap
    || (eq.baseStats.critChance ?? 0) > 25
  );
  if (capped.attack !== eq.attack || capped.defense !== eq.defense
    || capped.hp !== eq.hp || capped.critChance !== eq.critChance || poisonedBaseline) {
    return { ...capped, baseLevel: lvl, baseStats: onlyStats(capped), upgradeCount: 0 };
  }
  return migrateEquipment(capped);
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
  return item.equipment ? { ...item, equipment: normalizeEquipmentV4(item.equipment) } : item;
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
        Object.entries(player.equipped).map(([slot, eq]) => [slot, eq ? normalizeEquipmentV4(eq) : eq]),
      ) as NonNullable<GameState['player']['equipped']> : player.equipped,
    } : player,
  };
}

/** Test helper kept out of the UI; does not mutate the supplied equipment. */
export function normalizeEquipmentForTests(eq: Equipment): Equipment {
  return normalizeEquipmentV4(eq);
}
