const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  showConfirm: (payload) => ipcRenderer.invoke("app:show-confirm", payload),
  focusWindow: () => ipcRenderer.invoke("app:focus-window"),
  getAppVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  getUpdateState: () => ipcRenderer.invoke("app:get-update-state"),
  installPendingUpdate: () => ipcRenderer.invoke("app:install-pending-update"),
  /**
   * @param {(payload: { version: string } | null) => void} callback
   * @returns {() => void}
   */
  onUpdatePendingInstall: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const channel = "update:pending-install";
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  /**
   * @param {(payload: { percent: number; transferred?: number; total?: number } | null) => void} callback
   * @returns {() => void}
   */
  onUpdateDownloadProgress: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const channel = "update:download-progress";
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  getDashboard: () => ipcRenderer.invoke("dashboard:get"),
  getSellerProfile: () => ipcRenderer.invoke("seller-profile:get"),
  updateSellerProfile: (payload) => ipcRenderer.invoke("seller-profile:update", payload),

  listProducts: () => ipcRenderer.invoke("products:list"),
  createProduct: (payload) => ipcRenderer.invoke("products:create", payload),
  updateProduct: (payload) => ipcRenderer.invoke("products:update", payload),
  deactivateProduct: (id) => ipcRenderer.invoke("products:deactivate", id),

  adjustInventory: (payload) => ipcRenderer.invoke("inventory:adjust", payload),

  listCustomers: () => ipcRenderer.invoke("customers:list"),
  createCustomer: (payload) => ipcRenderer.invoke("customers:create", payload),
  updateCustomer: (payload) => ipcRenderer.invoke("customers:update", payload),
  deleteCustomer: (customerId) => ipcRenderer.invoke("customers:delete", customerId),

  listCustomerChatMessages: (customerId, limit) =>
    ipcRenderer.invoke("customer-chat:list", customerId, limit),
  appendCustomerChatMessage: (payload) => ipcRenderer.invoke("customer-chat:append", payload),

  listSaleDraftsByCustomer: (customerId) =>
    ipcRenderer.invoke("sale-drafts:listByCustomer", customerId),
  createSaleDraft: (payload) => ipcRenderer.invoke("sale-drafts:create", payload),
  updateSaleDraft: (payload) => ipcRenderer.invoke("sale-drafts:update", payload),
  finalizeSaleDraft: (payload) => ipcRenderer.invoke("sale-drafts:finalize", payload),
  deleteSaleDraft: (draftId) => ipcRenderer.invoke("sale-drafts:delete", draftId),

  createSale: (payload) => ipcRenderer.invoke("sales:create", payload),
  applySaleLineReturns: (payload) => ipcRenderer.invoke("sales:apply-line-returns", payload),
  listSales: (limit) => ipcRenderer.invoke("sales:list", limit),
  listSalesByCustomer: (customerId, limit) =>
    ipcRenderer.invoke("sales:listByCustomer", customerId, limit),

  getReportSummary: (payload) => ipcRenderer.invoke("reports:summary", payload),

  importProductsData: () => ipcRenderer.invoke("data:import-products"),
  exportInventoryData: () => ipcRenderer.invoke("data:export-inventory"),
  backupData: () => ipcRenderer.invoke("data:backup"),
  restoreDatabaseBackup: () => ipcRenderer.invoke("data:restore-backup"),

  listWarehouses: () => ipcRenderer.invoke("warehouses:list"),
  switchWarehouse: (warehouseId) => ipcRenderer.invoke("warehouses:switch", warehouseId),
  createWarehouse: (payload) => ipcRenderer.invoke("warehouses:create", payload),

  licenseGetStatus: () => ipcRenderer.invoke("license:get-status"),
  licenseSubmitRequest: (payload) => ipcRenderer.invoke("license:submit-request", payload),

  /** Aloqa markazi: yangi Electron oyna + worker API */
  supportOpenWindow: () => ipcRenderer.invoke("support:open-window"),
  supportFetchHistory: () => ipcRenderer.invoke("support:fetch-history"),
  supportSendMessage: (text) => ipcRenderer.invoke("support:send-message", text),
  supportAckStaffUnread: () => ipcRenderer.invoke("support:ack-staff-unread")
});
