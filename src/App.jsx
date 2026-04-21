import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Info, Pencil, Trash2 } from "lucide-react";
import { copySaleReceiptAsImage, printSaleReceipt } from "./receiptUtils.js";
import LicenseGate from "./LicenseGate.jsx";
import {
  exceedsStock,
  formatQtyPlain,
  formatStockQtyWithUnit,
  isFractionalMeasureUnit,
  normalizeSaleQty,
  normalizeStockLevel,
  roundQty3
} from "./qtyUnits.js";

const APP_ABOUT_LEAD =
  "Mahalliy ish stoli dasturi: mahsulotlar va ombor, xaridorlar, savdo, hisobotlar va cheklar.";

const tabs = [
  { id: "dashboard", label: "Dashboard" },
  { id: "products", label: "Mahsulotlar" },
  { id: "customers", label: "Xaridorlar" },
  { id: "sales", label: "Savdo" },
  { id: "history", label: "Savdo tarixi" },
  { id: "reports", label: "Hisobotlar" }
];

const emptyProductForm = {
  name: "",
  unit: "dona",
  purchase_price_minor: "0",
  sale_price_minor: "",
  initial_qty: "0",
  edit_stock_qty: ""
};

const emptySellerProfile = {
  shop_name: "",
  seller_name: "",
  phone: "",
  email: "",
  notes: ""
};

const emptyAdhocSaleForm = {
  name: "",
  unit: "dona",
  qty: "",
  unit_price_minor: "",
  line_total_minor: ""
};

const STANDARD_UNIT_OPTIONS = [
  { value: "dona", label: "dona" },
  { value: "m²", label: "m²" },
  { value: "kg", label: "kg" }
];

const STANDARD_UNIT_SET = new Set(STANDARD_UNIT_OPTIONS.map((o) => o.value));

function canonicalUnitString(raw) {
  const u = String(raw ?? "").trim();
  return u === "m2" ? "m²" : u;
}

/** Savatdagi omborsiz qator: faqat standart uchta birlik */
function adhocUnitForSelect(raw) {
  const c = canonicalUnitString(raw);
  return STANDARD_UNIT_SET.has(c) ? c : "dona";
}

function productUnitSelectValue(unit) {
  const c = canonicalUnitString(unit);
  if (!c) return "dona";
  return c;
}

function productUnitSelectOptions(currentUnit) {
  const c = canonicalUnitString(currentUnit);
  const out = [];
  if (c && !STANDARD_UNIT_SET.has(c)) {
    out.push({ value: c, label: c });
  }
  for (const o of STANDARD_UNIT_OPTIONS) {
    out.push(o);
  }
  return out;
}

function formatMoney(value) {
  return new Intl.NumberFormat("uz-UZ").format(Number(value || 0));
}

/** Butun so'm (1 so'm aniqligi); input qadamini UI da 100 qilamiz */
function roundSomInteger(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.round(n);
}

/** Omborsiz qator: miqdor × narx → jami (butun so'm) */
function syncAdhocLineTotalFromQtyAndPrice(form) {
  const unit = String(form.unit || "dona").trim() || "dona";
  const qtyNorm = normalizeSaleQty(unit, form.qty);
  const u = roundSomInteger(form.unit_price_minor);
  if (qtyNorm == null || qtyNorm <= 0 || u <= 0) {
    return { ...form, line_total_minor: "" };
  }
  const lt = roundSomInteger(qtyNorm * u);
  return { ...form, line_total_minor: String(lt) };
}

/** Omborsiz qator: jami / miqdor → narx (savatdagi qator bilan bir xil) */
function syncAdhocUnitPriceFromLineTotal(form) {
  const unit = String(form.unit || "dona").trim() || "dona";
  const qtyNorm = normalizeSaleQty(unit, form.qty);
  const lt = roundSomInteger(form.line_total_minor);
  if (qtyNorm == null || qtyNorm <= 0) {
    return form;
  }
  if (lt < 0) return form;
  const u = roundSomInteger(lt / qtyNorm);
  return { ...form, unit_price_minor: String(u) };
}

function isAdhocCartItem(item) {
  return item?.cart_kind === "adhoc";
}

function cartRowKey(item) {
  if (item?.lineKey) return item.lineKey;
  if (isAdhocCartItem(item)) {
    return `a-${item.adhoc_label}-${String(item.qty)}`;
  }
  return `c-${item.product_id}`;
}

/** Savat satrida ko'rinadigan 1 dona narxi (tahrir yoki katalog) — backendga shu yuboriladi */
function effectiveCartUnitPriceMinor(item, product) {
  if (isAdhocCartItem(item)) {
    return roundSomInteger(item.unit_price_minor ?? 0);
  }
  if (item.unit_price_minor != null && item.unit_price_minor !== "") {
    return roundSomInteger(item.unit_price_minor);
  }
  return roundSomInteger(Number(product?.sale_price_minor ?? 0));
}

/** Qoralama: faqat saqlangan 1 dona narxi; ombor narxi ishlatilmaydi */
function draftLineStoredUnitMinor(line) {
  if (line.unit_price_minor != null && line.unit_price_minor !== "") {
    return roundSomInteger(Number(line.unit_price_minor));
  }
  return 0;
}

/** Savdo qatorida mijozda qolgan sotilgan miqdor */
function saleLineSoldRemaining(item) {
  const q = Number(item.qty) || 0;
  const r = Number(item.returned_qty) || 0;
  return roundQty3(q - r);
}

/** Qaytarish modali: qolgan miqdorni tekshirish */
function parseRemainingQtyForReturn(unit, raw, maxRemain) {
  const maxR = roundQty3(Number(maxRemain));
  if (!Number.isFinite(maxR) || maxR < 0) return null;
  const n = Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  if (isFractionalMeasureUnit(unit)) {
    const r = roundQty3(n);
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

/** Scrollbar oxiriga yetgan bo'lsa, kontent ham aniq pastki chegarani ko'rsatsin (subpiksel / wheel drift) */
function syncScrollContainerEdges(el) {
  if (!el) return;
  const sh = el.scrollHeight;
  const ch = el.clientHeight;
  const max = Math.max(0, sh - ch);
  if (max <= 0) return;
  const st = el.scrollTop;
  if (st + ch >= sh - 2) {
    if (Math.abs(st - max) > 0.25) el.scrollTop = max;
  } else if (st <= 1) {
    if (st > 0.25) el.scrollTop = 0;
  }
}

function buildSaleItemsFromCart(cartItems, productMap) {
  return cartItems
    .map((item) => {
      if (isAdhocCartItem(item)) {
        const unit = String(item.adhoc_unit || "dona").trim() || "dona";
        const qty = normalizeSaleQty(unit, item.qty);
        if (qty == null) return null;
        const label = String(item.adhoc_label || "").trim();
        if (!label) return null;
        const u = roundSomInteger(item.unit_price_minor ?? 0);
        if (u <= 0) return null;
        return {
          adhoc: true,
          adhoc_label: label,
          adhoc_unit: unit,
          qty,
          unit_price_minor: u
        };
      }
      const product = productMap.get(Number(item.product_id));
      if (!product) return null;
      const qty = normalizeSaleQty(product.unit, item.qty);
      if (qty == null) return null;
      return {
        product_id: Number(item.product_id),
        qty,
        unit_price_minor: effectiveCartUnitPriceMinor(item, product)
      };
    })
    .filter(Boolean);
}

/** 0, bo'sh yoki noto'g'ri miqdorli qatorlarni ajratib tashlash (yakunlashdan oldin) */
function sanitizeCartForCheckout(cartItems, productMap) {
  const kept = [];
  let dropped = 0;
  for (const item of cartItems) {
    if (isAdhocCartItem(item)) {
      const name = String(item.adhoc_label || "").trim();
      if (!name) {
        dropped += 1;
        continue;
      }
      const unit = String(item.adhoc_unit || "dona").trim() || "dona";
      const qty = normalizeSaleQty(unit, item.qty);
      if (qty == null || qty <= 0) {
        dropped += 1;
        continue;
      }
      const u = roundSomInteger(item.unit_price_minor ?? 0);
      if (u <= 0) {
        dropped += 1;
        continue;
      }
      kept.push(item);
      continue;
    }
    const p = productMap.get(Number(item.product_id));
    if (!p) {
      dropped += 1;
      continue;
    }
    if (normalizeSaleQty(p.unit, item.qty) == null) {
      dropped += 1;
      continue;
    }
    kept.push(item);
  }
  return { kept, dropped };
}

function startOfDayIso(dateString) {
  if (!dateString) return "1970-01-01T00:00:00.000Z";
  return new Date(`${dateString}T00:00:00`).toISOString();
}

function endOfDayIso(dateString) {
  if (!dateString) return "2999-12-31T23:59:59.999Z";
  return new Date(`${dateString}T23:59:59.999`).toISOString();
}

function addProductToCartLine(setCartItems, productMap, productId, addQty, onNotice) {
  const product = productMap.get(Number(productId));
  if (!product) {
    onNotice("Mahsulot topilmadi.");
    return;
  }
  const isFrac = isFractionalMeasureUnit(product.unit);
  let add = Number(String(addQty).replace(",", "."));
  if (!Number.isFinite(add) || add <= 0) {
    add = isFrac ? 0.001 : 1;
  }
  const qtyDelta = isFrac ? roundQty3(Math.max(0.001, add)) : Math.max(1, Math.round(add));

  if (Number(product.stock_qty) <= 0) {
    onNotice("Bu mahsulotning qoldig'i yo'q.");
    return;
  }
  setCartItems((prev) => {
    const found = prev.find((item) => Number(item.product_id) === Number(productId));
    if (!found) {
      if (exceedsStock(qtyDelta, product.stock_qty)) {
        onNotice("Qoldiq yetarli emas.");
        return prev;
      }
      return [
        ...prev,
        {
          cart_kind: "catalog",
          lineKey: `c-${Number(productId)}`,
          product_id: Number(productId),
          qty: qtyDelta,
          unit_price_minor: null
        }
      ];
    }
    const baseParsed = normalizeSaleQty(product.unit, found.qty);
    const base = baseParsed == null ? 0 : baseParsed;
    const nextQty = isFrac ? roundQty3(base + qtyDelta) : base + qtyDelta;
    if (exceedsStock(nextQty, product.stock_qty)) {
      onNotice("Qoldiq yetarli emas.");
      return prev;
    }
    return prev.map((item) => {
      if (Number(item.product_id) !== Number(productId)) return item;
      const lineKey = item.lineKey ?? `c-${Number(productId)}`;
      const cart_kind = item.cart_kind ?? "catalog";
      return { ...item, cart_kind, lineKey, qty: nextQty };
    });
  });
}

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  /** Litsenziya: checking → blocked (LicenseGate) yoki ok (asosiy dastur) */
  const [licensePhase, setLicensePhase] = useState("checking");
  const [licenseInfo, setLicenseInfo] = useState(null);

  const [dashboard, setDashboard] = useState(null);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);

  const [productForm, setProductForm] = useState(emptyProductForm);
  const [editingProductId, setEditingProductId] = useState(null);

  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [customerSales, setCustomerSales] = useState([]);
  const [customerChatMessages, setCustomerChatMessages] = useState([]);
  const [customerChatInput, setCustomerChatInput] = useState("");

  const [saleCustomerName, setSaleCustomerName] = useState("");
  const [salePickedCustomerId, setSalePickedCustomerId] = useState(null);
  const [saleCustomerPhone, setSaleCustomerPhone] = useState("");
  const [saleCustomerAddress, setSaleCustomerAddress] = useState("");
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [cartItems, setCartItems] = useState([]);
  const [adhocSaleForm, setAdhocSaleForm] = useState(emptyAdhocSaleForm);
  const [salePaymentInput, setSalePaymentInput] = useState("");

  const [customerDrafts, setCustomerDrafts] = useState([]);
  const [draftPaymentById, setDraftPaymentById] = useState({});
  const draftLineTotalsRef = useRef({});
  const [editingDraftId, setEditingDraftId] = useState(null);
  /** Electron native dialog Windows'da fokusni buzadi — faqat React modal */
  const [deleteDraftModal, setDeleteDraftModal] = useState(null);
  const [deleteCustomerModal, setDeleteCustomerModal] = useState(null);
  const [customerEditModal, setCustomerEditModal] = useState(null);
  const [receiptOptionsModal, setReceiptOptionsModal] = useState(null);
  const [saleReturnModal, setSaleReturnModal] = useState(null);
  const [saleReturnDraftLines, setSaleReturnDraftLines] = useState([]);
  const [aboutModalOpen, setAboutModalOpen] = useState(false);
  const [aboutAppMeta, setAboutAppMeta] = useState(null);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState(null);
  /** Yuklab olingan, lekin o'rnatilmagan — "Yangilash" tugmasi */
  const [updatePendingInstall, setUpdatePendingInstall] = useState(null);

  const customerChatEndRef = useRef(null);
  const appMainRef = useRef(null);
  const customerChatScrollRef = useRef(null);
  const dbMenuRef = useRef(null);
  const [dbMenuOpen, setDbMenuOpen] = useState(false);

  const customerSalesChronological = useMemo(
    () => [...customerSales].reverse(),
    [customerSales]
  );

  /** Savdolar, qoralamalar va matn xabarlarni vaqt bo'yicha aralashtirish */
  const customerChatTimeline = useMemo(() => {
    const rows = [];
    for (const sale of customerSalesChronological) {
      const at = Date.parse(sale.sold_at) || 0;
      rows.push({ type: "sale", at, key: `sale-${sale.id}`, sale });
    }
    for (const draft of customerDrafts) {
      const at = Date.parse(draft.created_at) || 0;
      rows.push({ type: "draft", at, key: `draft-${draft.id}`, draft });
    }
    for (const msg of customerChatMessages) {
      const at = Date.parse(msg.created_at) || 0;
      rows.push({ type: "note", at, key: `note-${msg.id}`, message: msg });
    }
    rows.sort((a, b) => {
      if (a.at !== b.at) return a.at - b.at;
      return String(a.key).localeCompare(String(b.key), "en");
    });
    return rows;
  }, [customerSalesChronological, customerDrafts, customerChatMessages]);

  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportData, setReportData] = useState({
    sales_count: 0,
    total_revenue_minor: 0,
    top_products: [],
    low_stock: []
  });

  const [productsListQuery, setProductsListQuery] = useState("");
  const [productsListFilter, setProductsListFilter] = useState("all");
  const [customersListQuery, setCustomersListQuery] = useState("");
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [sellerProfileForm, setSellerProfileForm] = useState(() => ({ ...emptySellerProfile }));
  const [dashShopPanelOpen, setDashShopPanelOpen] = useState(false);
  const [productsFormOpen, setProductsFormOpen] = useState(false);

  const api = window.api;

  useEffect(() => {
    if (typeof api?.onUpdateDownloadProgress !== "function") {
      return undefined;
    }
    return api.onUpdateDownloadProgress((payload) => {
      setUpdateDownloadProgress(payload == null ? null : payload);
    });
  }, [api]);

  useEffect(() => {
    if (typeof api?.onUpdatePendingInstall !== "function") {
      return undefined;
    }
    return api.onUpdatePendingInstall((payload) => {
      if (payload && typeof payload.version === "string" && payload.version.trim() !== "") {
        setUpdatePendingInstall({ version: payload.version.trim() });
      } else {
        setUpdatePendingInstall(null);
      }
    });
  }, [api]);

  useEffect(() => {
    if (typeof api?.getUpdateState !== "function") {
      return undefined;
    }
    let cancelled = false;
    void api.getUpdateState().then((s) => {
      if (cancelled) return;
      if (s?.pendingInstall && typeof s.version === "string") {
        setUpdatePendingInstall({ version: s.version });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!aboutModalOpen || typeof api?.getUpdateState !== "function") return undefined;
    let cancelled = false;
    void api.getUpdateState().then((s) => {
      if (cancelled) return;
      if (s?.pendingInstall && typeof s.version === "string") {
        setUpdatePendingInstall({ version: s.version });
      } else {
        setUpdatePendingInstall(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [aboutModalOpen, api]);

  /** Scroll konteyner(lar): scrollbar va kontent oxir/bosh sinxron (scrolldan tashqari ham) */
  useEffect(() => {
    if (loading) return undefined;
    const getNodes = () => [appMainRef.current, customerChatScrollRef.current].filter(Boolean);
    const nodes = getNodes();
    if (!nodes.length) return undefined;

    let syncAllRaf = 0;
    const scheduleSyncAll = () => {
      window.cancelAnimationFrame(syncAllRaf);
      syncAllRaf = window.requestAnimationFrame(() => {
        getNodes().forEach((n) => syncScrollContainerEdges(n));
      });
    };

    const onResize = () => scheduleSyncAll();
    const onVisibility = () => {
      if (document.visibilityState === "visible") scheduleSyncAll();
    };
    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    scheduleSyncAll();

    const cleanups = nodes.map((el) => {
      let raf = 0;
      let wheelT = 0;
      let moRaf = 0;
      const scheduleSync = () => {
        window.cancelAnimationFrame(raf);
        raf = window.requestAnimationFrame(() => syncScrollContainerEdges(el));
      };
      const onWheel = () => {
        window.clearTimeout(wheelT);
        wheelT = window.setTimeout(() => syncScrollContainerEdges(el), 100);
      };
      const onMut = () => {
        window.cancelAnimationFrame(moRaf);
        moRaf = window.requestAnimationFrame(() => syncScrollContainerEdges(el));
      };
      el.addEventListener("scroll", scheduleSync, { passive: true });
      el.addEventListener("wheel", onWheel, { passive: true });
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleSync) : null;
      if (ro) ro.observe(el);
      const mo =
        typeof MutationObserver !== "undefined"
          ? new MutationObserver(onMut)
          : null;
      if (mo) {
        mo.observe(el, { childList: true, subtree: true });
      }
      return () => {
        window.cancelAnimationFrame(raf);
        window.cancelAnimationFrame(moRaf);
        window.clearTimeout(wheelT);
        el.removeEventListener("scroll", scheduleSync);
        el.removeEventListener("wheel", onWheel);
        if (ro) ro.disconnect();
        if (mo) mo.disconnect();
      };
    });
    return () => {
      window.cancelAnimationFrame(syncAllRaf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      cleanups.forEach((fn) => fn());
    };
  }, [loading, activeTab]);

  function restoreRendererFocus() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          try {
            window.focus();
          } catch {
            /* ignore */
          }
          if (api && typeof api.focusWindow === "function") {
            void api.focusWindow();
          }
          const firstTab = document.querySelector(".tabs .tab-btn");
          if (firstTab) {
            firstTab.focus({ preventScroll: true });
          }
        }, 0);
      });
    });
  }

  const productMap = useMemo(() => {
    const map = new Map();
    for (const p of products) {
      map.set(Number(p.id), p);
    }
    return map;
  }, [products]);

  const cartItemsRef = useRef(cartItems);
  const productMapRef = useRef(productMap);
  cartItemsRef.current = cartItems;
  productMapRef.current = productMap;

  /** React 18 navbatidagi setState (oxirgi input onChange) commit bo'lmagan bo'lsa, ref eski qoladi — flushSync bilan eng so'nggi savat */
  function takeCommittedCartSnapshot() {
    let snapshot = [];
    flushSync(() => {
      setCartItems((prev) => {
        snapshot = prev.map((row) => ({ ...row }));
        return prev;
      });
    });
    cartItemsRef.current = snapshot;
    return snapshot;
  }

  /** Savat inputlarida oxirgi qiymat state ga commit bo'lishi uchun (Shakllantirish / Yakunlash) */
  async function flushPendingCartFieldEdits() {
    const active = document.activeElement;
    if (active?.closest?.(".sales-cart-column")) {
      active.blur();
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  }

  const cartTotal = useMemo(() => {
    return cartItems.reduce((sum, item) => {
      if (isAdhocCartItem(item)) {
        const unit = String(item.adhoc_unit || "dona").trim() || "dona";
        const q = normalizeSaleQty(unit, item.qty);
        if (q == null) return sum;
        const u = effectiveCartUnitPriceMinor(item, null);
        return sum + roundSomInteger(u * q);
      }
      const product = productMap.get(Number(item.product_id));
      if (!product) return sum;
      const q = normalizeSaleQty(product.unit, item.qty);
      if (q == null) return sum;
      const u = effectiveCartUnitPriceMinor(item, product);
      return sum + roundSomInteger(u * q);
    }, 0);
  }, [cartItems, productMap]);

  useEffect(() => {
    setSalePaymentInput(String(cartTotal));
  }, [cartTotal]);

  const cartPaymentApplied = useMemo(() => {
    if (cartTotal <= 0) return 0;
    const raw = roundSomInteger(salePaymentInput);
    return Math.min(Math.max(0, raw), cartTotal);
  }, [cartTotal, salePaymentInput]);

  const cartDebtPreview = useMemo(
    () => (cartTotal > 0 ? Math.max(0, cartTotal - cartPaymentApplied) : 0),
    [cartTotal, cartPaymentApplied]
  );

  /** Manfiy: sotuvchining xaridorga qarzi (ortiqcha to'lov / avans) */
  const selectedCustomerBalance = useMemo(() => {
    if (!selectedCustomerId) return 0;
    const c = customers.find((x) => Number(x.id) === Number(selectedCustomerId));
    return Number(c?.outstanding_debt_minor) || 0;
  }, [customers, selectedCustomerId]);

  const canDeleteSelectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return false;
    const c = customers.find((x) => Number(x.id) === Number(selectedCustomerId));
    if (!c) return false;
    return String(c.name || "").trim().toLowerCase() !== "anonim";
  }, [customers, selectedCustomerId]);

  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customers.find((x) => Number(x.id) === Number(selectedCustomerId)) || null;
  }, [customers, selectedCustomerId]);

  const lowStockProducts = useMemo(
    () => products.filter((item) => Number(item.stock_qty) <= 5 && Number(item.is_active) === 1),
    [products]
  );

  const filteredCustomersForList = useMemo(() => {
    const raw = customersListQuery.trim();
    if (!raw) return customers;
    const q = raw.toLowerCase();
    const qDigits = raw.replace(/\D/g, "");
    return customers.filter((c) => {
      const name = String(c.name || "").toLowerCase();
      if (name.includes(q)) return true;
      const addr = String(c.address || "").toLowerCase();
      if (addr.includes(q)) return true;
      const phoneRaw = String(c.phone || "");
      if (phoneRaw.toLowerCase().includes(q)) return true;
      if (qDigits.length >= 2) {
        const phoneDigits = phoneRaw.replace(/\D/g, "");
        if (phoneDigits.includes(qDigits)) return true;
      }
      return false;
    });
  }, [customers, customersListQuery]);

  const filteredProductsForTable = useMemo(() => {
    let rows = products;
    switch (productsListFilter) {
      case "active":
        rows = rows.filter((p) => Number(p.is_active) === 1);
        break;
      case "inactive":
        rows = rows.filter((p) => Number(p.is_active) !== 1);
        break;
      case "low_stock":
        rows = rows.filter((p) => Number(p.is_active) === 1 && Number(p.stock_qty) <= 5);
        break;
      case "no_stock":
        rows = rows.filter((p) => Number(p.stock_qty) <= 0);
        break;
      default:
        break;
    }
    const q = productsListQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter((p) => {
        const name = String(p.name || "").toLowerCase();
        const unit = String(p.unit || "").toLowerCase();
        return name.includes(q) || unit.includes(q);
      });
    }
    return rows;
  }, [products, productsListQuery, productsListFilter]);

  const filteredSalesHistory = useMemo(() => {
    let rows = sales;
    if (historyDateFrom) {
      const fromMs = Date.parse(`${historyDateFrom}T00:00:00`);
      if (!Number.isNaN(fromMs)) {
        rows = rows.filter((s) => (Date.parse(s.sold_at) || 0) >= fromMs);
      }
    }
    if (historyDateTo) {
      const toMs = Date.parse(`${historyDateTo}T23:59:59.999`);
      if (!Number.isNaN(toMs)) {
        rows = rows.filter((s) => (Date.parse(s.sold_at) || 0) <= toMs);
      }
    }
    const q = historySearchQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter((sale) => {
        if (String(sale.id).includes(q)) return true;
        const cust = String(sale.customer_name || "Anonim").toLowerCase();
        if (cust.includes(q)) return true;
        const note = String(sale.note || "").toLowerCase();
        if (note.includes(q)) return true;
        for (const it of sale.items || []) {
          if (String(it.product_name || "").toLowerCase().includes(q)) return true;
        }
        const digits = q.replace(/[\s\u00a0]/g, "");
        if (/^\d+$/.test(digits)) {
          const tot = String(sale.total_minor ?? "");
          const paidRaw = sale.paid_minor;
          const paid =
            paidRaw != null && paidRaw !== "" ? String(paidRaw) : tot;
          if (tot.includes(digits) || paid.includes(digits)) return true;
        }
        return false;
      });
    }
    return rows;
  }, [sales, historySearchQuery, historyDateFrom, historyDateTo]);

  const customerNameSuggestions = useMemo(() => {
    const q = saleCustomerName.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((c) => String(c.name || "").toLowerCase().includes(q))
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "uz", { sensitivity: "base" })
      )
      .slice(0, 5);
  }, [customers, saleCustomerName]);

  const exactSaleCustomerMatch = useMemo(() => {
    const name = saleCustomerName.trim();
    if (!name) return null;
    return (
      customers.find(
        (c) => String(c.name || "").trim().toLowerCase() === name.toLowerCase()
      ) || null
    );
  }, [customers, saleCustomerName]);

  const showNewCustomerConfirmRow =
    saleCustomerName.trim().length > 0 && !exactSaleCustomerMatch && !salePickedCustomerId;

  const productSearchHits = useMemo(() => {
    const q = productSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => Number(p.is_active) === 1 && Number(p.stock_qty) > 0)
      .filter((p) => {
        const name = String(p.name || "").toLowerCase();
        return name.includes(q);
      })
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "uz", { sensitivity: "base" })
      )
      .slice(0, 30);
  }, [products, productSearchQuery]);

  function pushNotice(message) {
    setNotice(message);
    window.setTimeout(() => {
      setNotice("");
    }, 2500);
  }

  async function refreshMainData() {
    if (!api) return;
    const [dashboardData, productList, customerList, salesList] = await Promise.all([
      api.getDashboard(),
      api.listProducts(),
      api.listCustomers(),
      api.listSales(200)
    ]);
    setDashboard(dashboardData);
    setProducts(productList);
    setCustomers(customerList);
    setSales(salesList);
    if (typeof api.getSellerProfile === "function") {
      try {
        const pr = await api.getSellerProfile();
        setSellerProfileForm({
          shop_name: String(pr.shop_name ?? ""),
          seller_name: String(pr.seller_name ?? ""),
          phone: String(pr.phone ?? ""),
          email: String(pr.email ?? ""),
          notes: String(pr.notes ?? "")
        });
      } catch {
        /* ignore */
      }
    }
  }

  async function loadInitial() {
    if (!api) {
      pushNotice("Electron API topilmadi. Dasturni Electron orqali ishga tushiring.");
      return;
    }
    setLoading(true);
    try {
      await refreshMainData();
      await loadReport();
    } catch (error) {
      pushNotice(`Yuklashda xatolik: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadReport() {
    if (!api) return;
    const summary = await api.getReportSummary({
      from: startOfDayIso(reportFrom),
      to: endOfDayIso(reportTo)
    });
    setReportData(summary);
  }

  async function saveSellerProfile(event) {
    event.preventDefault();
    if (!api?.updateSellerProfile) {
      pushNotice("Bu bo'lim faqat Electron dasturida saqlanadi.");
      return;
    }
    const res = await api.updateSellerProfile(sellerProfileForm);
    if (!res?.ok) {
      pushNotice(res?.error || "Ma'lumotlar saqlanmadi.");
      return;
    }
    if (res.profile) {
      setSellerProfileForm({
        shop_name: String(res.profile.shop_name ?? ""),
        seller_name: String(res.profile.seller_name ?? ""),
        phone: String(res.profile.phone ?? ""),
        email: String(res.profile.email ?? ""),
        notes: String(res.profile.notes ?? "")
      });
    }
    pushNotice("Do'kon va sotuvchi ma'lumotlari saqlandi.");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!api?.licenseGetStatus) {
        if (!cancelled) setLicensePhase("ok");
        return;
      }
      try {
        const s = await api.licenseGetStatus();
        if (cancelled) return;
        setLicenseInfo(s);
        if (s.valid === true || s.skipped === true) setLicensePhase("ok");
        else setLicensePhase("blocked");
      } catch (e) {
        if (!cancelled) {
          setLicenseInfo({ valid: false, error: "verify_failed", message: e.message });
          setLicensePhase("blocked");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (licensePhase !== "ok") return;
    void loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- faqat litsenziya ochilganda bir marta yuklash
  }, [licensePhase]);

  useEffect(() => {
    if (editingProductId != null) {
      setProductsFormOpen(true);
    }
  }, [editingProductId]);

  useEffect(() => {
    if (!dbMenuOpen) return;
    function onPointerDown(e) {
      if (dbMenuRef.current && !dbMenuRef.current.contains(e.target)) {
        setDbMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [dbMenuOpen]);

  /** Qoralama jami o'zgarganda to'lov maydonini yangilash; foydalanuvchi kiritgan qisman to'lovni saqlash */
  useEffect(() => {
    const prevTotals = draftLineTotalsRef.current;
    const totalsNow = {};
    for (const d of customerDrafts) {
      totalsNow[Number(d.id)] = draftItemsTotalMinor(d);
    }
    setDraftPaymentById((prev) => {
      const next = { ...prev };
      for (const d of customerDrafts) {
        const did = Number(d.id);
        const t = totalsNow[did];
        const oldT = prevTotals[did];
        if (oldT === undefined || oldT !== t) {
          next[did] = String(t);
        } else if (next[did] === undefined) {
          next[did] = String(t);
        }
      }
      for (const k of Object.keys(next)) {
        if (!Object.prototype.hasOwnProperty.call(totalsNow, k)) {
          delete next[k];
        }
      }
      return next;
    });
    draftLineTotalsRef.current = totalsNow;
  }, [customerDrafts]);

  useEffect(() => {
    if (!selectedCustomerId) return;
    if (
      !customerSales.length &&
      !customerDrafts.length &&
      !customerChatMessages.length
    ) {
      return;
    }
    customerChatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [
    selectedCustomerId,
    customerSalesChronological,
    customerDrafts,
    customerChatMessages
  ]);

  /** Xaridorlar bo'limiga qaytishda yoki xaridor almashtirilganda qoralamalar ro'yxatini DB dan qayta yuklash */
  useEffect(() => {
    if (activeTab !== "customers" || !api) return;
    const id = Number(selectedCustomerId);
    if (!Number.isFinite(id) || id <= 0) {
      setCustomerChatMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [salesRows, draftRows, chatRows] = await Promise.all([
        api.listSalesByCustomer(id, 500),
        api.listSaleDraftsByCustomer(id),
        api.listCustomerChatMessages(id, 500)
      ]);
      if (cancelled) return;
      setCustomerSales(salesRows);
      setCustomerDrafts(draftRows);
      setCustomerChatMessages(chatRows);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedCustomerId]);

  useEffect(() => {
    const anyModal =
      aboutModalOpen ||
      deleteDraftModal ||
      deleteCustomerModal ||
      customerEditModal ||
      receiptOptionsModal ||
      saleReturnModal;
    if (!anyModal) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (aboutModalOpen) setAboutModalOpen(false);
        else if (receiptOptionsModal) setReceiptOptionsModal(null);
        else if (saleReturnModal) {
          setSaleReturnModal(null);
          setSaleReturnDraftLines([]);
        } else if (customerEditModal) setCustomerEditModal(null);
        else if (deleteCustomerModal) setDeleteCustomerModal(null);
        else setDeleteDraftModal(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [
    aboutModalOpen,
    deleteDraftModal,
    deleteCustomerModal,
    customerEditModal,
    receiptOptionsModal,
    saleReturnModal
  ]);

  useEffect(() => {
    if (!aboutModalOpen) return;
    let cancelled = false;
    (async () => {
      if (typeof api?.getAppVersion !== "function") {
        if (!cancelled) setAboutAppMeta(null);
        return;
      }
      try {
        const meta = await api.getAppVersion();
        if (!cancelled) setAboutAppMeta(meta || null);
      } catch {
        if (!cancelled) setAboutAppMeta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aboutModalOpen, api]);

  async function handleProductSubmit(event) {
    event.preventDefault();
    if (!productForm.name.trim()) {
      pushNotice("Mahsulot nomi majburiy.");
      return;
    }
    if (!productForm.sale_price_minor) {
      pushNotice("Sotuv narxini kiriting.");
      return;
    }
    const payload = {
      ...productForm,
      purchase_price_minor: Number(productForm.purchase_price_minor || 0),
      sale_price_minor: Number(productForm.sale_price_minor || 0),
      initial_qty: Number(productForm.initial_qty || 0)
    };
    try {
      if (editingProductId) {
        const stockNorm = normalizeStockLevel(productForm.unit, productForm.edit_stock_qty);
        if (stockNorm === null) {
          pushNotice(
            "Qoldiq noto'g'ri: manfiy bo'lmasin; kg/m² uchun 0,001 qadam, dona uchun butun son."
          );
          return;
        }
        await api.updateProduct({
          name: payload.name,
          unit: payload.unit,
          purchase_price_minor: payload.purchase_price_minor,
          sale_price_minor: payload.sale_price_minor,
          id: editingProductId,
          is_active: true,
          stock_qty: stockNorm
        });
        pushNotice("Mahsulot yangilandi.");
      } else {
        await api.createProduct(payload);
        pushNotice("Mahsulot qo'shildi.");
      }
      setProductForm(emptyProductForm);
      setEditingProductId(null);
      await refreshMainData();
      await loadReport();
    } catch (error) {
      pushNotice(`Xatolik: ${error.message}`);
    }
  }

  function fillProductForEdit(product) {
    setEditingProductId(Number(product.id));
    setProductForm({
      name: product.name || "",
      unit: product.unit || "dona",
      purchase_price_minor: String(product.purchase_price_minor || 0),
      sale_price_minor: String(product.sale_price_minor || 0),
      initial_qty: "0",
      edit_stock_qty:
        product.stock_qty !== undefined && product.stock_qty !== null
          ? formatQtyPlain(product.stock_qty)
          : "0"
    });
  }

  function onSaleCustomerNameChange(value) {
    setSaleCustomerName(value);
    setSalePickedCustomerId(null);
  }

  function pickCustomerSuggestion(customer) {
    setSaleCustomerName(customer.name || "");
    setSalePickedCustomerId(Number(customer.id));
    setSaleCustomerPhone(customer.phone || "");
    setSaleCustomerAddress(customer.address || "");
  }

  function draftItemsTotalMinor(draft) {
    if (!draft?.items?.length) return 0;
    return draft.items.reduce((sum, it) => {
      const u = draftLineStoredUnitMinor(it);
      return sum + roundSomInteger(u * Number(it.qty || 0));
    }, 0);
  }

  async function confirmNewCustomerRow() {
    if (!api) return;
    const name = saleCustomerName.trim();
    if (!name) {
      pushNotice("Xaridor nomini kiriting.");
      return;
    }
    try {
      const created = await api.createCustomer({
        name,
        phone: saleCustomerPhone.trim() || null,
        address: saleCustomerAddress.trim() || "",
        notes: ""
      });
      setSalePickedCustomerId(Number(created.id));
      await refreshMainData();
      pushNotice("Yangi xaridor qo'shildi.");
    } catch (error) {
      pushNotice(`Xaridor yaratishda xato: ${error.message}`);
    }
  }

  /**
   * Savdo / qoralama uchun xaridorni aniqlaydi.
   * Nom bo'sh bo'lsa — anonim (backendda "Anonim" yozuvi).
   * Yangi ism faqat Tasdiqlash orqali ro'yxatga tushadi; yozilgan lekin tasdiqlanmagan nom — xato.
   */
  async function resolveCustomerForSale() {
    if (!api) return null;
    const name = saleCustomerName.trim();
    if (!name) {
      return { customerId: null, customerName: null, isAnonymous: true };
    }
    const phoneTrim = saleCustomerPhone.trim();
    const addressTrim = saleCustomerAddress.trim();
    const existing = customers.find(
      (c) => String(c.name || "").trim().toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      const id = Number(existing.id);
      setSalePickedCustomerId(id);
      if (phoneTrim || addressTrim) {
        const patch = { id };
        if (phoneTrim) patch.phone = phoneTrim;
        if (addressTrim) patch.address = addressTrim;
        const res = await api.updateCustomer(patch);
        if (!res?.ok) {
          pushNotice(res?.error || "Kontakt yangilanmadi.");
        } else {
          await refreshMainData();
        }
      }
      return { customerId: id, customerName: name, isAnonymous: false };
    }
    if (salePickedCustomerId) {
      const picked = customers.find((c) => Number(c.id) === Number(salePickedCustomerId));
      if (
        picked &&
        String(picked.name || "").trim().toLowerCase() === name.toLowerCase()
      ) {
        if (phoneTrim || addressTrim) {
          const id = Number(salePickedCustomerId);
          const patch = { id };
          if (phoneTrim) patch.phone = phoneTrim;
          if (addressTrim) patch.address = addressTrim;
          const res = await api.updateCustomer(patch);
          if (!res?.ok) {
            pushNotice(res?.error || "Kontakt yangilanmadi.");
          } else {
            await refreshMainData();
          }
        }
        return { customerId: Number(salePickedCustomerId), customerName: name, isAnonymous: false };
      }
    }
    pushNotice("Yangi xaridorni avval Tasdiqlash bilan ro'yxatga qo'shing.");
    return null;
  }

  async function loadCustomerSales(customerId) {
    if (!api) {
      setCustomerSales([]);
      return;
    }
    const id = Number(customerId);
    if (!Number.isFinite(id) || id <= 0) {
      setCustomerSales([]);
      return;
    }
    const rows = await api.listSalesByCustomer(id, 500);
    setCustomerSales(rows);
  }

  async function loadCustomerDrafts(customerId) {
    if (!api) {
      setCustomerDrafts([]);
      return;
    }
    const id = Number(customerId);
    if (!Number.isFinite(id) || id <= 0) {
      setCustomerDrafts([]);
      return;
    }
    const rows = await api.listSaleDraftsByCustomer(id);
    setCustomerDrafts(rows);
  }

  async function loadCustomerChatMessages(customerId) {
    if (!api) {
      setCustomerChatMessages([]);
      return;
    }
    const id = Number(customerId);
    if (!Number.isFinite(id) || id <= 0) {
      setCustomerChatMessages([]);
      return;
    }
    const rows = await api.listCustomerChatMessages(id, 500);
    setCustomerChatMessages(rows);
  }

  async function handleSendCustomerChat() {
    if (!api || !selectedCustomerId) return;
    const text = customerChatInput.trim();
    if (!text) {
      pushNotice("Xabar matnini kiriting.");
      return;
    }
    const res = await api.appendCustomerChatMessage({
      customer_id: selectedCustomerId,
      body: text
    });
    if (!res?.ok) {
      pushNotice(res?.error || "Xabar saqlanmadi.");
      return;
    }
    setCustomerChatInput("");
    await loadCustomerChatMessages(selectedCustomerId);
    await refreshMainData();
    if (res.debt_adjustment) {
      const d = Number(res.debt_adjustment.delta_minor) || 0;
      const b = Number(res.debt_adjustment.balance_minor) || 0;
      const change =
        d < 0
          ? `To'lov qayd etildi: ${formatMoney(-d)} so'm. `
          : `Qarz oshirildi: +${formatMoney(d)} so'm. `;
      if (b > 0) {
        pushNotice(`${change}Qoldiq qarz: ${formatMoney(b)} so'm.`);
      } else if (b < 0) {
        pushNotice(
          `${change}Bizning xaridorga qarzimiz: ${formatMoney(-b)} so'm.`
        );
      } else {
        pushNotice(`${change}Balans nol.`);
      }
    }
  }

  function selectCustomerFromList(customerId) {
    const id = Number(customerId);
    setSelectedCustomerId(id);
    setEditingDraftId(null);
  }

  function updateCartQty(lineKey, qty) {
    const raw = String(qty).replace(",", ".").trim();
    const prev = cartItemsRef.current;
    const item = prev.find((row) => cartRowKey(row) === lineKey);
    if (!item) return;

    if (isAdhocCartItem(item)) {
      const unit = String(item.adhoc_unit || "dona").trim() || "dona";
      if (raw === "") {
        setCartItems((p) =>
          p.map((row) => (cartRowKey(row) === lineKey ? { ...row, qty: "" } : row))
        );
        return;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return;
      if (n === 0) {
        setCartItems((p) =>
          p.map((row) => (cartRowKey(row) === lineKey ? { ...row, qty: 0 } : row))
        );
        return;
      }
      const normalized = normalizeSaleQty(unit, n);
      if (normalized == null) {
        pushNotice(
          isFractionalMeasureUnit(unit)
            ? "Miqdor kamida 0,001 bo'lishi kerak."
            : "Dona uchun butun musbat son kiriting."
        );
        return;
      }
      setCartItems((p) =>
        p.map((row) => (cartRowKey(row) === lineKey ? { ...row, qty: normalized } : row))
      );
      return;
    }

    const product = productMap.get(Number(item.product_id));
    if (!product) return;
    if (raw === "") {
      setCartItems((p) =>
        p.map((row) => (cartRowKey(row) === lineKey ? { ...row, qty: "" } : row))
      );
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    if (n === 0) {
      setCartItems((p) =>
        p.map((row) => (cartRowKey(row) === lineKey ? { ...row, qty: 0 } : row))
      );
      return;
    }
    const normalized = normalizeSaleQty(product.unit, n);
    if (normalized == null) {
      pushNotice(
        isFractionalMeasureUnit(product.unit)
          ? "Miqdor kamida 0,001 bo'lishi kerak."
          : "Dona uchun butun musbat son kiriting."
      );
      return;
    }
    if (exceedsStock(normalized, product.stock_qty)) {
      pushNotice("Qoldiqdan ko'p miqdor kiritildi.");
      return;
    }
    setCartItems((p) =>
      p.map((row) => (cartRowKey(row) === lineKey ? { ...row, qty: normalized } : row))
    );
  }

  async function prepareCartForSaleAction() {
    await flushPendingCartFieldEdits();
    const snapshot = takeCommittedCartSnapshot();
    const { kept, dropped } = sanitizeCartForCheckout(snapshot, productMapRef.current);
    if (dropped > 0) {
      flushSync(() => {
        setCartItems(kept.map((row) => ({ ...row })));
      });
      cartItemsRef.current = kept;
    }
    return { lines: kept, dropped };
  }

  function updateCartUnitPrice(lineKey, raw) {
    const u = roundSomInteger(raw);
    if (u < 0) return;
    setCartItems((prev) =>
      prev.map((item) =>
        cartRowKey(item) === lineKey ? { ...item, unit_price_minor: u } : item
      )
    );
  }

  function updateCartLineTotal(lineKey, raw) {
    const line = roundSomInteger(raw);
    if (line < 0) return;
    setCartItems((prev) =>
      prev.map((item) => {
        if (cartRowKey(item) !== lineKey) return item;
        const q = Number(item.qty) || 0;
        if (q <= 0) return item;
        const u = roundSomInteger(line / q);
        return { ...item, unit_price_minor: u };
      })
    );
  }

  function handleAddAdhocLineToCart() {
    const name = adhocSaleForm.name.trim();
    if (!name) {
      pushNotice("Mahsulot nomini kiriting.");
      return;
    }
    const unit = String(adhocSaleForm.unit || "dona").trim() || "dona";
    const rawQty = adhocSaleForm.qty;
    const qtyNorm = normalizeSaleQty(unit, rawQty);
    if (qtyNorm == null || qtyNorm <= 0) {
      pushNotice(
        isFractionalMeasureUnit(unit)
          ? "Miqdor kamida 0,001 bo'lishi kerak."
          : "Dona uchun musbat miqdor kiriting."
      );
      return;
    }
    let u = roundSomInteger(adhocSaleForm.unit_price_minor);
    const lt = roundSomInteger(adhocSaleForm.line_total_minor);
    if (u <= 0 && lt > 0) {
      u = roundSomInteger(lt / qtyNorm);
    }
    if (u <= 0) {
      pushNotice("Birlik narxi yoki jami qiymatni kiriting.");
      return;
    }
    setCartItems((prev) => [
      ...prev,
      {
        cart_kind: "adhoc",
        lineKey: `a-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        adhoc_label: name,
        adhoc_unit: unit,
        qty: qtyNorm,
        unit_price_minor: u
      }
    ]);
    setAdhocSaleForm({ ...emptyAdhocSaleForm });
  }

  function resetSaleInputs() {
    setCartItems([]);
    setAdhocSaleForm({ ...emptyAdhocSaleForm });
    setSaleCustomerName("");
    setSalePickedCustomerId(null);
    setSaleCustomerPhone("");
    setSaleCustomerAddress("");
    setProductSearchQuery("");
  }

  async function handleCreateSale() {
    if (!api) return;
    const { lines, dropped } = await prepareCartForSaleAction();
    if (!lines.length) {
      pushNotice(
        dropped > 0
          ? "Miqdori belgilangan mahsulot yo'q (0 yoki bo'sh qatorlar olib tashlandi)."
          : "Savat bo'sh."
      );
      return;
    }
    if (dropped > 0) {
      pushNotice(`${dropped} ta qator miqdori yo'q edi — savatdan olib tashlandi.`);
    }
    const resolved = await resolveCustomerForSale();
    if (!resolved) return;
    const saleLines = buildSaleItemsFromCart(lines, productMapRef.current);
    if (!saleLines.length) {
      pushNotice("Sotish uchun kamida bitta mahsulotda miqdor 0 dan katta bo'lsin.");
      return;
    }
    const saleTotal = saleLines.reduce(
      (sum, line) => sum + roundSomInteger(line.unit_price_minor * line.qty),
      0
    );
    let payMinor = roundSomInteger(salePaymentInput);
    if (payMinor < 0) payMinor = 0;
    if (payMinor > saleTotal) payMinor = saleTotal;

    const payload = {
      customer_id: resolved.isAnonymous ? null : resolved.customerId,
      customer_name: resolved.isAnonymous ? null : resolved.customerName,
      note: "",
      sold_at: new Date().toISOString(),
      items: saleLines,
      paid_minor: payMinor
    };
    if (!resolved.isAnonymous) {
      const ph = saleCustomerPhone.trim();
      const adr = saleCustomerAddress.trim();
      if (ph) payload.customer_phone = ph;
      if (adr) payload.customer_address = adr;
    }
    const result = await api.createSale(payload);
    if (!result.ok) {
      pushNotice(result.error || "Savdo saqlanmadi.");
      return;
    }
    resetSaleInputs();
    pushNotice(`Savdo muvaffaqiyatli saqlandi. #${result.sale_id}`);
    await refreshMainData();
    await loadReport();
    if (selectedCustomerId) {
      await loadCustomerSales(selectedCustomerId);
      await loadCustomerDrafts(selectedCustomerId);
      await loadCustomerChatMessages(selectedCustomerId);
    }
  }

  async function handleShakllantirish() {
    if (!api) return;
    const { lines, dropped } = await prepareCartForSaleAction();
    if (!lines.length) {
      pushNotice(
        dropped > 0
          ? "Miqdori belgilangan mahsulot yo'q (0 yoki bo'sh qatorlar olib tashlandi)."
          : "Avval savatni to'ldiring."
      );
      return;
    }
    if (dropped > 0) {
      pushNotice(`${dropped} ta qator miqdori yo'q edi — savatdan olib tashlandi.`);
    }
    const resolved = await resolveCustomerForSale();
    if (!resolved) return;
    const draftItems = buildSaleItemsFromCart(lines, productMapRef.current);
    if (!draftItems.length) {
      pushNotice("Qoralama uchun kamida bitta mahsulotda miqdor 0 dan katta bo'lsin.");
      return;
    }
    const draftRes = await api.createSaleDraft({
      customer_id: resolved.isAnonymous ? null : resolved.customerId,
      items: draftItems
    });
    if (!draftRes.ok) {
      pushNotice(draftRes.error || "Qoralama saqlanmadi.");
      return;
    }

    const customerId = Number(draftRes.customer_id);
    resetSaleInputs();

    setActiveTab("customers");
    setSelectedCustomerId(customerId);
    setEditingDraftId(null);
    await Promise.all([
      loadCustomerSales(customerId),
      loadCustomerDrafts(customerId),
      loadCustomerChatMessages(customerId)
    ]);
    await refreshMainData();
    await Promise.all([
      loadCustomerSales(customerId),
      loadCustomerDrafts(customerId),
      loadCustomerChatMessages(customerId)
    ]);
    pushNotice("Qoralama saqlandi — xaridor chatida ko'rinadi.");
  }

  function openDraftDeleteModal(draftId) {
    setDeleteDraftModal({ id: Number(draftId) });
  }

  function closeDraftDeleteModal() {
    setDeleteDraftModal(null);
  }

  function openCustomerDeleteModal() {
    if (!selectedCustomerId || !canDeleteSelectedCustomer) return;
    const c = customers.find((x) => Number(x.id) === Number(selectedCustomerId));
    setDeleteCustomerModal({
      id: Number(selectedCustomerId),
      name: String(c?.name || "Xaridor")
    });
  }

  function closeCustomerDeleteModal() {
    setDeleteCustomerModal(null);
  }

  function openCustomerEditModal() {
    if (!selectedCustomerId || !selectedCustomer) return;
    setCustomerEditModal({
      id: Number(selectedCustomerId),
      name: String(selectedCustomer.name ?? ""),
      phone: String(selectedCustomer.phone ?? ""),
      address: String(selectedCustomer.address ?? "")
    });
  }

  function closeCustomerEditModal() {
    setCustomerEditModal(null);
  }

  function closeReceiptOptionsModal() {
    setReceiptOptionsModal(null);
  }

  function handleReceiptPrint() {
    const sale = receiptOptionsModal?.sale;
    if (!sale) return;
    const cname = selectedCustomer?.name || sale.customer_name;
    setReceiptOptionsModal(null);
    const res = printSaleReceipt(sale, cname, sellerProfileForm);
    if (!res.ok) {
      pushNotice(res.error || "Chop etish oynasi ochilmadi.");
    }
    restoreRendererFocus();
  }

  async function handleReceiptCopyImage() {
    const sale = receiptOptionsModal?.sale;
    if (!sale) return;
    const cname = selectedCustomer?.name || sale.customer_name;
    setReceiptOptionsModal(null);
    const res = await copySaleReceiptAsImage(sale, cname, sellerProfileForm);
    if (!res.ok) {
      pushNotice(res.error || "Rasm clipboardga yozilmadi.");
    } else {
      pushNotice(
        "Chek jadval ko'rinishida clipboardga nusxalandi. Istagan joyga qo'ying (Ctrl+V)."
      );
    }
    restoreRendererFocus();
  }

  async function saveCustomerEdit() {
    if (!customerEditModal || !api) return;
    const name = customerEditModal.name.trim();
    if (!name) {
      pushNotice("Xaridor nomi bo'sh bo'lmasin.");
      return;
    }
    const res = await api.updateCustomer({
      id: customerEditModal.id,
      name,
      phone: customerEditModal.phone.trim() || null,
      address: customerEditModal.address.trim() || ""
    });
    if (!res?.ok) {
      pushNotice(res?.error || "Ma'lumotlar saqlanmadi.");
      restoreRendererFocus();
      return;
    }
    setCustomerEditModal(null);
    await refreshMainData();
    pushNotice("Xaridor ma'lumotlari yangilandi.");
    restoreRendererFocus();
  }

  async function confirmCustomerDelete() {
    if (!deleteCustomerModal || !api) return;
    const customerId = deleteCustomerModal.id;
    setDeleteCustomerModal(null);
    const result = await api.deleteCustomer(customerId);
    if (!result.ok) {
      pushNotice(result.error || "Xaridor o'chirilmadi.");
      restoreRendererFocus();
      return;
    }
    setSelectedCustomerId(null);
    setCustomerSales([]);
    setCustomerDrafts([]);
    setCustomerChatMessages([]);
    setEditingDraftId(null);
    setDraftPaymentById({});
    pushNotice("Xaridor va uning barcha yozuvlari o'chirildi.");
    await refreshMainData();
    await loadReport();
    restoreRendererFocus();
  }

  async function confirmDraftDelete() {
    if (!deleteDraftModal || !api) return;
    const draftId = deleteDraftModal.id;
    setDeleteDraftModal(null);

    const result = await api.deleteSaleDraft(draftId);
    if (!result.ok) {
      pushNotice(result.error || "Qoralama o'chirilmadi.");
      restoreRendererFocus();
      return;
    }
    setEditingDraftId((prev) => (Number(prev) === draftId ? null : prev));
    pushNotice("Qoralama o'chirildi.");
    if (selectedCustomerId) {
      await loadCustomerDrafts(selectedCustomerId);
    }
    restoreRendererFocus();
  }

  async function handleFinalizeDraft(draft) {
    if (!api) return;
    const id = Number(draft.id);
    const total = draftItemsTotalMinor(draft);
    if (total <= 0) {
      pushNotice("Qoralama summasi 0 bo'lmasin.");
      return;
    }
    let pay = roundSomInteger(draftPaymentById[id] ?? String(total));
    if (pay < 0) pay = 0;
    if (pay > total) pay = total;
    const result = await api.finalizeSaleDraft({ draft_id: id, paid_minor: pay });
    if (!result.ok) {
      pushNotice(result.error || "Savdo saqlanmadi.");
      return;
    }
    setEditingDraftId(null);
    pushNotice(`Savdo muvaffaqiyatli saqlandi. #${result.sale_id}`);
    await refreshMainData();
    await loadReport();
    if (selectedCustomerId) {
      await loadCustomerSales(selectedCustomerId);
      await loadCustomerDrafts(selectedCustomerId);
      await loadCustomerChatMessages(selectedCustomerId);
    }
  }

  function isDraftAdhocLine(line) {
    return line.product_id == null || line.product_id === "";
  }

  async function persistDraftItems(draftId, nextLines) {
    const clean = nextLines
      .map((line) => {
        if (isDraftAdhocLine(line)) {
          const label = String(
            line.adhoc_label || line.product_name || ""
          ).trim();
          if (!label) return null;
          const unit = String(line.adhoc_unit || "dona").trim() || "dona";
          const qty = normalizeSaleQty(unit, line.qty);
          if (qty == null) return null;
          const u = draftLineStoredUnitMinor(line);
          if (u <= 0) return null;
          return {
            adhoc: true,
            adhoc_label: label,
            adhoc_unit: unit,
            qty,
            unit_price_minor: u
          };
        }
        const product = productMap.get(Number(line.product_id));
        if (!product) return null;
        const qty = normalizeSaleQty(product.unit, line.qty);
        if (qty == null) return null;
        return {
          product_id: Number(line.product_id),
          qty,
          unit_price_minor: draftLineStoredUnitMinor(line)
        };
      })
      .filter(Boolean);
    if (!clean.length) {
      pushNotice("Kamida bitta mahsulot qolishi kerak.");
      return;
    }
    for (const line of clean) {
      if (line.adhoc) continue;
      const product = productMap.get(Number(line.product_id));
      if (!product) continue;
      if (exceedsStock(line.qty, product.stock_qty)) {
        pushNotice("Qoldiqdan ko'p miqdor.");
        return;
      }
    }
    const result = await api.updateSaleDraft({
      draft_id: draftId,
      items: clean
    });
    if (!result.ok) {
      pushNotice(result.error || "Qoralama yangilanmadi.");
      return;
    }
    if (selectedCustomerId) {
      await loadCustomerDrafts(selectedCustomerId);
    }
  }

  function updateDraftLineQty(draft, lineId, qty) {
    const lid = Number(lineId);
    const row = draft.items.find((it) => Number(it.id) === lid);
    if (!row) return;

    if (isDraftAdhocLine(row)) {
      const unit = String(row.adhoc_unit || "dona").trim() || "dona";
      const n = Number(String(qty).replace(",", "."));
      if (!Number.isFinite(n)) return;
      if (n <= 0) {
        const next = draft.items.filter((it) => Number(it.id) !== lid);
        persistDraftItems(draft.id, next);
        return;
      }
      const qtyN = normalizeSaleQty(unit, n);
      if (qtyN == null) {
        pushNotice(
          isFractionalMeasureUnit(unit)
            ? "Miqdor kamida 0,001 bo'lishi kerak."
            : "Dona uchun butun musbat son kiriting."
        );
        return;
      }
      const next = draft.items.map((it) =>
        Number(it.id) === lid ? { ...it, qty: qtyN } : it
      );
      persistDraftItems(draft.id, next);
      return;
    }

    const product = productMap.get(Number(row.product_id));
    if (!product) return;
    const n = Number(String(qty).replace(",", "."));
    if (!Number.isFinite(n)) return;
    if (n <= 0) {
      const next = draft.items.filter((it) => Number(it.id) !== lid);
      persistDraftItems(draft.id, next);
      return;
    }
    const qtyN = normalizeSaleQty(product.unit, n);
    if (qtyN == null) {
      pushNotice(
        isFractionalMeasureUnit(product.unit)
          ? "Miqdor kamida 0,001 bo'lishi kerak."
          : "Dona uchun butun musbat son kiriting."
      );
      return;
    }
    if (exceedsStock(qtyN, product.stock_qty)) {
      pushNotice("Qoldiqdan ko'p miqdor.");
      return;
    }
    const next = draft.items.map((it) =>
      Number(it.id) === lid ? { ...it, qty: qtyN } : it
    );
    persistDraftItems(draft.id, next);
  }

  function removeDraftLine(draft, lineId) {
    const lid = Number(lineId);
    const next = draft.items.filter((it) => Number(it.id) !== lid);
    persistDraftItems(draft.id, next);
  }

  function updateDraftLineUnit(draft, lineId, raw) {
    const lid = Number(lineId);
    const u = roundSomInteger(raw);
    if (u < 0) return;
    const next = draft.items.map((it) =>
      Number(it.id) === lid ? { ...it, unit_price_minor: u } : it
    );
    persistDraftItems(draft.id, next);
  }

  function updateDraftLineLineTotal(draft, lineId, raw) {
    const lid = Number(lineId);
    const line = roundSomInteger(raw);
    if (line < 0) return;
    const next = draft.items.map((it) => {
      if (Number(it.id) !== lid) return it;
      const q = Number(it.qty) || 0;
      if (q <= 0) return it;
      const u = roundSomInteger(line / q);
      return { ...it, unit_price_minor: u };
    });
    persistDraftItems(draft.id, next);
  }

  async function handleBackup() {
    const result = await api.backupData();
    if (result.ok) {
      pushNotice(`Backup saqlandi: ${result.file}`);
    }
  }

  async function handleCheckForUpdates() {
    if (typeof api?.checkForUpdates !== "function") {
      pushNotice("Yangilanish tekshiruvi faqat Electron dasturida mavjud.");
      return;
    }
    try {
      const result = await api.checkForUpdates();
      if (result?.skipped && result?.reason === "busy") {
        pushNotice("Yangilanish oynasi allaqachon ochiq yoki jarayon davom etmoqda.");
      }
    } finally {
      setUpdateDownloadProgress(null);
    }
    if (typeof api.focusWindow === "function") {
      await api.focusWindow();
    }
  }

  async function handleInstallPendingUpdate() {
    if (typeof api?.installPendingUpdate !== "function") {
      pushNotice("Bu funksiya faqat yuklab olingan dasturda mavjud.");
      return;
    }
    try {
      const result = await api.installPendingUpdate();
      if (result?.skipped && result?.reason === "busy") {
        pushNotice("Yangilanish oynasi allaqachon ochiq yoki jarayon davom etmoqda.");
      } else if (result?.error === "no_pending") {
        setUpdatePendingInstall(null);
        pushNotice("O'rnatish uchun tayyor yangilanish yo'q.");
      }
    } finally {
      setUpdateDownloadProgress(null);
    }
    if (typeof api.focusWindow === "function") {
      await api.focusWindow();
    }
  }

  function openSaleReturnModal(sale) {
    const lines = (sale.items || []).map((it) => {
      const qty = Number(it.qty) || 0;
      const ret = Number(it.returned_qty) || 0;
      const rem = saleLineSoldRemaining({
        qty,
        returned_qty: ret
      });
      return {
        id: it.id,
        product_id: it.product_id,
        product_name: it.product_name,
        unit: String(it.unit || "dona").trim() || "dona",
        qty,
        returned_qty: ret,
        remainingInput: rem === 0 ? "0" : formatQtyPlain(rem)
      };
    });
    setSaleReturnDraftLines(lines);
    setSaleReturnModal({ sale });
  }

  function closeSaleReturnModal() {
    setSaleReturnModal(null);
    setSaleReturnDraftLines([]);
  }

  async function handleSaveSaleReturn() {
    if (!saleReturnModal || typeof api?.applySaleLineReturns !== "function") {
      pushNotice("Qaytarish saqlash mavjud emas.");
      return;
    }
    const saleId = saleReturnModal.sale.id;
    const lines = [];
    for (const l of saleReturnDraftLines) {
      if (l.product_id == null) continue;
      const maxRem = roundQty3(l.qty - l.returned_qty);
      const rem = parseRemainingQtyForReturn(l.unit, l.remainingInput, maxRem);
      if (rem == null) {
        pushNotice(
          `"${l.product_name}" uchun qolgan miqdor noto'g'ri (0 dan ${formatQtyPlain(maxRem)} gacha).`
        );
        return;
      }
      lines.push({ sale_item_id: l.id, remaining_qty: rem });
    }
    if (!lines.length) {
      pushNotice("Ombordagi mahsulot qatorlari yo'q — qaytarish mumkin emas.");
      return;
    }
    const res = await api.applySaleLineReturns({ sale_id: saleId, lines });
    if (!res.ok) {
      pushNotice(res.error || "Xato");
      return;
    }
    pushNotice("Qaytarish saqlandi.");
    setReceiptOptionsModal((prev) =>
      prev && Number(prev.sale?.id) === Number(saleId) ? null : prev
    );
    closeSaleReturnModal();
    await refreshMainData();
    const cid = Number(selectedCustomerId);
    if (cid) {
      const salesRows = await api.listSalesByCustomer(cid, 500);
      setCustomerSales(salesRows);
    }
  }

  function closeAboutModal() {
    setAboutModalOpen(false);
  }

  async function copyAboutId(label, text) {
    const t = String(text || "").trim();
    if (!t) {
      pushNotice(`${label} mavjud emas.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(t);
      pushNotice(`${label} nusxalandi.`);
    } catch {
      pushNotice("Bu brauzerga nusxalab bo'lmadi.");
    }
  }

  async function handleRestoreDatabase() {
    const confirm = await api.showConfirm({
      title: "Bazani backupdan tiklash",
      message: "Joriy barcha ma'lumotlar tanlangan fayldagi nusxa bilan almashtiriladi.",
      detail:
        "Davom etishdan oldin DB Backup orqali hozirgi bazadan nusxa oling. Noto'g'ri fayl tanlansa tiklash bekor qilinadi.",
      confirmLabel: "Tiklash"
    });
    if (!confirm?.ok) return;

    const result = await api.restoreDatabaseBackup();
    if (result?.canceled) return;
    if (!result?.ok) {
      pushNotice(result?.error || "Bazani tiklash bajarilmadi.");
      return;
    }

    setSelectedCustomerId(null);
    setCustomerSales([]);
    setCustomerDrafts([]);
    setCustomerChatMessages([]);
    setCustomerChatInput("");
    setEditingDraftId(null);
    setDeleteDraftModal(null);
    setCartItems([]);
    setSalePickedCustomerId(null);
    setSaleCustomerName("");
    setSaleCustomerPhone("");
    setSaleCustomerAddress("");
    setProductSearchQuery("");
    setEditingProductId(null);
    setProductForm(emptyProductForm);

    await refreshMainData();
    await loadReport();
    pushNotice(`Baza tiklandi: ${result.file}`);
  }

  async function handleImportProducts() {
    const result = await api.importProductsData();
    if (result?.canceled) return;
    if (!result?.ok) {
      const firstError = result?.error || result?.errors?.[0] || "Import bajarilmadi.";
      pushNotice(firstError);
      return;
    }

    await refreshMainData();
    await loadReport();
    const summary = `Import tugadi: +${result.created} yangi, ${result.updated} yangilandi, ${result.skipped} o'tkazib yuborildi.`;
    pushNotice(summary);
    if (Array.isArray(result.errors) && result.errors.length) {
      window.alert(`Import ogohlantirishlari:\n${result.errors.slice(0, 10).join("\n")}`);
    }
  }

  async function handleExportInventory() {
    const result = await api.exportInventoryData();
    if (result?.canceled) return;
    if (!result?.ok) {
      pushNotice(result?.error || "Export bajarilmadi.");
      return;
    }
    pushNotice(`Export tayyor: ${result.file} (${result.rows} qator).`);
  }

  async function handleReportFilter(event) {
    event.preventDefault();
    await loadReport();
    pushNotice("Hisobot yangilandi.");
  }

  if (licensePhase === "checking") {
    return <div className="center-screen">Litsenziya tekshirilmoqda...</div>;
  }

  if (licensePhase === "blocked") {
    return (
      <LicenseGate
        licenseInfo={licenseInfo}
        api={api}
        onNotice={pushNotice}
        onGranted={(s) => {
          setLicenseInfo(s);
          setLicensePhase("ok");
          setLoading(true);
        }}
      />
    );
  }

  if (loading) {
    return <div className="center-screen">Yuklanmoqda...</div>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>E-Savdo</h1>
        <div className="topbar-actions">
          <div className="db-menu-wrap" ref={dbMenuRef}>
            <button
              type="button"
              className="btn secondary db-menu-trigger"
              aria-expanded={dbMenuOpen}
              aria-haspopup="menu"
              onClick={() => setDbMenuOpen((o) => !o)}
            >
              DB
            </button>
            {dbMenuOpen ? (
              <div className="db-menu" role="menu">
                <button
                  type="button"
                  className="db-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setDbMenuOpen(false);
                    void handleImportProducts();
                  }}
                >
                  Import (CSV/XLS/XLSX)
                </button>
                <button
                  type="button"
                  className="db-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setDbMenuOpen(false);
                    void handleExportInventory();
                  }}
                >
                  Ombordan Export
                </button>
                <button
                  type="button"
                  className="db-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setDbMenuOpen(false);
                    void handleBackup();
                  }}
                >
                  DB Backup
                </button>
                <button
                  type="button"
                  className="db-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setDbMenuOpen(false);
                    void handleRestoreDatabase();
                  }}
                >
                  DB Import (tiklash)
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn secondary about-top-btn"
            aria-label="Dastur haqida"
            title="Dastur haqida"
            onClick={() => setAboutModalOpen(true)}
          >
            <Info size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </header>

      {updateDownloadProgress ? (
        <div className="update-download-banner" role="status" aria-live="polite">
          <span className="update-download-banner-text">
            Yangilanish yuklanmoqda:{" "}
            <strong>{Math.round(Number(updateDownloadProgress.percent) || 0)}%</strong>
          </span>
          <progress
            className="update-download-banner-meter"
            max={100}
            value={Math.round(Number(updateDownloadProgress.percent) || 0)}
            aria-label="Yuklab olish jarayoni"
          />
        </div>
      ) : null}

      <nav className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {notice ? (
        <div className="notice" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}

      <div
        ref={appMainRef}
        className={`app-main${activeTab === "customers" ? " app-main--customers-fit" : ""}`}
      >
      {aboutModalOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAboutModal();
          }}
        >
          <div
            className="modal-dialog modal-dialog--about"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-modal-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="about-modal-title" className="modal-title">
              Dastur haqida
            </h3>
            <p className="modal-body-text about-lead">{APP_ABOUT_LEAD}</p>
            <dl className="about-meta">
              <div className="about-meta-row">
                <dt>Versiya</dt>
                <dd>
                  <code className="about-code">
                    {aboutAppMeta?.version != null && aboutAppMeta.version !== ""
                      ? String(aboutAppMeta.version)
                      : "—"}
                  </code>
                  {aboutAppMeta?.isPackaged === false ? (
                    <span className="about-badge about-badge--dev">dev</span>
                  ) : null}
                </dd>
              </div>
              {aboutAppMeta?.productName ? (
                <div className="about-meta-row">
                  <dt>Mahsulot</dt>
                  <dd>
                    <span>{aboutAppMeta.productName}</span>
                  </dd>
                </div>
              ) : null}
              {aboutAppMeta?.appId ? (
                <div className="about-meta-row about-meta-row--id">
                  <dt>App ID</dt>
                  <dd>
                    <code className="about-code about-code--break">{aboutAppMeta.appId}</code>
                    <button
                      type="button"
                      className="btn tiny secondary about-copy-btn"
                      onClick={() => void copyAboutId("App ID", aboutAppMeta.appId)}
                    >
                      Nusxa
                    </button>
                  </dd>
                </div>
              ) : null}
              <div className="about-meta-row about-meta-row--id">
                <dt>Device ID</dt>
                <dd>
                  <code className="about-code about-code--break">
                    {licenseInfo?.machineId || "—"}
                  </code>
                  {licenseInfo?.machineId ? (
                    <button
                      type="button"
                      className="btn tiny secondary about-copy-btn"
                      onClick={() => void copyAboutId("Device ID", licenseInfo.machineId)}
                    >
                      Nusxa
                    </button>
                  ) : null}
                </dd>
              </div>
              {licenseInfo?.valid === true && !licenseInfo?.skipped ? (
                <>
                  {licenseInfo.plan ? (
                    <div className="about-meta-row">
                      <dt>Tarif</dt>
                      <dd>{String(licenseInfo.plan)}</dd>
                    </div>
                  ) : null}
                  {licenseInfo.label ? (
                    <div className="about-meta-row">
                      <dt>Obuna</dt>
                      <dd>{String(licenseInfo.label)}</dd>
                    </div>
                  ) : null}
                  {licenseInfo.expiresAt ? (
                    <div className="about-meta-row">
                      <dt>Muddati</dt>
                      <dd>
                        {(() => {
                          const d = Date.parse(licenseInfo.expiresAt);
                          return Number.isFinite(d)
                            ? new Date(d).toLocaleString()
                            : String(licenseInfo.expiresAt);
                        })()}
                      </dd>
                    </div>
                  ) : null}
                </>
              ) : null}
              {licenseInfo?.skipped === true ? (
                <div className="about-meta-row">
                  <dt>Litsenziya</dt>
                  <dd>
                    <span className="about-badge about-badge--dev">dev / o&apos;tkazib yuborilgan</span>
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="about-actions">
              {typeof api?.checkForUpdates === "function" ? (
                updateDownloadProgress ? null : updatePendingInstall ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void handleInstallPendingUpdate()}
                  >
                    Yangilash
                    {updatePendingInstall.version ? (
                      <span className="muted"> ({updatePendingInstall.version})</span>
                    ) : null}
                  </button>
                ) : (
                  <button type="button" className="btn" onClick={() => void handleCheckForUpdates()}>
                    Yangilanishni tekshirish
                  </button>
                )
              ) : (
                <p className="muted about-update-hint">
                  Yangilanishni tekshirish faqat yuklab olingan dasturda.
                </p>
              )}
            </div>
            {updateDownloadProgress ? (
              <div className="about-download-progress" role="status" aria-live="polite">
                <p className="about-download-progress-label">
                  Yangilanish yuklanmoqda:{" "}
                  <strong>{Math.round(Number(updateDownloadProgress.percent) || 0)}%</strong>
                </p>
                <progress
                  className="about-download-progress-meter"
                  max={100}
                  value={Math.round(Number(updateDownloadProgress.percent) || 0)}
                  aria-label="Yuklab olish foizi"
                />
              </div>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={closeAboutModal}>
                Yopish
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteCustomerModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeCustomerDeleteModal();
            }
          }}
        >
          <div
            className="modal-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-customer-modal-title"
            aria-describedby="delete-customer-modal-desc"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="delete-customer-modal-title" className="modal-title">
              Xaridorni o&apos;chirish
            </h3>
            <p id="delete-customer-modal-desc" className="modal-body-text">
              <strong>{deleteCustomerModal.name}</strong> va uning barcha savdolari, qoralamalari,
              chat xabarlari va qarz yozuvlari butunlay o&apos;chiriladi. Ombordagi mahsulot
              qoldig&apos;i o&apos;zgarmaydi. Bu amalni qaytarib bo&apos;lmaydi. Davom etasizmi?
            </p>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={closeCustomerDeleteModal}>
                Bekor qilish
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => void confirmCustomerDelete()}
              >
                O&apos;chirish
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saleReturnModal ? (
        <div
          className="modal-backdrop modal-backdrop--sale-return"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeSaleReturnModal();
            }
          }}
        >
          <div
            className="modal-dialog modal-dialog--sale-return"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sale-return-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="sale-return-title" className="modal-title">
              Savdo №{saleReturnModal.sale.id} — qaytarish
            </h3>
            <p className="modal-body-text muted">
              Mijozda qolgan miqdorni kamaytiring yoki &quot;Qaytarish&quot; bilan qatorni to&apos;liq
              yoping. Ombordagi mahsulotlar avtomatik qo&apos;shiladi.
            </p>
            <div className="sale-return-table-wrap">
              <table className="sale-return-table">
                <thead>
                  <tr>
                    <th>Mahsulot</th>
                    <th>Mijozda (qolgan)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {saleReturnDraftLines.map((line) => {
                    const disabled = line.product_id == null;
                    return (
                      <tr key={line.id}>
                        <td>
                          {line.product_name}
                          {disabled ? (
                            <span className="muted sale-return-adhoc-mark"> (ombor yo&apos;q)</span>
                          ) : null}
                        </td>
                        <td>
                          {disabled ? (
                            <span className="muted">—</span>
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              className="sale-return-qty-input"
                              autoComplete="off"
                              value={line.remainingInput}
                              onChange={(e) =>
                                setSaleReturnDraftLines((prev) =>
                                  prev.map((l) =>
                                    l.id === line.id
                                      ? { ...l, remainingInput: e.target.value }
                                      : l
                                  )
                                )
                              }
                            />
                          )}
                        </td>
                        <td className="sale-return-actions-cell">
                          {disabled ? (
                            <span className="muted">—</span>
                          ) : (
                            <button
                              type="button"
                              className="btn tiny secondary"
                              onClick={() =>
                                setSaleReturnDraftLines((prev) =>
                                  prev.map((l) =>
                                    l.id === line.id ? { ...l, remainingInput: "0" } : l
                                  )
                                )
                              }
                            >
                              Qaytarish
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={closeSaleReturnModal}>
                Bekor qilish
              </button>
              <button type="button" className="btn" onClick={() => void handleSaveSaleReturn()}>
                Saqlash
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {receiptOptionsModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeReceiptOptionsModal();
            }
          }}
        >
          <div
            className="modal-dialog modal-dialog--receipt-actions"
            role="dialog"
            aria-modal="true"
            aria-labelledby="receipt-options-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="receipt-options-title" className="modal-title">
              Chekni chop etish
            </h3>
            <p className="modal-body-text">
              Savdo <strong>№{receiptOptionsModal.sale.id}</strong> — qanday chiqarasiz?
            </p>
            <div className="receipt-action-grid">
              <button type="button" className="btn receipt-action-btn" onClick={() => handleReceiptPrint()}>
                Printer
              </button>
              <button
                type="button"
                className="btn secondary receipt-action-btn"
                onClick={() => void handleReceiptCopyImage()}
              >
                Rasm (xotira / clipboard)
              </button>
            </div>
            <p className="modal-body-text receipt-action-hint muted">
              <strong>Printer</strong> — tizim chop etish oynasi.{" "}
              <strong>Rasm</strong> — jadval shaklidagi chek PNG sifatida clipboardga.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={closeReceiptOptionsModal}>
                Bekor qilish
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {customerEditModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeCustomerEditModal();
            }
          }}
        >
          <div
            className="modal-dialog modal-dialog--form"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-edit-modal-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="customer-edit-modal-title" className="modal-title">
              Xaridor ma&apos;lumotlari
            </h3>
            <div className="customer-edit-modal-fields">
              <label className="block-label">
                Ism
                <input
                  type="text"
                  autoComplete="name"
                  value={customerEditModal.name}
                  onChange={(e) =>
                    setCustomerEditModal((prev) =>
                      prev ? { ...prev, name: e.target.value } : prev
                    )
                  }
                />
              </label>
              <label className="block-label">
                Telefon
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder="+998 ..."
                  value={customerEditModal.phone}
                  onChange={(e) =>
                    setCustomerEditModal((prev) =>
                      prev ? { ...prev, phone: e.target.value } : prev
                    )
                  }
                />
              </label>
              <label className="block-label">
                Manzil
                <textarea
                  className="customer-edit-address"
                  rows={2}
                  autoComplete="street-address"
                  placeholder="Manzil"
                  value={customerEditModal.address}
                  onChange={(e) =>
                    setCustomerEditModal((prev) =>
                      prev ? { ...prev, address: e.target.value } : prev
                    )
                  }
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={closeCustomerEditModal}>
                Bekor qilish
              </button>
              <button type="button" className="btn" onClick={() => void saveCustomerEdit()}>
                Saqlash
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteDraftModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeDraftDeleteModal();
            }
          }}
        >
          <div
            className="modal-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-draft-modal-title"
            aria-describedby="delete-draft-modal-desc"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="delete-draft-modal-title" className="modal-title">
              Qoralamani o&apos;chirish
            </h3>
            <p id="delete-draft-modal-desc" className="modal-body-text">
              Bu shakllangan savdo ro&apos;yxati (qoralama) butunlay o&apos;chiriladi va qayta tiklab
              bo&apos;lmaydi. Tasdiqlaysizmi?
            </p>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={closeDraftDeleteModal}>
                Bekor qilish
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => void confirmDraftDelete()}
              >
                O&apos;chirish
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "dashboard" && dashboard && (
        <section className="grid cards">
          <article className="card full seller-profile-card collapsible-card">
            <button
              type="button"
              className="collapsible-trigger"
              aria-expanded={dashShopPanelOpen}
              onClick={() => setDashShopPanelOpen((v) => !v)}
            >
              <span>Do&apos;kon va sotuvchi</span>
              <span className="collapsible-chevron" aria-hidden="true">
                {dashShopPanelOpen ? "▲" : "▼"}
              </span>
            </button>
            {dashShopPanelOpen ? (
              <div className="collapsible-body">
                <p className="muted seller-profile-lead">
                  Chekda faqat bu yerdagi kiritilgan ma&apos;lumotlar chiqadi; maydonlarni bo&apos;sh
                  qoldirsangiz, chek tepasida alohida sarlavha bo&apos;lmaydi.
                </p>
                <form className="form seller-profile-form" onSubmit={(e) => void saveSellerProfile(e)}>
                  <label className="block-label">
                    Do&apos;kon nomi
                    <input
                      type="text"
                      autoComplete="organization"
                      placeholder="Masalan: Bizning do'kon"
                      value={sellerProfileForm.shop_name}
                      onChange={(e) =>
                        setSellerProfileForm((prev) => ({ ...prev, shop_name: e.target.value }))
                      }
                    />
                  </label>
                  <label className="block-label">
                    Sotuvchi ismi
                    <input
                      type="text"
                      autoComplete="name"
                      placeholder="Ism familiya"
                      value={sellerProfileForm.seller_name}
                      onChange={(e) =>
                        setSellerProfileForm((prev) => ({ ...prev, seller_name: e.target.value }))
                      }
                    />
                  </label>
                  <label className="block-label">
                    Telefon raqam
                    <input
                      type="tel"
                      autoComplete="tel"
                      placeholder="+998 ..."
                      value={sellerProfileForm.phone}
                      onChange={(e) =>
                        setSellerProfileForm((prev) => ({ ...prev, phone: e.target.value }))
                      }
                    />
                  </label>
                  <label className="block-label">
                    Email (ixtiyoriy)
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="masalan@pochta.uz"
                      value={sellerProfileForm.email}
                      onChange={(e) =>
                        setSellerProfileForm((prev) => ({ ...prev, email: e.target.value }))
                      }
                    />
                  </label>
                  <label className="block-label seller-profile-notes">
                    Qo&apos;shimcha izoh
                    <textarea
                      rows={3}
                      placeholder="Chek ustida ko‘rinadigan qisqa eslatma yoki rekvizitlar"
                      value={sellerProfileForm.notes}
                      onChange={(e) =>
                        setSellerProfileForm((prev) => ({ ...prev, notes: e.target.value }))
                      }
                    />
                  </label>
                  <div className="seller-profile-submit">
                    <button className="btn" type="submit">
                      Saqlash
                    </button>
                  </div>
                </form>
              </div>
            ) : null}
          </article>
          <article className="card metric">
            <h3>Aktiv mahsulotlar</h3>
            <strong>{dashboard.active_products}</strong>
          </article>
          <article className="card metric">
            <h3>Xaridorlar</h3>
            <strong>{dashboard.customers}</strong>
          </article>
          <article className="card metric">
            <h3>Bugungi savdo soni</h3>
            <strong>{dashboard.today_sales_count}</strong>
          </article>
          <article className="card metric">
            <h3>Bugungi tushum</h3>
            <strong>{formatMoney(dashboard.today_revenue_minor)} so'm</strong>
          </article>
          <article className="card metric">
            <h3>Ombor qiymati</h3>
            <strong>{formatMoney(dashboard.stock_value_minor)} so'm</strong>
          </article>
          <article className="card">
            <h3>Kam qolgan mahsulotlar</h3>
            {lowStockProducts.length ? (
              <ul className="small-list">
                {lowStockProducts.map((item) => (
                  <li key={item.id}>
                    {item.name} — <strong>{formatQtyPlain(item.stock_qty)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Kam qolgan mahsulot yo'q.</p>
            )}
          </article>
        </section>
      )}

      {activeTab === "products" && (
        <section className="grid cards">
          <article className="card full collapsible-card">
            <button
              type="button"
              className="collapsible-trigger"
              aria-expanded={productsFormOpen}
              onClick={() => setProductsFormOpen((v) => !v)}
            >
              <span>
                {editingProductId ? "Mahsulotni tahrirlash" : "Yangi mahsulot qo'shish"}
              </span>
              <span className="collapsible-chevron" aria-hidden="true">
                {productsFormOpen ? "▲" : "▼"}
              </span>
            </button>
            {productsFormOpen ? (
              <div className="collapsible-body">
                <form className="form" onSubmit={handleProductSubmit}>
                  <label>
                    Nomi
                    <input
                      value={productForm.name}
                      onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                    />
                  </label>
                  <label>
                    O&apos;lchov birligi
                    <select
                      className="product-unit-select"
                      value={productUnitSelectValue(productForm.unit)}
                      onChange={(e) =>
                        setProductForm({ ...productForm, unit: e.target.value })
                      }
                    >
                      {productUnitSelectOptions(productForm.unit).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {editingProductId ? (
                    <label>
                      Ombordagi qoldiq
                      <input
                        type="number"
                        min="0"
                        step={isFractionalMeasureUnit(productForm.unit) ? "0.001" : "1"}
                        value={productForm.edit_stock_qty}
                        onChange={(e) =>
                          setProductForm({ ...productForm, edit_stock_qty: e.target.value })
                        }
                      />
                    </label>
                  ) : null}
                  <label>
                    Sotuv narxi (so'm)
                    <input
                      type="number"
                      min="0"
                      value={productForm.sale_price_minor}
                      onChange={(e) =>
                        setProductForm({ ...productForm, sale_price_minor: e.target.value })
                      }
                    />
                  </label>
                  {!editingProductId && (
                    <label>
                      Boshlang'ich qoldiq
                      <input
                        type="number"
                        min="0"
                        step={isFractionalMeasureUnit(productForm.unit) ? "0.001" : "1"}
                        value={productForm.initial_qty}
                        onChange={(e) =>
                          setProductForm({ ...productForm, initial_qty: e.target.value })
                        }
                      />
                    </label>
                  )}
                  <div className="row">
                    <button className="btn" type="submit">
                      {editingProductId ? "Saqlash" : "Qo'shish"}
                    </button>
                    {editingProductId && (
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => {
                          setEditingProductId(null);
                          setProductForm(emptyProductForm);
                        }}
                      >
                        Bekor qilish
                      </button>
                    )}
                  </div>
                </form>
              </div>
            ) : null}
          </article>

          <article className="card full">
            <h3>Mahsulotlar ro&apos;yxati</h3>
            <div className="list-toolbar" role="search">
              <input
                type="search"
                className="list-toolbar-search"
                placeholder="Nom yoki o‘lchov birligi bo‘yicha qidiring…"
                autoComplete="off"
                value={productsListQuery}
                onChange={(e) => setProductsListQuery(e.target.value)}
                aria-label="Mahsulotlar bo‘yicha qidiruv"
              />
              <select
                className="list-toolbar-select"
                value={productsListFilter}
                onChange={(e) => setProductsListFilter(e.target.value)}
                aria-label="Mahsulotlar filtri"
              >
                <option value="all">Barchasi</option>
                <option value="active">Faqat aktiv</option>
                <option value="inactive">Nofaol</option>
                <option value="low_stock">Kam qoldiq (≤5, aktiv)</option>
                <option value="no_stock">Qoldiq 0 yoki manfiy</option>
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nomi</th>
                    <th>Narx</th>
                    <th>Qoldiq</th>
                    <th>Birlik</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredProductsForTable.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{formatMoney(item.sale_price_minor)} so'm</td>
                      <td>{formatQtyPlain(item.stock_qty)}</td>
                      <td>{item.unit}</td>
                      <td>
                        <button className="btn tiny" onClick={() => fillProductForEdit(item)}>
                          Tahrirlash
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!products.length ? (
              <p className="muted list-toolbar-hint">Hozircha mahsulotlar yo&apos;q.</p>
            ) : !filteredProductsForTable.length ? (
              <p className="muted list-toolbar-hint">
                Qidiruv yoki filtr bo&apos;yicha mahsulot topilmadi.
              </p>
            ) : null}
          </article>
        </section>
      )}

      {activeTab === "customers" && (
        <section className="grid two-col customers-layout">
          <article className="card">
            <h3>Xaridorlar ro'yxati</h3>
            <div className="list-toolbar" role="search">
              <input
                type="search"
                className="list-toolbar-search"
                placeholder="Ism, telefon yoki manzil bo‘yicha qidiring…"
                autoComplete="off"
                value={customersListQuery}
                onChange={(e) => setCustomersListQuery(e.target.value)}
                aria-label="Xaridorlar bo‘yicha qidiruv"
              />
              {customersListQuery.trim() ? (
                <button
                  type="button"
                  className="btn secondary tiny list-toolbar-clear"
                  onClick={() => setCustomersListQuery("")}
                >
                  Tozalash
                </button>
              ) : null}
            </div>
            <ul className="customer-pick-list">
              {filteredCustomersForList.map((customer) => {
                const hasDraft = Number(customer.has_open_draft) === 1;
                const balance = Number(customer.outstanding_debt_minor) || 0;
                const debt = balance > 0 ? balance : 0;
                const credit = balance < 0 ? -balance : 0;
                const pickTone = hasDraft
                  ? "customer-pick--has-draft"
                  : debt > 0
                    ? "customer-pick--has-debt"
                    : credit > 0
                      ? "customer-pick--has-credit"
                      : "customer-pick--clear";
                return (
                <li key={customer.id}>
                  <button
                    type="button"
                    className={`customer-pick ${pickTone} ${selectedCustomerId === Number(customer.id) ? "active" : ""}`}
                    onClick={() => selectCustomerFromList(customer.id)}
                  >
                    <strong>{customer.name}</strong>
                    {debt > 0 ? (
                      <span className="customer-meta customer-meta--debt">
                        Qarz: {formatMoney(debt)} so&apos;m
                      </span>
                    ) : null}
                    {credit > 0 ? (
                      <span className="customer-meta customer-meta--credit">
                        Bizda qarz: {formatMoney(credit)} so&apos;m
                      </span>
                    ) : null}
                  </button>
                </li>
                );
              })}
            </ul>
            {!customers.length ? (
              <p className="muted list-toolbar-hint">Hozircha xaridorlar yo&apos;q. Savdo orqali avtomatik qo&apos;shiladi.</p>
            ) : !filteredCustomersForList.length ? (
              <p className="muted list-toolbar-hint">Qidiruv bo&apos;yicha xaridor topilmadi.</p>
            ) : null}
          </article>

          <article className="card customer-chat-card">
            <div className="customer-chat-card-head">
              <h3>Savdo tarixi</h3>
              {selectedCustomerId ? (
                <div className="customer-chat-card-actions">
                  <button
                    type="button"
                    className="customer-edit-trigger"
                    title="Xaridor ma'lumotlarini tahrirlash"
                    aria-label="Xaridor ma'lumotlarini tahrirlash"
                    onClick={() => openCustomerEditModal()}
                  >
                    <Pencil size={18} strokeWidth={2} aria-hidden />
                  </button>
                  {canDeleteSelectedCustomer ? (
                    <button
                      type="button"
                      className="customer-delete-trigger"
                      title="Xaridorni o'chirish"
                      aria-label="Xaridorni o'chirish"
                      onClick={() => openCustomerDeleteModal()}
                    >
                      <Trash2 size={18} strokeWidth={2} aria-hidden />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {!selectedCustomerId && <p className="muted">Xaridor tanlang.</p>}
            {selectedCustomerId && selectedCustomer ? (
              <div className="customer-detail-strip" aria-label="Xaridor kontakti">
                <span className="customer-detail-strip__item">
                  <strong>Tel.</strong>
                  <span className={selectedCustomer.phone ? "" : "muted"}>
                    {selectedCustomer.phone?.trim()
                      ? selectedCustomer.phone.trim()
                      : "—"}
                  </span>
                </span>
                <span className="customer-detail-strip__item customer-detail-strip__item--wide">
                  <strong>Manzil</strong>
                  <span className={selectedCustomer.address?.trim() ? "" : "muted"}>
                    {selectedCustomer.address?.trim()
                      ? selectedCustomer.address.trim()
                      : "—"}
                  </span>
                </span>
              </div>
            ) : null}
            {selectedCustomerId && (
              <div className="customer-chat-stack">
              <div
                ref={customerChatScrollRef}
                className="chat-scroll telegram-chat"
                aria-label="Savdo, qoralama va xabarlar tarixi"
              >
                {selectedCustomerBalance > 0 ? (
                  <div className="chat-debt-banner" role="status">
                    Umumiy qarz:{" "}
                    <strong>{formatMoney(selectedCustomerBalance)} so&apos;m</strong>
                  </div>
                ) : null}
                {selectedCustomerBalance < 0 ? (
                  <div className="chat-debt-banner chat-debt-banner--credit" role="status">
                    Bizning xaridorga qarzimiz:{" "}
                    <strong>{formatMoney(-selectedCustomerBalance)} so&apos;m</strong>
                    <span className="chat-debt-banner-hint"> (ortiqcha to&apos;lov / avans)</span>
                  </div>
                ) : null}
                {customerChatTimeline.length === 0 ? (
                  <p className="muted chat-empty-hint">
                    Hozircha yozuv yo&apos;q. Pastdan matn yuborishingiz mumkin.
                  </p>
                ) : (
                  <>
                {customerChatTimeline.map((entry) => {
                  if (entry.type === "sale") {
                    const sale = entry.sale;
                  const totalM = Number(sale.total_minor) || 0;
                  const paidM =
                    sale.paid_minor != null && sale.paid_minor !== ""
                      ? Number(sale.paid_minor)
                      : totalM;
                  const saleDebt = Math.max(0, totalM - paidM);
                  return (
                  <div key={entry.key} className="chat-bubble chat-bubble--out">
                    <div className="chat-bubble-meta">
                      <span className="chat-bubble-id">#{sale.id}</span>
                      <time className="chat-bubble-time">
                        {new Date(sale.sold_at).toLocaleString()}
                      </time>
                    </div>
                    <div className="chat-bubble-body">
                      <ul className="chat-line-list">
                        {sale.items.map((item) => {
                          const soldRem = saleLineSoldRemaining(item);
                          return (
                            <li key={item.id}>
                              {item.product_name} — {formatQtyPlain(soldRem)} ×{" "}
                              {formatMoney(item.unit_price_minor)} ={" "}
                              {formatMoney(item.line_total_minor)}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <div className="chat-bubble-footer">
                      Jami: <strong>{formatMoney(sale.total_minor)} so'm</strong>
                      {saleDebt > 0 ? (
                        <div className="chat-bubble-payment">
                          To&apos;langan:{" "}
                          <strong className="chat-bubble-paid">{formatMoney(paidM)} so&apos;m</strong>
                          {" · "}
                          <span className="chat-bubble-owe">
                            Qarz: <strong>{formatMoney(saleDebt)} so&apos;m</strong>
                          </span>
                        </div>
                      ) : null}
                    </div>
                    {sale.items.some((it) => (Number(it.returned_qty) || 0) > 0) ? (
                      <div className="chat-bubble-returns">
                        <p className="chat-bubble-returns-title">Qaytarilgan</p>
                        <ul className="chat-line-list">
                          {sale.items
                            .filter((it) => (Number(it.returned_qty) || 0) > 0)
                            .map((it) => (
                              <li key={`ret-${it.id}`}>
                                {it.product_name} —{" "}
                                {formatStockQtyWithUnit(it.returned_qty, it.unit)}
                              </li>
                            ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className="chat-bubble-actions">
                      <button
                        type="button"
                        className="btn tiny secondary chat-bubble-print-btn"
                        onClick={() => setReceiptOptionsModal({ sale })}
                      >
                        Chop etish
                      </button>
                      <button
                        type="button"
                        className="btn tiny chat-bubble-edit-btn"
                        title="Qaytarish va miqdorni tahrirlash"
                        onClick={() => openSaleReturnModal(sale)}
                      >
                        <Pencil size={14} strokeWidth={2} aria-hidden />
                        Tahrirlash
                      </button>
                    </div>
                  </div>
                  );
                  }
                  if (entry.type === "draft") {
                  const draft = entry.draft;
                  const isEditing = editingDraftId === Number(draft.id);
                  const dTotal = draftItemsTotalMinor(draft);
                  const payApplied =
                    dTotal > 0
                      ? Math.min(
                          Math.max(0, roundSomInteger(draftPaymentById[Number(draft.id)] ?? String(dTotal))),
                          dTotal
                        )
                      : 0;
                  const draftDebtPreview = dTotal > 0 ? Math.max(0, dTotal - payApplied) : 0;
                  return (
                    <div key={entry.key} className="chat-bubble chat-bubble--out chat-bubble--draft">
                      <div className="chat-bubble-meta">
                        <span className="chat-bubble-label">Qoralama (shakllangan)</span>
                        <span className="chat-bubble-id">Q#{draft.id}</span>
                        <time className="chat-bubble-time">
                          {new Date(draft.created_at).toLocaleString()}
                        </time>
                      </div>
                      <div className="chat-bubble-body">
                        <ul className="chat-line-list">
                          {draft.items.map((line) => {
                            const product =
                              line.product_id == null
                                ? null
                                : productMap.get(Number(line.product_id));
                            const label = product?.name || line.product_name;
                            const measureUnit =
                              (product?.unit && String(product.unit).trim()) ||
                              String(line.adhoc_unit || "dona").trim() ||
                              "dona";
                            const uEff = draftLineStoredUnitMinor(line);
                            const lineEff = roundSomInteger(uEff * Number(line.qty || 0));
                            const draftQtyStep = isFractionalMeasureUnit(measureUnit)
                              ? "0.001"
                              : "1";
                            const draftQtyMin = isFractionalMeasureUnit(measureUnit)
                              ? "0.001"
                              : "1";
                            return (
                              <li key={line.id}>
                                {isEditing ? (
                                  <span className="draft-line-edit draft-line-edit--stacked">
                                    <span className="draft-line-name">{label}</span>
                                    <span className="draft-line-controls">
                                      <input
                                        type="number"
                                        min={draftQtyMin}
                                        step={draftQtyStep}
                                        className="draft-qty-input"
                                        title="Miqdor"
                                        defaultValue={line.qty}
                                        key={`q-${draft.id}-${line.id}-${line.qty}`}
                                        onBlur={(e) => {
                                          const v = e.target.value;
                                          if (Number(v) === Number(line.qty)) return;
                                          updateDraftLineQty(draft, line.id, v);
                                        }}
                                      />
                                      <input
                                        type="number"
                                        step="100"
                                        min="0"
                                        className="draft-price-input"
                                        title="1 dona narxi"
                                        defaultValue={uEff}
                                        key={`u-${draft.id}-${line.id}-${uEff}`}
                                        onBlur={(e) => {
                                          const v = roundSomInteger(e.target.value);
                                          if (v === uEff) return;
                                          updateDraftLineUnit(draft, line.id, v);
                                        }}
                                      />
                                      <input
                                        type="number"
                                        step="100"
                                        min="0"
                                        className="draft-price-input"
                                        title="Jami"
                                        defaultValue={lineEff}
                                        key={`t-${draft.id}-${line.id}-${lineEff}`}
                                        onBlur={(e) => {
                                          const v = roundSomInteger(e.target.value);
                                          if (v === lineEff) return;
                                          updateDraftLineLineTotal(draft, line.id, v);
                                        }}
                                      />
                                      <button
                                        type="button"
                                        className="btn tiny danger"
                                        onClick={() => removeDraftLine(draft, line.id)}
                                      >
                                        O'chirish
                                      </button>
                                    </span>
                                  </span>
                                ) : (
                                  <>
                                    {label} — {formatQtyPlain(line.qty)} × {formatMoney(uEff)} ={" "}
                                    {formatMoney(lineEff)} so'm
                                  </>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                      <div className="chat-bubble-footer">
                        Jami: <strong>{formatMoney(draftItemsTotalMinor(draft))} so'm</strong>
                      </div>
                      <div className="draft-payment-block checkout-payment-block">
                        <label className="checkout-payment-label">
                          To&apos;lov miqdori (so&apos;m)
                          <input
                            type="number"
                            min="0"
                            step="100"
                            className="checkout-payment-input"
                            value={draftPaymentById[Number(draft.id)] ?? String(dTotal)}
                            onChange={(e) =>
                              setDraftPaymentById((p) => ({
                                ...p,
                                [Number(draft.id)]: e.target.value
                              }))
                            }
                          />
                        </label>
                        {draftDebtPreview > 0 ? (
                          <p className="checkout-debt-line">
                            Qarz (shu qoralama):{" "}
                            <strong>{formatMoney(draftDebtPreview)} so&apos;m</strong>
                          </p>
                        ) : null}
                      </div>
                      <div className="draft-actions">
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() =>
                            setEditingDraftId(isEditing ? null : Number(draft.id))
                          }
                        >
                          {isEditing ? "Tahrirni yopish" : "Tahrirlash"}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void handleFinalizeDraft(draft)}
                        >
                          Savdoni yakunlash
                        </button>
                        <button
                          type="button"
                          className="btn tiny danger"
                          onClick={() => openDraftDeleteModal(draft.id)}
                        >
                          O'chirish
                        </button>
                      </div>
                    </div>
                  );
                  }
                  const msg = entry.message;
                  return (
                    <div key={entry.key} className="chat-bubble chat-bubble--note chat-bubble--out">
                      <div className="chat-bubble-meta">
                        <span className="chat-bubble-label chat-bubble-label--note">Xabar</span>
                        <time className="chat-bubble-time" dateTime={msg.created_at}>
                          {new Date(msg.created_at).toLocaleString()}
                        </time>
                      </div>
                      <div className="chat-bubble-body chat-bubble-body--pre">{msg.body}</div>
                    </div>
                  );
                })}
                <div ref={customerChatEndRef} />
                  </>
                )}
              </div>
              <div className="customer-chat-composer">
                <textarea
                  className="customer-chat-composer-input"
                  rows={2}
                  placeholder="Masalan: bugun +90000 sum oldim yoki -50000 yangi qarz. + = to'lov (qarz kamayadi), - = qarz oshadi. Izoh ixtiyoriy."
                  value={customerChatInput}
                  onChange={(e) => setCustomerChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendCustomerChat();
                    }
                  }}
                  aria-label="Xabar matni"
                />
                <button
                  type="button"
                  className="btn customer-chat-send-btn"
                  onClick={() => void handleSendCustomerChat()}
                >
                  Yuborish
                </button>
              </div>
            </div>
            )}
          </article>
        </section>
      )}

      {activeTab === "sales" && (
        <section className="sales-layout">
          <div className="sales-left-column">
          <article className="card sales-customer-block">
            <label className="block-label">
              Xaridor nomi
              <input
                type="text"
                autoComplete="off"
                placeholder="Ism yozing yoki ro'yxatdan tanlang"
                value={saleCustomerName}
                onChange={(e) => onSaleCustomerNameChange(e.target.value)}
              />
            </label>
            {customerNameSuggestions.length > 0 && (
              <ul className="suggestion-list" role="listbox">
                {customerNameSuggestions.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="suggestion-btn"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickCustomerSuggestion(c)}
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showNewCustomerConfirmRow ? (
              <div className="new-customer-confirm-row">
                <span className="new-customer-confirm-label">
                  Yangi: <strong>{saleCustomerName.trim()}</strong>
                </span>
                <button
                  type="button"
                  className="btn tiny"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => confirmNewCustomerRow()}
                >
                  Tasdiqlash
                </button>
              </div>
            ) : null}
            <label className="block-label">
              Telefon (ixtiyoriy)
              <input
                type="tel"
                autoComplete="off"
                placeholder="+998 ..."
                value={saleCustomerPhone}
                onChange={(e) => setSaleCustomerPhone(e.target.value)}
              />
            </label>
            <label className="block-label">
              Manzil (ixtiyoriy)
              <input
                type="text"
                autoComplete="off"
                placeholder="Manzil"
                value={saleCustomerAddress}
                onChange={(e) => setSaleCustomerAddress(e.target.value)}
              />
            </label>
          </article>

          <article className="card sales-search-card product-search-block">
            <h4>Mahsulot qidiruv</h4>
            <input
              type="search"
              className="product-search-input"
              placeholder="Mahsulot nomi bo'yicha qidiring..."
              value={productSearchQuery}
              onChange={(e) => setProductSearchQuery(e.target.value)}
            />
            {productSearchQuery.trim() && (
              <div className="table-wrap search-hits">
                <table>
                  <thead>
                    <tr>
                      <th>Nomi</th>
                      <th>Narx</th>
                      <th>Qoldiq</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {productSearchHits.map((p) => (
                      <tr
                        key={p.id}
                        className="search-hit-row"
                        onDoubleClick={() =>
                          addProductToCartLine(setCartItems, productMap, p.id, 1, pushNotice)
                        }
                      >
                        <td>{p.name}</td>
                        <td>{formatMoney(p.sale_price_minor)}</td>
                        <td>{formatStockQtyWithUnit(p.stock_qty, p.unit)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn tiny"
                            onClick={() =>
                              addProductToCartLine(setCartItems, productMap, p.id, 1, pushNotice)
                            }
                          >
                            Savatga
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!productSearchHits.length && (
                      <tr>
                        <td colSpan={4} className="muted">
                          Mos mahsulot topilmadi.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </article>
          </div>

          <article className="card sales-cart-column">
            <h3>Savat</h3>
            <div className="table-wrap">
              <table className="sales-cart-table">
                <colgroup>
                  <col className="sales-cart-col-name" />
                  <col className="sales-cart-col-compact" />
                  <col className="sales-cart-col-compact" />
                  <col className="sales-cart-col-compact" />
                  <col className="sales-cart-col-compact" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Mahsulot</th>
                    <th>Miqdor</th>
                    <th>Narx</th>
                    <th>Jami</th>
                    <th className="sales-cart-th-actions" />
                  </tr>
                </thead>
                <tbody>
                  {cartItems.map((item) => {
                    const rowKey = cartRowKey(item);
                    if (isAdhocCartItem(item)) {
                      const unit = String(item.adhoc_unit || "dona").trim() || "dona";
                      const uEff = effectiveCartUnitPriceMinor(item, null);
                      const qEff = normalizeSaleQty(unit, item.qty);
                      const lineEff =
                        qEff == null ? 0 : roundSomInteger(uEff * qEff);
                      const cartQtyStep = isFractionalMeasureUnit(unit) ? "0.001" : "1";
                      return (
                        <tr key={rowKey}>
                          <td>
                            <span className="adhoc-cart-badge" title="Omborda yo'q">
                              {item.adhoc_label}
                            </span>
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step={cartQtyStep}
                              value={item.qty === "" ? "" : item.qty}
                              onChange={(e) => updateCartQty(rowKey, e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="100"
                              min="0"
                              className="cart-price-input"
                              value={uEff}
                              onChange={(e) => updateCartUnitPrice(rowKey, e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="100"
                              min="0"
                              className="cart-price-input"
                              value={lineEff}
                              onChange={(e) => updateCartLineTotal(rowKey, e.target.value)}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn tiny danger"
                              onClick={() =>
                                setCartItems((prev) =>
                                  prev.filter((line) => cartRowKey(line) !== rowKey)
                                )
                              }
                            >
                              O'chirish
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    const product = productMap.get(Number(item.product_id));
                    if (!product) return null;
                    const uEff = effectiveCartUnitPriceMinor(item, product);
                    const qEff = normalizeSaleQty(product.unit, item.qty);
                    const lineEff =
                      qEff == null ? 0 : roundSomInteger(uEff * qEff);
                    const cartQtyStep = isFractionalMeasureUnit(product.unit) ? "0.001" : "1";
                    return (
                      <tr key={rowKey}>
                        <td>{product.name}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step={cartQtyStep}
                            value={item.qty === "" ? "" : item.qty}
                            onChange={(e) => updateCartQty(rowKey, e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="100"
                            min="0"
                            className="cart-price-input"
                            value={uEff}
                            onChange={(e) => updateCartUnitPrice(rowKey, e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="100"
                            min="0"
                            className="cart-price-input"
                            value={lineEff}
                            onChange={(e) => updateCartLineTotal(rowKey, e.target.value)}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn tiny danger"
                            onClick={() =>
                              setCartItems((prev) =>
                                prev.filter((line) => cartRowKey(line) !== rowKey)
                              )
                            }
                          >
                            O'chirish
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!cartItems.length && (
                    <tr>
                      <td colSpan={5}>Savat bo'sh</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="adhoc-cart-form">
              <h4>Omborda yo&apos;q mahsulot (bir martalik)</h4>
              <div className="adhoc-cart-fields">
                <label className="block-label">
                  Nomi
                  <input
                    type="text"
                    autoComplete="off"
                    value={adhocSaleForm.name}
                    onChange={(e) =>
                      setAdhocSaleForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                </label>
                <label className="block-label">
                  Miqdor
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={adhocSaleForm.qty}
                    onChange={(e) =>
                      setAdhocSaleForm((f) =>
                        syncAdhocLineTotalFromQtyAndPrice({
                          ...f,
                          qty: e.target.value
                        })
                      )
                    }
                  />
                </label>
                <label className="block-label">
                  Birlik
                  <select
                    className="adhoc-unit-select"
                    value={adhocUnitForSelect(adhocSaleForm.unit)}
                    onChange={(e) =>
                      setAdhocSaleForm((f) =>
                        syncAdhocLineTotalFromQtyAndPrice({
                          ...f,
                          unit: e.target.value
                        })
                      )
                    }
                  >
                    {STANDARD_UNIT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block-label">
                  Narx
                  <input
                    type="number"
                    min="0"
                    step="100"
                    className="cart-price-input"
                    value={adhocSaleForm.unit_price_minor}
                    onChange={(e) =>
                      setAdhocSaleForm((f) =>
                        syncAdhocLineTotalFromQtyAndPrice({
                          ...f,
                          unit_price_minor: e.target.value
                        })
                      )
                    }
                  />
                </label>
                <label className="block-label">
                  Jami
                  <input
                    type="number"
                    min="0"
                    step="100"
                    className="cart-price-input"
                    value={adhocSaleForm.line_total_minor}
                    onChange={(e) =>
                      setAdhocSaleForm((f) =>
                        syncAdhocUnitPriceFromLineTotal({
                          ...f,
                          line_total_minor: e.target.value
                        })
                      )
                    }
                  />
                </label>
              </div>
              <div className="adhoc-cart-add-row">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={handleAddAdhocLineToCart}
                >
                  Ro&apos;yxatga qo&apos;shish
                </button>
              </div>
            </div>

            <div className="checkout-payment-block">
              <label className="checkout-payment-label">
                To&apos;lov miqdori (so&apos;m)
                <input
                  type="number"
                  min="0"
                  step="100"
                  className="checkout-payment-input"
                  value={salePaymentInput}
                  onChange={(e) => setSalePaymentInput(e.target.value)}
                  disabled={!cartItems.length || cartTotal <= 0}
                />
              </label>
              {cartDebtPreview > 0 ? (
                <p className="checkout-debt-line">
                  Qarz (shu savat):{" "}
                  <strong>{formatMoney(cartDebtPreview)} so&apos;m</strong>
                </p>
              ) : null}
            </div>
            <div className="checkout checkout-toolbar">
              <button type="button" className="btn secondary" onClick={handleShakllantirish}>
                Shakllantirish
              </button>
              <strong className="checkout-total">Jami: {formatMoney(cartTotal)} so'm</strong>
              <button type="button" className="btn" onClick={handleCreateSale}>
                Savdoni yakunlash
              </button>
            </div>
          </article>
        </section>
      )}

      {activeTab === "history" && (
        <section className="card">
          <h3>Oxirgi savdolar</h3>
          <div className="list-toolbar list-toolbar--history" role="search">
            <input
              type="search"
              className="list-toolbar-search"
              placeholder="Xaridor, mahsulot, № savdo, izoh yoki summa (raqam)…"
              autoComplete="off"
              value={historySearchQuery}
              onChange={(e) => setHistorySearchQuery(e.target.value)}
              aria-label="Savdolar bo‘yicha qidiruv"
            />
            <label className="list-toolbar-date">
              <span className="list-toolbar-date-label">Dan</span>
              <input
                type="date"
                value={historyDateFrom}
                onChange={(e) => setHistoryDateFrom(e.target.value)}
                aria-label="Sana dan"
              />
            </label>
            <label className="list-toolbar-date">
              <span className="list-toolbar-date-label">Gacha</span>
              <input
                type="date"
                value={historyDateTo}
                onChange={(e) => setHistoryDateTo(e.target.value)}
                aria-label="Sana gacha"
              />
            </label>
            <button
              type="button"
              className="btn secondary tiny list-toolbar-clear"
              onClick={() => {
                setHistorySearchQuery("");
                setHistoryDateFrom("");
                setHistoryDateTo("");
              }}
            >
              Filtrni tozalash
            </button>
          </div>
          <div className="history-list">
            {filteredSalesHistory.map((sale) => {
              const tot = Number(sale.total_minor) || 0;
              const paid =
                sale.paid_minor != null && sale.paid_minor !== ""
                  ? Number(sale.paid_minor)
                  : tot;
              const owe = Math.max(0, tot - paid);
              return (
              <details key={sale.id} className="history-item">
                <summary>
                  <span>#{sale.id}</span>
                  <span>{new Date(sale.sold_at).toLocaleString()}</span>
                  <span>{sale.customer_name || "Anonim"}</span>
                  <strong>{formatMoney(sale.total_minor)} so'm</strong>
                </summary>
                <div className="history-content">
                  <ul className="small-list">
                    {sale.items.map((item) => {
                      const rem = saleLineSoldRemaining(item);
                      return (
                        <li key={item.id}>
                          {item.product_name} - {formatQtyPlain(rem)} x{" "}
                          {formatMoney(item.unit_price_minor)} ={" "}
                          {formatMoney(item.line_total_minor)}
                        </li>
                      );
                    })}
                  </ul>
                  {owe > 0 ? (
                    <p className="history-payment-note">
                      To&apos;langan: {formatMoney(paid)} so&apos;m · Qarz: {formatMoney(owe)} so&apos;m
                    </p>
                  ) : null}
                </div>
              </details>
              );
            })}
            {!sales.length ? <p className="muted">Hali savdolar mavjud emas.</p> : null}
            {sales.length > 0 && !filteredSalesHistory.length ? (
              <p className="muted list-toolbar-hint">
                Qidiruv yoki sana filtri bo&apos;yicha savdo topilmadi.
              </p>
            ) : null}
          </div>
        </section>
      )}

      {activeTab === "reports" && (
        <section className="grid two-col">
          <article className="card">
            <h3>Davr bo'yicha hisobot</h3>
            <form className="form" onSubmit={handleReportFilter}>
              <label>
                Sana (dan)
                <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
              </label>
              <label>
                Sana (gacha)
                <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
              </label>
              <button className="btn" type="submit">
                Hisobotni yangilash
              </button>
            </form>
            <div className="metrics">
              <p>Savdolar soni: {reportData.sales_count}</p>
              <p>Umumiy tushum: {formatMoney(reportData.total_revenue_minor)} so'm</p>
            </div>
          </article>

          <article className="card">
            <h3>Top 10 mahsulot</h3>
            <ul className="small-list">
              {reportData.top_products.map((item) => (
                <li key={item.name}>
                  {item.name} — {formatQtyPlain(item.total_qty)} / {formatMoney(item.total_amount_minor)} so'm
                </li>
              ))}
              {!reportData.top_products.length && <li>Ma'lumot yo'q.</li>}
            </ul>
          </article>

          <article className="card full">
            <h3>Kam qolgan mahsulotlar (hisobot)</h3>
            <ul className="small-list">
              {reportData.low_stock.map((item) => (
                <li key={item.id}>
                  {item.name} — {item.quantity}
                </li>
              ))}
              {!reportData.low_stock.length && <li>Kam qoldiq yo'q.</li>}
            </ul>
          </article>
        </section>
      )}
      </div>
    </div>
  );
}
