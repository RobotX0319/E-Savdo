/**
 * E-Savdo litsenziya worker: KV + Telegram admin tasdiqlash + Mini App (admin) + Support → admin Telegram bildirishnomalari
 *
 * Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID, MINIAPP_LOGIN, MINIAPP_PASSWORD,
 *          WEBHOOK_SECRET (ixtiyoriy)
 * Mini App: https://<worker>/miniapp
 */

import { getMiniAppHtml } from "./miniapp-html.js";

const PLANS = {
  monthly: { label: "Oylik", days: 31 },
  quarterly: { label: "3 oylik", days: 93 },
  semiannual: { label: "6 oylik", days: 186 },
  yearly: { label: "Yillik", days: 366 },
};

/** Telegram klassik Markdown uchun foydalanuvchi matnini xavfsiz qilish */
function escapeTgMarkdown(s) {
  return String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function bufferToHex(buf) {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
async function validateWebAppInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const pairs = [];
  for (const [k, v] of params.entries()) {
    pairs.push([k, v]);
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  const enc = new TextEncoder();
  const key1 = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const secretKeyBuf = await crypto.subtle.sign("HMAC", key1, enc.encode(botToken));
  const key2 = await crypto.subtle.importKey(
    "raw",
    secretKeyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key2, enc.encode(dataCheckString));
  if (bufferToHex(sigBuf) !== hash.toLowerCase()) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return null;
  if (Date.now() / 1000 - authDate > 86400 * 7) return null;

  const userStr = params.get("user");
  if (!userStr) return null;
  try {
    const user = JSON.parse(userStr);
    if (!user || typeof user.id !== "number") return null;
    return { user };
  } catch {
    return null;
  }
}

const ADMINS_KV_KEY = "config:admins";

async function getAdminIds(env) {
  const raw = await env.LICENSE_KV.get(ADMINS_KV_KEY);
  let ids = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        ids = parsed.map((x) => String(x).trim()).filter(Boolean);
      }
    } catch {
      /* */
    }
  }
  if (ids.length === 0) {
    const legacy = String(env.TELEGRAM_ADMIN_CHAT_ID || "").trim();
    if (legacy) {
      ids = [legacy];
      await env.LICENSE_KV.put(ADMINS_KV_KEY, JSON.stringify(ids));
    }
  }
  return [...new Set(ids)];
}

async function setAdminIds(env, ids) {
  const unique = [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))];
  await env.LICENSE_KV.put(ADMINS_KV_KEY, JSON.stringify(unique));
  return unique;
}

function isUserInAdminList(userId, adminIds) {
  if (userId == null) return false;
  const s = String(userId);
  return adminIds.some((a) => String(a) === s);
}

async function isTelegramAdminId(userId, env) {
  const list = await getAdminIds(env);
  return isUserInAdminList(userId, list);
}

/** Barcha shaxsiy chatlarda pastki Web App tugmasi (ichki chat) */
async function setDefaultWebAppMenuButton(token, workerRequestUrl) {
  const origin = new URL(workerRequestUrl).origin;
  const url = `${origin}/miniapp`;
  const r = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      menu_button: {
        type: "web_app",
        text: "E-Savdo",
        web_app: { url },
      },
    }),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || "setChatMenuButton_failed");
  return data;
}

async function listAllLicenses(kv) {
  const out = [];
  let cursor;
  for (;;) {
    const res = await kv.list({ prefix: "license:", cursor });
    for (const key of res.keys) {
      const raw = await kv.get(key.name);
      if (!raw) continue;
      try {
        const lic = JSON.parse(raw);
        const mid = String(lic.machineId || key.name.replace(/^license:/, "")).trim();
        out.push({
          machineId: mid,
          fullName: lic.fullName ? String(lic.fullName).trim() : "",
          contact: lic.contact ? String(lic.contact).trim() : "",
          plan: lic.plan,
          planLabel: PLANS[lic.plan]?.label ?? lic.plan,
          expiresAt: lic.expiresAt ?? null,
          status: lic.status ?? "unknown",
          approvedAt: lic.approvedAt ?? null,
          requestId: lic.requestId ?? null,
        });
      } catch {
        /* skip */
      }
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  out.sort((a, b) => String(b.expiresAt || "").localeCompare(String(a.expiresAt || "")));
  return out;
}

async function getLicenseStats(kv) {
  const licenses = await listAllLicenses(kv);
  const now = Date.now();
  let active = 0;
  let expired = 0;
  for (const row of licenses) {
    const exp = new Date(row.expiresAt || 0).getTime();
    const ok =
      row.status === "active" && Number.isFinite(exp) && exp > now;
    if (ok) active++;
    else expired++;
  }
  return { total: licenses.length, active, expired };
}

const MINIAPP_SESS_PREFIX = "miniapp_sess:";

async function requireMiniAppSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (!bearer) return null;
  const tok = bearer[1].trim();
  if (!tok || tok.length > 200) return null;
  const raw = await env.LICENSE_KV.get(`${MINIAPP_SESS_PREFIX}${tok}`);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (s.userId == null) return null;
    return { userId: s.userId, token: tok };
  } catch {
    return null;
  }
}

async function adminApiGuard(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return json({ ok: false, error: "worker_not_configured" }, 503);
  }
  const ctx = await requireMiniAppSession(request, env);
  if (!ctx) return json({ ok: false, error: "unauthorized" }, 401);
  if (!(await isTelegramAdminId(ctx.userId, env))) {
    return json({ ok: false, error: "forbidden" }, 403);
  }
  return null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function tgApi(token, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || "telegram_api_error");
  return data.result;
}

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Barcha adminlarga yuborilgan xabarlar — tasdiq/rad qilganda hammasida tugmalar olib tashlanadi */
async function editAllAdminRequestMessages(token, env, requestId, newText, parseMode) {
  const raw = await env.LICENSE_KV.get(`pending_msgs:${requestId}`);
  if (!raw) return;
  let refs = [];
  try {
    refs = JSON.parse(raw);
    if (!Array.isArray(refs)) refs = [];
  } catch {
    return;
  }
  const payloadBase = {
    text: newText,
    reply_markup: { inline_keyboard: [] },
  };
  if (parseMode) payloadBase.parse_mode = parseMode;

  for (const ref of refs) {
    const chatId = ref.chat_id ?? ref.chatId;
    const mid = ref.message_id ?? ref.messageId;
    if (chatId == null || mid == null) continue;
    try {
      await tgApi(token, "editMessageText", {
        chat_id: chatId,
        message_id: mid,
        ...payloadBase,
      });
    } catch (e) {
      /* xabar o'chirilgan / kirish yo'q */
    }
  }
}

const SUPPORT_MSG_PREFIX = "support:messages:";
const SUPPORT_META_PREFIX = "support:meta:";
/** Adminlarga yuborilgan Telegram xabar IDlari — o‘qilganda o‘chirish uchun */
const SUPPORT_TG_REFS_PREFIX = "support:tg_notify_refs:";

/** Faol obuna (server bo'yicha) — support API uchun */
async function readActiveLicenseRecord(kv, machineId) {
  const mid = String(machineId || "").trim();
  if (!mid) return null;
  const raw = await kv.get(`license:${mid}`);
  if (!raw) return null;
  let lic;
  try {
    lic = JSON.parse(raw);
  } catch {
    return null;
  }
  const exp = new Date(lic.expiresAt).getTime();
  const valid =
    Number.isFinite(exp) && exp > Date.now() && lic.status === "active";
  return valid ? lic : null;
}

async function supportRateAllow(env, machineId) {
  const hourBucket = Math.floor(Date.now() / 3600000);
  const k = `support:rl:${machineId}:${hourBucket}`;
  const raw = await env.LICENSE_KV.get(k);
  const n = raw ? Number(raw) : 0;
  const max = 48;
  if (!Number.isFinite(n) || n >= max) {
    return false;
  }
  await env.LICENSE_KV.put(k, String(n + 1), { expirationTtl: 7200 });
  return true;
}

async function getSupportMessages(kv, machineId) {
  const raw = await kv.get(`${SUPPORT_MSG_PREFIX}${machineId}`);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function putSupportMessages(kv, machineId, messages) {
  await kv.put(`${SUPPORT_MSG_PREFIX}${machineId}`, JSON.stringify(messages.slice(-400)));
}

async function patchSupportMeta(env, machineId, fn) {
  const key = `${SUPPORT_META_PREFIX}${machineId}`;
  const rawM = await env.LICENSE_KV.get(key);
  let meta = { unreadByAdmin: 0, unreadByUser: 0 };
  if (rawM) {
    try {
      meta = { ...meta, ...JSON.parse(rawM) };
    } catch {
      /* */
    }
  }
  const next = fn(meta) || meta;
  await env.LICENSE_KV.put(key, JSON.stringify(next));
  return next;
}

async function appendSupportMessage(env, machineId, role, bodyText) {
  const text = String(bodyText || "").trim().slice(0, 4000);
  if (!text) {
    return { error: "empty" };
  }
  const messages = await getSupportMessages(env.LICENSE_KV, machineId);
  const msg = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    role: role === "staff" ? "staff" : "user",
    body: text,
  };
  messages.push(msg);
  await putSupportMessages(env.LICENSE_KV, machineId, messages);
  await patchSupportMeta(env, machineId, (m) => {
    const unreadByAdmin = m.unreadByAdmin || 0;
    const unreadByUser = m.unreadByUser || 0;
    if (msg.role === "user") {
      return { ...m, unreadByAdmin: unreadByAdmin + 1 };
    }
    return { ...m, unreadByUser: unreadByUser + 1 };
  });
  return { msg };
}

async function getLicenseHintForNotify(kv, machineId) {
  const raw = await kv.get(`license:${machineId}`);
  if (!raw) return { fullName: "", contact: "" };
  try {
    const lic = JSON.parse(raw);
    return {
      fullName: String(lic.fullName || "").trim(),
      contact: String(lic.contact || "").trim(),
    };
  } catch {
    return { fullName: "", contact: "" };
  }
}

async function mergeNotifyRefs(kv, machineId, newRefs) {
  if (!newRefs || !newRefs.length) return;
  const key = `${SUPPORT_TG_REFS_PREFIX}${machineId}`;
  let existing = [];
  const raw = await kv.get(key);
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) existing = p;
    } catch {
      /* */
    }
  }
  existing.push(...newRefs);
  await kv.put(key, JSON.stringify(existing.slice(-120)));
}

/** Adminlar chatda support o‘qiganda yoki bekor qilganda — Telegramdagi bildirishnomalarni o‘chirish */
async function deleteSupportTelegramNotifications(env, machineId) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const key = `${SUPPORT_TG_REFS_PREFIX}${machineId}`;
  const raw = await env.LICENSE_KV.get(key);
  if (!raw) return;
  let refs = [];
  try {
    refs = JSON.parse(raw);
    if (!Array.isArray(refs)) refs = [];
  } catch {
    await env.LICENSE_KV.delete(key);
    return;
  }
  if (token) {
    for (const ref of refs) {
      const chatId = ref.chat_id ?? ref.chatId;
      const mid = ref.message_id ?? ref.messageId;
      if (chatId == null || mid == null) continue;
      try {
        await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, message_id: mid }),
        });
      } catch {
        /* */
      }
    }
  }
  await env.LICENSE_KV.delete(key);
}

async function supportNotifyAdminsUserMessage(env, machineId, userMsg) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const adminIds = await getAdminIds(env);
  if (!adminIds.length) return;
  const hint = await getLicenseHintForNotify(env.LICENSE_KV, machineId);
  const preview = String(userMsg?.body || "").trim().slice(0, 350);
  const lines = [
    "💬 Yangi support xabari",
    "",
    `Ism: ${hint.fullName || "—"}`,
    `Device: ${machineId}`,
  ];
  if (hint.contact) {
    lines.push(`Kontakt: ${hint.contact}`);
  }
  lines.push("", preview || "(bo'sh)");
  const text = lines.join("\n");
  const newRefs = [];
  for (const adminId of adminIds) {
    try {
      const sent = await tgApi(token, "sendMessage", {
        chat_id: adminId,
        text,
        disable_web_page_preview: true,
      });
      if (sent && sent.message_id != null && sent.chat && sent.chat.id != null) {
        newRefs.push({ chat_id: sent.chat.id, message_id: sent.message_id });
      }
    } catch {
      /* telegram xatoliklari */
    }
  }
  if (newRefs.length) {
    await mergeNotifyRefs(env.LICENSE_KV, machineId, newRefs);
  }
}

async function clearAdminUnread(env, machineId) {
  await patchSupportMeta(env, machineId, (m) => ({ ...m, unreadByAdmin: 0 }));
  await deleteSupportTelegramNotifications(env, machineId);
}

async function clearUserUnread(env, machineId) {
  await patchSupportMeta(env, machineId, (m) => ({ ...m, unreadByUser: 0 }));
}

/** Adminlar uchun badge: masofadan yozuv bo'yicha */
async function mapSupportUnreadByMachine(kv) {
  const out = {};
  let cursor;
  for (;;) {
    const res = await kv.list({ prefix: SUPPORT_META_PREFIX, cursor });
    for (const item of res.keys) {
      const mid = item.name.slice(SUPPORT_META_PREFIX.length);
      const raw = await kv.get(item.name);
      if (!raw) continue;
      try {
        const m = JSON.parse(raw);
        out[mid] = m.unreadByAdmin || 0;
      } catch {
        /* */
      }
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return out;
}

async function enrichLicensesWithSupportUnread(kv, licenses) {
  const unreadMap = await mapSupportUnreadByMachine(kv);
  for (const row of licenses) {
    row.supportUnread = unreadMap[row.machineId] || 0;
  }
}

async function machineHasSupportOrLicense(kv, machineId) {
  const lic = await kv.get(`license:${machineId}`);
  if (lic) return true;
  const msgs = await getSupportMessages(kv, machineId);
  return msgs.length > 0;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "OPTIONS") return corsPreflight();

    try {
      if (path === "/health") {
        return json({ ok: true, service: "esavdo-license" });
      }

      if (path === "/miniapp" && request.method === "GET") {
        return new Response(getMiniAppHtml(), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }

      if (path === "/admin/miniapp-auth" && request.method === "POST") {
        if (!env.TELEGRAM_BOT_TOKEN) {
          return json({ ok: false, error: "worker_not_configured" }, 503);
        }
        const expectedLogin = String(env.MINIAPP_LOGIN || "").trim();
        const expectedPass = String(env.MINIAPP_PASSWORD ?? "");
        if (!expectedLogin || expectedPass.length === 0) {
          return json({ ok: false, error: "miniapp_login_not_configured" }, 503);
        }
        const body = await request.json().catch(() => ({}));
        const initData = String(body.initData || "").trim();
        const login = String(body.login || "").trim();
        const password = String(body.password ?? "");
        const v = await validateWebAppInitData(initData, env.TELEGRAM_BOT_TOKEN);
        if (!v) return json({ ok: false, error: "bad_init_data" }, 401);
        if (!(await isTelegramAdminId(v.user.id, env))) {
          return json({ ok: false, error: "forbidden" }, 403);
        }
        if (login !== expectedLogin || password !== expectedPass) {
          return json({ ok: false, error: "bad_credentials" }, 401);
        }
        const sessToken = crypto.randomUUID();
        await env.LICENSE_KV.put(
          `${MINIAPP_SESS_PREFIX}${sessToken}`,
          JSON.stringify({ userId: v.user.id, createdAt: Date.now() }),
          { expirationTtl: 60 * 60 * 24 * 7 }
        );
        return json({ ok: true, token: sessToken });
      }

      if (path === "/admin/logout" && request.method === "POST") {
        const ctx = await requireMiniAppSession(request, env);
        if (ctx?.token) {
          await env.LICENSE_KV.delete(`${MINIAPP_SESS_PREFIX}${ctx.token}`);
        }
        return json({ ok: true });
      }

      if (path === "/admin/stats" && request.method === "GET") {
        const guard = await adminApiGuard(request, env);
        if (guard) return guard;
        const stats = await getLicenseStats(env.LICENSE_KV);
        return json({ ok: true, ...stats });
      }

      if (path === "/admin/bootstrap" && request.method === "GET") {
        const guard = await adminApiGuard(request, env);
        if (guard) return guard;
        const [licenses, admins, stats] = await Promise.all([
          listAllLicenses(env.LICENSE_KV),
          getAdminIds(env),
          getLicenseStats(env.LICENSE_KV),
        ]);
        await enrichLicensesWithSupportUnread(env.LICENSE_KV, licenses);
        return json({ ok: true, licenses, admins, stats });
      }

      if (path === "/admin/licenses" && request.method === "GET") {
        const guard = await adminApiGuard(request, env);
        if (guard) return guard;
        const licenses = await listAllLicenses(env.LICENSE_KV);
        return json({ ok: true, licenses });
      }

      if (path === "/admin/admins" && request.method === "GET") {
        const guard = await adminApiGuard(request, env);
        if (guard) return guard;
        const admins = await getAdminIds(env);
        return json({ ok: true, admins });
      }

      if (path === "/admin/admins/add" && request.method === "POST") {
        const guard = await adminApiGuard(request, env);
        if (guard) return guard;
        const body = await request.json().catch(() => ({}));
        const tid = String(body.telegramUserId || body.userId || "").trim();
        if (!/^-?\d{1,20}$/.test(tid)) {
          return json({ ok: false, error: "invalid_telegram_id" }, 400);
        }
        const cur = await getAdminIds(env);
        if (!cur.length) return json({ ok: false, error: "no_admins_seed" }, 503);
        if (isUserInAdminList(tid, cur)) return json({ ok: true, admins: cur, already: true });
        const next = await setAdminIds(env, [...cur, tid]);
        return json({ ok: true, admins: next });
      }

      if (path === "/admin/admins/remove" && request.method === "POST") {
        const guard = await adminApiGuard(request, env);
        if (guard) return guard;
        const body = await request.json().catch(() => ({}));
        const tid = String(body.telegramUserId || body.userId || "").trim();
        const cur = await getAdminIds(env);
        if (cur.length <= 1) return json({ ok: false, error: "last_admin" }, 400);
        const next = cur.filter((a) => String(a) !== tid);
        if (next.length === cur.length) return json({ ok: false, error: "not_found" }, 404);
        await setAdminIds(env, next);
        return json({ ok: true, admins: next });
      }

      if (path === "/admin/revoke" && request.method === "POST") {
        const guard = await adminApiGuard(request, env);
        if (guard) return guard;
        const body = await request.json().catch(() => ({}));
        const machineId = String(body.machineId || "").trim();
        if (!machineId || machineId.length > 128) {
          return json({ ok: false, error: "invalid_machineId" }, 400);
        }
        await deleteSupportTelegramNotifications(env, machineId);
        await env.LICENSE_KV.delete(`license:${machineId}`);
        return json({ ok: true, machineId });
      }

      if (path === "/admin/support/messages" && request.method === "GET") {
        const guard = await adminApiGuard(request, env);
        if (guard) return guard;
        const machineId = (url.searchParams.get("machineId") || "").trim();
        if (!machineId || machineId.length > 128) {
          return json({ ok: false, error: "invalid_machineId" }, 400);
        }
        await clearAdminUnread(env, machineId);
        const messages = await getSupportMessages(env.LICENSE_KV, machineId);
        return json({ ok: true, messages });
      }

      if (path === "/admin/support/reply" && request.method === "POST") {
        const guard = await adminApiGuard(request, env);
        if (guard) return guard;
        const body = await request.json().catch(() => ({}));
        const machineId = String(body.machineId || "").trim();
        const text = body.text;
        if (!machineId || machineId.length > 128) {
          return json({ ok: false, error: "invalid_machineId" }, 400);
        }
        if (!(await machineHasSupportOrLicense(env.LICENSE_KV, machineId))) {
          return json({ ok: false, error: "no_thread" }, 404);
        }
        const r = await appendSupportMessage(env, machineId, "staff", text);
        if (r.error) {
          return json({ ok: false, error: r.error }, 400);
        }
        return json({ ok: true, message: r.msg });
      }

      if (path === "/api/support/history" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const machineId = String(body.machineId || "").trim();
        if (!machineId || machineId.length > 128) {
          return json({ ok: false, error: "invalid_machineId" }, 400);
        }
        if (!(await readActiveLicenseRecord(env.LICENSE_KV, machineId))) {
          return json({ ok: false, error: "no_license" }, 403);
        }
        const messages = await getSupportMessages(env.LICENSE_KV, machineId);
        const rawM = await env.LICENSE_KV.get(`${SUPPORT_META_PREFIX}${machineId}`);
        let unreadByUser = 0;
        if (rawM) {
          try {
            unreadByUser = Number(JSON.parse(rawM).unreadByUser || 0) || 0;
          } catch {
            /* */
          }
        }
        return json({ ok: true, messages, unreadByUser });
      }

      if (path === "/api/support/send" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const machineId = String(body.machineId || "").trim();
        const text = body.text;
        if (!machineId || machineId.length > 128) {
          return json({ ok: false, error: "invalid_machineId" }, 400);
        }
        if (!(await readActiveLicenseRecord(env.LICENSE_KV, machineId))) {
          return json({ ok: false, error: "no_license" }, 403);
        }
        if (!(await supportRateAllow(env, machineId))) {
          return json({ ok: false, error: "rate_limit" }, 429);
        }
        const r = await appendSupportMessage(env, machineId, "user", text);
        if (r.error) {
          return json({ ok: false, error: r.error }, 400);
        }
        if (r.msg) {
          ctx.waitUntil(
            supportNotifyAdminsUserMessage(env, machineId, r.msg).catch(() => {})
          );
        }
        return json({ ok: true, message: r.msg });
      }

      if (path === "/api/support/ack-user" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const machineId = String(body.machineId || "").trim();
        if (!machineId || machineId.length > 128) {
          return json({ ok: false, error: "invalid_machineId" }, 400);
        }
        if (!(await readActiveLicenseRecord(env.LICENSE_KV, machineId))) {
          return json({ ok: false, error: "no_license" }, 403);
        }
        await clearUserUnread(env, machineId);
        return json({ ok: true });
      }

      if (path === "/api/verify" && request.method === "GET") {
        const machineId = (url.searchParams.get("machineId") || "").trim();
        if (!machineId) return json({ valid: false, error: "machineId_required" }, 400);
        const raw = await env.LICENSE_KV.get(`license:${machineId}`);
        if (!raw) {
          return new Response(JSON.stringify({ valid: false, machineId }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store, max-age=0",
              ...CORS_HEADERS,
            },
          });
        }
        const lic = JSON.parse(raw);
        const exp = new Date(lic.expiresAt).getTime();
        const valid = Number.isFinite(exp) && exp > Date.now() && lic.status === "active";
        return new Response(
          JSON.stringify({
            valid,
            machineId,
            plan: lic.plan,
            expiresAt: lic.expiresAt,
            label: PLANS[lic.plan]?.label ?? lic.plan,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store, max-age=0",
              ...CORS_HEADERS,
            },
          }
        );
      }

      if (path === "/api/request" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const machineId = String(body.machineId || "").trim();
        const plan = String(body.plan || "").trim();
        const contact = String(body.contact || "").trim().slice(0, 500);
        const fullName = String(body.fullName || body.name || "").trim().slice(0, 120);

        if (!machineId || machineId.length > 128) {
          return json({ ok: false, error: "invalid_machineId" }, 400);
        }
        if (!fullName) {
          return json({ ok: false, error: "fullName_required" }, 400);
        }
        if (!PLANS[plan]) {
          return json({ ok: false, error: "invalid_plan", plans: Object.keys(PLANS) }, 400);
        }

        const token = env.TELEGRAM_BOT_TOKEN;
        const adminIds = await getAdminIds(env);
        if (!token || adminIds.length === 0) {
          return json({ ok: false, error: "worker_not_configured" }, 503);
        }

        const requestId = crypto.randomUUID();
        const planLabel = PLANS[plan].label;
        const text =
          `📋 *E-Savdo obuna so'rovi*\n\n` +
          `*Ism:* ${escapeTgMarkdown(fullName)}\n` +
          `*Reja:* ${planLabel} (\`${plan}\`)\n` +
          `*Device ID:* \`${machineId}\`\n` +
          `*Kontakt:* ${escapeTgMarkdown(contact || "—")}\n` +
          `*So'rov ID:* \`${requestId}\``;

        const pending = {
          requestId,
          machineId,
          plan,
          contact,
          fullName,
          createdAt: nowIso(),
          status: "pending",
          telegramBroadcastText: text,
        };
        await env.LICENSE_KV.put(
          `pending:${requestId}`,
          JSON.stringify(pending),
          { expirationTtl: 60 * 60 * 24 * 14 }
        );

        const messageRefs = [];
        for (const adminId of adminIds) {
          const sent = await tgApi(token, "sendMessage", {
            chat_id: adminId,
            text,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Tasdiqlash", callback_data: `ok:${requestId}` },
                  { text: "❌ Rad etish", callback_data: `no:${requestId}` },
                ],
              ],
            },
          });
          if (sent && sent.message_id != null && sent.chat && sent.chat.id != null) {
            messageRefs.push({ chat_id: sent.chat.id, message_id: sent.message_id });
          }
        }
        await env.LICENSE_KV.put(`pending_msgs:${requestId}`, JSON.stringify(messageRefs), {
          expirationTtl: 60 * 60 * 24 * 14,
        });

        return json({ ok: true, requestId, message: "admin_telegramga_yuborildi" });
      }

      if (path === "/webhook/telegram" && request.method === "POST") {
        const secret = env.WEBHOOK_SECRET;
        if (secret) {
          const hdr = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
          if (hdr !== secret) return new Response("forbidden", { status: 403 });
        }

        const update = await request.json();
        const token = env.TELEGRAM_BOT_TOKEN;
        const admins = await getAdminIds(env);
        if (!token || admins.length === 0) return new Response("not configured", { status: 503 });

        const cq = update.callback_query;
        if (cq && cq.data && cq.from) {
          if (!isUserInAdminList(cq.from.id, admins)) {
            await tgApi(token, "answerCallbackQuery", {
              callback_query_id: cq.id,
              text: "Ruxsat yo'q",
              show_alert: true,
            });
            return json({ ok: true });
          }

          const rawData = String(cq.data || "");
          const colon = rawData.indexOf(":");
          const action = colon === -1 ? rawData : rawData.slice(0, colon);
          const requestId = colon === -1 ? "" : rawData.slice(colon + 1);
          if (!requestId) {
            await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
            return json({ ok: true });
          }

          const pendingRaw = await env.LICENSE_KV.get(`pending:${requestId}`);
          if (!pendingRaw) {
            await tgApi(token, "answerCallbackQuery", {
              callback_query_id: cq.id,
              text: "So'rov topilmadi yoki muddati o'tgan",
              show_alert: true,
            });
            return json({ ok: true });
          }

          const pending = JSON.parse(pendingRaw);
          if (pending.status !== "pending") {
            await tgApi(token, "answerCallbackQuery", {
              callback_query_id: cq.id,
              text: "Bu so'rov allaqachon qayta ishlangan",
              show_alert: true,
            });
            return json({ ok: true });
          }

          if (action === "ok") {
            const plan = pending.plan;
            const days = PLANS[plan]?.days ?? 31;
            const expiresAt = addDaysIso(days);
            const mid = String(pending.machineId || "").trim();
            const license = {
              machineId: mid,
              plan,
              status: "active",
              expiresAt,
              requestId,
              approvedAt: nowIso(),
              fullName: String(pending.fullName || "").trim().slice(0, 120),
              contact: String(pending.contact || "").trim().slice(0, 500),
            };
            await env.LICENSE_KV.put(`license:${mid}`, JSON.stringify(license));
            pending.status = "approved";
            pending.approvedAt = nowIso();
            await env.LICENSE_KV.put(`pending:${requestId}`, JSON.stringify(pending), {
              expirationTtl: 60 * 60 * 24 * 7,
            });

            await tgApi(token, "answerCallbackQuery", {
              callback_query_id: cq.id,
              text: "Tasdiqlandi",
            });
            const baseOk = pending.telegramBroadcastText || cq.message.text;
            const newTextOk = `${baseOk}\n\n✅ Tasdiqlandi — ${PLANS[plan].label}, muddati: ${expiresAt.slice(0, 10)}`;
            await editAllAdminRequestMessages(token, env, requestId, newTextOk, "Markdown");
          } else if (action === "no") {
            pending.status = "rejected";
            pending.rejectedAt = nowIso();
            await env.LICENSE_KV.put(`pending:${requestId}`, JSON.stringify(pending), {
              expirationTtl: 60 * 60 * 24 * 3,
            });
            await tgApi(token, "answerCallbackQuery", {
              callback_query_id: cq.id,
              text: "Rad etildi",
            });
            const baseNo = pending.telegramBroadcastText || cq.message.text;
            const newTextNo = `${baseNo}\n\n❌ Rad etildi`;
            await editAllAdminRequestMessages(token, env, requestId, newTextNo, "Markdown");
          }
        }

        const msg = update.message || update.edited_message;
        if (msg && msg.from && !msg.from.is_bot) {
          if (!isUserInAdminList(msg.from.id, admins)) {
            const idLine =
              `Sizning Telegram user ID: \`${msg.from.id}\`\nChat ID: \`${msg.chat.id}\``;
            await tgApi(token, "sendMessage", {
              chat_id: msg.chat.id,
              text:
                `${idLine}\n\nBu botda Mini App va obuna tasdiqlari faqat adminlar uchun. Sizning ID ni admin E-Savdo Mini App orqali ro'yxatga qo'sha oladi.`,
              parse_mode: "Markdown",
            });
            return json({ ok: true });
          }

          const text = (msg.text || msg.caption || "").trim();
          if (/^\/(start|menu)(\s|$)/i.test(text)) {
            try {
              await setDefaultWebAppMenuButton(token, request.url);
            } catch (e) {
              await tgApi(token, "sendMessage", {
                chat_id: msg.chat.id,
                text: `Mini App tugmasi API orqali sozlanmadi: ${e.message || e}. Keyinroq /menu yuboring.`,
              });
              return json({ ok: true });
            }
            await tgApi(token, "sendMessage", {
              chat_id: msg.chat.id,
              text:
                "Pastki chapda **E-Savdo** menyusi (attachment yonidagi ilova menyusi) ochilguncha chatni yangilang. Mini App shu orqali ochiladi.",
              parse_mode: "Markdown",
            });
            return json({ ok: true });
          }
        }

        return json({ ok: true });
      }

      return json({ error: "not_found" }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },
};
