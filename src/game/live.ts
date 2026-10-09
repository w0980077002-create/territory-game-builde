import { useEffect } from 'react';
import { supabase } from './supabase';
import { create } from './store';
import { useGame } from './actions';
import { generateShopItems } from './engine';
import type { Equipment, GameState, InventoryItem } from './types';
import { setEquipmentLevel } from './equipmentBalance';

export interface GrantPayload {
  gold?: number;
  gems?: number;
  redGems?: number;
  stones?: number;
  forgeMaterials?: number;
  items?: Record<string, number>;
  equipLevels?: Partial<Record<Equipment['slot'], number>>;
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

function setLevel(eq: Equipment, level: number): Equipment {
  return setEquipmentLevel(eq, level);
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
    if (eq && level) equipped[slot] = setLevel(eq, level);
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

export async function claimMailGrant(id: string): Promise<boolean> {
  const payload = await claim(id);
  useLive.set((s) => ({ ...s, mail: s.mail.filter((m) => m.id !== id) }));
  if (!payload) return false;
  useGame.set(applyGrantPayload(useGame.get(), payload));
  return true;
}

interface HeartbeatGrant extends MailGrant {
  kind: 'adjust' | 'mail';
}

async function heartbeat() {
  const { data, error } = await supabase.rpc('player_heartbeat');
  if (error || !data || typeof data !== 'object') return;
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
}

export function useLiveSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    heartbeat();
    const t = setInterval(heartbeat, 20000);
    return () => clearInterval(t);
  }, [enabled]);
}

export async function fetchMaintenance(): Promise<boolean> {
  const { data } = await supabase.from('game_settings').select('maintenance').eq('id', 1).maybeSingle();
  return !!data?.maintenance;
}
