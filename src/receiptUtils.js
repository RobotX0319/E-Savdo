/** Savdo cheki: chop etish oynasi va clipboard uchun PNG */

import { formatQtyPlain, roundQty3 } from "./qtyUnits.js";

function effectiveSaleLineQty(item) {
  const q = Number(item.qty) || 0;
  const r = Number(item.returned_qty) || 0;
  return roundQty3(q - r);
}

function fmtMoney(value) {
  return new Intl.NumberFormat("uz-UZ").format(Number(value || 0));
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function receiptCustomerName(sale, customerName) {
  return String(customerName || sale.customer_name || "Anonim").trim() || "Anonim";
}

export function normalizeSellerProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return { shop_name: "", seller_name: "", phone: "", email: "", notes: "" };
  }
  return {
    shop_name: String(profile.shop_name ?? "").trim(),
    seller_name: String(profile.seller_name ?? "").trim(),
    phone: String(profile.phone ?? "").trim(),
    email: String(profile.email ?? "").trim(),
    notes: String(profile.notes ?? "").trim()
  };
}

function buildSellerBoxHtml(profile) {
  const p = normalizeSellerProfile(profile);
  const parts = [];
  if (p.seller_name) {
    parts.push(
      `<p class="seller-line"><strong>Sotuvchi:</strong> ${escapeHtml(p.seller_name)}</p>`
    );
  }
  if (p.phone) {
    parts.push(`<p class="seller-line"><strong>Telefon:</strong> ${escapeHtml(p.phone)}</p>`);
  }
  if (p.email) {
    parts.push(`<p class="seller-line"><strong>Email:</strong> ${escapeHtml(p.email)}</p>`);
  }
  if (p.notes) {
    parts.push(
      `<p class="seller-note">${escapeHtml(p.notes).replace(/\n/g, "<br>")}</p>`
    );
  }
  if (!parts.length) return "";
  return `<div class="seller-box">${parts.join("")}</div>`;
}

/**
 * @returns {{ ok: boolean, error?: string }}
 */
export function printSaleReceipt(sale, customerName, profile) {
  const name = receiptCustomerName(sale, customerName);
  const totalM = Number(sale.total_minor) || 0;
  const paidM =
    sale.paid_minor != null && sale.paid_minor !== "" ? Number(sale.paid_minor) : totalM;
  const owe = Math.max(0, totalM - paidM);
  const when = new Date(sale.sold_at).toLocaleString("uz-UZ");
  const pProf = normalizeSellerProfile(profile);
  const shopTitleRaw = pProf.shop_name;
  const sellerBox = buildSellerBoxHtml(profile);
  const showSellerHeader = Boolean(shopTitleRaw || sellerBox);
  const sellerHeaderHtml = showSellerHeader
    ? `<div class="receipt-shop-block">
  ${shopTitleRaw ? `<h1 class="shop-title">${escapeHtml(shopTitleRaw)}</h1>` : ""}
  ${sellerBox}
</div>`
    : "";
  const rows = (sale.items || [])
    .map(
      (it) =>
        `<tr><td>${escapeHtml(it.product_name)}</td><td style="text-align:right">${escapeHtml(
          formatQtyPlain(effectiveSaleLineQty(it))
        )}</td><td style="text-align:right">${fmtMoney(
          it.unit_price_minor
        )}</td><td style="text-align:right">${fmtMoney(it.line_total_minor)}</td></tr>`
    )
    .join("");
  const noteRow = sale.note?.trim()
    ? `<p class="meta"><strong>Savdo izohi:</strong> ${escapeHtml(sale.note.trim())}</p>`
    : "";
  const payBlock =
    owe > 0
      ? `<p class="meta">To'langan: <strong>${fmtMoney(paidM)} so'm</strong> · Qarz: <strong>${fmtMoney(
          owe
        )} so'm</strong></p>`
      : `<p class="meta">To'liq to'langan.</p>`;

  const html = `<!DOCTYPE html><html lang="uz"><head><meta charset="utf-8"><title>Chek №${sale.id}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, sans-serif; padding: 24px; max-width: 520px; margin: 0 auto; color: #0f172a; }
  .receipt-shop-block { border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 18px; }
  .shop-title { font-size: 1.38rem; margin: 0 0 12px; color: #0f172a; font-weight: 800; letter-spacing: -0.02em; line-height: 1.25; }
  .seller-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; font-size: 0.88rem; color: #334155; }
  .seller-line { margin: 5px 0; line-height: 1.45; }
  .seller-note { margin: 10px 0 0; padding-top: 10px; border-top: 1px dashed #cbd5e1; white-space: pre-wrap; line-height: 1.45; color: #475569; font-size: 0.84rem; }
  .receipt-doc-title { font-size: 1.12rem; margin: 0 0 14px; font-weight: 700; color: #1e293b; }
  .meta { font-size: 0.9rem; margin: 8px 0; color: #334155; line-height: 1.4; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.85rem; }
  th, td { border: 1px solid #cbd5e1; padding: 9px 10px; vertical-align: top; }
  th { background: #f1f5f9; text-align: left; font-weight: 700; color: #0f172a; }
  td:nth-child(2), td:nth-child(3), td:nth-child(4) { text-align: right; white-space: nowrap; }
  .total { font-size: 1.08rem; font-weight: 700; margin: 16px 0 0; padding-top: 14px; border-top: 2px solid #e2e8f0; }
  @media print {
    body { padding: 12px; }
    .seller-box, th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>
${sellerHeaderHtml}
<h2 class="receipt-doc-title">Savdo cheki №${sale.id}</h2>
<p class="meta"><strong>Sana:</strong> ${escapeHtml(when)}</p>
<p class="meta"><strong>Xaridor:</strong> ${escapeHtml(name)}</p>
${noteRow}
<table>
<thead><tr><th>Mahsulot</th><th>Miqdor</th><th>Narx (so'm)</th><th>Summa (so'm)</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p class="total">Jami: ${fmtMoney(sale.total_minor)} so'm</p>
${payBlock}
</body></html>`;

  /** Electron/Chromium: yangi oyna + document.write ko'pincha bo'sh qoladi; iframe — barqaror */
  let iframe;
  try {
    iframe = document.createElement("iframe");
    iframe.setAttribute("title", "Chek chop etish");
    iframe.setAttribute("aria-hidden", "true");
    Object.assign(iframe.style, {
      position: "fixed",
      right: "0",
      bottom: "0",
      width: "0",
      height: "0",
      border: "0",
      opacity: "0",
      pointerEvents: "none"
    });
    document.body.appendChild(iframe);
  } catch {
    return { ok: false, error: "Chop etish tayyorlanmadi." };
  }

  const iwin = iframe.contentWindow;
  const idoc = iframe.contentDocument;
  if (!iwin || !idoc) {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
    return { ok: false, error: "Chop etish oynasi tayyorlanmadi." };
  }

  const cleanup = () => {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  };

  try {
    idoc.open();
    idoc.write(html);
    idoc.close();
  } catch {
    cleanup();
    return { ok: false, error: "Chek matni yozilmadi." };
  }

  const runPrint = () => {
    try {
      iwin.focus();
      iwin.print();
    } catch {
      cleanup();
    }
  };

  iwin.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(runPrint, 100);
  setTimeout(cleanup, 120000);
  return { ok: true };
}

function wrapProductLines(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW) cur = next;
    else {
      if (cur) lines.push(cur);
      if (ctx.measureText(w).width > maxW) {
        let chunk = "";
        for (const ch of w) {
          const t = chunk + ch;
          if (ctx.measureText(t).width > maxW && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else chunk = t;
        }
        cur = chunk;
      } else cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function computeSellerHeaderHeight(ctx, profile, W, pad, lineH) {
  const p = normalizeSellerProfile(profile);
  const shopTitle = p.shop_name;
  const hasBox = p.seller_name || p.phone || p.email || p.notes;
  if (!shopTitle && !hasBox) return 0;
  let h = 0;
  if (shopTitle) {
    ctx.font = "bold 20px Segoe UI, system-ui, sans-serif";
    const titleLines = wrapProductLines(ctx, shopTitle, W - pad * 2);
    h += titleLines.length * 22;
    h += hasBox ? 8 : 10;
  }
  if (hasBox) {
    h += 12;
    if (p.seller_name) h += lineH * 1.25;
    if (p.phone) h += lineH * 1.25;
    if (p.email) h += lineH * 1.25;
    if (p.notes) {
      h += 4;
      ctx.font = "11px Segoe UI, system-ui, sans-serif";
      const nls = wrapProductLines(ctx, p.notes, W - pad * 2 - 24);
      h += nls.length * lineH * 1.05;
    }
    h += 12;
  }
  h += 14 + 12;
  return h;
}

function drawSellerHeader(ctx, profile, W, pad, y0, lineH) {
  const p = normalizeSellerProfile(profile);
  const shopTitle = p.shop_name;
  const hasBox = p.seller_name || p.phone || p.email || p.notes;
  if (!shopTitle && !hasBox) return y0;
  let y = y0;
  if (shopTitle) {
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 20px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "left";
    const titleLines = wrapProductLines(ctx, shopTitle, W - pad * 2);
    for (const ln of titleLines) {
      ctx.fillText(ln, pad, y + 18);
      y += 22;
    }
    y += hasBox ? 8 : 10;
  }
  if (hasBox) {
    const boxTop = y;
    const innerPad = 12;
    const textW = W - pad * 2 - innerPad * 2;
    let innerY = boxTop + 12;
    const textDraw = [];
    if (p.seller_name) {
      textDraw.push({
        font: "600 12px Segoe UI, system-ui, sans-serif",
        color: "#0f172a",
        text: `Sotuvchi: ${p.seller_name}`,
        y: innerY
      });
      innerY += lineH * 1.25;
    }
    if (p.phone) {
      textDraw.push({
        font: "12px Segoe UI, system-ui, sans-serif",
        color: "#475569",
        text: `Tel: ${p.phone}`,
        y: innerY
      });
      innerY += lineH * 1.25;
    }
    if (p.email) {
      textDraw.push({
        font: "12px Segoe UI, system-ui, sans-serif",
        color: "#475569",
        text: `Email: ${p.email}`,
        y: innerY
      });
      innerY += lineH * 1.25;
    }
    if (p.notes) {
      innerY += 4;
      ctx.font = "11px Segoe UI, system-ui, sans-serif";
      const nls = wrapProductLines(ctx, p.notes, textW);
      for (const nl of nls) {
        textDraw.push({
          font: "11px Segoe UI, system-ui, sans-serif",
          color: "#64748b",
          text: nl,
          y: innerY
        });
        innerY += lineH * 1.05;
      }
    }
    innerY += 12;
    const boxH = innerY - boxTop;
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.fillRect(pad, boxTop, W - pad * 2, boxH);
    ctx.strokeRect(pad, boxTop, W - pad * 2, boxH);
    for (const t of textDraw) {
      ctx.font = t.font;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, pad + innerPad, t.y + lineH);
    }
    y = boxTop + boxH;
  }
  y += 14;
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.stroke();
  y += 12;
  return y;
}

/**
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function copySaleReceiptAsImage(sale, customerName, profile) {
  const name = receiptCustomerName(sale, customerName);
  const items = sale.items || [];
  const totalM = Number(sale.total_minor) || 0;
  const paidM =
    sale.paid_minor != null && sale.paid_minor !== "" ? Number(sale.paid_minor) : totalM;
  const owe = Math.max(0, totalM - paidM);
  const fmt = fmtMoney;

  const W = 440;
  const pad = 24;
  const lineH = 17;
  const headerRowH = 28;
  const colWName = 178;
  const colX = {
    name: pad,
    qty: pad + 186,
    price: pad + 238,
    sum: pad + 318
  };

  const scratch = document.createElement("canvas");
  const mctx = scratch.getContext("2d");
  if (!mctx) return { ok: false, error: "Canvas qo'llab-quvvatlanmaydi." };
  mctx.font = "12px Segoe UI, system-ui, sans-serif";

  const sellerHeadH = computeSellerHeaderHeight(mctx, profile, W, pad, lineH);

  let bodyH = 0;
  for (const it of items) {
    const lines = wrapProductLines(mctx, it.product_name, colWName);
    bodyH += Math.max(30, lines.length * lineH + 12);
  }

  let H = pad;
  H += sellerHeadH;
  H += 26;
  H += lineH * 1.35;
  H += lineH * 1.35;
  if (sale.note?.trim()) H += lineH * 1.35;
  H += 10 + headerRowH + bodyH + 14 + 22 + (owe > 0 ? lineH * 2.1 : lineH * 1.35);
  H += pad;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, error: "Canvas qo'llab-quvvatlanmaydi." };

  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.ceil(H * dpr);
  ctx.scale(dpr, dpr);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  let y = pad;
  y = drawSellerHeader(ctx, profile, W, pad, y, lineH);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 17px Segoe UI, system-ui, sans-serif";
  ctx.fillText(`Savdo cheki №${sale.id}`, pad, y + 18);
  y += 26;
  ctx.font = "13px Segoe UI, system-ui, sans-serif";
  ctx.fillStyle = "#475569";
  ctx.fillText(`Sana: ${new Date(sale.sold_at).toLocaleString("uz-UZ")}`, pad, y + lineH);
  y += lineH * 1.35;
  ctx.fillText(`Xaridor: ${name}`, pad, y + lineH);
  y += lineH * 1.35;
  if (sale.note?.trim()) {
    const noteLines = wrapProductLines(ctx, `Savdo izohi: ${sale.note.trim()}`, W - pad * 2);
    for (const ln of noteLines) {
      ctx.fillText(ln, pad, y + lineH);
      y += lineH * 1.2;
    }
  }
  y += 8;

  const tableTop = y;
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(pad, tableTop, W - pad * 2, headerRowH);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 12px Segoe UI, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Mahsulot", colX.name + 4, tableTop + 19);
  ctx.textAlign = "right";
  ctx.fillText("Miqdor", colX.qty + 44, tableTop + 19);
  ctx.fillText("Narx", colX.price + 62, tableTop + 19);
  ctx.fillText("Summa", colX.sum + 78, tableTop + 19);
  ctx.textAlign = "left";

  y = tableTop + headerRowH;
  ctx.font = "12px Segoe UI, system-ui, sans-serif";
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;

  for (const it of items) {
    const lines = wrapProductLines(ctx, it.product_name, colWName);
    const rh = Math.max(30, lines.length * lineH + 12);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(W - pad, y);
    ctx.stroke();
    let ly = y + 16;
    ctx.fillStyle = "#0f172a";
    ctx.textAlign = "left";
    for (const ln of lines) {
      ctx.fillText(ln, colX.name + 4, ly);
      ly += lineH;
    }
    ctx.textAlign = "right";
    ctx.fillText(formatQtyPlain(effectiveSaleLineQty(it)), colX.qty + 44, y + 16);
    ctx.fillText(fmt(it.unit_price_minor), colX.price + 62, y + 16);
    ctx.fillText(fmt(it.line_total_minor), colX.sum + 78, y + 16);
    ctx.textAlign = "left";
    y += rh;
  }

  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.strokeStyle = "#cbd5e1";
  ctx.stroke();

  y += 14;
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 15px Segoe UI, system-ui, sans-serif";
  ctx.fillText(`Jami: ${fmt(sale.total_minor)} so'm`, pad, y + lineH);
  y += 22;
  ctx.font = "12px Segoe UI, system-ui, sans-serif";
  if (owe > 0) {
    ctx.fillStyle = "#b45309";
    ctx.fillText(`To'langan: ${fmt(paidM)} so'm  ·  Qarz: ${fmt(owe)} so'm`, pad, y + lineH);
  } else {
    ctx.fillStyle = "#15803d";
    ctx.fillText("To'liq to'langan.", pad, y + lineH);
  }

  const blob = await new Promise((res) => canvas.toBlob(res, "image/png", 1));
  if (!blob) return { ok: false, error: "Rasm yaratilmadi." };

  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return { ok: false, error: "Clipboard API mavjud emas (HTTPS yoki ruxsat kerak)." };
  }

  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } catch (e) {
    return {
      ok: false,
      error: e?.message || "Rasm clipboardga yozilmadi. Brauzer ruxsatini tekshiring."
    };
  }
  return { ok: true };
}
