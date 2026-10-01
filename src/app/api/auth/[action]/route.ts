import { z } from "zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users, authTokens, members, invitations, sessions } from "@/db/schema";
import { api, ApiError, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { createSession, destroySession, getSessionUser, hashPassword, verifyPassword, randomToken, sha256, requireUser, getCtx } from "@/lib/server/auth";
import { emailProvider } from "@/lib/server/providers";
import { publicEnv } from "@/config/env";
import { seedDemoWorkspace } from "@/lib/server/services/seed";
import { logActivity } from "@/lib/server/audit";

type P = { action: string };

const email = z.string().trim().toLowerCase().email("Enter a valid email address");
const password = z.string().min(8, "Password must be at least 8 characters").max(128);

function origin(req: Request) {
  if (publicEnv.appUrl) return publicEnv.appUrl.replace(/\/$/, "");
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function issueToken(userId: string, type: "VERIFY" | "RESET", hours: number) {
  const token = randomToken();
  await db.insert(authTokens).values({ tokenHash: sha256(token), userId, type, expiresAt: new Date(Date.now() + hours * 3600_000) });
  return token;
}

async function sendVerification(req: Request, userId: string, to: string) {
  if (!emailProvider.isConfigured()) return false;
  const token = await issueToken(userId, "VERIFY", 48);
  await emailProvider.sendVerificationEmail(to, `${origin(req)}/verify-email?token=${token}`);
  return true;
}

export const GET = api<P>(async (_req, { action }) => {
  if (action !== "me") throw new ApiError("Not found", 404);
  const ctx = await getCtx();
  const user = ctx?.user ?? (await getSessionUser());
  if (!user) return { user: null };
  return { user, role: ctx?.role ?? null, hasWorkspace: !!ctx };
});

export const POST = api<P>(async (req, { action }) => {
  const ip = clientIp(req);
  switch (action) {
    case "signup": {
      rateLimit(`signup:${ip}`, 10, 3600_000);
      const body = z.object({ name: z.string().trim().min(1, "Enter your name").max(80), email, password }).parse(await readJson(req));
      const exists = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
      if (exists.length) throw new ApiError("An account with this email already exists. Try signing in.", 409, "EMAIL_EXISTS");
      const [u] = await db.insert(users).values({ email: body.email, name: body.name, passwordHash: hashPassword(body.password) }).returning();
      await createSession(u.id);
      let verificationSent = false;
      try {
        verificationSent = await sendVerification(req, u.id, u.email);
      } catch {
        verificationSent = false;
      }
      return { ok: true, verificationSent, emailConfigured: emailProvider.isConfigured() };
    }
    case "login": {
      rateLimit(`login:${ip}`, 20, 600_000);
      const body = z.object({ email, password: z.string().min(1, "Enter your password") }).parse(await readJson(req));
      const u = (await db.select().from(users).where(eq(users.email, body.email)).limit(1))[0];
      if (!u || !verifyPassword(body.password, u.passwordHash)) throw new ApiError("Incorrect email or password.", 401, "BAD_CREDENTIALS");
      await createSession(u.id);
      return { ok: true };
    }
    case "logout": {
      await destroySession();
      return { ok: true };
    }
    case "forgot": {
      rateLimit(`forgot:${ip}`, 5, 3600_000);
      const body = z.object({ email }).parse(await readJson(req));
      if (!emailProvider.isConfigured()) throw new ApiError("Password reset email is unavailable because email is not configured on this server. Contact support.", 503, "EMAIL_NOT_CONFIGURED");
      const u = (await db.select().from(users).where(eq(users.email, body.email)).limit(1))[0];
      if (u) {
        const token = await issueToken(u.id, "RESET", 1);
        await emailProvider.sendPasswordReset(u.email, `${origin(req)}/reset-password?token=${token}`);
      }
      return { ok: true, message: "If that email has an account, a reset link is on its way." };
    }
    case "reset": {
      rateLimit(`reset:${ip}`, 10, 3600_000);
      const body = z.object({ token: z.string().min(10), password }).parse(await readJson(req));
      const t = (await db.update(authTokens).set({ usedAt: new Date() }).where(and(eq(authTokens.tokenHash, sha256(body.token)), eq(authTokens.type, "RESET"), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date()))).returning())[0];
      if (!t) throw new ApiError("This reset link is invalid or has expired.", 400, "TOKEN_INVALID");
      await db.update(users).set({ passwordHash: hashPassword(body.password) }).where(eq(users.id, t.userId));
      await db.delete(sessions).where(eq(sessions.userId, t.userId));
      return { ok: true };
    }
    case "verify": {
      const body = z.object({ token: z.string().min(10) }).parse(await readJson(req));
      const t = (await db.update(authTokens).set({ usedAt: new Date() }).where(and(eq(authTokens.tokenHash, sha256(body.token)), eq(authTokens.type, "VERIFY"), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date()))).returning())[0];
      if (!t) throw new ApiError("This verification link is invalid or has expired.", 400, "TOKEN_INVALID");
      await db.update(users).set({ emailVerified: true }).where(eq(users.id, t.userId));
      return { ok: true };
    }
    case "resend": {
      const user = await requireUser();
      rateLimit(`resend:${user.id}`, 3, 3600_000);
      if (user.emailVerified) return { ok: true, message: "Your email is already verified." };
      if (!emailProvider.isConfigured()) throw new ApiError("Email is not configured on this server, so a verification email cannot be sent.", 503, "EMAIL_NOT_CONFIGURED");
      await sendVerification(req, user.id, user.email);
      return { ok: true, message: "Verification email sent." };
    }
    case "change-password": {
      const user = await requireUser();
      const body = z.object({ current: z.string().min(1), next: password }).parse(await readJson(req));
      const u = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
      if (!verifyPassword(body.current, u.passwordHash)) throw new ApiError("Current password is incorrect.", 400, "BAD_CREDENTIALS");
      await db.update(users).set({ passwordHash: hashPassword(body.next) }).where(eq(users.id, user.id));
      const ctx = await getCtx();
      if (ctx) await logActivity(ctx, "account.password_changed", "user", user.id);
      return { ok: true };
    }
    case "accept-invite": {
      rateLimit(`invite:${ip}`, 15, 3600_000);
      const body = z.object({ token: z.string().min(10), name: z.string().trim().max(80).optional(), password }).parse(await readJson(req));
      const inv = (await db.select().from(invitations).where(and(eq(invitations.tokenHash, sha256(body.token)), eq(invitations.status, "PENDING"), gt(invitations.expiresAt, new Date()))).limit(1))[0];
      if (!inv) throw new ApiError("This invitation is invalid or has expired.", 400, "TOKEN_INVALID");
      let user = (await db.select().from(users).where(eq(users.email, inv.email)).limit(1))[0];
      if (user) {
        if (!verifyPassword(body.password, user.passwordHash)) throw new ApiError("An account with this email already exists. Enter its existing password to join.", 401, "BAD_CREDENTIALS");
      } else {
        if (!body.name?.trim()) throw new ApiError("Enter your name.", 400, "VALIDATION");
        [user] = await db.insert(users).values({ email: inv.email, name: body.name.trim(), passwordHash: hashPassword(body.password), emailVerified: true }).returning();
      }
      const already = await db.select({ id: members.id }).from(members).where(and(eq(members.userId, user.id), eq(members.status, "ACTIVE"))).limit(1);
      if (already.length) throw new ApiError("This account already belongs to a workspace.", 409, "ALREADY_MEMBER");
      await db.insert(members).values({ restaurantId: inv.restaurantId, userId: user.id, role: inv.role }).onConflictDoUpdate({ target: [members.restaurantId, members.userId], set: { role: inv.role, status: "ACTIVE" } });
      await db.update(invitations).set({ status: "ACCEPTED" }).where(eq(invitations.id, inv.id));
      await createSession(user.id);
      return { ok: true };
    }
    case "demo": {
      if (!publicEnv.demoMode) throw new ApiError("Demo mode is not enabled.", 403, "DEMO_DISABLED");
      rateLimit(`demo:${ip}`, 30, 600_000);
      const { ownerId } = await seedDemoWorkspace();
      await createSession(ownerId);
      return { ok: true };
    }
    default:
      throw new ApiError("Not found", 404);
  }
});
