const { app, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");

let prepared = false;

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
    const check = await autoUpdater.checkForUpdates();
    if (!check || !check.isUpdateAvailable) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        buttons: ["OK"],
        title: "E-Savdo",
        message: "Yangi versiya topilmadi. Sizda eng so‘nggi reliz."
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

    await autoUpdater.downloadUpdate(check.cancellationToken);

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

    await autoUpdater.downloadUpdate(check.cancellationToken);

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
