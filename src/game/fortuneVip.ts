import { supabase } from './supabase';
import { useAccount } from './actions';

// Keep the legacy Fortune entitlement path active until the reviewed staged
// VIP ledger and public RPC have both been deployed and verified. No client
// callback, local storage, or unverified payment can grant a VIP tier.
const LEDGER_ENABLED = import.meta.env?.VITE_VIP_ENTITLEMENTS_ENABLED === 'true';

type ServerVipStatus = {
  vip: number;
  permanentVip: number;
  paidVip: number;
  giftVip: number;
  paidSpendCents: number;
  temporaryUntil: string | null;
  serverNow: number;
};

function tier(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10;
}

function parseSafeCents(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const cents = Number(value);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

/** Accept only a complete, server-owned VIP snapshot. Invalid replies never
 * downgrade a known legacy entitlement or manufacture a paid purchase. */
export function parseServerVipStatus(value: unknown): ServerVipStatus | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!tier(data.vip) || !tier(data.permanent_vip) || !tier(data.paid_vip)
    || !tier(data.gift_vip) || !tier(data.legacy_vip) || !tier(data.temporary_vip)
    || data.vip < data.permanent_vip
    || data.permanent_vip < Math.max(data.paid_vip, data.gift_vip, data.legacy_vip)
    || typeof data.server_now !== 'string') return null;
  const serverNow = Date.parse(data.server_now);
  const paidSpendCents = parseSafeCents(data.paid_spend_cents);
  const expires = data.temporary_until;
  if (!Number.isFinite(serverNow) || paidSpendCents === null
    || !(expires === null || (typeof expires === 'string' && Number.isFinite(Date.parse(expires)))))
    return null;
  return {
    vip: data.vip,
    permanentVip: data.permanent_vip,
    paidVip: data.paid_vip,
    giftVip: data.gift_vip,
    paidSpendCents,
    temporaryUntil: expires,
    serverNow,
  };
}

function fortuneExpiryAt(value: unknown, currentVip: number): number | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  // The old Fortune RPC never attests to paid or gift VIP. It may supply
  // an expiry only for a matching effective one-day Fortune VIP.
  if (!tier(data.vip) || data.vip !== currentVip
    || !tier(data.permanent_vip) || data.permanent_vip >= currentVip
    || typeof data.vip_until !== 'string') return null;
  const until = Date.parse(data.vip_until);
  return Number.isFinite(until) ? until : null;
}

/** Refresh both the profile and privilege store from protected server data.
 * Temporary tiers are bounded by their server expiry and rechecked every
 * minute/on WebView resume by App.tsx; VIP reward claims stay server-authorized.
 */
export async function refreshFortuneVip(): Promise<void> {
  if (LEDGER_ENABLED) {
    const [verified, fortune] = await Promise.all([
      supabase.rpc('territory_vip_entitlement_v1'),
      supabase.rpc('territory_fortune_entitlement_v1'),
    ]);
    if (verified.error) return;
    const status = parseServerVipStatus(verified.data);
    if (!status) return;
    let vipUntil: string | null = null;
    let vipRemaining = 0;
    if (status.vip > status.permanentVip) {
      const candidates = [
        status.temporaryUntil ? Date.parse(status.temporaryUntil) : null,
        fortune.error ? null : fortuneExpiryAt(fortune.data, status.vip),
      ].filter((v): v is number => v !== null && Number.isFinite(v));
      // A nonpermanent VIP without a trusted expiry cannot be cached as
      // permanent. Retain the last valid snapshot instead.
      const maxExpiry = candidates.length ? Math.max(...candidates) : 0;
      if (maxExpiry <= status.serverNow) return;
      vipRemaining = maxExpiry - status.serverNow;
      vipUntil = new Date(maxExpiry).toISOString();
    }
    useAccount.set({
      vip: status.vip,
      permanentVip: status.permanentVip,
      vipUntil,
      vipRemaining,
      vipCheckedAt: performance.now(),
      paidVip: status.paidVip,
      giftVip: status.giftVip,
      paidSpendCents: status.paidSpendCents,
      entitlementVerified: true,
    });
    return;
  }

  // Existing live path remains unchanged until the new server API is approved.
  const { data, error } = await supabase.rpc('territory_fortune_entitlement_v1');
  if (error || !data || !tier(data.vip) || !tier(data.permanent_vip)
    || !Number.isFinite(Date.parse(data.server_now))) return;
  useAccount.set({
    vip: data.vip,
    vipUntil: data.vip_until ?? null,
    permanentVip: data.permanent_vip,
    vipRemaining: data.vip_until
      ? Math.max(0, Date.parse(data.vip_until) - Date.parse(data.server_now)) : 0,
    vipCheckedAt: performance.now(),
    paidVip: 0,
    giftVip: 0,
    paidSpendCents: 0,
    entitlementVerified: false,
  });
}
