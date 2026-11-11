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

type CommunityControl = {
  owner_telegram_id: number;
  group_chat_id: number | null;
  enabled: boolean;
};

function communityDb() {
  const url = env("SUPABASE_URL");
  let key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    try { key = JSON.parse(env("SUPABASE_SECRET_KEYS"))?.default || ""; }
    catch { /* no usable secret */ }
  }
  if (!url || !key) throw new Error("community_db_not_configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function readControl(db: ReturnType<typeof communityDb>): Promise<CommunityControl> {
  const { data, error } = await db.from("territory_community_control")
    .select("owner_telegram_id,group_chat_id,enabled")
    .eq("singleton", 1).maybeSingle();
  if (error || !data || !Number.isSafeInteger(Number(data.owner_telegram_id)))
    throw new Error("community_control_missing");
  return {
    owner_telegram_id: Number(data.owner_telegram_id),
    group_chat_id: data.group_chat_id == null ? null : Number(data.group_chat_id),
    enabled: data.enabled === true
  };
}

async function updateControl(db: ReturnType<typeof communityDb>, patch: Record<string, unknown>) {
  const { data, error } = await db.from("territory_community_control")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("singleton", 1).select("singleton").maybeSingle();
  if (error || !data) throw new Error("community_control_update_failed");
}


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

async function botApi(token: string, method: string, payload: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000)
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok || parsed?.ok !== true) throw new Error("telegram_" + method + "_failed");
  return parsed.result as Record<string, any>;
}

// Webhook credential never leaves the server. Derive it from a privileged,
// server-injected key plus the independent community token; never derive from
// the bot token alone or copy the game's existing TELEGRAM_BOT_TOKEN.
async function webhookSecret(token: string): Promise<string | null> {
  const manuallyConfigured = env("TERRITORY_COMMUNITY_WEBHOOK_SECRET");
  if (manuallyConfigured) return manuallyConfigured;
  let root = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!root) {
    try { root = JSON.parse(env("SUPABASE_SECRET_KEYS"))?.default || ""; }
    catch { return null; }
  }
  if (!root) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(root),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key,
    encoder.encode("TERRITORY-COMMUNITY-WEBHOOK-V1:" + token));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// This endpoint can only ever register the known community bot to this fixed
// first-party Supabase function URL. No arbitrary target URL, token or method
// is accepted from callers. It does not enable group collection by itself.
async function connectWebhook(token: string, secret: string) {
  const me = await botApi(token, "getMe");
  if (String(me.username || "").toLowerCase() !== "territorygameai_bot")
    throw new Error("unexpected_bot_username");
  const endpoint = env("SUPABASE_URL") + "/functions/v1/territory-community";
  const info = await botApi(token, "getWebhookInfo");
  if (info.url !== endpoint) {
    await botApi(token, "setWebhook", {
      url: endpoint,
      secret_token: secret,
      allowed_updates: ["message", "edited_message"],
      drop_pending_updates: false,
      max_connections: 5
    });
  }
  const verify = await botApi(token, "getWebhookInfo");
  if (verify.url !== endpoint) throw new Error("webhook_not_active");
  const control = await readControl(communityDb());
  return { bot: me.username, webhook_active: true,
    pending_updates: Number(verify.pending_update_count || 0),
    owner_id_configured: Boolean(control.owner_telegram_id),
    group_id_configured: Boolean(control.group_chat_id),
    collecting: control.enabled && Boolean(control.group_chat_id) };
}

Deno.serve(async (req: Request) => {
  const token = env("TERRITORY_COMMUNITY_BOT_TOKEN");
  if (!token) return ok({ error: "bot_token_missing" }, 503);
  // Safe, fixed-destination bootstrap (no Telegram token or webhook secret
  // is exposed in the response). A browser can open /connect once after the
  // bot token was saved in Supabase Secrets.
  if (req.method === "GET") {
    const pathname = new URL(req.url).pathname;
    if (!pathname.endsWith("/connect")) return ok({ error: "not_found" }, 404);
    const secret = await webhookSecret(token);
    if (!secret) return ok({ error: "server_secret_missing" }, 503);
    try { return ok(await connectWebhook(token, secret)); }
    catch { return ok({ error: "telegram_connect_failed" }, 502); }
  }
  if (req.method !== "POST") return ok({ error: "method_not_allowed" }, 405);
  const secret = await webhookSecret(token);
  if (!secret || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret)
    return ok({ error: "forbidden" }, 403);
  if (Number(req.headers.get("content-length") || 0) > 120000)
    return ok({ error: "payload_too_large" }, 413);

  let db: ReturnType<typeof communityDb>;
  let control: CommunityControl;
  try {
    db = communityDb();
    control = await readControl(db);
  } catch {
    return ok({ error: "community_control_not_configured" }, 503);
  }
  const ownerId = control.owner_telegram_id;

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

  // Only this Telegram-authenticated owner can select the group.
  // Selecting is NOT enabling: member notice is sent only on explicit /enable.
  if (/^\/chatid(?:@\w+)?(?:\s|$)/i.test(body)) {
    if (msg.from?.id !== ownerId) return ok();
    try {
      await updateControl(db, { group_chat_id: msg.chat.id, enabled: false });
      await sendMessage(token, ownerId,
        "✅ TERRITORY AI. Группа выбрана: " + (msg.chat.title || "чат") +
        "\nID: " + msg.chat.id +
        "\nДля старта мониторинга отправьте /enable в этой группе. Перед включением бот уведомит всех участников.");
    } catch {
      return ok({ error: "group_selection_failed" }, 503);
    }
    return ok();
  }

  if (/^\/enable(?:@\w+)?(?:\s|$)/i.test(body)) {
    if (msg.from?.id !== ownerId || control.group_chat_id !== msg.chat.id) return ok();
    if (control.enabled) return ok();
    try {
      await sendMessage(token, msg.chat.id,
        "📣 TERRITORY AI подключён для поддержки игроков. Новые текстовые сообщения в этом чате будут автоматически анализироваться для выявления ошибок и предложений. Срочные жалобы получит владелец. Данные хранятся до 30 дней. Бот не модерирует переписку. \n🇬🇧 TERRITORY AI now monitors new text messages for bugs and feedback. Data is deleted after 30 days.");
      await updateControl(db, { enabled: true });
      await sendMessage(token, ownerId, "✅ TERRITORY AI: мониторинг группы включён. Для остановки напишите /disable в группе.");
    } catch {
      return ok({ error: "monitoring_enable_failed" }, 503);
    }
    return ok();
  }
  if (/^\/disable(?:@\w+)?(?:\s|$)/i.test(body)) {
    if (msg.from?.id !== ownerId || control.group_chat_id !== msg.chat.id) return ok();
    try {
      await updateControl(db, { enabled: false });
      await sendMessage(token, ownerId, "⏸ TERRITORY AI: мониторинг группы остановлен.");
    } catch {
      return ok({ error: "monitoring_disable_failed" }, 503);
    }
    return ok();
  }

  if (!control.enabled || control.group_chat_id !== msg.chat.id) return ok();
  if (!body || msg.from?.is_bot) return ok(); // No AI/OCR/media extraction in this MVP.

  const analysis = classifyMessage(body);
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
