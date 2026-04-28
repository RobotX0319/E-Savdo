/** kg, m, m² va h.k. o'lchovli mahsulotlar uchun 0.001 qadam; dona — butun son */

export function isFractionalMeasureUnit(unit) {
  const u = String(unit ?? "")
    .toLowerCase()
    .trim()
    .replace(/\u00a0/g, " ");
  if (!u) return false;
  const c = u.replace(/\s+/g, "").replace(/²/g, "2");
  if (c === "kg" || c === "кг" || c === "g" || c === "г" || c === "gr" || c === "gramm") return true;
  if (u.includes("kg") || u.includes("кг")) return true;
  if (u.includes("m²") || u.includes("m2") || u.includes("mkv") || u.includes("kvm")) return true;
  if (u.includes("kv.m") || u.includes("kv/m") || u.includes("m^2")) return true;
  if (c === "m" || c === "meter" || c === "metr" || c === "метр" || c === "м") return true;
  return false;
}

export function roundQty3(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

/** Satr ko'rinishi: ortiqcha 0 larni olib tashlash */
export function formatQtyPlain(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return String(qty ?? "");
  const r = roundQty3(n);
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  const s = r.toFixed(3);
  return s.replace(/\.?0+$/, "");
}

/** Qoldiq ustuni: "100 dona", "10 kg" */
export function formatStockQtyWithUnit(qty, unit) {
  const q = formatQtyPlain(qty);
  const u = String(unit ?? "").trim();
  if (!u) return q;
  return `${q} ${u}`;
}

/**
 * @returns {number | null} null — noto'g'ri yoki 0 ga teng (o'tkazib yuborish)
 */
export function normalizeSaleQty(unit, rawQty) {
  const n = Number(String(rawQty).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (isFractionalMeasureUnit(unit)) {
    const r = roundQty3(n);
    if (r < 0.001) return null;
    return r;
  }
  const int = Math.round(n);
  if (int < 1) return null;
  if (Math.abs(n - int) > 1e-5) return null;
  return int;
}

export function exceedsStock(qty, stockQty) {
  return roundQty3(qty) - roundQty3(Number(stockQty)) > 1e-6;
}

/** Ombor qoldig'i (0 ruxsat): kasrli birlikda 0,001 qadam, donada butun son */
export function normalizeStockLevel(unit, rawQty) {
  const n = Number(String(rawQty).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  if (isFractionalMeasureUnit(unit)) {
    return roundQty3(n);
  }
  const int = Math.round(n);
  if (Math.abs(n - int) > 1e-5) return null;
  return int;
}
