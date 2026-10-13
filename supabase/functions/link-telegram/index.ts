import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

const MAX_INIT_DATA_AGE_S = 7 * 24 * 60 * 60;

function resp(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function verifyInitData(initData: string, botToken: string): Promise<TelegramUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  const dataCheckArr: string[] = [];
  for (const key of Array.from(params.keys()).sort()) {
    if (key === "hash") continue;
    dataCheckArr.push(`${key}=${params.get(key)}`);
  }
  const dataCheckString = dataCheckArr.join("\n");

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw", encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const secretKeyResult = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(botToken));

  const hmacKey = await crypto.subtle.importKey(
    "raw", secretKeyResult,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const calculatedHashBuffer = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(dataCheckString));
  const calculatedHash = Array.from(new Uint8Array(calculatedHashBuffer))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  if (calculatedHash !== hash) return null;

  const authDate = Number(params.get("auth_date"));
  const age = Date.now() / 1000 - authDate;
  if (!Number.isFinite(authDate) || age < -60 || age > MAX_INIT_DATA_AGE_S) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  const user = JSON.parse(userJson) as TelegramUser;
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) return null;
  return user;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return resp({ error: "not_authenticated" }, 401);
    }

    const { initData } = await req.json();
    if (!initData) {
      return resp({ error: "missing_init_data" }, 400);
    }

    const botToken = (Deno.env.get("TELEGRAM_BOT_TOKEN") || Deno.env.get("BOT_TOKEN") || "").trim();
    if (!botToken) {
      return resp({ error: "bot_token_not_configured" }, 500);
    }

    const tgUser = await verifyInitData(initData, botToken);
    if (!tgUser) {
      return resp({ error: "invalid_init_data" }, 401);
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if this Telegram ID is already linked to a different player
    const { data: existingTg, error: tgLookupError } = await adminClient
      .from("players")
      .select("id, display_name")
      .eq("telegram_id", tgUser.id)
      .maybeSingle();

    if (tgLookupError) return resp({ error: "telegram_lookup_failed" }, 500);

    if (existingTg && existingTg.id !== user.id) {
      return resp({ error: "telegram_already_linked", name: existingTg.display_name }, 409);
    }


    // Never take over a previously linked character with a different Telegram ID.
    const { data: ownerPlayer, error: playerLookupError } = await adminClient
      .from("players").select("id, telegram_id").eq("id", user.id).maybeSingle();
    if (playerLookupError || !ownerPlayer) return resp({ error: "player_not_found" }, 404);
    if (ownerPlayer.telegram_id !== null && String(ownerPlayer.telegram_id) !== String(tgUser.id)) {
      return resp({ error: "player_already_linked_to_other_telegram" }, 409);
    }

    // The login endpoint retrieves email by the linked UUID; changing auth
    // email is unnecessary. Keep the existing auth identity and credentials.
    if (ownerPlayer.telegram_id === null) {
      const { data: linked, error: playerErr } = await adminClient.from("players")
        .update({
          telegram_id: tgUser.id,
          username: tgUser.username || null,
          photo_url: tgUser.photo_url || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)
        .is("telegram_id", null)
        .select("id")
        .maybeSingle();
      // Unique telegram_id plus compare-and-set rejects concurrent claims.
      if (playerErr || !linked) return resp({ error: "link_conflict_or_update_failed" }, 409);
    }

    return resp({
      success: true,
      telegram_id: tgUser.id,
      username: tgUser.username,
      photo_url: tgUser.photo_url,
    }, 200);
  } catch (err) {
    return resp({ error: "server_error", detail: String(err) }, 500);
  }
});
