import { supabase } from './supabase';
import { ensurePlayerSession } from './auth';

export interface MortarionRank {
  rank: number;
  name: string;
  damage: number;
}

export interface MortarionState {
  active: boolean;
  enabled: boolean;
  startsAt: string;
  endsAt: string;
  maxHp: number;
  hp: number;
  hitsInHour: number;
  maxHitsInHour: number;
  nextHitAt: string | null;
  top10: MortarionRank[];
  serverNow: string;
  hitDamage?: number;
}

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

export function parseMortarionState(raw: unknown): MortarionState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('mortarion_bad_response');
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.top10) || typeof o.serverNow !== 'string'
      || typeof o.endsAt !== 'string' || typeof o.startsAt !== 'string') {
    throw new Error('mortarion_bad_response');
  }
  return {
    active: o.active === true, enabled: o.enabled === true,
    startsAt: o.startsAt, endsAt: o.endsAt,
    maxHp: toInt(o.maxHp), hp: toInt(o.hp),
    hitsInHour: Math.min(5, toInt(o.hitsInHour)),
    maxHitsInHour: 5,
    nextHitAt: typeof o.nextHitAt === 'string' ? o.nextHitAt : null,
    serverNow: o.serverNow,
    hitDamage: o.hitDamage === undefined ? undefined : toInt(o.hitDamage),
    top10: o.top10.slice(0, 10).map((rank: unknown) => {
      const item = rank && typeof rank === 'object' ? rank as Record<string, unknown> : {};
      return { rank: toInt(item.rank), name: String(item.name ?? 'Герой').slice(0,32), damage: toInt(item.damage) };
    }),
  };
}

type BossRpc = 'territory_mortarion_state_v1' | 'territory_mortarion_attack_v1';
async function invokeBossRpc(rpc: BossRpc, playerId?: string): Promise<MortarionState> {
  // In long Telegram WebView sessions refresh the same verified account;
  // never silently create a guest or attack as a different player.
  if (playerId && !await ensurePlayerSession(playerId)) throw new Error('mortarion_auth_required');
  const { data, error } = await supabase.rpc(rpc);
  if (error) throw new Error(error.message);
  return parseMortarionState(data);
}

export function getMortarionBossState(): Promise<MortarionState> {
  return invokeBossRpc('territory_mortarion_state_v1');
}

export function hitMortarionBoss(playerId: string): Promise<MortarionState> {
  return invokeBossRpc('territory_mortarion_attack_v1', playerId);
}
