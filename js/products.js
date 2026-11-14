// ============================================================
// js/products.js - Product Management, Autocomplete & Price History
// Handles: Duplicate Alert, Autocomplete, History Timeline, Sorting
// ============================================================

import { productsCol, $, money, esc, formatTimestamp, parseDateObject, toast, safe } from "./config.js";
import { onSnapshot, addDoc, updateDoc, deleteDoc, doc, Timestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { currentStore } from "./stores.js";
import { currentUser } from "./auth.js";

export let allProducts = [];
export let storeProducts = [];
export { storeProducts as products, filterStoreProducts as bindProducts };
let pLimit = 100;
let editProdId = null;
let pendingDuplicateData = null;

const prodDlg = $("pDialog");
const dupDlg = $("pDuplicateDialog");
const histDlg = $("pHistoryDialog");

export function filterStoreProducts() {
  if (!currentStore) {
    storeProducts = [];
    renderProducts();
    return;
  }

  const sId = currentStore.id;
  const isOboshor = sId === "oboshor_store";

  storeProducts = allProducts.filter((p) => p.storeId === sId || (isOboshor && !p.storeId));
  renderProducts();
}

function updateProductCalcPreview() {
  const cost = Number($("pCost").value) || 0;
  const sell = Number($("pSell").value) || 0;
  const profit = sell - cost;
  const margin = sell > 0 ? (profit / sell) * 100 : 0;
  $("pProfitPreview").textContent = money(profit);
  $("pProfitPreview").className = profit < 0 ? "text-red-700 font-bold" : "text-teal-700 font-bold";
  $("pMarginPreview").textContent = `${margin.toFixed(1)}%`;
}

export function openProduct(p = null) {
  editProdId = p?.id || null;
  $("pTitle").textContent = p ? "Edit Product" : "Add Product";
  $("pName").value = p?.productName || "";
  $("pCost").value = p?.costPrice ?? "";
  $("pSell").value = p?.sellPrice ?? "";
  $("pNote").value = "";
  $("pSuggestions").classList.add("hidden");
  updateProductCalcPreview();
  prodDlg?.showModal();
}

function showProductPriceHistory(prod) {
  $("histProdTitle").textContent = prod.productName;
  $("histProdSubtitle").textContent = `Current: Cost ${money(prod.costPrice)} · Sell ${money(prod.sellPrice)}`;

  const timeline = $("histTimeline");
  const history = Array.isArray(prod.history) ? prod.history : [];

  if (!history.length) {
    timeline.innerHTML = `
      <div class="bg-slate-50 border border-slate-200 p-4 rounded-xl text-center text-xs text-slate-500">
        No previous price adjustments recorded for this product.
        <p class="mt-1 text-[11px] text-slate-400">Initial registration: ${formatTimestamp(prod.createdAt || prod.timestamp) || "N/A"}</p>
      </div>`;
  } else {
    timeline.innerHTML = history.map((h, i) => `
      <div class="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs flex justify-between items-start gap-2">
        <div>
          <div class="flex items-center gap-2">
            <span class="badge ${i === 0 ? "badge-teal" : "badge-stone"} text-[10px]">
              ${i === 0 ? "Previous Price" : `Price Adjustment #${history.length - i}`}
            </span>
            <span class="text-slate-400 text-[11px]">🕒 ${esc(h.updatedAtFormatted || formatTimestamp(h.updatedAt))}</span>
          </div>
          <p class="mt-1.5 font-medium text-slate-700">
            Cost: <b class="text-slate-900">${money(h.costPrice)}</b> · Sell: <b class="text-teal-800">${money(h.sellPrice)}</b>
            (Profit: ${money(h.sellPrice - h.costPrice)})
          </p>
          ${h.note ? `<p class="italic text-[11px] text-slate-500 mt-0.5">Note: "${esc(h.note)}"</p>` : ""}
        </div>
        <div class="text-right shrink-0 text-[11px] text-slate-400">
          Updated by: <b class="text-slate-600">${esc(h.updatedBy || "Admin")}</b>
        </div>
      </div>
    `).join("");
  }

  histDlg?.showModal();
}

function getSortedProducts() {
  const q = ($("pSearch")?.value || "").trim().toLowerCase();
  let list = storeProducts.filter((p) => (p.productName || "").toLowerCase().includes(q));

  const sort = $("pSort")?.value || "name_asc";
  list.sort((a, b) => {
    if (sort === "name_asc") return (a.productName || "").localeCompare(b.productName || "");
    if (sort === "name_desc") return (b.productName || "").localeCompare(a.productName || "");
    if (sort === "sell_asc") return (a.sellPrice || 0) - (b.sellPrice || 0);
    if (sort === "sell_desc") return (b.sellPrice || 0) - (a.sellPrice || 0);
    if (sort === "cost_asc") return (a.costPrice || 0) - (b.costPrice || 0);
    if (sort === "cost_desc") return (b.costPrice || 0) - (a.costPrice || 0);
    if (sort === "profit_desc") return (b.sellPrice - b.costPrice) - (a.sellPrice - a.costPrice);
    if (sort === "margin_desc") {
      const mA = a.sellPrice ? (a.sellPrice - a.costPrice) / a.sellPrice : 0;
      const mB = b.sellPrice ? (b.sellPrice - b.costPrice) / b.sellPrice : 0;
      return mB - mA;
    }
    if (sort === "date_desc") {
      const tA = parseDateObject(a.createdAt || a.timestamp)?.getTime() || 0;
      const tB = parseDateObject(b.createdAt || b.timestamp)?.getTime() || 0;
      return tB - tA;
    }
    if (sort === "date_asc") {
      const tA = parseDateObject(a.createdAt || a.timestamp)?.getTime() || 0;
      const tB = parseDateObject(b.createdAt || b.timestamp)?.getTime() || 0;
      return tA - tB;
    }
    return 0;
  });

  return list;
}

export function renderProducts() {
  if (!$("productRows")) return;

  const q = ($("pSearch")?.value || "").trim().toLowerCase();
  $("pClear")?.classList.toggle("hidden", !q);

  const list = getSortedProducts();
  if ($("prodSummary")) {
    $("prodSummary").textContent = `${list.length.toLocaleString()} products in this store${q ? ` matching "${q}"` : ""}`;
  }

  $("productRows").innerHTML = list.slice(0, pLimit).map((p) => {
    const profit = p.sellPrice - p.costPrice;
    const mg = p.sellPrice ? (profit / p.sellPrice) * 100 : 0;
    const tsFormatted = formatTimestamp(p.createdAt || p.timestamp);
    const hasHistory = Array.isArray(p.history) && p.history.length > 0;

    return `
      <div class="row">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <button class="font-bold text-slate-800 break-words text-sm md:text-base hover:text-teal-700 hover:underline text-left cursor-pointer" data-act="history" data-id="${p.id}">
              ${esc(p.productName)}
            </button>
            ${hasHistory ? `<button class="badge badge-blue text-[10px] cursor-pointer hover:bg-blue-100" data-act="history" data-id="${p.id}">🕒 ${p.history.length} price logs</button>` : ""}
            ${tsFormatted ? `<span class="badge badge-stone text-[10px]" title="Insert Timestamp">Added: ${esc(tsFormatted)}</span>` : ""}
          </div>
          <p class="text-xs text-slate-500 mt-1">
            Cost ${money(p.costPrice)} · Profit:
            <span class="${profit < 0 ? "text-red-700 font-bold" : "text-teal-700 font-bold"}">
              ${money(profit)} (${mg.toFixed(0)}%)
            </span>
          </p>
        </div>
        <div class="text-right shrink-0">
          <p class="font-extrabold text-slate-800 text-base">${money(p.sellPrice)}</p>
          <div class="acts">
            <button data-act="history" data-id="${p.id}" title="View Price History">History</button>
            <button data-act="edit" data-id="${p.id}">Edit</button>
            <button class="del" data-act="del" data-id="${p.id}">Delete</button>
          </div>
        </div>
      </div>`;
  }).join("") || `<p class="empty">No products found in this store. Tap "+ Add Product" to register an item.</p>`;

  $("moreProducts")?.classList.toggle("hidden", list.length <= pLimit);
}

async function saveProductRecord(id, name, cost, sell, note) {
  const now = new Date();
  const ts = Timestamp.fromDate(now);
  const userIdentifier = currentUser?.userId || "Admin";

  await safe(async () => {
    if (id) {
      const existing = storeProducts.find((p) => p.id === id);
      const currentHistory = Array.isArray(existing?.history) ? [...existing.history] : [];

      if (existing) {
        currentHistory.unshift({
          costPrice: existing.costPrice,
          sellPrice: existing.sellPrice,
          updatedAt: existing.updatedAt || existing.createdAt || ts,
          updatedAtFormatted: formatTimestamp(existing.updatedAt || existing.createdAt || now),
          updatedBy: userIdentifier,
          note: note || "Price updated"
        });
      }

      await updateDoc(doc(productsCol, id), {
        storeId: currentStore.id,
        productName: name,
        costPrice: cost,
        sellPrice: sell,
        history: currentHistory.slice(0, 30),
        updatedAt: ts,
        updatedAtFormatted: formatTimestamp(now)
      });
    } else {
      const initialHistory = [{
        costPrice: cost,
        sellPrice: sell,
        updatedAt: ts,
        updatedAtFormatted: formatTimestamp(now),
        updatedBy: userIdentifier,
        note: note || "Initial product registration"
      }];

      await addDoc(productsCol, {
        storeId: currentStore.id,
        productName: name,
        costPrice: cost,
        sellPrice: sell,
        history: initialHistory,
        createdAt: ts,
        timestamp: ts,
        createdAtFormatted: formatTimestamp(now)
      });
    }
  }, id ? `Product "${name}" updated with price history recorded` : `Product "${name}" added`);
}

export function setupProductListeners() {
  // Real-time listener for products
  onSnapshot(productsCol, (snap) => {
    allProducts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    filterStoreProducts();
  }, () => filterStoreProducts());

  // Input listeners
  ["pCost", "pSell"].forEach((id) => $(id)?.addEventListener("input", updateProductCalcPreview));

  // Autocomplete suggestions
  $("pName")?.addEventListener("input", (e) => {
    const query = e.target.value.trim().toLowerCase();
    const suggestBox = $("pSuggestions");
    if (!suggestBox) return;

    if (!query) {
      suggestBox.classList.add("hidden");
      return;
    }

    const matches = storeProducts.filter((p) => (p.productName || "").toLowerCase().includes(query)).slice(0, 5);
    if (!matches.length) {
      suggestBox.classList.add("hidden");
      return;
    }

    suggestBox.innerHTML = matches.map((m) => `
      <div class="suggestion-item" data-id="${m.id}">
        <div>
          <span class="font-bold text-slate-800">${esc(m.productName)}</span>
          <span class="text-xs text-slate-400 ml-2">Cost: ${money(m.costPrice)} | Sell: ${money(m.sellPrice)}</span>
        </div>
        <span class="badge badge-teal text-[10px]">Select to update</span>
      </div>
    `).join("");

    suggestBox.classList.remove("hidden");
  });

  $("pSuggestions")?.addEventListener("click", (e) => {
    const item = e.target.closest(".suggestion-item");
    if (!item) return;

    const prod = storeProducts.find((p) => p.id === item.dataset.id);
    if (!prod) return;

    editProdId = prod.id;
    $("pTitle").textContent = "Update Existing Product";
    $("pName").value = prod.productName;
    $("pCost").value = prod.costPrice;
    $("pSell").value = prod.sellPrice;
    $("pNote").value = "Price adjusted";
    updateProductCalcPreview();
    $("pSuggestions").classList.add("hidden");

    toast(`Selected "${prod.productName}". Update prices and previous price will be preserved in history.`);
  });

  // Submit product with duplicate check
  $("productForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("pName").value.trim();
    const cost = Number($("pCost").value) || 0;
    const sell = Number($("pSell").value) || 0;
    const note = $("pNote").value.trim();

    const existingDup = storeProducts.find((p) =>
      (p.productName || "").trim().toLowerCase() === name.toLowerCase() && p.id !== editProdId
    );

    if (existingDup) {
      pendingDuplicateData = { existingProd: existingDup, newCost: cost, newSell: sell, newNote: note };
      $("dupProdName").textContent = existingDup.productName;
      $("dupOldCost").textContent = money(existingDup.costPrice);
      $("dupOldSell").textContent = money(existingDup.sellPrice);
      $("dupNewCost").textContent = money(cost);
      $("dupNewSell").textContent = money(sell);
      dupDlg?.showModal();
      return;
    }

    saveProductRecord(editProdId, name, cost, sell, note);
    prodDlg?.close();
  });

  $("btnDupCancel")?.addEventListener("click", () => dupDlg?.close());

  $("btnDupUpdate")?.addEventListener("click", () => {
    if (!pendingDuplicateData) return;
    const { existingProd, newCost, newSell, newNote } = pendingDuplicateData;
    saveProductRecord(existingProd.id, existingProd.productName, newCost, newSell, newNote || "Price updated (duplicate resolved)");
    dupDlg?.close();
    prodDlg?.close();
  });

  // Sorting & Search
  $("pSort")?.addEventListener("change", renderProducts);
  $("pSearch")?.addEventListener("input", renderProducts);
  $("pClear")?.addEventListener("click", () => {
    $("pSearch").value = "";
    renderProducts();
  });
  $("moreProducts")?.addEventListener("click", () => {
    pLimit += 100;
    renderProducts();
  });

  // Product Row clicks
  $("productRows")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const { act, id } = btn.dataset;
    const p = storeProducts.find((x) => x.id === id);
    if (!p) return;

    if (act === "history") showProductPriceHistory(p);
    if (act === "edit") openProduct(p);
    if (act === "del") {
      if (confirm(`Delete "${p.productName}" from this store's price list?`)) {
        safe(async () => {
          await deleteDoc(doc(productsCol, id));
        }, "Product deleted");
      }
    }
  });

  $("addProduct")?.addEventListener("click", () => openProduct());
}

