# Store Manager — Complete System Architecture & Reference Manual

> **Purpose of this Document:**  
> This file contains the complete system architecture, file map, data schemas, security boundaries, and operational workflows for **Store Manager**. Refer to this manual for instant understanding of the application's structure without having to re-analyze code files.

---

## 1. Executive Summary & Core Platform Specifications

- **Platform Name:** Store Manager
- **Domain / Tagline:** Public Multi-Store Cloud POS, Inventory & Analytics
- **Primary Architecture:** Modular Vanilla ES6 JavaScript (zero build step) + Tailwind CSS CDN + Firebase Firestore + SheetJS (XLSX) + Chart.js.
- **Local Dev Server:** `start-server.bat` (uses zero-dependency Windows PowerShell `System.Net.HttpListener` on port `5000`).

---

## 2. Pre-Configured Platform Accounts

| Role | User ID | Password | Email | Assigned Store | Privileges |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Master Admin** | `Admin` | `admin123` | `rafidmahi.007@gmail.com` | Global (All Stores) | Master Admin Dashboard, user directory, impersonation, activity logs with IP, account suspension. Excluded from client user directory. |
| **Store Owner** | `Oboshor` | `Oboshor123` | `oboshor24@gmail.com` | `oboshor_store` ("Oboshor Varieties Store") | Full store management, sales recording, product catalog, collaborator invitations, Excel import/export. |

---

## 3. Modular File Directory & Responsibilities

```
c:\Users\Mahi\Downloads\files (2)\
├── index.html                  # Single-Page App UI shell (landing, navigation, panels, modals)
├── style.css                   # Global styling tokens, buttons, cards, strict .hidden rules
├── app.js                      # Master application orchestrator, event bus, tab routing
├── start-server.bat            # 1-click Windows local development server (port 5000)
├── PROJECT_DOCUMENTATION.md    # This technical reference manual
├── data/
│   ├── seed-products.json      # 1,140 verified store product catalog items
│   └── seed-sells.json         # 752 daily sales historical records
└── js/
    ├── config.js               # Firebase configuration, Firestore collections, utilities, logger
    ├── auth.js                 # Authentication, session manager, role boundaries, email verification
    ├── stores.js               # Multi-store manager, store switcher, collaborator access sharing
    ├── products.js             # Product catalog, real-time search, price change audit history
    ├── sells.js                # Daily sales transactions, net profit, khoroch (expenses), dues
    ├── analytics.js            # Interactive Chart.js charts (14d, 30d, 90d, 365d), KPIs
    ├── admin.js                # Master Admin dashboard, user metrics, logs, impersonation
    ├── data-io.js              # Dedicated file imports (sells vs prods), robust Excel backup download
    └── email.js                # Email notification engine (welcome, verification, password reset)
```

---

## 4. Architectural Deep Dive by Module

### `index.html` (Application UI Structure)
- **Header (`<header>`):**
  - Brand identity (`Store Manager`).
  - Active store switcher dropdown (`#storeSwitcherContainer`, hidden for logged-out & admin).
  - Main navigation tabs (`#tabs`): Store Owner tabs (`#userStoreTabs`) vs Master Admin tab (`#navAdminTab`).
  - Top-right Profile Dropdown (`#profileDropdownBtn` & `#profileDropdownMenu`):
    - Shows user avatar image (`#headerAvatarImg` / fallback `👤`).
    - Name, email, and role badge.
    - Options: **✏️ Edit Profile**, **🔑 Change Password**, **🚪 Sign Out**.
- **View Sections:**
  1. `#landingView`: Public visitor landing page (Hero banner, 6 core pillars, features, CTA). Shows ZERO internal tabs or store switchers when logged out.
  2. `#appView`: Authenticated store owner workspace containing 4 panels:
     - `#home`: Dashboard with KPI metrics, time-frame filters, interactive charts, and "Store Access" shortcut button.
     - `#sells`: Daily sales records, date picker, morning/night cash calculation, expenses, dues.
     - `#prices`: Product list, real-time duplicate detection, price history inspection.
     - `#data`: Import & Export (dedicated Sells import, dedicated Products import, Excel backup, store settings, collaborator sharing, danger zone).
  3. `#admin`: Master Admin dashboard (Metrics, client user table, store counts, system logs with IP).
- **Dialogs & Modals (`<dialog>`):**
  - `#authOverlay`: Unified Sign In, Register, and Forgot Password modal with eye toggles.
  - `#editProfileModal`: Update profile photo (upload/preview/remove), email, phone, and store name.
  - `#pwdDialog`: Change password modal with current password check and eye toggles.
  - `#storeDialog`: Create new store modal.
  - `#deleteConfirmDialog`: Sensitive record deletion modal requiring User ID and Password verification.
  - `#emailPreviewModal`: Real-time simulated email viewer for verification & password reset links.

---

### `js/auth.js` (Identity & Role Boundaries)
- **Storage Keys:**
  - `sm_auth_session_user`: Stored session for the authenticated user (`localStorage` if remember me is checked, otherwise `sessionStorage`).
  - `sm_users_directory`: Local client user directory cache.
  - `sm_deleted_users`: Persistent blacklist array of deleted account identifiers (`userId` and `email`). Any user matching this list is permanently blocked from login, registration recovery, and session restore.
- **Deleted User Enforcement:**
  - `markUserDeleted(userOrId)`: Persists user ID and email to the `sm_deleted_users` blacklist.
  - `isDeleted(userOrIdOrEmail)`: Checks case-insensitively whether a given ID or email is blacklisted.
  - `getLocalUsers()`: Automatically filters out blacklisted users, preventing `DEFAULT_USERS` (such as `Oboshor`) from being resurrected after deletion.
  - `saveLocalUser(user)`: Refuses to save or resurrect any user present in `isDeleted()`.
  - `restoreSession()`: Validates that the stored user is not in `isDeleted()`, still exists in the directory, and is not suspended. If invalid, the session is purged instantly.
  - `signInForm` & `btnGoogleSignIn`: Check `isDeleted` immediately, throwing `"This account no longer exists."` if an account was deleted by admin.
- **Immediate Real-Time Session Revocation:**
  - **Cross-Tab (`storage` Event):** Listens to `sm_deleted_users`, `sm_users_directory`, and `sm_auth_session_user`. If another tab deletes or suspends the user, the active tab terminates the session instantly, purges keys, resets UI to landing view, and alerts the user.
  - **Window Focus (`focus` Event):** When a user switches back to an open tab, session validity is verified immediately; deleted or suspended users are logged out on the spot.
  - **Same-Tab (`admin-session-patch` CustomEvent):** Dispatches in-memory session updates when admin operations (suspend, delete, verify) occur in the same browser window.
- **Role Enforcement Rules:**
  - `admin`: Has access ONLY to `#admin` panel. Store tabs, store switcher, and POS operations are hidden.
  - `user`: Has access to store panels (`home`, `sells`, `prices`, `data`). The `#navAdminTab` is set to `display: none !important;` and route guard in `app.js` forces any `#admin` hash back to `#home`.
  - `visitor` (logged out): All tabs (`#tabs`) and store switcher are completely hidden (`display: none !important;`). Only public landing view and Sign In / Create Store buttons appear.
- **Forgot Password Workflow:**
  - If email or user ID has no account or is deleted: displays strict error `"No ID found."`
  - If account exists: generates 6-digit OTP code, dispatches reset email, and transitions to Step 2 where the user enters the 6-digit code and sets their new password.
- **OTP Account Verification:**
  - Users can click "Enter Verification Code" in the top banner to open `#otpVerifyModal`, submit their 6-digit code, and instantly verify their email.
- **Profile Picture Rendering & Size Limits:**
  - Profile photo uploads are strictly constrained to a maximum of **150 KB**. High-resolution images are auto-cropped to square and progressively compressed via canvas JPEG loop (`app.js`).
  - `updateAuthUI()` automatically updates both header and dropdown avatar images with `currentUser.profilePicture` (or shows the fallback `👤` icon).

---

### `js/email.js` (5 Core Notification Triggers & OTP Management)
The email service coordinates 5 critical transactional notifications:
1. **New Account Created:** Dispatches welcome message + 6-digit email verification OTP code.
2. **Password Changed:** Dispatches security alert informing the user their password was updated.
3. **Forgot Password Request:** Dispatches password reset link + 6-digit OTP code (expires in 15 minutes).
4. **Store Invite Sent:** Dispatches confirmation notice to the store owner that access was granted to a collaborator.
5. **Store Invite Received:** Dispatches invitation notice to the invited user alerting them they now have access to manage the store.
- **OTP Engine:** In-memory + localStorage store with 15-minute expiration timestamp and `verifyOtpCode()` validation.

---

### `js/admin.js` (Master Admin Operations)
- **Account Deletion with Store Cascade:** Master Admin can click **`🗑 Delete`** in the User Directory to permanently remove an account. Deleting an account adds the user's ID and email to the `sm_deleted_users` blacklist, removes them from `sm_users_directory`, cascade-deletes all stores and records owned by that user, removes their document from Firestore, clears active session keys, and triggers immediate logout across all open tabs.
- **Strict Store Count Aggregation:** `admTotalStores` counts ONLY stores belonging to currently active, registered store users (`regularUsers`). Phantom, orphaned, or deleted user stores (such as `oboshor_store` if `Oboshor` was deleted) are automatically excluded, ensuring the top KPI card always matches the exact sum of stores in the User Directory table.
- **User Stores Inspector Modal (`#userStoresModal`):** Clicking on any user in the table opens their complete store list. Master Admin can:
  1. **Enter Store (Login as User):** Switch into that user's perspective via impersonation.
  2. **Delete Store (`data-admin-delete-store`):** Permanently delete any specific store owned by that user directly from the admin panel.
- **Account Suspension & Activation:** Admin can click **`⛔ Suspend`** / **`✓ Activate`**. Suspended users are instantly kicked out of their session in real time and blocked from logging in.
- **Manual Account Verification:** Master Admin can click the green **`✓ Verify`** button in the User Directory to manually verify any user account without requiring them to click email links. Patches the session so the verification warning banner disappears instantly.
- **User Directory Filtering:** Explicitly filters out `Admin` (`u.userId !== "Admin"`) so Master Admin never appears as a client store user.
- **Security Audit Logs:** Tracks actions with client IP, timestamp, and details (`sm_activity_logs`).

---

### `js/stores.js` (Multi-Store & Collaborator Access)
- **Top-Level Exports:** `currentStore`, `userStores`, `DEFAULT_STORES`, `getLocalStores`, `saveLocalStore`, `getStoredStoreId`, `setStoredStoreId`, `refreshUserStores`, `updateStoreHeaderUI`, `createInitialStoreForUser`, `setupStoreListeners`, `renderCollaborators`.
- **Data Model:**
  ```javascript
  {
    id: "store_12345",
    name: "My Retail Store",
    category: "Varieties Store",
    ownerId: "Oboshor",
    ownerEmail: "oboshor24@gmail.com",
    phone: "01700000000",
    address: "Location",
    currency: "৳",
    collaborators: [
      { userId: "employee1", email: "emp@mail.com", addedAt: "...", addedBy: "Oboshor" }
    ],
    createdAt: "..."
  }
  ```
- **Store Access Sharing Logic:**
  - `refreshUserStores()` matches stores owned by `currentUser` OR where `currentUser.userId` / `currentUser.email` exists in `store.collaborators`.
  - Store owners can invite another registered user by User ID or Email (`#inviteCollaboratorForm`).
  - Duplicates, self-invitations, and invalid users are validated with inline error messages.
  - Owners can revoke access at any time via the "Revoke" button.
  - Collaborators see an informative banner: `"You are accessing this store as an authorized collaborator."` and cannot invite or revoke others.
  - `renderCollaborators()` is exported at module top level (never inside listener functions) to conform with standard ES Module specification.

- **Store Deletion by User:**
  - Accessible from two locations:
    1. **Current Store Settings** (`#btnDeleteStoreFromSettings`): Direct quick action next to "Save Store Info".
    2. **Danger Zone** (`#btnDeleteStore`): High-visibility red action in the danger zone card.
  - **Ownership Authorization Guard:** Only store owners (or Master Admin) can delete a store. When accessed by an invited collaborator, the delete buttons are automatically hidden.
  - **Verification Dialog (`#deleteConfirmDialog`):** Requires the user to enter their User ID/Email and Password to prevent accidental deletion.
  - **Blacklist System (`sm_deleted_stores`):** Blacklists the deleted store ID in localStorage to prevent default stores (like `oboshor_store`) or cloud sync from re-adding them.
  - **Cascading Data Purge:** Batch deletes all daily sales records and product catalog entries belonging to the store from Firestore and local state.
  - **Smooth Store Switching:** If the user owns multiple stores, the system immediately switches to their next available store. If the deleted store was their only store, a clean fresh store (`<userId>'s Store`) is initialized automatically.
  - **Audit Logging:** Logs the action to `activity_logs` with client IP and timestamp.

---

### `js/data-io.js` (Import, Export, Backup & Danger Zone)
- **Separate Upload Fields:**
  - **Import Daily Sells (`#importSellsFile`):** Parses `.xlsx`, `.xls`, `.csv` specifically for sales records (`Date`, `Morning Amount`, `Night Amount`, `Khoroch`, `Due`, `Notes`).
  - **Import Product List (`#importProductsFile`):** Parses `.xlsx`, `.xls`, `.csv` specifically for catalog records (`Product Name`, `Cost Price`, `Sell Price`).
- **Robust Excel Backup (`#exportBtn`):**
  - Generates a verified `.xlsx` file containing two structured sheets: `Price List` and `Daily Sells`.
  - Safe against empty stores: creates pre-defined headers even when records are 0.
  - Auto-calculated column widths (`!cols`) for clean viewing in Microsoft Excel or Google Sheets.
  - File naming format: `<clean-store-name>-backup-<YYYY-MM-DD>.xlsx`.
- **Danger Zone Deletion Actions:**
  - **Delete All Daily Sells (`#btnDeleteSells`):** Batch wipes only sales records for current store.
  - **Delete All Products (`#btnDeleteProducts`):** Batch wipes only catalog records for current store.
  - **Delete Everything in Store (`#btnDeleteEverything`):** Wipes both sales and products, preserving store shell.
  - **Delete Store Permanently (`#btnDeleteStore`):** Purges the entire store entity, catalog, and sales.

---

### `js/products.js` & `js/sells.js`
- **Product Duplicate Protection:** When adding a new product, typing the name searches existing products in real-time. If it exists, a quick-select option allows updating the price rather than creating duplicate entries.
- **Price History Audit:** Every price edit appends to the `history` array with `{ costPrice, sellPrice, updatedAt, updatedBy }`. Clicking on any product displays its complete historical timeline with timestamps.
- **Daily Sells Calculation:**
  $$\text{Total Net Sell} = \text{Night Cash} - \text{Morning Cash}$$
  $$\text{Est. Profit} = \text{Total Net Sell} \times \text{Avg Margin Rate} - \text{Khoroch}$$

---

### `js/analytics.js` (Visual Business Intelligence)
- Powered by Chart.js with responsive canvas resizing.
- Dropdown range selector: **Last 14 Days**, **Last 30 Days (Month)**, **Last 90 Days (Quarter)**, and **Yearly View**.
- Hover tooltips display date, total net sales, expenses, and dues.

---

### `js/admin.js` (Master Admin Operations)
- **User Directory Filtering:** Explicitly filters out `Admin` (`u.userId !== "Admin"`) so Master Admin never appears as a client store user.
- **Store Count Aggregation:** Dynamically calculates how many stores each registered user owns. Clicking on a user opens their complete store list.
- **Login as User (Impersonation):** Admin can click "Access Store" on any user to switch to their perspective. An amber bar (`#impersonationBanner`) allows returning to Admin dashboard at any time.
- **Security Audit Logs:** Tracks actions with client IP, timestamp, and details (`sm_activity_logs`).

---

## 5. CSS Specificity & Display Invariants (`style.css`)

To prevent CSS collisions between Tailwind CSS utility classes and custom `.nav` / `.nav button` rules:
```css
/* Bulletproof Hidden Utility Enforcement */
.hidden,
[hidden],
.nav.hidden,
#tabs.hidden,
#userStoreTabs.hidden,
.nav button.hidden,
#navAdminTab.hidden {
  display: none !important;
}
```
**Rule:** When showing/hiding tabs in JavaScript, always use `style.setProperty("display", "none", "important")` when hiding, and `style.removeProperty("display")` when showing.

---

## 6. How to Run Locally

1. Open PowerShell or Command Prompt in the project folder:
   ```cmd
   cd "c:\Users\Mahi\Downloads\files (2)"
   ```
2. Double-click or execute:
   ```cmd
   start-server.bat
   ```
3. The server starts at `http://localhost:5000/` and automatically opens your default browser.

---

## 7. Firebase Configuration Guide (Enabling Real Emails & Google Sign-In)

The application connects to Firebase Project `oboshor-store`. Follow these exact steps in the Firebase Console to enable production email delivery and Google Sign-In:

### A. Enabling Real Emails (Password Reset & Email Verification)
1. Navigate to the **[Firebase Console](https://console.firebase.google.com/)** and select **`oboshor-store`**.
2. In the left sidebar, go to **Build** → **Authentication**.
3. Under the **Sign-in method** tab:
   - Click on **Email/Password**.
   - Make sure the first toggle **Email/Password** is **Enabled**. Click **Save**.
4. In the top navigation of Authentication, click on **Templates**:
   - Select **Password reset**: customize sender display name (e.g. `Store Manager`) and reply-to email.
   - Select **Email address verification**: customize sender display name.
5. In the top navigation of Authentication, click on **Settings** → **Authorized domains**:
   - Ensure `localhost` is present in the list (it is added by default).
   - If hosting publicly (e.g. on Firebase Hosting, GitHub Pages, or a custom domain), click **Add domain** and enter your domain name.

### B. Enabling Sign in with Google
1. In Firebase Console, go to **Build** → **Authentication** → **Sign-in method**.
2. Click **Add new provider** and select **Google**.
3. Toggle the switch to **Enable**.
4. Select your support email address from the **Project support email** dropdown (e.g. `rafidmahi.007@gmail.com`).
5. Click **Save**.
6. In **Settings** → **Authorized domains**, make sure `localhost` is listed.
7. You're done! Users can now click **Sign in with Google** on the Store Manager login modal.

---

## 8. How to Host on Vercel

Store Manager is a static SPA with zero build requirements. It deploys to Vercel instantly:

### Method 1: Deploying via GitHub (Recommended)
1. Initialize git and push your repository to GitHub:
   ```cmd
   git init
   git add .
   git commit -m "Deploy Store Manager"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```
2. Open **[vercel.com](https://vercel.com/)** and log in with GitHub.
3. Click **Add New...** → **Project**.
4. Import your `store-manager` repository.
5. In the project configure screen:
   - **Framework Preset:** Select `Other`.
   - **Root Directory:** Leave as `./` (default).
   - **Build and Output Settings:** Leave all toggles empty / default (no build command needed).
6. Click **Deploy**. Vercel will deploy the site in 5–10 seconds and generate a live URL (e.g., `https://store-manager-xyz.vercel.app`).

### Method 2: Deploying via Vercel CLI (Quick Terminal Deploy)
1. Install Vercel CLI:
   ```cmd
   npm install -g vercel
   ```
2. Inside this project folder (`c:\Users\Mahi\Downloads\files (2)`), run:
   ```cmd
   vercel
   ```
3. Follow the prompts:
   - Set up and deploy? **Y**
   - Which scope? Select your account.
   - Link to existing project? **N**
   - What's your project's name? **store-manager**
   - In which directory is your code located? **./**
4. For production deployment:
   ```cmd
   vercel --prod
   ```

### ⚠️ CRITICAL Post-Deployment Step (Firebase Authorized Domain)
Once your Vercel URL is generated (e.g. `https://your-store.vercel.app`):
1. Go to **[Firebase Console](https://console.firebase.google.com/)** → **`oboshor-store`**.
2. Go to **Build** → **Authentication** → **Settings** tab.
3. Scroll down to **Authorized domains**.
4. Click **Add domain** and enter your Vercel domain (e.g. `your-store.vercel.app`).
5. Click **Save**.
*(If you skip this step, Google Sign-In and popup authentication will fail with `auth/unauthorized-domain`).*
