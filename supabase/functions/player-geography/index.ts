import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Deliberately records only a two-letter country, not the IP, city or coordinates.
// This endpoint uses the platform's Cloudflare geolocation header, never a user-supplied body.
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

  // Cloudflare passes this to the Supabase Edge gateway. Never fall back to
  // a country from JSON, Telegram language, client locale or X-Forwarded-For.
  const country = (req.headers.get("cf-ipcountry") ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || country === "XX") {
    return Response.json({ recorded: false, reason: "country_unavailable" }, { headers: cors });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.rpc("territory_geo_record_v1", { p_player: user.id, p_country: country });
  if (error) {
    console.error("player-geography: country save unavailable", error.code);
    return Response.json({ error: "geography_storage_unavailable" }, { status: 503, headers: cors });
  }
  return Response.json({ recorded: true }, { headers: cors });
});
