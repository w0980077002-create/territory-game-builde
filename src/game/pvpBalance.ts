/** Target specification for the staged server PvP migration.
 * NOT used for active Arena battles until the server migration is reviewed.
 * No unbounded combat stat from client-authored players rows reaches PvP.
 * Server-approved potions remain separate in-battle effects.
 */
export interface PvpStats { attack: number; defense: number; maxHp: number; critChance: number }

export function normalizePvpEntry(level: number, attack: number): PvpStats {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const safeAttack = Number.isFinite(attack) ? Math.max(0, attack) : 0;
  const levelPct = Math.min(0.03, (safeLevel - 1) * 0.0004);
  // Until server-signed item ownership is available, even forged gear stats
  // cannot produce more than a two percent entry-stat benefit.
  const gearPct = Math.min(0.02, Math.max(0, safeAttack - 20) * 0.00005);
  const factor = 1 + levelPct + gearPct;
  return {
    attack: Math.round(70 * factor),
    defense: Math.round(24 * factor),
    maxHp: Math.round(420 * factor),
    critChance: 7,
  };
}
