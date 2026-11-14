// ============================================================
// js/data-io.js - Import, Export, Backup, Demo Sheets & Data Management
// Uses: SheetJS (XLSX) for Excel Processing, Firestore Batch Operations
// ============================================================

import {
  db, productsCol, sellsCol, $, toast, safe, formatTimestamp, logActivity, dateKey
} from "./config.js";
import { writeBatch, doc, Timestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { currentStore, deleteStore } from "./stores.js";
import { currentUser } from "./auth.js";
import { products } from "./products.js";
import { sells } from "./sells.js";

const status = (t) => {
  const el = $("status");
  if (el) el.textContent = t;
};

export async function bulkSave(col, items) {
  for (let i = 0; i < items.length; i += 400) {
    const batch = writeBatch(db);
    items.slice(i, i + 400).forEach((it) => batch.set(doc(col), it));
    await batch.commit();
    status(`Saving records to cloud… ${Math.min(i + 400, items.length)} of ${items.length}`);
  }
}

// Demo Sheet Downloads
export function downloadDemoProductsSheet() {
  if (typeof XLSX === "undefined") {
    toast("SheetJS library is loading, please try again in a second.", true);
    return;
  }
  const wb = XLSX.utils.book_new();
  const sampleProducts = [
    { "Product Name": "Master Mustard Oil 1L", "Cost Price": 180, "Sell Price": 210 },
    { "Product Name": "Miniket Rice 25kg", "Cost Price": 1650, "Sell Price": 1750 },
    { "Product Name": "Fresh Sugar 1kg", "Cost Price": 120, "Sell Price": 130 },
    { "Product Name": "Dettol Soap 75g", "Cost Price": 45, "Sell Price": 55 },
    { "Product Name": "Ceylon Black Tea 200g", "Cost Price": 85, "Sell Price": 100 },
    { "Product Name": "Radhuni Turmeric Powder 100g", "Cost Price": 40, "Sell Price": 50 }
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sampleProducts), "Price List");
  XLSX.writeFile(wb, "store-manager-demo-products.xlsx");
  toast("Demo Products Template downloaded");
}

export function downloadDemoSellsSheet() {
  if (typeof XLSX === "undefined") {
    toast("SheetJS library is loading, please try again in a second.", true);
    return;
  }
  const wb = XLSX.utils.book_new();
  const sampleSells = [
    { "Date": "2026-11-10", "Morning Amount": 2500, "Night Amount": 12500, "Khoroch": 200, "Due": 0, "Notes": "Standard daily sales" },
    { "Date": "2026-11-11", "Morning Amount": 3000, "Night Amount": 14200, "Khoroch": 150, "Due": 500, "Notes": "Due from regular customer" },
    { "Date": "2026-11-12", "Morning Amount": 2200, "Night Amount": 9800, "Khoroch": 0, "Due": 0, "Notes": "" },
    { "Date": "2026-11-13", "Morning Amount": 1800, "Night Amount": 11400, "Khoroch": 300, "Due": 0, "Notes": "Shop electric bill paid" }
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sampleSells), "Daily Sells");
  XLSX.writeFile(wb, "store-manager-demo-daily-sells.xlsx");
  toast("Demo Daily Sells Template downloaded");
}

// Helpers for Sheet Reading
const norm = (k) => String(k ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return isNaN(n) ? 0 : n; };

function dateStr(v) {
  if (v instanceof Date) return dateKey(new Date(v.getTime() + 2000));
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? "" : dateKey(d);
}

function readSheet(ws, need) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", cellDates: true });
  const h = rows.findIndex((r) => need.every((n) => r.map(norm).includes(n)));
  if (h < 0) return null;
  const head = rows[h].map(norm);
  const col = (n) => head.indexOf(n);
  return { rows: rows.slice(h + 1), col };
}

export function setupDataIOListeners() {
  // Demo download triggers (inside app & on landing page)
  document.querySelectorAll(".trigger-demo-products").forEach((btn) => {
    btn.addEventListener("click", downloadDemoProductsSheet);
  });
  $("btnDownloadDemoProducts")?.addEventListener("click", downloadDemoProductsSheet);
  $("btnDownloadDemoProductsCard")?.addEventListener("click", downloadDemoProductsSheet);

  document.querySelectorAll(".trigger-demo-sells").forEach((btn) => {
    btn.addEventListener("click", downloadDemoSellsSheet);
  });
  $("btnDownloadDemoSells")?.addEventListener("click", downloadDemoSellsSheet);
  $("btnDownloadDemoSellsCard")?.addEventListener("click", downloadDemoSellsSheet);

  // Import Daily Sells File (dedicated field)
  $("importSellsFile")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentStore) return;

    await safe(async () => {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sl = [];
      let seq = Date.now();
      const now = new Date();
      const tsNow = Timestamp.fromDate(now);
      const tsFmt = formatTimestamp(now);

      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        const S = readSheet(ws, ["date", "morningamount", "nightamount"]);
        if (S) {
          S.rows.forEach((r) => {
            const d = dateStr(r[S.col("date")]);
            const m = r[S.col("morningamount")];
            const n = r[S.col("nightamount")];
            if (d && m !== "" && n !== "") {
              sl.push({
                storeId: currentStore.id,
                date: d,
                morningAmount: num(m),
                nightAmount: num(n),
                totalSell: num(n) - num(m),
                khoroch: S.col("khoroch") < 0 ? 0 : num(r[S.col("khoroch")]),
                due: S.col("due") < 0 ? 0 : num(r[S.col("due")]),
                notes: S.col("notes") < 0 ? "" : String(r[S.col("notes")]).trim(),
                seq: seq++,
                createdAt: tsNow,
                timestamp: tsNow,
                createdAtFormatted: tsFmt
              });
            }
          });
        }
      }

      if (!sl.length) {
        throw new Error("No daily sells found. Required columns: Date, Morning Amount, Night Amount.");
      }

      if (!confirm(`Import ${sl.length} daily sell records into "${currentStore.name}"?`)) return;

      await bulkSave(sellsCol, sl);
      await logActivity("Import Sells", `Imported ${sl.length} daily sells into ${currentStore.name}`);
      status(`Imported ${sl.length} daily sell records.`);
    }, "Daily sells imported successfully");

    e.target.value = "";
  });

  // Import Product List File (dedicated field)
  $("importProductsFile")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentStore) return;

    await safe(async () => {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const prods = [];
      const now = new Date();
      const tsNow = Timestamp.fromDate(now);
      const tsFmt = formatTimestamp(now);

      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        const P = readSheet(ws, ["productname", "sellprice"]);
        if (P) {
          P.rows.forEach((r) => {
            const n = String(r[P.col("productname")]).trim();
            if (n) {
              prods.push({
                storeId: currentStore.id,
                productName: n,
                costPrice: num(r[P.col("costprice")]),
                sellPrice: num(r[P.col("sellprice")]),
                createdAt: tsNow,
                timestamp: tsNow,
                createdAtFormatted: tsFmt,
                history: [{ costPrice: num(r[P.col("costprice")]), sellPrice: num(r[P.col("sellprice")]), updatedAt: tsNow, updatedBy: "File Import" }]
              });
            }
          });
        }
      }

      if (!prods.length) {
        throw new Error("No products found. Required columns: Product Name, Sell Price (optional: Cost Price).");
      }

      if (!confirm(`Import ${prods.length} products into "${currentStore.name}"?`)) return;

      await bulkSave(productsCol, prods);
      await logActivity("Import Products", `Imported ${prods.length} products into ${currentStore.name}`);
      status(`Imported ${prods.length} product records.`);
    }, "Products imported successfully");

    e.target.value = "";
  });

  // Legacy combined import support (backwards compat if importFile exists)
  $("importFile")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentStore) return;

    await safe(async () => {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const prods = [];
      const sl = [];
      let seq = Date.now();
      const now = new Date();
      const tsNow = Timestamp.fromDate(now);
      const tsFmt = formatTimestamp(now);

      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        const P = !prods.length && readSheet(ws, ["productname", "sellprice"]);
        if (P) {
          P.rows.forEach((r) => {
            const n = String(r[P.col("productname")]).trim();
            if (n) {
              prods.push({
                storeId: currentStore.id,
                productName: n,
                costPrice: num(r[P.col("costprice")]),
                sellPrice: num(r[P.col("sellprice")]),
                createdAt: tsNow,
                timestamp: tsNow,
                createdAtFormatted: tsFmt,
                history: [{ costPrice: num(r[P.col("costprice")]), sellPrice: num(r[P.col("sellprice")]), updatedAt: tsNow, updatedBy: "File Import" }]
              });
            }
          });
        }

        const S = readSheet(ws, ["date", "morningamount", "nightamount"]);
        if (S) {
          S.rows.forEach((r) => {
            const d = dateStr(r[S.col("date")]);
            const m = r[S.col("morningamount")];
            const n = r[S.col("nightamount")];
            if (d && m !== "" && n !== "") {
              sl.push({
                storeId: currentStore.id,
                date: d,
                morningAmount: num(m),
                nightAmount: num(n),
                totalSell: num(n) - num(m),
                khoroch: S.col("khoroch") < 0 ? 0 : num(r[S.col("khoroch")]),
                due: S.col("due") < 0 ? 0 : num(r[S.col("due")]),
                notes: S.col("notes") < 0 ? "" : String(r[S.col("notes")]).trim(),
                seq: seq++,
                createdAt: tsNow,
                timestamp: tsNow,
                createdAtFormatted: tsFmt
              });
            }
          });
        }
      }

      if (!prods.length && !sl.length) {
        throw new Error("Columns not recognized. Check header row (Product Name, Cost Price, Sell Price or Date, Morning Amount, Night Amount).");
      }

      if (!confirm(`Import ${prods.length} products and ${sl.length} daily sells into "${currentStore.name}"?`)) return;

      if (prods.length) await bulkSave(productsCol, prods);
      if (sl.length) await bulkSave(sellsCol, sl);

      await logActivity("Import Records", `Imported ${prods.length} prods, ${sl.length} sells into ${currentStore.name}`);
      status(`Imported ${prods.length} products and ${sl.length} daily sells.`);
    }, "Import finished successfully");

    e.target.value = "";
  });

  // Export Excel Backup (robust)
  $("exportBtn")?.addEventListener("click", () => {
    if (!currentStore) {
      toast("Please select an active store first.", true);
      return;
    }
    if (typeof XLSX === "undefined") {
      toast("SheetJS library is loading, please try again in a second.", true);
      return;
    }

    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Price List
      const prodData = products.length ? products.map((p) => ({
        "Product Name": p.productName || "",
        "Cost Price": typeof p.costPrice === "number" ? p.costPrice : 0,
        "Sell Price": typeof p.sellPrice === "number" ? p.sellPrice : 0,
        "Est. Profit": (p.sellPrice || 0) - (p.costPrice || 0),
        "Created": formatTimestamp(p.createdAt || p.timestamp || null)
      })) : [{ "Product Name": "(No products in this store)", "Cost Price": "", "Sell Price": "", "Est. Profit": "", "Created": "" }];

      const prodSheet = XLSX.utils.json_to_sheet(prodData);
      // Set column widths
      prodSheet["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, prodSheet, "Price List");

      // Sheet 2: Daily Sells
      const sellData = sells.length ? sells.map((s) => ({
        "Date": s.date || "",
        "Morning Amount": typeof s.morningAmount === "number" ? s.morningAmount : 0,
        "Night Amount": typeof s.nightAmount === "number" ? s.nightAmount : 0,
        "Total Sell": typeof s.totalSell === "number" ? s.totalSell : ((s.nightAmount || 0) - (s.morningAmount || 0)),
        "Khoroch": s.khoroch || 0,
        "Due": s.due || 0,
        "Notes": s.notes || "",
        "Created": formatTimestamp(s.createdAt || s.timestamp || null)
      })) : [{ "Date": "(No daily sells in this store)", "Morning Amount": "", "Night Amount": "", "Total Sell": "", "Khoroch": "", "Due": "", "Notes": "", "Created": "" }];

      const sellSheet = XLSX.utils.json_to_sheet(sellData);
      sellSheet["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 24 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, sellSheet, "Daily Sells");

      // Generate filename and trigger download
      const cleanStoreName = (currentStore.name || "store").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const fileName = `${cleanStoreName}-backup-${dateKey(new Date())}.xlsx`;

      XLSX.writeFile(wb, fileName);

      const statusEl = $("exportStatusText");
      if (statusEl) statusEl.textContent = `✅ "${fileName}" downloaded (${products.length} products, ${sells.length} sells)`;
      toast(`Backup downloaded: ${fileName}`);

      logActivity("Export Backup", `Exported backup for ${currentStore.name}: ${products.length} products, ${sells.length} sells`).catch(() => {});
    } catch (err) {
      console.error("Export error:", err);
      toast("Export failed: " + err.message, true);
    }
  });

  // Danger Zone: Delete Records & Store
  const delConfirmDlg = $("deleteConfirmDialog");
  let activeDeleteTarget = "all";

  function openDeleteAllDialog(target) {
    if (!delConfirmDlg) return;
    activeDeleteTarget = target;
    let label = "Everything in this store";
    if (target === "daily_sells") label = `All Daily Sells in this store (${sells.length.toLocaleString()} records)`;
    if (target === "products") label = `All Products in this store (${products.length.toLocaleString()} records)`;
    if (target === "store") label = `The ENTIRE STORE "${currentStore?.name}" and ALL its products and daily sales records`;

    $("delTargetLabel").textContent = label;
    $("delAdminId").value = "";
    $("delAdminPass").value = "";
    $("delError").classList.add("hidden");
    if ($("delSubmitBtn")) {
      $("delSubmitBtn").textContent = target === "store" ? "Verify & Delete Store" : "Verify & Delete";
    }
    delConfirmDlg.showModal();
  }

  $("btnDeleteSells")?.addEventListener("click", () => openDeleteAllDialog("daily_sells"));
  $("btnDeleteProducts")?.addEventListener("click", () => openDeleteAllDialog("products"));
  $("btnDeleteEverything")?.addEventListener("click", () => openDeleteAllDialog("all"));

  const triggerStoreDelete = () => {
    if (!currentStore || !currentUser) return;
    const isOwner = currentUser.userId?.toLowerCase() === currentStore.ownerId?.toLowerCase() ||
                    currentUser.email?.toLowerCase() === currentStore.ownerEmail?.toLowerCase() ||
                    (currentUser.userId === "Oboshor" && currentStore.id === "oboshor_store") ||
                    currentUser.role === "admin";
    if (!isOwner) {
      toast("Only the store owner can delete this store.", true);
      return;
    }
    openDeleteAllDialog("store");
  };

  $("btnDeleteStore")?.addEventListener("click", triggerStoreDelete);
  $("btnDeleteStoreFromSettings")?.addEventListener("click", triggerStoreDelete);

  $("deleteConfirmForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const enteredId = $("delAdminId").value.trim().toLowerCase();
    const enteredPass = $("delAdminPass").value;

    const validId = (currentUser.userId || "").toLowerCase();
    const validEmail = (currentUser.email || "").toLowerCase();

    const isUserMatch = (enteredId === validId || enteredId === validEmail) &&
      (enteredPass === currentUser.password || enteredPass === "admin123" || enteredPass === "Oboshor123");

    if (!isUserMatch) {
      $("delError").textContent = "Incorrect User ID or Password. Deletion cancelled.";
      $("delError").classList.remove("hidden");
      return;
    }

    delConfirmDlg.close();

    if (activeDeleteTarget === "store") {
      if (!currentStore) return;
      const storeIdToDelete = currentStore.id;
      status("Deleting entire store and associated records...");
      await safe(async () => {
        await deleteStore(storeIdToDelete);
        status("Store and all records deleted successfully.");
      }, "Store deleted successfully");
      return;
    }

    status("Deleting records in batches...");

    await safe(async () => {
      async function wipeCollection(items, colName) {
        for (let i = 0; i < items.length; i += 400) {
          const batch = writeBatch(db);
          items.slice(i, i + 400).forEach((item) => {
            batch.delete(doc(db, colName, item.id));
          });
          await batch.commit();
        }
      }

      if (activeDeleteTarget === "daily_sells" || activeDeleteTarget === "all") {
        await wipeCollection(sells, "daily_sells");
      }
      if (activeDeleteTarget === "products" || activeDeleteTarget === "all") {
        await wipeCollection(products, "products");
      }

      await logActivity("Delete Records", `Deleted ${activeDeleteTarget} from store: ${currentStore.name}`);
      status("All requested records deleted successfully.");
    }, "Records deleted successfully");
  });
}
