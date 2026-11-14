// ============================================================
// js/config.js - Firebase Initialization & Core Utilities
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, collection, doc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

// Firebase configuration for project "oboshor-store"
export const firebaseConfig = {
  apiKey: "AIzaSyBBU1DzXKqSPgNVR4HyYnjoxioMSx86hSg",
  authDomain: "oboshor-store.firebaseapp.com",
  projectId: "oboshor-store",
  storageBucket: "oboshor-store.firebasestorage.app",
  messagingSenderId: "855366223403",
  appId: "1:855366223403:web:ac809b607ca5d703764c6e",
  measurementId: "G-SLF57KZDTL"
};

export const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, { localCache: persistentLocalCache() });
export const auth = getAuth(app);

// Firestore Collections
export const usersCol = collection(db, "users");
export const storesCol = collection(db, "stores");
export const productsCol = collection(db, "products");
export const sellsCol = collection(db, "daily_sells");
export const logsCol = collection(db, "activity_logs");

// UI Selector Helper
export const $ = (id) => document.getElementById(id);

// Formatters
export const money = (n) => "৳" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const pad = (n) => String(n).padStart(2, "0");
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const sum = (arr, f) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);

export function parseDateObject(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val) ? null : val;
  if (val.toDate && typeof val.toDate === "function") return val.toDate();
  if (typeof val === "number") return new Date(val);
  const s = String(val).trim();
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

export function formatTimestamp(val) {
  const d = parseDateObject(val);
  if (!d) return "";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

export const prettyDate = (k) => {
  if (!k) return "";
  const d = new Date(k + "T12:00:00");
  return isNaN(d) ? k : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};

export function toast(msg, isErr = false) {
  const t = $("toast");
  if (!t) return;
  t.innerHTML = `<span>${isErr ? "⚠️" : "✅"}</span> <span>${esc(msg)}</span>`;
  t.className = `fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-white text-sm shadow-xl z-50 flex items-center gap-2 transition-all ${isErr ? "bg-red-700" : "bg-teal-900 border border-teal-700"}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add("hidden"), 3800);
}

export async function safe(fn, okMsg) {
  try {
    const res = await fn();
    if (okMsg) toast(okMsg);
    return res;
  } catch (e) {
    console.error(e);
    toast("Notice: " + (e.message || "Operation failed"), true);
  }
}

// Client IP telemetry
export let clientIp = "127.0.0.1";
export async function detectClientIp() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    if (res.ok) {
      const data = await res.json();
      if (data?.ip) clientIp = data.ip;
    }
  } catch {
    clientIp = "127.0.0.1 (Local)";
  }
}

// Activity Logging & Local Cache
export function getLocalLogs() {
  try {
    const raw = localStorage.getItem("sm_activity_logs");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function logActivity(action, details = "") {
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem("sm_auth_session_user") || sessionStorage.getItem("sm_auth_session_user") || "null");
  } catch {}

  const logEntry = {
    userId: user?.userId || "Guest",
    action,
    details,
    ip: clientIp || "127.0.0.1",
    timestamp: new Date().toISOString()
  };

  try {
    const local = getLocalLogs();
    local.unshift(logEntry);
    localStorage.setItem("sm_activity_logs", JSON.stringify(local.slice(0, 100)));
  } catch {}

  try {
    const { addDoc, Timestamp } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
    await addDoc(logsCol, { ...logEntry, timestamp: Timestamp.now() });
  } catch {}
}
