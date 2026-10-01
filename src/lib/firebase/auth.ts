"use client";
import {
  applyActionCode, confirmPasswordReset, createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail,
  EmailAuthProvider, reauthenticateWithCredential, signInWithCustomToken, updatePassword, signInWithEmailAndPassword, signOut, updateProfile, verifyPasswordResetCode, type User,
} from "firebase/auth";
import { getClientAuth } from "./client";

/**
 * Browser-side Firebase Authentication. Passwords only ever go to Firebase Auth — never to our API and never to
 * Firestore. After a successful sign-in the fresh ID token is exchanged for an httpOnly session cookie
 * (POST /api/auth/session) which the server uses for dashboards and API routes.
 */

const base = () => (typeof window === "undefined" ? "" : window.location.origin);

async function postJson<T>(url: string, json?: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json ?? {}), cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong.");
  return data as T;
}

/** Human-readable messages for Firebase Auth error codes. Never reveals whether an email exists. */
export function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in.";
    case "auth/weak-password":
      return "Password must be at least 8 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "Network problem. Check your connection and try again.";
    case "auth/expired-action-code":
    case "auth/invalid-action-code":
      return "This link is invalid or has expired. Request a new one.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/requires-recent-login":
      return "Please sign in again to continue.";
    default:
      return (e as Error)?.message || "Something went wrong.";
  }
}

export async function establishSession(name?: string) {
  const user = getClientAuth().currentUser;
  if (!user) throw new Error("You are not signed in.");
  const idToken = await user.getIdToken(true);
  return postJson<{ ok: boolean; emailVerified: boolean }>("/api/auth/session", { idToken, name });
}

export async function signUpWithEmail(name: string, email: string, password: string) {
  const auth = getClientAuth();
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(cred.user, { displayName: name.trim() });
  await sendEmailVerification(cred.user, { url: `${base()}/verify-email` }).catch(() => undefined);
  return establishSession(name.trim());
}

export async function signInWithEmail(email: string, password: string) {
  await signInWithEmailAndPassword(getClientAuth(), email.trim(), password);
  return establishSession();
}

export async function signOutEverywhere() {
  await postJson("/api/auth/logout").catch(() => undefined);
  await signOut(getClientAuth()).catch(() => undefined);
}

export async function requestPasswordReset(email: string) {
  // Firebase intentionally succeeds for unknown emails (enumeration protection).
  await sendPasswordResetEmail(getClientAuth(), email.trim(), { url: `${base()}/login` });
}

export async function checkResetCode(oobCode: string) {
  return verifyPasswordResetCode(getClientAuth(), oobCode);
}

export async function completePasswordReset(oobCode: string, password: string) {
  await confirmPasswordReset(getClientAuth(), oobCode, password);
}

export async function applyVerificationCode(oobCode: string) {
  await applyActionCode(getClientAuth(), oobCode);
}

export async function resendVerificationEmail() {
  const u = getClientAuth().currentUser;
  if (!u) throw new Error("Sign in first to resend the verification email.");
  await sendEmailVerification(u, { url: `${base()}/verify-email` });
}

/** Reloads the Firebase user and refreshes the server session if the address is now verified. */
export async function refreshVerification(): Promise<boolean> {
  const u = getClientAuth().currentUser;
  if (!u) return false;
  await u.reload();
  if (u.emailVerified) await establishSession();
  return u.emailVerified;
}

/** Joins a team using an invitation (the role is decided by the stored invitation, not by this call). */
export async function acceptInvite(args: { token: string; email: string; existingAccount: boolean; name: string; password: string }) {
  let idToken: string | undefined;
  if (args.existingAccount) {
    await signInWithEmailAndPassword(getClientAuth(), args.email, args.password);
    idToken = await getClientAuth().currentUser!.getIdToken(true);
    await postJson("/api/auth/accept-invite", { token: args.token, idToken });
  } else {
    await postJson("/api/auth/accept-invite", { token: args.token, name: args.name, password: args.password });
    await signInWithEmailAndPassword(getClientAuth(), args.email, args.password);
  }
  await establishSession(args.name || undefined);
}

/**
 * The httpOnly cookie keeps the server session alive, but Firestore listeners need a *client* sign-in.
 * If IndexedDB persistence was cleared, re-sign-in with a custom token minted for the cookie's user.
 */
export async function ensureClientSignedIn(): Promise<User | null> {
  const auth = getClientAuth();
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  const res = await fetch("/api/auth/token", { cache: "no-store" });
  if (!res.ok) return null;
  const { token } = (await res.json()) as { token: string };
  return (await signInWithCustomToken(auth, token)).user;
}

/** Re-authenticates with the current password (Firebase requires it), then updates it. */
export async function changePassword(current: string, next: string) {
  const u = getClientAuth().currentUser;
  if (!u || !u.email) throw new Error("Please sign in again to change your password.");
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, current));
  await updatePassword(u, next);
  await postJson("/api/auth/password-changed").catch(() => undefined);
}

export const onClientUser = (cb: (u: User | null) => void) => onAuthStateChanged(getClientAuth(), cb);
