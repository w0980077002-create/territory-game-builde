import { useEffect } from 'react';
import { supabase } from './supabase';
import { create } from './store';
import { useGame } from './actions';
import { acceptMonopolyClaimReceipt, protectFortuneSave, releaseArenaRejectedAction, saveCloudSave } from './cloud';
import { generateShopItems } from './engine';
import type { Equipment, GameState, InventoryItem } from './types';
import { setAdminEquipmentLevel, capEquipmentToHeroLevel } from './equipmentBalance';
import { elixirExpiryTime, newElixirExpiry } from './elixirExpiry';

export interface GrantPayload {
  gold?: number;
  gems?: number;
  redGems?: number;
  stones?: number;
  forgeMaterials?: number;
  items?: Record<string, number>;
  equipLevels?: Partial<Record<Equipment['slot'], number>>;
  adminTestLevel?: boolean;
  adminTestGearId?: string;
  /** Canonical level and stats from the owner-authorized server transaction. */
  adminTestEquipment?: Equipment;
}

export interface MailGrant {
  id: string;
  subject: string;
  body: string;
  payload: GrantPayload;
  created_at: string;
}

export interface ClaimedMailGrant extends MailGrant {
  claimed_at: string;
}

/** Claimed letters stay in admin_grants. RLS only permits reading your own letters. */
export async function getClaimedMailHistory(offset = 0, pageSize = 30): Promise<{
  letters: ClaimedMailGrant[];
  hasMore: boolean;
}> {
  const start = Math.max(0, Math.floor(offset));
  const size = Math.max(1, Math.min(50, Math.floor(pageSize)));
  const { data, error } = await supabase.from('admin_grants')
    .select('id, subject, body, payload, created_at, claimed_at')
    .eq('kind', 'mail')
    .not('claimed_at', 'is', null)
    .order('claimed_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, start + size);
  if (error) throw new Error('mail_history_unavailable');
  const rows = (data ?? []).filter((row): row is ClaimedMailGrant =>
    typeof row.id === 'string' && typeof row.subject === 'string'
    && typeof row.body === 'string' && typeof row.claimed_at === 'string'
    && !!row.payload && typeof row.payload === 'object'
    && typeof row.created_at === 'string');
  return { letters: rows.slice(0, size), hasMore: rows.length > size };
}

interface LiveState {
  maintenance: boolean;
  shopSale: boolean;
  goldX2: boolean;
  banned: boolean;
  mail: MailGrant[];
}

export const useLive = create<LiveState>({ maintenance: false, shopSale: false, goldX2: false, banned: false, mail: [] });

export const SHOP_SALE_FACTOR = 0.8;

const nonNeg = (n: number) => Math.max(0, n);

function setLevel(eq: Equipment, level: number, heroLevel: number, ownerApproved = false): Equipment {
  const item = setAdminEquipmentLevel(eq, level);
  return ownerApproved ? { ...item, adminTestLevel: true } : capEquipmentToHeroLevel(item, heroLevel);
}

/** Legacy pure reward preview. Real admin grants must use the server-atomic
 * claim receipt below; never mint real rewards by applying this on the client. */
export function applyGrantPayload(state: GameState, p: GrantPayload): GameState {
  let battleStones = nonNeg(state.battleStones + (p.stones ?? 0));
  let inventory: InventoryItem[] = [...state.inventory];
  const shop = generateShopItems(1);

  for (const [id, qty] of Object.entries(p.items ?? {})) {
    const def = shop.find((s) => s.id === id);
    if (!def || !qty) continue;
    if (def.type === 'stone') {
      battleStones = nonNeg(battleStones + (def.amount ?? 1) * qty);
      continue;
    }
    if (def.type === 'elixir' || def.type === 'potion' || def.type === 'arena') {
      if (qty > 0) {
        inventory.push({
          id: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: def.name, icon: def.icon, type: def.type, rarity: def.rarity,
          qty, description: def.description, effect: def.effect, arenaEffect: def.arenaEffect,
          expiresAt: newElixirExpiry(),
        });
      } else {
        // Admin corrections remove the oldest matching stock first.
        let toRemove = -qty;
        for (const item of inventory.filter((i) => i.type === def.type && i.name === def.name)
          .sort((a, b) => elixirExpiryTime(a) - elixirExpiryTime(b))) {
          if (toRemove <= 0) break;
          const used = Math.min(item.qty, toRemove);
          inventory = inventory.map((i) => i.id === item.id ? { ...i, qty: i.qty - used } : i)
            .filter((i) => i.qty > 0);
          toRemove -= used;
        }
      }
      continue;
    }
    const existing = inventory.find((i) => i.name === def.name && i.type !== 'equipment');
    if (existing) {
      const nextQty = existing.qty + qty;
      inventory = nextQty > 0
        ? inventory.map((i) => (i.id === existing.id ? { ...i, qty: nextQty } : i))
        : inventory.filter((i) => i.id !== existing.id);
    } else if (qty > 0) {
      inventory.push({
        id: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: def.name,
        icon: def.icon,
        type: def.type as InventoryItem['type'],
        rarity: def.rarity,
        qty,
        description: def.description,
        effect: def.effect,
        arenaEffect: def.arenaEffect,
      });
    }
  }

  const equipped = { ...state.player.equipped };
  for (const [slot, level] of Object.entries(p.equipLevels ?? {}) as [Equipment['slot'], number][]) {
    const eq = equipped[slot];
    if (eq && level) {
      // A grant only carries the owner marker for the exact equipped item it authorized.
      // The server separately verifies the item ID and enforces its approved level.
      const ownerApproved = p.adminTestLevel === true && p.adminTestGearId === eq.id;
      const trusted = p.adminTestEquipment;
      equipped[slot] = ownerApproved && trusted?.id === eq.id
        && trusted.slot === slot && trusted.level === level
        && trusted.adminTestLevel === true
        ? trusted : setLevel(eq, level, state.player.level, ownerApproved);
    }
  }

  return {
    ...state,
    battleStones,
    inventory,
    forgeMaterials: nonNeg(state.forgeMaterials + (p.forgeMaterials ?? 0)),
    player: {
      ...state.player,
      gold: nonNeg(state.player.gold + (p.gold ?? 0)),
      gems: nonNeg(state.player.gems + (p.gems ?? 0)),
      redGems: nonNeg(state.player.redGems + (p.redGems ?? 0)),
      equipped,
    },
  };
}

type UncertainClaim = { id: string; userId: string; snapshot: GameState };
let uncertainClaim: UncertainClaim | null = null;
const claimedThisSession = new Set<string>();
const claimTasks = new Map<string, Promise<boolean>>();
let claimQueue: Promise<unknown> = Promise.resolve();

/** An SQL/PostgREST error means the claim transaction was rolled back.
 * Network timeouts are ambiguous and must NOT unlock stale local autosaves. */
const definiteRollback = (code: unknown): boolean =>
  typeof code === 'string' && /^(?:[0-9A-Z]{5}|PGRST\d+)$/.test(code);

/** One grant and one player save revision at a time, including automatic
 * adjustments and manually claimed inbox letters. We flush unsaved gameplay
 * before the RPC and only install the FULL verified server receipt. */
async function claimOnServer(id: string): Promise<boolean> {
  let identity;
  try {
    const result = await supabase.auth.getUser();
    if (result.error) return false;
    identity = result.data;
  } catch {
    return false;
  }
  const userId = identity.user?.id;
  if (!userId) return false;
  if (uncertainClaim && (uncertainClaim.id !== id || uncertainClaim.userId !== userId)) return false;

  if (!uncertainClaim) {
    const snapshot = useGame.get();
    try {
      if (!await saveCloudSave(userId, snapshot) || useGame.get() !== snapshot) return false;
    } catch {
      return false;
    }
    // Stop queued old writes before a server transaction can mint the reward.
    protectFortuneSave(userId);
    uncertainClaim = { id, userId, snapshot };
  }
  const guarded = uncertainClaim;
  if (useGame.get() !== guarded.snapshot) {
    // New local gameplay occurred while the request was uncertain. Never
    // discard it by replacing the game with an earlier server snapshot.
    console.warn('Admin grant requires a game reload before retrying');
    return false;
  }

  let response;
  try {
    response = await supabase.rpc('territory_admin_claim_grant_v2', { p_id: id });
  } catch {
    // An interrupted HTTP request may have committed on the server.
    return false;
  }
  const { data, error } = response;
  if (error) {
    if (definiteRollback(error.code)) {
      // A known rejected SQL transaction cannot have changed the save.
      releaseArenaRejectedAction(userId);
      uncertainClaim = null;
    }
    return false;
  }
  if (useGame.get() !== guarded.snapshot) {
    // The RPC may already have committed: retain the save fence, so later
    // client writes cannot overwrite the server-authoritative grant.
    console.warn('Admin grant committed while gameplay changed; reload required');
    return false;
  }
  try {
    const saved = acceptMonopolyClaimReceipt(userId, data);
    useGame.set(saved);
    claimedThisSession.add(id);
    useLive.set((s) => ({ ...s, mail: s.mail.filter((m) => m.id !== id) }));
    uncertainClaim = null;
    return true;
  } catch {
    // Invalid or stale receipts are NOT evidence of rollback.
    // The player must reload before any old queued snapshot can save.
    console.error('Admin grant returned an unverified receipt; reload required');
    return false;
  }
}

function claim(id: string): Promise<boolean> {
  if (!id) return Promise.resolve(false);
  if (claimedThisSession.has(id)) return Promise.resolve(true);
  const active = claimTasks.get(id);
  if (active) return active;
  const task = claimQueue.then(() => claimOnServer(id));
  claimQueue = task.then(() => undefined, () => undefined);
  claimTasks.set(id, task);
  void task.finally(() => { if (claimTasks.get(id) === task) claimTasks.delete(id); }).catch(() => {});
  return task;
}

export function claimMailGrant(id: string): Promise<boolean> {
  return claim(id);
}

interface HeartbeatGrant extends MailGrant {
  kind: 'adjust' | 'mail';
}

// Best-effort country attribution for owner analytics, independent of gameplay.
 // Never send an IP, user-provided country or locale. A missing Edge Function
 // must not affect the existing heartbeat, online detection or player rewards.
let lastGeographyPingAt = 0;
function pingGeography() {
  if (Date.now() - lastGeographyPingAt < 10 * 60_000) return;
  lastGeographyPingAt = Date.now();
  void supabase.functions.invoke('player-geography', { body: {} }).catch(() => {});
}

let heartbeatInFlight = false;
async function heartbeat() {
  // Slow mobile networks must not create overlapping heartbeat RPCs.
  if (heartbeatInFlight) return;
  heartbeatInFlight = true;
  try {
  const { data, error } = await supabase.rpc('player_heartbeat');
  if (error || !data || typeof data !== 'object') return;
  pingGeography();
  const hb = data as { banned?: boolean; settings?: { maintenance?: boolean; shop_sale?: boolean; gold_x2?: boolean }; grants?: HeartbeatGrant[] };
  const grants = Array.isArray(hb.grants) ? hb.grants : [];
  for (const g of grants.filter((g) => g.kind === 'adjust')) {
    if (!await claim(g.id)) break;
  }
  useLive.set({
    banned: !!hb.banned,
    maintenance: !!hb.settings?.maintenance,
    shopSale: !!hb.settings?.shop_sale,
    goldX2: !!hb.settings?.gold_x2,
    mail: grants.filter((g) => g.kind === 'mail' && !claimedThisSession.has(g.id)),
  });
  } finally {
    heartbeatInFlight = false;
  }
}

export function useLiveSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    // A hidden Mini App is not online. Stop spending database calls while
    // Telegram is backgrounded and resync mail, settings and grants on resume.
    const syncVisible = () => {
      if (document.visibilityState === 'visible') void heartbeat();
    };
    syncVisible();
    const t = window.setInterval(syncVisible, 20_000);
    document.addEventListener('visibilitychange', syncVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', syncVisible);
    };
  }, [enabled]);
}

export async function fetchMaintenance(): Promise<boolean> {
  const { data } = await supabase.from('game_settings').select('maintenance').eq('id', 1).maybeSingle();
  return !!data?.maintenance;
}
