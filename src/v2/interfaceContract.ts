/**
 * TERRITORY 2.0 — approved interface contract.
 *
 * Isolated from production App/GameShell. This file only declares visual
 * navigation and layout; it performs no database, wallet, reward, or save writes.
 * Do not embed other games' artworks or ship a 1:1 asset copy.
 */
export type V2ScreenId =
  | 'port' | 'skills' | 'expedition' | 'adventure' | 'shop'
  | 'hero' | 'warehouse' | 'runes' | 'companions'
  | 'arena' | 'quests' | 'events' | 'friends' | 'rewards'
  | 'clan' | 'professions' | 'games' | 'mail'
  | 'specialMarket' | 'trials' | 'welcomeBundle' | 'settings';

export type V2Shortcut = Readonly<{
  id: V2ScreenId;
  label: string;
}>;

/** Exactly five bottom positions including the raised central expedition action. */
export const V2_BOTTOM_NAV = [
  { id: 'port', label: 'Порт' },
  { id: 'skills', label: 'Навыки' },
  { id: 'expedition', label: '' }, // raised crossed-axes icon, no duplicate label
  { id: 'adventure', label: 'Приключение' },
  { id: 'shop', label: 'Магазин' },
] as const satisfies readonly V2Shortcut[];

/** Shortcuts stay on screen edges, not on top of the main battle art. */
export const V2_LEFT_SHORTCUTS = [
  { id: 'quests', label: 'Задания' },
  { id: 'events', label: 'События' },
  { id: 'friends', label: 'Друзья' },
  { id: 'rewards', label: 'Награды' },
] as const satisfies readonly V2Shortcut[];

export const V2_RIGHT_SHORTCUTS = [
  { id: 'specialMarket', label: 'Специальный рынок' },
  { id: 'trials', label: 'Испытания' },
  { id: 'welcomeBundle', label: 'Первый взнос' },
] as const satisfies readonly V2Shortcut[];

/** Additional features behind compact expandable menu to avoid screen clutter. */
export const V2_EXTRA_MENU = [
  { id: 'hero', label: 'Герой' },
  { id: 'warehouse', label: 'Склад' },
  { id: 'runes', label: 'Руны' },
  { id: 'companions', label: 'Последователи' },
  { id: 'clan', label: 'Клан' },
  { id: 'professions', label: 'Профессии' },
  { id: 'games', label: 'Игры' },
  { id: 'mail', label: 'Почта' },
  { id: 'settings', label: 'Настройки' },
] as const satisfies readonly V2Shortcut[];

export const V2_BATTLE_HUD = {
  heroMoves: 'right',
  enemiesFace: 'left',
  followers: 'leftOfHero',
  level: 'bottomLeftByHp',
  hpOrb: 'bottomLeft',
  hpBar: 'betweenOrbs',
  energyOrb: 'bottomRight',
  arenaButton: 'directlyAboveEnergyOrb',
  topRightEnergyBar: false,
  equipmentGrid: 'directlyBelowCombatHud',
  taskStrip: 'belowEquipmentGrid',
  speedControl: 'taskStrip',
  replayControl: 'taskStrip',
  raisedExpeditionControl: 'bottomNavCenter',
  biomeBackground: 'horizontalSeamlessParallax',
  mobileSafeArea: true,
} as const;

export const V2_HERO_TABS = [
  { id: 'hero', label: 'Снаряжение' },
  { id: 'skills', label: 'Навыки' },
  { id: 'runes', label: 'Руны' },
  { id: 'companions', label: 'Последователи' },
  { id: 'warehouse', label: 'Склад' },
] as const satisfies readonly V2Shortcut[];

export const V2_SAFETY_CONTRACT = {
  clientCanMintRewards: false,
  clientCanVerifyPurchases: false,
  productionDatabaseWritesFromPreview: false,
  productionMainChangesFromPreview: false,
  migrateOldSavesOnlyWithBackupAndTests: true,
  keepExistingPlayersVipCurrenciesGear: true,
  preserveAdminAccess: true,
} as const;
