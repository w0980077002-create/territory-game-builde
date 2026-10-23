import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_LOGIN = "owner";
const PASSWORD_ITERATIONS = 150_000;
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


function encodeHex(bytes: Uint8Array): string {
 return Array.from(bytes).map(x=>x.toString(16).padStart(2,'0')).join('');
}
function decodeHex(hex:string):Uint8Array{
 if(!/^[0-9a-f]{32}$/.test(hex))throw new HttpError(503,'admin_not_configured');
 const bytes=new Uint8Array(hex.length/2);
 for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(hex.slice(i*2,i*2+2),16);
 return bytes;
}
async function hashPassword(password:string,salt:string):Promise<string> {
 const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:decodeHex(salt),iterations:PASSWORD_ITERATIONS,hash:'SHA-256'},key,256);
 return encodeHex(new Uint8Array(bits));
}
async function currentCredential():Promise<{salt:string;verifier:string;version:number}> {
 const {data,error}=await db.rpc('territory_admin_credential_v2');
 if(error||!data||typeof data!=='object'||!Number.isSafeInteger(data.version))
  throw new HttpError(503,'admin_not_configured');
 return data;
}
async function matchesPassword(password:string,record:{salt:string;verifier:string}):Promise<boolean> {
 if(typeof password!=='string'||password.length<1||password.length>256)return false;
 const digest=await hashPassword(password,record.salt);
 return safeEqual(digest,record.verifier);
}

// Keep the original two-part owner session while the game is in development.
// Credentials are still checked against the server-side PBKDF2 verifier.
// If the owner rotates the password, the version increases and all original
// two-part sessions stop working; the three-part rotation-safe format remains.
async function issueToken(version: number) {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  if (version === 1) {
    return { token: exp + "." + await sign(exp), expiresAt: Number(exp) };
  }
  return { token: exp + "." + version + "." + await sign(exp + ":" + version), expiresAt: Number(exp) };
}

async function verifyToken(token: unknown) {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2 && parts.length !== 3) return false;
  const [exp, second, third] = parts;
  if (!/^\d{13}$/.test(exp) || Number(exp) < Date.now() ||
      Number(exp) > Date.now() + TOKEN_TTL_MS) return false;
  const credential = await currentCredential();
  if (parts.length === 2) {
    // Previous login tokens remain valid until their normal 12-hour expiry.
    // Changing the password disables compatibility immediately.
    return credential.version === 1 && /^[0-9a-f]{64}$/.test(second) &&
      safeEqual(second, await sign(exp));
  }
  return /^\d{1,10}$/.test(second) && /^[0-9a-f]{64}$/.test(third) &&
    Number(second) === credential.version &&
    safeEqual(third, await sign(exp + ":" + second));
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
  for (const s of SLOTS) if (levels[s] !== undefined) cleanLevels[s] = intIn(levels[s], 1, 500);
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

// "Today" in the owner dashboard follows Kyiv local midnight, including DST.
function kyivTodayStartIso(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const utcMidnight = Date.UTC(value("year"), value("month") - 1, value("day"));
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv", timeZoneName: "shortOffset",
  }).formatToParts(new Date(utcMidnight)).find((p) => p.type === "timeZoneName")?.value ?? "";
  const offset = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zone);
  if (!offset) throw new HttpError(500, "db_error");
  const minutes = (Number(offset[2]) * 60 + Number(offset[3] ?? 0)) * (offset[1] === "+" ? 1 : -1);
  return new Date(utcMidnight - minutes * 60_000).toISOString();
}

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
    combatStats: {
      attack: Number(p.attack ?? 0), defense: Number(p.defense ?? 0),
      hp: Number(p.max_hp ?? 0), critChance: Number(p.crit_chance ?? 0),
    },
    equipped: Object.fromEntries(
      Object.entries(equipped).filter(([, e]) => e).map(([slot, e]) => [slot, {
        name: e.name, level: Number(e.level ?? 0), attack: Number(e.attack ?? 0),
        defense: Number(e.defense ?? 0), hp: Number(e.hp ?? 0),
        critChance: Number(e.critChance ?? 0), adminTestLevel: e.adminTestLevel === true,
      }]),
    ),
  };
}

const PLAYER_COLS = "id, telegram_id, username, display_name, level, gold, gems, forge_materials, attack, defense, max_hp, crit_chance, banned, created_at, updated_at, last_seen_at, game_state";
const ACTIVITY_COLS = "id, telegram_id, username, display_name, level, banned, last_seen_at";

async function handle(action: string, body: Row) {
  switch (action) {
    case "stats": {
      const [total, online, today, week, todayDon, settings] = await Promise.all([
        db.from("players").select("id", { count: "exact", head: true }),
        db.from("players").select("id", { count: "exact", head: true }).gte("last_seen_at", sinceIso(ONLINE_WINDOW_MS)),
        db.from("players").select("id", { count: "exact", head: true }).gte("last_seen_at", kyivTodayStartIso()),
        db.from("players").select("id", { count: "exact", head: true }).gte("last_seen_at", sinceIso(7 * 24 * 60 * 60 * 1000)),
        db.from("donations").select("amount_usd").gte("created_at", startOfDayIso()),
        db.from("game_settings").select("*").eq("id", 1).maybeSingle(),
      ]);
      if (total.error || online.error || today.error || week.error || todayDon.error || settings.error) {
        throw new HttpError(500, "db_error");
      }
      const todaySum = (todayDon.data ?? []).reduce((s, r) => s + Number(r.amount_usd), 0);
      return {
        totalPlayers: total.count ?? 0,
        onlinePlayers: online.count ?? 0,
        todayPlayers: today.count ?? 0,
        weekPlayers: week.count ?? 0,
        todayPurchasesUsd: todaySum,
        settings: settings.data,
      };
    }
    case "geo_stats": {
      // Only available through the existing owner-authenticated admin-api handler.
      // Read an aggregated RPC; do not expose player IDs, IPs or location history.
      const { data, error } = await db.rpc("territory_admin_geography_v1");
      if (error || !data || typeof data !== "object") throw new HttpError(503, "geo_unavailable");
      return data;
    }
    case "activity": {
      const period = body.period;
      if (period !== "online" && period !== "today" && period !== "week") {
        throw new HttpError(400, "invalid_request");
      }
      const offset = Number(body.offset ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 5000) {
        throw new HttpError(400, "invalid_request");
      }
      const cutoff = period === "online" ? sinceIso(ONLINE_WINDOW_MS)
        : period === "today" ? kyivTodayStartIso()
        : sinceIso(7 * 24 * 60 * 60 * 1000);
      // Read-only, owner-authorized and paginated: never download full player game_state.
      const { data, error } = await db.from("players")
        .select(ACTIVITY_COLS)
        .gte("last_seen_at", cutoff)
        .order("last_seen_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + 50);
      if (error) throw new HttpError(500, "db_error");
      const players = (data ?? []).slice(0, 50).map((p) => ({
        id: p.id,
        telegramId: p.telegram_id,
        username: p.username,
        name: p.display_name,
        level: p.level,
        banned: p.banned,
        lastSeenAt: p.last_seen_at,
      }));
      return { players, hasMore: (data?.length ?? 0) > 50 };
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
      if (/^[0-9a-f-]{36}$/i.test(q)) query = query.eq("id", q);
      else if (/^\d+$/.test(q)) query = query.eq("telegram_id", Number(q));
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
    case "set_test_gear_level": {
      const id = playerId(body.playerId);
      const slot = String(body.slot ?? "");
      if (!(SLOTS as readonly string[]).includes(slot)) throw new HttpError(400, "invalid_request");
      const level = intIn(body.level, 1, 500);
      const { data, error } = await db.rpc("territory_owner_apply_test_gear_v2", {
        p_player: id, p_slot: slot, p_level: level,
      });
      if (error) {
        if (error.message.includes("admin_player_missing")) throw new HttpError(404, "not_found");
        if (error.message.includes("admin_equipment_missing")) throw new HttpError(409, "invalid_request");
        throw new HttpError(500, "db_error");
      }
      await audit("set_test_gear_level", { playerId: id, slot, level, grantId: data?.grantId });
      return { ok: true, ...data };
    }
    case "adjust": {
      const id = playerId(body.playerId);
      const payload = cleanPayload(body.payload);
      if (!Object.keys(payload).length) throw new HttpError(400, "empty_payload");
      // Existing deployed/cached admin UI still posts equipLevels via adjust.
      // Route exactly one equipment-only edit through the same owner-authorized
      // server pathway as the new UI. Never create an ordinary capped gear grant.
      const legacyLevels = payload.equipLevels as Record<string, number> | undefined;
      const legacySlots = legacyLevels ? Object.keys(legacyLevels) : [];
      if (Object.keys(payload).length === 1 && legacySlots.length === 1) {
        const slot = legacySlots[0];
        const level = legacyLevels![slot];
        const { data, error } = await db.rpc("territory_owner_apply_test_gear_v2", {
          p_player: id, p_slot: slot, p_level: level,
        });
        if (error) {
          if (error.message.includes("admin_player_missing")) throw new HttpError(404, "not_found");
          if (error.message.includes("admin_equipment_missing")) throw new HttpError(409, "invalid_request");
          throw new HttpError(500, "db_error");
        }
        await audit("set_test_gear_level", { playerId: id, slot, level, legacy: true, grantId: data?.grantId });
        return { ok: true, ...data };
      }
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
    case "link_telegram": {
      const id = playerId(body.playerId);
      const tgId = Number(body.telegramId);
      if (!Number.isSafeInteger(tgId) || tgId <= 0) throw new HttpError(400, "invalid_number");
      const { data: target, error: tErr } = await db.from("players").select("id, telegram_id").eq("id", id).maybeSingle();
      if (tErr) throw new HttpError(500, "db_error");
      if (!target) throw new HttpError(404, "not_found");
      if (target.telegram_id !== null && Number(target.telegram_id) !== tgId) throw new HttpError(409, "player_already_linked");

      const tgEmail = `tg_${tgId}@territory.game`;
      const { data: other, error: oErr } = await db.from("players").select("id").eq("telegram_id", tgId).neq("id", id).maybeSingle();
      if (oErr) throw new HttpError(500, "db_error");
      const { data: list, error: lErr } = await db.auth.admin.listUsers({ perPage: 1000 });
      if (lErr) throw new HttpError(500, "auth_error");
      const holder = list.users.find((u) => u.email === tgEmail && u.id !== id);
      // The other account is detached, never deleted, so it can be restored if needed.
      if (holder) {
        const { error } = await db.auth.admin.updateUserById(holder.id, {
          email: `detached_${tgId}_${Date.now()}@territory.game`, email_confirm: true,
        });
        if (error) throw new HttpError(500, "auth_error");
      }
      if (other) {
        const { error } = await db.from("players").update({ telegram_id: null }).eq("id", other.id);
        if (error) throw new HttpError(500, "db_error");
      }
      const { error: aErr } = await db.auth.admin.updateUserById(id, { email: tgEmail, email_confirm: true });
      if (aErr) throw new HttpError(500, "auth_error");
      const { error: pErr } = await db.from("players").update({ telegram_id: tgId }).eq("id", id);
      if (pErr) throw new HttpError(500, "db_error");
      await audit("link_telegram", { playerId: id, telegramId: tgId, detachedPlayerId: other?.id ?? null, detachedAuthId: holder?.id ?? null });
      return { ok: true, telegramId: tgId, detachedPlayerId: other?.id ?? null };
    }
    case "suspicious": {
      // Read-only screening: flags are NEVER sanctions, not evidence of abuse.
      // Include the audit log so owner can inspect unusual stone/gem awards.
      const since = sinceIso(7 * 86_400_000);
      const [{ data, error }, auditReply] = await Promise.all([
        db.from("players").select(PLAYER_COLS).order("level", { ascending: false }).limit(1000),
        db.from("territory_economy_audit_v1")
          .select("player_id,reason,changed_at")
          .eq("suspicious", true).gte("changed_at", since)
          .order("changed_at", { ascending: false }).limit(400),
      ]);
      if (error) throw new HttpError(500, "db_error");
      const auditRows = auditReply.error ? [] : (auditReply.data ?? []) as Array<{
        player_id: string; reason: string; changed_at: string;
      }>;
      const byId = new Map<string, { count: number; types: Set<string>; times: number[]; nearGrant: boolean }>();
      for (const row of auditRows) {
        const value = byId.get(row.player_id) ?? { count: 0, types: new Set<string>(), times: [], nearGrant: false };
        value.count += 1;
        value.types.add(row.reason);
        value.times.push(new Date(row.changed_at).getTime());
        byId.set(row.player_id, value);
      }
      // Grants may explain some changes. A time overlap is a clue, NOT proof
      // that an admin action caused the signal or that the player is innocent.
      const ids = [...byId.keys()];
      if (ids.length) {
        const grants = await db.from("admin_grants")
          .select("player_id,created_at").in("player_id", ids)
          .gte("created_at", sinceIso(8 * 86_400_000)).limit(1200);
        if (!grants.error) for (const grant of grants.data ?? []) {
          const entry = byId.get(String(grant.player_id));
          if (!entry) continue;
          const created = new Date(String(grant.created_at)).getTime();
          if (entry.times.some(t => Number.isFinite(t) && Math.abs(created - t) <= 30 * 60_000)) {
            entry.nearGrant = true;
          }
        }
      }
      const auditLabels: Record<string, string> = {
        large_stone_gain: "Крупное начисление камней",
        large_gem_gain: "Крупное начисление алмазов",
        large_gold_gain: "Крупное начисление золота",
      };
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
        const events = byId.get(String(p.id));
        if (events) {
          reasons.push(`Аудит за 7 дней: ${events.count} сигналов`);
          for (const type of events.types) reasons.push(auditLabels[type] ?? "Необычное изменение экономики");
          if (events.nearGrant) reasons.push("Рядом по времени есть письмо админа — сверить вручную");
        }
        return { ...s, goldPerHour: Math.round(goldPerHour), auditCount: events?.count ?? 0, reasons };
      }).filter((p) => p.reasons.length)
        .sort((a, b) => b.auditCount - a.auditCount || b.goldPerHour - a.goldPerHour);
      return {
        players: flagged.slice(0, 100),
        auditSummary: {
          events: auditRows.length, players: byId.size,
          nearAdminGrant: [...byId.values()].filter(v => v.nearGrant).length,
          available: !auditReply.error,
        },
      };
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

    case "warn": {
      // Anti-cheat NEVER bans automatically. Warnings are explicit owner actions.
      const id = playerId(body.playerId);
      const message = text(body.message, 1000);
      if (message.length < 5) throw new HttpError(400, "invalid_request");
      const { data: player, error: lookupError } = await db.from("players").select("id").eq("id", id).maybeSingle();
      if (lookupError) throw new HttpError(500, "db_error");
      if (!player) throw new HttpError(404, "not_found");
      const { error } = await db.from("admin_grants").insert({
        player_id: id, kind: "mail", subject: "Предупреждение администрации", body: message, payload: {},
      });
      if (error) throw new HttpError(500, "db_error");
      await audit("warn", { playerId: id, message });
      return { ok: true };
    }
    case "mail_schedule": {
      const subject = text(body.subject, 80);
      const message = text(body.body, 1000);
      if (!subject || !message) throw new HttpError(400, "empty_mail");
      const payload = cleanPayload(body.payload);
      const target = String(body.target ?? "");
      if (target !== "one" && target !== "all" && target !== "active") {
        throw new HttpError(400, "invalid_target");
      }
      const sendAt = new Date(String(body.sendAt ?? ""));
      if (!Number.isFinite(sendAt.getTime()) ||
        sendAt.getTime() <= Date.now() + 60_000 ||
        sendAt.getTime() > Date.now() + 365 * 86_400_000) {
        throw new HttpError(400, "invalid_schedule_time");
      }
      let recipient: string | null = null;
      if (target === "one") {
        const raw = text(body.recipient, 64).replace(/^@/, "");
        if (!raw) throw new HttpError(400, "invalid_target");
        let q = db.from("players").select("id").limit(1);
        q = /^\d+$/.test(raw) ? q.eq("telegram_id", Number(raw))
          : /^[0-9a-f-]{36}$/i.test(raw) ? q.eq("id", raw) : q.eq("username", raw);
        const { data, error } = await q;
        if (error) throw new HttpError(500, "db_error");
        recipient = data?.[0]?.id ?? null;
        if (!recipient) throw new HttpError(404, "recipient_not_found");
      }
      const { data, error } = await db.rpc("territory_admin_mail_schedule_v1", {
        p_target: target,
        p_recipient: recipient,
        p_subject: subject,
        p_body: message,
        p_payload: payload,
        p_send_at: sendAt.toISOString(),
      });
      if (error || typeof data !== "string") {
        console.error("mail_schedule:", error);
        throw new HttpError(500, "db_error");
      }
      return { ok: true, id: data };
    }
    case "mail_schedules": {
      const { data, error } = await db.rpc("territory_admin_mail_schedules_v1");
      if (error) throw new HttpError(500, "db_error");
      return { rows: Array.isArray(data) ? data : [] };
    }
    case "mail_schedule_cancel": {
      const id = playerId(body.id);
      const { data, error } = await db.rpc("territory_admin_mail_cancel_v1", { p_id: id });
      if (error) throw new HttpError(500, "db_error");
      if (data !== true) throw new HttpError(409, "schedule_already_processed");
      return { ok: true };
    }

    case "hall_stats": {
      const {data,error}=await db.rpc('territory_hall_admin_overview_v2');
      if(error||!data)throw new HttpError(500,'db_error');
      return data;
    }
    case "hall_player": {
      const id=playerId(body.playerId);
      const {data,error}=await db.rpc('territory_hall_admin_player_v2',{p_player:id});
      if(error)throw new HttpError(500,'db_error');
      return data;
    }
    case "hall_grant": {
      const scope=String(body.scope??'');
      if(scope!=='one'&&scope!=='active'&&scope!=='all')throw new HttpError(400,'invalid_target');
      const player=scope==='one'?playerId(body.playerId):null;
      const amount=intIn(body.amount,-250,250);
      if(amount===0)throw new HttpError(400,'invalid_number');
      const reason=text(body.reason,140);
      if(reason.length<3)throw new HttpError(400,'invalid_reason');
      const request=String(body.requestId??'');
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request))
        throw new HttpError(400,'invalid_request');
      const {data,error}=await db.rpc('territory_hall_admin_adjust_v2',{
        p_request:request,p_scope:scope,p_player:player,p_delta:amount,p_reason:reason,
      });
      if(error) {
        if(error.message.includes('admin_player_missing'))throw new HttpError(404,'not_found');
        if(error.message.includes('admin_request_conflict'))throw new HttpError(409,'invalid_request');
        throw new HttpError(500,'db_error');
      }
      await audit('hall_grant',{scope,playerId:player,amount,reason,request,affected:data.affected,replayed:data.replayed});
      return data;
    }
    case "audit_recent": {
      const {data,error}=await db.from('admin_audit_log').select('id,action,details,created_at')
        .order('created_at',{ascending:false}).limit(100);
      if(error)throw new HttpError(500,'db_error');
      return {rows:(data??[]).filter(x=>x.action!=='login_failed')};
    }
    case "pending_grants": {
      const id=playerId(body.playerId);
      const {data,error}=await db.from('admin_grants')
        .select('id,kind,subject,payload,created_at')
        .eq('player_id',id).is('claimed_at',null)
        .order('created_at',{ascending:false}).limit(40);
      if(error)throw new HttpError(500,'db_error');
      return {rows:data??[]};
    }
    case "cancel_pending": {
      const id=playerId(body.playerId);
      const grantId=String(body.grantId??'');
      if(!/^[0-9a-f-]{36}$/i.test(grantId))throw new HttpError(400,'invalid_request');
      const {data,error}=await db.from('admin_grants').delete()
        .eq('id',grantId).eq('player_id',id).is('claimed_at',null)
        .select('id,kind,payload').maybeSingle();
      if(error)throw new HttpError(500,'db_error');
      if(!data)throw new HttpError(409,'grant_already_claimed');
      await audit('cancel_pending',{playerId:id,grantId,kind:data.kind,payload:data.payload});
      return {ok:true};
    }
    case "change_password": {
      const oldPassword=String(body.oldPassword??'');
      const nextPassword=String(body.newPassword??'');
      if(nextPassword.length<14||nextPassword.length>128||
       !/[A-Za-zА-Яа-я]/u.test(nextPassword)||!/[0-9]/.test(nextPassword))
        throw new HttpError(400,'weak_password');
      const current=await currentCredential();
      if(!await matchesPassword(oldPassword,current))throw new HttpError(403,'invalid_credentials');
      if(safeEqual(oldPassword,nextPassword))throw new HttpError(400,'weak_password');
      const salt=encodeHex(crypto.getRandomValues(new Uint8Array(16)));
      const verifier=await hashPassword(nextPassword,salt);
      const {data,error}=await db.rpc('territory_admin_rotate_v2',{
        p_salt:salt,p_verifier:verifier,p_expected_version:current.version,
      });
      if(error||!Number.isSafeInteger(data))throw new HttpError(409,'admin_auth_conflict');
      await audit('password_changed',{version:data});
      return {ok:true};
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
      const credential=await currentCredential();
      const ok = safeEqual(String(body.username ?? ""), ADMIN_LOGIN) &&
        await matchesPassword(String(body.password ?? ""),credential);
      if (!ok) {
        await audit("login_failed");
        return json({ error: "invalid_credentials" }, 401);
      }
      await audit("login");
      return json(await issueToken(credential.version));
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
