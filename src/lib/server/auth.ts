import crypto from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { and, eq, gt, asc } from "drizzle-orm";
import { db } from "@/db";
import { users, sessions, members, restaurants } from "@/db/schema";
import { ApiError } from "./http";
import { can, type AppModule } from "@/lib/permissions";

const COOKIE = "cp_session";
const SESSION_DAYS = 30;

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `s1$${salt}$${hash}`;
}
export function verifyPassword(pw: string, stored: string) {
  const [v, salt, hash] = stored.split("$");
  if (v !== "s1" || !salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const orig = Buffer.from(hash, "hex");
  return orig.length === test.length && crypto.timingSafeEqual(orig, test);
}

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt });
  const h = await headers();
  const secure = h.get("x-forwarded-proto") === "https";
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", expires: expiresAt });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(COOKIE);
}

export type SessionUser = { id: string; email: string; name: string; emailVerified: boolean };

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, emailVerified: users.emailVerified })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
});

export type Restaurant = typeof restaurants.$inferSelect;
export type Ctx = { user: SessionUser; restaurant: Restaurant; role: string; restaurantId: string };

/** Resolves the caller's tenant from DB membership – never from client input. */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const rows = await db
    .select({ restaurant: restaurants, role: members.role })
    .from(members)
    .innerJoin(restaurants, eq(restaurants.id, members.restaurantId))
    .where(and(eq(members.userId, user.id), eq(members.status, "ACTIVE")))
    .orderBy(asc(members.createdAt))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { user, restaurant: r.restaurant, role: r.role, restaurantId: r.restaurant.id };
});

/** For API routes. Throws 401/403 unless caller is a member whose role may access `mod`. */
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
