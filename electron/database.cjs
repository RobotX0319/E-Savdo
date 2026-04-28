const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

function qtyIsFractionalUnit(unit) {
  const u = String(unit ?? "")
    .toLowerCase()
    .trim()
    .replace(/\u00a0/g, " ");
  if (!u) return false;
  const c = u.replace(/\s+/g, "").replace(/²/g, "2");
  if (c === "kg" || c === "кг" || c === "g" || c === "г" || c === "gr" || c === "gramm")
    return true;
  if (u.includes("kg") || u.includes("кг")) return true;
  if (u.includes("m²") || u.includes("m2") || u.includes("mkv") || u.includes("kvm")) return true;
  if (u.includes("kv.m") || u.includes("kv/m") || u.includes("m^2")) return true;
  if (c === "m" || c === "meter" || c === "metr" || c === "метр" || c === "м") return true;
  return false;
}

function qtyRound3(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function qtyNormalizeSale(unit, rawQty) {
  const n = Number(String(rawQty).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (qtyIsFractionalUnit(unit)) {
    const r = qtyRound3(n);
    if (r < 0.001) return null;
    return r;
  }
  const int = Math.round(n);
  if (int < 1) return null;
  if (Math.abs(n - int) > 1e-5) return null;
  return int;
}

function qtyExceedsStock(qtySel, stock) {
  return qtyRound3(qtySel) - qtyRound3(Number(stock)) > 1e-6;
}

class DatabaseService {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.SQL = null;
    this.db = null;
  }

  async init() {
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    this.SQL = await initSqlJs({
      locateFile: () => wasmPath
    });

    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(fileBuffer);
    } else {
      this.db = new this.SQL.Database();
    }

    this.db.exec("PRAGMA foreign_keys = ON;");
    this.runMigrations();
    this.persist();
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        /* ignore */
      }
      this.db = null;
    }
    this.SQL = null;
  }

  runMigrations() {
    const currentVersion = this.getUserVersion();
    if (currentVersion < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          unit TEXT NOT NULL DEFAULT 'dona',
          purchase_price_minor INTEGER NOT NULL DEFAULT 0,
          sale_price_minor INTEGER NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS inventory_balances (
          product_id INTEGER PRIMARY KEY,
          quantity INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (product_id) REFERENCES products (id)
        );

        CREATE TABLE IF NOT EXISTS inventory_movements (
          id INTEGER PRIMARY KEY,
          product_id INTEGER NOT NULL,
          delta_qty INTEGER NOT NULL,
          reason TEXT NOT NULL,
          ref_type TEXT,
          ref_id INTEGER,
          note TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (product_id) REFERENCES products (id)
        );

        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          phone TEXT UNIQUE,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sales (
          id INTEGER PRIMARY KEY,
          customer_id INTEGER,
          sold_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'completed',
          total_minor INTEGER NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (customer_id) REFERENCES customers (id)
        );

        CREATE TABLE IF NOT EXISTS sale_items (
          id INTEGER PRIMARY KEY,
          sale_id INTEGER NOT NULL,
          product_id INTEGER NOT NULL,
          qty INTEGER NOT NULL,
          unit_price_minor INTEGER NOT NULL,
          line_total_minor INTEGER NOT NULL,
          FOREIGN KEY (sale_id) REFERENCES sales (id),
          FOREIGN KEY (product_id) REFERENCES products (id)
        );
      `);
      this.setUserVersion(1);
    }
    if (this.getUserVersion() < 2) {
      const cols = this.selectAll("PRAGMA table_info(products);");
      const hasSku = cols.some((c) => c.name === "sku");
      if (hasSku) {
        try {
          this.db.exec("ALTER TABLE products DROP COLUMN sku;");
        } catch {
          this.db.exec("PRAGMA foreign_keys = OFF;");
          this.db.exec(`
            CREATE TABLE products__new (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              unit TEXT NOT NULL DEFAULT 'dona',
              purchase_price_minor INTEGER NOT NULL DEFAULT 0,
              sale_price_minor INTEGER NOT NULL,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
          `);
          this.db.exec(`
            INSERT INTO products__new (
              id, name, unit, purchase_price_minor, sale_price_minor, is_active, created_at, updated_at
            )
            SELECT id, name, unit, purchase_price_minor, sale_price_minor, is_active, created_at, updated_at
            FROM products;
          `);
          this.db.exec("DROP TABLE products;");
          this.db.exec("ALTER TABLE products__new RENAME TO products;");
          this.db.exec("PRAGMA foreign_keys = ON;");
        }
      }
      this.setUserVersion(2);
    }
    if (this.getUserVersion() < 3) {
      const customerCols = this.selectAll("PRAGMA table_info(customers);");
      if (!customerCols.some((c) => c.name === "address")) {
        this.db.exec("ALTER TABLE customers ADD COLUMN address TEXT NOT NULL DEFAULT '';");
      }
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sale_drafts (
          id INTEGER PRIMARY KEY,
          customer_id INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (customer_id) REFERENCES customers (id)
        );
        CREATE TABLE IF NOT EXISTS sale_draft_items (
          id INTEGER PRIMARY KEY,
          draft_id INTEGER NOT NULL,
          product_id INTEGER NOT NULL,
          qty INTEGER NOT NULL,
          FOREIGN KEY (draft_id) REFERENCES sale_drafts (id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products (id)
        );
      `);
      this.setUserVersion(3);
    }
    if (this.getUserVersion() < 4) {
      const draftItemCols = this.selectAll("PRAGMA table_info(sale_draft_items);");
      if (!draftItemCols.some((c) => c.name === "unit_price_minor")) {
        this.db.exec("ALTER TABLE sale_draft_items ADD COLUMN unit_price_minor INTEGER;");
      }
      this.setUserVersion(4);
    }
    if (this.getUserVersion() < 5) {
      const saleCols = this.selectAll("PRAGMA table_info(sales);");
      if (!saleCols.some((c) => c.name === "paid_minor")) {
        this.db.exec("ALTER TABLE sales ADD COLUMN paid_minor INTEGER;");
        this.db.exec("UPDATE sales SET paid_minor = total_minor WHERE paid_minor IS NULL;");
      }
      this.setUserVersion(5);
    }
    if (this.getUserVersion() < 6) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS customer_chat_messages (
          id INTEGER PRIMARY KEY,
          customer_id INTEGER NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (customer_id) REFERENCES customers (id)
        );
      `);
      this.setUserVersion(6);
    }
    if (this.getUserVersion() < 7) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS customer_debt_ledger (
          id INTEGER PRIMARY KEY,
          customer_id INTEGER NOT NULL,
          delta_minor INTEGER NOT NULL,
          chat_message_id INTEGER,
          created_at TEXT NOT NULL,
          FOREIGN KEY (customer_id) REFERENCES customers (id),
          FOREIGN KEY (chat_message_id) REFERENCES customer_chat_messages (id)
        );
      `);
      this.setUserVersion(7);
    }
    if (this.getUserVersion() < 8) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS seller_profile (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          shop_name TEXT NOT NULL DEFAULT '',
          seller_name TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
      `);
      this.setUserVersion(8);
    }
    if (this.getUserVersion() < 9) {
      this.db.exec("PRAGMA foreign_keys = OFF;");
      this.db.exec(`
        CREATE TABLE inventory_balances__v9 (
          product_id INTEGER PRIMARY KEY,
          quantity REAL NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (product_id) REFERENCES products (id)
        );
        INSERT INTO inventory_balances__v9 SELECT product_id, CAST(quantity AS REAL), updated_at FROM inventory_balances;
        DROP TABLE inventory_balances;
        ALTER TABLE inventory_balances__v9 RENAME TO inventory_balances;
      `);
      this.db.exec(`
        CREATE TABLE inventory_movements__v9 (
          id INTEGER PRIMARY KEY,
          product_id INTEGER NOT NULL,
          delta_qty REAL NOT NULL,
          reason TEXT NOT NULL,
          ref_type TEXT,
          ref_id INTEGER,
          note TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (product_id) REFERENCES products (id)
        );
        INSERT INTO inventory_movements__v9 SELECT id, product_id, CAST(delta_qty AS REAL), reason, ref_type, ref_id, note, created_at FROM inventory_movements;
        DROP TABLE inventory_movements;
        ALTER TABLE inventory_movements__v9 RENAME TO inventory_movements;
      `);
      this.db.exec(`
        CREATE TABLE sale_items__v9 (
          id INTEGER PRIMARY KEY,
          sale_id INTEGER NOT NULL,
          product_id INTEGER NOT NULL,
          qty REAL NOT NULL,
          unit_price_minor INTEGER NOT NULL,
          line_total_minor INTEGER NOT NULL,
          FOREIGN KEY (sale_id) REFERENCES sales (id),
          FOREIGN KEY (product_id) REFERENCES products (id)
        );
        INSERT INTO sale_items__v9 SELECT id, sale_id, product_id, CAST(qty AS REAL), unit_price_minor, line_total_minor FROM sale_items;
        DROP TABLE sale_items;
        ALTER TABLE sale_items__v9 RENAME TO sale_items;
      `);
      this.db.exec(`
        CREATE TABLE sale_draft_items__v9 (
          id INTEGER PRIMARY KEY,
          draft_id INTEGER NOT NULL,
          product_id INTEGER NOT NULL,
          qty REAL NOT NULL,
          unit_price_minor INTEGER,
          FOREIGN KEY (draft_id) REFERENCES sale_drafts (id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products (id)
        );
        INSERT INTO sale_draft_items__v9 SELECT id, draft_id, product_id, CAST(qty AS REAL), unit_price_minor FROM sale_draft_items;
        DROP TABLE sale_draft_items;
        ALTER TABLE sale_draft_items__v9 RENAME TO sale_draft_items;
      `);
      this.db.exec("PRAGMA foreign_keys = ON;");
      this.setUserVersion(9);
    }
    if (this.getUserVersion() < 10) {
      this.db.exec("PRAGMA foreign_keys = OFF;");
      this.db.exec(`
        CREATE TABLE sale_items__v10 (
          id INTEGER PRIMARY KEY,
          sale_id INTEGER NOT NULL,
          product_id INTEGER,
          adhoc_label TEXT NOT NULL DEFAULT '',
          adhoc_unit TEXT NOT NULL DEFAULT '',
          qty REAL NOT NULL,
          unit_price_minor INTEGER NOT NULL,
          line_total_minor INTEGER NOT NULL,
          FOREIGN KEY (sale_id) REFERENCES sales (id),
          FOREIGN KEY (product_id) REFERENCES products (id)
        );
        INSERT INTO sale_items__v10 (id, sale_id, product_id, adhoc_label, adhoc_unit, qty, unit_price_minor, line_total_minor)
        SELECT id, sale_id, product_id, '', '', qty, unit_price_minor, line_total_minor FROM sale_items;
        DROP TABLE sale_items;
        ALTER TABLE sale_items__v10 RENAME TO sale_items;
      `);
      this.db.exec(`
        CREATE TABLE sale_draft_items__v10 (
          id INTEGER PRIMARY KEY,
          draft_id INTEGER NOT NULL,
          product_id INTEGER,
          adhoc_label TEXT NOT NULL DEFAULT '',
          adhoc_unit TEXT NOT NULL DEFAULT '',
          qty REAL NOT NULL,
          unit_price_minor INTEGER,
          FOREIGN KEY (draft_id) REFERENCES sale_drafts (id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products (id)
        );
        INSERT INTO sale_draft_items__v10 (id, draft_id, product_id, adhoc_label, adhoc_unit, qty, unit_price_minor)
        SELECT id, draft_id, product_id, '', '', qty, unit_price_minor FROM sale_draft_items;
        DROP TABLE sale_draft_items;
        ALTER TABLE sale_draft_items__v10 RENAME TO sale_draft_items;
      `);
      this.db.exec("PRAGMA foreign_keys = ON;");
      this.setUserVersion(10);
    }
    if (this.getUserVersion() < 11) {
      const siCols = this.selectAll("PRAGMA table_info(sale_items);");
      if (!siCols.some((c) => c.name === "returned_qty")) {
        this.db.exec(
          "ALTER TABLE sale_items ADD COLUMN returned_qty REAL NOT NULL DEFAULT 0;"
        );
      }
      this.setUserVersion(11);
    }
    if (this.getUserVersion() < 12) {
      const pCols = this.selectAll("PRAGMA table_info(products);");
      if (!pCols.some((c) => c.name === "low_stock_threshold")) {
        this.db.exec(
          "ALTER TABLE products ADD COLUMN low_stock_threshold REAL NOT NULL DEFAULT 5;"
        );
      }
      this.setUserVersion(12);
    }
    if (this.getUserVersion() < 13) {
      let sCols = this.selectAll("PRAGMA table_info(sales);");
      if (!sCols.some((c) => c.name === "balance_before_minor")) {
        this.db.exec("ALTER TABLE sales ADD COLUMN balance_before_minor INTEGER;");
      }
      sCols = this.selectAll("PRAGMA table_info(sales);");
      if (!sCols.some((c) => c.name === "balance_after_minor")) {
        this.db.exec("ALTER TABLE sales ADD COLUMN balance_after_minor INTEGER;");
      }
      this.setUserVersion(13);
    }
  }

  getUserVersion() {
    const result = this.selectOne("PRAGMA user_version;");
    return result?.user_version ?? 0;
  }

  setUserVersion(version) {
    this.db.exec(`PRAGMA user_version = ${version};`);
  }

  now() {
    return new Date().toISOString();
  }

  /** Butun so'm (1 so'm aniqligi) */
  roundSomInteger(value) {
    const n = Number(value);
    if (Number.isNaN(n)) return 0;
    return Math.round(n);
  }

  persist() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  selectAll(sql, params = []) {
    const statement = this.db.prepare(sql);
    statement.bind(params);
    const rows = [];
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }
    statement.free();
    return rows;
  }

  selectOne(sql, params = []) {
    const rows = this.selectAll(sql, params);
    return rows[0] || null;
  }

  execute(sql, params = []) {
    const statement = this.db.prepare(sql);
    statement.run(params);
    statement.free();
  }

  getLastInsertId() {
    const row = this.selectOne("SELECT last_insert_rowid() AS id;");
    return row ? row.id : null;
  }

  listProducts() {
    return this.selectAll(`
      SELECT
        p.id,
        p.name,
        p.unit,
        p.purchase_price_minor,
        p.sale_price_minor,
        p.is_active,
        p.low_stock_threshold,
        p.created_at,
        p.updated_at,
        COALESCE(b.quantity, 0) AS stock_qty
      FROM products p
      LEFT JOIN inventory_balances b ON b.product_id = p.id
      ORDER BY p.name ASC;
    `);
  }

  createProduct(payload) {
    const now = this.now();
    const initialQty = Number(payload.initial_qty || 0);
    const lowTh = Math.max(0, Number(payload.low_stock_threshold ?? 5));
    this.execute(
      `INSERT INTO products (name, unit, purchase_price_minor, sale_price_minor, is_active, low_stock_threshold, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?);`,
      [
        payload.name.trim(),
        payload.unit?.trim() || "dona",
        Number(payload.purchase_price_minor || 0),
        Number(payload.sale_price_minor || 0),
        Number.isFinite(lowTh) ? lowTh : 5,
        now,
        now
      ]
    );
    const productId = this.getLastInsertId();
    this.execute(
      "INSERT INTO inventory_balances (product_id, quantity, updated_at) VALUES (?, ?, ?);",
      [productId, initialQty, now]
    );
    if (initialQty !== 0) {
      this.execute(
        `INSERT INTO inventory_movements (product_id, delta_qty, reason, ref_type, ref_id, note, created_at)
         VALUES (?, ?, 'initial', NULL, NULL, ?, ?);`,
        [productId, initialQty, "Initial stock", now]
      );
    }
    this.persist();
    return this.selectOne(
      `
      SELECT p.*, COALESCE(b.quantity, 0) AS stock_qty
      FROM products p
      LEFT JOIN inventory_balances b ON b.product_id = p.id
      WHERE p.id = ?;
    `,
      [productId]
    );
  }

  updateProduct(payload) {
    const now = this.now();
    const id = Number(payload.id);
    const lowTh = Math.max(0, Number(payload.low_stock_threshold ?? 5));
    this.execute(
      `UPDATE products
       SET name = ?, unit = ?, purchase_price_minor = ?, sale_price_minor = ?, is_active = ?, low_stock_threshold = ?, updated_at = ?
       WHERE id = ?;`,
      [
        payload.name.trim(),
        payload.unit?.trim() || "dona",
        Number(payload.purchase_price_minor || 0),
        Number(payload.sale_price_minor || 0),
        payload.is_active ? 1 : 0,
        Number.isFinite(lowTh) ? lowTh : 5,
        now,
        id
      ]
    );
    if (
      payload.stock_qty !== undefined &&
      payload.stock_qty !== null &&
      payload.stock_qty !== ""
    ) {
      const target = qtyRound3(Number(payload.stock_qty));
      if (Number.isFinite(target) && target >= 0) {
        const balanceRow = this.selectOne(
          "SELECT quantity FROM inventory_balances WHERE product_id = ?;",
          [id]
        );
        if (balanceRow) {
          const curQ = qtyRound3(Number(balanceRow.quantity));
          const delta = target - curQ;
          if (Math.abs(delta) > 1e-9) {
            this.execute(
              "UPDATE inventory_balances SET quantity = ?, updated_at = ? WHERE product_id = ?;",
              [target, now, id]
            );
            this.execute(
              `INSERT INTO inventory_movements (product_id, delta_qty, reason, ref_type, ref_id, note, created_at)
               VALUES (?, ?, 'product_edit', NULL, NULL, ?, ?);`,
              [id, delta, "Mahsulot tahririda qoldiq yangilandi", now]
            );
          }
        }
      }
    }
    this.persist();
    return this.selectOne(
      `
      SELECT p.*, COALESCE(b.quantity, 0) AS stock_qty
      FROM products p
      LEFT JOIN inventory_balances b ON b.product_id = p.id
      WHERE p.id = ?;
    `,
      [Number(payload.id)]
    );
  }

  /** Savdoga tegishli tarix saqlanishi uchun mahsulotni bazadan emas, ro'yxatdan olib tashlash (nofaol) */
  deactivateProduct(productId) {
    const id = Number(productId);
    if (!Number.isFinite(id) || id <= 0) {
      return { ok: false, error: "invalid_id" };
    }
    const row = this.selectOne("SELECT id FROM products WHERE id = ?;", [id]);
    if (!row) return { ok: false, error: "not_found" };
    const now = this.now();
    this.execute("UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?;", [now, id]);
    this.persist();
    return { ok: true };
  }

  adjustInventory(payload) {
    const productId = Number(payload.product_id);
    const delta = Number(payload.delta_qty);
    if (!delta) {
      return { ok: false, error: "Delta 0 bo'lishi mumkin emas." };
    }
    const now = this.now();
    const current = this.selectOne(
      "SELECT quantity FROM inventory_balances WHERE product_id = ?;",
      [productId]
    );
    if (!current) {
      return { ok: false, error: "Mahsulot topilmadi." };
    }
    const next = Number(current.quantity) + delta;
    if (next < 0) {
      return { ok: false, error: "Qoldiq manfiy bo'lib ketadi." };
    }
    this.execute(
      "UPDATE inventory_balances SET quantity = ?, updated_at = ? WHERE product_id = ?;",
      [next, now, productId]
    );
    this.execute(
      `INSERT INTO inventory_movements (product_id, delta_qty, reason, ref_type, ref_id, note, created_at)
       VALUES (?, ?, ?, NULL, NULL, ?, ?);`,
      [productId, delta, payload.reason || "adjustment", payload.note || "", now]
    );
    this.persist();
    return { ok: true };
  }

  listCustomers() {
    const rows = this.selectAll(`
      SELECT
        c.*,
        CASE
          WHEN EXISTS (SELECT 1 FROM sale_drafts d WHERE d.customer_id = c.id) THEN 1
          ELSE 0
        END AS has_open_draft,
        (
          SELECT MAX(COALESCE(d2.updated_at, d2.created_at))
          FROM sale_drafts d2
          WHERE d2.customer_id = c.id
        ) AS draft_sort_at,
        (
          SELECT MAX(s.sold_at)
          FROM sales s
          WHERE s.customer_id = c.id AND s.status = 'completed'
        ) AS last_sale_at,
        (
          (
            SELECT COALESCE(SUM(
              CASE
                WHEN COALESCE(s.paid_minor, s.total_minor) >= s.total_minor THEN 0
                ELSE s.total_minor - COALESCE(s.paid_minor, s.total_minor)
              END
            ), 0)
            FROM sales s
            WHERE s.customer_id = c.id AND s.status = 'completed'
          )
          +
          (
            SELECT COALESCE(SUM(ld.delta_minor), 0)
            FROM customer_debt_ledger ld
            WHERE ld.customer_id = c.id
          )
        ) AS outstanding_debt_minor
      FROM customers c
    `);
    const t = (iso) => {
      if (iso == null || String(iso).trim() === "") return 0;
      const ms = Date.parse(String(iso));
      return Number.isFinite(ms) ? ms : 0;
    };
    /**
     * Tepada — faqat ochiq qoralamasi borlar, o‘zaro eng yangi qoralama vaqti (draft_sort_at).
     * Qolganlari — eng yangi savdo (last_sale_at), keyin ro‘yxatga olinish.
     */
    rows.sort((a, b) => {
      const da = Number(a.has_open_draft) || 0;
      const db = Number(b.has_open_draft) || 0;
      if (da !== db) {
        return db - da;
      }
      if (da === 1) {
        const byDraft = t(b.draft_sort_at) - t(a.draft_sort_at);
        if (byDraft !== 0) {
          return byDraft;
        }
        const byCreated = t(b.created_at) - t(a.created_at);
        if (byCreated !== 0) {
          return byCreated;
        }
        return Number(b.id) - Number(a.id);
      }
      const bySale = t(b.last_sale_at) - t(a.last_sale_at);
      if (bySale !== 0) {
        return bySale;
      }
      const byDraft = t(b.draft_sort_at) - t(a.draft_sort_at);
      if (byDraft !== 0) {
        return byDraft;
      }
      const byCreated = t(b.created_at) - t(a.created_at);
      if (byCreated !== 0) {
        return byCreated;
      }
      return Number(b.id) - Number(a.id);
    });
    return rows;
  }

  /** Nomisiz savdo / qoralama — bitta umumiy yozuv (barcha anonim operatsiyalar shu xaridorga bog'lanadi). */
  getOrCreateAnonymousCustomerId(now) {
    const label = "Anonim";
    const existing = this.selectOne(
      "SELECT id FROM customers WHERE lower(trim(name)) = lower(trim(?));",
      [label]
    );
    if (existing) {
      return Number(existing.id);
    }
    this.execute(
      `INSERT INTO customers (name, phone, notes, address, created_at, updated_at)
       VALUES (?, NULL, '', '', ?, ?);`,
      [label, now, now]
    );
    return Number(this.getLastInsertId());
  }

  createCustomer(payload) {
    const now = this.now();
    this.execute(
      `INSERT INTO customers (name, phone, notes, address, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [
        payload.name.trim(),
        payload.phone?.trim() || null,
        payload.notes?.trim() || "",
        payload.address?.trim() || "",
        now,
        now
      ]
    );
    const id = this.getLastInsertId();
    this.persist();
    return this.selectOne("SELECT * FROM customers WHERE id = ?;", [id]);
  }

  updateCustomer(payload) {
    const id = Number(payload.id);
    if (!id) {
      return { ok: false, error: "Xaridor ID noto'g'ri." };
    }
    const row = this.selectOne("SELECT * FROM customers WHERE id = ?;", [id]);
    if (!row) {
      return { ok: false, error: "Xaridor topilmadi." };
    }
    const now = this.now();
    let name = row.name;
    let phone = row.phone;
    let address = row.address ?? "";
    let notes = row.notes ?? "";
    if (payload.name !== undefined && String(payload.name).trim()) {
      name = String(payload.name).trim();
    }
    if (payload.phone !== undefined) {
      phone = String(payload.phone).trim() || null;
    }
    if (payload.address !== undefined) {
      address = String(payload.address).trim() || "";
    }
    if (payload.notes !== undefined) {
      notes = String(payload.notes).trim() || "";
    }
    try {
      this.execute(
        `UPDATE customers SET name = ?, phone = ?, notes = ?, address = ?, updated_at = ? WHERE id = ?;`,
        [name, phone, notes, address, now, id]
      );
      this.persist();
      return { ok: true, customer: this.selectOne("SELECT * FROM customers WHERE id = ?;", [id]) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Xaridor va uning savdolari, qoralamalari, chat/ledger yozuvlari.
   * Ombor qoldig'i o'zgartirilmaydi (savdo yozuvlari o'chiriladi, mahsulotlar qaytarilmaydi).
   * "Anonim" xaridor o'chirilmaydi.
   */
  deleteCustomer(customerId) {
    const id = Number(customerId);
    if (!id) {
      return { ok: false, error: "Xaridor ID noto'g'ri." };
    }
    const row = this.selectOne("SELECT id, name FROM customers WHERE id = ?;", [id]);
    if (!row) {
      return { ok: false, error: "Xaridor topilmadi." };
    }
    if (String(row.name || "").trim().toLowerCase() === "anonim") {
      return { ok: false, error: "Anonim xaridor o'chirib bo'lmaydi." };
    }
    try {
      this.db.exec("BEGIN TRANSACTION;");
      const sales = this.selectAll("SELECT id FROM sales WHERE customer_id = ?;", [id]);
      for (const s of sales) {
        const saleId = Number(s.id);
        this.execute("DELETE FROM sale_items WHERE sale_id = ?;", [saleId]);
        this.execute("DELETE FROM inventory_movements WHERE ref_type = 'sale' AND ref_id = ?;", [
          saleId
        ]);
        this.execute("DELETE FROM sales WHERE id = ?;", [saleId]);
      }
      const drafts = this.selectAll("SELECT id FROM sale_drafts WHERE customer_id = ?;", [id]);
      for (const d of drafts) {
        const did = Number(d.id);
        this.execute("DELETE FROM sale_draft_items WHERE draft_id = ?;", [did]);
        this.execute("DELETE FROM sale_drafts WHERE id = ?;", [did]);
      }
      this.execute("DELETE FROM customer_debt_ledger WHERE customer_id = ?;", [id]);
      this.execute("DELETE FROM customer_chat_messages WHERE customer_id = ?;", [id]);
      this.execute("DELETE FROM customers WHERE id = ?;", [id]);
      this.db.exec("COMMIT;");
      this.persist();
      return { ok: true };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      return { ok: false, error: error.message };
    }
  }

  /**
   * Chat matnidan birinchi pul qiymatini ajratadi: +90000 yoki -100000 (oldinda/ichida matn bo'lishi mumkin).
   * + = pul tushdi / xaridor qarzi kamayadi (delta manfiy).
   * - = qarz oshadi (delta musbat).
   * Telefon kabi uzoq raqamlardan qochish: 10 ta raqamgacha.
   */
  parseDebtLedgerChatLine(raw) {
    const s = String(raw ?? "");
    const m = s.match(/([+-])\s*((?:\d[\d\s\u00a0,]*\d|\d+))/u);
    if (!m) {
      return null;
    }
    const sign = m[1];
    const numPart = m[2].replace(/[\s\u00a0,]/g, "").replace(/\./g, "");
    if (!/^\d+$/.test(numPart)) {
      return null;
    }
    if (numPart.length > 10) {
      return null;
    }
    const n = Number(numPart);
    if (!Number.isFinite(n) || n <= 0) {
      return null;
    }
    const amount = this.roundSomInteger(n);
    if (amount <= 0) {
      return null;
    }
    const delta = sign === "+" ? -amount : amount;
    return { delta };
  }

  getCustomerOutstandingBalanceMinor(customerId) {
    const id = Number(customerId);
    if (!id) {
      return 0;
    }
    const saleRow = this.selectOne(
      `
      SELECT COALESCE(SUM(
        CASE
          WHEN COALESCE(s.paid_minor, s.total_minor) >= s.total_minor THEN 0
          ELSE s.total_minor - COALESCE(s.paid_minor, s.total_minor)
        END
      ), 0) AS v
      FROM sales s
      WHERE s.customer_id = ? AND s.status = 'completed';
    `,
      [id]
    );
    const ledRow = this.selectOne(
      `SELECT COALESCE(SUM(delta_minor), 0) AS v FROM customer_debt_ledger WHERE customer_id = ?;`,
      [id]
    );
    return Number(saleRow?.v || 0) + Number(ledRow?.v || 0);
  }

  listCustomerChatMessages(customerId, limit = 500) {
    const id = Number(customerId);
    if (!id) {
      return [];
    }
    const lim = Number(limit);
    const safeLimit = Number.isFinite(lim) && lim > 0 ? Math.min(lim, 2000) : 500;
    return this.selectAll(
      `
      SELECT id, customer_id, body, created_at
      FROM customer_chat_messages
      WHERE customer_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?;
    `,
      [id, safeLimit]
    );
  }

  appendCustomerChatMessage(payload) {
    const customerId = Number(payload?.customer_id);
    if (!customerId) {
      return { ok: false, error: "Xaridor ID noto'g'ri." };
    }
    const exists = this.selectOne("SELECT id FROM customers WHERE id = ?;", [customerId]);
    if (!exists) {
      return { ok: false, error: "Xaridor topilmadi." };
    }
    const body = String(payload?.body ?? "").trim();
    if (!body) {
      return { ok: false, error: "Xabar matni bo'sh." };
    }
    const ledgerParsed = this.parseDebtLedgerChatLine(body);
    const now = this.now();
    try {
      this.execute(
        `INSERT INTO customer_chat_messages (customer_id, body, created_at) VALUES (?, ?, ?);`,
        [customerId, body, now]
      );
      const msgId = this.getLastInsertId();
      let debtAdjustment = null;
      if (ledgerParsed) {
        this.execute(
          `INSERT INTO customer_debt_ledger (customer_id, delta_minor, chat_message_id, created_at)
           VALUES (?, ?, ?, ?);`,
          [customerId, ledgerParsed.delta, msgId, now]
        );
        debtAdjustment = {
          delta_minor: ledgerParsed.delta,
          balance_minor: this.getCustomerOutstandingBalanceMinor(customerId)
        };
      }
      this.persist();
      return {
        ok: true,
        id: msgId,
        created_at: now,
        debt_adjustment: debtAdjustment
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  applyCustomerContactFromSalePayload(customerId, payload, now) {
    const row = this.selectOne("SELECT phone, address FROM customers WHERE id = ?;", [customerId]);
    if (!row) return;
    const p = payload.customer_phone;
    const a = payload.customer_address;
    const phoneIn = p !== undefined && p !== null && String(p).trim();
    const addrIn = a !== undefined && a !== null && String(a).trim();
    if (!phoneIn && !addrIn) return;
    let phone = row.phone;
    let address = row.address ?? "";
    if (phoneIn) phone = String(p).trim();
    if (addrIn) address = String(a).trim();
    this.execute(`UPDATE customers SET phone = ?, address = ?, updated_at = ? WHERE id = ?;`, [
      phone,
      address,
      now,
      customerId
    ]);
  }

  resolveSaleCustomerId(payload, now) {
    const rawId = payload.customer_id ? Number(payload.customer_id) : null;
    if (rawId) {
      const row = this.selectOne("SELECT id FROM customers WHERE id = ?;", [rawId]);
      if (row) {
        const id = Number(row.id);
        this.applyCustomerContactFromSalePayload(id, payload, now);
        return id;
      }
    }
    const name = payload.customer_name?.trim();
    if (!name) {
      return this.getOrCreateAnonymousCustomerId(now);
    }
    const existingByName = this.selectOne(
      "SELECT id FROM customers WHERE lower(trim(name)) = lower(trim(?));",
      [name]
    );
    if (existingByName) {
      const id = Number(existingByName.id);
      this.applyCustomerContactFromSalePayload(id, payload, now);
      return id;
    }
    return null;
  }

  /**
   * @param {object} options
   * @param {boolean} [options.useCatalogWhenPriceMissing=true] — false: narx berilmasa 0 (qoralama faqat savat/saqlangan)
   */
  validateSaleItems(items, options = {}) {
    const useCatalogWhenPriceMissing = options.useCatalogWhenPriceMissing !== false;
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      return { ok: false, error: "Kamida bitta mahsulot tanlang." };
    }
    let total = 0;
    const normalizedItems = [];
    for (const item of list) {
      if (item.adhoc === true) {
        const label = String(item.adhoc_label || "").trim();
        if (!label) {
          return { ok: false, error: "Omborsiz qator uchun nom kiriting." };
        }
        const unitStr = String(item.adhoc_unit || "dona").trim() || "dona";
        const qty = Number(String(item.qty).replace(",", "."));
        if (!Number.isFinite(qty) || qty <= 0) {
          continue;
        }
        const qtyNorm = qtyNormalizeSale(unitStr, qty);
        if (qtyNorm === null) {
          return {
            ok: false,
            error: qtyIsFractionalUnit(unitStr)
              ? `${label}: miqdor 0,001 dan kichik bo'lmasin.`
              : `${label}: dona uchun butun musbat son kiriting.`
          };
        }
        const explicit =
          item.unit_price_minor != null &&
          item.unit_price_minor !== "" &&
          !Number.isNaN(Number(item.unit_price_minor));
        const unitPrice = explicit ? this.roundSomInteger(Number(item.unit_price_minor)) : 0;
        if (!useCatalogWhenPriceMissing && unitPrice <= 0) {
          return { ok: false, error: `${label}: narx kiriting.` };
        }
        const uClamped = Math.max(0, unitPrice);
        const lineTotal = this.roundSomInteger(uClamped * qtyNorm);
        total += lineTotal;
        normalizedItems.push({
          product_id: null,
          adhoc_label: label,
          adhoc_unit: unitStr,
          qty: qtyNorm,
          unit_price_minor: uClamped,
          line_total_minor: lineTotal,
          draft_stored_unit_price_minor: explicit ? uClamped : null
        });
        continue;
      }

      const productId = Number(item.product_id);
      const qty = Number(String(item.qty).replace(",", "."));
      if (!productId) {
        return { ok: false, error: "Noto'g'ri savdo elementi." };
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        continue;
      }
      const product = this.selectOne(
        `SELECT p.id, p.name, p.unit, p.sale_price_minor, COALESCE(b.quantity, 0) AS stock_qty
         FROM products p
         LEFT JOIN inventory_balances b ON b.product_id = p.id
         WHERE p.id = ? AND p.is_active = 1;`,
        [productId]
      );
      if (!product) {
        return { ok: false, error: "Mahsulot topilmadi yoki aktiv emas." };
      }
      const qtyNorm = qtyNormalizeSale(product.unit, qty);
      if (qtyNorm === null) {
        if (Number(qty) > 0) {
          return {
            ok: false,
            error: qtyIsFractionalUnit(product.unit)
              ? `${product.name}: miqdor 0,001 dan kichik bo'lmasin.`
              : `${product.name}: dona uchun butun musbat son kiriting.`
          };
        }
        continue;
      }
      if (qtyExceedsStock(qtyNorm, product.stock_qty)) {
        return { ok: false, error: `${product.name} uchun qoldiq yetarli emas.` };
      }
      const catalogUnit = this.roundSomInteger(Number(product.sale_price_minor));
      const explicit =
        item.unit_price_minor != null &&
        item.unit_price_minor !== "" &&
        !Number.isNaN(Number(item.unit_price_minor));
      const uFloat = explicit
        ? this.roundSomInteger(Number(item.unit_price_minor))
        : useCatalogWhenPriceMissing
          ? catalogUnit
          : 0;
      const unitPrice = Math.max(0, uFloat);
      const lineTotal = this.roundSomInteger(unitPrice * qtyNorm);
      total += lineTotal;
      normalizedItems.push({
        product_id: productId,
        adhoc_label: "",
        adhoc_unit: "",
        qty: qtyNorm,
        unit_price_minor: unitPrice,
        line_total_minor: lineTotal,
        draft_stored_unit_price_minor: explicit ? unitPrice : null
      });
    }
    if (!normalizedItems.length) {
      return { ok: false, error: "Kamida bitta mahsulotda miqdor 0 dan katta bo'lsin." };
    }
    return { ok: true, normalizedItems, total };
  }

  completeSaleTransaction(customerId, note, soldAt, normalizedItems, total, now, paidMinor) {
    const paid = this.roundSomInteger(paidMinor);
    const paidClamped = Math.min(Math.max(0, paid), total);
    const balanceBefore = this.getCustomerOutstandingBalanceMinor(customerId);
    this.execute(
      `INSERT INTO sales (customer_id, sold_at, status, total_minor, paid_minor, note, created_at)
       VALUES (?, ?, 'completed', ?, ?, ?, ?);`,
      [customerId, soldAt, total, paidClamped, note, now]
    );
    const saleId = this.getLastInsertId();
    for (const item of normalizedItems) {
      this.execute(
        `INSERT INTO sale_items (sale_id, product_id, adhoc_label, adhoc_unit, qty, unit_price_minor, line_total_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
          saleId,
          item.product_id,
          item.adhoc_label || "",
          item.adhoc_unit || "",
          item.qty,
          item.unit_price_minor,
          item.line_total_minor
        ]
      );
      if (item.product_id == null) {
        continue;
      }
      const current = this.selectOne(
        "SELECT quantity FROM inventory_balances WHERE product_id = ?;",
        [item.product_id]
      );
      if (!current) {
        throw new Error(
          `Ombor qoldig'i yozuvi topilmadi (mahsulot #${item.product_id}). Savdo bekor qilindi.`
        );
      }
      const nextQty = Number(current.quantity) - Number(item.qty);
      if (nextQty < 0) {
        throw new Error("Qoldiq manfiy bo'lib ketmoqda.");
      }
      this.execute(
        "UPDATE inventory_balances SET quantity = ?, updated_at = ? WHERE product_id = ?;",
        [nextQty, now, item.product_id]
      );
      this.execute(
        `INSERT INTO inventory_movements (product_id, delta_qty, reason, ref_type, ref_id, note, created_at)
         VALUES (?, ?, 'sale', 'sale', ?, '', ?);`,
        [item.product_id, -Number(item.qty), saleId, now]
      );
    }
    const balanceAfter = this.getCustomerOutstandingBalanceMinor(customerId);
    this.execute(
      `UPDATE sales SET balance_before_minor = ?, balance_after_minor = ? WHERE id = ?;`,
      [balanceBefore, balanceAfter, saleId]
    );
    return saleId;
  }

  createSale(payload) {
    const note = payload.note?.trim() || "";
    const soldAt = payload.sold_at || this.now();
    const items = Array.isArray(payload.items) ? payload.items : [];

    const validation = this.validateSaleItems(items);
    if (!validation.ok) {
      return validation;
    }

    const now = this.now();
    try {
      this.db.exec("BEGIN TRANSACTION;");
      const customerId = this.resolveSaleCustomerId(payload, now);
      if (customerId === null || customerId === undefined) {
        this.db.exec("ROLLBACK;");
        return {
          ok: false,
          error: "Xaridor topilmadi. Yangi ismni Tasdiqlash bilan ro'yxatga qo'shing."
        };
      }
      const total = validation.total;
      let paid =
        payload.paid_minor !== undefined &&
        payload.paid_minor !== null &&
        payload.paid_minor !== ""
          ? this.roundSomInteger(Number(payload.paid_minor))
          : total;
      paid = Math.min(Math.max(0, paid), total);
      const saleId = this.completeSaleTransaction(
        customerId,
        note,
        soldAt,
        validation.normalizedItems,
        total,
        now,
        paid
      );
      this.db.exec("COMMIT;");
      this.persist();
      return { ok: true, sale_id: saleId };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      return { ok: false, error: error.message };
    }
  }

  clampRemainingForReturn(unitRaw, rawRemaining, maxRemaining) {
    const u = String(unitRaw || "dona");
    const maxR = qtyRound3(Number(maxRemaining));
    if (!Number.isFinite(maxR) || maxR < 0) return null;
    const n = Number(String(rawRemaining).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return null;
    if (qtyIsFractionalUnit(u)) {
      const r = qtyRound3(n);
      if (r > maxR + 1e-6) return null;
      if (r < 0.001 && r > 1e-9) return null;
      return r;
    }
    const int = Math.round(n);
    if (Math.abs(n - int) > 1e-5) return null;
    if (int > maxR + 1e-6) return null;
    if (int < 0) return null;
    return int;
  }

  /**
   * Xaridor savdosidan qisman qaytarish: omborga qo'shiladi, sale_items va jami yangilanadi.
   * payload.lines: [{ sale_item_id, remaining_qty }] — mijozda qolgan sotilgan miqdor (qaytarilgandan keyin).
   */
  applySaleLineReturns(payload) {
    const saleId = Number(payload?.sale_id);
    const rawLines = Array.isArray(payload?.lines) ? payload.lines : [];
    if (!saleId) {
      return { ok: false, error: "Savdo ID noto'g'ri." };
    }
    if (!rawLines.length) {
      return { ok: false, error: "Hech qator yuborilmadi." };
    }
    const now = this.now();
    try {
      this.db.exec("BEGIN TRANSACTION;");
      const sale = this.selectOne(
        "SELECT id, total_minor, paid_minor FROM sales WHERE id = ? AND status = 'completed';",
        [saleId]
      );
      if (!sale) {
        this.db.exec("ROLLBACK;");
        return { ok: false, error: "Savdo topilmadi yoki tugallanmagan." };
      }
      let anyCatalog = false;
      for (const pl of rawLines) {
        const sid = Number(pl.sale_item_id);
        if (!sid) {
          throw new Error("Qator ID noto'g'ri.");
        }
        const row = this.selectOne(
          `
          SELECT si.id, si.sale_id, si.product_id, si.qty, COALESCE(si.returned_qty, 0) AS returned_qty,
                 si.unit_price_minor,
                 COALESCE(p.unit, si.adhoc_unit, 'dona') AS unit
          FROM sale_items si
          LEFT JOIN products p ON p.id = si.product_id
          WHERE si.id = ? AND si.sale_id = ?;
        `,
          [sid, saleId]
        );
        if (!row) {
          throw new Error(`Qator #${sid} bu savdoga tegishli emas.`);
        }
        if (row.product_id == null) {
          continue;
        }
        anyCatalog = true;
        const qty = qtyRound3(Number(row.qty));
        const returnedPrev = qtyRound3(Number(row.returned_qty));
        const maxSellable = qtyRound3(qty - returnedPrev);
        const rem = this.clampRemainingForReturn(
          row.unit,
          pl.remaining_qty,
          maxSellable
        );
        if (rem == null) {
          throw new Error(
            `Qator uchun qolgan miqdor noto'g'ri (0 dan ${String(maxSellable)} gacha).`
          );
        }
        const newReturned = qtyRound3(qty - rem);
        if (newReturned + 1e-9 < returnedPrev) {
          throw new Error("Qaytarishni kamaytirish mumkin emas.");
        }
        const delta = qtyRound3(newReturned - returnedPrev);
        if (delta <= 1e-9) {
          continue;
        }
        const unitPrice = this.roundSomInteger(Number(row.unit_price_minor));
        const newLineTotal = this.roundSomInteger(unitPrice * rem);
        this.execute(
          `UPDATE sale_items SET returned_qty = ?, line_total_minor = ? WHERE id = ?;`,
          [newReturned, newLineTotal, sid]
        );
        const inv = this.selectOne(
          "SELECT quantity FROM inventory_balances WHERE product_id = ?;",
          [row.product_id]
        );
        if (!inv) {
          throw new Error(`Ombor yozuvi topilmadi (mahsulot #${row.product_id}).`);
        }
        const nextStock = qtyRound3(Number(inv.quantity) + delta);
        this.execute(
          "UPDATE inventory_balances SET quantity = ?, updated_at = ? WHERE product_id = ?;",
          [nextStock, now, row.product_id]
        );
        this.execute(
          `INSERT INTO inventory_movements (product_id, delta_qty, reason, ref_type, ref_id, note, created_at)
           VALUES (?, ?, 'sale_return', 'sale', ?, ?, ?);`,
          [row.product_id, delta, saleId, `Savdo #${saleId} qaytarish`, now]
        );
      }
      if (!anyCatalog) {
        this.db.exec("ROLLBACK;");
        return {
          ok: false,
          error: "Ombordagi mahsulot qatorlari yo'q — qaytarish mumkin emas."
        };
      }
      const lineRows = this.selectAll(
        `SELECT line_total_minor FROM sale_items WHERE sale_id = ?;`,
        [saleId]
      );
      let newTotal = 0;
      for (const L of lineRows) {
        newTotal += this.roundSomInteger(Number(L.line_total_minor));
      }
      const oldPaid = this.roundSomInteger(Number(sale.paid_minor ?? sale.total_minor));
      const newPaid = Math.min(oldPaid, newTotal);
      this.execute(`UPDATE sales SET total_minor = ?, paid_minor = ? WHERE id = ?;`, [
        newTotal,
        newPaid,
        saleId
      ]);
      this.db.exec("COMMIT;");
      this.persist();
      return { ok: true, sale_id: saleId, total_minor: newTotal };
    } catch (e) {
      this.db.exec("ROLLBACK;");
      return { ok: false, error: e.message || String(e) };
    }
  }

  listSaleDraftsByCustomer(customerId) {
    const id = Number(customerId);
    if (!id) {
      return [];
    }
    const drafts = this.selectAll(
      `SELECT * FROM sale_drafts WHERE customer_id = ? ORDER BY created_at ASC, id ASC;`,
      [id]
    );
    for (const d of drafts) {
      d.items = this.selectAll(
        `
        SELECT
          sdi.id,
          sdi.product_id,
          sdi.qty,
          sdi.unit_price_minor,
          sdi.adhoc_label,
          sdi.adhoc_unit,
          CASE
            WHEN sdi.product_id IS NULL THEN TRIM(COALESCE(sdi.adhoc_label, ''))
            ELSE COALESCE(p.name, '(mahsulot topilmadi)')
          END AS product_name
        FROM sale_draft_items sdi
        LEFT JOIN products p ON p.id = sdi.product_id
        WHERE sdi.draft_id = ?
        ORDER BY sdi.id ASC;
      `,
        [d.id]
      );
    }
    return drafts;
  }

  deleteSaleDraft(draftId) {
    const id = Number(draftId);
    if (!id) {
      return { ok: false, error: "Qoralama ID noto'g'ri." };
    }
    const draft = this.selectOne("SELECT id FROM sale_drafts WHERE id = ?;", [id]);
    if (!draft) {
      return { ok: false, error: "Qoralama topilmadi." };
    }
    try {
      this.db.exec("BEGIN TRANSACTION;");
      this.execute("DELETE FROM sale_draft_items WHERE draft_id = ?;", [id]);
      this.execute("DELETE FROM sale_drafts WHERE id = ?;", [id]);
      this.db.exec("COMMIT;");
      this.persist();
      return { ok: true };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      return { ok: false, error: error.message };
    }
  }

  createSaleDraft(payload) {
    const raw = Array.isArray(payload.items) ? payload.items : [];
    const items = raw.map((it) => {
      if (it.adhoc === true) {
        return {
          adhoc: true,
          adhoc_label: it.adhoc_label,
          adhoc_unit: it.adhoc_unit || "dona",
          qty: it.qty,
          unit_price_minor:
            it.unit_price_minor !== undefined &&
            it.unit_price_minor !== null &&
            it.unit_price_minor !== ""
              ? this.roundSomInteger(Number(it.unit_price_minor))
              : undefined
        };
      }
      return {
        product_id: it.product_id,
        qty: it.qty,
        unit_price_minor:
          it.unit_price_minor !== undefined &&
          it.unit_price_minor !== null &&
          it.unit_price_minor !== ""
            ? this.roundSomInteger(Number(it.unit_price_minor))
            : undefined
      };
    });
    const validation = this.validateSaleItems(items, { useCatalogWhenPriceMissing: false });
    if (!validation.ok) {
      return validation;
    }
    const now = this.now();
    let customerId = Number(payload.customer_id);
    if (!customerId || Number.isNaN(customerId)) {
      customerId = this.getOrCreateAnonymousCustomerId(now);
    } else {
      const exists = this.selectOne("SELECT id FROM customers WHERE id = ?;", [customerId]);
      if (!exists) {
        return { ok: false, error: "Xaridor topilmadi." };
      }
    }
    try {
      this.db.exec("BEGIN TRANSACTION;");
      this.execute(
        `INSERT INTO sale_drafts (customer_id, created_at, updated_at) VALUES (?, ?, ?);`,
        [customerId, now, now]
      );
      const draftId = this.getLastInsertId();
      for (const item of validation.normalizedItems) {
        this.execute(
          `INSERT INTO sale_draft_items (draft_id, product_id, adhoc_label, adhoc_unit, qty, unit_price_minor) VALUES (?, ?, ?, ?, ?, ?);`,
          [
            draftId,
            item.product_id,
            item.adhoc_label || "",
            item.adhoc_unit || "",
            item.qty,
            item.unit_price_minor
          ]
        );
      }
      this.db.exec("COMMIT;");
      this.persist();
      return { ok: true, draft_id: draftId, customer_id: customerId };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      return { ok: false, error: error.message };
    }
  }

  updateSaleDraft(payload) {
    const draftId = Number(payload.draft_id);
    if (!draftId) {
      return { ok: false, error: "Qoralama ID noto'g'ri." };
    }
    const draft = this.selectOne("SELECT * FROM sale_drafts WHERE id = ?;", [draftId]);
    if (!draft) {
      return { ok: false, error: "Qoralama topilmadi." };
    }
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const items = rawItems.map((it) => {
      if (it.adhoc === true) {
        return {
          adhoc: true,
          adhoc_label: it.adhoc_label,
          adhoc_unit: it.adhoc_unit || "dona",
          qty: it.qty,
          unit_price_minor:
            it.unit_price_minor !== undefined &&
            it.unit_price_minor !== null &&
            it.unit_price_minor !== ""
              ? this.roundSomInteger(Number(it.unit_price_minor))
              : undefined
        };
      }
      return {
        product_id: it.product_id,
        qty: it.qty,
        unit_price_minor:
          it.unit_price_minor !== undefined &&
          it.unit_price_minor !== null &&
          it.unit_price_minor !== ""
            ? this.roundSomInteger(Number(it.unit_price_minor))
            : undefined
      };
    });
    const validation = this.validateSaleItems(items, { useCatalogWhenPriceMissing: false });
    if (!validation.ok) {
      return validation;
    }
    const now = this.now();
    try {
      this.db.exec("BEGIN TRANSACTION;");
      this.execute("DELETE FROM sale_draft_items WHERE draft_id = ?;", [draftId]);
      for (const item of validation.normalizedItems) {
        this.execute(
          `INSERT INTO sale_draft_items (draft_id, product_id, adhoc_label, adhoc_unit, qty, unit_price_minor) VALUES (?, ?, ?, ?, ?, ?);`,
          [
            draftId,
            item.product_id,
            item.adhoc_label || "",
            item.adhoc_unit || "",
            item.qty,
            item.unit_price_minor
          ]
        );
      }
      this.execute(`UPDATE sale_drafts SET updated_at = ? WHERE id = ?;`, [now, draftId]);
      this.db.exec("COMMIT;");
      this.persist();
      return { ok: true };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      return { ok: false, error: error.message };
    }
  }

  finalizeSaleDraft(payload) {
    const id = Number(
      typeof payload === "object" && payload !== null
        ? payload.draft_id ?? payload.draftId
        : payload
    );
    if (!id) {
      return { ok: false, error: "Qoralama ID noto'g'ri." };
    }
    const draft = this.selectOne("SELECT * FROM sale_drafts WHERE id = ?;", [id]);
    if (!draft) {
      return { ok: false, error: "Qoralama topilmadi." };
    }
    const rawItems = this.selectAll(
      "SELECT product_id, adhoc_label, adhoc_unit, qty, unit_price_minor FROM sale_draft_items WHERE draft_id = ?;",
      [id]
    );
    const items = rawItems.map((r) => {
      const pid =
        r.product_id !== null && r.product_id !== undefined && r.product_id !== ""
          ? Number(r.product_id)
          : null;
      if (pid === null || Number.isNaN(pid)) {
        return {
          adhoc: true,
          adhoc_label: String(r.adhoc_label || "").trim(),
          adhoc_unit: String(r.adhoc_unit || "dona").trim() || "dona",
          qty: r.qty,
          unit_price_minor:
            r.unit_price_minor !== undefined &&
            r.unit_price_minor !== null &&
            r.unit_price_minor !== ""
              ? this.roundSomInteger(Number(r.unit_price_minor))
              : undefined
        };
      }
      return {
        product_id: pid,
        qty: r.qty,
        unit_price_minor:
          r.unit_price_minor !== undefined &&
          r.unit_price_minor !== null &&
          r.unit_price_minor !== ""
            ? this.roundSomInteger(Number(r.unit_price_minor))
            : undefined
      };
    });
    const validation = this.validateSaleItems(items, { useCatalogWhenPriceMissing: false });
    if (!validation.ok) {
      return validation;
    }
    const now = this.now();
    const soldAt = now;
    const customerId = Number(draft.customer_id);
    const total = validation.total;
    let paid = total;
    if (typeof payload === "object" && payload !== null) {
      if (
        payload.paid_minor !== undefined &&
        payload.paid_minor !== null &&
        payload.paid_minor !== ""
      ) {
        paid = this.roundSomInteger(Number(payload.paid_minor));
      }
    }
    paid = Math.min(Math.max(0, paid), total);
    try {
      this.db.exec("BEGIN TRANSACTION;");
      const saleId = this.completeSaleTransaction(
        customerId,
        "",
        soldAt,
        validation.normalizedItems,
        total,
        now,
        paid
      );
      this.execute("DELETE FROM sale_draft_items WHERE draft_id = ?;", [id]);
      this.execute("DELETE FROM sale_drafts WHERE id = ?;", [id]);
      this.db.exec("COMMIT;");
      this.persist();
      return { ok: true, sale_id: saleId };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      return { ok: false, error: error.message };
    }
  }

  listSales(limit = 200) {
    const sales = this.selectAll(
      `
      SELECT
        s.id,
        s.customer_id,
        c.name AS customer_name,
        s.sold_at,
        s.status,
        s.total_minor,
        s.paid_minor,
        s.note,
        s.balance_before_minor,
        s.balance_after_minor
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      ORDER BY s.sold_at DESC
      LIMIT ?;
    `,
      [Number(limit)]
    );

    for (const sale of sales) {
      sale.items = this.selectAll(
        `
        SELECT
          si.id,
          si.product_id,
          CASE
            WHEN si.product_id IS NULL THEN TRIM(COALESCE(si.adhoc_label, ''))
            ELSE COALESCE(p.name, '')
          END AS product_name,
          COALESCE(p.unit, si.adhoc_unit, '') AS unit,
          si.qty,
          COALESCE(si.returned_qty, 0) AS returned_qty,
          si.unit_price_minor,
          si.line_total_minor
        FROM sale_items si
        LEFT JOIN products p ON p.id = si.product_id
        WHERE si.sale_id = ?;
      `,
        [sale.id]
      );
    }
    return sales;
  }

  listSalesByCustomer(customerId, limit = 500) {
    const id = Number(customerId);
    if (!id) {
      return [];
    }
    const sales = this.selectAll(
      `
      SELECT
        s.id,
        s.customer_id,
        c.name AS customer_name,
        s.sold_at,
        s.status,
        s.total_minor,
        s.paid_minor,
        s.note,
        s.balance_before_minor,
        s.balance_after_minor
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.customer_id = ?
      ORDER BY s.sold_at DESC
      LIMIT ?;
    `,
      [id, Number(limit)]
    );

    for (const sale of sales) {
      sale.items = this.selectAll(
        `
        SELECT
          si.id,
          si.product_id,
          CASE
            WHEN si.product_id IS NULL THEN TRIM(COALESCE(si.adhoc_label, ''))
            ELSE COALESCE(p.name, '')
          END AS product_name,
          COALESCE(p.unit, si.adhoc_unit, '') AS unit,
          si.qty,
          COALESCE(si.returned_qty, 0) AS returned_qty,
          si.unit_price_minor,
          si.line_total_minor
        FROM sale_items si
        LEFT JOIN products p ON p.id = si.product_id
        WHERE si.sale_id = ?;
      `,
        [sale.id]
      );
    }
    return sales;
  }

  reportSummary(payload = {}) {
    const from = payload.from || "1970-01-01T00:00:00.000Z";
    const to = payload.to || "2999-12-31T23:59:59.999Z";
    const aggregate =
      this.selectOne(
        `
      SELECT
        COUNT(*) AS sales_count,
        COALESCE(SUM(total_minor), 0) AS total_revenue_minor
      FROM sales
      WHERE status = 'completed' AND sold_at BETWEEN ? AND ?;
    `,
        [from, to]
      ) || {};

    const topProducts = this.selectAll(
      `
      SELECT
        p.name,
        SUM(si.qty - COALESCE(si.returned_qty, 0)) AS total_qty,
        SUM(si.line_total_minor) AS total_amount_minor
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      WHERE s.status = 'completed' AND s.sold_at BETWEEN ? AND ? AND si.product_id IS NOT NULL
      GROUP BY si.product_id, p.name
      ORDER BY total_amount_minor DESC
      LIMIT 10;
    `,
      [from, to]
    );

    const stockAlerts = this.selectAll(
      `
      SELECT p.id, p.name, b.quantity, p.low_stock_threshold
      FROM inventory_balances b
      JOIN products p ON p.id = b.product_id
      WHERE p.is_active = 1
        AND b.quantity <= COALESCE(p.low_stock_threshold, 5)
      ORDER BY b.quantity ASC, p.name ASC;
    `
    );

    return {
      sales_count: Number(aggregate.sales_count || 0),
      total_revenue_minor: Number(aggregate.total_revenue_minor || 0),
      top_products: topProducts,
      low_stock: stockAlerts
    };
  }

  getDashboard() {
    const productCount = this.selectOne(
      "SELECT COUNT(*) AS value FROM products WHERE is_active = 1;"
    )?.value;
    const customerCount = this.selectOne("SELECT COUNT(*) AS value FROM customers;")?.value;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const end = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      23,
      59,
      59,
      999
    ).toISOString();
    const todaySales =
      this.selectOne(
        `
      SELECT
        COUNT(*) AS sales_count,
        COALESCE(SUM(total_minor), 0) AS total_revenue_minor
      FROM sales
      WHERE status = 'completed' AND sold_at BETWEEN ? AND ?;
    `,
        [start, end]
      ) || {};
    const totalStockValue =
      this.selectOne(
        `
      SELECT COALESCE(SUM(p.purchase_price_minor * b.quantity), 0) AS value
      FROM inventory_balances b
      JOIN products p ON p.id = b.product_id;
    `
      ) || {};
    return {
      active_products: Number(productCount || 0),
      customers: Number(customerCount || 0),
      today_sales_count: Number(todaySales.sales_count || 0),
      today_revenue_minor: Number(todaySales.total_revenue_minor || 0),
      stock_value_minor: Number(totalStockValue.value || 0)
    };
  }

  getSellerProfile() {
    let row = this.selectOne("SELECT * FROM seller_profile WHERE id = 1;");
    if (!row) {
      const now = this.now();
      this.execute(
        `INSERT INTO seller_profile (id, shop_name, seller_name, phone, email, notes, updated_at)
         VALUES (1, '', '', '', '', '', ?);`,
        [now]
      );
      this.persist();
      row = this.selectOne("SELECT * FROM seller_profile WHERE id = 1;");
    }
    return {
      shop_name: row.shop_name ?? "",
      seller_name: row.seller_name ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      notes: row.notes ?? "",
      updated_at: row.updated_at
    };
  }

  updateSellerProfile(payload) {
    this.getSellerProfile();
    const now = this.now();
    try {
      this.execute(
        `UPDATE seller_profile SET shop_name = ?, seller_name = ?, phone = ?, email = ?, notes = ?, updated_at = ?
         WHERE id = 1;`,
        [
          String(payload.shop_name ?? "").trim(),
          String(payload.seller_name ?? "").trim(),
          String(payload.phone ?? "").trim(),
          String(payload.email ?? "").trim(),
          String(payload.notes ?? "").trim(),
          now
        ]
      );
      this.persist();
      return { ok: true, profile: this.getSellerProfile() };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  normalizeHeaderKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\u00A0/g, " ")
      .replace(/[\s_-]+/g, "");
  }

  cleanText(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/\u00A0/g, " ").trim();
  }

  parseInteger(value) {
    const raw = this.cleanText(value);
    if (!raw) return null;
    const normalized = raw.replace(/[^\d-]/g, "");
    if (!normalized || normalized === "-") return null;
    const num = Number(normalized);
    if (Number.isNaN(num)) return null;
    return Math.trunc(num);
  }

  parseQtyImportValue(value, unit) {
    const raw = this.cleanText(value);
    if (!raw) return null;
    if (qtyIsFractionalUnit(unit)) {
      const normalized = raw.replace(/,/g, ".").replace(/[^\d.\-]/g, "");
      if (!normalized || normalized === "-" || normalized === ".") return null;
      const num = Number(normalized);
      if (Number.isNaN(num)) return null;
      return qtyRound3(num);
    }
    return this.parseInteger(value);
  }

  getCellByAliases(row, aliases) {
    const entries = Object.entries(row || {});
    for (const alias of aliases) {
      const normalizedAlias = this.normalizeHeaderKey(alias);
      const match = entries.find(([key]) => this.normalizeHeaderKey(key) === normalizedAlias);
      if (match && this.cleanText(match[1])) {
        return match[1];
      }
    }
    return "";
  }

  importProductsFromRows(rows = []) {
    const aliases = {
      name: ["nomi", "name", "mahsulot", "product"],
      qty: ["soni", "quantity", "qty", "qoldiq", "stock"],
      salePrice: ["narxi", "price", "saleprice", "sotuvnarxi", "sotuv_narxi"],
      purchasePrice: ["kirimnarxi", "purchaseprice", "purchase_price", "cost", "costprice"],
      unit: ["birlik", "unit", "olchov"]
    };

    const result = {
      ok: true,
      total_rows: Array.isArray(rows) ? rows.length : 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    if (!Array.isArray(rows) || rows.length === 0) {
      result.ok = false;
      result.errors.push("Import faylida ma'lumot topilmadi.");
      return result;
    }

    const now = this.now();

    try {
      this.db.exec("BEGIN TRANSACTION;");

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const rowNo = index + 2;
        const name = this.cleanText(this.getCellByAliases(row, aliases.name));
        if (!name) {
          result.skipped += 1;
          continue;
        }

        const unit = this.cleanText(this.getCellByAliases(row, aliases.unit)) || "dona";
        const qty = this.parseQtyImportValue(this.getCellByAliases(row, aliases.qty), unit);
        const salePrice = this.parseInteger(this.getCellByAliases(row, aliases.salePrice));
        const purchasePrice = this.parseInteger(this.getCellByAliases(row, aliases.purchasePrice));

        const existing = this.selectOne(
          "SELECT * FROM products WHERE lower(trim(name)) = lower(trim(?)) ORDER BY id ASC LIMIT 1;",
          [name]
        );

        if (existing) {
          const nextSale = salePrice === null ? Number(existing.sale_price_minor) : salePrice;
          const nextPurchase =
            purchasePrice === null ? Number(existing.purchase_price_minor) : purchasePrice;

          this.execute(
            `UPDATE products
             SET name = ?, unit = ?, purchase_price_minor = ?, sale_price_minor = ?, updated_at = ?
             WHERE id = ?;`,
            [name, unit, nextPurchase, nextSale, now, Number(existing.id)]
          );

          if (qty !== null) {
            const currentBalance = this.selectOne(
              "SELECT quantity FROM inventory_balances WHERE product_id = ?;",
              [Number(existing.id)]
            );
            const currentQty = Number(currentBalance?.quantity || 0);
            const delta = qty - currentQty;
            if (delta !== 0) {
              this.execute(
                "UPDATE inventory_balances SET quantity = ?, updated_at = ? WHERE product_id = ?;",
                [qty, now, Number(existing.id)]
              );
              this.execute(
                `INSERT INTO inventory_movements (product_id, delta_qty, reason, ref_type, ref_id, note, created_at)
                 VALUES (?, ?, 'import', 'import', NULL, ?, ?);`,
                [Number(existing.id), delta, `Import row ${rowNo}`, now]
              );
            }
          }

          result.updated += 1;
          continue;
        }

        const insertSalePrice = salePrice === null ? 0 : salePrice;
        const insertPurchase = purchasePrice === null ? 0 : purchasePrice;
        const insertQty = qty === null ? 0 : qty;

        if (insertSalePrice < 0 || insertPurchase < 0) {
          result.errors.push(`Qator ${rowNo}: manfiy narx qiymati.`);
          result.skipped += 1;
          continue;
        }

        this.execute(
          `INSERT INTO products (name, unit, purchase_price_minor, sale_price_minor, is_active, low_stock_threshold, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, 5, ?, ?);`,
          [name, unit, insertPurchase, insertSalePrice, now, now]
        );
        const productId = this.getLastInsertId();
        this.execute(
          "INSERT INTO inventory_balances (product_id, quantity, updated_at) VALUES (?, ?, ?);",
          [productId, insertQty, now]
        );
        if (insertQty !== 0) {
          this.execute(
            `INSERT INTO inventory_movements (product_id, delta_qty, reason, ref_type, ref_id, note, created_at)
             VALUES (?, ?, 'import', 'import', NULL, ?, ?);`,
            [productId, insertQty, `Import row ${rowNo}`, now]
          );
        }
        result.created += 1;
      }

      this.db.exec("COMMIT;");
      this.persist();
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      return {
        ok: false,
        total_rows: result.total_rows,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: [...result.errors, error.message]
      };
    }
  }

  getInventoryExportRows() {
    const rows = this.selectAll(
      `
      SELECT
        p.name AS nomi,
        b.quantity AS soni,
        p.sale_price_minor AS narxi,
        p.purchase_price_minor AS kirim_narxi,
        p.unit AS birlik,
        p.is_active AS aktiv
      FROM products p
      LEFT JOIN inventory_balances b ON b.product_id = p.id
      ORDER BY p.name ASC;
    `
    );

    return rows.map((item) => ({
      nomi: item.nomi,
      soni: Number(item.soni || 0),
      narxi: Number(item.narxi || 0),
      kirim_narxi: Number(item.kirim_narxi || 0),
      birlik: item.birlik || "dona",
      aktiv: Number(item.aktiv || 0) ? "ha" : "yo'q"
    }));
  }
}

module.exports = DatabaseService;
