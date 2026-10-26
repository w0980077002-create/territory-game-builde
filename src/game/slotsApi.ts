import { supabase } from './supabase';
import { SLOT_ICONS, type SlotOutcome } from './vikingSlots';

export type SlotsPhase = 'ready' | 'decision' | 'bonus' | 'superbonus' | 'risk';
export interface SlotsState {
  phase: SlotsPhase; revision: number; pending: number; riskSteps: number; opened: number[];
  picksLeft: number; shields: number; lines?: number; bet?: number; stake?: number;
  outcome?: SlotOutcome; revealed?: Record<string, { kind: 'treasure' | 'trap' | 'shield'; payout: number }>;
  superChoice?: number; superAward?: number; riskChoice?: number; riskWon?: boolean;
}
export interface SlotsStatus { enabled: boolean; tickets: number; hallPending: number; collected: number; state: SlotsState }
export type SlotsAction = { action: 'spin'; lines: number; bet: number } |
  { action: 'bonus' | 'super' | 'risk'; choice: number } | { action: 'risk_start' | 'collect' };
export interface PendingSlots { id: string; expected: number; request: SlotsAction }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const natural = (v: unknown, max = 2147483647): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
function validAction(v: unknown): v is SlotsAction {
  if (!record(v)) return false;
  if (v.action === 'spin') return [1,3,5,7,9].includes(Number(v.lines)) && [1,2,5,10].includes(Number(v.bet)) && typeof v.lines === 'number' && typeof v.bet === 'number';
  if (v.action === 'collect' || v.action === 'risk_start') return true;
  return ['bonus','super','risk'].includes(String(v.action)) && natural(v.choice, v.action === 'bonus' ? 4 : v.action === 'super' ? 2 : 3);
}
function parse(v: unknown): SlotsStatus {
  if (!record(v) || typeof v.enabled !== 'boolean') throw new Error('slots_invalid_reply');
  if (!v.enabled) return { enabled:false,tickets:0,hallPending:0,collected:0,state:{phase:'ready',revision:0,pending:0,riskSteps:0,opened:[],picksLeft:5,shields:0} };
  const s = v.state;
  if (!natural(v.tickets) || !natural(v.hallPending,100000) || !natural(v.collected,100000) || !record(s) ||
      !['ready','decision','bonus','superbonus','risk'].includes(String(s.phase)) || !natural(s.pending) ||
      !natural(s.revision) || !natural(s.riskSteps,5) || !natural(s.picksLeft,5) || !natural(s.shields,5) ||
      !Array.isArray(s.opened) || s.opened.length>5 || s.opened.some((x)=>!natural(x,4)) || new Set(s.opened).size!==s.opened.length) throw new Error('slots_invalid_reply');
  if (s.outcome !== undefined) {
    const o = s.outcome;
    if (!record(o) || !Array.isArray(o.grid) || o.grid.length!==5 ||
      o.grid.some((col)=>!Array.isArray(col) || col.length!==3 || col.some((x)=>typeof x!=='string' || !(x in SLOT_ICONS))) ||
      !natural(o.payout,21600) || !natural(o.bonusSymbols,15) || !Array.isArray(o.lines) || o.lines.length>9 ||
      o.lines.some((line)=>!record(line) || !natural(line.number,9) || line.number<1 || !natural(line.payout,2400) ||
        !natural(line.count,5) || line.count<3 || typeof line.symbol!=='string' || !(line.symbol in SLOT_ICONS) ||
        !Array.isArray(line.positions) || line.positions.length!==line.count || line.positions.some((pos)=>!Array.isArray(pos) || pos.length!==2 || !natural(pos[0],4) || !natural(pos[1],2)))) throw new Error('slots_invalid_outcome');
  }
  return v as unknown as SlotsStatus;
}
export async function fetchSlotsStatus(): Promise<SlotsStatus | null> {
  const { data, error } = await supabase.rpc('territory_slots_v1', { p_action:'status' });
  if (error) {
    if (error.code==='PGRST202' || error.code==='42883') return null;
    throw new Error(error.message || 'slots_unavailable');
  }
  return parse(data);
}
export class SlotsRejected extends Error {}
export async function submitSlotsAction(pending: PendingSlots): Promise<SlotsStatus> {
  if (!uuid(pending.id) || !natural(pending.expected) || !validAction(pending.request)) throw new Error('slots_invalid_operation');
  const r = pending.request;
  const { data, error } = await supabase.rpc('territory_slots_v1', {
    p_action:r.action,p_operation:pending.id,p_expected:pending.expected,
    ...('lines' in r ? {p_lines:r.lines,p_bet:r.bet} : {}), ...('choice' in r ? {p_choice:r.choice} : {}),
  });
  if (error) {
    if (error.code==='P0001' || error.code==='42501') throw new SlotsRejected(error.message);
    throw new Error(error.message || 'slots_unconfirmed');
  }
  const result = parse(data);
  if (!result.enabled) throw new Error('slots_unconfirmed');
  return result;
}
const storageKey = (userId: string) => 'territory_slots_operation_v1_' + userId;
/** Per-account durable replay hint. The SQL receipt is the authority. */
export function readPendingSlots(userId: string): PendingSlots | null {
  if (typeof localStorage==='undefined') throw new Error('slots_storage_unavailable');
  const raw = localStorage.getItem(storageKey(userId));
  if (!raw) return null;
  const p: unknown = JSON.parse(raw);
  if (!record(p) || !uuid(p.id) || !natural(p.expected) || !validAction(p.request)) throw new Error('slots_invalid_pending');
  return p as unknown as PendingSlots;
}
export function keepPendingSlots(userId: string, pending: PendingSlots | null): void {
  if (typeof localStorage==='undefined') throw new Error('slots_storage_unavailable');
  if (pending && (!uuid(pending.id) || !natural(pending.expected) || !validAction(pending.request))) throw new Error('slots_invalid_operation');
  if (pending) localStorage.setItem(storageKey(userId), JSON.stringify(pending));
  else localStorage.removeItem(storageKey(userId));
}
