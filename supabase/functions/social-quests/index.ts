import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const targets = { chat: "@Territory_Chat", news: "@TerritoryNews" } as const;
type Task = keyof typeof targets;

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Only the real Telegram Bot API decides whether a member has joined.
// A link click, forged Telegram ID, or client-save edit never unlocks rewards.
async function checkMembership(token: string, task: Task, telegramId: number) {
  const res = await fetch("https://api.telegram.org/bot" + token + "/getChatMember", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: targets[task], user_id: telegramId }),
    signal: AbortSignal.timeout(8000),
  });
  const response = await res.json();
  if (!res.ok || response.ok !== true || !response.result?.status) {
    throw new Error("membership_check_unavailable");
  }
  const member = response.result;
  return ["creator", "administrator", "member"].includes(member.status)
    || (member.status === "restricted" && member.is_member === true);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  try {
    const bearer = (req.headers.get("Authorization") ?? "").match(/^Bearer (\S+)$/i)?.[1];
    if (!bearer) return respond({ error: "auth_required" }, 401);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !anonKey || !serviceKey) return respond({ error: "service_not_configured" }, 503);
    const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: { user }, error: authError } = await authClient.auth.getUser(bearer);
    if (authError || !user) return respond({ error: "auth_required" }, 401);
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: player, error: playerError } = await db.from("players")
      .select("telegram_id,banned").eq("id", user.id).maybeSingle();
    if (playerError || !player || player.banned || !Number.isSafeInteger(Number(player.telegram_id))
      || Number(player.telegram_id) < 1) {
      return respond({ error: "telegram_account_required" }, 403);
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return respond({ error: "invalid_request" }, 400);
    if (body.action === "status") {
      const { data, error } = await db.rpc("territory_social_status_v1", { p_player: user.id });
      if (error || !data || typeof data.chat !== "boolean" || typeof data.news !== "boolean")
        return respond({ error: "status_unavailable" }, 503);
      return respond({ claimed: { chat: data.chat, news: data.news } });
    }
    if (body.action !== "claim" || (body.task !== "chat" && body.task !== "news")
      || typeof body.expected !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(body.expected)) {
      return respond({ error: "invalid_request" }, 400);
    }
    const task = body.task as Task;
    const { data: existing, error: existingError } = await db.rpc("territory_social_status_v1", { p_player: user.id });
    if (existingError || !existing) return respond({ error: "status_unavailable" }, 503);
    if (existing[task] === true) return respond({ error: "already_claimed" }, 409);
    const botToken = (Deno.env.get("TELEGRAM_BOT_TOKEN") || Deno.env.get("BOT_TOKEN") || "").trim();
    if (!botToken) return respond({ error: "bot_token_not_configured" }, 503);
    let member = false;
    try {
      member = await checkMembership(botToken, task, Number(player.telegram_id));
    } catch {
      return respond({ error: "membership_check_unavailable" }, 503);
    }
    if (!member) return respond({ error: "not_subscribed" }, 403);
    const { data: receipt, error } = await db.rpc("territory_social_claim_v1", {
      p_player: user.id, p_task: task, p_expected: body.expected,
    });
    if (error) {
      const message = error.message ?? "";
      if (message.includes("social_already_claimed")) return respond({ error: "already_claimed" }, 409);
      if (message.includes("social_reload_required")) return respond({ error: "reload_required" }, 409);
      return respond({ error: "reward_unavailable" }, 503);
    }
    if (!receipt?.success) return respond({ error: "reward_unavailable" }, 503);
    return respond({ receipt });
  } catch {
    return respond({ error: "service_unavailable" }, 503);
  }
});
