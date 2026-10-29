import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Deliberately records only a two-letter country, not the IP, city or coordinates.
// Uses verified edge country or Cloudflare client IP with a free country-only lookup.\n// Does not store IP, location history or coordinates, and never accepts client-supplied country.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: cors });

  const bearer = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(bearer)?.[1];
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const auth = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error: authError } = await auth.auth.getUser(token);
  if (authError || !user) return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });

  // Hosted Supabase's Cloudflare gateway records cf-ipcountry in its logs,
  // but does NOT forward it to this Deno runtime (verified in live logs).
  // Prefer a trusted platform country code if one becomes available.
  const gatewayCountry = (req as Request & { cf?: { country?: string } }).cf?.country;
  const validCountry = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Z]{2}$/.test(value) && !["XX", "T1"].includes(value);
  let country = (req.headers.get("cf-ipcountry") ?? gatewayCountry ?? "").toUpperCase();
  let method = "gateway";

  if (!validCountry(country)) {
    // Cloudflare overwrites CF-Connecting-IP on the official Supabase domain.
    // Do not use X-Forwarded-For or any IP/country from the request body.
    // Query a free country-only provider over HTTPS and never store or log the IP.
    const clientIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
    if (/^[0-9a-fA-F:.]{3,45}$/.test(clientIp)) {
      try {
        const lookup = await fetch(`https://api.country.is/${encodeURIComponent(clientIp)}`, {
          signal: AbortSignal.timeout(3000),
          headers: { "Accept": "application/json" },
        });
        if (lookup.ok) {
          const result = await lookup.json() as { country?: unknown };
          const candidate = typeof result.country === "string" ? result.country.toUpperCase() : "";
          if (validCountry(candidate)) {
            country = candidate;
            method = "trusted_ip_country";
          }
        }
      } catch {
        // The free provider is best-effort; gameplay and heartbeat must not fail.
      }
    }
    if (!validCountry(country)) {
      console.info("player-geography: country unavailable", {
        trustedIpPresent: !!clientIp,
        headerCountryPresent: !!req.headers.get("cf-ipcountry"),
        runtimeCountryPresent: !!gatewayCountry,
      });
      return Response.json({ recorded: false, reason: "country_unavailable" }, { headers: cors });
    }
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.rpc("territory_geo_record_v1", { p_player: user.id, p_country: country });
  if (error) {
    console.error("player-geography: country save unavailable", error.code);
    return Response.json({ error: "geography_storage_unavailable" }, { status: 503, headers: cors });
  }
  console.info('player-geography: country saved', { method });
  return Response.json({ recorded: true }, { headers: cors });
});
