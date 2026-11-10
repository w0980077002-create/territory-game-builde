// Owner-only publisher for Telegram channel @TerritoryNews.
// Uses the existing 12-hour signed admin session from admin-api, not a public player token.
// This function never accepts arbitrary chat_id. No player data or game-state writes.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey, X-Client-Info",
};
const CHANNEL = "@TerritoryNews";

function reply(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function formatInline(line: string): string {
  return escapeText(line)
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<u>$1</u>")
    .replace(/\*([^*\n]+)\*/g, "<i>$1</i>")
    .replace(/_([^_\n]+)_/g, "<i>$1</i>");
}
function toTelegramHtml(raw: string): string {
  const output: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (quote.length) output.push("<blockquote>" + quote.join("\n") + "</blockquote>");
    quote = [];
  };
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("> ")) quote.push(formatInline(line.slice(2)));
    else { flush(); output.push(formatInline(line)); }
  }
  flush();
  return output.join("\n");
}
async function verifyOwner(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || token.length < 30 || token.length > 500) return false;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return false;
  try {
    const response = await fetch(url + "/functions/v1/admin-api", {
      method: "POST",
      headers: { "Content-Type": "application/json", Apikey: key, Authorization: "Bearer " + key },
      body: JSON.stringify({ action: "verify", token }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.json();
    return response.ok && body?.ok === true;
  } catch { return false; }
}
function botToken(): string {
  return (Deno.env.get("TELEGRAM_BOT_TOKEN") || Deno.env.get("BOT_TOKEN") || "").trim();
}
async function telegram(token: string, method: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(12000),
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok || parsed?.ok !== true) throw new Error("telegram_" + method + "_failed");
  return parsed?.result ?? {};
}
async function publisherStatus(token: string): Promise<boolean> {
  try {
    const bot = await telegram(token, "getMe", {});
    if (typeof bot.id !== "number") return false;
    const member = await telegram(token, "getChatMember", { chat_id: CHANNEL, user_id: bot.id });
    return member.status === "administrator" && member.can_post_messages === true;
  } catch { return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body))
    return reply({ error: "invalid_request" }, 400);
  if (!await verifyOwner(body.token)) return reply({ error: "admin_session_required" }, 403);
  const action = body.action;
  const token = botToken();

  if (action === "status") {
    return reply({ configured: token.length > 0, ready: token.length > 0 && await publisherStatus(token),
      channel: CHANNEL });
  }
  if (action !== "publish" || body.confirm !== true || typeof body.message !== "string")
    return reply({ error: "invalid_request" }, 400);
  if (!token) return reply({ error: "bot_token_not_configured" }, 503);
  const message: string = body.message.trim();
  if (message.length < 10 || message.length > 3500)
    return reply({ error: "invalid_post_length" }, 400);
  // Territory is international. Avoid a city-specific time-zone label in announcements.
  if (/киев|київ|kiev|kyiv/iu.test(message))
    return reply({ error: "city_time_reference_not_allowed" }, 400);
  const html = toTelegramHtml(message);
  try {
    const result = await telegram(token, "sendMessage", {
      chat_id: CHANNEL, text: html, parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    return reply({ ok: true, channel: CHANNEL, messageId: result.message_id ?? null });
  } catch {
    return reply({ error: "telegram_post_failed_check_bot_admin_rights" }, 503);
  }
});
