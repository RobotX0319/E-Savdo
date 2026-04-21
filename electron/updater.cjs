const fs = require("fs");
const path = require("path");
const { app, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const semver = require("semver");

let prepared = false;

/** Foydalanuvchi "Dastur haqida" dan tekshiruvni boshlagan — ishga tushishdagi avto-tekshiruvni o'tkazib yuboramiz */
let userInvokedUpdateCheckThisSession = false;

/** Har qanday yangilanish UI oqimi (startup yoki About) — parallel ikkita dialog chiqmasin */
let updateUiFlowBusy = false;

/** Yuklab olingan, lekin o'rnatilmagan (keyinroq) */
let pendingDownloaded = null;

/** @type {() => import("electron").BrowserWindow | null} */
let getMainWindow = () => null;

let listenersAttached = false;

function setMainWindowGetter(fn) {
  getMainWindow = typeof fn === "function" ? fn : () => null;
}

function markUserInvokedUpdateCheck() {
  userInvokedUpdateCheckThisSession = true;
}

function pendingUpdateFilePath() {
  return path.join(app.getPath("userData"), "esavdo-pending-update.json");
}

function readPendingFromDisk() {
  try {
    const p = pendingUpdateFilePath();
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (j && typeof j.version === "string" && j.version.trim() !== "") {
      return { version: j.version.trim() };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writePendingToDisk(info) {
  try {
    fs.writeFileSync(pendingUpdateFilePath(), JSON.stringify({ version: info.version }), "utf8");
  } catch {
    /* ignore */
  }
}

function clearPendingDisk() {
  try {
    const p = pendingUpdateFilePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function ensurePendingLoaded() {
  if (pendingDownloaded) return;
  const fromDisk = readPendingFromDisk();
  if (fromDisk) pendingDownloaded = fromDisk;
}

function notifyRendererPending(payload) {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) return;
  wc.send("update:pending-install", payload);
}

function clearPending() {
  pendingDownloaded = null;
  clearPendingDisk();
  notifyRendererPending(null);
}

function prepareUpdater() {
  if (prepared) return;
  prepared = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableDifferentialDownload = true;
}

/**
 * @param {import("electron").BrowserWindow | null} mainWindow
 */
function attachUpdaterListeners(mainWindow) {
  if (listenersAttached) return;
  listenersAttached = true;
  prepareUpdater();
  autoUpdater.on("update-downloaded", (info) => {
    pendingDownloaded = {
      version: String(info?.version || "")
    };
    if (pendingDownloaded.version) {
      writePendingToDisk(pendingDownloaded);
      notifyRendererPending({ version: pendingDownloaded.version });
    }
  });
}

function refocusMain(mainWindow) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.focus();
  if (win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.focus();
  }
}

/**
 * @param {import("electron").BrowserWindow | null} mainWindow
 * @param {import("electron-updater").ProgressInfo} info
 */
function emitDownloadProgress(mainWindow, info) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : getMainWindow();
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) return;
  const pct = typeof info?.percent === "number" ? info.percent : 0;
  wc.send("update:download-progress", {
    percent: pct,
    transferred: info?.transferred,
    total: info?.total
  });
  try {
    win.setProgressBar(Math.min(1, Math.max(0, pct / 100)));
  } catch {
    /* ignore */
  }
}

/**
 * @param {import("electron").BrowserWindow | null} mainWindow
 */
function clearDownloadProgressUi(mainWindow) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : getMainWindow();
  if (!win || win.isDestroyed()) return;
  try {
    win.setProgressBar(-1);
  } catch {
    /* ignore */
  }
  const wc = win.webContents;
  if (wc && !wc.isDestroyed()) {
    wc.send("update:download-progress", null);
  }
}

/**
 * @param {import("electron").BrowserWindow | null} mainWindow
 * @param {() => Promise<unknown>} downloadFn
 */
async function runDownloadWithProgress(mainWindow, downloadFn) {
  /** @param {import("electron-updater").ProgressInfo} info */
  const onProgress = (info) => emitDownloadProgress(mainWindow, info);
  autoUpdater.on("download-progress", onProgress);
  try {
    await downloadFn();
  } finally {
    autoUpdater.removeListener("download-progress", onProgress);
    setImmediate(() => clearDownloadProgressUi(mainWindow));
  }
}

function formatReleaseNotes(info) {
  const rn = info?.releaseNotes;
  if (rn == null || rn === "") return "";
  if (Array.isArray(rn)) {
    return rn
      .map((x) => (typeof x === "string" ? x : x?.note || ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return String(rn).trim();
}

/** @returns {"newer"|"older"|"equal"|"unknown"} */
function compareWithRemote(currentVersion, remoteVersionRaw) {
  if (remoteVersionRaw == null || remoteVersionRaw === "") return "unknown";
  const cur = semver.valid(semver.coerce(String(currentVersion)));
  const rem = semver.valid(semver.coerce(String(remoteVersionRaw)));
  if (!cur || !rem) return "unknown";
  if (semver.gt(rem, cur)) return "newer";
  if (semver.lt(rem, cur)) return "older";
  return "equal";
}

function buildNoUpdateMessage(currentVer, check) {
  const rel = compareWithRemote(currentVer, check?.updateInfo?.version);
  if (rel === "newer") {
    return `Yangilanish hozir taklif etilmayapti. Sizda ${currentVer}.`;
  }
  return `Yangi versiya topilmadi. Sizda ${currentVer}.`;
}

/**
 * Yuklab olish tugagach — bitta umumiy o'rnatish so'rovi (takrorlanmasin).
 * @param {import("electron").BrowserWindow | null} mainWindow
 */
async function showInstallReadyDialog(mainWindow) {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "info",
    buttons: ["Keyinroq", "O'rnatish va qayta ishga tushirish"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    title: "Yangilanish tayyor",
    message: "O'rnatish boshlanadi; dastur yopiladi."
  });
  refocusMain(mainWindow);
  return response === 1;
}

function getUpdateState() {
  ensurePendingLoaded();
  return {
    pendingInstall: pendingDownloaded != null,
    version: pendingDownloaded?.version ?? null
  };
}

/**
 * "Yangilash" tugmasi: GitHubga murojaat qilmasdan faqat tayyor o'rnatuvchini ishga tushirish.
 * @param {import("electron").BrowserWindow | null} mainWindow
 */
async function installPendingUpdate(mainWindow) {
  if (!app.isPackaged) {
    return { ok: false, error: "dev" };
  }
  if (updateUiFlowBusy) {
    return { ok: true, skipped: true, reason: "busy" };
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: "Oyna topilmadi." };
  }

  prepareUpdater();
  attachUpdaterListeners(mainWindow);
  ensurePendingLoaded();
  if (!pendingDownloaded) {
    return { ok: false, error: "no_pending" };
  }

  updateUiFlowBusy = true;
  try {
    const install = await showInstallReadyDialog(mainWindow);
    if (install) {
      clearPending();
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return { ok: true, action: "install" };
    }
    return { ok: true, action: "deferred" };
  } catch (e) {
    const msg = e?.message || String(e);
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      buttons: ["OK"],
      title: "Yangilanish",
      message: "O'rnatishni boshlashda xato.",
      detail: msg
    });
    refocusMain(mainWindow);
    return { ok: false, error: msg };
  } finally {
    updateUiFlowBusy = false;
  }
}

/**
 * Menyu orqali: avval diskda yuklab olingan (o'rnatilmagan) bo'lsa GitHubni emas, o'rnatishni taklif qiladi.
 * @param {import("electron").BrowserWindow | null} mainWindow
 */
async function checkForUpdatesInteractive(mainWindow) {
  if (!app.isPackaged) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        buttons: ["OK"],
        title: "Yangilanish",
        message:
          "Bu rejimda (dasturchi) tekshiruv ishlamaydi. Reliz build (.exe o'rnatuvchi) orqali tekshiring."
      });
      refocusMain(mainWindow);
    }
    return { ok: true, skipped: true, reason: "dev" };
  }

  if (updateUiFlowBusy) {
    return { ok: true, skipped: true, reason: "busy" };
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: "Oyna topilmadi." };
  }

  updateUiFlowBusy = true;
  prepareUpdater();
  attachUpdaterListeners(mainWindow);

  try {
    ensurePendingLoaded();

    if (pendingDownloaded) {
      const install = await showInstallReadyDialog(mainWindow);
      if (install) {
        clearPending();
        setImmediate(() => autoUpdater.quitAndInstall(false, true));
        return { ok: true, action: "install" };
      }
      refocusMain(mainWindow);
      return { ok: true, action: "deferred" };
    }

    const currentVer = app.getVersion();
    const check = await autoUpdater.checkForUpdates();
    if (!check || !check.isUpdateAvailable) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        buttons: ["OK"],
        title: "E-Savdo",
        message: buildNoUpdateMessage(currentVer, check)
      });
      refocusMain(mainWindow);
      return { ok: true, action: "none" };
    }

    const ver = check.updateInfo.version;
    const notes = formatReleaseNotes(check.updateInfo);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Bekor qilish", "Yuklab olish"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: "Yangi versiya",
      message: `E-Savdo ${ver} chiqarilgan. Yuklab olishni xohlaysizmi?`,
      detail: notes || undefined
    });

    if (response !== 1) {
      refocusMain(mainWindow);
      return { ok: true, action: "canceled" };
    }

    await runDownloadWithProgress(mainWindow, () =>
      autoUpdater.downloadUpdate(check.cancellationToken)
    );

    const install = await showInstallReadyDialog(mainWindow);

    if (install) {
      clearPending();
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return { ok: true, action: "install" };
    }

    refocusMain(mainWindow);
    return { ok: true, action: "deferred" };
  } catch (e) {
    clearDownloadProgressUi(mainWindow);
    const msg = e?.message || String(e);
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      buttons: ["OK"],
      title: "Yangilanish",
      message: "Tekshirish yoki yuklashda xato.",
      detail: msg
    });
    refocusMain(mainWindow);
    return { ok: false, error: msg };
  } finally {
    updateUiFlowBusy = false;
  }
}

/**
 * Ishga tushganda: yuklab olingan bo'lsa GitHub emas; boshqa holda faqat yangi versiya bo'lsa dialog.
 */
async function checkForUpdatesOnStartupQuiet(mainWindow) {
  if (!app.isPackaged || !mainWindow || mainWindow.isDestroyed()) return;
  if (userInvokedUpdateCheckThisSession) return;
  if (updateUiFlowBusy) return;

  updateUiFlowBusy = true;
  prepareUpdater();
  attachUpdaterListeners(mainWindow);

  try {
    ensurePendingLoaded();

    if (pendingDownloaded) {
      const install = await showInstallReadyDialog(mainWindow);
      if (install) {
        clearPending();
        setImmediate(() => autoUpdater.quitAndInstall(false, true));
      } else {
        refocusMain(mainWindow);
      }
      return;
    }

    const check = await autoUpdater.checkForUpdates();
    if (!check || !check.isUpdateAvailable) return;

    const ver = check.updateInfo.version;
    const notes = formatReleaseNotes(check.updateInfo);

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Keyinroq", "Yuklab olish"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: "Yangi versiya",
      message: `E-Savdo ${ver} mavjud. Hozir yuklab olishni xohlaysizmi?`,
      detail: notes || undefined
    });

    if (response !== 1) {
      refocusMain(mainWindow);
      return;
    }

    await runDownloadWithProgress(mainWindow, () =>
      autoUpdater.downloadUpdate(check.cancellationToken)
    );

    const install = await showInstallReadyDialog(mainWindow);
    refocusMain(mainWindow);

    if (install) {
      clearPending();
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    }
  } catch {
    /* tarmoq / sozlama */
  } finally {
    updateUiFlowBusy = false;
  }
}

module.exports = {
  checkForUpdatesInteractive,
  checkForUpdatesOnStartupQuiet,
  markUserInvokedUpdateCheck,
  setMainWindowGetter,
  getUpdateState,
  installPendingUpdate
};
