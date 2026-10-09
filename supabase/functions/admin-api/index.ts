import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_LOGIN = "owner";
const ADMIN_PASSWORD = "W2257700";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 8;

const RESOURCE_KEYS = ["gold", "gems", "redGems", "stones", "forgeMaterials"] as const;
const ITEM_KEYS = [
  "shop_stone_5", "shop_potion_hp", "shop_potion_hp_large", "shop_elixir_atk",
  "shop_elixir_def", "shop_elixir_crit", "shop_arena_time", "shop_arena_adrenaline",
] as const;
const SLOTS = ["helmet", "amulet", "armor", "weapon", "shield", "ring", "boots"] as const;
const SETTING_KEYS = ["maintenance", "arena_bots_enabled", "shop_sale", "gold_x2"] as const;
const MAX_DELTA = 10_000_000;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const enc = new TextEncoder();

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function sign(data: string) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! + ":admin"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function issueToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return { token: `${exp}.${await sign(exp)}`, expiresAt: Number(exp) };
}

async function verifyToken(token: unknown) {
  if (typeof token !== "string") return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await sign(exp));
}

async function audit(action: string, details: Record<string, unknown> = {}) {
  await db.from("admin_audit_log").insert({ action, details });
}

function intIn(v: unknown, min: number, max: number) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, "invalid_number");
  return n;
}

function cleanPayload(raw: unknown) {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of RESOURCE_KEYS) {
    if (src[k] !== undefined && src[k] !== 0) out[k] = intIn(src[k], -MAX_DELTA, MAX_DELTA);
  }
  const items = (src.items && typeof src.items === "object" ? src.items : {}) as Record<string, unknown>;
  const cleanItems: Record<string, number> = {};
  for (const k of ITEM_KEYS) {
    if (items[k] !== undefined && items[k] !== 0) cleanItems[k] = intIn(items[k], -100_000, 100_000);
  }
  if (Object.keys(cleanItems).length) out.items = cleanItems;
  const levels = (src.equipLevels && typeof src.equipLevels === "object" ? src.equipLevels : {}) as Record<string, unknown>;
  const cleanLevels: Record<string, number> = {};
  for (const s of SLOTS) if (levels[s] !== undefined) cleanLevels[s] = intIn(levels[s], 1, 1000);
  if (Object.keys(cleanLevels).length) out.equipLevels = cleanLevels;
  return out;
}

function playerId(v: unknown) {
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) throw new HttpError(400, "invalid_player");
  return v;
}

function text(v: unknown, max: number) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const sinceIso = (ms: number) => new Date(Date.now() - ms).toISOString();
const startOfDayIso = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};

type Row = Record<string, unknown>;

function summarize(p: Row) {
  const gs = (p.game_state ?? {}) as Row;
  const pl = (gs.player ?? {}) as Row;
  const inv = Array.isArray(gs.inventory) ? (gs.inventory as Row[]) : [];
  const qtyByName = (name: string) => inv.filter((i) => i.name === name).reduce((s, i) => s + Number(i.qty ?? 0), 0);
  const equipped = (pl.equipped ?? {}) as Record<string, Row>;
  return {
    id: p.id,
    telegramId: p.telegram_id,
    username: p.username,
    name: p.display_name,
    level: p.level,
    banned: p.banned,
    createdAt: p.created_at,
    lastSeenAt: p.last_seen_at ?? p.updated_at,
    resources: {
      gold: Number(pl.gold ?? p.gold ?? 0),
      gems: Number(pl.gems ?? p.gems ?? 0),
      redGems: Number(pl.redGems ?? 0),
      stones: Number(gs.battleStones ?? 0),
      forgeMaterials: Number(gs.forgeMaterials ?? p.forge_materials ?? 0),
    },
    items: {
      shop_potion_hp: qtyByName("Зелье здоровья"),
      shop_potion_hp_large: qtyByName("Большое зелье здоровья"),
      shop_elixir_atk: qtyByName("Эликсир силы"),
      shop_elixir_def: qtyByName("Эликсир защиты"),
      shop_elixir_crit: qtyByName("Эликсир крита"),
      shop_arena_time: qtyByName("Зелье времени"),
      shop_arena_adrenaline: qtyByName("Адреналин"),
    },
    equipped: Object.fromEntries(
      Object.entries(equipped).filter(([, e]) => e).map(([slot, e]) => [slot, { name: e.name, level: e.level }]),
    ),
  };
}

const PLAYER_COLS = "id, telegram_id, username, display_name, level, gold, gems, forge_materials, banned, created_at, updated_at, last_seen_at, game_state";

async function handle(action: string, body: Row) {
  switch (action) {
    case "stats": {
      const [total, online, todayDon, settings] = await Promise.all([
        db.from("players").select("id", { count: "exact", head: true }),
        db.from("players").select("id", { count: "exact", head: true }).gte("last_seen_at", sinceIso(ONLINE_WINDOW_MS)),
        db.from("donations").select("amount_usd").gte("created_at", startOfDayIso()),
        db.from("game_settings").select("*").eq("id", 1).maybeSingle(),
      ]);
      if (total.error || online.error || todayDon.error || settings.error) throw new HttpError(500, "db_error");
      const todaySum = (todayDon.data ?? []).reduce((s, r) => s + Number(r.amount_usd), 0);
      return { totalPlayers: total.count ?? 0, onlinePlayers: online.count ?? 0, todayPurchasesUsd: todaySum, settings: settings.data };
    }
    case "set_setting": {
      const key = body.key as string;
      if (!SETTING_KEYS.includes(key as typeof SETTING_KEYS[number]) || typeof body.value !== "boolean") {
        throw new HttpError(400, "invalid_setting");
      }
      const { data, error } = await db.from("game_settings")
        .update({ [key]: body.value, updated_at: new Date().toISOString() }).eq("id", 1).select("*").maybeSingle();
      if (error) throw new HttpError(500, "db_error");
      await audit("set_setting", { key, value: body.value });
      return { settings: data };
    }
    case "reset_bots": {
      const { data, error } = await db.rpc("admin_reset_arena_bots");
      if (error) throw new HttpError(500, "db_error");
      await audit("reset_bots", { closed: data });
      return { closedRooms: data };
    }
    case "search": {
      const q = text(body.query, 64).replace(/^@/, "");
      if (!q) return { players: [] };
      let query = db.from("players").select(PLAYER_COLS).limit(20);
      if (/^\d+$/.test(q)) query = query.eq("telegram_id", Number(q));
      else {
        const pattern = `%${q.replace(/[%_,()]/g, "")}%`;
        query = query.or(`username.ilike.${pattern},display_name.ilike.${pattern}`);
      }
      const { data, error } = await query;
      if (error) throw new HttpError(500, "db_error");
      return { players: (data ?? []).map(summarize) };
    }
    case "player": {
      const id = playerId(body.playerId);
      const { data, error } = await db.from("players").select(PLAYER_COLS).eq("id", id).maybeSingle();
      if (error) throw new HttpError(500, "db_error");
      if (!data) throw new HttpError(404, "not_found");
      const { count } = await db.from("admin_grants").select("id", { count: "exact", head: true })
        .eq("player_id", id).eq("kind", "adjust").is("claimed_at", null);
      return { player: summarize(data), pendingAdjustments: count ?? 0 };
    }
    case "adjust": {
      const id = playerId(body.playerId);
      const payload = cleanPayload(body.payload);
      if (!Object.keys(payload).length) throw new HttpError(400, "empty_payload");
      const { error } = await db.from("admin_grants").insert({ player_id: id, kind: "adjust", payload });
      if (error) throw new HttpError(500, "db_error");
      await audit("adjust", { playerId: id, payload });
      return { ok: true };
    }
    case "ban": {
      const id = playerId(body.playerId);
      const banned = body.banned === true;
      const { error } = await db.from("players").update({ banned }).eq("id", id);
      if (error) throw new HttpError(500, "db_error");
      await audit(banned ? "ban" : "unban", { playerId: id });
      return { ok: true, banned };
    }
    case "suspicious": {
      const { data, error } = await db.from("players").select(PLAYER_COLS).order("level", { ascending: false }).limit(1000);
      if (error) throw new HttpError(500, "db_error");
      const flagged = (data ?? []).map((p) => {
        const s = summarize(p);
        const hours = Math.max(1, (Date.now() - new Date(String(p.created_at)).getTime()) / 3_600_000);
        const goldPerHour = s.resources.gold / hours;
        const levelsPerDay = Number(p.level ?? 1) / (hours / 24);
        const reasons: string[] = [];
        if (goldPerHour > 5000) reasons.push(`Монеты растут ${Math.round(goldPerHour)}/ч`);
        if (hours >= 6 && levelsPerDay > 15) reasons.push(`Уровни растут ${levelsPerDay.toFixed(1)}/день`);
        if (hours < 6 && Number(p.level ?? 1) > 15) reasons.push(`Уровень ${p.level} за ${hours.toFixed(1)} ч`);
        if (s.resources.gems > 5000) reasons.push(`Алмазов ${s.resources.gems}`);
        if (s.resources.redGems > 500) reasons.push(`Красных алмазов ${s.resources.redGems}`);
        return { ...s, goldPerHour: Math.round(goldPerHour), reasons };
      }).filter((p) => p.reasons.length);
      return { players: flagged.slice(0, 100) };
    }
    case "mail": {
      const subject = text(body.subject, 80);
      const message = text(body.body, 1000);
      if (!subject || !message) throw new HttpError(400, "empty_mail");
      const payload = cleanPayload(body.payload);
      const target = body.target;
      let ids: string[] = [];
      if (target === "one") {
        const raw = text(body.recipient, 64).replace(/^@/, "");
        let q = db.from("players").select("id").limit(1);
        q = /^\d+$/.test(raw) ? q.eq("telegram_id", Number(raw))
          : /^[0-9a-f-]{36}$/i.test(raw) ? q.eq("id", raw) : q.eq("username", raw);
        const { data, error } = await q;
        if (error) throw new HttpError(500, "db_error");
        ids = (data ?? []).map((r) => r.id as string);
        if (!ids.length) throw new HttpError(404, "recipient_not_found");
      } else if (target === "all" || target === "active") {
        let q = db.from("players").select("id").limit(100_000);
        if (target === "active") q = q.gte("last_seen_at", sinceIso(7 * 86_400_000));
        const { data, error } = await q;
        if (error) throw new HttpError(500, "db_error");
        ids = (data ?? []).map((r) => r.id as string);
      } else throw new HttpError(400, "invalid_target");
      for (let i = 0; i < ids.length; i += 500) {
        const rows = ids.slice(i, i + 500).map((pid) => ({ player_id: pid, kind: "mail", subject, body: message, payload }));
        const { error } = await db.from("admin_grants").insert(rows);
        if (error) throw new HttpError(500, "db_error");
      }
      await audit("mail", { target, recipients: ids.length, subject, payload });
      return { sent: ids.length };
    }
    case "donations": {
      const { data, error } = await db.from("donations")
        .select("id, player_id, red_gems, amount_usd, created_at, players(telegram_id, display_name)")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw new HttpError(500, "db_error");
      return { donations: data ?? [] };
    }
    case "top": {
      const kind = body.kind;
      if (kind === "level" || kind === "gold") {
        const { data, error } = await db.from("players")
          .select("id, telegram_id, username, display_name, level, gold")
          .order(kind, { ascending: false }).limit(100);
        if (error) throw new HttpError(500, "db_error");
        return { rows: (data ?? []).map((p) => ({ id: p.id, telegramId: p.telegram_id, name: p.display_name, username: p.username, value: kind === "level" ? p.level : p.gold })) };
      }
      if (kind === "donate") {
        const { data, error } = await db.from("donations")
          .select("player_id, amount_usd, players(telegram_id, username, display_name)").limit(100_000);
        if (error) throw new HttpError(500, "db_error");
        const totals = new Map<string, { id: string; telegramId: unknown; name: unknown; username: unknown; value: number }>();
        for (const d of data ?? []) {
          const pl = (d.players ?? {}) as Row;
          const cur = totals.get(d.player_id) ?? { id: d.player_id, telegramId: pl.telegram_id, name: pl.display_name, username: pl.username, value: 0 };
          cur.value += Number(d.amount_usd);
          totals.set(d.player_id, cur);
        }
        return { rows: [...totals.values()].sort((a, b) => b.value - a.value).slice(0, 100) };
      }
      throw new HttpError(400, "invalid_kind");
    }
    default:
      throw new HttpError(400, "unknown_action");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const body = (await req.json().catch(() => ({}))) as Row;
    const action = String(body.action ?? "");

    if (action === "login") {
      const { count } = await db.from("admin_audit_log").select("id", { count: "exact", head: true })
        .eq("action", "login_failed").gte("created_at", sinceIso(15 * 60 * 1000));
      if ((count ?? 0) >= MAX_FAILED_LOGINS) return json({ error: "too_many_attempts" }, 429);
      const ok = safeEqual(String(body.username ?? ""), ADMIN_LOGIN) && safeEqual(String(body.password ?? ""), ADMIN_PASSWORD);
      if (!ok) {
        await audit("login_failed");
        return json({ error: "invalid_credentials" }, 401);
      }
      await audit("login");
      return json(await issueToken());
    }

    if (!(await verifyToken(body.token))) return json({ error: "unauthorized" }, 401);
    if (action === "verify") return json({ ok: true });
    return json(await handle(action, body));
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "server_error" }, 500);
  }
});
