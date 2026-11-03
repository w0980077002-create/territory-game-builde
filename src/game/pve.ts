import { ZONES, type Zone } from './arenaApi';
import type { Enemy, GameState, InventoryItem } from './types';
import { getComputedStats } from './engine';
import type { PveRuneTotals } from './builds/runePveEffectsV1';
import { eliteRoundDamageCap, followerGuardDamage } from './pveBalance';
import { followerCombat, selectedFollower } from './followers';
import { forgeSetBonus } from './forge';
import { isElixirExpired } from './elixirExpiry';

export interface PveSide {
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  critChance: number;
  critDamage: number;
  /** PvE-only enemy metadata; optional on hero and existing test fixtures. */
  enemyId?: string;
  isBoss?: boolean;
}

export interface PveHit {
  attacker: string;
  source?: 'companion' | 'rune';
  target: string;
  targetSide: 'hero' | 'enemy';
  zone: Zone;
  tone: 'hit' | 'crit' | 'block' | 'dodge';
  amount: number;
}

const DODGE_CHANCE = 6;
const zoneOf = (z: Zone) => ZONES.find((x) => x.id === z)!;
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export function randomZones(): { attack: Zone; blocks: Zone[] } {
  // Fisher-Yates: sort(() => Math.random() - 0.5) biases probabilities.
  const ids = ZONES.map((z) => z.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return { attack: pick(ZONES).id, blocks: ids.slice(0, 2) };
}

/** Pick an actually open zone against BOTH committed enemy guard slots.
 * The earlier single-zone helper could select the second blocked zone while
 * claiming to have found a breach. This only changes manual target selection:
 * damage, AI, rewards and existing PvP remain untouched. */
export function nextOpenStrike(current: Zone | null, guarded: readonly Zone[]): Zone {
  const openings = ZONES.map(zone => zone.id).filter(zone => !guarded.includes(zone));
  if (!openings.length) return current ?? ZONES[0].id;
  const index = current === null ? -1 : openings.indexOf(current);
  return openings[(index + 1) % openings.length];
}

/** One-tap combo setup for the EXISTING manual elite battle.
 * A freshly earned 1/2 combo needs a DIFFERENT landed strike next round.
 * Prefer a real unguarded zone other than the last landed attack on the
 * first tap; subsequent taps cycle both real openings so the player retains
 * control. This only selects a target; playRound still resolves the hit,
 * blocks, dodge and +15% bonus. No extra attack, cost or reward. */
export function nextComboOpening(
  current: Zone | null,
  guarded: readonly Zone[],
  lastLandedZone: Zone | null,
): Zone {
  const openings = ZONES.map(zone => zone.id).filter(zone => !guarded.includes(zone));
  if (!openings.length) return current ?? ZONES[0].id;
  if (current !== null && openings.includes(current)) return nextOpenStrike(current, guarded);
  return openings.find(zone => zone !== lastLandedZone) ?? openings[0];
}

/** Keep the two most recent DISTINCT resolved strikes, not merely the last
 * two rounds. Repeating the same zone must not erase the boss's knowledge of
 * another zone or cause phase III to disappear. Fight-local only: no save,
 * economy or server-owned state is changed. */
export function rememberDistinctHeroAttacks(history: readonly Zone[], resolved: Zone): Zone[] {
  return [resolved, ...history.filter(zone => zone !== resolved)].slice(0, 2);
}

/** Fight-local manual combo: two consecutive successful strikes into DIFFERENT
 * zones charge a one-use +15% attack on the following round. A block, dodge,
 * repeated zone or auto round cannot charge the bonus. No persistence, loot,
 * new currency or PvP effect. */
export interface TacticalMomentum {
  lastZone: Zone | null;
  streak: 0 | 1 | 2;
}

export function nextTacticalMomentum(
  current: TacticalMomentum,
  zone: Zone,
  result: PveHit['tone'] | null,
  manualElite: boolean,
): TacticalMomentum {
  if (!manualElite) return { lastZone: null, streak: 0 };
  // The UI promises the next LANDED strike. A shield or dodge must not
  // silently consume an earned combo; the same charged attack can be tried
  // again in the next manual elite round. A partial (1/2) chain still breaks
  // on a miss, and auto/ordinary encounters never preserve the charge.
  if (result !== 'hit' && result !== 'crit')
    return current.streak === 2 ? current : { lastZone: null, streak: 0 };
  // The first landed charged attack consumes the bonus and begins a new chain.
  if (current.streak === 2) return { lastZone: zone, streak: 1 };
  if (current.streak === 1 && current.lastZone !== null && current.lastZone !== zone)
    return { lastZone: zone, streak: 2 };
  return { lastZone: zone, streak: 1 };
}

/** Elite enemies learn attack patterns as their HP falls: at half HP they
 * cover the last attack, at quarter HP they cover the last TWO distinct
 * attacks. The announced guard is committed to the same playRound resolver.
 * Always leave two real openings; never alter rewards, damage or resources. */
export function nextAdaptiveEnemyIntent(
  enemy: Pick<PveSide, 'hp' | 'maxHp'>,
  lastHeroAttack: Zone,
  eliteEncounter: boolean,
  rolledIntent: ReturnType<typeof randomZones> = randomZones(),
  previousHeroAttack: Zone | null = null,
): { intent: ReturnType<typeof randomZones>; adapted: boolean; phase: 1 | 2 | 3 } {
  if (!eliteEncounter || !Number.isFinite(enemy.hp) || !Number.isFinite(enemy.maxHp)
    || enemy.hp <= 0 || enemy.maxHp <= 0 || enemy.hp > enemy.maxHp / 2) {
    return { intent: rolledIntent, adapted: false, phase: 1 };
  }
  // Phase III only starts after two actual, different hero attacks. No
  // invented history on the first round, and no third/hidden guard zone.
  if (enemy.hp <= enemy.maxHp / 4 && previousHeroAttack
    && previousHeroAttack !== lastHeroAttack
    && ZONES.some(zone => zone.id === previousHeroAttack)) {
    return {
      intent: { attack: rolledIntent.attack, blocks: [lastHeroAttack, previousHeroAttack] },
      adapted: true,
      phase: 3,
    };
  }
  const otherGuard = rolledIntent.blocks.find(zone => zone !== lastHeroAttack)
    ?? ZONES.find(zone => zone.id !== lastHeroAttack)?.id;
  return {
    intent: { attack: rolledIntent.attack, blocks: otherGuard ? [lastHeroAttack, otherGuard] : [lastHeroAttack] },
    adapted: true,
    phase: 2,
  };
}

/** A successful manual leg riposte staggers an elite guard for ONE next round.
 * The announced attack remains exactly the same; only the second guarded
 * zone becomes an opening. This is a fight-local tactical effect, not loot,
 * a saved buff, a new enemy roll or a change to PvP/server combat. */
export function staggerEnemyGuard(intent: ReturnType<typeof randomZones>, active: boolean): ReturnType<typeof randomZones> {
  if (!active || intent.blocks.length < 2) return intent;
  return { attack: intent.attack, blocks: intent.blocks.slice(0, 1) };
}

/** One-tap defense against an announced strike. Preserve the other selected
 * block when both slots are occupied; never add a third defense zone. */
export function coverThreatZone(current: readonly Zone[], threat: Zone): Zone[] {
  if (current.includes(threat)) return [...current];
  return current.length < 2 ? [...current, threat] : [current[current.length - 1], threat];
}

export function heroSide(state: GameState): PveSide {
  const s = getComputedStats(state);
  const forge = forgeSetBonus(state.player.equipped);
  const follower = followerCombat(selectedFollower(state));
  const hp = Math.max(1, Math.round(s.maxHp * (1 + forge.hp)));
  return { name: state.player.name, hp, maxHp: hp, attack: Math.round(s.attack * (1 + forge.attack)), defense: Math.round(s.defense * (1 + forge.defense)), critChance: Math.min(95, s.critChance + follower.crit), critDamage: s.critDamage };
}

export function enemySide(e: Enemy): PveSide {
  return { name: e.name, hp: e.maxHp, maxHp: e.maxHp, attack: e.attack, defense: e.defense, critChance: e.isBoss ? 8 : 4, critDamage: 50, enemyId: e.id, isBoss: e.isBoss };
}

/** A rune snapshot contains basis points, never client-issued ownership. */
function runeBp(runes: PveRuneTotals | null, key: string): number {
  const value = runes?.[key] ?? 0;
  return Number.isFinite(value) ? Math.min(2500, Math.max(0, Math.floor(value))) : 0;
}

function strike(from: PveSide, to: PveSide, targetSide: PveHit['targetSide'], zone: Zone, blocked: Zone[],
  adjustments: { dodgeBp?: number; accuracyBp?: number; critBp?: number } = {}): PveHit {
  const base = { attacker: from.name, target: to.name, targetSide, zone };
  const dodgeChance = Math.max(0, Math.min(50,
    DODGE_CHANCE + (adjustments.dodgeBp ?? 0) / 100 - (adjustments.accuracyBp ?? 0) / 100));
  if (Math.random() * 100 < dodgeChance) return { ...base, tone: 'dodge', amount: 0 };
  const crit = Math.random() * 100 < Math.min(100, from.critChance + (adjustments.critBp ?? 0) / 100);
  const isBlocked = blocked.includes(zone);
  if (isBlocked && !crit) return { ...base, tone: 'block', amount: 0 };
  const spread = 0.9 + Math.random() * 0.2;
  let dmg = Math.max(1, (from.attack - to.defense / 2) * zoneOf(zone).mult * spread);
  if (crit) dmg *= 1 + from.critDamage / 100;
  if (crit && isBlocked) dmg *= 0.5;
  return { ...base, tone: crit ? 'crit' : 'hit', amount: Math.round(dmg) };
}

/** Read-only feedback from actual strikes; never modifies AI, damage or rewards. */
export interface PveTacticalSummary {
  heroStrike: PveHit['tone'] | null;
  enemyStrike: PveHit['tone'] | null;
  enemyZone: Zone | null;
  /** Damage from resolved hits only; excludes blocked, dodged and healing events. */
  dealtDamage: number;
  takenDamage: number;
  companionDamage: number;
}

export function summarizePveRound(hits: readonly PveHit[]): PveTacticalSummary {
  const heroStrike = hits.find(hit => hit.targetSide === 'enemy');
  const enemyStrike = hits.find(hit => hit.targetSide === 'hero');
  return {
    heroStrike: heroStrike?.tone ?? null,
    enemyStrike: enemyStrike?.tone ?? null,
    enemyZone: enemyStrike?.zone ?? null,
    dealtDamage: hits.filter(hit => hit.targetSide === 'enemy').reduce((sum, hit) => sum + Math.max(0, hit.amount), 0),
    takenDamage: hits.filter(hit => hit.targetSide === 'hero').reduce((sum, hit) => sum + Math.max(0, hit.amount), 0),
    companionDamage: hits.filter(hit => hit.targetSide === 'enemy' && hit.source === 'companion').reduce((sum, hit) => sum + Math.max(0, hit.amount), 0),
  };
}

/** Persistent fight-local debuffs; never stored in the hero's inventory. */
export interface PveRuneAilments {
  bleed: number;
  burn: number;
  slow: number;
  root: number;
}
export const EMPTY_PVE_RUNE_AILMENTS: Readonly<PveRuneAilments> = Object.freeze({
  bleed: 0, burn: 0, slow: 0, root: 0,
});

export interface RoundResult {
  hits: PveHit[];
  hero: PveSide;
  enemy: PveSide;
  healAmount: number;
  /** Portion of healing supplied by a real rune, not the companion. */
  runeHealAmount?: number;
  /** Debuffs produced by resolved attacks; the next round consumes them. */
  runeAilments?: PveRuneAilments;
}

export function playRound(hero: PveSide, enemy: PveSide, attack: Zone, blocks: Zone[], followerAttack: number, followerName: string, followerDefense = 0, bonus: ReturnType<typeof followerCombat> | null = null, enemyIntent: ReturnType<typeof randomZones> | null = null, riposteReady = false, momentumReady = false, runes: PveRuneTotals | null = null,
  priorAilments: Readonly<PveRuneAilments> = EMPTY_PVE_RUNE_AILMENTS): RoundResult {
  // The visible enemy guard is the actual defense used by this round, not a decorative hint.
  // Other callers retain their original random AI by omitting enemyIntent.
  const ai = enemyIntent ?? randomZones();
  const hits: PveHit[] = [];
  // Ailments only exist with a verified rune build. A rune-free round retains
  // the original combat resolution, RNG calls and reward contract.
  const previous = runes ? priorAilments : EMPTY_PVE_RUNE_AILMENTS;
  const cap = eliteRoundDamageCap(enemy.enemyId ?? '', !!enemy.isBoss, enemy.maxHp);
  let damageBudget = cap ?? Number.POSITIVE_INFINITY;
  // Armor penetration stacks after the existing companion piercing effect.
  // This only changes hit damage, not the opponent's persisted equipment.
  const followerPiercedDefense = bonus?.pierce
    ? Math.max(0, Math.floor(enemy.defense * (1 - bonus.pierce)))
    : enemy.defense;
  const piercedEnemy = {
    ...enemy, defense: Math.max(0, Math.floor(followerPiercedDefense * (1 - runeBp(runes, 'armor_pen_bp') / 10000))),
  };
  // A successful manual elite guard grants ONE stronger next strike. Apply
  // the bonus to actual damage only after dodge/block/crit resolution, then
  // pass through the existing elite cap and remaining HP clamp.
  // Both displayed enemy guard slots are committed to this round. The
  // previous slice(0, 1) silently ignored the second guard, so a player
  // could hit a supposedly protected zone. Critical guard-piercing remains
  // governed by strike(), exactly as before.
  const rawHit = strike(hero, piercedEnemy, 'enemy', attack, ai.blocks, {
    critBp: Math.min(2500, runeBp(runes, 'crit_chance_bp') + runeBp(runes, 'rune_combat_crit_bp')),
    accuracyBp: Math.min(2500, runeBp(runes, 'accuracy_bp') + runeBp(runes, 'rune_combat_accuracy_bp')),
  });
  const enhancedHit = riposteReady && rawHit.amount > 0
    ? { ...rawHit, amount: Math.round(rawHit.amount * 1.2) }
    : rawHit;
  // A charged manual combo is real HP damage, not a display-only label.
  // Apply it after guard/dodge and riposte, BEFORE the existing elite cap.
  const comboHit = momentumReady && enhancedHit.amount > 0
    ? { ...enhancedHit, amount: Math.round(enhancedHit.amount * 1.15) }
    : enhancedHit;
  // A selected rune modifies actual HP loss, not merely a combat label.
  // Keep the established guard/riposte/combo order and elite boss cap.
  const attackBonusBp = Math.min(2500,
    runeBp(runes, 'damage_bonus_bp') + runeBp(runes, 'rune_combat_damage_bp')
    + runeBp(runes, 'single_target_damage_bp')
    + (enemy.hp > 0 && enemy.hp <= enemy.maxHp * 0.3 ? runeBp(runes, 'finisher_damage_bp') : 0)
    + (previous.slow > 0 ? runeBp(runes, 'damage_vs_slow_bp') : 0)
    + (ai.blocks.includes(attack) ? runeBp(runes, 'damage_vs_guard_bp') : 0)
    + (riposteReady ? runeBp(runes, 'counter_damage_bp') : 0)
    + (momentumReady ? runeBp(runes, 'attack_chain_damage_bp') : 0));
  const runeHit = attackBonusBp > 0 && comboHit.amount > 0
    ? { ...comboHit, amount: Math.round(comboHit.amount * (1 + attackBonusBp / 10000)) }
    : comboHit;
  const firstDamage = Math.min(runeHit.amount, damageBudget, enemy.hp);
  const h1 = { ...runeHit, amount: firstDamage };
  hits.push(h1);
  damageBudget -= firstDamage;
  let enemyHp = Math.max(0, enemy.hp - firstDamage);
  if (enemyHp > 0 && followerAttack > 0 && damageBudget > 0) {
    const companionDamage = Math.min(Math.max(0, Math.floor(followerAttack)), damageBudget, enemyHp);
    if (companionDamage > 0) {
      const f: PveHit = { source: 'companion', attacker: followerName, target: enemy.name, targetSide: 'enemy', zone: pick(ZONES).id, tone: 'hit', amount: companionDamage };
      hits.push(f);
      enemyHp = Math.max(0, enemyHp - companionDamage);
    }
  }
  // Existing bleed and burn resolve after attacks, using the very same
  // enemy HP and boss damage budget. No phantom damage, extra loot or KO
  // beyond the original engine cap.
  if (runes && enemyHp > 0 && damageBudget > 0 && (previous.bleed > 0 || previous.burn > 0)) {
    const normalDot = Math.floor(enemy.maxHp * (Math.min(1, previous.bleed) * 0.008
      + Math.min(1, previous.burn) * 0.012));
    const dotAmount = Math.min(enemyHp, damageBudget, Math.max(1,
      Math.round(normalDot * (1 + runeBp(runes, 'dot_damage_bp') / 10000))));
    if (dotAmount > 0) {
      hits.push({ source: 'rune', attacker: hero.name, target: enemy.name, targetSide: 'enemy',
        zone: attack, tone: 'hit', amount: dotAmount });
      enemyHp -= dotAmount;
      damageBudget -= dotAmount;
    }
  }
  let heroHp = hero.hp;
  if (enemyHp > 0 && previous.root <= 0) {
    // A slowed enemy still attacks, but at reduced force. The root effect
    // above is stronger and can skip a strike for its remaining duration.
    const actingEnemy = previous.slow > 0
      ? { ...enemy, attack: Math.max(1, Math.round(enemy.attack * 0.9)) }
      : enemy;
    const rawEnemyHit = strike(actingEnemy, hero, 'hero', ai.attack, blocks, {
      dodgeBp: Math.min(2500,
        runeBp(runes, 'dodge_chance_bp') + runeBp(runes, 'enemy_accuracy_reduction_bp') + runeBp(runes, 'rune_combat_dodge_bp')),
    });
    const followerMitigated = rawEnemyHit.amount > 0 ? followerGuardDamage(rawEnemyHit.amount, followerDefense) : 0;
    const defenseBonusBp = Math.min(2500,
      runeBp(runes, 'guard_absorb_bp') + runeBp(runes, 'rune_combat_guard_bp')
      + (momentumReady ? runeBp(runes, 'rage_damage_reduction_bp') : 0));
    const mitigated = Math.round(followerMitigated * (1 - defenseBonusBp / 10000));
    // Only actual HP loss belongs in the hit log and tactical damage counters.
    const h2 = { ...rawEnemyHit, amount: Math.min(mitigated, heroHp) };
    hits.push(h2);
    heroHp = Math.max(0, heroHp - h2.amount);
  }
  const companionHeal = heroHp > 0 && enemyHp > 0 && bonus?.heal
    ? Math.min(Math.max(0, hero.maxHp - heroHp), bonus.heal) : 0;
  // Regeneration only heals a living hero during an ongoing fight; never
  // revives a defeated hero, inflates max HP, or grants extra rewards.
  const regenBp = runeBp(runes, 'regen_bp');
  const runeHealAmount = heroHp > 0 && enemyHp > 0 && regenBp > 0
    ? Math.min(Math.max(0, hero.maxHp - heroHp - companionHeal),
      Math.max(1, Math.floor(hero.maxHp * regenBp / 10000)))
    : 0;
  const healAmount = companionHeal + runeHealAmount;
  const ailments: PveRuneAilments = {
    bleed: Math.max(0, previous.bleed - 1),
    burn: Math.max(0, previous.burn - 1),
    slow: Math.max(0, previous.slow - 1),
    root: Math.max(0, previous.root - 1),
  };
  // All proc rolls are conditional on an actual landed hit. This is
  // intentionally checked AFTER resolving this round: new ailments only
  // affect later rounds, never retroactively change the current strike.
  if (runes && h1.amount > 0 && enemyHp > 0) {
    const proc = (key: string) => {
      const chance = runeBp(runes, key);
      return chance > 0 && Math.random() * 10000 < chance;
    };
    // An absent rune must not consume random numbers and change future AI rolls.
    if (proc('bleed_chance_bp')) ailments.bleed = Math.max(ailments.bleed, 2);
    if (proc('burn_chance_bp')) ailments.burn = Math.max(ailments.burn, 2);
    if (proc('slow_chance_bp')) ailments.slow =
      Math.max(ailments.slow, 2 + Math.floor(runeBp(runes, 'slow_duration_bp') / 1000));
    if (proc('root_chance_bp')) ailments.root =
      Math.max(ailments.root, 1 + Math.floor(runeBp(runes, 'root_duration_bp') / 1000));
  }
  return { hits, hero: { ...hero, hp: heroHp + healAmount }, enemy: { ...enemy, hp: enemyHp },
    healAmount, runeHealAmount, runeAilments: ailments };
}

export type PotionUse =
  | { ok: true; hero: PveSide; text: string }
  | { ok: false; text: string };

export function applyPotion(hero: PveSide, item: InventoryItem): PotionUse {
  if (isElixirExpired(item)) return { ok: false, text: 'Срок годности эликсира истёк' };
  if (item.arenaEffect) return { ok: false, text: `${item.name} действует только на арене` };
  const e = item.effect;
  if (!e || !Number.isFinite(e.value) || e.value <= 0 || e.value > 1000000) return { ok: false, text: 'Этот предмет нельзя выпить в бою' };
  if (e.stat === 'hp') {
    if (hero.hp >= hero.maxHp) return { ok: false, text: 'Здоровье уже полное' };
    const hp = Math.min(hero.maxHp, hero.hp + e.value);
    return { ok: true, hero: { ...hero, hp }, text: `+${hp - hero.hp} HP` };
  }
  if (e.stat === 'attack') return { ok: true, hero: { ...hero, attack: hero.attack + e.value }, text: `+${e.value} к атаке до конца боя` };
  if (e.stat === 'defense') return { ok: true, hero: { ...hero, defense: hero.defense + e.value }, text: `+${e.value} к защите до конца боя` };
  if (e.stat === 'critChance') return { ok: true, hero: { ...hero, critChance: hero.critChance + e.value }, text: `+${e.value}% к криту до конца боя` };
  return { ok: false, text: 'Этот предмет нельзя выпить в бою' };
}

export function describeHit(h: PveHit): string {
  const zone = zoneOf(h.zone).label.toLowerCase();
  if (h.tone === 'dodge') return `${h.target} уклоняется от удара ${h.attacker}`;
  if (h.tone === 'block') return `${h.target} блокирует удар в ${zone}`;
  if (h.tone === 'crit') return `${h.attacker} — КРИТ в ${zone}: −${h.amount}`;
  return `${h.attacker} бьёт в ${zone}: −${h.amount}`;
}
