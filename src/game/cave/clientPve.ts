import { supabase } from '@/game/supabase';

/**
 * Small cloud bridge for ordinary client-side PvE. No combat frames, moves,
 * hero stats or damage are ever sent to the server.
 * Production functions are intentionally gated until the staged SQL is approved.
 */
export interface CavePveStatus {
  completed_stage: number;
  unlocked_stage: number;
  dark_stones: number;
  active_run_id: string | null;
  active_floor: number | null;
  legacy_active_session_id: string | null;
  run_status?: 'active' | 'won' | 'lost';
}
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
export function parseCavePveStatus(data: unknown): CavePveStatus {
  if (!object(data) || !Number.isInteger(data.completed_stage)
    || !Number.isInteger(data.unlocked_stage) || !Number.isSafeInteger(data.dark_stones)
    || Number(data.completed_stage) < 0 || Number(data.completed_stage) > 100
    || Number(data.unlocked_stage) !== Math.min(100, Number(data.completed_stage) + 1)
    || Number(data.dark_stones) < 0
    || (data.active_run_id !== null && typeof data.active_run_id !== 'string')
    || (data.active_floor !== null && (!Number.isInteger(data.active_floor)
      || Number(data.active_floor) < 1 || Number(data.active_floor) > 100))
    || ((data.active_run_id === null) !== (data.active_floor === null))
    || (data.legacy_active_session_id !== null && typeof data.legacy_active_session_id !== 'string')
    || (data.run_status !== undefined && !['active','won','lost'].includes(String(data.run_status))))
    throw new Error('cave_invalid_cloud_status');
  return data as unknown as CavePveStatus;
}
async function call(name: string, args?: Record<string, unknown>): Promise<CavePveStatus> {
  const response = await supabase.rpc(name, args ?? {});
  if (response.error) throw new Error(response.error.message || 'cave_cloud_unavailable');
  return parseCavePveStatus(response.data);
}
export const getCavePveStatus = () => call('territory_cave_pve_status_v1');
export const startCavePveRun = (runId: string, floor: number) =>
  call('territory_cave_pve_start_v1', { p_run_id: runId, p_floor: floor });
export const finishCavePveRun = (runId: string, won: boolean) =>
  call('territory_cave_pve_finish_v1', { p_run_id: runId, p_won: won });
