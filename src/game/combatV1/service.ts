import { advanceIdleCombat, createIdleCombat, queueIdleSkill, validateIdleLoadout } from '../idleEngine/index.ts';
import type { IdleCatalog, IdleCombatInput, IdleCombatState, IdleFighterInput, IdleLoadout, IdleCombatRules } from '../idleEngine/types.ts';

/** Client commands never contain combat stats, elapsed time, seeds or outcomes. */
export type CombatCommand =
  | { action: 'loadout'; operationId: string; revision: number; loadout: IdleLoadout }
  | { action: 'start'; operationId: string; encounterId: string; control: 'auto' | 'manual' }
  | { action: 'advance'; operationId: string; sessionId: string; revision: number; skillId?: string }
  | { action: 'resume'; sessionId: string };

export interface CombatContext {
  serverMs: number;
  configVersion: number;
  profileVersion: number;
  catalog: IdleCatalog;
  rules: IdleCombatRules;
  hero: IdleFighterInput;
  encounter?: { id: string; version: number; stage: number; mode: IdleCombatInput['mode']; enemy: IdleFighterInput };
  session?: { id: string; revision: number; cursorMs: number; state: IdleCombatState };
  settlement?: Record<string, unknown> | null;
  replay?: Record<string, unknown>;
}

export interface CombatRepository {
  context(player: string, command: CombatCommand): Promise<CombatContext>;
  commit(player: string, command: Exclude<CombatCommand, { action: 'resume' }>, context: CombatContext,
    result: { state?: IdleCombatState; events?: unknown[]; loadout?: IdleLoadout; cursorMs?: number }): Promise<Record<string, unknown>>;
}

const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;

/** Exact allowlist prevents a caller from smuggling an outcome through a retry. */
export function parseCombatCommand(value: unknown): CombatCommand {
  if (!record(value) || typeof value.action !== 'string') throw new Error('combat_invalid_command');
  const keys: Record<string, string[]> = {
    loadout: ['action', 'operationId', 'revision', 'loadout'],
    start: ['action', 'operationId', 'encounterId', 'control'],
    advance: ['action', 'operationId', 'sessionId', 'revision', 'skillId'],
    resume: ['action', 'sessionId'],
  };
  const action = value.action;
  if (!Object.prototype.hasOwnProperty.call(keys, action)
    || Object.keys(value).some(key => !keys[action].includes(key))) throw new Error('combat_invalid_command');
  if (value.action !== 'resume' && !uuid(value.operationId)) throw new Error('combat_invalid_operation');
  if (value.action === 'start') {
    if (typeof value.encounterId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.encounterId)
      || !['auto', 'manual'].includes(String(value.control))) throw new Error('combat_invalid_encounter');
  } else if (value.action === 'advance' || value.action === 'resume') {
    if (!uuid(value.sessionId)) throw new Error('combat_invalid_session');
    if (value.action === 'advance' && (!revision(value.revision)
      || (value.skillId !== undefined && (typeof value.skillId !== 'string' || value.skillId.length > 100 || !value.skillId)))) throw new Error('combat_invalid_revision');
  } else if (!revision(value.revision) || !record(value.loadout)) throw new Error('combat_invalid_loadout');
  return value as unknown as CombatCommand;
}

function verifiedHero(context: CombatContext, loadout = context.hero.loadout): IdleFighterInput {
  if (!context.hero.ownership) throw new Error('combat_ownership_not_verified');
  const errors = validateIdleLoadout(loadout, context.catalog, context.hero.ownership);
  if (errors.length) throw new Error('combat_invalid_loadout:' + errors.join(','));
  return { ...context.hero, loadout };
}

function engine<T>(compute: () => T, errorCode: string): T {
  try { return compute(); }
  catch { throw new Error(errorCode); }
}

/** The Edge Function and local integration tests execute this exact service. */
export async function executeCombatCommand(repository: CombatRepository, player: string, raw: unknown,
  seed: () => number): Promise<Record<string, unknown>> {
  if (!uuid(player)) throw new Error('combat_auth_required');
  const command = parseCombatCommand(raw);
  const context = await repository.context(player, command);
  if (context.replay) return context.replay;
  if (!Number.isSafeInteger(context.serverMs) || context.serverMs < 0) throw new Error('combat_invalid_server_clock');
  if (command.action === 'resume') {
    if (!context.session) throw new Error('combat_session_not_found');
    return { success: true, session_id: context.session.id, revision: context.session.revision,
      state: context.session.state, rewards_claimed: context.settlement?.outcome === 'hero_won',
      settlement: context.settlement ?? null };
  }
  if (command.action === 'loadout') {
    if (context.profileVersion !== command.revision) throw new Error('combat_revision_conflict');
    verifiedHero(context, command.loadout);
    return repository.commit(player, command, context, { loadout: command.loadout });
  }
  if (command.action === 'start') {
    const encounter = context.encounter;
    if (!encounter || encounter.id !== command.encounterId) throw new Error('combat_encounter_not_available');
    const state = engine(() => createIdleCombat({ seed: seed(), stage: encounter.stage, mode: encounter.mode,
      control: command.control, hero: verifiedHero(context), enemy: encounter.enemy,
      catalog: context.catalog, rules: context.rules }), 'combat_invalid_configuration');
    return repository.commit(player, command, context, { state, events: [], cursorMs: context.serverMs });
  }
  const session = context.session;
  if (!session || session.revision !== command.revision) throw new Error('combat_revision_conflict');
  if (session.state.status !== 'fighting') throw new Error('combat_already_finished');
  if (command.skillId && (session.state.input.control !== 'manual'
    || !session.state.actors.hero.loadout.skills.some(s => s.skillId === command.skillId))) throw new Error('combat_skill_not_available');
  // Time comes exclusively from the database. A suspended app catches up in
  // bounded chunks without dropping the rest of its server-authorized time.
  const elapsed = Math.min(30_000, Math.max(0, context.serverMs - session.cursorMs));
  if (command.skillId && context.serverMs - session.cursorMs > 30_000) throw new Error('combat_catchup_required');
  if (elapsed === 0 && !command.skillId) throw new Error('combat_no_elapsed_time');
  const advanced = engine(() => advanceIdleCombat(session.state, elapsed), 'combat_invalid_session_state');
  // A newly received manual input cannot rewrite the unattended past.
  const state = command.skillId && advanced.state.status === 'fighting'
    ? engine(() => queueIdleSkill(advanced.state, command.skillId!), 'combat_skill_not_available') : advanced.state;
  return repository.commit(player, command, context, { state, events: advanced.events,
    cursorMs: session.cursorMs + elapsed });
}
