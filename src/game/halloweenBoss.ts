import { supabase } from './supabase';

export interface HalloweenBossRank {
  rank: number;
  name: string;
  damage: number;
}

export interface HalloweenBossState {
  active: boolean;
  startsAt: string;
  endsAt: string;
  maxHp: number;
  hp: number;
  myDamage: number;
  myRank: number | null;
  myHitsToday: number;
  maxHitsToday: number;
  nextHitAt: string | null;
  top10: HalloweenBossRank[];
  serverNow: string;
  hitDamage?: number;
}

// This event never reads or writes local saves, player wallets or inventory.
// The RPC derives identity and bounded damage from the verified server session.
function decodeBossState(raw: unknown): HalloweenBossState {
  if (!raw || typeof raw !== 'object') throw new Error('halloween_boss_bad_response');
  const data = raw as Record<string, unknown>;
  const integer = (value: unknown) => Number.isSafeInteger(Number(value)) ? Math.max(0, Number(value)) : 0;
  if (!Array.isArray(data.top10)) throw new Error('halloween_boss_bad_response');
  return {
    active: data.active === true,
    startsAt: String(data.startsAt ?? ''),
    endsAt: String(data.endsAt ?? ''),
    hp: integer(data.hp),
    maxHp: integer(data.maxHp),
    myDamage: integer(data.myDamage),
    myRank: data.myRank == null ? null : integer(data.myRank),
    myHitsToday: integer(data.myHitsToday),
    maxHitsToday: integer(data.maxHitsToday),
    nextHitAt: typeof data.nextHitAt === 'string' ? data.nextHitAt : null,
    serverNow: String(data.serverNow ?? ''),
    hitDamage: data.hitDamage == null ? undefined : integer(data.hitDamage),
    top10: data.top10.slice(0, 10).map((row: Record<string, unknown>) => ({
      rank: integer(row.rank),
      name: String(row.name ?? 'Герой').slice(0, 32),
      damage: integer(row.damage),
    })),
  };
}

async function invokeBossRpc(name: 'territory_halloween_boss_state_v1' | 'territory_halloween_boss_attack_v1'): Promise<HalloweenBossState> {
  const { data, error } = await supabase.rpc(name);
  if (error) throw new Error(error.message);
  return decodeBossState(data);
}

export function getHalloweenBossState(): Promise<HalloweenBossState> {
  return invokeBossRpc('territory_halloween_boss_state_v1');
}

export function hitHalloweenBoss(): Promise<HalloweenBossState> {
  return invokeBossRpc('territory_halloween_boss_attack_v1');
}
