const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function deviceFilePath(userDataDir) {
  return path.join(userDataDir, "esavdo-device.json");
}

function licenseCachePath(userDataDir) {
  return path.join(userDataDir, "esavdo-license-cache.json");
}

function readLicenseCache(userDataDir) {
  try {
    const p = licenseCachePath(userDataDir);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function writeLicenseCache(userDataDir, payload) {
  try {
    const p = licenseCachePath(userDataDir);
    fs.writeFileSync(
      p,
      JSON.stringify(
        {
          ...payload,
          savedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    /* ignore */
  }
}

function clearLicenseCache(userDataDir) {
  try {
    const p = licenseCachePath(userDataDir);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

/**
 * Muddati hali o'tmagan va avvalgi muvaffaqiyatli tasdiq keshlangan bo'lsa —
 * tarmoqqa chiqmasdan litsenziya haqida ma'lumot qaytaradi.
 */
function getOfflineLicenseIfStillValid(userDataDir, machineId) {
  const mid = String(machineId || "").trim();
  const c = readLicenseCache(userDataDir);
  if (!c || String(c.machineId || "").trim() !== mid) return null;
  if (c.valid !== true) return null;
  const exp = c.expiresAt;
  if (exp == null || String(exp).trim() === "") return null;
  const t = Date.parse(exp);
  if (!Number.isFinite(t)) return null;
  if (t <= Date.now()) return null;
  return {
    machineId: mid,
    valid: true,
    plan: c.plan,
    expiresAt: c.expiresAt,
    label: c.label,
    fromCache: true
  };
}

function getOrCreateMachineId(userDataDir) {
  const fp = deviceFilePath(userDataDir);
  try {
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, "utf8");
      const data = JSON.parse(raw);
      if (data.machineId && typeof data.machineId === "string" && data.machineId.length > 0) {
        return String(data.machineId).trim();
      }
    }
  } catch {
    /* yangi fayl yaratamiz */
  }
  const machineId = crypto.randomUUID();
  try {
    fs.writeFileSync(
      fp,
      JSON.stringify({ machineId, createdAt: new Date().toISOString() }, null, 2),
      "utf8"
    );
  } catch {
    /* yozilmasa ham UUID qaytaramiz — sessiya uchun */
  }
  return machineId;
}

async function verifyRemote(baseUrl, machineId) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  const mid = String(machineId || "").trim();
  const bust = Date.now();
  const url = `${base}/api/verify?machineId=${encodeURIComponent(mid)}&_=${bust}`;
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store"
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.code = "verify_http";
    throw err;
  }
  return res.json();
}

/** KV global tarqalishi bilan bir necha soniyada «valid» kechikishi mumkin — qisqa qayta urinish */
async function verifyRemoteWithRetry(baseUrl, machineId, options = {}) {
  const maxAttempts = options.maxAttempts ?? 6;
  const delayMs = options.delayMs ?? 400;
  let last = null;
  for (let i = 0; i < maxAttempts; i++) {
    last = await verifyRemote(baseUrl, machineId);
    if (last && last.valid === true) return last;
    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return last;
}

async function requestRemote(baseUrl, machineId, plan, contact, fullName) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  const url = `${base}/api/request`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      machineId: String(machineId || "").trim(),
      plan,
      contact: String(contact || "").slice(0, 500),
      fullName: String(fullName || "").trim().slice(0, 120)
    })
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* */
  }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.code = data.error || "request_http";
    err.payload = data;
    throw err;
  }
  return data;
}

module.exports = {
  getOrCreateMachineId,
  verifyRemote,
  verifyRemoteWithRetry,
  requestRemote,
  readLicenseCache,
  writeLicenseCache,
  clearLicenseCache,
  getOfflineLicenseIfStillValid
};
