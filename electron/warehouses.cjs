const fs = require("fs");
const path = require("path");

const WAREHOUSES_DIR_NAME = "warehouses";
const REGISTRY_FILE = "warehouses.json";

function getWarehousesDir(userDataPath) {
  return path.join(String(userDataPath), WAREHOUSES_DIR_NAME);
}

function getRegistryPath(userDataPath) {
  return path.join(getWarehousesDir(userDataPath), REGISTRY_FILE);
}

function newWarehouseId() {
  return `wh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function readRegistryFile(userDataPath) {
  const p = getRegistryPath(userDataPath);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeRegistryFile(userDataPath, data) {
  const dir = getWarehousesDir(userDataPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getRegistryPath(userDataPath), JSON.stringify(data, null, 2), "utf8");
}

/**
 * Foydalanuvchi o'chirib yuborgan fayl yozuvlarini tozalaydi. Hech qaysi fayl
 * bo‘lmasa (birinchi ishga tushish) — reestr o‘zgarizsiz: DB keyin yaratiladi.
 */
function repairRegistryIfNeeded(userDataPath, reg) {
  const dir = getWarehousesDir(userDataPath);
  if (!reg || !Array.isArray(reg.warehouses)) {
    return null;
  }
  const mapped = reg.warehouses
    .filter((w) => w && w.id && typeof w.file === "string")
    .map((w) => ({
      id: String(w.id),
      name: String(w.name || "").trim() || "Nomsiz ombor",
      file: w.file
    }));
  if (!mapped.length) return null;

  const onDisk = mapped.filter((w) => fs.existsSync(path.join(dir, w.file)));
  const use = onDisk.length > 0 ? onDisk : mapped;
  if (!use.length) return null;
  let active = String(reg.activeWarehouseId || "");
  if (!use.some((v) => v.id === active)) {
    active = use[0].id;
  }
  const next = { version: 1, activeWarehouseId: active, warehouses: use };
  writeRegistryFile(userDataPath, next);
  return next;
}

/**
 * Bitta legacy e-savdo.sqlite → warehouses/ichiga ko‘chirish va reestr yaratish.
 * Yangi o‘rnatishda bitta bo‘sh ombor.
 */
function materializeFirstRegistry(userDataPath) {
  const dir = getWarehousesDir(userDataPath);
  fs.mkdirSync(dir, { recursive: true });
  const regPath = getRegistryPath(userDataPath);
  if (fs.existsSync(regPath)) {
    return null;
  }

  const legacy = path.join(String(userDataPath), "e-savdo.sqlite");
  if (fs.existsSync(legacy)) {
    const id = newWarehouseId();
    const file = `${id}.sqlite`;
    const target = path.join(dir, file);
    try {
      fs.renameSync(legacy, target);
    } catch {
      fs.copyFileSync(legacy, target);
      try {
        fs.unlinkSync(legacy);
      } catch {
        /* ignore */
      }
    }
    const reg = {
      version: 1,
      activeWarehouseId: id,
      warehouses: [{ id, name: "Asosiy ombor", file }]
    };
    writeRegistryFile(userDataPath, reg);
    return reg;
  }

  const id = newWarehouseId();
  const file = `${id}.sqlite`;
  const reg = {
    version: 1,
    activeWarehouseId: id,
    warehouses: [{ id, name: "Asosiy ombor", file }]
  };
  writeRegistryFile(userDataPath, reg);
  return reg;
}

/**
 * Ilovani ishga tushirishdan oldin: jild, migratsiya, reestr, tanlangan DB fayl yo‘li.
 * Fayl hali bo‘lmasa ham maydon to‘g‘ri — `DatabaseService.init` yaratadi.
 */
function prepareOnStartup(userDataPath) {
  const dir = getWarehousesDir(userDataPath);
  fs.mkdirSync(dir, { recursive: true });
  let reg = readRegistryFile(userDataPath) || materializeFirstRegistry(userDataPath);
  if (!reg) {
    materializeFirstRegistry(userDataPath);
    reg = readRegistryFile(userDataPath);
  }
  reg = repairRegistryIfNeeded(userDataPath, reg);
  if (!reg) {
    const id = newWarehouseId();
    const file = `${id}.sqlite`;
    reg = {
      version: 1,
      activeWarehouseId: id,
      warehouses: [{ id, name: "Asosiy ombor", file }]
    };
    writeRegistryFile(userDataPath, reg);
  }
  const activeId = reg.activeWarehouseId;
  const wh = (reg.warehouses || []).find((w) => w.id === activeId) || (reg.warehouses || [])[0];
  if (!wh) {
    throw new Error("warehouses_registry_empty");
  }
  const appDbPath = path.join(dir, wh.file);
  return { appDbPath, registry: reg };
}

function getListForRenderer(userDataPath) {
  const reg = readRegistryFile(userDataPath) || { warehouses: [], activeWarehouseId: null };
  const repaired = repairRegistryIfNeeded(userDataPath, reg) || reg;
  return {
    activeId: repaired.activeWarehouseId,
    warehouses: (repaired.warehouses || []).map((w) => ({
      id: w.id,
      name: w.name
    }))
  };
}

function findWarehouseFile(userDataPath, id) {
  const reg = readRegistryFile(userDataPath);
  if (!reg) return null;
  return (reg.warehouses || []).find((w) => String(w.id) === String(id)) || null;
}

function getDbFilePathForWarehouse(userDataPath, warehouse) {
  return path.join(getWarehousesDir(userDataPath), warehouse.file);
}

function setActiveWarehouseId(userDataPath, id) {
  const reg = readRegistryFile(userDataPath);
  if (!reg) return { ok: false, error: "no_registry" };
  const w = (reg.warehouses || []).find((x) => String(x.id) === String(id));
  if (!w) return { ok: false, error: "not_found" };
  reg.activeWarehouseId = w.id;
  writeRegistryFile(userDataPath, reg);
  return { ok: true, warehouse: w };
}

function addWarehouseToRegistry(userDataPath, record) {
  const reg = readRegistryFile(userDataPath) || { version: 1, activeWarehouseId: null, warehouses: [] };
  reg.warehouses = reg.warehouses || [];
  reg.warehouses.push(record);
  reg.activeWarehouseId = record.id;
  writeRegistryFile(userDataPath, reg);
  return reg;
}

module.exports = {
  getWarehousesDir,
  getRegistryPath,
  prepareOnStartup,
  getListForRenderer,
  findWarehouseFile,
  getDbFilePathForWarehouse,
  setActiveWarehouseId,
  addWarehouseToRegistry,
  newWarehouseId,
  readRegistryFile
};
