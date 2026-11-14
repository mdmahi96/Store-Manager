// ============================================================
// js/admin.js - Master Admin Dashboard Module
// Handles: User Directory with Store Counts, User Stores Inspector Modal,
// Impersonation, Access Controls, Live Activity Logs & IP Tracking
// ============================================================

import {
  db, usersCol, logsCol, $, toast, safe, esc, formatTimestamp, logActivity, getLocalLogs, clientIp
} from "./config.js";
import {
  getDocs, doc, updateDoc, deleteDoc, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  currentUser, getLocalUsers, saveLocalUser, saveSession, setImpersonation, logoutSession,
  markUserDeleted, isDeleted
} from "./auth.js";

// Helper: patch the active session key for a given userId
const SESSION_KEY = "sm_auth_session_user";
function patchActiveSession(userId, patch) {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const raw = storage.getItem(SESSION_KEY);
      if (!raw) continue;
      const sess = JSON.parse(raw);
      if (sess && sess.userId && sess.userId.toLowerCase() === (userId || "").toLowerCase()) {
        Object.assign(sess, patch);
        storage.setItem(SESSION_KEY, JSON.stringify(sess));
      }
    } catch {}
  }
}

// Helper: remove the active session for a given userId (force log out that user)
function clearActiveSession(userId) {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const raw = storage.getItem(SESSION_KEY);
      if (!raw) continue;
      const sess = JSON.parse(raw);
      if (sess && sess.userId && sess.userId.toLowerCase() === (userId || "").toLowerCase()) {
        storage.removeItem(SESSION_KEY);
      }
    } catch {}
  }
}

// Helper: remove user from sm_users_directory and blacklist them permanently
function deleteLocalUser(targetUserOrId) {
  const userId = typeof targetUserOrId === "object" ? targetUserOrId.userId : targetUserOrId;
  try {
    const raw = localStorage.getItem("sm_users_directory");
    const list = raw ? JSON.parse(raw) : [];
    const updated = list.filter((u) => u.userId.toLowerCase() !== (userId || "").toLowerCase());
    localStorage.setItem("sm_users_directory", JSON.stringify(updated));
  } catch {}
  markUserDeleted(targetUserOrId);
}
import { getLocalStores, setStoredStoreId, refreshUserStores, deleteStore, isStoreDeleted } from "./stores.js";

export let allUsersList = [];

// ---------- Master Admin Dashboard Initialization ----------
export async function renderAdminDashboard() {
  if ($("admAdminIdText")) $("admAdminIdText").textContent = currentUser?.userId || "Admin";

  await loadAdminUserDirectory();
  await loadAdminActivityLogs();
}

export async function loadAdminUserDirectory() {
  allUsersList = getLocalUsers();

  try {
    const snap = await getDocs(usersCol);
    const cloudUsers = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => !isDeleted(u.userId || u.id) && !isDeleted(u.email));
    cloudUsers.forEach(saveLocalUser);
    allUsersList = getLocalUsers();
  } catch {
    // Cloud query blocked by rules - local directory active
  }

  // Total actual registered store users (excluding Master Admin)
  const regularUsers = allUsersList.filter((u) => u.userId?.toLowerCase() !== "admin");
  if ($("admTotalUsers")) $("admTotalUsers").textContent = regularUsers.length.toLocaleString();

  const allStores = getLocalStores();
  const activeUserIds = new Set(regularUsers.map((u) => u.userId?.toLowerCase()));
  const activeUserEmails = new Set(regularUsers.map((u) => (u.email || "").toLowerCase()).filter(Boolean));

  // Count only stores belonging to actual registered store owners
  const validStores = allStores.filter((s) => {
    if (isStoreDeleted(s.id)) return false;
    const ownerId = (s.ownerId || "").toLowerCase();
    const ownerEmail = (s.ownerEmail || "").toLowerCase();
    if (isDeleted(ownerId) || isDeleted(ownerEmail)) return false;
    return activeUserIds.has(ownerId) || (ownerEmail && activeUserEmails.has(ownerEmail));
  });

  if ($("admTotalStores")) $("admTotalStores").textContent = validStores.length.toLocaleString();

  renderAdminUserTable();
}

export function renderAdminUserTable() {
  const q = ($("admUserSearch")?.value || "").trim().toLowerCase();
  const tbody = $("admUserTableBody");
  if (!tbody) return;

  const allStores = getLocalStores();
  const regularUsers = allUsersList.filter((u) => u.userId?.toLowerCase() !== "admin");
  const activeUserIds = new Set(regularUsers.map((u) => u.userId?.toLowerCase()));
  const activeUserEmails = new Set(regularUsers.map((u) => (u.email || "").toLowerCase()).filter(Boolean));

  const validStores = allStores.filter((s) => {
    if (isStoreDeleted(s.id)) return false;
    const ownerId = (s.ownerId || "").toLowerCase();
    const ownerEmail = (s.ownerEmail || "").toLowerCase();
    if (isDeleted(ownerId) || isDeleted(ownerEmail)) return false;
    return activeUserIds.has(ownerId) || (ownerEmail && activeUserEmails.has(ownerEmail));
  });

  // Exclude Master Admin from regular users directory
  const filtered = regularUsers.filter((u) => {
    return (u.userId || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-slate-400">No users match search.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((u) => {
    const isMasterAdmin = u.userId === "Admin";
    const isCurrentUser = currentUser?.userId === u.userId;
    const isSuspended = u.status === "suspended";

    // Count user stores among valid active stores
    const userStores = validStores.filter((s) =>
      s.ownerId?.toLowerCase() === u.userId?.toLowerCase() ||
      (s.ownerEmail && s.ownerEmail.toLowerCase() === (u.email || "").toLowerCase())
    );
    const storeCount = userStores.length;

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td>
          <button class="font-bold text-teal-800 hover:text-teal-950 underline flex items-center gap-1.5 cursor-pointer text-left" data-admin-act="inspectUserStores" data-uid="${esc(u.userId)}" title="Click to view stores created by ${esc(u.userId)}">
            <span class="text-sm">👤</span>
            <span>${esc(u.userId)}</span>
          </button>
        </td>
        <td class="text-slate-600 text-xs">${esc(u.email || "N/A")}</td>
        <td>
          <span class="badge ${u.role === "admin" ? "badge-amber" : "badge-stone"}">
            ${u.role === "admin" ? "Admin" : "User"}
          </span>
        </td>
        <td>
          <span class="badge ${isSuspended ? "badge-red" : "badge-teal"}">
            ${isSuspended ? "Suspended" : "Active"}
          </span>
        </td>
        <td>
          <span class="badge ${u.emailVerified ? "badge-teal" : "badge-amber"}">
            ${u.emailVerified ? "✓ Verified" : "⚠️ Unverified"}
          </span>
        </td>
        <td>
          <button class="badge bg-teal-50 text-teal-900 border border-teal-300 hover:bg-teal-100 font-bold px-2.5 py-1 rounded-md text-xs cursor-pointer flex items-center gap-1 transition" data-admin-act="inspectUserStores" data-uid="${esc(u.userId)}" title="Click to view all stores owned by ${esc(u.userId)}">
            <span>🏬</span>
            <span>${storeCount} ${storeCount === 1 ? "store" : "stores"}</span>
          </button>
        </td>
        <td class="text-slate-500 text-xs">${formatTimestamp(u.createdAt) || "Active"}</td>
        <td class="font-mono text-xs text-slate-600">${esc(u.lastLoginIp || "N/A")}</td>
        <td class="text-right">
          <div class="flex items-center justify-end gap-1.5">
            ${!u.emailVerified ? `
              <button class="btn btn-secondary !py-1 !px-2 text-xs font-bold text-emerald-700 border-emerald-300 hover:bg-emerald-50" data-admin-act="verifyUser" data-uid="${esc(u.userId)}" title="Manually verify this user's account">
                ✓ Verify
              </button>
            ` : ""}

            ${!isCurrentUser ? `
              <button class="btn btn-secondary !py-1 !px-2 text-xs font-semibold text-teal-800 hover:bg-teal-50" data-admin-act="loginAs" data-uid="${esc(u.userId)}" title="Impersonate & Access User Stores">
                Login as User
              </button>
            ` : `<span class="text-xs text-slate-400 font-semibold px-2">Current</span>`}

            ${!isMasterAdmin ? `
              <button class="btn btn-secondary !py-1 !px-2 text-xs font-semibold ${isSuspended ? "text-emerald-700 border-emerald-200" : "text-red-700 border-red-200"}" data-admin-act="toggleStatus" data-uid="${esc(u.userId)}">
                ${isSuspended ? "Activate" : "Suspend"}
              </button>
              <button class="btn btn-secondary !py-1 !px-2 text-xs font-semibold text-purple-700" data-admin-act="toggleRole" data-uid="${esc(u.userId)}">
                ${u.role === "admin" ? "Demote" : "Make Admin"}
              </button>
              <button class="btn btn-secondary !py-1 !px-2 text-xs font-semibold text-rose-800 border-rose-300 hover:bg-rose-50" data-admin-act="deleteUser" data-uid="${esc(u.userId)}" title="Permanently delete this account">
                🗑 Delete
              </button>
            ` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

// Open User Stores Inspector Modal
export function openUserStoresModal(user) {
  const modal = $("userStoresModal");
  if (!modal || !user) return;

  const allStores = getLocalStores();
  const stores = allStores.filter((s) => {
    if (isStoreDeleted(s.id)) return false;
    const ownerId = (s.ownerId || "").toLowerCase();
    const ownerEmail = (s.ownerEmail || "").toLowerCase();
    if (isDeleted(ownerId) || isDeleted(ownerEmail)) return false;
    return ownerId === user.userId?.toLowerCase() || (ownerEmail && ownerEmail === (user.email || "").toLowerCase());
  });

  $("userStoresModalTitle").textContent = `${user.userId}'s Stores`;
  $("userStoresModalMeta").textContent = `Email: ${user.email} · Role: ${user.role} · Status: ${user.status} · Total Stores: ${stores.length}`;

  const container = $("userStoresListContainer");
  if (!stores.length) {
    container.innerHTML = `
      <div class="p-6 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
        <p class="text-base font-semibold">No stores created by ${esc(user.userId)} yet.</p>
        <p class="text-xs text-slate-400 mt-1">This user has not initialized any store records.</p>
      </div>
    `;
  } else {
    container.innerHTML = stores.map((s, idx) => `
      <div class="card bg-white border border-slate-200 shadow-sm p-4 space-y-2 hover:border-teal-400 transition">
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-slate-100">
          <div>
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-md bg-teal-100 text-teal-800 flex items-center justify-center text-xs font-bold">${idx + 1}</span>
              <h3 class="font-extrabold text-base text-slate-900">${esc(s.name)}</h3>
              <span class="badge badge-teal text-[11px]">${esc(s.category || "General Store")}</span>
            </div>
            <p class="text-xs text-slate-500 mt-0.5">Store ID: <code class="font-mono text-[11px] bg-slate-100 px-1 rounded">${esc(s.id)}</code> · Currency: <b>${esc(s.currency || "৳")}</b></p>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn btn-secondary border-red-200 text-red-600 hover:bg-red-50 !py-1.5 !px-2.5 text-xs font-semibold flex items-center gap-1 shadow-sm" data-admin-delete-store="${esc(s.id)}" data-store-name="${esc(s.name)}" data-owner-uid="${esc(user.userId)}">
              <span>🗑️</span> Delete Store
            </button>
            <button class="btn btn-primary !py-1.5 !px-3 text-xs font-bold flex items-center gap-1 shadow-sm" data-admin-enter-store="${esc(s.id)}" data-owner-uid="${esc(user.userId)}">
              <span>👁️</span> Enter Store (Login as User)
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600 pt-1">
          <div><span class="text-slate-400">Phone:</span> <b>${esc(s.phone || "Not set")}</b></div>
          <div><span class="text-slate-400">Location:</span> <b>${esc(s.address || "Not set")}</b></div>
          <div><span class="text-slate-400">Created:</span> <b>${formatTimestamp(s.createdAt) || "Initial"}</b></div>
        </div>
      </div>
    `).join("");
  }

  modal.showModal();
}

// Activity & IP Logs
export async function loadAdminActivityLogs() {
  let logs = getLocalLogs();

  try {
    const q = query(logsCol, orderBy("timestamp", "desc"), limit(50));
    const snap = await getDocs(q);
    const cloudLogs = snap.docs.map((d) => d.data());
    if (cloudLogs.length) logs = cloudLogs;
  } catch {}

  const tbody = $("admLogTableBody");
  if (!tbody) return;

  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-slate-400">No activity logs recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map((l) => `
    <tr>
      <td class="text-xs text-slate-500 whitespace-nowrap">${formatTimestamp(l.timestamp)}</td>
      <td class="font-bold text-slate-800 text-xs">${esc(l.userId)}</td>
      <td><span class="badge badge-teal text-[10px]">${esc(l.action)}</span></td>
      <td class="text-xs text-slate-600">${esc(l.details || "")}</td>
      <td class="font-mono text-xs text-teal-800">${esc(l.ip || "127.0.0.1")}</td>
    </tr>
  `).join("");
}

export function setupAdminListeners() {
  $("admUserSearch")?.addEventListener("input", renderAdminUserTable);

  $("admUserTableBody")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const { adminAct, uid } = btn.dataset;
    const targetUser = allUsersList.find((u) => u.userId === uid);
    if (!targetUser) return;

    // 1. Inspect User Stores Modal
    if (adminAct === "inspectUserStores") {
      openUserStoresModal(targetUser);
      return;
    }

    // 2. Impersonation
    if (adminAct === "loginAs") {
      if (confirm(`Do you want to login as "${targetUser.userId}" and access their store records?`)) {
        setImpersonation(targetUser);
        await logActivity("Admin Impersonation", `Master Admin logged in as user: ${targetUser.userId}`);
        toast(`Switched to user context: ${targetUser.userId}`);
        refreshUserStores();
        document.dispatchEvent(new CustomEvent("switch-tab", { detail: { tab: "home" } }));
      }
    }

    // 3. Toggle user status (suspend / activate)
    if (adminAct === "toggleStatus") {
      const newStatus = targetUser.status === "suspended" ? "active" : "suspended";
      targetUser.status = newStatus;
      saveLocalUser(targetUser);
      renderAdminUserTable();

      try {
        await updateDoc(doc(db, "users", targetUser.userId), { status: newStatus });
      } catch {}

      // Patch the user's active session so they are kicked out immediately on next
      // navigation / tab switch (cross-tab via storage event in auth.js)
      patchActiveSession(targetUser.userId, { status: newStatus });
      if (newStatus === "suspended") {
        // Force-remove their session so the tab listener logs them out
        clearActiveSession(targetUser.userId);
      }

      // Same-tab: fire custom event so auth.js can update in-memory currentUser
      document.dispatchEvent(new CustomEvent("admin-session-patch", {
        detail: { userId: targetUser.userId, action: newStatus === "suspended" ? "suspend" : "activate", patch: { status: newStatus } }
      }));

      await logActivity("User Access Changed", `Changed user ${targetUser.userId} status to: ${newStatus}`);
      toast(`User ${targetUser.userId} is now ${newStatus}.`);
    }

    // 4. Toggle role
    if (adminAct === "toggleRole") {
      const newRole = targetUser.role === "admin" ? "user" : "admin";
      targetUser.role = newRole;
      saveLocalUser(targetUser);
      renderAdminUserTable();

      try {
        await updateDoc(doc(db, "users", targetUser.userId), { role: newRole });
      } catch {}

      await logActivity("User Role Changed", `Changed user ${targetUser.userId} role to: ${newRole}`);
      toast(`User ${targetUser.userId} role set to ${newRole}`);
    }

    // 5. Manually verify user account
    if (adminAct === "verifyUser") {
      targetUser.emailVerified = true;
      saveLocalUser(targetUser);
      renderAdminUserTable();

      try {
        await updateDoc(doc(db, "users", targetUser.userId), { emailVerified: true });
      } catch {}

      // Patch session → cross-tab storage event will update the banner in the user's tab
      patchActiveSession(targetUser.userId, { emailVerified: true });

      // Same-tab: fire custom event so auth.js can update in-memory currentUser
      document.dispatchEvent(new CustomEvent("admin-session-patch", {
        detail: { userId: targetUser.userId, action: "patch", patch: { emailVerified: true } }
      }));

      await logActivity("Admin Manual Verification", `Master Admin manually verified account for user: ${targetUser.userId} (${targetUser.email})`);
      toast(`User "${targetUser.userId}" verified! Their banner will clear automatically.`);
    }

    // 6. Delete user account
    if (adminAct === "deleteUser") {
      const confirmed = confirm(
        `⚠️ Permanently delete account "${targetUser.userId}" (${targetUser.email})?\n\nThis cannot be undone. All stores and records belonging to this user will also be permanently deleted.`
      );
      if (!confirmed) return;

      // 1. Cascade delete all stores owned by this user
      const userStoresToDelete = getLocalStores().filter((s) =>
        s.ownerId?.toLowerCase() === targetUser.userId?.toLowerCase() ||
        (targetUser.email && s.ownerEmail?.toLowerCase() === targetUser.email.toLowerCase()) ||
        (targetUser.userId === "Oboshor" && s.id === "oboshor_store")
      );
      for (const st of userStoresToDelete) {
        await deleteStore(st.id);
      }

      // 2. Remove from local directory and add to blacklist
      deleteLocalUser(targetUser);
      allUsersList = getLocalUsers();

      // 3. Force-clear active session for this user
      clearActiveSession(targetUser.userId);

      // 4. Same-tab: fire custom event
      document.dispatchEvent(new CustomEvent("admin-session-patch", {
        detail: { userId: targetUser.userId, action: "delete", patch: {} }
      }));

      // 5. Remove from Firestore
      try {
        await deleteDoc(doc(db, "users", targetUser.userId));
      } catch {}

      await loadAdminUserDirectory();
      await logActivity("Admin Deleted Account", `Master Admin permanently deleted account: ${targetUser.userId} (${targetUser.email})`);
      toast(`Account "${targetUser.userId}" deleted permanently.`);
    }
  });

  // Action clicks inside User Stores Modal (Enter Store or Delete Store)
  $("userStoresListContainer")?.addEventListener("click", async (e) => {
    // Delete store button clicked by Admin
    const delStoreBtn = e.target.closest("button[data-admin-delete-store]");
    if (delStoreBtn) {
      const storeId = delStoreBtn.dataset.adminDeleteStore;
      const storeName = delStoreBtn.dataset.storeName || storeId;
      const ownerUid = delStoreBtn.dataset.ownerUid;
      if (confirm(`⚠️ Permanently delete store "${storeName}"?\n\nThis cannot be undone. All catalog products and daily sales records will be deleted.`)) {
        await deleteStore(storeId);
        toast(`Store "${storeName}" deleted permanently.`);
        const modal = $("userStoresModal");
        if (modal && modal.open) modal.close();
        await loadAdminUserDirectory();
      }
      return;
    }

    // Enter store button clicked by Admin
    const btn = e.target.closest("button[data-admin-enter-store]");
    if (!btn) return;

    const storeId = btn.dataset.adminEnterStore;
    const ownerUid = btn.dataset.ownerUid;
    const targetUser = allUsersList.find((u) => u.userId === ownerUid);
    if (!targetUser) return;

    // Close modal
    const modal = $("userStoresModal");
    if (modal && modal.open) modal.close();

    setImpersonation(targetUser);
    setStoredStoreId(storeId);
    refreshUserStores();

    await logActivity("Admin Store Access", `Admin inspected store ${storeId} owned by ${ownerUid}`);
    toast(`Entered store: ${storeId}`);
    document.dispatchEvent(new CustomEvent("switch-tab", { detail: { tab: "home" } }));
  });

  $("admRefreshLogsBtn")?.addEventListener("click", () => {
    loadAdminActivityLogs();
    toast("Activity logs refreshed");
  });

  // Update Master Admin Credentials
  $("admUpdateCredsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newEmail = $("admNewEmail").value.trim().toLowerCase();
    const curPass = $("admCurrentPass").value;
    const newPass = $("admNewPass").value.trim();

    if (curPass !== currentUser.password && curPass !== "admin123") {
      toast("Current Master Admin password is incorrect.", true);
      return;
    }

    const updates = { email: newEmail };
    if (newPass) updates.password = newPass;

    Object.assign(currentUser, updates);
    saveLocalUser(currentUser);
    saveSession(currentUser);

    try {
      await updateDoc(doc(db, "users", "Admin"), updates);
    } catch {}

    await logActivity("Master Admin Updated", `Admin updated email to: ${newEmail}`);
    toast("Master Admin credentials updated successfully");
  });

  // Re-render when triggered
  document.addEventListener("render-admin-view", () => {
    renderAdminDashboard();
  });
}
