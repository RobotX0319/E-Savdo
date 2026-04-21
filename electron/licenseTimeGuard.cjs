const fs = require("fs");
const path = require("path");

const FILE_NAME = "esavdo-license-time-guard.json";

/** Qoidaga mos biroz soat surilish; undan katta ortga surish — manipulyatsiya hisoblanadi */
const DRIFT_MS = 5 * 60 * 1000;

function guardPath(userDataDir) {
  return path.join(userDataDir, FILE_NAME);
}

function loadGuard(userDataDir) {
  try {
    const p = guardPath(userDataDir);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function saveGuard(userDataDir, data) {
  try {
    fs.writeFileSync(guardPath(userDataDir), JSON.stringify(data, null, 2), "utf8");
  } catch {
    /* ignore */
  }
}

/**
 * Qurilmada saqlangan oxirgi yopilish / maksimal vaqt / obuna bosqichi bilan solishtiramiz.
 * Ortga surilgan vaqt aniqlansa — { ok: false }.
 */
function checkClockIntegrity(userDataDir) {
  const now = Date.now();
  const g = loadGuard(userDataDir);
  if (!g) {
    return { ok: true };
  }

  const lastClosed = Number(g.lastClosedAt);
  const maxSeen = Number(g.maxClockMs);
  const subAt = Number(g.firstSubscribedAtMs);

  if (Number.isFinite(lastClosed) && now < lastClosed - DRIFT_MS) {
    return { ok: false, reason: "before_last_exit" };
  }
  if (Number.isFinite(maxSeen) && now < maxSeen - DRIFT_MS) {
    return { ok: false, reason: "before_max_clock" };
  }
  if (Number.isFinite(subAt) && now < subAt - DRIFT_MS) {
    return { ok: false, reason: "before_subscription_anchor" };
  }
  return { ok: true };
}

/** Muvaffaqiyatli tekshiruvdan keyin — joriy vaqtni «eng yuqori ko‘rilgan» vaqtga qo‘shamiz */
function bumpMonotonicClock(userDataDir) {
  const g = loadGuard(userDataDir) || {};
  const now = Date.now();
  const prevMax = Number.isFinite(Number(g.maxClockMs)) ? Number(g.maxClockMs) : 0;
  const maxClockMs = Math.max(prevMax, now);
  saveGuard(userDataDir, {
    ...g,
    maxClockMs,
    lastBumpedAt: new Date(now).toISOString()
  });
}

/** Dastur yopilganda */
function recordAppClose(userDataDir) {
  const g = loadGuard(userDataDir) || {};
  const now = Date.now();
  const prevMax = Number.isFinite(Number(g.maxClockMs)) ? Number(g.maxClockMs) : 0;
  const maxClockMs = Math.max(prevMax, now);
  saveGuard(userDataDir, {
    ...g,
    lastClosedAt: now,
    maxClockMs,
    lastClosedIso: new Date(now).toISOString()
  });
}

/** Birinchi muvaffaqiyatli onlayn tasdiqda — obuna «bosqichi» (client vaqti) */
function recordFirstSubscriptionIfNeeded(userDataDir) {
  const g = loadGuard(userDataDir) || {};
  const now = Date.now();
  const prevMax = Number.isFinite(Number(g.maxClockMs)) ? Number(g.maxClockMs) : 0;
  const maxClockMs = Math.max(prevMax, now);
  const patch = {
    ...g,
    maxClockMs
  };
  if (!Number.isFinite(Number(g.firstSubscribedAtMs))) {
    patch.firstSubscribedAtMs = now;
    patch.firstSubscribedRecordedIso = new Date(now).toISOString();
  }
  saveGuard(userDataDir, patch);
}

module.exports = {
  checkClockIntegrity,
  bumpMonotonicClock,
  recordAppClose,
  recordFirstSubscriptionIfNeeded
};
