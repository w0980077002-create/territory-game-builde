import { createClient } from "npm:@supabase/supabase-js@2.57.4";

/**
 * Authenticated, server-bound Telegram Mini App share cards.
 * This function never awards tickets/stones or sends messages to anyone.
 * Only the user can confirm sending inside Telegram's native share sheet.
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const images = {
  ru: "https://w0980077002-create.github.io/territory-game-builde/promo/og-ru-v3.jpg",
  en: "https://w0980077002-create.github.io/territory-game-builde/promo/og-en-v3.jpg",
} as const;
const captions = {
  ru: "⚔️ TERRITORY — бои, сокровища и Монополия!\nСражайся на арене, развивай героя и вступай в кланы. Присоединяйся!",
  en: "⚔️ TERRITORY — battles, treasure and Monopoly!\nFight in the arena, grow your hero and join clans. Play with me!",
} as const;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const bearer = (request.headers.get("Authorization") ?? "").match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!bearer) return json({ error: "auth_required" }, 401);
    const { language } = await request.json().catch(() => ({}));
    if (language !== "ru" && language !== "en") return json({ error: "invalid_language" }, 400);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const token = (Deno.env.get("TELEGRAM_BOT_TOKEN") || Deno.env.get("BOT_TOKEN") || "").trim();
    if (!url || !anonKey || !serviceKey || !token) return json({ error: "service_not_configured" }, 503);
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await caller.auth.getUser(bearer);
    if (userError || !user) return json({ error: "auth_required" }, 401);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: player, error: playerError } = await admin.from("players")
      .select("telegram_id,banned").eq("id", user.id).maybeSingle();
    if (playerError || !player || player.banned ||
        !Number.isSafeInteger(Number(player.telegram_id)) || Number(player.telegram_id) < 1) {
      return json({ error: "verified_telegram_required" }, 403);
    }
    // Existing, authenticated referral RPC owns all referral attribution.
    const { data: referral, error: referralError } = await caller.rpc("territory_referral_status_v1");
    if (referralError || typeof referral?.code !== "string" ||
      !/^[a-f0-9]{14}$/.test(referral.code)) {
      return json({ error: "referral_unavailable" }, 503);
    }
    // Never trust a client-supplied bot name, deep-link or referral code.
    const botResp = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: "GET", signal: AbortSignal.timeout(7000),
    });
    const bot = await botResp.json();
    const username = bot?.result?.username;
    if (!botResp.ok || bot.ok !== true ||
        typeof username !== "string" || !/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
      return json({ error: "bot_unavailable" }, 503);
    }
    const refLink = `https://t.me/${username}?startapp=ref_${referral.code}`;
    const result = {
      type: "photo",
      id: crypto.randomUUID(),
      photo_url: images[language],
      thumbnail_url: images[language],
      photo_width: 1200,
      photo_height: 630,
      title: "TERRITORY",
      description: captions[language],
      caption: captions[language],
      reply_markup: { inline_keyboard: [[{
        text: language === "ru" ? "⚔️ Играть сейчас" : "⚔️ Play Now",
        url: refLink,
      }]] },
    };
    const answer = await fetch(`https://api.telegram.org/bot${token}/savePreparedInlineMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: Number(player.telegram_id),
        result,
        allow_user_chats: true,
        allow_group_chats: true,
        allow_channel_chats: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await answer.json().catch(() => null);
    if (!answer.ok || data?.ok !== true || typeof data?.result?.id !== "string" ||
        !data.result.id || data.result.id.length > 256) {
      // Never leak bot responses, tokens or internals to the browser.
      console.error("share-promo Telegram preparation failed", answer.status, data?.error_code);
      return json({ error: "prepared_share_unavailable" }, 503);
    }
    return json({ message_id: data.result.id });
  } catch {
    return json({ error: "prepared_share_unavailable" }, 503);
  }
});
