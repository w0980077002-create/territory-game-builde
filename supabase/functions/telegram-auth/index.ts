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
    // Verified by Bot API. Expose only public bot username, never its token.
    if (req.method === "GET") {
      const token=(Deno.env.get("TELEGRAM_BOT_TOKEN") || Deno.env.get("BOT_TOKEN") || "").trim();
      if (!token) return resp({error:"bot_token_not_configured"},503);
      const check=await fetch("https://api.telegram.org/bot"+token+"/getMe");
      const result=await check.json().catch(()=>null);
      const username=result?.ok===true ? result.result?.username : null;
      if(typeof username!=="string" || !/^[a-zA-Z0-9_]{5,32}$/.test(username))
        return resp({error:"bot_name_unavailable"},503);
      return resp({bot_username:username},200);
    }
    if (req.method !== "POST") return resp({error:"method_not_allowed"},405);
    const { initData } = await req.json();
    if (!initData) return resp({ error: "missing_init_data" }, 400);

    const botToken = (Deno.env.get("TELEGRAM_BOT_TOKEN") || Deno.env.get("BOT_TOKEN") || "").trim();
    if (!botToken) return resp({ error: "bot_token_not_configured" }, 500);

    const tgUser = await verifyInitData(initData, botToken);
    if (!tgUser) return resp({ error: "invalid_init_data" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const fakeEmail = `tg_${tgUser.id}@territory.game`;

    // Find existing player by telegram_id
    const { data: existingPlayer, error: lookupError } = await adminClient
      .from("players")
      .select("id, display_name")
      .eq("telegram_id", tgUser.id)
      .maybeSingle();

    if (lookupError) return resp({ error: "player_lookup_failed" }, 500);

    let playerId: string;
    let userEmail: string;

    if (existingPlayer) {
      playerId = existingPlayer.id;

      // Fail closed: never mint a session for a fallback email or another UUID.
      const { data: authUserData, error: authLookupError } = await adminClient.auth.admin.getUserById(playerId);
      if (authLookupError || authUserData?.user?.id !== playerId || !authUserData.user.email) {
        return resp({ error: "linked_auth_user_unavailable" }, 409);
      }
      userEmail = authUserData.user.email;
    } else {
      // New player — create with Telegram name
      const displayName = tgUser.first_name || tgUser.username || "Герой";

      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email: fakeEmail,
        email_confirm: true,
      });

      // Do not adopt an existing auth account by synthetic email or overwrite a
      // character with upsert. Conflicts require explicit recovery of ownership.
      if (authError || !authData?.user) {
        return resp({ error: "auth_creation_conflict_or_failed" }, 409);
      }
      playerId = authData.user.id;
      userEmail = fakeEmail;

      const { error: playerError } = await adminClient.from("players").insert({
        id: playerId,
        telegram_id: tgUser.id,
        username: tgUser.username || null,
        photo_url: tgUser.photo_url || null,
        display_name: displayName,
      });

      if (playerError) {
        return resp({ error: "player_creation_failed", detail: playerError.message }, 500);
      }

      await adminClient.from("player_inventory").insert([
        {
          player_id: playerId,
          item_key: "starter_potion_hp",
          item_name: "Зелье здоровья",
          item_icon: "🧪",
          item_type: "potion",
          rarity: "common",
          quantity: 3,
        },
      ]);
    }

    // The start_param is included in HMAC-verified Telegram initData.
    // A client-supplied query string or start_param on an existing account
    // cannot create referral rewards. Retry is safe within the 20-minute gate.
    const signedStartParam = new URLSearchParams(initData).get("start_param") || "";
    if (/^ref_[0-9a-f]{14}$/.test(signedStartParam)) {
      const {error: referralError}=await adminClient.rpc("territory_referral_attach_v1",{
        p_invited:playerId,p_code:signedStartParam,
      });
      // Never break verified Telegram login because of referral setup.
      if(referralError) console.error("Referral attachment unavailable",referralError.message);
    }

    // Generate a one-time magic link token (no password, no email sent)
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: userEmail,
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      return resp({ error: "link_generation_failed", detail: linkError?.message }, 500);
    }

    // Exchange the token for a session
    const { data: verifyData, error: verifyError } = await anonClient.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    });

    if (verifyError || !verifyData.session) {
      return resp({ error: "session_creation_failed", detail: verifyError?.message }, 500);
    }

    if (verifyData.session.user.id !== playerId) {
      return resp({ error: "session_identity_mismatch" }, 409);
    }

    // Credit only a REAL second-day Telegram login with fresh HMAC-signed
    // auth_date. Browser status calls and replayed old sessions cannot earn gifts.
    const signedAuthDate = Number(new URLSearchParams(initData).get("auth_date"));
    if (Number.isSafeInteger(signedAuthDate)) {
      const {error: qualifiedError}=await adminClient.rpc("territory_referral_qualify_v1",{
        p_invited:playerId,p_telegram_id:tgUser.id,p_auth_date:signedAuthDate,
      });
      if (qualifiedError) console.error("Referral qualification unavailable",qualifiedError.message);
    }

    return resp({
      success: true,
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
      expires_at: verifyData.session.expires_at,
      user: {
        id: playerId,
        telegram_id: tgUser.id,
        username: tgUser.username,
        first_name: tgUser.first_name,
        photo_url: tgUser.photo_url,
      },
    }, 200);
  } catch (err) {
    return resp({ error: "server_error", detail: String(err) }, 500);
  }
});
