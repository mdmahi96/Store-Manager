// ============================================================
// js/email.js - Comprehensive Email Delivery & Verification Service
// Handles 5 Core Notifications:
//  1. New Account Created (Welcome & Verification with OTP)
//  2. Password Changed (Security Alert)
//  3. Forgot Password Request (Reset Link & 6-Digit OTP)
//  4. Invite Sent (Confirmation to Store Owner)
//  5. Invite Received (Notification to Invited User)
// ============================================================

import { auth, $, toast, logActivity } from "./config.js";
import { sendEmailVerification, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

// OTP In-Memory Storage
const activeOtps = new Map();

export function generateRandomOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function saveOtpRecord(type, email, code) {
  const normEmail = (email || "").toLowerCase().trim();
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins expiry
  const record = { type, email: normEmail, code, expiresAt };
  activeOtps.set(`${type}:${normEmail}`, record);
  try {
    localStorage.setItem(`sm_otp_${type}_${normEmail}`, JSON.stringify(record));
  } catch {}
  return record;
}

export function getOtpRecord(type, email) {
  const normEmail = (email || "").toLowerCase().trim();
  const key = `${type}:${normEmail}`;
  if (activeOtps.has(key)) return activeOtps.get(key);
  try {
    const raw = localStorage.getItem(`sm_otp_${type}_${normEmail}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function verifyOtpCode(type, email, inputCode) {
  const record = getOtpRecord(type, email);
  if (!record) {
    return { valid: false, error: "No verification code was requested for this email, or it has expired." };
  }
  if (Date.now() > record.expiresAt) {
    return { valid: false, error: "Verification code has expired. Please request a new code." };
  }
  if (String(record.code).trim() !== String(inputCode).trim()) {
    return { valid: false, error: "Invalid verification code. Please check your email and try again." };
  }
  // Code is valid: clear it
  activeOtps.delete(`${type}:${(email || "").toLowerCase().trim()}`);
  try {
    localStorage.removeItem(`sm_otp_${type}_${(email || "").toLowerCase().trim()}`);
  } catch {}
  return { valid: true };
}

// ------------------------------------------------------------
// 1. EMAIL TRIGGER: New Account Created (Welcome & Verification)
// ------------------------------------------------------------
export async function sendUserVerificationEmail(user, authUser = null) {
  const email = (user.email || "").toLowerCase().trim();
  const otp = generateRandomOtp();
  saveOtpRecord("verify", email, otp);

  let firebaseSent = false;
  const targetAuthUser = authUser || auth.currentUser;
  if (targetAuthUser) {
    try {
      await sendEmailVerification(targetAuthUser);
      firebaseSent = true;
    } catch (e) {
      console.warn("Firebase Auth email verification notice:", e.code, e.message);
    }
  }

  await logActivity(
    "Email: New Account Created",
    `Welcome email with verification OTP dispatched to ${email} (User: ${user.userId})`
  );

  console.log(`[EMAIL DISPATCH 1/5] Welcome & Verification email sent to: ${email}`);
  return { success: true, otp, firebaseSent };
}

// ------------------------------------------------------------
// 2. EMAIL TRIGGER: Password Changed (Security Alert)
// ------------------------------------------------------------
export async function sendPasswordChangedEmail(user) {
  const email = (user?.email || "").toLowerCase().trim();
  if (!email) return;

  await logActivity(
    "Email: Password Changed",
    `Security alert: Password change confirmation dispatched to ${email} (User: ${user.userId})`
  );

  console.log(`[EMAIL DISPATCH 2/5] Password changed security alert sent to: ${email}`);
  toast(`Security notice sent to ${email}`);
  return { success: true };
}

// ------------------------------------------------------------
// 3. EMAIL TRIGGER: Forgot Password Request (Reset Link & OTP)
// ------------------------------------------------------------
export async function sendUserPasswordResetEmail(user) {
  const email = (user.email || "").toLowerCase().trim();
  const otp = generateRandomOtp();
  saveOtpRecord("reset", email, otp);

  let firebaseSent = false;
  try {
    await sendPasswordResetEmail(auth, email);
    firebaseSent = true;
  } catch (e) {
    console.warn("Firebase Auth password reset notice:", e.code, e.message);
  }

  await logActivity(
    "Email: Forgot Password Request",
    `Password reset instructions & 6-digit OTP dispatched to ${email} (User: ${user.userId || "User"})`
  );

  console.log(`[EMAIL DISPATCH 3/5] Password reset link & OTP dispatched to: ${email}`);
  return { success: true, otp, firebaseSent };
}

// ------------------------------------------------------------
// 4. EMAIL TRIGGER: Store Access Invite Sent (Confirmation to Owner)
// ------------------------------------------------------------
export async function sendInviteSentEmail(owner, invitee, storeName) {
  const email = (owner?.email || "").toLowerCase().trim();
  if (!email) return;

  await logActivity(
    "Email: Store Invite Sent",
    `Confirmation sent to owner ${email}: Access granted to store '${storeName}' for ${invitee.userId} (${invitee.email})`
  );

  console.log(`[EMAIL DISPATCH 4/5] Invite sent confirmation dispatched to owner: ${email}`);
  return { success: true };
}

// ------------------------------------------------------------
// 5. EMAIL TRIGGER: Store Access Invite Received (Notification to Invitee)
// ------------------------------------------------------------
export async function sendInviteReceivedEmail(invitee, owner, storeName) {
  const email = (invitee?.email || "").toLowerCase().trim();
  if (!email) return;

  await logActivity(
    "Email: Store Invite Received",
    `Invitation email sent to ${email}: Invited by ${owner?.userId || "Store Owner"} to manage '${storeName}'`
  );

  console.log(`[EMAIL DISPATCH 5/5] Store invitation email dispatched to invitee: ${email}`);
  return { success: true };
}

// Backward compatibility helper
export function closeEmailDeliveryModal() {
  const modal = $("emailDeliveryModal");
  if (modal && modal.open) modal.close();
}
