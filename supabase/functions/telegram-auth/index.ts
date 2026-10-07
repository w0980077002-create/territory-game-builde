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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { initData } = await req.json();

    if (!initData) {
      return new Response(
        JSON.stringify({ error: "missing_init_data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const botToken = Deno.env.get("BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      return new Response(
        JSON.stringify({ error: "bot_token_not_configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse initData string
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) {
      return new Response(
        JSON.stringify({ error: "invalid_init_data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build data-check string: sort keys alphabetically, exclude hash
    const dataCheckArr: string[] = [];
    const sortedKeys = Array.from(params.keys()).sort();
    for (const key of sortedKeys) {
      if (key === "hash") continue;
      dataCheckArr.push(`${key}=${params.get(key)}`);
    }
    const dataCheckString = dataCheckArr.join("\n");

    // HMAC-SHA256 of bot_token with "WebAppData" as key
    const encoder = new TextEncoder();
    const secretKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const secretKeyResult = await crypto.subtle.sign(
      "HMAC",
      secretKey,
      encoder.encode(botToken)
    );

    // HMAC-SHA256 of dataCheckString with secretKey
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      secretKeyResult,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const calculatedHashBuffer = await crypto.subtle.sign(
      "HMAC",
      hmacKey,
      encoder.encode(dataCheckString)
    );

    const calculatedHash = Array.from(new Uint8Array(calculatedHashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (calculatedHash !== hash) {
      return new Response(
        JSON.stringify({ error: "invalid_hash" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract user data
    const userJson = params.get("user");
    if (!userJson) {
      return new Response(
        JSON.stringify({ error: "no_user_data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tgUser: TelegramUser = JSON.parse(userJson);

    // Create Supabase admin client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const fakeEmail = `tg_${tgUser.id}@territory.game`;
    const displayName = tgUser.first_name || tgUser.username || "Герой";

    // Check if player exists by telegram_id
    const { data: existingPlayer } = await supabase
      .from("players")
      .select("id")
      .eq("telegram_id", tgUser.id)
      .maybeSingle();

    let playerId: string;

    if (existingPlayer) {
      playerId = existingPlayer.id;
      await supabase
        .from("players")
        .update({
          username: tgUser.username || null,
          photo_url: tgUser.photo_url || null,
          display_name: displayName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", playerId);
    } else {
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: fakeEmail,
        password: `Tg${tgUser.id}_${Date.now()}!`,
        email_confirm: true,
      });

      if (authError) {
        if (authError.message.includes("already")) {
          const { data: listData } = await supabase.auth.admin.listUsers();
          const found = listData?.users?.find((u) => u.email === fakeEmail);
          if (!found) {
            return new Response(
              JSON.stringify({ error: "auth_user_not_found" }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          playerId = found.id;
        } else {
          return new Response(
            JSON.stringify({ error: "auth_creation_failed", detail: authError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        playerId = authData.user.id;
      }

      // Create player record
      const { error: playerError } = await supabase.from("players").upsert({
        id: playerId,
        telegram_id: tgUser.id,
        username: tgUser.username || null,
        photo_url: tgUser.photo_url || null,
        display_name: displayName,
      });

      if (playerError) {
        return new Response(
          JSON.stringify({ error: "player_creation_failed", detail: playerError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Give starting items
      await supabase.from("player_inventory").insert([
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

    // Generate access token for the user
    // We'll sign in with the fake email to get a proper session
    // Since we set the password, we can't recover it. Instead, use admin to issue a token.
    // Use Supabase admin generate link to get a token URL, extract token
    // Simpler: return player ID and use a custom token approach

    // Actually the cleanest way: we store the password deterministically
    // and use signInWithPassword on the frontend. But the password was random.
    // Let's reset the password to a deterministic value based on telegram_id
    const deterministicPassword = `TgBot_${tgUser.id}_${botToken.slice(-8)}!`;

    const { error: resetError } = await supabase.auth.admin.updateUserById(
      playerId,
      { password: deterministicPassword }
    );

    if (resetError) {
      return new Response(
        JSON.stringify({ error: "password_reset_failed", detail: resetError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sign in with the deterministic password to get a session
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: fakeEmail,
      password: deterministicPassword,
    });

    if (signInError || !signInData.session) {
      return new Response(
        JSON.stringify({ error: "signin_failed", detail: signInError?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        expires_at: signInData.session.expires_at,
        user: {
          id: playerId,
          telegram_id: tgUser.id,
          username: tgUser.username,
          first_name: tgUser.first_name,
          photo_url: tgUser.photo_url,
          display_name: displayName,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "server_error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
