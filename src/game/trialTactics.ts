import type { Zone } from './arenaApi';

/** Four possible strike directions. A Trial scout spots ONE safe direction,
 * leaving three genuine threats. The actual strike always belongs to those
 * three, but is not disclosed to the player before the round. */
const DIRECTIONS: readonly Zone[] = ['head', 'chest', 'belly', 'legs'];

export function trialThreatCandidates(actualAttack: Zone, random: () => number = Math.random): Zone[] {
  const otherDirections = DIRECTIONS.filter(zone => zone !== actualAttack);
  const index = Math.max(0, Math.min(otherDirections.length - 1, Math.floor(random() * otherDirections.length)));
  const safeDirection = otherDirections[index];
  return DIRECTIONS.filter(zone => zone !== safeDirection);
}

/** One tap may cover two likely zones, but NEVER all three possibilities.
 * A player's already selected defenses within the risk set take priority. */
export function coverTrialThreat(current: readonly Zone[], threats: readonly Zone[]): Zone[] {
  const safeThreats = DIRECTIONS.filter(zone => threats.includes(zone));
  const selected = current.filter(zone => safeThreats.includes(zone)).slice(0, 2);
  return [...selected, ...safeThreats.filter(zone => !selected.includes(zone))].slice(0, 2);
}
