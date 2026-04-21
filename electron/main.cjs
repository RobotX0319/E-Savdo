const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const XLSX = require("xlsx");
const DatabaseService = require("./database.cjs");
const {
  getOrCreateMachineId,
  verifyRemoteWithRetry,
  requestRemote
} = require("./licenseClient.cjs");
const {
  checkForUpdatesInteractive,
  checkForUpdatesOnStartupQuiet
} = require("./updater.cjs");

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
let dbService = null;
let appDbPath = null;

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
    let productName = "";
    try {
      const pkg = require(path.join(__dirname, "..", "package.json"));
      appId = String(pkg.build?.appId || "");
      productName = String(pkg.build?.productName || pkg.name || "");
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

  ipcMain.handle("app:check-for-updates", async () => checkForUpdatesInteractive(mainWindow));

  ipcMain.handle("dashboard:get", async () => dbService.getDashboard());
  ipcMain.handle("seller-profile:get", async () => dbService.getSellerProfile());
  ipcMain.handle("seller-profile:update", async (_, payload) => dbService.updateSellerProfile(payload));

  ipcMain.handle("products:list", async () => dbService.listProducts());
  ipcMain.handle("products:create", async (_, payload) => dbService.createProduct(payload));
  ipcMain.handle("products:update", async (_, payload) => dbService.updateProduct(payload));

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
    if (!LICENSE_WORKER_URL) {
      return {
        valid: false,
        machineId,
        error: "worker_not_configured"
      };
    }
    try {
      const v = await verifyRemoteWithRetry(LICENSE_WORKER_URL, machineId);
      const valid = Boolean(v && v.valid === true);
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
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  appDbPath = path.join(app.getPath("userData"), "e-savdo.sqlite");
  dbService = new DatabaseService(appDbPath);
  await dbService.init();
  registerIpc();
  createWindow();

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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
