import crypto from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";
import { repos, type Restaurant, type Role } from "@/lib/repositories";
import { serverEnv } from "@/config/env";
import { ApiError } from "./http";
import { can, type AppModule } from "@/lib/permissions";

/** `__session` is the only cookie Firebase Hosting / Cloud Run proxies forward. */
export const SESSION_COOKIE = "__session";

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");
/** URL-safe token for public QR / order links (stable, unguessable). */
export const publicToken = (bytes = 18) => crypto.randomBytes(bytes).toString("base64url");

export type SessionUser = { id: string; email: string; name: string; emailVerified: boolean };

/**
 * Exchanges a freshly minted Firebase ID token for an httpOnly session cookie.
 * Firebase requires a recent sign-in; stale tokens are rejected.
 */
export async function createSession(idToken: string): Promise<SessionUser> {
  const auth = getAdminAuth();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken, true);
  } catch {
    throw new ApiError("Your sign-in could not be verified. Please try again.", 401, "UNAUTHENTICATED");
  }
  if (Date.now() / 1000 - decoded.auth_time > 5 * 60) throw new ApiError("Please sign in again to continue.", 401, "RECENT_LOGIN_REQUIRED");
  const days = Math.min(Math.max(serverEnv.SESSION_COOKIE_DAYS, 1), 14);
  const expiresIn = days * 86400_000;
  const cookie = await auth.createSessionCookie(idToken, { expiresIn });
  const h = await headers();
  const secure = h.get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
  (await cookies()).set(SESSION_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: Math.floor(expiresIn / 1000) });
  return { id: decoded.uid, email: decoded.email ?? "", name: (decoded.name as string | undefined) ?? "", emailVerified: !!decoded.email_verified };
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const d = await getAdminAuth().verifySessionCookie(cookie, true);
    const profile = await repos().users.get(d.uid);
    return { id: d.uid, email: d.email ?? profile?.email ?? "", name: (d.name as string | undefined) ?? profile?.name ?? "", emailVerified: !!d.email_verified };
  } catch (e) {
    if (e instanceof ApiError) throw e; // Firebase not configured is a server problem, not "signed out"
    return null; // expired / revoked / malformed cookie
  }
});

export type Ctx = { user: SessionUser; restaurant: Restaurant; role: Role; restaurantId: string };

/**
 * Resolves the caller's tenant from Firestore membership — never from client input.
 * The role comes from `restaurants/{id}/members/{uid}`; a DISABLED or missing member gets no context.
 */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const r = repos();
  const profile = await r.users.get(user.id);
  for (const rid of profile?.restaurantIds ?? []) {
    const m = await r.tenant(rid).members.get(user.id);
    if (!m || m.status !== "ACTIVE") continue;
    const restaurant = await r.restaurants.get(rid);
    if (!restaurant) continue;
    return { user, restaurant, role: m.role, restaurantId: rid };
  }
  return null;
});

/** For API routes. Throws 401/403 unless caller is an active member whose role may access `mod`. */
export async function requireCtx(mod?: AppModule | AppModule[]): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) {
    const user = await getSessionUser();
    throw new ApiError(user ? "No active workspace for this account" : "Your session has expired. Please sign in again.", user ? 403 : 401, user ? "NO_WORKSPACE" : "UNAUTHENTICATED");
  }
  if (mod) {
    const mods = Array.isArray(mod) ? mod : [mod];
    if (!mods.some((m) => can(ctx.role, m))) throw new ApiError("You do not have permission to do that.", 403, "FORBIDDEN");
  }
  return ctx;
}

export async function requireUser() {
  const u = await getSessionUser();
  if (!u) throw new ApiError("Your session has expired. Please sign in again.", 401, "UNAUTHENTICATED");
  return u;
}
