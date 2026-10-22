import { useEffect } from 'react';
import { supabase } from './supabase';
import { create } from './store';
import { useGame } from './actions';
import { generateShopItems } from './engine';
import type { Equipment, GameState, InventoryItem } from './types';
import { setAdminEquipmentLevel, capEquipmentToHeroLevel } from './equipmentBalance';

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

async function claim(id: string): Promise<GrantPayload | null> {
  const { data, error } = await supabase.rpc('claim_admin_grant', { p_id: id });
  if (error || !data || typeof data !== 'object') return null;
  return data as GrantPayload;
}

// Ignore overlapping button taps in this tab. The backend claim is atomic,
// but the UI must never silently remove a letter after a failed request.
const grantClaimsInFlight = new Set<string>();
export async function claimMailGrant(id: string): Promise<boolean> {
  if (!id || grantClaimsInFlight.has(id)) return false;
  grantClaimsInFlight.add(id);
  try {
    const payload = await claim(id);
    if (!payload) return false;
    useGame.set(applyGrantPayload(useGame.get(), payload));
    useLive.set((s) => ({ ...s, mail: s.mail.filter((m) => m.id !== id) }));
    return true;
  } finally {
    grantClaimsInFlight.delete(id);
  }
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
    const payload = await claim(g.id);
    if (payload) useGame.set(applyGrantPayload(useGame.get(), payload));
  }
  useLive.set({
    banned: !!hb.banned,
    maintenance: !!hb.settings?.maintenance,
    shopSale: !!hb.settings?.shop_sale,
    goldX2: !!hb.settings?.gold_x2,
    mail: grants.filter((g) => g.kind === 'mail'),
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
