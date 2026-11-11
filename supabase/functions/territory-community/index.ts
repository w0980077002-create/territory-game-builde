import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { classifyMessage, formatAlert, messageLink, messageText } from "./rules.mjs";

const TABLE = "territory_community_inbox";
const ok = (body = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const env = (name: string) => (Deno.env.get(name) || "").trim();
const numberId = (name: string) => {
  const n = Number(env(name));
  return Number.isSafeInteger(n) && n !== 0 ? n : null;
};

async function sendMessage(token: string, chatId: number, text: string) {
  // Token is never printed, reflected or committed.
  const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
    signal: AbortSignal.timeout(12000)
  });
  const reply = await response.json().catch(() => null);
  if (!response.ok || reply?.ok !== true) throw new Error("telegram_send_failed");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return ok({ error: "method_not_allowed" }, 405);
  const secret = env("TERRITORY_COMMUNITY_WEBHOOK_SECRET");
  if (!secret || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret)
    return ok({ error: "forbidden" }, 403);
  if (Number(req.headers.get("content-length") || 0) > 120000)
    return ok({ error: "payload_too_large" }, 413);

  const token = env("TERRITORY_COMMUNITY_BOT_TOKEN");
  const ownerId = numberId("TERRITORY_COMMUNITY_OWNER_ID");
  if (!token) return ok({ error: "not_configured" }, 503);

  const update = await req.json().catch(() => null);
  if (!update || !Number.isSafeInteger(update.update_id)) return ok({ error: "bad_update" }, 400);
  const edited = Boolean(update.edited_message);
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat || !Number.isSafeInteger(msg.chat.id) || !Number.isSafeInteger(msg.message_id))
    return ok();

  // Safe onboarding: /start gives the sender their own ID. Never discloses secrets.
  if (msg.chat.type === "private") {
    const text = messageText(msg);
    if (/^\/(start|myid)(?:@\w+)?(?:\s|$)/i.test(text)) {
      await sendMessage(token, msg.chat.id,
        "TERRITORY AI. Ваш Telegram ID: " + msg.chat.id +
        "\nДля получения уведомлений владелец должен добавить этот ID в защищённые настройки.");
    }
    return ok();
  }

  if (!["group", "supergroup"].includes(msg.chat.type)) return ok();
  const body = messageText(msg);

  // A command from the configured owner reveals the group ID in their private chat.
  if (/^\/chatid(?:@\w+)?(?:\s|$)/i.test(body)) {
    if (ownerId && msg.from?.id === ownerId) {
      try {
        await sendMessage(token, ownerId, "TERRITORY AI. ID чата: " + msg.chat.id);
      } catch {
        return ok({ error: "owner_start_required" }, 503);
      }
    }
    return ok();
  }

  const groupId = numberId("TERRITORY_COMMUNITY_CHAT_ID");
  if (env("TERRITORY_COMMUNITY_ENABLED") !== "true" || !groupId || msg.chat.id !== groupId)
    return ok();
  if (!body) return ok(); // No AI/OCR/media extraction in this isolated MVP.
  const url = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey || !ownerId) return ok({ error: "not_configured" }, 503);

  const analysis = classifyMessage(body);
  const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const record = {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    sender_id: Number.isSafeInteger(msg.from?.id) ? msg.from.id : null,
    sender_username: typeof msg.from?.username === "string" ? msg.from.username.slice(0, 64) : null,
    message_text: body,
    message_url: messageLink(msg.chat, msg.message_id),
    category: analysis.category,
    priority: analysis.priority,
    updated_at: new Date().toISOString()
  };
  if (edited) {
    // Keep the latest text; avoid duplicate alerts on edits.
    const { error } = await db.from(TABLE).upsert(record, { onConflict: "chat_id,message_id" });
    return error ? ok({ error: "storage_unavailable" }, 503) : ok();
  }

  const { error: insertError } = await db.from(TABLE).insert(record);
  if (insertError && insertError.code !== "23505")
    return ok({ error: "storage_unavailable" }, 503);

  if (analysis.priority !== "P0") return ok();
  if (insertError?.code === "23505") {
    const { data, error } = await db.from(TABLE).select("alert_sent_at")
      .eq("chat_id", msg.chat.id).eq("message_id", msg.message_id).maybeSingle();
    if (error || !data) return ok({ error: "storage_unavailable" }, 503);
    if (data.alert_sent_at) return ok();
  }
  try {
    await sendMessage(token, ownerId, formatAlert(msg, analysis, record.message_url));
  } catch {
    // Retryable: next Telegram delivery will re-attempt if alert_sent_at remains null.
    return ok({ error: "alert_send_failed" }, 503);
  }
  const { error: markError } = await db.from(TABLE).update({ alert_sent_at: new Date().toISOString() })
    .eq("chat_id", msg.chat.id).eq("message_id", msg.message_id);
  return markError ? ok({ error: "alert_mark_failed" }, 503) : ok();
});
