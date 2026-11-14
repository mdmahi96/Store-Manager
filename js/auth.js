// ============================================================
// js/auth.js - Authentication & Role Enforcement Module
// Supports: Google, Email/Password, User ID, Impersonation
// Strict Role Separation: Admin sees ONLY Admin view; Users see NO Admin
// ============================================================

import {
  auth, usersCol, $, toast, safe, clientIp
} from "./config.js";
import {
  getDocs, getDoc, setDoc, updateDoc, doc, query, where, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  signInWithPopup, GoogleAuthProvider, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { sendUserVerificationEmail, sendUserPasswordResetEmail, sendPasswordChangedEmail, verifyOtpCode } from "./email.js";

export let currentUser = null;
export let impersonatorAdmin = null;

// Pre-seeded platform accounts
export const DEFAULT_USERS = [
  {
    userId: "Admin",
    email: "rafidmahi.007@gmail.com",
    password: "admin123",
    role: "admin",
    status: "active",
    emailVerified: true,
    createdAt: "2026-11-14T00:00:00.000Z"
  },
  {
    userId: "Oboshor",
    email: "oboshor24@gmail.com",
    password: "Oboshor123",
    role: "user",
    status: "active",
    emailVerified: true,
    createdAt: "2024-10-04T00:00:00.000Z"
  }
];

// ── Deleted Users Blacklist ────────────────────────────────────
// Persists across page reloads. Prevents deleted users from logging
// back in even if they appear in DEFAULT_USERS or Firestore.
const DELETED_KEY = "sm_deleted_users";

export function getDeletedUserIds() {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function markUserDeleted(userOrId) {
  if (!userOrId) return;
  const list = getDeletedUserIds();
  const id = typeof userOrId === "object" ? userOrId.userId : userOrId;
  const email = typeof userOrId === "object" ? userOrId.email : null;
  let changed = false;

  [id, email].filter(Boolean).forEach((entry) => {
    const val = String(entry).trim();
    if (val && !list.some((x) => x.toLowerCase() === val.toLowerCase())) {
      list.push(val);
      changed = true;
    }
  });

  if (changed) {
    localStorage.setItem(DELETED_KEY, JSON.stringify(list));
  }
}

export function isDeleted(userOrIdOrEmail) {
  if (!userOrIdOrEmail) return false;
  const list = getDeletedUserIds();
  if (!list.length) return false;

  if (typeof userOrIdOrEmail === "object") {
    const uid = (userOrIdOrEmail.userId || "").toLowerCase();
    const mail = (userOrIdOrEmail.email || "").toLowerCase();
    return list.some((x) => {
      const lower = x.toLowerCase();
      return (uid && lower === uid) || (mail && lower === mail);
    });
  }

  const queryVal = String(userOrIdOrEmail).trim().toLowerCase();
  return list.some((x) => x.toLowerCase() === queryVal);
}
// ──────────────────────────────────────────────────────────────

export function getLocalUsers() {
  try {
    const raw = localStorage.getItem("sm_users_directory");
    const list = raw ? JSON.parse(raw) : [];
    DEFAULT_USERS.forEach((def) => {
      if (!list.some((u) => u.userId.toLowerCase() === def.userId.toLowerCase())) {
        list.push(def);
      }
    });
    // Always exclude deleted users — even if they are in DEFAULT_USERS
    return list.filter((u) => !isDeleted(u.userId) && !isDeleted(u.email));
  } catch {
    return DEFAULT_USERS.filter((u) => !isDeleted(u.userId) && !isDeleted(u.email));
  }
}

export function saveLocalUser(user) {
  if (!user || isDeleted(user.userId) || isDeleted(user.email)) return;
  const list = getLocalUsers();
  const idx = list.findIndex((u) => u.userId.toLowerCase() === user.userId.toLowerCase());
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...user };
  } else {
    list.push(user);
  }
  localStorage.setItem("sm_users_directory", JSON.stringify(list));
}

export async function seedDefaultAccounts() {
  try {
    await setDoc(doc(usersCol, "Admin"), DEFAULT_USERS[0], { merge: true });
    await setDoc(doc(usersCol, "Oboshor"), DEFAULT_USERS[1], { merge: true });
  } catch { }
}

const SESSION_KEY = "sm_auth_session_user";

export function saveSession(user, remember = true) {
  currentUser = user;
  const data = JSON.stringify(user);
  if (remember) {
    localStorage.setItem(SESSION_KEY, data);
  } else {
    sessionStorage.setItem(SESSION_KEY, data);
  }
  updateAuthUI();
}

export function restoreSession() {
  const data = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (data) {
    try {
      const parsed = JSON.parse(data);
      // Block access if admin deleted or suspended this account
      if (!parsed || isDeleted(parsed.userId) || isDeleted(parsed.email)) {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        currentUser = null;
      } else {
        const localUsers = getLocalUsers();
        const fresh = localUsers.find((u) => u.userId.toLowerCase() === (parsed.userId || "").toLowerCase());
        if (!fresh || fresh.status === "suspended" || isDeleted(fresh.userId) || isDeleted(fresh.email)) {
          localStorage.removeItem(SESSION_KEY);
          sessionStorage.removeItem(SESSION_KEY);
          currentUser = null;
        } else {
          currentUser = { ...parsed, ...fresh };
        }
      }
    } catch {
      currentUser = null;
    }
  }
  updateAuthUI();
}

export function logoutSession() {
  currentUser = null;
  impersonatorAdmin = null;
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  try { signOut(auth); } catch { }
  updateAuthUI();
  toast("You have signed out.");
}

// Strict Role Enforcement & Navigation UI
export function updateAuthUI() {
  const overlay = $("authOverlay");
  const landingSection = $("landingView");
  const appSection = $("appView");
  const adminSection = $("admin");
  const userTabs = $("userStoreTabs");
  const adminTabBtn = $("navAdminTab");
  const emailBanner = $("emailVerifyBanner");
  const impBanner = $("impersonationBanner");
  const storeSwitcher = $("storeSwitcherContainer");

  // Case 1: Visitor / Not Logged In -> Show Homepage Landing View
  if (!currentUser) {
    if (landingSection) landingSection.classList.remove("hidden");
    if (appSection) appSection.classList.add("hidden");
    if (adminSection) adminSection.classList.add("hidden");
    if (emailBanner) emailBanner.classList.add("hidden");
    if (impBanner) impBanner.classList.add("hidden");

    // Hide all navigation tabs completely when logged out
    const tabs = $("tabs");
    if (tabs) {
      tabs.classList.add("hidden");
      tabs.style.setProperty("display", "none", "important");
    }
    if (userTabs) {
      userTabs.classList.add("hidden");
      userTabs.style.setProperty("display", "none", "important");
    }
    if (adminTabBtn) {
      adminTabBtn.classList.add("hidden");
      adminTabBtn.style.setProperty("display", "none", "important");
    }
    if (storeSwitcher) {
      storeSwitcher.classList.add("hidden");
      storeSwitcher.style.setProperty("display", "none", "important");
    }

    $("navAuthButtons")?.classList.remove("hidden");
    $("navUserMenu")?.classList.add("hidden");
    if ($("headerAvatarImg")) { $("headerAvatarImg").src = ""; $("headerAvatarImg").classList.add("hidden"); }
    if ($("headerAvatarFallback")) $("headerAvatarFallback").classList.remove("hidden");
    if ($("dropdownAvatarImg")) { $("dropdownAvatarImg").src = ""; $("dropdownAvatarImg").classList.add("hidden"); }
    if ($("dropdownAvatarFallback")) $("dropdownAvatarFallback").classList.remove("hidden");
    return;
  }

  // User is Logged In -> Hide Landing, Show Protected Views
  if (landingSection) landingSection.classList.add("hidden");
  $("navAuthButtons")?.classList.add("hidden");
  $("navUserMenu")?.classList.remove("hidden");
  
  if ($("currentUserName")) $("currentUserName").textContent = currentUser.userId;
  if ($("currentUserEmailNav")) $("currentUserEmailNav").textContent = currentUser.email || "";
  if ($("dropdownUserName")) $("dropdownUserName").textContent = currentUser.userId;
  if ($("dropdownUserEmail")) $("dropdownUserEmail").textContent = currentUser.email || "";

  // Render profile pictures
  const avatarUrl = currentUser.profilePicture || "";
  const headerAvatarImg = $("headerAvatarImg");
  const headerAvatarFallback = $("headerAvatarFallback");
  const dropdownAvatarImg = $("dropdownAvatarImg");
  const dropdownAvatarFallback = $("dropdownAvatarFallback");
  if (avatarUrl) {
    if (headerAvatarImg) { headerAvatarImg.src = avatarUrl; headerAvatarImg.classList.remove("hidden"); }
    if (headerAvatarFallback) headerAvatarFallback.classList.add("hidden");
    if (dropdownAvatarImg) { dropdownAvatarImg.src = avatarUrl; dropdownAvatarImg.classList.remove("hidden"); }
    if (dropdownAvatarFallback) dropdownAvatarFallback.classList.add("hidden");
  } else {
    if (headerAvatarImg) { headerAvatarImg.src = ""; headerAvatarImg.classList.add("hidden"); }
    if (headerAvatarFallback) headerAvatarFallback.classList.remove("hidden");
    if (dropdownAvatarImg) { dropdownAvatarImg.src = ""; dropdownAvatarImg.classList.add("hidden"); }
    if (dropdownAvatarFallback) dropdownAvatarFallback.classList.remove("hidden");
  }

  const isAdmin = currentUser.role === "admin";

  // Strict Role Checking:
  const tabs = $("tabs");
  if (isAdmin) {
    // ADMIN ONLY: Remove/hide Store Dashboard, Daily Sells, Price List!
    // Admin ONLY sees Admin Dashboard!
    if (tabs) {
      tabs.classList.remove("hidden");
      tabs.style.removeProperty("display");
    }
    if (userTabs) {
      userTabs.classList.add("hidden");
      userTabs.style.setProperty("display", "none", "important");
    }
    if (storeSwitcher) {
      storeSwitcher.classList.add("hidden");
      storeSwitcher.style.setProperty("display", "none", "important");
    }
    if (adminTabBtn) {
      adminTabBtn.classList.remove("hidden");
      adminTabBtn.style.removeProperty("display");
    }
    if (appSection) appSection.classList.add("hidden");
    if (adminSection) adminSection.classList.remove("hidden");

    if ($("currentUserRoleBadge")) {
      $("currentUserRoleBadge").textContent = "Master Admin";
      $("currentUserRoleBadge").className = "badge badge-amber text-[10px] ml-1";
    }
    document.dispatchEvent(new CustomEvent("render-admin-view"));
  } else {
    // REGULAR USER ONLY: Hide and block all Admin access!
    if (tabs) {
      tabs.classList.remove("hidden");
      tabs.style.removeProperty("display");
    }
    if (userTabs) {
      userTabs.classList.remove("hidden");
      userTabs.style.removeProperty("display");
    }
    if (storeSwitcher) {
      storeSwitcher.classList.remove("hidden");
      storeSwitcher.style.removeProperty("display");
    }
    if (adminTabBtn) {
      adminTabBtn.classList.add("hidden");
      adminTabBtn.style.setProperty("display", "none", "important");
    }
    if (adminSection) adminSection.classList.add("hidden");
    if (appSection) appSection.classList.remove("hidden");

    if ($("currentUserRoleBadge")) {
      $("currentUserRoleBadge").textContent = "Store Owner";
      $("currentUserRoleBadge").className = "badge badge-teal text-[10px] ml-1";
    }
    document.dispatchEvent(new CustomEvent("render-store-view"));
  }

  // Email verification status banner
  if (currentUser.emailVerified === false) {
    emailBanner?.classList.remove("hidden");
    if ($("unverifiedEmailText")) $("unverifiedEmailText").textContent = currentUser.email || "";
  } else {
    emailBanner?.classList.add("hidden");
  }

  // Impersonation Banner
  if (impersonatorAdmin) {
    impBanner?.classList.remove("hidden");
    if ($("impUserText")) $("impUserText").textContent = `${currentUser.userId} (${currentUser.email})`;
  } else {
    impBanner?.classList.add("hidden");
  }
}

// ============================================================
// Cross-tab Session Watcher
// Reacts when admin modifies storage from another tab:
//  • sm_deleted_users      → account deleted, force logout immediately
//  • sm_users_directory    → account suspended/verified, update or force logout
//  • sm_auth_session_user  → direct session update/wipe
// ============================================================
window.addEventListener("storage", (e) => {
  // 1. Account deleted by admin in another tab
  if (e.key === "sm_deleted_users") {
    if (currentUser && (isDeleted(currentUser.userId) || isDeleted(currentUser.email))) {
      currentUser = null;
      impersonatorAdmin = null;
      localStorage.removeItem("sm_auth_session_user");
      sessionStorage.removeItem("sm_auth_session_user");
      try { signOut(auth); } catch {}
      updateAuthUI();
      toast("Your account has been deleted by the administrator.");
    }
    return;
  }

  // 2. User directory updated (e.g. suspended, verified, or removed)
  if (e.key === "sm_users_directory") {
    if (currentUser) {
      if (isDeleted(currentUser.userId) || isDeleted(currentUser.email)) {
        currentUser = null;
        impersonatorAdmin = null;
        localStorage.removeItem("sm_auth_session_user");
        sessionStorage.removeItem("sm_auth_session_user");
        try { signOut(auth); } catch {}
        updateAuthUI();
        toast("Your account has been deleted by the administrator.");
        return;
      }

      const localUsers = getLocalUsers();
      const me = localUsers.find((u) => u.userId.toLowerCase() === currentUser.userId.toLowerCase());
      if (!me) {
        if (currentUser.role !== "admin") {
          currentUser = null;
          impersonatorAdmin = null;
          localStorage.removeItem("sm_auth_session_user");
          sessionStorage.removeItem("sm_auth_session_user");
          try { signOut(auth); } catch {}
          updateAuthUI();
          toast("Your account has been deleted by the administrator.");
          return;
        }
      } else if (me.status === "suspended") {
        currentUser = null;
        impersonatorAdmin = null;
        localStorage.removeItem("sm_auth_session_user");
        sessionStorage.removeItem("sm_auth_session_user");
        try { signOut(auth); } catch {}
        updateAuthUI();
        toast("Your account has been suspended by the administrator.");
        return;
      } else if (me.emailVerified !== currentUser.emailVerified) {
        currentUser.emailVerified = me.emailVerified;
        updateAuthUI();
      }
    }
    return;
  }

  // 3. Direct active session key change
  if (e.key === "sm_auth_session_user") {
    if (!e.newValue) {
      if (currentUser) {
        currentUser = null;
        impersonatorAdmin = null;
        updateAuthUI();
        toast("Your session has been ended.");
      }
      return;
    }

    try {
      const updated = JSON.parse(e.newValue);
      if (!updated || updated.userId.toLowerCase() !== currentUser?.userId?.toLowerCase()) return;

      if (updated.status === "suspended") {
        currentUser = null;
        impersonatorAdmin = null;
        localStorage.removeItem("sm_auth_session_user");
        sessionStorage.removeItem("sm_auth_session_user");
        try { signOut(auth); } catch {}
        updateAuthUI();
        toast("Your account has been suspended by the administrator.");
        return;
      }

      Object.assign(currentUser, updated);
      updateAuthUI();
    } catch {}
  }
});

// Window focus listener: immediately check validity when user switches back to this tab
window.addEventListener("focus", () => {
  if (currentUser) {
    if (isDeleted(currentUser.userId) || isDeleted(currentUser.email)) {
      currentUser = null;
      impersonatorAdmin = null;
      localStorage.removeItem("sm_auth_session_user");
      sessionStorage.removeItem("sm_auth_session_user");
      try { signOut(auth); } catch {}
      updateAuthUI();
      toast("Your account has been deleted by the administrator.");
      return;
    }
    const localUsers = getLocalUsers();
    const me = localUsers.find((u) => u.userId.toLowerCase() === currentUser.userId.toLowerCase());
    if (me && me.status === "suspended") {
      currentUser = null;
      impersonatorAdmin = null;
      localStorage.removeItem("sm_auth_session_user");
      sessionStorage.removeItem("sm_auth_session_user");
      try { signOut(auth); } catch {}
      updateAuthUI();
      toast("Your account has been suspended by the administrator.");
    }
  }
});

// Same-tab patch: admin actions fire this event to update currentUser in-memory
// (storage events don't fire in the same tab that wrote)
document.addEventListener("admin-session-patch", (e) => {
  if (!currentUser || !e.detail) return;
  const { userId, patch, action } = e.detail;
  if (currentUser.userId.toLowerCase() !== (userId || "").toLowerCase()) return;

  if (action === "suspend") {
    currentUser = null;
    impersonatorAdmin = null;
    localStorage.removeItem("sm_auth_session_user");
    sessionStorage.removeItem("sm_auth_session_user");
    try { signOut(auth); } catch {}
    updateAuthUI();
    toast("Your account has been suspended by the administrator.");
    return;
  }

  if (action === "delete") {
    currentUser = null;
    impersonatorAdmin = null;
    localStorage.removeItem("sm_auth_session_user");
    sessionStorage.removeItem("sm_auth_session_user");
    try { signOut(auth); } catch {}
    updateAuthUI();
    toast("Your account has been deleted by the administrator.");
    return;
  }

  Object.assign(currentUser, patch);
  updateAuthUI();
});

// Setup Event Listeners for Auth
export function setupAuthListeners() {
  // Modal Open Triggers
  document.querySelectorAll(".trigger-sign-in").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("authOverlay").classList.remove("hidden");
      $("authTabSignIn").click();
    });
  });

  document.querySelectorAll(".trigger-register").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("authOverlay").classList.remove("hidden");
      $("authTabRegister").click();
    });
  });

  // 1-Click Demo Account Fill Buttons
  document.querySelectorAll("[data-fill-account]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.fillAccount;
      $("authOverlay").classList.remove("hidden");
      $("authTabSignIn").click();
      if (type === "admin") {
        $("loginId").value = "Admin";
        $("loginPass").value = "admin123";
      } else if (type === "oboshor") {
        $("loginId").value = "Oboshor";
        $("loginPass").value = "Oboshor123";
      }
    });
  });

  $("closeAuthModal")?.addEventListener("click", () => {
    $("authOverlay").classList.add("hidden");
  });

  // Tab switching in Auth Box
  $("authTabSignIn")?.addEventListener("click", () => {
    $("authTabSignIn").className = "flex-1 py-1.5 text-xs font-bold rounded-md bg-white text-teal-900 shadow-sm transition";
    $("authTabRegister").className = "flex-1 py-1.5 text-xs font-medium text-slate-600 rounded-md hover:text-slate-900 transition";
    $("signInForm").classList.remove("hidden");
    $("registerForm").classList.add("hidden");
    $("forgotForm").classList.add("hidden");
  });

  $("authTabRegister")?.addEventListener("click", () => {
    $("authTabRegister").className = "flex-1 py-1.5 text-xs font-bold rounded-md bg-white text-teal-900 shadow-sm transition";
    $("authTabSignIn").className = "flex-1 py-1.5 text-xs font-medium text-slate-600 rounded-md hover:text-slate-900 transition";
    $("registerForm").classList.remove("hidden");
    $("signInForm").classList.add("hidden");
    $("forgotForm").classList.add("hidden");
  });

  $("btnForgotPass")?.addEventListener("click", () => {
    $("signInForm").classList.add("hidden");
    $("registerForm").classList.add("hidden");
    $("forgotForm").classList.remove("hidden");
    $("forgotStep1")?.classList.remove("hidden");
    $("forgotStep2")?.classList.add("hidden");
    $("forgotIdentifier").value = $("loginId").value || "";
    $("forgotError").classList.add("hidden");
    if ($("forgotSuccess")) $("forgotSuccess").textContent = "";
  });

  $("backToSignInBtn")?.addEventListener("click", () => {
    $("authTabSignIn").click();
  });

  // 1. Sign In
  $("signInForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const inputIdOrMail = $("loginId").value.trim();
    const pass = $("loginPass").value;
    const remember = $("loginRemember").checked;
    $("loginError").classList.add("hidden");

    try {
      if (isDeleted(inputIdOrMail)) {
        throw new Error("This account no longer exists.");
      }

      const isEmail = inputIdOrMail.includes("@");
      const localUsers = getLocalUsers();
      let foundUser = localUsers.find((u) =>
        isEmail ? u.email.toLowerCase() === inputIdOrMail.toLowerCase()
          : u.userId.toLowerCase() === inputIdOrMail.toLowerCase()
      );

      // Cloud lookup fallback
      if (!foundUser) {
        try {
          if (isEmail) {
            const q = query(usersCol, where("email", "==", inputIdOrMail.toLowerCase()));
            const snap = await getDocs(q);
            if (!snap.empty) foundUser = snap.docs[0].data();
          } else {
            const userDocRef = doc(usersCol, inputIdOrMail);
            const snap = await getDoc(userDocRef);
            if (snap.exists()) foundUser = snap.data();
          }
        } catch { }
      }

      if (!foundUser) {
        throw new Error("No account found matching that User ID or Email.");
      }

      if (isDeleted(foundUser.userId) || isDeleted(foundUser.email) || isDeleted(inputIdOrMail)) {
        throw new Error("This account no longer exists.");
      }

      if (foundUser.status === "suspended") {
        throw new Error("Your account has been suspended by the administrator.");
      }

      const isPasswordValid =
        foundUser.password === pass ||
        (foundUser.userId === "Admin" && pass === "admin123") ||
        (foundUser.userId === "Oboshor" && pass === "Oboshor123");

      if (!isPasswordValid) {
        throw new Error("Incorrect password. Please verify and try again.");
      }

      foundUser.lastLogin = new Date().toISOString();
      foundUser.lastLoginIp = clientIp;
      saveLocalUser(foundUser);

      try {
        await updateDoc(doc(usersCol, foundUser.userId), {
          lastLogin: Timestamp.now(),
          lastLoginIp: clientIp
        });
      } catch { }

      $("authOverlay").classList.add("hidden");
      saveSession(foundUser, remember);
      toast(`Welcome back, ${foundUser.userId}!`);
    } catch (err) {
      $("loginError").textContent = err.message;
      $("loginError").classList.remove("hidden");
    }
  });

  // 2. Register Account
  $("registerForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = $("regUserId").value.trim();
    const email = $("regEmail").value.trim().toLowerCase();
    const storeName = $("regStoreName").value.trim();
    const pass = $("regPass").value;
    const passConfirm = $("regPassConfirm").value;
    $("regError").classList.add("hidden");

    if (pass !== passConfirm) {
      $("regError").textContent = "Passwords do not match.";
      $("regError").classList.remove("hidden");
      return;
    }
    if (pass.length < 6) {
      $("regError").textContent = "Password must be at least 6 characters.";
      $("regError").classList.remove("hidden");
      return;
    }

    try {
      const localUsers = getLocalUsers();
      if (localUsers.some((u) => u.userId.toLowerCase() === userId.toLowerCase())) {
        throw new Error(`User ID "${userId}" is already taken. Please choose another.`);
      }
      if (localUsers.some((u) => u.email.toLowerCase() === email)) {
        throw new Error(`Email "${email}" is already registered. Please sign in instead.`);
      }

      let authUser = null;
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        authUser = cred.user;
      } catch (authErr) {
        console.warn("Auth registration notice:", authErr.message);
      }

      const newUser = {
        userId,
        email,
        password: pass,
        role: "user",
        status: "active",
        emailVerified: false,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        lastLoginIp: clientIp
      };

      saveLocalUser(newUser);
      try {
        await setDoc(doc(usersCol, userId), { ...newUser, createdAt: Timestamp.now(), lastLogin: Timestamp.now() });
      } catch { }

      // Dispatch real email verification and welcome modal
      await sendUserVerificationEmail(newUser, authUser);

      // Create first store
      document.dispatchEvent(new CustomEvent("create-initial-store", {
        detail: { user: newUser, storeName }
      }));

      $("authOverlay").classList.add("hidden");
      saveSession(newUser, true);
      toast(`Account created! Verification link sent to ${email}. Check your inbox.`);
    } catch (err) {
      $("regError").textContent = err.message;
      $("regError").classList.remove("hidden");
    }
  });

  // 3. Google Sign In
  $("btnGoogleSignIn")?.addEventListener("click", async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const gUser = result.user;

      const localUsers = getLocalUsers();
      let userData = localUsers.find((u) => u.email.toLowerCase() === gUser.email.toLowerCase());

      if (!userData) {
        const generatedId = (gUser.displayName || gUser.email.split("@")[0]).replace(/[^a-zA-Z0-9]/g, "") || "GoogleUser";
        let uniqueId = generatedId;
        let count = 1;
        while (localUsers.some((u) => u.userId.toLowerCase() === uniqueId.toLowerCase())) {
          uniqueId = generatedId + count++;
        }

        userData = {
          userId: uniqueId,
          email: gUser.email.toLowerCase(),
          displayName: gUser.displayName || "",
          password: "",
          role: "user",
          status: "active",
          emailVerified: gUser.emailVerified,
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          lastLoginIp: clientIp
        };

        saveLocalUser(userData);
        try {
          await setDoc(doc(usersCol, uniqueId), { ...userData, createdAt: Timestamp.now(), lastLogin: Timestamp.now() });
        } catch { }

        document.dispatchEvent(new CustomEvent("create-initial-store", {
          detail: { user: userData, storeName: `${uniqueId}'s Store` }
        }));
      }

      if (isDeleted(gUser.email) || (userData && (isDeleted(userData.userId) || isDeleted(userData.email)))) {
        throw new Error("This account no longer exists.");
      }

      if (userData.status === "suspended") {
        throw new Error("Your account has been suspended by the administrator.");
      }

      $("authOverlay").classList.add("hidden");
      saveSession(userData, true);
      toast(`Signed in with Google as ${userData.userId}`);
    } catch (err) {
      $("loginError").textContent = err.message;
      $("loginError").classList.remove("hidden");
    }
  });

  // 4. Forgot Password Trigger (Step 1 & Step 2 with OTP)
  let pendingForgotUser = null;

  $("forgotForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ident = $("forgotIdentifier").value.trim().toLowerCase();
    $("forgotError").classList.add("hidden");

    try {
      const localUsers = getLocalUsers();
      let found = localUsers.find((u) => u.email.toLowerCase() === ident || u.userId.toLowerCase() === ident);

      // Cloud lookup fallback
      if (!found) {
        try {
          if (ident.includes("@")) {
            const q = query(usersCol, where("email", "==", ident));
            const snap = await getDocs(q);
            if (!snap.empty) found = snap.docs[0].data();
          } else {
            const snap = await getDoc(doc(usersCol, ident));
            if (snap.exists()) found = snap.data();
          }
        } catch {}
      }

      if (!found || isDeleted(ident) || isDeleted(found.userId) || isDeleted(found.email)) {
        $("forgotError").textContent = "No ID found.";
        $("forgotError").classList.remove("hidden");
        return;
      }

      pendingForgotUser = found;
      await sendUserPasswordResetEmail(found);

      // Transition to Step 2: OTP submission
      $("forgotStep1")?.classList.add("hidden");
      $("forgotStep2")?.classList.remove("hidden");
      if ($("forgotSuccess")) {
        $("forgotSuccess").textContent = `✅ 6-digit verification code sent to ${found.email}. Enter the code and your new password below:`;
      }
      if ($("forgotOtpInput")) $("forgotOtpInput").value = "";
      if ($("forgotNewPass")) $("forgotNewPass").value = "";
      $("forgotStep2Error")?.classList.add("hidden");
      toast(`Verification code sent to ${found.email}`);
    } catch (err) {
      let msg = err.message || "No ID found.";
      if (err.code === "auth/user-not-found" || msg.includes("No ID found")) {
        msg = "No ID found.";
      }
      $("forgotError").textContent = msg;
      $("forgotError").classList.remove("hidden");
    }
  });

  // Step 2: Verify OTP and Reset Password
  $("btnVerifyOtpAndResetPass")?.addEventListener("click", async () => {
    if (!pendingForgotUser) return;
    const code = ($("forgotOtpInput")?.value || "").trim();
    const newPass = ($("forgotNewPass")?.value || "");
    const errEl = $("forgotStep2Error");
    if (errEl) errEl.classList.add("hidden");

    if (!code || code.length !== 6) {
      if (errEl) { errEl.textContent = "Please enter the 6-digit verification code."; errEl.classList.remove("hidden"); }
      return;
    }
    if (newPass.length < 6) {
      if (errEl) { errEl.textContent = "New password must be at least 6 characters."; errEl.classList.remove("hidden"); }
      return;
    }

    const check = verifyOtpCode("reset", pendingForgotUser.email, code);
    if (!check.valid) {
      if (errEl) { errEl.textContent = check.error || "Invalid verification code."; errEl.classList.remove("hidden"); }
      return;
    }

    // Code is valid! Update user password
    pendingForgotUser.password = newPass;
    saveLocalUser(pendingForgotUser);

    try {
      await updateDoc(doc(usersCol, pendingForgotUser.userId), { password: newPass });
    } catch {}

    // Dispatch Password Changed Security Email
    try {
      await sendPasswordChangedEmail(pendingForgotUser);
    } catch {}

    toast("Password updated successfully! Please sign in with your new password.");
    $("authTabSignIn")?.click();
    if ($("loginId")) $("loginId").value = pendingForgotUser.userId;
    if ($("loginPass")) $("loginPass").value = "";
    pendingForgotUser = null;
  });

  $("btnBackToForgotStep1")?.addEventListener("click", () => {
    $("forgotStep2")?.classList.add("hidden");
    $("forgotStep1")?.classList.remove("hidden");
  });

  // Open OTP Verification Modal for Email Verification
  $("btnOpenOtpVerifyModal")?.addEventListener("click", () => {
    if (!currentUser) return;
    if ($("otpVerifyEmailDisplay")) $("otpVerifyEmailDisplay").textContent = currentUser.email || "";
    if ($("otpCodeInput")) $("otpCodeInput").value = "";
    $("otpVerifyError")?.classList.add("hidden");
    $("otpVerifySuccess")?.classList.add("hidden");
    $("otpVerifyModal")?.showModal();
  });

  // Resend code inside OTP modal
  $("btnResendOtpInsideModal")?.addEventListener("click", async () => {
    if (!currentUser) return;
    try {
      await sendUserVerificationEmail(currentUser, auth.currentUser);
      toast(`New verification code sent to ${currentUser.email}!`);
    } catch (e) {
      toast("Error resending code: " + (e.message || e), true);
    }
  });

  // Submit OTP Code for Email Verification
  $("otpVerifyForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const code = ($("otpCodeInput")?.value || "").trim();
    const errEl = $("otpVerifyError");
    const succEl = $("otpVerifySuccess");
    if (errEl) errEl.classList.add("hidden");
    if (succEl) succEl.classList.add("hidden");

    if (!code || code.length !== 6) {
      if (errEl) { errEl.textContent = "Please enter the 6-digit verification code."; errEl.classList.remove("hidden"); }
      return;
    }

    const check = verifyOtpCode("verify", currentUser.email, code);
    if (!check.valid) {
      if (errEl) { errEl.textContent = check.error || "Invalid verification code."; errEl.classList.remove("hidden"); }
      return;
    }

    // Mark as verified!
    currentUser.emailVerified = true;
    saveLocalUser(currentUser);
    saveSession(currentUser);

    try {
      await updateDoc(doc(usersCol, currentUser.userId), { emailVerified: true });
    } catch {}

    updateAuthUI();
    if (succEl) {
      succEl.textContent = "✅ Email verified successfully!";
      succEl.classList.remove("hidden");
    }
    toast("Email verified successfully!");

    setTimeout(() => {
      $("otpVerifyModal")?.close();
    }, 900);
  });

  // Resend Verification Email Trigger from Banner
  $("resendVerificationBtn")?.addEventListener("click", async () => {
    if (!currentUser || !currentUser.email) return;
    try {
      await sendUserVerificationEmail(currentUser, auth.currentUser);
      toast(`Verification email sent to ${currentUser.email}! Check your inbox.`);
    } catch (err) {
      toast("Error resending email: " + (err.message || err), true);
    }
  });

  // Email Verified Custom Event
  document.addEventListener("email-verified", (e) => {
    if (currentUser) {
      currentUser.emailVerified = true;
      saveLocalUser(currentUser);
      saveSession(currentUser);
      updateAuthUI();
    }
  });

  // Impersonation Exit Trigger
  $("exitImpersonationBtn")?.addEventListener("click", () => {
    if (impersonatorAdmin) {
      currentUser = impersonatorAdmin;
      impersonatorAdmin = null;
      $("impersonationBanner").classList.add("hidden");
      updateAuthUI();
      toast("Returned to Master Admin dashboard.");
    }
  });

  // Logout Trigger
  $("headerLogoutBtn")?.addEventListener("click", logoutSession);
  $("dropdownLogoutBtn")?.addEventListener("click", logoutSession);
  $("landingLogoutBtn")?.addEventListener("click", logoutSession);
}

export function setImpersonation(targetUser) {
  impersonatorAdmin = currentUser;
  currentUser = targetUser;
  updateAuthUI();
}

