const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  showConfirm: (payload) => ipcRenderer.invoke("app:show-confirm", payload),
  focusWindow: () => ipcRenderer.invoke("app:focus-window"),
  getAppVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),

  getDashboard: () => ipcRenderer.invoke("dashboard:get"),
  getSellerProfile: () => ipcRenderer.invoke("seller-profile:get"),
  updateSellerProfile: (payload) => ipcRenderer.invoke("seller-profile:update", payload),

  listProducts: () => ipcRenderer.invoke("products:list"),
  createProduct: (payload) => ipcRenderer.invoke("products:create", payload),
  updateProduct: (payload) => ipcRenderer.invoke("products:update", payload),

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
  listSales: (limit) => ipcRenderer.invoke("sales:list", limit),
  listSalesByCustomer: (customerId, limit) =>
    ipcRenderer.invoke("sales:listByCustomer", customerId, limit),

  getReportSummary: (payload) => ipcRenderer.invoke("reports:summary", payload),

  importProductsData: () => ipcRenderer.invoke("data:import-products"),
  exportInventoryData: () => ipcRenderer.invoke("data:export-inventory"),
  backupData: () => ipcRenderer.invoke("data:backup"),
  restoreDatabaseBackup: () => ipcRenderer.invoke("data:restore-backup"),

  licenseGetStatus: () => ipcRenderer.invoke("license:get-status"),
  licenseSubmitRequest: (payload) => ipcRenderer.invoke("license:submit-request", payload)
});
