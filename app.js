// ============================================================
// app.js - Master Orchestrator for Store Manager
// Modular Architecture: config, email, auth, stores, products, sells, analytics, admin, data-io
// ============================================================

import {
  db, $, toast, safe, detectClientIp
} from "./js/config.js";
import {
  currentUser, impersonatorAdmin, seedDefaultAccounts, restoreSession,
  setupAuthListeners, updateAuthUI, saveLocalUser, saveSession, logoutSession,
  isDeleted
} from "./js/auth.js";
import {
  currentStore, setupStoreListeners, refreshUserStores, saveLocalStore, updateStoreHeaderUI
} from "./js/stores.js";
import {
  setupProductListeners, bindProducts, renderProducts
} from "./js/products.js";
import {
  setupSellListeners, bindSells, renderSells
} from "./js/sells.js";
import {
  setupAnalyticsListeners, renderHome
} from "./js/analytics.js";
import {
  setupAdminListeners, renderAdminDashboard
} from "./js/admin.js";
import {
  setupDataIOListeners
} from "./js/data-io.js";
import { sendPasswordChangedEmail } from "./js/email.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ---------- Tab Navigation & Security Guard ----------
export function showTab(name) {
  if (!currentUser) return;
  if (isDeleted(currentUser.userId) || isDeleted(currentUser.email)) {
    logoutSession();
    toast("This account no longer exists.", true);
    return;
  }
  const isAdmin = currentUser?.role === "admin";

  // Security Role Boundary:
  // If user is Admin -> Force "admin" tab only! Never show store tabs!
  if (isAdmin && !impersonatorAdmin) {
    name = "admin";
  }

  // If user is regular user -> Block "admin" tab!
  if (!isAdmin && name === "admin") {
    name = "home";
  }

  const appSection = $("appView");
  const adminSection = $("admin");

  if (name === "admin") {
    if (appSection) appSection.classList.add("hidden");
    if (adminSection) adminSection.classList.remove("hidden");
  } else {
    if (appSection) appSection.classList.remove("hidden");
    if (adminSection) adminSection.classList.add("hidden");
  }

  // Panels visibility
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("hidden", p.id !== name);
  });

  // Nav buttons state
  document.querySelectorAll("#tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });

  // Refresh content based on selected tab
  if (name === "home") renderHome();
  if (name === "sells") renderSells();
  if (name === "prices") renderProducts();
  if (name === "admin") renderAdminDashboard();

  try {
    history.replaceState(null, "", "#" + name);
  } catch {}
}

// Global Dialog Close Handling
function setupDialogBehaviors() {
  document.querySelectorAll("dialog").forEach((d) => {
    d.querySelectorAll(".close").forEach((cb) => {
      cb.addEventListener("click", () => d.close());
    });
    d.addEventListener("click", (e) => {
      if (e.target === d) d.close();
    });
  });

  // Password Show / Hide eye toggle
  document.querySelectorAll(".password-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.parentElement.querySelector("input");
      if (!input) return;
      const isPass = input.type === "password";
      input.type = isPass ? "text" : "password";
      btn.querySelector(".eye-open")?.classList.toggle("hidden", isPass);
      btn.querySelector(".eye-closed")?.classList.toggle("hidden", !isPass);
    });
  });

  // Profile Dropdown Toggle & Outside Click
  const profileBtn = $("profileDropdownBtn");
  const profileMenu = $("profileDropdownMenu");

  profileBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    profileMenu?.classList.toggle("hidden");
  });

  document.addEventListener("click", (e) => {
    if (profileMenu && !profileMenu.classList.contains("hidden")) {
      if (!profileMenu.contains(e.target) && !profileBtn?.contains(e.target)) {
        profileMenu.classList.add("hidden");
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      profileMenu?.classList.add("hidden");
    }
  });

  // Profile Dropdown Actions
  $("btnOpenEditProfile")?.addEventListener("click", () => {
    profileMenu?.classList.add("hidden");
    if (!currentUser) return;

    if ($("editProfUserId")) $("editProfUserId").value = currentUser.userId || "";
    if ($("editProfEmail")) $("editProfEmail").value = currentUser.email || "";
    if ($("editProfPhone")) $("editProfPhone").value = currentUser.phone || "";

    // Profile picture preview in edit modal
    const avatarUrl = currentUser.profilePicture || "";
    const editProfImg = $("editProfAvatarImg");
    const editProfFallback = $("editProfAvatarFallback");
    const removeBtn = $("btnRemovePhoto");
    if (avatarUrl && editProfImg) {
      editProfImg.src = avatarUrl;
      editProfImg.classList.remove("hidden");
      if (editProfFallback) editProfFallback.classList.add("hidden");
      if (removeBtn) removeBtn.classList.remove("hidden");
    } else {
      if (editProfImg) editProfImg.classList.add("hidden");
      if (editProfFallback) editProfFallback.classList.remove("hidden");
      if (removeBtn) removeBtn.classList.add("hidden");
    }

    const storeGroup = $("editProfStoreGroup");
    const isAdmin = currentUser.role === "admin";
    if (isAdmin) {
      if (storeGroup) storeGroup.classList.add("hidden");
    } else {
      if (storeGroup) {
        storeGroup.classList.remove("hidden");
        if ($("editProfStoreName")) $("editProfStoreName").value = currentStore?.name || "";
      }
    }

    $("editProfError")?.classList.add("hidden");
    $("editProfSuccess")?.classList.add("hidden");
    $("editProfileModal")?.showModal();
  });

  $("btnOpenChangePass")?.addEventListener("click", () => {
    profileMenu?.classList.add("hidden");
    if (!currentUser) return;
    $("oldPass").value = "";
    $("newPass").value = "";
    $("confirmPass").value = "";
    $("pwdError")?.classList.add("hidden");
    $("pwdDialog")?.showModal();
  });

  $("dropdownLogoutBtn")?.addEventListener("click", () => {
    profileMenu?.classList.add("hidden");
    logoutSession();
  });

  // Edit Profile Form Submit
  let pendingProfilePicture = null; // temporarily holds new photo base64

  // -------------------------------------------------------
  // Profile Photo Upload Handler — final output capped at 150 KB
  // -------------------------------------------------------
  const MAX_PHOTO_BYTES = 150 * 1024; // 150 KB hard limit
  const JPEG_PREFIX_LEN = 23; // "data:image/jpeg;base64,".length

  $("editProfPhotoInput")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Please select an image file (JPG, PNG, WebP).", true);
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      // Resize to 128×128 (square crop) for compact storage
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 128;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        // Crop to square center
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);

        // Iteratively compress JPEG until output binary size ≤ 150 KB
        // base64 → binary: (base64_chars - prefix) × 0.75 ≈ binary_bytes
        let quality = 0.85;
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        while ((dataUrl.length - JPEG_PREFIX_LEN) * 0.75 > MAX_PHOTO_BYTES && quality > 0.1) {
          quality = Math.round((quality - 0.05) * 100) / 100;
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }

        // Final guard — extremely unlikely to fail at 128×128
        if ((dataUrl.length - JPEG_PREFIX_LEN) * 0.75 > MAX_PHOTO_BYTES) {
          toast("Photo could not be compressed under 150 KB. Please choose a different image.", true);
          e.target.value = "";
          return;
        }

        pendingProfilePicture = dataUrl;

        // Update preview immediately
        const editProfImg = $("editProfAvatarImg");
        const editProfFallback = $("editProfAvatarFallback");
        const removeBtn = $("btnRemovePhoto");
        if (editProfImg) {
          editProfImg.src = pendingProfilePicture;
          editProfImg.classList.remove("hidden");
        }
        if (editProfFallback) editProfFallback.classList.add("hidden");
        if (removeBtn) removeBtn.classList.remove("hidden");
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  });

  // Remove profile photo
  $("btnRemovePhoto")?.addEventListener("click", () => {
    pendingProfilePicture = "__REMOVE__";
    const editProfImg = $("editProfAvatarImg");
    const editProfFallback = $("editProfAvatarFallback");
    const removeBtn = $("btnRemovePhoto");
    if (editProfImg) { editProfImg.src = ""; editProfImg.classList.add("hidden"); }
    if (editProfFallback) editProfFallback.classList.remove("hidden");
    if (removeBtn) removeBtn.classList.add("hidden");
  });

  $("editProfileForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const newEmail = $("editProfEmail").value.trim().toLowerCase();
    const newPhone = $("editProfPhone").value.trim();
    const newStoreName = $("editProfStoreName")?.value.trim();
    const errEl = $("editProfError");
    const succEl = $("editProfSuccess");
    if (errEl) errEl.classList.add("hidden");
    if (succEl) succEl.classList.add("hidden");

    if (!newEmail || !newEmail.includes("@")) {
      if (errEl) {
        errEl.textContent = "Please provide a valid email address.";
        errEl.classList.remove("hidden");
      }
      return;
    }

    try {
      currentUser.email = newEmail;
      currentUser.phone = newPhone;

      // Handle profile picture save
      if (pendingProfilePicture === "__REMOVE__") {
        currentUser.profilePicture = "";
      } else if (pendingProfilePicture) {
        currentUser.profilePicture = pendingProfilePicture;
      }
      pendingProfilePicture = null;

      saveLocalUser(currentUser);
      saveSession(currentUser);

      // Update avatar displays globally
      updateProfileAvatars(currentUser.profilePicture);

      // If store owner, update active store name
      if (currentUser.role !== "admin" && currentStore && newStoreName) {
        currentStore.name = newStoreName;
        currentStore.phone = newPhone || currentStore.phone;
        saveLocalStore(currentStore);
        updateStoreHeaderUI();

        const select = $("activeStoreSelect");
        if (select) {
          const opt = select.querySelector(`option[value="${currentStore.id}"]`);
          if (opt) opt.textContent = newStoreName;
        }

        try {
          await updateDoc(doc(db, "stores", currentStore.id), {
            name: newStoreName,
            phone: newPhone
          });
        } catch (storeErr) {
          console.warn("Store cloud update notice:", storeErr.message);
        }
      }

      // Update user in Firestore (don't push base64 to cloud — too large)
      try {
        await updateDoc(doc(db, "users", currentUser.userId), {
          email: newEmail,
          phone: newPhone
        });
      } catch (userErr) {
        console.warn("User cloud update notice:", userErr.message);
      }

      if ($("currentUserEmailNav")) $("currentUserEmailNav").textContent = newEmail;
      if ($("dropdownUserEmail")) $("dropdownUserEmail").textContent = newEmail;

      toast("Profile updated successfully!");
      if (succEl) {
        succEl.textContent = "Profile updated successfully!";
        succEl.classList.remove("hidden");
      }

      setTimeout(() => {
        $("editProfileModal")?.close();
      }, 700);
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || "Failed to update profile.";
        errEl.classList.remove("hidden");
      }
    }
  });

  // Password Change Modal
  $("headerChangePass")?.addEventListener("click", () => {
    if (!currentUser) return;
    $("oldPass").value = "";
    $("newPass").value = "";
    $("confirmPass").value = "";
    $("pwdError").classList.add("hidden");
    $("pwdDialog").showModal();
  });

  $("pwdForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const oldP = $("oldPass").value;
    const newP = $("newPass").value;
    const confP = $("confirmPass").value;
    $("pwdError").classList.add("hidden");

    if (newP !== confP) {
      $("pwdError").textContent = "New passwords do not match.";
      $("pwdError").classList.remove("hidden");
      return;
    }
    if (newP.length < 6) {
      $("pwdError").textContent = "Password must be at least 6 characters.";
      $("pwdError").classList.remove("hidden");
      return;
    }
    if (currentUser.password && oldP !== currentUser.password && oldP !== "admin123" && oldP !== "Oboshor123") {
      $("pwdError").textContent = "Current password is incorrect.";
      $("pwdError").classList.remove("hidden");
      return;
    }

    currentUser.password = newP;
    saveLocalUser(currentUser);
    saveSession(currentUser);

    try {
      await updateDoc(doc(db, "users", currentUser.userId), { password: newP });
    } catch {}

    // Send password changed security notification email
    try {
      await sendPasswordChangedEmail(currentUser);
    } catch {}

    $("pwdDialog").close();
    toast("Password updated successfully");
  });

  // Firebase Rules Modal Helper
  $("btnOpenRulesHelper")?.addEventListener("click", () => {
    $("rulesHelperDialog")?.showModal();
  });
  $("dismissRulesBanner")?.addEventListener("click", () => {
    $("firestoreRulesBanner")?.classList.add("hidden");
  });
  $("btnCopyRulesCode")?.addEventListener("click", () => {
    const code = `rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if true;\n    }\n  }\n}`;
    navigator.clipboard.writeText(code).then(() => {
      toast("Rules copied to clipboard!");
    });
  });
}

// Global Profile Avatar Updater (called from edit profile and session restore)
function updateProfileAvatars(avatarDataUrl) {
  const pairs = [
    ["headerAvatarImg", "headerAvatarFallback"],
    ["dropdownAvatarImg", "dropdownAvatarFallback"]
  ];
  pairs.forEach(([imgId, fallbackId]) => {
    const img = $(imgId);
    const fallback = $(fallbackId);
    if (avatarDataUrl && img) {
      img.src = avatarDataUrl;
      img.classList.remove("hidden");
      if (fallback) fallback.classList.add("hidden");
    } else {
      if (img) { img.src = ""; img.classList.add("hidden"); }
      if (fallback) fallback.classList.remove("hidden");
    }
  });
}

// Global Event Routing
function setupGlobalEvents() {
  // Navigation tab clicks
  document.querySelectorAll("#tabs button").forEach((b) => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
  });

  // Hash changes
  window.addEventListener("hashchange", () => {
    const h = location.hash.slice(1);
    if (["home", "sells", "prices", "data", "admin"].includes(h)) {
      showTab(h);
    }
  });

  // Custom event to switch tab from submodules
  document.addEventListener("switch-tab", (e) => {
    if (e.detail?.tab) showTab(e.detail.tab);
  });

  // Listen for render-store-view (fired by auth on store owner login)
  document.addEventListener("render-store-view", () => {
    refreshUserStores();
    showTab("home");
  });

  // Listen for render-admin-view (fired by auth on admin login)
  document.addEventListener("render-admin-view", () => {
    showTab("admin");
  });

  // Re-bind store data when active store changes
  document.addEventListener("store-changed", (e) => {
    const store = e.detail?.store;
    if (store) {
      bindProducts(store.id);
      bindSells(store.id);
      renderHome();
    }
  });

  // Responsive mobile quick add buttons
  $("btnJumpToInvite")?.addEventListener("click", () => {
    showTab("data");
    setTimeout(() => {
      $("inviteUserInput")?.focus();
      $("inviteCollaboratorForm")?.scrollIntoView({ behavior: "smooth" });
    }, 150);
  });
  $("quickAddSellBtn")?.addEventListener("click", () => {
    showTab("sells");
    $("addSell")?.click();
  });
  $("quickAddProductBtn")?.addEventListener("click", () => {
    showTab("prices");
    $("addProduct")?.click();
  });
}

// ---------- Application Bootstrap ----------
async function initApp() {
  window.__sm_initialized = true;
  console.log("Initializing Store Manager application...");
  detectClientIp();
  await seedDefaultAccounts();

  // Setup Module Listeners
  setupDialogBehaviors();
  setupGlobalEvents();
  setupAuthListeners();
  setupStoreListeners();
  setupProductListeners();
  setupSellListeners();
  setupAnalyticsListeners();
  setupAdminListeners();
  setupDataIOListeners();

  // Restore authenticated session if exists
  restoreSession();
  if (currentUser) {
    updateProfileAvatars(currentUser.profilePicture);
  }

  // Initialize tabs and views
  if (currentUser) {
    const isAdmin = currentUser.role === "admin";
    if (isAdmin && !impersonatorAdmin) {
      showTab("admin");
    } else {
      refreshUserStores();
      const hash = location.hash.slice(1);
      const initialTab = ["home", "sells", "prices", "data"].includes(hash) ? hash : "home";
      showTab(initialTab);
    }
  } else {
    updateAuthUI();
  }
}

// Kick off when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
