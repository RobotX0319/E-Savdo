const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const XLSX = require("xlsx");
const DatabaseService = require("./database.cjs");
const warehouses = require("./warehouses.cjs");
const {
  getOrCreateMachineId,
  verifyRemoteWithRetry,
  requestRemote,
  writeLicenseCache,
  clearLicenseCache,
  getOfflineLicenseIfStillValid
} = require("./licenseClient.cjs");
const {
  checkForUpdatesInteractive,
  checkForUpdatesOnStartupQuiet,
  markUserInvokedUpdateCheck,
  setMainWindowGetter,
  getUpdateState,
  installPendingUpdate
} = require("./updater.cjs");
const {
  checkClockIntegrity,
  bumpMonotonicClock,
  recordAppClose,
  recordFirstSubscriptionIfNeeded
} = require("./licenseTimeGuard.cjs");

function resolveLicenseWorkerUrl() {
  const fromEnv = String(process.env.LICENSE_WORKER_URL || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const filePath = path.join(__dirname, "..", "license-worker.url");
    if (fs.existsSync(filePath)) {
      const first = fs.readFileSync(filePath, "utf8").split(/\r?\n/)[0];
      const line = String(first || "").trim();
      if (line && !line.startsWith("#")) return line.replace(/\/$/, "");
    }
  } catch {
    /* ignore */
  }
  return "";
}

const LICENSE_WORKER_URL = resolveLicenseWorkerUrl();
const SKIP_LICENSE = process.env.ESAVDO_SKIP_LICENSE === "1";

let mainWindow = null;
let supportWindow = null;
let dbService = null;
let appDbPath = null;

function createSupportWindow() {
  if (supportWindow && !supportWindow.isDestroyed()) {
    supportWindow.focus();
    return;
  }
  supportWindow = new BrowserWindow({
    width: 440,
    height: 620,
    minWidth: 340,
    minHeight: 420,
    title: "E-Savdo — Support",
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  supportWindow.removeMenu?.();
  if (app.isPackaged) {
    supportWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"), { query: { mode: "support" } });
  } else {
    supportWindow.loadURL("http://localhost:5173/?mode=support");
  }
  supportWindow.on("closed", () => {
    supportWindow = null;
  });
}

async function supportFetchJson(postPath, bodyObj) {
  const base = String(LICENSE_WORKER_URL || "").trim().replace(/\/$/, "");
  if (!base) throw new Error("worker_not_configured");
  const r = await fetch(`${base}${postPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj || {})
  });
  const j = await r.json().catch(() => ({}));
  return { okHttp: r.ok, status: r.status, j };
}

function isSqliteDatabaseFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    return buf.slice(0, 15).toString("ascii") === "SQLite format 3" && buf[15] === 0;
  } catch {
    return false;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  } else {
    mainWindow.loadURL("http://localhost:5173");
  }
}

function registerIpc() {
  /** Electron da window.confirm Windows fokusini buzadi — native dialog + fokus tiklash */
  ipcMain.handle("app:show-confirm", async (_, payload) => {
    const title = payload?.title || "Tasdiqlash";
    const message = payload?.message || "";
    const detail = payload?.detail || "";
    const confirmLabel = payload?.confirmLabel || "Tasdiqlash";
    if (!mainWindow) {
      return { ok: false, canceled: true };
    }
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["Bekor qilish", confirmLabel],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title,
      message,
      detail
    });
    mainWindow.focus();
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.focus();
    }
    return { ok: response === 1 };
  });

  ipcMain.handle("app:focus-window", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.focus();
      }
    }
    return { ok: true };
  });

  ipcMain.handle("app:get-version", () => {
    let appId = "";
    let productName = "E-Savdo";
    try {
      const pkg = require(path.join(__dirname, "..", "package.json"));
      appId = String(pkg.build?.appId || "");
      const fromBuild = String(pkg.build?.productName || "").trim();
      productName = fromBuild || "E-Savdo";
    } catch {
      /* ignore */
    }
    return {
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      appId,
      productName
    };
  });

  ipcMain.handle("app:check-for-updates", async () => {
    markUserInvokedUpdateCheck();
    return checkForUpdatesInteractive(mainWindow);
  });

  ipcMain.handle("app:get-update-state", () => getUpdateState());

  ipcMain.handle("app:install-pending-update", async () => installPendingUpdate(mainWindow));

  ipcMain.handle("warehouses:list", async () => {
    const userData = app.getPath("userData");
    return { ok: true, ...warehouses.getListForRenderer(userData) };
  });

  ipcMain.handle("warehouses:switch", async (_, warehouseId) => {
    const userData = app.getPath("userData");
    const w = warehouses.findWarehouseFile(userData, warehouseId);
    if (!w) return { ok: false, error: "not_found" };
    const newPath = warehouses.getDbFilePathForWarehouse(userData, w);
    if (appDbPath && path.resolve(newPath) === path.resolve(appDbPath)) {
      return { ok: true, already: true, ...warehouses.getListForRenderer(userData) };
    }
    const prev = dbService;
    try {
      const next = new DatabaseService(newPath);
      await next.init();
      if (prev) prev.close();
      dbService = next;
      appDbPath = newPath;
      const setr = warehouses.setActiveWarehouseId(userData, w.id);
      if (!setr.ok) {
        return { ok: false, error: setr.error || "active_save_failed" };
      }
      return { ok: true, ...warehouses.getListForRenderer(userData) };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle("warehouses:create", async (_, payload) => {
    const name = String(payload?.name || "").trim();
    if (!name) return { ok: false, error: "empty_name" };
    if (name.length > 120) return { ok: false, error: "name_too_long" };
    const userData = app.getPath("userData");
    const id = warehouses.newWarehouseId();
    const file = `${id}.sqlite`;
    const fullPath = path.join(warehouses.getWarehousesDir(userData), file);
    if (fs.existsSync(fullPath)) {
      return { ok: false, error: "file_exists" };
    }
    const prevDb = dbService;
    const prevPath = appDbPath;
    try {
      const next = new DatabaseService(fullPath);
      await next.init();
      if (prevDb) prevDb.close();
      dbService = next;
      appDbPath = fullPath;
      warehouses.addWarehouseToRegistry(userData, { id, name, file });
      return { ok: true, ...warehouses.getListForRenderer(userData) };
    } catch (e) {
      try {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch {
        /* ignore */
      }
      if (dbService && appDbPath === fullPath) {
        try {
          dbService.close();
        } catch {
          /* ignore */
        }
        dbService = null;
        appDbPath = null;
      }
      if (prevPath) {
        try {
          const recover = new DatabaseService(prevPath);
          await recover.init();
          dbService = recover;
          appDbPath = prevPath;
        } catch {
          /* ignore */
        }
      }
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle("dashboard:get", async () => dbService.getDashboard());
  ipcMain.handle("seller-profile:get", async () => dbService.getSellerProfile());
  ipcMain.handle("seller-profile:update", async (_, payload) => dbService.updateSellerProfile(payload));

  ipcMain.handle("products:list", async () => dbService.listProducts());
  ipcMain.handle("products:create", async (_, payload) => dbService.createProduct(payload));
  ipcMain.handle("products:update", async (_, payload) => dbService.updateProduct(payload));
  ipcMain.handle("products:deactivate", async (_, id) => dbService.deactivateProduct(id));

  ipcMain.handle("inventory:adjust", async (_, payload) => dbService.adjustInventory(payload));

  ipcMain.handle("customers:list", async () => dbService.listCustomers());
  ipcMain.handle("customers:create", async (_, payload) => dbService.createCustomer(payload));
  ipcMain.handle("customers:update", async (_, payload) => dbService.updateCustomer(payload));
  ipcMain.handle("customers:delete", async (_, customerId) => dbService.deleteCustomer(customerId));

  ipcMain.handle("customer-chat:list", async (_, customerId, limit) =>
    dbService.listCustomerChatMessages(customerId, limit)
  );
  ipcMain.handle("customer-chat:append", async (_, payload) => dbService.appendCustomerChatMessage(payload));

  ipcMain.handle("sale-drafts:listByCustomer", async (_, customerId) =>
    dbService.listSaleDraftsByCustomer(customerId)
  );
  ipcMain.handle("sale-drafts:create", async (_, payload) => dbService.createSaleDraft(payload));
  ipcMain.handle("sale-drafts:update", async (_, payload) => dbService.updateSaleDraft(payload));
  ipcMain.handle("sale-drafts:finalize", async (_, payload) => dbService.finalizeSaleDraft(payload));
  ipcMain.handle("sale-drafts:delete", async (_, draftId) => dbService.deleteSaleDraft(draftId));

  ipcMain.handle("sales:create", async (_, payload) => dbService.createSale(payload));
  ipcMain.handle("sales:apply-line-returns", async (_, payload) =>
    dbService.applySaleLineReturns(payload)
  );
  ipcMain.handle("sales:list", async (_, limit) => dbService.listSales(limit));
  ipcMain.handle("sales:listByCustomer", async (_, customerId, limit) =>
    dbService.listSalesByCustomer(customerId, limit)
  );

  ipcMain.handle("reports:summary", async (_, payload) => dbService.reportSummary(payload));

  ipcMain.handle("data:import-products", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import faylni tanlang",
      properties: ["openFile"],
      filters: [{ name: "Import Files", extensions: ["csv", "xls", "xlsx"] }]
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { ok: false, canceled: true };
    }

    try {
      const filePath = result.filePaths[0];
      const workbook = XLSX.readFile(filePath, { raw: false });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) {
        return { ok: false, error: "Fayl ichida sheet topilmadi." };
      }
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
        defval: "",
        raw: false
      });
      const importResult = dbService.importProductsFromRows(rows);
      return {
        ...importResult,
        file: filePath,
        sheet: firstSheet
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("data:export-inventory", async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Ombor ma'lumotini export qilish",
      defaultPath: "ombor-export.xlsx",
      filters: [
        { name: "Excel XLSX", extensions: ["xlsx"] },
        { name: "Excel XLS", extensions: ["xls"] },
        { name: "CSV", extensions: ["csv"] }
      ]
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    try {
      const rows = dbService.getInventoryExportRows();
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Ombor");
      const extension = path.extname(result.filePath).replace(".", "").toLowerCase() || "xlsx";
      const bookType = extension === "xls" ? "biff8" : extension === "csv" ? "csv" : "xlsx";
      XLSX.writeFile(workbook, result.filePath, { bookType });
      return { ok: true, file: result.filePath, rows: rows.length };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("data:backup", async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "DB backup saqlash",
      defaultPath: "e-savdo-backup.sqlite",
      filters: [{ name: "SQLite", extensions: ["sqlite", "db"] }]
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }
    fs.copyFileSync(dbService.dbPath, result.filePath);
    return { ok: true, file: result.filePath };
  });

  ipcMain.handle("data:restore-backup", async () => {
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: "DB backupni tiklash (import)",
      properties: ["openFile"],
      filters: [{ name: "SQLite", extensions: ["sqlite", "db"] }]
    });
    if (pick.canceled || !pick.filePaths?.[0]) {
      return { ok: false, canceled: true };
    }
    const sourcePath = pick.filePaths[0];
    if (!isSqliteDatabaseFile(sourcePath)) {
      return { ok: false, error: "Tanlangan fayl SQLite bazasi emas yoki buzilgan." };
    }

    const safetyPath = `${appDbPath}.pre-restore`;
    try {
      if (fs.existsSync(appDbPath)) {
        fs.copyFileSync(appDbPath, safetyPath);
      }
      dbService.close();
      fs.copyFileSync(sourcePath, appDbPath);
      const next = new DatabaseService(appDbPath);
      await next.init();
      dbService = next;
      if (fs.existsSync(safetyPath)) {
        fs.unlinkSync(safetyPath);
      }
      return { ok: true, file: sourcePath };
    } catch (error) {
      try {
        dbService.close();
      } catch {
        /* ignore */
      }
      try {
        if (fs.existsSync(safetyPath)) {
          fs.copyFileSync(safetyPath, appDbPath);
          fs.unlinkSync(safetyPath);
        }
      } catch {
        /* ignore */
      }
      try {
        dbService = new DatabaseService(appDbPath);
        await dbService.init();
      } catch {
        dbService = null;
      }
      return { ok: false, error: error.message || String(error) };
    }
  });

  ipcMain.handle("license:get-status", async () => {
    if (SKIP_LICENSE) {
      return { valid: true, skipped: true, machineId: "dev-skip" };
    }
    const userDataDir = app.getPath("userData");
    const machineId = getOrCreateMachineId(userDataDir);

    const integrity = checkClockIntegrity(userDataDir);
    if (!integrity.ok) {
      clearLicenseCache(userDataDir);
      return {
        valid: false,
        machineId,
        error: "clock_tamper",
        message:
          "Qurilma vaqti noto‘g‘ri (ortga surilgan) yoki litsenziya bilan bog‘langan vaqt buzilgan. To‘g‘ri vaqtni sozlang, internetga ulaning va «Litsenziyani tekshirish» ni bosing.",
        clockReason: integrity.reason
      };
    }
    bumpMonotonicClock(userDataDir);

    if (!LICENSE_WORKER_URL) {
      return {
        valid: false,
        machineId,
        error: "worker_not_configured"
      };
    }

    const offline = getOfflineLicenseIfStillValid(userDataDir, machineId);
    if (offline) {
      return offline;
    }

    try {
      const v = await verifyRemoteWithRetry(LICENSE_WORKER_URL, machineId);
      const valid = Boolean(v && v.valid === true);
      if (valid) {
        writeLicenseCache(userDataDir, {
          machineId,
          valid: true,
          plan: v?.plan,
          expiresAt: v?.expiresAt,
          label: v?.label
        });
        recordFirstSubscriptionIfNeeded(userDataDir);
      } else {
        clearLicenseCache(userDataDir);
      }
      return {
        machineId,
        valid,
        plan: v?.plan,
        expiresAt: v?.expiresAt,
        label: v?.label
      };
    } catch (e) {
      return {
        valid: false,
        machineId,
        error: "verify_failed",
        message: e.message || String(e)
      };
    }
  });

  ipcMain.handle("license:submit-request", async (_, payload) => {
    if (SKIP_LICENSE) {
      return { ok: true, skipped: true };
    }
    const plan = String(payload?.plan || "");
    const contact = String(payload?.contact || "");
    const fullName = String(payload?.fullName || "");
    const userDataDir = app.getPath("userData");
    const machineId = getOrCreateMachineId(userDataDir);
    if (!LICENSE_WORKER_URL) {
      return { ok: false, error: "worker_not_configured" };
    }
    try {
      return await requestRemote(LICENSE_WORKER_URL, machineId, plan, contact, fullName);
    } catch (e) {
      return {
        ok: false,
        error: e.code || "request_failed",
        message: e.message || String(e),
        payload: e.payload
      };
    }
  });

  ipcMain.handle("support:open-window", () => {
    createSupportWindow();
    return { ok: true };
  });

  ipcMain.handle("support:fetch-history", async () => {
    if (SKIP_LICENSE) {
      return {
        ok: true,
        skipped: true,
        messages: [],
        unreadByUser: 0
      };
    }
    const userDataDir = app.getPath("userData");
    const machineId = getOrCreateMachineId(userDataDir);
    try {
      const { okHttp, j } = await supportFetchJson("/api/support/history", { machineId });
      if (!okHttp || !j.ok) {
        return {
          ok: false,
          error: j.error || "history_failed",
          messages: [],
          unreadByUser: 0
        };
      }
      return {
        ok: true,
        messages: Array.isArray(j.messages) ? j.messages : [],
        unreadByUser: Number(j.unreadByUser || 0) || 0
      };
    } catch (e) {
      return {
        ok: false,
        error: e?.message === "worker_not_configured" ? "worker_not_configured" : "network",
        messages: [],
        unreadByUser: 0
      };
    }
  });

  ipcMain.handle("support:send-message", async (_, text) => {
    const body = String(text || "").trim();
    if (!body) {
      return { ok: false, error: "empty" };
    }
    if (SKIP_LICENSE) {
      return { ok: false, error: "skipped", message: "Demo rejimida qo'llab-quvvatlash yozishmasi mavjud emas." };
    }
    const userDataDir = app.getPath("userData");
    const machineId = getOrCreateMachineId(userDataDir);
    try {
      const { okHttp, j } = await supportFetchJson("/api/support/send", {
        machineId,
        text: body.slice(0, 4000)
      });
      if (!okHttp || !j.ok) {
        if (j.error === "rate_limit") {
          return { ok: false, error: "rate_limit", message: "Cheklov: birozdan keyin urinib ko'ring." };
        }
        return {
          ok: false,
          error: j.error || "send_failed",
          message: j.message
        };
      }
      return { ok: true, message: j.message };
    } catch (e) {
      return {
        ok: false,
        error: e?.message === "worker_not_configured" ? "worker_not_configured" : "network"
      };
    }
  });

  ipcMain.handle("support:ack-staff-unread", async () => {
    if (SKIP_LICENSE) {
      return { ok: true, skipped: true };
    }
    const userDataDir = app.getPath("userData");
    const machineId = getOrCreateMachineId(userDataDir);
    try {
      await supportFetchJson("/api/support/ack-user", { machineId });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  const wstate = warehouses.prepareOnStartup(app.getPath("userData"));
  appDbPath = wstate.appDbPath;
  dbService = new DatabaseService(appDbPath);
  await dbService.init();
  registerIpc();
  createWindow();
  setMainWindowGetter(() => mainWindow);

  if (app.isPackaged) {
    const delayMs = 12_000;
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        void checkForUpdatesOnStartupQuiet(mainWindow);
      }
    }, delayMs);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (!SKIP_LICENSE) {
    try {
      recordAppClose(app.getPath("userData"));
    } catch {
      /* ignore */
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
