/** T5-T8 contract. The browser displays server facts; it never awards progress. */
export const ACTIVITY_THRESHOLDS = [20, 40, 60, 80, 100] as const;
export const FUND_KINDS = ['level', 'arena', 'blessing', 'adventure', 'artifact', 'dark_energy'] as const;
export type FundKind = typeof FUND_KINDS[number];
export type GemStack = {gem_kind: string; gem_level: number; quantity: number};
export type GemSocket = {source: 'stage3' | 'stage8'; item_id: string; socket_index: number; gem_kind: string; gem_level: number};
export type GemRule = {gem_kind: string; level: number; next_level: number | null; attack: number; defense: number; hp: number};
export type BlessingRule = {level: number; required_xp: number; charges: number; gold_bonus_bp: number; battle_xp: number | null};
export type ProgressionReward = {
  id: string; period: 'daily' | 'weekly' | 'fund'; fund: FundKind | null;
  track: 'free' | 'premium'; threshold: number; reward: Record<string, unknown>;
};
export type ProgressionStatus = {
  enabled: boolean; day: string; week: string; dailyPoints: number; weeklyPoints: number;
  activities: {id: string; slot: number; target: number; current: number}[];
  blessing: {day: string; charges: number; level: number; xp: number} | null;
  legacyImportRequired: boolean; nextBlessingAt: string;
  funds: {fund: FundKind; progress: number; premium: boolean; purchase_event: string | null}[];
  gems: GemStack[]; sockets: GemSocket[]; gemRules: GemRule[];
  socketRules: {rarity: string; sockets: number}[]; blessingRules: BlessingRule[];
  rewards: ProgressionReward[]; claims: {rule_id: string; period_key: string; grant_id: string}[];
};
export type ProgressionRequest =
  | {action: 'claim_blessing'; payload: Record<string, never>}
  | {action: 'claim_reward'; payload: {ruleId: string}}
  | {action: 'insert_gem'; payload: {source: 'stage3' | 'stage8'; itemId: string; socket: number; kind: string; level: number}}
  | {action: 'remove_gem'; payload: {source: 'stage3' | 'stage8'; itemId: string; socket: number}}
  | {action: 'synthesize_gem' | 'quick_synthesize_gem'; payload: {kind: string; level: number}};
export type ProgressionReceipt = {operationId: string; action: ProgressionRequest['action']; grantId: string | null; status: ProgressionStatus};
export type ProgressionTransport = (name: string, args?: Record<string, unknown>) => Promise<{data: unknown; error: {message: string; code?: string} | null}>;
export type PendingProgression = {operationId: string; request: ProgressionRequest};
export type DurableStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const number = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const text = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const uuid = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const array = (x: unknown, valid: (row: Record<string, unknown>) => boolean): boolean => Array.isArray(x) && x.every(row => object(row) && valid(row));

/** Reject malformed/incomplete receipts before any UI can display an earned reward. */
export function parseProgressionStatus(raw: unknown): ProgressionStatus {
  if (!object(raw) || typeof raw.enabled !== 'boolean' || !text(raw.day) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day)
    || !text(raw.week) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.week) || !number(raw.dailyPoints) || raw.dailyPoints > 100
    || !number(raw.weeklyPoints) || raw.weeklyPoints > 700 || typeof raw.legacyImportRequired !== 'boolean'
    || !text(raw.nextBlessingAt) || !Number.isFinite(Date.parse(raw.nextBlessingAt))
    || !(raw.blessing === null || object(raw.blessing) && typeof raw.blessing.day === 'string' && number(raw.blessing.charges) && number(raw.blessing.level) && raw.blessing.level > 0 && number(raw.blessing.xp))
    || raw.legacyImportRequired !== (raw.blessing === null)
    || !array(raw.activities, a => text(a.id) && number(a.slot) && a.slot >= 1 && a.slot <= 5 && number(a.target) && a.target > 0 && number(a.current))
    || !array(raw.funds, f => FUND_KINDS.includes(f.fund as FundKind) && number(f.progress) && typeof f.premium === 'boolean' && (f.purchase_event === null || uuid(f.purchase_event)))
    || !array(raw.gems, g => text(g.gem_kind) && number(g.gem_level) && g.gem_level > 0 && number(g.quantity))
    || !array(raw.sockets, s => ['stage3', 'stage8'].includes(s.source as string) && uuid(s.item_id) && number(s.socket_index) && s.socket_index > 0 && text(s.gem_kind) && number(s.gem_level) && s.gem_level > 0)
    || !array(raw.gemRules, g => text(g.gem_kind) && number(g.level) && (g.next_level === null || number(g.next_level) && g.next_level > g.level) && number(g.attack) && number(g.defense) && number(g.hp))
    || !array(raw.socketRules, s => text(s.rarity) && number(s.sockets) && s.sockets > 0 && s.sockets <= 16)
    || !array(raw.blessingRules, b => number(b.level) && b.level > 0 && number(b.required_xp) && number(b.charges) && b.charges > 0 && number(b.gold_bonus_bp) && (b.battle_xp === null || number(b.battle_xp)))
    || !array(raw.rewards, r => text(r.id) && ['daily', 'weekly', 'fund'].includes(r.period as string) && ['free', 'premium'].includes(r.track as string) && (r.fund === null || FUND_KINDS.includes(r.fund as FundKind)) && number(r.threshold) && r.threshold > 0 && object(r.reward))
    || !array(raw.claims, c => text(c.rule_id) && text(c.period_key) && uuid(c.grant_id))) throw new Error('progression_status_invalid');
  return raw as unknown as ProgressionStatus;
}

/** Lists decisions the UI can explain without manufacturing prices or balance. */
export function missingProgressionConfiguration(status: ProgressionStatus): string[] {
  const missing: string[] = [];
  if (status.activities.length !== 5) missing.push('five_daily_activities');
  for (const threshold of ACTIVITY_THRESHOLDS) if (!status.rewards.some(r => r.period === 'daily' && r.threshold === threshold)) missing.push(`daily_reward_${threshold}`);
  if (!status.rewards.some(r => r.period === 'weekly')) missing.push('weekly_rewards');
  for (const fund of FUND_KINDS) for (const track of ['free', 'premium']) if (!status.rewards.some(r => r.period === 'fund' && r.fund === fund && r.track === track)) missing.push(`fund_${fund}_${track}`);
  if (!status.gemRules.length) missing.push('gem_catalog');
  if (!status.socketRules.length) missing.push('socket_counts');
  if (!status.blessingRules.some(r => r.level > 1) || status.blessingRules.some(r => r.battle_xp === null)) missing.push('blessing_level_progression');
  return missing;
}

function validateRequest(request: ProgressionRequest): void {
  if (!object(request) || !object(request.payload)) throw new Error('progression_request_invalid');
  const p = request.payload as Record<string, unknown>;
  const expected = {
    claim_blessing: [], claim_reward: ['ruleId'], insert_gem: ['source', 'itemId', 'socket', 'kind', 'level'],
    remove_gem: ['source', 'itemId', 'socket'], synthesize_gem: ['kind', 'level'], quick_synthesize_gem: ['kind', 'level'],
  }[request.action];
  if (!expected || Object.keys(p).length !== expected.length || expected.some(k => !(k in p))) throw new Error('progression_request_invalid');
  if ('source' in p && !['stage3', 'stage8'].includes(p.source as string) || 'itemId' in p && !uuid(p.itemId) || 'socket' in p && (!number(p.socket) || p.socket < 1 || p.socket > 16)
    || 'level' in p && (!number(p.level) || p.level < 1) || 'kind' in p && !text(p.kind)
    || 'ruleId' in p && !text(p.ruleId)) throw new Error('progression_request_invalid');
}
const same = (a: ProgressionRequest, b: ProgressionRequest) => a.action === b.action
  && Object.keys(a.payload).length === Object.keys(b.payload).length
  && Object.entries(a.payload).every(([k, v]) => (b.payload as Record<string, unknown>)[k] === v);

/** Persist BEFORE sending. A lost connection/app close replays the same operation.
 * Keep the receipt for audit, but refresh status because immutable replay receipts
 * may predate later server actions. Claims enqueue existing mail, never local money.
 */
export function createProgressionClient(transport: ProgressionTransport, storage: DurableStorage, userId: string, newId = () => crypto.randomUUID()) {
  if (!uuid(userId)) throw new Error('progression_login_required');
  const key = `territory_progression_pending_v1:${userId}`;
  let busy = false;
  const readPending = (): PendingProgression | null => {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    let value: unknown;
    try {value = JSON.parse(raw);} catch {throw new Error('progression_pending_invalid');}
    if (!object(value) || !uuid(value.operationId) || !object(value.request)) throw new Error('progression_pending_invalid');
    validateRequest(value.request as ProgressionRequest);
    return value as unknown as PendingProgression;
  };
  const fetchStatus = async (): Promise<ProgressionStatus> => {
    const {data, error} = await transport('territory_progression_status_v1');
    if (error) throw new Error(`progression_status_unavailable:${error.message}`);
    return parseProgressionStatus(data);
  };
  const execute = async (request: ProgressionRequest): Promise<{receipt: ProgressionReceipt; currentStatus: ProgressionStatus}> => {
    validateRequest(request);
    if (busy) throw new Error('progression_request_pending');
    busy = true;
    try {
      let pending = readPending();
      if (pending && !same(pending.request, request)) throw new Error('progression_resume_pending_first');
      if (!pending) {
        const operationId = newId();
        if (!uuid(operationId)) throw new Error('progression_operation_invalid');
        pending = {operationId, request};
        storage.setItem(key, JSON.stringify(pending));
      }
      const {data, error} = await transport('territory_progression_action_v1', {p_action: request.action, p_operation: pending.operationId, p_payload: request.payload});
      if (error) {
        // PostgreSQL domain exceptions guarantee this transaction rolled back.
        // Transport/unknown errors keep their durable ID for a safe retry.
        if (error.code === 'P0001' && /^progression_/.test(error.message) && error.message !== 'progression_operation_reused') storage.removeItem(key);
        throw new Error(`progression_action_denied:${error.message}`);
      }
      if (!object(data) || data.operationId !== pending.operationId || data.action !== request.action || !(data.grantId === null || uuid(data.grantId))) throw new Error('progression_receipt_invalid');
      const receipt = {...data, status: parseProgressionStatus(data.status)} as ProgressionReceipt;
      const currentStatus = await fetchStatus();
      storage.removeItem(key);
      return {receipt, currentStatus};
    } finally {busy = false;}
  };
  return {fetchStatus, readPending, execute, resume: async () => {const pending = readPending(); return pending ? execute(pending.request) : null;}};
}
