// ============================================================
// js/stores.js - Multi-Store Management Module
// Handles: Store Switching, Store Creation, Store Settings
// ============================================================

import { db, storesCol, productsCol, sellsCol, $, toast, safe, logActivity } from "./config.js";
import {
  onSnapshot, setDoc, updateDoc, deleteDoc, doc, Timestamp, query, where, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { currentUser, getLocalUsers, isDeleted } from "./auth.js";
import { sendInviteSentEmail, sendInviteReceivedEmail } from "./email.js";

export let currentStore = null;
export let userStores = [];

export const DEFAULT_STORES = [
  {
    id: "oboshor_store",
    name: "Oboshor Varieties Store",
    category: "Varieties Store",
    ownerId: "Oboshor",
    ownerEmail: "oboshor24@gmail.com",
    phone: "01700000000",
    address: "Store Location",
    currency: "৳",
    collaborators: [],
    createdAt: "2024-10-04T00:00:00.000Z"
  }
];

// ── Deleted Stores Blacklist ──────────────────────────────────
const DELETED_STORES_KEY = "sm_deleted_stores";

export function getDeletedStoreIds() {
  try {
    const raw = localStorage.getItem(DELETED_STORES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function markStoreDeleted(storeId) {
  if (!storeId) return;
  const list = getDeletedStoreIds();
  if (!list.includes(storeId)) {
    list.push(storeId);
    localStorage.setItem(DELETED_STORES_KEY, JSON.stringify(list));
  }
}

export function isStoreDeleted(storeId) {
  if (!storeId) return false;
  return getDeletedStoreIds().includes(storeId);
}
// ──────────────────────────────────────────────────────────────

export function getLocalStores() {
  try {
    const raw = localStorage.getItem("sm_stores_directory");
    const list = raw ? JSON.parse(raw) : [];
    DEFAULT_STORES.forEach((def) => {
      // Do not inject default store if its owner is deleted or store is deleted
      if (isDeleted(def.ownerId) || isDeleted(def.ownerEmail) || isStoreDeleted(def.id)) return;
      if (!list.some((s) => s.id === def.id)) {
        list.push(def);
      }
    });
    const deleted = getDeletedStoreIds();
    const filtered = list.filter((s) => {
      if (deleted.includes(s.id) || isStoreDeleted(s.id)) return false;
      if (isDeleted(s.ownerId) || isDeleted(s.ownerEmail)) return false;
      return true;
    });

    // Auto-clean sm_stores_directory if deleted or orphaned stores were present
    if (filtered.length !== list.length) {
      localStorage.setItem("sm_stores_directory", JSON.stringify(filtered));
    }
    return filtered;
  } catch {
    return DEFAULT_STORES.filter((s) => !isStoreDeleted(s.id) && !isDeleted(s.ownerId) && !isDeleted(s.ownerEmail));
  }
}

export function saveLocalStore(store) {
  if (!store || isStoreDeleted(store.id) || isDeleted(store.ownerId) || isDeleted(store.ownerEmail)) return;
  const list = getLocalStores();
  const idx = list.findIndex((s) => s.id === store.id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...store };
  } else {
    list.push(store);
  }
  localStorage.setItem("sm_stores_directory", JSON.stringify(list));
}

export function getStoredStoreId() {
  return localStorage.getItem("sm_active_store_" + (currentUser?.userId || "guest"));
}

export function setStoredStoreId(id) {
  if (currentUser) {
    localStorage.setItem("sm_active_store_" + currentUser.userId, id);
  }
}

export async function deleteStore(storeId) {
  if (!storeId || !currentUser) return;
  const allStores = getLocalStores();
  const storeToDelete = allStores.find((s) => s.id === storeId) || currentStore;
  const storeName = storeToDelete?.name || storeId;

  // 1. Mark store blacklisted
  markStoreDeleted(storeId);

  // 2. Remove from local store directory
  try {
    const raw = localStorage.getItem("sm_stores_directory");
    const list = raw ? JSON.parse(raw) : [];
    const updated = list.filter((s) => s.id !== storeId);
    localStorage.setItem("sm_stores_directory", JSON.stringify(updated));
  } catch {}

  // 3. Delete store doc from Firestore
  try {
    await deleteDoc(doc(storesCol, storeId));
  } catch {}

  // 4. Batch delete sells in Firestore
  try {
    const sellsQ = query(sellsCol, where("storeId", "==", storeId));
    const snap = await getDocs(sellsQ);
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch {}

  // 5. Batch delete products in Firestore
  try {
    const prodsQ = query(productsCol, where("storeId", "==", storeId));
    const snap = await getDocs(prodsQ);
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch {}

  // 6. Clear active store ID if it matches
  if (getStoredStoreId() === storeId) {
    localStorage.removeItem("sm_active_store_" + (currentUser?.userId || "guest"));
  }

  // 7. Refresh user stores
  const freshList = getLocalStores();
  const remaining = freshList.filter((s) =>
    s.ownerId?.toLowerCase() === currentUser.userId?.toLowerCase() ||
    s.ownerEmail?.toLowerCase() === currentUser.email?.toLowerCase() ||
    (Array.isArray(s.collaborators) && s.collaborators.some((c) =>
      c.userId?.toLowerCase() === currentUser.userId?.toLowerCase() ||
      c.email?.toLowerCase() === currentUser.email?.toLowerCase()
    ))
  );

  if (remaining.length > 0) {
    currentStore = remaining[0];
    setStoredStoreId(currentStore.id);
    refreshUserStores(freshList);
    toast(`Store "${storeName}" deleted permanently. Switched to "${currentStore.name}".`);
  } else {
    // If user has no remaining stores, initialize a clean default store
    await createInitialStoreForUser(currentUser, `${currentUser.userId}'s Store`);
    toast(`Store "${storeName}" deleted permanently. A fresh store has been created for you.`);
  }

  await logActivity("Delete Store", `Permanently deleted store: ${storeName} (${storeId})`);
}

export function refreshUserStores(allStoresList = null) {
  if (!currentUser) return;

  const stores = allStoresList && allStoresList.length ? allStoresList : getLocalStores();
  const isAdmin = currentUser.role === "admin";

  if (isAdmin) {
    userStores = stores;
  } else {
    userStores = stores.filter((s) =>
      s.ownerId?.toLowerCase() === currentUser.userId?.toLowerCase() ||
      s.ownerEmail?.toLowerCase() === currentUser.email?.toLowerCase() ||
      (currentUser.userId === "Oboshor" && s.id === "oboshor_store") ||
      // Collaborator access: user was invited to this store
      (Array.isArray(s.collaborators) && s.collaborators.some((c) =>
        c.userId?.toLowerCase() === currentUser.userId?.toLowerCase() ||
        c.email?.toLowerCase() === currentUser.email?.toLowerCase()
      ))
    );
  }

  // Populate Store Switcher Dropdown
  const select = $("activeStoreSelect");
  if (select) {
    select.innerHTML = userStores.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");

    const savedId = getStoredStoreId();
    if (savedId && userStores.some((s) => s.id === savedId)) {
      select.value = savedId;
    } else if (userStores.length) {
      select.value = userStores[0].id;
    }

    currentStore = userStores.find((s) => s.id === select.value) || userStores[0] || null;
  }

  updateStoreHeaderUI();
  document.dispatchEvent(new CustomEvent("store-changed", { detail: { store: currentStore } }));
}

export function updateStoreHeaderUI() {
  if (!currentStore) return;

  if ($("dashStoreName")) $("dashStoreName").textContent = currentStore.name;
  if ($("dashStoreCategory")) $("dashStoreCategory").textContent = currentStore.category || "General Store";
  if ($("dashStoreOwner")) $("dashStoreOwner").textContent = currentStore.ownerId || "Store Owner";

  if ($("setStoreName")) $("setStoreName").value = currentStore.name || "";
  if ($("setStoreCategory")) $("setStoreCategory").value = currentStore.category || "";
  if ($("setStorePhone")) $("setStorePhone").value = currentStore.phone || "";
  if ($("setStoreAddress")) $("setStoreAddress").value = currentStore.address || "";

  renderCollaborators();
}

export async function createInitialStoreForUser(user, storeName) {
  const name = storeName || `${user.userId}'s Store`;
  const storeId = "store_" + Date.now();
  const newStore = {
    id: storeId,
    name,
    category: "General Retail",
    ownerId: user.userId,
    ownerEmail: user.email,
    phone: "",
    address: "",
    currency: "৳",
    collaborators: [],
    createdAt: new Date().toISOString()
  };

  saveLocalStore(newStore);
  try {
    await setDoc(doc(storesCol, storeId), { ...newStore, createdAt: Timestamp.now() });
  } catch {}

  userStores.push(newStore);
  currentStore = newStore;
  setStoredStoreId(newStore.id);
  refreshUserStores();
}

export function setupStoreListeners() {
  // Real-time listener for stores
  onSnapshot(storesCol, (snap) => {
    const cloudStores = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => !isStoreDeleted(s.id) && !isDeleted(s.ownerId) && !isDeleted(s.ownerEmail));
    cloudStores.forEach(saveLocalStore);
    const merged = getLocalStores();
    if ($("admTotalStores")) {
      const regularUsers = getLocalUsers().filter((u) => u.userId?.toLowerCase() !== "admin");
      const activeIds = new Set(regularUsers.map((u) => u.userId?.toLowerCase()));
      const activeEmails = new Set(regularUsers.map((u) => (u.email || "").toLowerCase()).filter(Boolean));
      const valid = merged.filter((s) => activeIds.has(s.ownerId?.toLowerCase()) || (s.ownerEmail && activeEmails.has(s.ownerEmail.toLowerCase())));
      $("admTotalStores").textContent = valid.length.toLocaleString();
    }
    refreshUserStores(merged);
  }, () => {
    const localList = getLocalStores();
    if ($("admTotalStores")) {
      const regularUsers = getLocalUsers().filter((u) => u.userId?.toLowerCase() !== "admin");
      const activeIds = new Set(regularUsers.map((u) => u.userId?.toLowerCase()));
      const activeEmails = new Set(regularUsers.map((u) => (u.email || "").toLowerCase()).filter(Boolean));
      const valid = localList.filter((s) => activeIds.has(s.ownerId?.toLowerCase()) || (s.ownerEmail && activeEmails.has(s.ownerEmail.toLowerCase())));
      $("admTotalStores").textContent = valid.length.toLocaleString();
    }
    refreshUserStores(localList);
  });

  // Store selector change
  $("activeStoreSelect")?.addEventListener("change", (e) => {
    const storeId = e.target.value;
    setStoredStoreId(storeId);
    currentStore = userStores.find((s) => s.id === storeId) || null;
    updateStoreHeaderUI();
    document.dispatchEvent(new CustomEvent("store-changed", { detail: { store: currentStore } }));
    toast(`Switched to store: ${currentStore?.name || storeId}`);
  });

  // Modal triggers
  const storeDlg = $("storeDialog");
  $("btnAddStore")?.addEventListener("click", () => {
    $("addStoreForm")?.reset();
    storeDlg?.showModal();
  });
  $("btnCreateStoreFromSettings")?.addEventListener("click", () => {
    $("addStoreForm")?.reset();
    storeDlg?.showModal();
  });

  // Add store form
  $("addStoreForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("newStoreName").value.trim();
    const cat = $("newStoreCategory").value.trim();
    const phone = $("newStorePhone").value.trim();
    const addr = $("newStoreAddress").value.trim();
    const storeId = "store_" + Date.now();

    const storeData = {
      id: storeId,
      name,
      category: cat || "Retail",
      ownerId: currentUser.userId,
      ownerEmail: currentUser.email,
      phone,
      address: addr,
      currency: "৳",
      collaborators: [],
      createdAt: new Date().toISOString()
    };

    saveLocalStore(storeData);
    try {
      await setDoc(doc(storesCol, storeId), { ...storeData, createdAt: Timestamp.now() });
    } catch {}

    setStoredStoreId(storeId);
    storeDlg?.close();
    refreshUserStores();
    toast(`New store "${name}" created!`);
  });

  // Store settings form
  $("storeSettingsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentStore) return;

    const updated = {
      name: $("setStoreName").value.trim(),
      category: $("setStoreCategory").value.trim(),
      phone: $("setStorePhone").value.trim(),
      address: $("setStoreAddress").value.trim()
    };

    currentStore = { ...currentStore, ...updated };
    saveLocalStore(currentStore);

    try {
      await updateDoc(doc(storesCol, currentStore.id), updated);
    } catch {}

    updateStoreHeaderUI();
    toast("Store settings updated");
  });

  // Handle custom initial store creation
  document.addEventListener("create-initial-store", (e) => {
    const { user, storeName } = e.detail;
    createInitialStoreForUser(user, storeName);
  });

  // Invite collaborator form
  $("inviteCollaboratorForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentStore || !currentUser) return;

    const input = $("inviteUserInput").value.trim();
    const errEl = $("inviteError");
    const succEl = $("inviteSuccess");
    if (errEl) errEl.classList.add("hidden");
    if (succEl) succEl.classList.add("hidden");

    if (!input) {
      if (errEl) { errEl.textContent = "Please enter a User ID or email address."; errEl.classList.remove("hidden"); }
      return;
    }

    // Cannot invite yourself
    const isEmail = input.includes("@");
    if (
      (!isEmail && input.toLowerCase() === currentUser.userId.toLowerCase()) ||
      (isEmail && input.toLowerCase() === (currentUser.email || "").toLowerCase())
    ) {
      if (errEl) { errEl.textContent = "You cannot invite yourself."; errEl.classList.remove("hidden"); }
      return;
    }

    // Cannot invite the store owner again
    if (
      (!isEmail && input.toLowerCase() === (currentStore.ownerId || "").toLowerCase()) ||
      (isEmail && input.toLowerCase() === (currentStore.ownerEmail || "").toLowerCase())
    ) {
      if (errEl) { errEl.textContent = "This user is already the owner of this store."; errEl.classList.remove("hidden"); }
      return;
    }

    // Check if user exists in local users
    const allUsers = getLocalUsers();
    const foundUser = allUsers.find((u) =>
      isEmail ? u.email?.toLowerCase() === input.toLowerCase()
              : u.userId?.toLowerCase() === input.toLowerCase()
    );

    if (!foundUser) {
      if (errEl) {
        errEl.textContent = isEmail
          ? `No registered user found with email "${input}". They need to create an account first.`
          : `No registered user found with User ID "${input}". Please double-check the ID.`;
        errEl.classList.remove("hidden");
      }
      return;
    }

    // Prevent admin from being added as collaborator
    if (foundUser.role === "admin") {
      if (errEl) { errEl.textContent = "Admin cant get access to store."; errEl.classList.remove("hidden"); }
      return;
    }

    // Check for duplicate invite
    const collaborators = currentStore.collaborators || [];
    if (collaborators.some((c) =>
      c.userId?.toLowerCase() === foundUser.userId.toLowerCase() ||
      c.email?.toLowerCase() === foundUser.email.toLowerCase()
    )) {
      if (errEl) { errEl.textContent = `"${foundUser.userId}" already has access to this store.`; errEl.classList.remove("hidden"); }
      return;
    }

    // Add collaborator
    const newCollab = {
      userId: foundUser.userId,
      email: foundUser.email,
      addedAt: new Date().toISOString(),
      addedBy: currentUser.userId
    };

    collaborators.push(newCollab);
    currentStore.collaborators = collaborators;
    saveLocalStore(currentStore);

    try {
      await updateDoc(doc(storesCol, currentStore.id), { collaborators });
    } catch {}

    $("inviteUserInput").value = "";
    renderCollaborators();

    // Trigger Notification Emails (Invite Sent & Invite Received)
    try {
      await sendInviteSentEmail(currentUser, foundUser, currentStore.name);
      await sendInviteReceivedEmail(foundUser, currentUser, currentStore.name);
    } catch (mailErr) {
      console.warn("Invite email notification warning:", mailErr.message);
    }

    if (succEl) {
      succEl.textContent = `✅ Store access granted to "${foundUser.userId}" (${foundUser.email}). Notification emails sent.`;
      succEl.classList.remove("hidden");
      setTimeout(() => succEl.classList.add("hidden"), 4000);
    }
    toast(`Store access granted to ${foundUser.userId} (Emails dispatched)`);
  });

  // Render collaborators when store changes
  document.addEventListener("store-changed", () => {
    renderCollaborators();
  });
}

// ============ Store Collaborators / Access Sharing ============

export function renderCollaborators() {
  const list = $("collaboratorsList");
  const countEl = $("collaboratorsCount");
  if (!list || !currentStore) return;

  const collaborators = currentStore.collaborators || [];
  const isOwner = currentUser?.userId?.toLowerCase() === currentStore.ownerId?.toLowerCase() || currentUser?.role === "admin";

  // Toggle invite form and store deletion visibility based on owner status
  const inviteForm = $("inviteCollaboratorForm");
  const notice = $("collaboratorInviteNotice");
  const btnDelSettings = $("btnDeleteStoreFromSettings");
  const btnDelDanger = $("btnDeleteStore");

  if (!isOwner) {
    if (inviteForm) inviteForm.classList.add("hidden");
    if (notice) notice.innerHTML = `You are accessing <b>${currentStore.name}</b> as an authorized collaborator. (Only the store owner can invite, revoke access, or delete this store).`;
    if (btnDelSettings) btnDelSettings.classList.add("hidden");
    if (btnDelDanger) btnDelDanger.classList.add("hidden");
  } else {
    if (inviteForm) inviteForm.classList.remove("hidden");
    if (notice) notice.innerHTML = `Invited users can view and record daily sales, manage price lists, and view dashboard analytics for this store.`;
    if (btnDelSettings) btnDelSettings.classList.remove("hidden");
    if (btnDelDanger) btnDelDanger.classList.remove("hidden");
  }

  // Count = owner + collaborators
  const total = 1 + collaborators.length;
  if (countEl) countEl.textContent = `${total} member${total !== 1 ? "s" : ""}`;

  // Show the role badge for current user
  const roleBadge = $("collaboratorRoleBadge");
  if (roleBadge) roleBadge.textContent = isOwner ? "Owner" : "Collaborator";

  let html = "";

  // Owner card (always first)
  html += `
    <div class="flex items-center justify-between bg-teal-50/50 border border-teal-100 rounded-xl px-3 py-2">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-full bg-teal-700 text-white flex items-center justify-center text-xs font-bold">
          ${(currentStore.ownerId || "O").charAt(0).toUpperCase()}
        </div>
        <div>
          <p class="text-xs font-bold text-slate-800">${currentStore.ownerId || "Owner"}</p>
          <p class="text-[10px] text-slate-500">${currentStore.ownerEmail || ""}</p>
        </div>
      </div>
      <span class="badge badge-teal text-[10px]">Owner</span>
    </div>`;

  // Collaborator cards
  collaborators.forEach((c, idx) => {
    html += `
      <div class="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-slate-300 transition">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold border border-emerald-200">
            ${(c.userId || c.email || "C").charAt(0).toUpperCase()}
          </div>
          <div>
            <p class="text-xs font-bold text-slate-800">${c.userId || "User"}</p>
            <p class="text-[10px] text-slate-500">${c.email || ""}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-slate-400">${c.addedAt ? new Date(c.addedAt).toLocaleDateString() : ""}</span>
          ${isOwner ? `<button type="button" class="revoke-access text-xs font-medium text-red-600 hover:text-red-800 hover:underline" data-idx="${idx}" title="Remove access">✕ Revoke</button>` : ""}
        </div>
      </div>`;
  });

  if (collaborators.length === 0) {
    html += `
      <div class="text-center py-3 text-xs text-slate-400">
        No collaborators invited yet. Use the form above to grant store access.
      </div>`;
  }

  list.innerHTML = html;

  // Attach revoke handlers
  list.querySelectorAll(".revoke-access").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.idx);
      const collab = collaborators[idx];
      if (!collab) return;
      if (!confirm(`Remove store access for "${collab.userId || collab.email}"? They will no longer be able to view or manage this store.`)) return;

      collaborators.splice(idx, 1);
      currentStore.collaborators = collaborators;
      saveLocalStore(currentStore);

      try {
        await updateDoc(doc(storesCol, currentStore.id), { collaborators });
      } catch {}

      renderCollaborators();
      toast(`Access revoked for ${collab.userId || collab.email}`);
    });
  });
}
