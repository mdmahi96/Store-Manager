// ============================================================
// js/analytics.js - Visual Sales Analytics, Charts & KPIs
// Uses: Chart.js with Bangladeshi Taka (৳) formatting & tooltips
// ============================================================

import { $, money, sum, dateKey, pad, prettyDate } from "./config.js";
import { sells } from "./sells.js";

let chartInstance = null;
let currentChartPreset = "all";

export const getProfitPct = () => {
  try {
    return Number(localStorage.getItem("profitPct")) || 10;
  } catch {
    return 10;
  }
};

export function renderHome() {
  const now = new Date();
  const today = dateKey(now);
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const pct = getProfitPct();

  const inP = (p) => sum(sells.filter((s) => (s.date || "").startsWith(p)), (s) => s.totalSell);

  const tToday = inP(today);
  const tMonth = inP(month);
  const tYear = inP(year);
  const tAll = sum(sells, (s) => s.totalSell);

  if ($("mToday")) $("mToday").textContent = money(tToday);
  if ($("mTodaySub")) $("mTodaySub").textContent = `Est. Profit: ${money(tToday * pct / 100)}`;

  if ($("mMonth")) $("mMonth").textContent = money(tMonth);
  if ($("mMonthSub")) $("mMonthSub").textContent = `Est. Profit: ${money(tMonth * pct / 100)}`;

  if ($("mYear")) $("mYear").textContent = money(tYear);
  if ($("mYearSub")) $("mYearSub").textContent = `Est. Profit: ${money(tYear * pct / 100)}`;

  if ($("mAll")) $("mAll").textContent = money(tAll);
  if ($("mAllSub")) $("mAllSub").textContent = `${sells.length.toLocaleString()} total sales recorded`;

  renderChart();

  // Yearly Breakdown Table
  const yearRowsEl = $("yearRows");
  if (yearRowsEl) {
    const years = [...new Set(sells.map((s) => (s.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
    yearRowsEl.innerHTML = years.map((y) => {
      const rows = sells.filter((s) => (s.date || "").startsWith(y));
      const t = sum(rows, (s) => s.totalSell);
      const khoroch = sum(rows, (s) => s.khoroch);
      const due = sum(rows, (s) => s.due);
      const profit = t * pct / 100;
      return `
        <div class="row !px-0">
          <div>
            <p class="font-bold text-slate-800">${y}</p>
            <p class="text-xs text-slate-500">${rows.length} sales days · Avg ${money(t / (rows.length || 1))} / day</p>
            ${khoroch || due ? `<p class="text-[11px] text-slate-400">Expense: ${money(khoroch)} · Due: ${money(due)}</p>` : ""}
          </div>
          <div class="text-right">
            <p class="font-extrabold text-teal-800">${money(t)}</p>
            <p class="text-xs font-semibold text-emerald-700">Profit ≈ ${money(profit)}</p>
          </div>
        </div>`;
    }).join("") || `<p class="empty">No sales records in this store yet.</p>`;
  }
}

export function getChartDataSeries(range) {
  const now = new Date();
  const pct = getProfitPct();

  if (range === "last7" || range === "last14" || range === "last30") {
    const daysCount = range === "last7" ? 7 : (range === "last14" ? 14 : 30);
    const days = Array.from({ length: daysCount }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (daysCount - 1) + i);
      return d;
    });

    const labels = days.map((d) => `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`);
    const dateKeys = days.map(dateKey);

    const items = dateKeys.map((k) => {
      const match = sells.filter((s) => s.date === k);
      const totalSell = sum(match, (s) => s.totalSell);
      const morning = sum(match, (s) => s.morningAmount);
      const night = sum(match, (s) => s.nightAmount);
      const khoroch = sum(match, (s) => s.khoroch);
      const due = sum(match, (s) => s.due);
      const profit = totalSell * pct / 100;
      return { key: k, totalSell, morning, night, khoroch, due, profit, count: match.length };
    });

    return { labels, items };
  }

  if (range === "thisMonth") {
    const y = now.getFullYear();
    const m = now.getMonth();
    const currentDay = now.getDate();
    const days = Array.from({ length: currentDay }, (_, i) => new Date(y, m, i + 1));
    const labels = days.map((d) => `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`);
    const dateKeys = days.map(dateKey);

    const items = dateKeys.map((k) => {
      const match = sells.filter((s) => s.date === k);
      const totalSell = sum(match, (s) => s.totalSell);
      const morning = sum(match, (s) => s.morningAmount);
      const night = sum(match, (s) => s.nightAmount);
      const khoroch = sum(match, (s) => s.khoroch);
      const due = sum(match, (s) => s.due);
      const profit = totalSell * pct / 100;
      return { key: k, totalSell, morning, night, khoroch, due, profit, count: match.length };
    });

    return { labels, items };
  }

  if (range === "last3Months" || range === "last6Months") {
    const monthsBack = range === "last3Months" ? 3 : 6;
    const months = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
    }

    const labels = months.map((m) => {
      const [yr, mo] = m.split("-");
      return new Date(Number(yr), Number(mo) - 1).toLocaleString("en-GB", { month: "short", year: "2-digit" });
    });

    const items = months.map((m) => {
      const match = sells.filter((s) => (s.date || "").startsWith(m));
      const totalSell = sum(match, (s) => s.totalSell);
      const morning = sum(match, (s) => s.morningAmount);
      const night = sum(match, (s) => s.nightAmount);
      const khoroch = sum(match, (s) => s.khoroch);
      const due = sum(match, (s) => s.due);
      const profit = totalSell * pct / 100;
      return { key: m, totalSell, morning, night, khoroch, due, profit, count: match.length };
    });

    return { labels, items };
  }

  if (range === "thisYear") {
    const y = String(now.getFullYear());
    const months = Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`);
    const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const items = months.map((m) => {
      const match = sells.filter((s) => (s.date || "").startsWith(m));
      const totalSell = sum(match, (s) => s.totalSell);
      const morning = sum(match, (s) => s.morningAmount);
      const night = sum(match, (s) => s.nightAmount);
      const khoroch = sum(match, (s) => s.khoroch);
      const due = sum(match, (s) => s.due);
      const profit = totalSell * pct / 100;
      return { key: m, totalSell, morning, night, khoroch, due, profit, count: match.length };
    });

    return { labels, items };
  }

  // allYears
  const years = [...new Set(sells.map((s) => (s.date || "").slice(0, 4)).filter(Boolean))].sort();
  const labels = years.length ? years : [String(now.getFullYear())];
  const items = labels.map((yr) => {
    const match = sells.filter((s) => (s.date || "").startsWith(yr));
    const totalSell = sum(match, (s) => s.totalSell);
    const morning = sum(match, (s) => s.morningAmount);
    const night = sum(match, (s) => s.nightAmount);
    const khoroch = sum(match, (s) => s.khoroch);
    const due = sum(match, (s) => s.due);
    const profit = totalSell * pct / 100;
    return { key: yr, totalSell, morning, night, khoroch, due, profit, count: match.length };
  });

  return { labels, items };
}

export function renderChart() {
  const canvas = $("salesChart");
  if (!canvas || typeof Chart === "undefined") return;

  const rangeEl = $("chartRange");
  const metricEl = $("chartMetric");
  if (!rangeEl || !metricEl) return;

  const range = rangeEl.value;
  const metric = metricEl.value;
  const { labels, items } = getChartDataSeries(range);

  const periodSell = sum(items, (it) => it.totalSell);
  const periodProfit = sum(items, (it) => it.profit);
  const activeDays = items.filter((it) => it.totalSell > 0).length || 1;
  const dailyAvg = periodSell / activeDays;
  const peakDay = Math.max(...items.map((it) => it.totalSell), 0);

  if ($("kpiTotalSell")) $("kpiTotalSell").textContent = money(periodSell);
  if ($("kpiTotalProfit")) $("kpiTotalProfit").textContent = money(periodProfit);
  if ($("kpiDailyAvg")) $("kpiDailyAvg").textContent = money(dailyAvg);
  if ($("kpiPeakDay")) $("kpiPeakDay").textContent = money(peakDay);

  let datasets = [];
  let chartType = "bar";

  if (metric === "totalSell") {
    chartType = "bar";
    datasets = [{
      label: "Total Sell (৳)",
      data: items.map((x) => x.totalSell),
      backgroundColor: "rgba(13, 148, 136, 0.85)",
      borderColor: "#0f766e",
      borderWidth: 1.5,
      borderRadius: 6
    }];
  } else if (metric === "profit") {
    chartType = "line";
    datasets = [{
      label: "Estimated Profit (৳)",
      data: items.map((x) => x.profit),
      backgroundColor: "rgba(16, 185, 129, 0.15)",
      borderColor: "#10b981",
      borderWidth: 2.5,
      fill: true,
      tension: 0.35,
      pointRadius: 4,
      pointBackgroundColor: "#059669"
    }];
  } else if (metric === "compare") {
    chartType = "bar";
    datasets = [
      {
        type: "bar",
        label: "Total Sell (৳)",
        data: items.map((x) => x.totalSell),
        backgroundColor: "rgba(13, 148, 136, 0.75)",
        borderColor: "#0f766e",
        borderWidth: 1,
        borderRadius: 5
      },
      {
        type: "line",
        label: "Est. Profit (৳)",
        data: items.map((x) => x.profit),
        borderColor: "#f59e0b",
        borderWidth: 2.5,
        fill: false,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: "#d97706"
      }
    ];
  } else if (metric === "morningNight") {
    chartType = "bar";
    datasets = [
      {
        label: "Morning Amount (৳)",
        data: items.map((x) => x.morning),
        backgroundColor: "rgba(56, 189, 248, 0.75)",
        borderColor: "#0284c7",
        borderWidth: 1,
        borderRadius: 4
      },
      {
        label: "Night Amount (৳)",
        data: items.map((x) => x.night),
        backgroundColor: "rgba(99, 102, 241, 0.75)",
        borderColor: "#4f46e5",
        borderWidth: 1,
        borderRadius: 4
      }
    ];
  } else if (metric === "khorochDue") {
    chartType = "bar";
    datasets = [
      {
        label: "Expenses (৳)",
        data: items.map((x) => x.khoroch),
        backgroundColor: "rgba(239, 68, 68, 0.75)",
        borderColor: "#dc2626",
        borderWidth: 1,
        borderRadius: 4
      },
      {
        label: "Due Amount (৳)",
        data: items.map((x) => x.due),
        backgroundColor: "rgba(245, 158, 11, 0.75)",
        borderColor: "#d97706",
        borderWidth: 1,
        borderRadius: 4
      }
    ];
  }

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(canvas, {
    type: chartType,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: datasets.length > 1,
          position: "top",
          labels: { font: { family: "inherit", size: 12, weight: "bold" }, usePointStyle: true }
        },
        tooltip: {
          backgroundColor: "#0f172a",
          titleFont: { size: 13, weight: "bold" },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            title: (contexts) => {
              const idx = contexts[0]?.dataIndex;
              const it = items[idx];
              return it ? prettyDate(it.key) || it.key : "";
            },
            label: (ctx) => ` ${ctx.dataset.label || ""}: ${money(ctx.raw || 0)}`,
            afterBody: (contexts) => {
              const idx = contexts[0]?.dataIndex;
              const it = items[idx];
              if (!it) return [];
              const lines = [];
              if (metric !== "compare") {
                lines.push(`Total Sell: ${money(it.totalSell)}`);
                lines.push(`Est. Profit: ${money(it.profit)}`);
              }
              if (it.morning || it.night) lines.push(`Morning: ${money(it.morning)} | Night: ${money(it.night)}`);
              if (it.khoroch) lines.push(`Expense: ${money(it.khoroch)}`);
              if (it.due) lines.push(`Due: ${money(it.due)}`);
              return lines;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: "#64748b" } },
        y: {
          beginAtZero: true,
          grid: { color: "#f1f5f9" },
          ticks: { font: { size: 11 }, color: "#64748b", callback: (v) => "৳" + v.toLocaleString() }
        }
      }
    }
  });
}

export function setupAnalyticsListeners() {
  const pInput = $("profitPct");
  if (pInput) {
    pInput.value = getProfitPct();
    pInput.addEventListener("input", (e) => {
      try { localStorage.setItem("profitPct", e.target.value); } catch {}
      renderHome();
    });
  }

  // Preset buttons
  document.querySelectorAll("[data-chart-filter]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll("[data-chart-filter]").forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      const preset = e.target.dataset.chartFilter;
      currentChartPreset = preset;

      const rangeEl = $("chartRange");
      if (rangeEl) {
        if (preset === "daily") rangeEl.value = "last7";
        else if (preset === "weekly") rangeEl.value = "last14";
        else if (preset === "monthly") rangeEl.value = "last30";
        else if (preset === "yearly") rangeEl.value = "thisYear";
        else rangeEl.value = "allYears";
      }

      renderChart();
    });
  });

  $("chartRange")?.addEventListener("change", () => renderChart());
  $("chartMetric")?.addEventListener("change", () => renderChart());

  // Listen for sells updates or store changes
  document.addEventListener("sells-updated", () => renderHome());
  document.addEventListener("store-changed", () => renderHome());
}
