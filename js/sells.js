// ============================================================
// js/sells.js - Daily Sales Management Module
// Handles: Daily/Weekly/Monthly/Yearly Filters, Sorting, Live Totals
// ============================================================

import { sellsCol, $, money, esc, formatTimestamp, prettyDate, dateKey, sum, pad, toast, safe } from "./config.js";
import { onSnapshot, addDoc, updateDoc, deleteDoc, doc, Timestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { currentStore } from "./stores.js";

export let allSells = [];
export let storeSells = [];
export { storeSells as sells, filterStoreSells as bindSells };
let sLimit = 50;
let editSellId = null;
let currentSellFilterPreset = "all";

const sellDlg = $("sDialog");

export function filterStoreSells() {
  if (!currentStore) {
    storeSells = [];
    buildFilters();
    renderSells();
    return;
  }

  const sId = currentStore.id;
  const isOboshor = sId === "oboshor_store";

  storeSells = allSells.filter((s) => s.storeId === sId || (isOboshor && !s.storeId));
  buildFilters();
  renderSells();
}

export function buildFilters() {
  if (!$("fYear") || !$("fMonth")) return;

  const years = [...new Set(storeSells.map((s) => (s.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const cy = $("fYear").value;
  const cm = $("fMonth").value;

  $("fYear").innerHTML = `<option value="">All years</option>` + years.map((y) => `<option value="${y}">${y}</option>`).join("");
  $("fMonth").innerHTML = `<option value="">All months</option>` + Array.from({ length: 12 }, (_, i) =>
    `<option value="${pad(i + 1)}">${new Date(2000, i).toLocaleString("en-GB", { month: "long" })}</option>`).join("");

  $("fYear").value = cy;
  $("fMonth").value = cm;
}

const filteredSells = () => {
  const y = $("fYear")?.value || "";
  const m = $("fMonth")?.value || "";
  const q = ($("sSearch")?.value || "").trim().toLowerCase();
  const now = new Date();
  const today = dateKey(now);

  let list = storeSells.filter((s) => {
    if (currentSellFilterPreset === "today" && s.date !== today) return false;
    if (currentSellFilterPreset === "week") {
      const d = new Date(s.date + "T12:00:00");
      const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
      if (diffDays < 0 || diffDays > 7) return false;
    }
    if (y && !(s.date || "").startsWith(y)) return false;
    if (m && (s.date || "").slice(5, 7) !== m) return false;
    if (q) {
      const matchNote = (s.notes || "").toLowerCase().includes(q);
      const matchDate = (s.date || "").includes(q);
      if (!matchNote && !matchDate) return false;
    }
    return true;
  });

  const sort = $("sSort")?.value || "date_desc";
  list.sort((a, b) => {
    if (sort === "date_desc") return (b.date || "").localeCompare(a.date || "") || (b.seq || 0) - (a.seq || 0);
    if (sort === "date_asc") return (a.date || "").localeCompare(b.date || "") || (a.seq || 0) - (b.seq || 0);
    if (sort === "sell_desc") return (b.totalSell || 0) - (a.totalSell || 0);
    if (sort === "sell_asc") return (a.totalSell || 0) - (b.totalSell || 0);
    if (sort === "khoroch_desc") return (b.khoroch || 0) - (a.khoroch || 0);
    if (sort === "due_desc") return (b.due || 0) - (a.due || 0);
    return 0;
  });

  return list;
};

export function renderSells() {
  if (!$("sellRows")) return;

  const list = filteredSells();
  const total = sum(list, (s) => s.totalSell);
  const totalKhoroch = sum(list, (s) => s.khoroch);
  const totalDue = sum(list, (s) => s.due);

  if ($("sellSummary")) {
    $("sellSummary").textContent = `${list.length.toLocaleString()} records · Total Sell: ${money(total)}${totalKhoroch ? " · Khoroch: " + money(totalKhoroch) : ""}${totalDue ? " · Due: " + money(totalDue) : ""}`;
  }

  $("sellRows").innerHTML = list.slice(0, sLimit).map((s) => {
    const timestampFormatted = formatTimestamp(s.createdAt || s.timestamp || s.seq);
    return `
      <div class="row">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="font-bold text-slate-800 text-sm md:text-base">${prettyDate(s.date)}</p>
            ${timestampFormatted ? `<span class="badge badge-stone text-[10px]" title="Record Timestamp">🕒 ${esc(timestampFormatted)}</span>` : ""}
          </div>
          <p class="text-xs text-slate-500 mt-1">
            Morning ${money(s.morningAmount)} → Night ${money(s.nightAmount)}
            ${s.khoroch ? `<span class="text-red-700 font-medium"> · Khoroch ${money(s.khoroch)}</span>` : ""}
            ${s.due ? `<span class="text-amber-700 font-medium"> · Due ${money(s.due)}</span>` : ""}
            ${s.notes ? ` · <span class="italic text-slate-600 font-medium">"${esc(s.notes)}"</span>` : ""}
          </p>
        </div>
        <div class="text-right shrink-0">
          <p class="font-extrabold text-teal-800 text-base">${money(s.totalSell)}</p>
          <div class="acts">
            <button data-act="edit" data-id="${s.id}">Edit</button>
            <button class="del" data-act="del" data-id="${s.id}">Delete</button>
          </div>
        </div>
      </div>`;
  }).join("") || `<p class="empty">No daily sells match your filters. Tap "+ Add Daily Sell" to create one.</p>`;

  $("moreSells")?.classList.toggle("hidden", list.length <= sLimit);
}

const updateTotalSellCalc = () => {
  const m = Number($("sMorning")?.value) || 0;
  const n = Number($("sNight")?.value) || 0;
  if ($("sTotal")) $("sTotal").textContent = money(n - m);
};

export function openSell(s = null) {
  editSellId = s?.id || null;
  $("sTitle").textContent = s ? "Edit Daily Sell" : "Add Daily Sell";
  $("sDate").value = s?.date || dateKey(new Date());
  $("sMorning").value = s?.morningAmount ?? "";
  $("sNight").value = s?.nightAmount ?? "";
  $("sKhoroch").value = s?.khoroch ?? 0;
  $("sDue").value = s?.due ?? 0;
  $("sNotes").value = s?.notes || "";
  updateTotalSellCalc();
  sellDlg?.showModal();
}

export function setupSellListeners() {
  onSnapshot(sellsCol, (snap) => {
    allSells = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    filterStoreSells();
  }, () => filterStoreSells());

  ["sMorning", "sNight"].forEach((id) => $(id)?.addEventListener("input", updateTotalSellCalc));

  // Preset buttons
  document.querySelectorAll(".sell-filter-preset").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".sell-filter-preset").forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      currentSellFilterPreset = e.target.dataset.preset;

      const now = new Date();
      if (currentSellFilterPreset === "today" || currentSellFilterPreset === "month") {
        $("fYear").value = String(now.getFullYear());
        $("fMonth").value = pad(now.getMonth() + 1);
      } else if (currentSellFilterPreset === "year") {
        $("fYear").value = String(now.getFullYear());
        $("fMonth").value = "";
      } else if (currentSellFilterPreset === "all") {
        $("fYear").value = "";
        $("fMonth").value = "";
      }

      sLimit = 50;
      renderSells();
    });
  });

  $("sSort")?.addEventListener("change", renderSells);
  ["fYear", "fMonth"].forEach((id) => $(id)?.addEventListener("change", () => {
    sLimit = 50;
    renderSells();
  }));

  $("sSearch")?.addEventListener("input", () => {
    sLimit = 50;
    renderSells();
  });

  $("moreSells")?.addEventListener("click", () => {
    sLimit += 50;
    renderSells();
  });

  $("addSell")?.addEventListener("click", () => openSell());

  $("sellForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const morning = Number($("sMorning").value) || 0;
    const night = Number($("sNight").value) || 0;
    const now = new Date();
    const ts = Timestamp.fromDate(now);

    const data = {
      storeId: currentStore.id,
      date: $("sDate").value,
      morningAmount: morning,
      nightAmount: night,
      totalSell: night - morning,
      khoroch: Number($("sKhoroch").value) || 0,
      due: Number($("sDue").value) || 0,
      notes: $("sNotes").value.trim()
    };

    const id = editSellId;
    safe(async () => {
      if (id) {
        await updateDoc(doc(sellsCol, id), {
          ...data,
          updatedAt: ts,
          updatedAtFormatted: formatTimestamp(now)
        });
      } else {
        await addDoc(sellsCol, {
          ...data,
          seq: Date.now(),
          createdAt: ts,
          timestamp: ts,
          createdAtFormatted: formatTimestamp(now)
        });
      }
    }, id ? "Daily sell record updated" : "Daily sell record added with timestamp");

    sellDlg?.close();
  });

  $("sellRows")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const { act, id } = btn.dataset;
    const s = storeSells.find((x) => x.id === id);
    if (!s) return;

    if (act === "edit") openSell(s);
    if (act === "del") {
      if (confirm(`Delete the daily sell record of ${prettyDate(s.date)} (${money(s.totalSell)})?`)) {
        safe(async () => {
          await deleteDoc(doc(sellsCol, id));
        }, "Daily sell deleted");
      }
    }
  });
}

