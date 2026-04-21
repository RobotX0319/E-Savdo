const path = require("path");
const { app, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const semver = require("semver");

let prepared = false;

function releasesPageHint() {
  try {
    const pkg = require(path.join(__dirname, "..", "package.json"));
    const raw = String(pkg.repository?.url || "").trim();
    const m = raw.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
    if (m) {
      return `https://github.com/${m[1]}/${m[2]}/releases`;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function prepareUpdater() {
  if (prepared) return;
  prepared = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
}

function refocusMain(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.focus();
  if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.focus();
  }
}

/**
 * @param {import("electron").BrowserWindow | null} mainWindow
 * @param {import("electron-updater").ProgressInfo} info
 */
function emitDownloadProgress(mainWindow, info) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (!wc || wc.isDestroyed()) return;
  const pct = typeof info?.percent === "number" ? info.percent : 0;
  wc.send("update:download-progress", {
    percent: pct,
    transferred: info?.transferred,
    total: info?.total
  });
  try {
    mainWindow.setProgressBar(Math.min(1, Math.max(0, pct / 100)));
  } catch {
    /* ignore */
  }
}

/**
 * @param {import("electron").BrowserWindow | null} mainWindow
 */
function clearDownloadProgressUi(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setProgressBar(-1);
  } catch {
    /* ignore */
  }
  const wc = mainWindow.webContents;
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
    clearDownloadProgressUi(mainWindow);
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

/**
 * isUpdateAvailable === false bo‘lsa ham updateInfo da serverdagi eng so‘nggi versiya bo‘ladi.
 */
function buildNoUpdateDialog(currentVer, check) {
  const remoteVer = check?.updateInfo?.version;
  const rel = compareWithRemote(currentVer, remoteVer);

  if (rel === "equal") {
    return {
      message: `Yangi versiya topilmadi. Sizda va rasmiy relizdagi versiya bir xil: ${currentVer}.`,
      detail:
        "Avtomatik yangilanish faqat GitHub’da Releases bo‘limida yangi installer va latest.yml chiqarilganda ishlaydi. Kod yangilangan bo‘lsa-yu reliz chiqarilmagan bo‘lsa, yangi .exe ni qo‘lda yuklab o‘rnating."
    };
  }
  if (rel === "newer") {
    return {
      message: `Serverda yangiroq reliz ko‘rsatilmoqda (${remoteVer}), lekin dastur uni hozir taklif qilmayapti.`,
      detail: `Sizda o‘rnatilgan: ${currentVer}. Bunday holat staging (foydalanuvchilarga bosqichma-bosqich chiqarish), moslik tekshiruvi yoki boshqa cheklovlar tufayli bo‘lishi mumkin. Kerak bo‘lsa GitHub Releases dan qo‘lda yuklab oling.`
    };
  }
  if (rel === "older") {
    return {
      message: `Sizda (${currentVer}) rasmiy reliz (${remoteVer}) dan yangiroq — bu odatda sinov yoki maxsus yig‘ma build.`,
      detail: ""
    };
  }
  const releasesUrl = releasesPageHint();
  const releasesLine = releasesUrl
    ? `Internet va ${releasesUrl} manzilini tekshiring.`
    : "Internet va GitHub’dagi Releases sahifasini tekshiring.";
  return {
    message: `Tekshiruv tugadi. Sizdagi versiya: ${currentVer}.`,
    detail: remoteVer
      ? `Server javobidagi versiya: ${remoteVer}.`
      : `GitHub’da latest.yml yoki reliz topilmadi yoki tarmoq xatosi bo‘lishi mumkin. ${releasesLine}`
  };
}

/**
 * Menyu orqali: yangi bo‘lmasa ham xabar beradi.
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
          "Bu rejimda (dasturchi) tekshiruv ishlamaydi. Reliz build (.exe o‘rnatuvchi) orqali tekshiring."
      });
      refocusMain(mainWindow);
    }
    return { ok: true, skipped: true, reason: "dev" };
  }

  prepareUpdater();

  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: "Oyna topilmadi." };
  }

  try {
    const currentVer = app.getVersion();
    const check = await autoUpdater.checkForUpdates();
    if (!check || !check.isUpdateAvailable) {
      const { message, detail } = buildNoUpdateDialog(currentVer, check);
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        buttons: ["OK"],
        title: "E-Savdo",
        message,
        detail: detail || undefined
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

    const r2 = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Keyinroq", "O‘rnatish va qayta ishga tushirish"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: "Yangilanish tayyor",
      message: "O‘rnatish boshlanadi; dastur yopiladi."
    });

    refocusMain(mainWindow);

    if (r2.response === 1) {
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    }

    return { ok: true, action: r2.response === 1 ? "install" : "deferred" };
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
  }
}

/**
 * Ishga tushganda: faqat yangi versiya bo‘lsa dialog (xatolikni yashirish).
 * NSIS o‘rnatuvchi uchun mo‘ljallangan; portable da o‘rnatish boshqacha bo‘lishi mumkin.
 */
async function checkForUpdatesOnStartupQuiet(mainWindow) {
  if (!app.isPackaged || !mainWindow || mainWindow.isDestroyed()) return;

  prepareUpdater();

  try {
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

    const r2 = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Keyinroq", "O‘rnatish va qayta ishga tushirish"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: "Tayyor",
      message: "O‘rnatish uchun dastur yopiladi."
    });

    refocusMain(mainWindow);

    if (r2.response === 1) {
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    }
  } catch {
    /* tarmoq / sozlama: foydalanuvchini bezovta qilmaslik */
  }
}

module.exports = {
  checkForUpdatesInteractive,
  checkForUpdatesOnStartupQuiet
};
