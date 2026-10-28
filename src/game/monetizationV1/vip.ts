/** Server-supplied VIP rules. No economic coefficient is inferred from a video. */
export interface VipTierRule {
  tier: number;
  requiredPoints: number;
  attackBps: number;
  defenseBps: number;
  hpBps: number;
}
export interface VipEntitlement {
  permanentTier: number;
  temporaryTier: number;
  temporaryUntil: string | null;
  points: number;
  serverNow: string;
}
export interface VipCombatStats { attack: number; defense: number; hp: number; maxHp: number }
const integer = (n: number, min: number, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= min && n <= max;
export function validateVipRules(rules: readonly VipTierRule[]): void {
  const seen = new Set<number>();
  let previousPoints = -1;
  for (const rule of [...rules].sort((a, b) => a.tier - b.tier)) {
    if (!integer(rule.tier, 0, 10) || seen.has(rule.tier) || !integer(rule.requiredPoints, 0) ||
      rule.requiredPoints < previousPoints || ![rule.attackBps, rule.defenseBps, rule.hpBps].every(n => integer(n, 0))) {
      throw new Error('invalid_vip_rules');
    }
    seen.add(rule.tier); previousPoints = rule.requiredPoints;
  }
}
export function resolveVip(entitlement: VipEntitlement, rules: readonly VipTierRule[]) {
  validateVipRules(rules);
  if (!integer(entitlement.permanentTier, 0, 10) || !integer(entitlement.temporaryTier, 0, 10) ||
      !integer(entitlement.points, 0) || !Number.isFinite(Date.parse(entitlement.serverNow)) ||
      (entitlement.temporaryUntil !== null && !Number.isFinite(Date.parse(entitlement.temporaryUntil)))) throw new Error('invalid_vip_entitlement');
  const earned = rules.filter(r => r.requiredPoints <= entitlement.points).reduce((tier, r) => Math.max(tier, r.tier), 0);
  const temporary = entitlement.temporaryUntil !== null && Date.parse(entitlement.temporaryUntil) > Date.parse(entitlement.serverNow)
    ? entitlement.temporaryTier : 0;
  const tier = Math.max(entitlement.permanentTier, earned, temporary);
  return { tier, points: entitlement.points, rule: rules.find(r => r.tier === tier) ?? null,
    next: [...rules].sort((a, b) => a.tier - b.tier).find(r => r.tier > tier) ?? null,
    bonusesConfigured: rules.some(r => r.tier === tier) };
}
/** Shared PvE/PvP formula. Apply once to uneffected final equipment stats. HP ratio is preserved. */
export function applyVipCombatStats<T extends VipCombatStats>(base: T, rule: VipTierRule | null): T {
  for (const n of [base.attack, base.defense, base.hp, base.maxHp]) if (!integer(n, 0)) throw new Error('invalid_combat_stats');
  if (base.maxHp < 1 || base.hp > base.maxHp) throw new Error('invalid_combat_stats');
  if (!rule) return { ...base };
  validateVipRules([rule]);
  const scale = (n: number, bps: number) => {
    const result = Number(BigInt(n) * (10000n + BigInt(bps)) / 10000n);
    if (!Number.isSafeInteger(result)) throw new Error('vip_stat_overflow');
    return result;
  };
  const maxHp = scale(base.maxHp, rule.hpBps);
  return { ...base, attack: scale(base.attack, rule.attackBps), defense: scale(base.defense, rule.defenseBps),
    maxHp, hp: base.hp === 0 ? 0 : Math.min(maxHp, Number(BigInt(base.hp) * BigInt(maxHp) / BigInt(base.maxHp))) };
}

/** Idle combat uses fraction probabilities. VIP scales only attack/defense/HP;
 * crit/dodge/block fractions pass through untouched. Supply an unmodified server
 * snapshot; never reapply this function to a previously scaled snapshot. */
export function adaptIdleVipStats<T extends VipCombatStats & { critChance: number; dodgeChance: number; blockChance: number }>(
  base: T, rule: VipTierRule | null,
): T {
  if (![base.critChance, base.dodgeChance, base.blockChance].every(p => Number.isFinite(p) && p >= 0 && p <= 1)) throw new Error('invalid_combat_probability');
  return applyVipCombatStats(base, rule);
}
